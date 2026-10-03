import pathlib,sys,unittest,json,subprocess
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
   if path=='/.well-known/oauth-authorization-server/oauth':return 200,{},json.dumps({'issuer':verify.origin+'/oauth','authorization_endpoint':verify.origin+'/oauth/authorize','code_challenge_methods_supported':['S256'],'grant_types_supported':['authorization_code']}).encode()
   if path=='/mcp':return 401,{'WWW-Authenticate':'Bearer resource_metadata="metadata"'},b''
   if path=='/oauth/resource':return 200,{},json.dumps({'resource':verify.origin+'/mcp','engine_ready':True}).encode()
   if path=='/oauth/.well-known/oauth-authorization-server':return 200,{},json.dumps({'authorization_endpoint':verify.origin+'/oauth/authorize','code_challenge_methods_supported':['S256']}).encode()
   return (401 if path.startswith('/data') or path.endswith('app.js') else 200),{},b''
  with patch.object(verify,'get',side_effect=get),patch.object(verify.time,'sleep'):verify.verify('new')
 def test_public_financial_data_fails_health_check(self):
  with patch.object(verify,'get',return_value=(200,{'X-LumeWorks-Revision':'new'},b'name="password"<title>LumeWorks</title>')):
   with self.assertRaises(AssertionError):verify.verify('new')
class Transport(unittest.TestCase):
 def test_timeout_retried_once_without_altering_the_response(self):
  result=(401,{},b'authentication required')
  with patch.object(verify,'_get_once',side_effect=[subprocess.CalledProcessError(28,['curl']),result]) as call,patch.object(verify.time,'sleep'):
   self.assertEqual(verify.get('/data/meta.json'),result);self.assertEqual(call.call_count,2)
 def test_certificate_failure_is_never_retried_or_bypassed(self):
  with patch.object(verify,'_get_once',side_effect=subprocess.CalledProcessError(60,['curl'])) as call,patch.object(verify.time,'sleep'):
   with self.assertRaises(subprocess.CalledProcessError):verify.get('/login')
   self.assertEqual(call.call_count,1)
 def test_persistent_timeout_remains_a_failure(self):
  with patch.object(verify,'_get_once',side_effect=subprocess.CalledProcessError(28,['curl'])) as call,patch.object(verify.time,'sleep'):
   with self.assertRaises(subprocess.CalledProcessError):verify.get('/login')
   self.assertEqual(call.call_count,2)
if __name__=='__main__':unittest.main(verbosity=2)
