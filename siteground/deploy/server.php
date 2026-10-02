<?php
// Installed outside public_html, invoked only by a restricted SSH key.
declare(strict_types=1);
umask(0077);
function stopDeploy(string $reason): never {throw new RuntimeException($reason);}
set_exception_handler(function(Throwable $e){echo 'DEPLOY_FAILED: '.$e->getMessage()."\n";exit(1);});
$p=__DIR__;
$lock=fopen($p.'/deploy.lock','c+');if(!$lock||!flock($lock,LOCK_EX))stopDeploy('LOCK');
$raw=stream_get_contents(STDIN,32*1024*1024+1);if(strlen($raw)>32*1024*1024)stopDeploy('SIZE');
$m=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
$pointer=$p.'/current-release.txt';
$dataPaths=['data/meta.json','data/google.json','data/shopify.json','data/creators.json','data/returns.json','data/status.json','assets/blended/costs.json'];
if(in_array($m['action']??'',['data-status','data-sync'],true)){
 $db=new PDO('sqlite:'.$p.'/state.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);$db->exec('PRAGMA busy_timeout=10000');
 if($m['action']==='data-status'){
  $versions=[];foreach($db->query('SELECT path,sha,updated FROM datasets') as $row)if(in_array($row['path'],$dataPaths,true))$versions[$row['path']]=['sha'=>$row['sha'],'updated'=>(int)$row['updated']];
  echo json_encode($versions,JSON_THROW_ON_ERROR)."\n";exit;
 }
 if(!preg_match('/^[a-f0-9]{40}$/',$m['revision']??''))stopDeploy('DATA_REVISION');
 $items=$m['files']??[];if(count($items)!==count($dataPaths)||array_diff($dataPaths,array_keys($items)))stopDeploy('DATA_INCOMPLETE');
 $decoded=[];
 foreach($items as $name=>$item){
  if(!in_array($name,$dataPaths,true))stopDeploy('DATA_PATH');
  $bytes=base64_decode($item['data']??'',true);
  if($bytes===false||strlen($bytes)>8*1024*1024||hash('sha256',$bytes)!==($item['sha256']??''))stopDeploy('DATA_HASH');
  $json=json_decode($bytes,true,512,JSON_THROW_ON_ERROR);if(!is_array($json)||!$json)stopDeploy('DATA_EMPTY');
  $required=['data/meta.json'=>['daily_meta'],'data/google.json'=>['daily_google'],'data/shopify.json'=>['orders'],'data/creators.json'=>['creators','orders'],'data/returns.json'=>['daily'],'data/status.json'=>['meta','google','shopify'],'assets/blended/costs.json'=>['items']];
  foreach($required[$name] as $field)if(!isset($json[$field])||!is_array($json[$field]))stopDeploy('DATA_SCHEMA');
  if($name==='data/returns.json'&&($json['complete']??false)!==true)stopDeploy('RETURNS_INCOMPLETE');
  $decoded[$name]=$bytes;
 }
 if(!is_dir($p.'/data-backups')&&!mkdir($p.'/data-backups',0700))stopDeploy('DATA_BACKUP_DIR');
 $backup=$p.'/data-backups/state-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(4)).'.sqlite';
 $db->exec('VACUUM INTO '.$db->quote($backup));chmod($backup,0600);
 $db->exec('BEGIN IMMEDIATE');
 try{
  $read=$db->prepare('SELECT sha FROM datasets WHERE path=?');
  foreach($items as $name=>$item){$read->execute([$name]);$current=$read->fetchColumn();if($current!==($item['expected_sha']??null))stopDeploy('DATA_CONFLICT');}
  $write=$db->prepare('UPDATE datasets SET content=?,sha=?,updated=? WHERE path=?');
  foreach($items as $name=>$item)if($item['expected_sha']!==$item['sha256'])$write->execute([$decoded[$name],$item['sha256'],time(),$name]);
  $db->exec('COMMIT');
 }catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
 atomData($p.'/last-data-sync.json',json_encode(['revision'=>$m['revision'],'at'=>gmdate('c')],JSON_THROW_ON_ERROR));
 echo "PRIVATE_DATA_SYNCED\n";exit;
}
function atomData(string $path,string $bytes):void{$tmp=tempnam(dirname($path),'.data-sync-');if(file_put_contents($tmp,$bytes)!==strlen($bytes)||!rename($tmp,$path))stopDeploy('DATA_RECEIPT');}

if(($m['action']??'')==='status'){echo json_encode(['revision'=>trim(file_get_contents($pointer))])."\n";exit;}
$releases=$p.'/releases';
function switchRelease(string $p,string $id):void{
 $tmp=tempnam($p,'.pointer-');if(file_put_contents($tmp,$id)!==strlen($id)||!rename($tmp,$p.'/current-release.txt'))stopDeploy('ACTIVATE');
}
if(($m['action']??'')==='rollback'){
 $current=trim(file_get_contents($pointer));
 if(($m['revision']??'')!==$current)stopDeploy('ROLLBACK_REVISION');
 $previous=trim(file_get_contents($p.'/previous-release.txt'));
 if(!preg_match('/^(?:[a-f0-9]{40}|bootstrap-[a-f0-9]{16})$/',$previous)||!is_dir($releases.'/'.$previous))stopDeploy('ROLLBACK_TARGET');
 switchRelease($p,$previous);echo "ROLLED_BACK\n";exit;
}
if(($m['action']??'')!=='deploy'||!preg_match('/^[a-f0-9]{40}$/',$m['revision']??''))stopDeploy('REQUEST');
$revision=$m['revision'];$files=$m['files']??[];
foreach(['app.php','login.php','account.php','dashboard.html','static/login.css','static/login.js','static/device.js','static/sw.js','static/manifest.webmanifest'] as $needed)if(!isset($files[$needed]))stopDeploy('INCOMPLETE');
if(count($files)>300)stopDeploy('FILE_COUNT');
if(!is_dir($releases)&&!mkdir($releases,0700))stopDeploy('RELEASE_DIR');
$stage=$releases.'/.stage-'.bin2hex(random_bytes(8));if(!mkdir($stage,0700))stopDeploy('STAGE');
foreach($files as $name=>$item){
 if(!preg_match('~^(?:app\.php|login\.php|account\.php|dashboard\.html|static/(?:login\.(?:css|js)|device\.js|sw\.js|manifest\.webmanifest|app-icon-(?:192|512)\.png|assets/(?:blended/[a-zA-Z0-9_/-]+|product-costs)\.(?:js|css|svg|png)))$~',$name)||str_contains($name,'..'))stopDeploy('PATH');
 $bytes=base64_decode($item['data']??'',true);
 if($bytes===false||strlen($bytes)>4*1024*1024||hash('sha256',$bytes)!==($item['sha256']??''))stopDeploy('HASH');
 $target=$stage.'/'.$name;if(!is_dir(dirname($target))&&!mkdir(dirname($target),0700,true))stopDeploy('MKDIR');
 if(file_put_contents($target,$bytes)!==strlen($bytes))stopDeploy('WRITE');
 if(str_ends_with($name,'.php')){
  exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($target).' 2>&1',$lint,$code);if($code!==0)stopDeploy('PHP_LINT');
 }
}
$dest=$releases.'/'.$revision;
if(is_dir($dest)){
 foreach($files as $n=>$item)if(!is_file($dest.'/'.$n)||hash_file('sha256',$dest.'/'.$n)!==$item['sha256'])stopDeploy('REVISION_COLLISION');
}else if(!rename($stage,$dest))stopDeploy('MOVE');
$old=trim(file_get_contents($pointer));
if($old!==$revision){if(file_put_contents($p.'/previous-release.txt',$old)!==strlen($old))stopDeploy('BACKUP_POINTER');switchRelease($p,$revision);}
echo 'DEPLOYED '.$revision."\n";
