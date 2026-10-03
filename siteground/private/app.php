<?php
declare(strict_types=1);

$cfg = json_decode(file_get_contents(LW_PRIVATE.'/config.json'), true, 32, JSON_THROW_ON_ERROR);
$base = rtrim($cfg['base_path'], '/');
$origin = rtrim($cfg['origin'], '/');
$originalMeta = defined('LW_ORIGINAL_META') && LW_ORIGINAL_META === true;
if($originalMeta){$base='';$origin='https://meta.lumeworks.nl';}
$dev = PHP_SAPI === 'cli-server' && getenv('LW_TEST_HTTP') === '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'], true);
$https = ($_SERVER['HTTPS'] ?? '') === 'on';
if (!$dev && !$https) { http_response_code(400); exit('HTTPS is vereist.'); }
if (!$dev && strtolower($_SERVER['HTTP_HOST'] ?? '') !== strtolower(parse_url($origin, PHP_URL_HOST))) {
    http_response_code(400); exit('Ongeldige host.');
}
header_remove('X-Powered-By');
header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
if (!$dev) header('Strict-Transport-Security: max-age=31536000');
$cspNonce = base64_encode(random_bytes(18));
$connections=$originalMeta ? "'self' https://script.google.com https://script.googleusercontent.com" : "'self'";
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-$cspNonce'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src $connections; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");

