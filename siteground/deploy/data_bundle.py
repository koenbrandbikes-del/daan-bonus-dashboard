#!/usr/bin/env python3
"""Bridge existing synchronized sources to private SQLite through restricted SSH."""
import base64,hashlib,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
PATHS=['data/meta.json','data/google.json','data/shopify.json','data/creators.json','data/returns.json','data/status.json','assets/blended/costs.json']
def bundle(revision,versions):
 if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision):raise ValueError('Invalid revision')
 files={}
 for path in PATHS:
  b=(ROOT/path).read_bytes();d=json.loads(b)
  if not isinstance(d,(dict,list)) or not d:raise ValueError('Empty source: '+path)
  files[path]={'data':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest(),'expected_sha':versions[path]['sha']}
 return {'action':'data-sync','revision':revision,'files':files}
if __name__=='__main__':json.dump(bundle(sys.argv[1],json.load(open(sys.argv[2]))),sys.stdout,separators=(',',':'))
