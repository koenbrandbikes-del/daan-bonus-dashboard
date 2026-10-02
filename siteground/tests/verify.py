import pathlib,sys,unittest,json
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'deploy'))
import verify
class Health(unittest.TestCase):
 def test_old_revision_is_never_accepted(self):
  with patch.object(verify,'get',return_value=(200,{'X-LumeWorks-Revision':'old'},b'name="password"<title>LumeWorks</title>')),patch.object(verify.time,'sleep'):
   with self.assertRaises(AssertionError):verify.verify('new')
 def test_activation_delay_and_protected_routes(self):
  logins=iter(['old','new'])
  def get(path):
   if path=='/login':return 200,{'X-LumeWorks-Revision':next(logins)},b'name="password"<title>LumeWorks</title>'
   if path in ['/meta-test','/daan-test']:return 200,{},b'name="password"'
   if path=='/.well-known/oauth-authorization-server/oauth':return 404,{},b'hosting not found'
   if path=='/mcp':return 401,{'WWW-Authenticate':'Bearer resource_metadata="metadata"'},b''
   if path=='/oauth/resource':return 200,{},json.dumps({'resource':verify.origin+'/mcp','engine_ready':True}).encode()
   if path=='/oauth/.well-known/oauth-authorization-server':return 200,{},json.dumps({'authorization_endpoint':verify.origin+'/oauth/authorize','code_challenge_methods_supported':['S256']}).encode()
   return (401 if path.startswith('/data') or path.endswith('app.js') else 200),{},b''
  with patch.object(verify,'get',side_effect=get),patch.object(verify.time,'sleep'):verify.verify('new')
 def test_public_financial_data_fails_health_check(self):
  with patch.object(verify,'get',return_value=(200,{'X-LumeWorks-Revision':'new'},b'name="password"<title>LumeWorks</title>')):
   with self.assertRaises(AssertionError):verify.verify('new')
if __name__=='__main__':unittest.main(verbosity=2)