$db = new PDO('sqlite:'.LW_PRIVATE.'/state.sqlite', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
$db->exec('CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, password TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS devices (selector TEXT PRIMARY KEY, validator TEXT NOT NULL, user TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_lookup ON attempts(kind,key,at);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS datasets (path TEXT PRIMARY KEY, content TEXT NOT NULL, sha TEXT NOT NULL, updated INTEGER NOT NULL);');
chmod(LW_PRIVATE.'/state.sqlite',0600);
foreach ($cfg['users'] as $name=>$hash) {
    $q=$db->prepare('INSERT OR IGNORE INTO users(name,password) VALUES(?,?)'); $q->execute([$name,$hash]);
}
$path = parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if ($path === $base) { header('Location: '.$base.'/',true,308); exit; }
if (!is_string($path) || !str_starts_with($path,$base.'/')) { http_response_code(404); exit; }
$route = substr($path,strlen($base)+1);
$method = $_SERVER['REQUEST_METHOD'];
$dataPaths=['data/meta.json','data/google.json','data/shopify.json','data/creators.json','data/returns.json','data/status.json','assets/blended/costs.json'];

function jsonResponse(array $data,int $status=200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8'); echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR); exit;
}
function userRow(string $name): array|false {
    global $db; $q=$db->prepare('SELECT * FROM users WHERE name=?'); $q->execute([$name]); return $q->fetch(PDO::FETCH_ASSOC);
}
function h(string $s): string { return htmlspecialchars($s,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
function cookie(string $name,string $value,int $expires=0): void {
    global $base,$dev;
    setcookie($name,$value,['expires'=>$expires,'path'=>$base.'/','secure'=>!$dev,'httponly'=>true,'samesite'=>'Lax']);
}
function redirect(string $route=''): never { global $base; header('Location: '.$base.'/'.$route,true,303); exit; }
function readDataset(string $path): array|false {
    global $db; $q=$db->prepare('SELECT content,sha FROM datasets WHERE path=?');$q->execute([$path]);return $q->fetch(PDO::FETCH_ASSOC);
}
function validDataset(string $path,string $content): bool {
    try {$d=json_decode($content,true,512,JSON_THROW_ON_ERROR);} catch(Throwable) {return false;}
    if (!is_array($d)) return false;
    return match($path) {
        'data/meta.json' => is_array($d['daily_meta']??null) && count($d['daily_meta'])>0,
        'data/google.json' => is_array($d['daily_google']??null) && count($d['daily_google'])>0,
        'data/shopify.json','data/creators.json' => is_array($d['orders']??null) && count($d['orders'])>0,
        'data/returns.json' => ($d['version']??null)===2 && ($d['complete']??false)===true && is_array($d['daily']??null) && !isset($d['orders']),
        'assets/blended/costs.json' => is_array($d['items']??null) && count($d['items'])>0,
        'data/status.json' => true,
        default => false,
    };
}

// Machine ingestion is signed, replay resistant, explicitly scoped and uses CAS writes.
if (str_starts_with($route,'api/storage/')) {
    $file=substr($route,strlen('api/storage/'));
    if (!in_array($file,$dataPaths,true) || !in_array($method,['GET','PUT'],true)) jsonResponse(['error'=>'Not found'],404);
    $body=file_get_contents('php://input');
    if (strlen($body)>8*1024*1024) jsonResponse(['error'=>'Too large'],413);
    $stamp=$_SERVER['HTTP_X_LW_TIMESTAMP']??''; $nonce=$_SERVER['HTTP_X_LW_NONCE']??'';
    $signature=$_SERVER['HTTP_X_LW_SIGNATURE']??'';
    $signed=$stamp."\n".$nonce."\n".$method."\n".$_SERVER['REQUEST_URI']."\n".hash('sha256',$body);
    if (!ctype_digit($stamp) || abs(time()-(int)$stamp)>300 || !preg_match('/^[a-f0-9]{32,64}$/',$nonce) || !hash_equals(hash_hmac('sha256',$signed,$cfg['sync_secret']),$signature)) jsonResponse(['error'=>'Unauthorized'],401);
    try {$q=$db->prepare('INSERT INTO nonces VALUES(?,?)');$q->execute([$nonce,time()]);} catch(PDOException) {jsonResponse(['error'=>'Replay'],409);}
    $db->exec('DELETE FROM nonces WHERE at < '.(time()-600));
    $current=readDataset($file);
    if($method==='GET') {
        if(!$current) jsonResponse(['error'=>'Missing dataset'],404);
        jsonResponse($current);
    }
    try {$input=json_decode($body,true,32,JSON_THROW_ON_ERROR);} catch(Throwable) {jsonResponse(['error'=>'Invalid JSON'],422);}
    $content=$input['content']??null;
    if(!is_string($content)||!validDataset($file,$content))jsonResponse(['error'=>'Invalid dataset'],422);
    $db->exec('BEGIN IMMEDIATE');
    try {
        $current=readDataset($file);
        if(($current['sha']??null)!==($input['sha']??null)) {$db->exec('ROLLBACK');jsonResponse(['error'=>'Conflict'],409);}
        $sha=hash('sha256',$content);
        $q=$db->prepare('INSERT INTO datasets VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET content=excluded.content,sha=excluded.sha,updated=excluded.updated');
        $q->execute([$file,$content,$sha,time()]);$db->exec('COMMIT');jsonResponse(['sha'=>$sha]);
    } catch(Throwable $e) {$db->exec('ROLLBACK');throw $e;}
}

// __MCP_IMPLEMENTATION__
// __META_REVIEW_IMPLEMENTATION__
mcpMachineRoutes();
// Only the login visuals and app metadata are public. Everything else needs a session.
$publicFiles=['login.css'=>'text/css','login.js'=>'text/javascript','device.js'=>'text/javascript','sw.js'=>'text/javascript','manifest.webmanifest'=>'application/manifest+json','assets/blended/lumeworks-logo.svg'=>'image/svg+xml','assets/blended/favicon-finance.svg'=>'image/svg+xml','assets/blended/favicon-finance.png'=>'image/png','assets/blended/apple-touch-finance.png'=>'image/png','app-icon-192.png'=>'image/png','app-icon-512.png'=>'image/png'];
if(isset($publicFiles[$route]) && in_array($method,['GET','HEAD'],true)) {
    header('Content-Type: '.$publicFiles[$route]);
    $content=file_get_contents(LW_PRIVATE.'/static/'.$route);
    if($route==='manifest.webmanifest') $content=str_replace('__BASE__',$base,$content);
    if($route==='sw.js') header('Service-Worker-Allowed: '.$base.'/');
    if($method!=='HEAD') echo $content;
    exit;
}
if (!is_dir(LW_PRIVATE.'/sessions')) mkdir(LW_PRIVATE.'/sessions',0700);
ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');ini_set('session.gc_maxlifetime','86400');
session_save_path(LW_PRIVATE.'/sessions');session_name('LWCSSESSION');
session_set_cookie_params(['lifetime'=>0,'path'=>$base.'/','secure'=>!$dev,'httponly'=>true,'samesite'=>'Lax']);
session_start();
$_SESSION['csrf']??=bin2hex(random_bytes(32));
function csrf(): void {
    global $dev,$origin;
    $site=$_SERVER['HTTP_SEC_FETCH_SITE']??'';
    $sentOrigin=$_SERVER['HTTP_ORIGIN']??'';
    if ($site==='cross-site' || (!$dev && $sentOrigin && $sentOrigin!==$origin) || !is_string($_POST['csrf']??null) || !hash_equals($_SESSION['csrf'],$_POST['csrf'])) {
        http_response_code(403);exit('Deze aanvraag is verlopen. Vernieuw de pagina.');
    }
}
function revokeDevice(): void {
    global $db;
    if(isset($_SESSION['device'])) {$q=$db->prepare('DELETE FROM devices WHERE selector=?');$q->execute([$_SESSION['device']]);}
    cookie('LWCSDEVICE','',time()-3600);
}
function signIn(array $user,bool $remember): void {
    global $db;
    $oauthRequest=$_SESSION['oauth_request']??null;
    $returnTo=$_SESSION['return_to']??null;
    revokeDevice();session_regenerate_id(true);
    $_SESSION=['user'=>$user['name'],'version'=>$user['version'],'issued'=>time(),'last'=>time(),'csrf'=>bin2hex(random_bytes(32))];
    if($oauthRequest)$_SESSION['oauth_request']=$oauthRequest;
    if(in_array($returnTo,['meta-test','daan-test'],true))$_SESSION['return_to']=$returnTo;
    if($remember) {
        $selector=bin2hex(random_bytes(16));$validator=bin2hex(random_bytes(32));$expires=time()+30*86400;
        $q=$db->prepare('INSERT INTO devices VALUES(?,?,?,?,?)');$q->execute([$selector,hash('sha256',$validator),$user['name'],$expires,time()]);
        $_SESSION['device']=$selector;cookie('LWCSDEVICE',$selector.'.'.$validator,$expires);
    }
}
// Validate against current account version and revocation on every request.
$user=isset($_SESSION['user'])?userRow($_SESSION['user']):false;
if($user && (($_SESSION['version']??0)!=$user['version'] || time()-($_SESSION['last']??0)>8*3600 || time()-($_SESSION['issued']??0)>86400)) $user=false;
if($user && isset($_SESSION['device'])) {
    $q=$db->prepare('SELECT expires FROM devices WHERE selector=? AND user=?');$q->execute([$_SESSION['device'],$user['name']]);$d=$q->fetch(PDO::FETCH_ASSOC);
    if(!$d || $d['expires']<time()) $user=false;
}
if(!$user && isset($_COOKIE['LWCSDEVICE']) && preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/',$_COOKIE['LWCSDEVICE'],$parts)) {
    $q=$db->prepare('SELECT * FROM devices WHERE selector=?');$q->execute([$parts[1]]);$device=$q->fetch(PDO::FETCH_ASSOC);
    if($device && $device['expires']>time() && hash_equals($device['validator'],hash('sha256',$parts[2]))) {
        $user=userRow($device['user']);
        if($user) {
            // Rotate the secret without extending the 30-day absolute lifetime.
            $validator=bin2hex(random_bytes(32));
            $q=$db->prepare('UPDATE devices SET validator=? WHERE selector=?');$q->execute([hash('sha256',$validator),$parts[1]]);
            session_regenerate_id(true);
            $_SESSION=['user'=>$user['name'],'version'=>$user['version'],'issued'=>time(),'last'=>time(),'csrf'=>bin2hex(random_bytes(32)),'device'=>$parts[1]];
            cookie('LWCSDEVICE',$parts[1].'.'.$validator,(int)$device['expires']);
        }
    }
}
if($user) $_SESSION['last']=time();
$error='';
if($route==='login' && $method==='POST') {
    csrf();
    $name=strtolower(trim(substr(is_string($_POST['username']??null)?$_POST['username']:'',0,64)));
    $password=is_string($_POST['password']??null)?$_POST['password']:'';
    $ip=hash_hmac('sha256',$_SERVER['REMOTE_ADDR']??'unknown',$cfg['sync_secret']);
    $db->exec('DELETE FROM attempts WHERE at < '.(time()-900));
    $q=$db->prepare('SELECT COUNT(*) FROM attempts WHERE (kind="ip" AND key=?) OR (kind="user" AND key=?)');$q->execute([$ip,$name]);$count=(int)$q->fetchColumn();
    if($count>=12) {http_response_code(429);header('Retry-After: 900');$error='Te veel pogingen. Probeer het over 15 minuten opnieuw.';}
    else {
        $candidate=userRow($name);
        $hash=$candidate['password']??$cfg['dummy_hash'];
        $ok=strlen($password)<=1024 && password_verify($password,$hash);
        if($candidate && $ok) {
            $q=$db->prepare('DELETE FROM attempts WHERE kind="user" AND key=?');$q->execute([$name]);
            signIn($candidate,isset($_POST['remember']));$target=isset($_SESSION['oauth_request'])?'oauth/authorize':($_SESSION['return_to']??'');unset($_SESSION['return_to']);redirect($target);
        }
        $q=$db->prepare('INSERT INTO attempts VALUES(?,?,?)');$q->execute(['ip',$ip,time()]);$q->execute(['user',$name,time()]);
        http_response_code(401);$error='Gebruikersnaam of wachtwoord klopt niet.';
    }
}
if($route==='login') {
    if($user)redirect();
    if(!in_array($method,['GET','POST'],true)){http_response_code(405);exit;}
    require LW_PRIVATE.'/login.php';exit;
}
oauthConsent();
if(!$user) {
    if(in_array($route,['meta-test','daan-test'],true)){$_SESSION['return_to']=$route;redirect('login');}
    if(str_starts_with($route,'data/') || str_starts_with($route,'api/') || str_ends_with($route,'.json'))jsonResponse(['error'=>'Login required'],401);
    if($route==='' || $route==='blended.html') redirect('login');
    http_response_code(401);exit('Log in om Cijfers te openen.');
}
if($method==='POST' && in_array($route,['logout','logout-all','password'],true)) {
    csrf();
    if($route==='password') {
        $current=is_string($_POST['current']??null)?$_POST['current']:'';
        $password=is_string($_POST['new']??null)?$_POST['new']:'';
        if(strlen($password)<12 || strlen($password)>128 || !password_verify($current,$user['password'])) {
            http_response_code(422);$accountError='Gebruik je huidige wachtwoord en een nieuw wachtwoord van 12–128 tekens.';
            require LW_PRIVATE.'/account.php';exit;
        }
        $hash=password_hash($password,PASSWORD_ARGON2ID,['memory_cost'=>65536,'time_cost'=>3,'threads'=>1]);
        $q=$db->prepare('UPDATE users SET password=?, version=version+1 WHERE name=?');$q->execute([$hash,$user['name']]);
    }
    if($route==='logout-all' || $route==='password') {
        $q=$db->prepare('DELETE FROM devices WHERE user=?');$q->execute([$user['name']]);
        if($route==='logout-all') {$q=$db->prepare('UPDATE users SET version=version+1 WHERE name=?');$q->execute([$user['name']]);}
    }
    revokeDevice();$_SESSION=[];session_destroy();cookie('LWCSSESSION','',time()-3600);redirect('login');
}
if(!in_array($method,['GET','HEAD'],true)){http_response_code(405);exit;}
if(in_array($route,['meta-test','daan-test'],true)){if($originalMeta){http_response_code(404);exit;}metaReviewPage($route);}
if($route==='account') {require LW_PRIVATE.'/account.php';exit;}
if($route==='api/session')jsonResponse(['user'=>$user['name']]);
if(in_array($route,$dataPaths,true)) {
    $record=readDataset($route);
    if(!$record)jsonResponse(['error'=>'Source not yet imported'],503);
    header('Content-Type: application/json; charset=utf-8');session_write_close();if($method!=='HEAD')echo $record['content'];exit;
}
if($route==='' || $route==='blended.html') {
    if($originalMeta)originalMetaDashboard();
    header('Content-Type: text/html; charset=utf-8');
    $html=file_get_contents(LW_PRIVATE.'/dashboard.html');
    $html=str_replace(['__USER__','__BASE__'],[h(ucfirst($user['name'])),$base],$html);
    session_write_close();if($method!=='HEAD')echo $html;exit;
}
// File access is constrained to the built static directory and known extensions.
if(preg_match('#^assets/(?:blended/[a-zA-Z0-9_/-]+|product-costs)\.(js|css|svg|png)$#',$route,$m) && !str_contains($route,'..') && is_file(LW_PRIVATE.'/static/'.$route)) {
    header('Content-Type: '.match($m[1]){'js'=>'text/javascript','css'=>'text/css','svg'=>'image/svg+xml','png'=>'image/png'});
    session_write_close();if($method!=='HEAD')readfile(LW_PRIVATE.'/static/'.$route);exit;
}
http_response_code(404);echo 'Niet gevonden.';

// __ORIGINAL_META_IMPLEMENTATION__
