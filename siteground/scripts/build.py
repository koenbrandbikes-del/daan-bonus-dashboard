#!/usr/bin/env python3
"""Build a private, relocatable SiteGround deployment. Never put output in git/public_html."""
import argparse, hashlib, json, os, pathlib, secrets, shutil, sqlite3, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
SOURCE=ROOT/'siteground'
DATA_PATHS=['data/meta.json','data/google.json','data/shopify.json','data/creators.json','data/returns.json','data/status.json','assets/blended/costs.json']

def build(output,credentials,php,origin,base,data_root=None):
    output=pathlib.Path(output).resolve()
    if output.exists(): raise SystemExit('Output already exists; use a new release directory.')
    output.mkdir(parents=True,mode=0o700)
    public=output/'public';private=output/'lumeworks-private'
    shutil.copytree(SOURCE/'public',public)
    private.mkdir(mode=0o700)
    for name in ['app.php','login.php','account.php','.htaccess']:
        shutil.copy2(SOURCE/'private'/name,private/name)
    (public/'private-path.php').write_text("<?php return dirname(__DIR__,2).'/lumeworks-private';\n")
    static=private/'static';static.mkdir()
    shutil.copytree(ROOT/'assets/blended',static/'assets/blended',ignore=shutil.ignore_patterns('*.json'))
    shutil.copy2(ROOT/'assets/product-costs.js',static/'assets/product-costs.js')
    for name in ['login.css','login.js','device.js','sw.js','manifest.webmanifest']:
        shutil.copy2(SOURCE/'private'/name,static/name)
    # Icons reuse the established finance monogram, rendered at installable sizes.
    from PIL import Image
    icon=Image.open(ROOT/'assets/blended/apple-touch-finance.png').convert('RGBA')
    for size in [192,512]:icon.resize((size,size),Image.Resampling.LANCZOS).save(static/f'app-icon-{size}.png')
    html=(ROOT/'blended.html').read_text().replace('<html lang="nl">','<html lang="nl" data-secured="true" class="session-hidden">')
    html=html.replace('LumeWorks • Financieel','LumeWorks • Cijfers').replace('href="blended.html"','href="__BASE__/"')
    html=html.replace('</head>','<link rel="manifest" href="manifest.webmanifest"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Cijfers"><link rel="stylesheet" href="assets/blended/account.css"><script defer src="device.js"></script></head>')
    html=html.replace('<div class="controls">','<a class="account-link" href="__BASE__/account" aria-label="Je account">__USER__ <span aria-hidden="true">⌄</span></a><div class="controls">')
    html=html.replace('<main id="content"','<div id="sessionRetry" class="panel" hidden><p>Verbinding controleren. Je cijfers worden afgeschermd tot je sessie is bevestigd.</p><button>Opnieuw proberen</button></div><main id="content"')
    html=html.replace('</footer>','<details class="app-help"><summary>Cijfers als app bewaren</summary><p>iPhone: Safari → Delen → Zet op beginscherm. Android: browsermenu → App installeren. Laptop: installeren in Chrome/Edge of toevoegen aan Dock in Safari.</p><button id="installApp" hidden>App installeren</button></details></footer>')
    (private/'dashboard.html').write_text(html)
    (static/'assets/blended/account.css').write_text('.account-link{color:var(--muted);text-decoration:none;font-size:12px;display:flex;align-items:center;gap:6px;min-height:44px;padding:0 10px;border:1px solid var(--line);border-radius:8px}header{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center}.brand{grid-column:1;grid-row:1}.account-link{grid-column:3;grid-row:1}header .controls{grid-column:2;grid-row:1}@media(max-width:1099px){header{grid-template-columns:minmax(0,1fr) auto}.account-link{grid-column:2}header .controls{grid-column:1/-1;grid-row:2}}.session-hidden #content,.session-hidden #tabs,.session-hidden #dashboardStatus,.session-hidden #status{visibility:hidden}.app-help{font-size:11px;color:var(--muted);max-width:420px}.app-help summary{cursor:pointer;min-height:32px}.app-help p{margin:10px 0}header .controls{flex-wrap:wrap;min-width:0}footer{flex-wrap:wrap;gap:12px}@media(max-width:600px){.account-link{margin-left:auto}header .controls{width:100%}.shell{padding-left:max(14px,env(safe-area-inset-left));padding-right:max(14px,env(safe-area-inset-right))}header{gap:14px}.app-help{width:100%}}[hidden]{display:none!important}')
    # In the secured build, retain recovery in memory only; never replay cached data after 401.
    data=(static/'assets/blended/data.js').read_text()
    data=data.replace('if(!r.ok) throw Error("HTTP "+r.status);', 'if(r.status===401){document.documentElement.classList.add("session-hidden");Object.keys(memoryCache).forEach(k=>delete memoryCache[k]);location.replace("login");throw Object.assign(Error("Login vereist"),{unauthorized:true});} if(!r.ok) throw Error("HTTP "+r.status);')
    data=data.replace('} catch(e) { last=e; } finally', '} catch(e) { if(e.unauthorized)throw e; last=e; } finally')
    data=data.replace('try { sessionStorage.setItem(cacheVersion+key,JSON.stringify(d)); } catch {}','memoryCache[key]=d;')
    data=data.replace('try { const cached=JSON.parse(sessionStorage.getItem(cacheVersion+key)); if(cached) return validate(cached); } catch {}','if(e.unauthorized)throw e; const cached=memoryCache[key]; if(cached)return validate(cached);')
    data=data.replace('const cacheVersion = "lw-dashboard-v3";', 'const memoryCache = {};')
    if 'sessionStorage' in data:raise SystemExit('Unexpected persistent financial cache; review build transform.')
    (static/'assets/blended/data.js').write_text(data)
    app=(static/'assets/blended/app.js').read_text().replace('Financieel overzicht','Cijfers')
    # CSP disallows event attributes; the sole old error-path button is bound explicitly.
    app=app.replace('onclick="location.reload()"','id="retryLoad"')
    app=app.replace('  }\n}\n', '  }\n}\n')
    app+='\ndocument.addEventListener("click",e=>{if(e.target.closest("#retryLoad"))location.reload();});\n'
    (static/'assets/blended/app.js').write_text(app)
    if credentials:
        creds=json.loads(pathlib.Path(credentials).read_text())
    else:
        creds={name:secrets.token_urlsafe(21) for name in ['koen','floris','pim','bas']}
    if set(creds)!=set(['koen','floris','pim','bas']):raise SystemExit('Exactly four named accounts required.')
    php_code='$a=json_decode(stream_get_contents(STDIN),true);$o=[];foreach($a as $k=>$v){$o[$k]=password_hash($v,PASSWORD_ARGON2ID,["memory_cost"=>65536,"time_cost"=>3,"threads"=>1]);}echo json_encode($o);'
    hashes=json.loads(subprocess.check_output([php,'-r',php_code],input=json.dumps({**creds,'dummy':secrets.token_urlsafe(32)}).encode()))
    cfg={'origin':origin,'base_path':base,'sync_secret':secrets.token_hex(32),'users':{name:hashes[name] for name in creds},'dummy_hash':hashes['dummy']}
    (private/'config.json').write_text(json.dumps(cfg,indent=2)+'\n');os.chmod(private/'config.json',0o600)
    db=sqlite3.connect(private/'state.sqlite')
    db.execute('CREATE TABLE datasets(path TEXT PRIMARY KEY,content TEXT NOT NULL,sha TEXT NOT NULL,updated INTEGER NOT NULL)')
    import time
    for path in DATA_PATHS:
        content=((pathlib.Path(data_root) if data_root else ROOT)/path).read_text();json.loads(content)
        db.execute('INSERT INTO datasets VALUES(?,?,?,?)',(path,content,hashlib.sha256(content.encode()).hexdigest(),int(time.time())))
    db.commit();db.close();os.chmod(private/'state.sqlite',0o600)
    # An installer/test may explicitly supply credentials. Generated ones go to a private sibling.
    if not credentials:
        target=output.parent/(output.name+'-credentials.json')
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump(creds,f)
    shutil.copy2(SOURCE/'README.md',output/'INSTALLATIE.md')
    print('Built release with four hashed accounts, private datasets and protected app.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--credentials');p.add_argument('--php',default='php');p.add_argument('--origin',default='https://www.lumeworks.nl');p.add_argument('--base',default='/cijfers');p.add_argument('--data-root');a=p.parse_args()
    build(a.output,a.credentials,a.php,a.origin,a.base,a.data_root)
