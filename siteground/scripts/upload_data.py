#!/usr/bin/env python3
"""Upload freshly generated datasets, with signing and optimistic revisions. Secrets only from env."""
import argparse, hashlib, hmac, json, os, pathlib, secrets, time, urllib.request, urllib.error, urllib.parse, tempfile
PATHS=['data/meta.json','data/google.json','data/shopify.json','data/creators.json','data/returns.json','data/status.json','assets/blended/costs.json']
def request(path,method='GET',payload=None):
    origin=os.environ['LW_STORAGE_ORIGIN'].rstrip('/');secret=os.environ['LW_STORAGE_SECRET']
    if not origin.startswith('https://'):raise RuntimeError('HTTPS required')
    url=origin+'/api/storage/'+path;body=b'' if payload is None else json.dumps(payload,ensure_ascii=False).encode()
    stamp=str(int(time.time()));nonce=secrets.token_hex(16);route=urllib.parse.urlsplit(url).path
    signature=hmac.new(secret.encode(),'\n'.join([stamp,nonce,method,route,hashlib.sha256(body).hexdigest()]).encode(),hashlib.sha256).hexdigest()
    r=urllib.request.Request(url,data=None if method=='GET' else body,method=method,headers={'Content-Type':'application/json','X-LW-Timestamp':stamp,'X-LW-Nonce':nonce,'X-LW-Signature':signature})
    # Never forward a secret-bearing request across redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    try:
        with urllib.request.build_opener(NoRedirect).open(r,timeout=20) as response:return json.load(response)
    except urllib.error.HTTPError as e:
        if e.code==404 and method=='GET':return None
        raise RuntimeError(f'{method} {path}: HTTP {e.code}; regenerate/read before retrying a conflict') from None
def main():
    p=argparse.ArgumentParser();p.add_argument('--root',default=str(pathlib.Path(__file__).resolve().parents[2]));p.add_argument('--paths',nargs='+',choices=PATHS,default=PATHS);p.add_argument('--capture');p.add_argument('--expected-revisions');p.add_argument('--pull',action='store_true');a=p.parse_args()
    if a.capture:
        revisions={}
        for path in a.paths:
            current=request(path);revisions[path]=(current or {}).get('sha')
            if a.pull and current:
                json.loads(current['content']);target=pathlib.Path(a.root)/path;target.parent.mkdir(parents=True,exist_ok=True)
                fd,tmp=tempfile.mkstemp(dir=target.parent,prefix='.private-sync-')
                try:
                    with os.fdopen(fd,'w') as f:f.write(current['content'])
                    os.replace(tmp,target)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
        fd=os.open(a.capture,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump(revisions,f)
        print('Captured revisions before generation');return
    if a.pull:raise RuntimeError('--pull is only allowed with --capture before generation')
    if not a.expected_revisions:raise RuntimeError('Capture revisions BEFORE running the producer, then supply --expected-revisions')
    expected=json.loads(pathlib.Path(a.expected_revisions).read_text())
    for path in a.paths:
        file=pathlib.Path(a.root)/path;started=file.stat().st_mtime
        old=request(path);content=file.read_text();json.loads(content)
        if file.stat().st_mtime!=started:raise RuntimeError('Input changed while reading; rerun generator')
        if old and old['sha']==hashlib.sha256(content.encode()).hexdigest():print(path+': unchanged');continue
        if path not in expected:raise RuntimeError('No pre-generation revision for '+path)
        request(path,'PUT',{'content':content,'sha':expected[path]})
        print(path+': uploaded')
if __name__=='__main__':main()
