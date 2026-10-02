#!/usr/bin/env python3
"""Code only: never package config, accounts, sessions or financial datasets."""
import base64,hashlib,json,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from build import build

def bundle(sha):
    if len(sha)!=40 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('Invalid revision')
    with tempfile.TemporaryDirectory() as d:
        out=pathlib.Path(d)/'build';build(out,None,'php','https://cijfers.lumeworks.nl','',code_only=True)
        private=out/'lumeworks-private';files={}
        for p in sorted(private.rglob('*')):
            if not p.is_file():continue
            name=p.relative_to(private).as_posix()
            if name=='.htaccess':continue
            content=p.read_bytes()
            if name=='app.php':
                s=content.decode()
                for suffix in ['/static/','/login.php','/account.php','/dashboard.html']:s=s.replace("LW_PRIVATE.'"+suffix,"LW_CODE.'"+suffix)
                content=s.encode()
            files[name]={'sha256':hashlib.sha256(content).hexdigest(),'data':base64.b64encode(content).decode()}
        return {'action':'deploy','revision':sha,'files':files}
if __name__=='__main__':json.dump(bundle(sys.argv[1]),sys.stdout,separators=(',',':'))
