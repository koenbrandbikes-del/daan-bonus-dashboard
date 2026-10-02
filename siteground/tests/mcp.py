"""Real OAuth + MCP + shared JavaScript calculations through PHP/SQLite."""
import base64,hashlib,json,pathlib,re,sys,unittest,urllib.parse,sqlite3,subprocess
import security as security_tests
Client=security_tests.Client;BASE=security_tests.BASE
class MCP(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  security_tests.Security.setUpClass();cls.port=security_tests.Security.port;cls.private=security_tests.Security.private
 @classmethod
 def tearDownClass(cls):security_tests.Security.tearDownClass()
 def setUp(self):
  self.c=Client(self.port)
  with sqlite3.connect(self.private/'state.sqlite') as db:db.execute('DELETE FROM attempts')
 def register(self):
  r=self.c.request('oauth/register','POST',json.dumps({'redirect_uris':['https://chatgpt.com/connector_platform_oauth_redirect'],'token_endpoint_auth_method':'none'}),{'Content-Type':'application/json'})
  self.assertEqual(r[0],201,r[1]);return json.loads(r[1])['client_id']
 def authorize(self,name='pim',client=None):
  client=client or self.register();verifier='A'*43;challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
  query={'client_id':client,'redirect_uri':'https://chatgpt.com/connector_platform_oauth_redirect','response_type':'code','resource':security_tests.Security.config['origin']+BASE+'/mcp','code_challenge':challenge,'code_challenge_method':'S256','state':'state123','scope':'finance:read'}
  r=self.c.request('oauth/authorize?'+urllib.parse.urlencode(query));self.assertEqual(r[0],303,r[1]);self.assertTrue(r[2]['location'].endswith('/login'))
  r=self.c.login(name);self.assertEqual(r[0],303);self.assertTrue(r[2]['location'].endswith('/oauth/authorize'))
  r=self.c.request('oauth/authorize');self.assertEqual(r[0],200,r[1]);csrf=re.search(r'name="csrf" value="([a-f0-9]+)"',r[1])[1]
  r=self.c.request('oauth/authorize','POST',{'csrf':csrf,'consent':'allow'});self.assertEqual(r[0],303,r[1]);q=urllib.parse.parse_qs(urllib.parse.urlsplit(r[2]['location']).query);self.assertEqual(q['state'],['state123']);self.assertIn('iss',q)
  return {'grant_type':'authorization_code','client_id':client,'code':q['code'][0],'redirect_uri':query['redirect_uri'],'resource':query['resource'],'code_verifier':verifier}
 def token(self,params):
  r=self.c.request('oauth/token','POST',params);self.assertEqual(r[0],200,r[1]);return json.loads(r[1])
 def rpc(self,token,method,params=None,extra=None):
  return self.c.request('mcp','POST',json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params or {}}),{'Content-Type':'application/json','Authorization':'Bearer '+token,**(extra or {})})
 def test_01_discovery_and_anonymous_protection(self):
  for route in ['.well-known/oauth-protected-resource/mcp','.well-known/oauth-authorization-server']:
   r=self.c.request(route);self.assertEqual(r[0],200);self.assertIn('no-store',r[2]['cache-control'])
  r=self.c.request('mcp');self.assertEqual(r[0],401);self.assertIn('resource_metadata',r[2]['www-authenticate']);self.assertNotIn('daily_meta',r[1])
  self.c.login();self.assertEqual(self.c.request('mcp')[0],401)
 def test_02_full_financial_tools_pim_and_floris(self):
  for name in ['pim','floris']:
   self.c=Client(self.port);t=self.token(self.authorize(name));init=self.rpc(t['access_token'],'initialize',{'protocolVersion':'2025-11-25'});self.assertEqual(json.loads(init[1])['result']['protocolVersion'],'2025-11-25')
   tools=json.loads(self.rpc(t['access_token'],'tools/list')[1])['result']['tools'];self.assertEqual(len(tools),8);self.assertTrue(all(x['annotations']['readOnlyHint'] for x in tools))
   r=self.rpc(t['access_token'],'tools/call',{'name':'get_financial_summary','arguments':{'from':'2026-09-01','to':'2026-09-30','channels':['all','meta','google','infl']}})
   answer=json.loads(r[1])['result'];self.assertFalse(answer['isError'],r[1]);a=answer['structuredContent'];self.assertEqual(a['context']['user'],name);self.assertEqual(len(a['result']['channels']),4);self.assertIsNotNone(a['result']['channels']['meta']['result']);self.assertGreater(len(a['result']['channels']['all']['marginBuild']),8)
   for tool,args in [('get_data_status',{}),('get_meta_test_review',{'from':'2026-09-01','to':'2026-09-30','monthly_fixed':500}),('get_financial_trend',{'from':'2026-09-01','to':'2026-09-07','channels':['all','meta']}),('list_orders',{'from':'2026-09-01','to':'2026-09-30','limit':2}),('read_financial_data',{'source':'creators'}),('explain_financial_methodology',{}),('compare_periods',{'from':'2026-09-08','to':'2026-09-14','compare_from':'2026-09-01','compare_to':'2026-09-07'})]:
    result=json.loads(self.rpc(t['access_token'],'tools/call',{'name':tool,'arguments':args})[1])['result'];self.assertFalse(result['isError'],tool+str(result));self.assertIn('sources',result['structuredContent']['context'])
 def test_03_pkce_resource_and_code_replay(self):
  p=self.authorize();self.assertEqual(self.c.request('oauth/token','POST',{**p,'code_verifier':'B'*43})[0],400);self.assertEqual(self.c.request('oauth/token','POST',{**p,'resource':'https://other.example/mcp'})[0],400)
  self.token(p);self.assertEqual(self.c.request('oauth/token','POST',p)[0],400)
 def test_04_refresh_rotation_and_reuse_revokes(self):
  p=self.authorize();t=self.token(p);refresh={'grant_type':'refresh_token','client_id':p['client_id'],'refresh_token':t['refresh_token'],'resource':p['resource']};new=self.token(refresh)
  self.assertEqual(self.rpc(t['access_token'],'tools/list')[0],401);self.assertEqual(self.rpc(new['access_token'],'tools/list')[0],200)
  self.assertEqual(self.c.request('oauth/token','POST',refresh)[0],400);self.assertEqual(self.rpc(new['access_token'],'tools/list')[0],401)
 def test_05_account_revocation_and_expiration(self):
  p=self.authorize();t=self.token(p);self.c.request('oauth/disconnect','POST',{'csrf':self.c.csrf('account')});self.assertEqual(self.rpc(t['access_token'],'tools/list')[0],401)
  self.c=Client(self.port);p=self.authorize();t=self.token(p)
  with sqlite3.connect(self.private/'state.sqlite') as db:db.execute('UPDATE oauth_links SET expires=0 WHERE access=?',(hashlib.sha256(t['access_token'].encode()).hexdigest(),))
  self.assertEqual(self.rpc(t['access_token'],'tools/list')[0],401)
 def test_06_invalid_registration_and_origin(self):
  r=self.c.request('oauth/register','POST',json.dumps({'redirect_uris':['https://attacker.example/callback']}),{'Content-Type':'application/json'});self.assertEqual(r[0],400)
  t=self.token(self.authorize());self.assertEqual(self.rpc(t['access_token'],'tools/list',extra={'Origin':'https://attacker.example'})[0],403)
 def test_07_dates_and_write_tools_fail_closed(self):
  t=self.token(self.authorize());r=self.rpc(t['access_token'],'tools/call',{'name':'get_financial_summary','arguments':{'from':'2026-08-04','to':'2026-09-01'}});self.assertTrue(json.loads(r[1])['result']['isError'])
  r=self.rpc(t['access_token'],'tools/call',{'name':'change_costs','arguments':{}});self.assertEqual(json.loads(r[1])['error']['code'],-32602)
 def test_08_real_mcp_sdk(self):
  t=self.token(self.authorize('pim'))
  r=subprocess.run(['node',str(pathlib.Path(__file__).with_name('mcp_client.mjs'))],input=json.dumps({'url':f'http://127.0.0.1:{self.port}'+BASE+'/mcp','token':t['access_token']}),text=True,capture_output=True,timeout=20)
  self.assertEqual(r.returncode,0,r.stderr);self.assertIn('SDK_MCP_VERIFIED',r.stdout)
 def test_09_confidential_client_auth_methods(self):
  for mode in ['client_secret_post','client_secret_basic']:
   self.c=Client(self.port)
   r=self.c.request('oauth/register','POST',json.dumps({'redirect_uris':['https://chatgpt.com/connector_platform_oauth_redirect'],'token_endpoint_auth_method':mode}),{'Content-Type':'application/json'})
   self.assertEqual(r[0],201,r[1]);client=json.loads(r[1]);p=self.authorize(client=client['client_id'])
   self.assertEqual(self.c.request('oauth/token','POST',p)[0],401)
   headers={}
   if mode=='client_secret_post':p['client_secret']=client['client_secret']
   else:headers['Authorization']='Basic '+base64.b64encode((client['client_id']+':'+client['client_secret']).encode()).decode()
   r=self.c.request('oauth/token','POST',p,headers);self.assertEqual(r[0],200,r[1]);token=json.loads(r[1])
   self.assertEqual(self.rpc(token['access_token'],'tools/list')[0],200)
 def test_10_shared_model_matches_node(self):
  self.c=Client(self.port);t=self.token(self.authorize());args={'from':'2026-09-01','to':'2026-09-30','channels':['all','meta','google','infl']}
  actual=json.loads(self.rpc(t['access_token'],'tools/call',{'name':'get_financial_summary','arguments':args})[1])['result']['structuredContent']['result']['channels']
  names={'data/meta.json':'meta','data/google.json':'google','data/shopify.json':'shopify','data/creators.json':'creators','data/returns.json':'returns','data/status.json':'status','assets/blended/costs.json':'costs'}
  with sqlite3.connect(self.private/'state.sqlite') as db:datasets={names[path]:json.loads(content) for path,content in db.execute('SELECT path,content FROM datasets')}
  model=next((self.private/'releases').glob('*/static/assets/blended/mcp-model.js')) if (self.private/'releases').exists() else self.private/'static/assets/blended/mcp-model.js'
  js="const fs=require('fs'),vm=require('vm');const input=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{__input:input}));"
  r=subprocess.run(['node','-e',js,str(model)],input=json.dumps({'name':'get_financial_summary','args':args,'datasets':datasets,'versions':{},'today':'2026-10-02','user':'pim'}),capture_output=True,text=True,timeout=20);self.assertEqual(r.returncode,0,r.stderr)
  expected=json.loads(r.stdout)['result']['channels']
  for channel in expected:
   for key in ['revenue','result','actualResult','spend','cost','fees','overhead','profitMargin']:
    if expected[channel][key] is None:self.assertIsNone(actual[channel][key])
    else:self.assertAlmostEqual(actual[channel][key],expected[channel][key],places=7,msg=f'{channel} {key}')
 def test_11_public_discovery_materialization_is_metadata_only(self):
  import tempfile,pathlib,subprocess
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'private').mkdir();(root/'public').mkdir()
   php="<?php define('LW_PRIVATE',"+repr(str(root/'private'))+");$origin='https://cijfers.lumeworks.nl';$base='';require "+repr(str(security_tests.ROOT/'siteground/private/mcp.php'))+";echo json_encode([mcpProvisionDiscovery("+repr(str(root/'public'))+"),mcpAuthorizationMetadata()]);"
   script=root/'test.php';script.write_text(php)
   result=json.loads(subprocess.check_output([security_tests.PHP,str(script)],text=True));self.assertTrue(result[0]);file=root/'public/.well-known/oauth-authorization-server/oauth';self.assertEqual(json.loads(file.read_text()),result[1]);self.assertNotIn('password',file.read_text());self.assertNotIn('access_token',file.read_text());self.assertNotIn('daily_meta',file.read_text());self.assertEqual(file.stat().st_mode&0o777,0o644)
   self.assertTrue(json.loads(subprocess.check_output([security_tests.PHP,str(script)],text=True))[0])
   file.write_text('foreign metadata');self.assertFalse(json.loads(subprocess.check_output([security_tests.PHP,str(script)],text=True))[0]);self.assertEqual(file.read_text(),'foreign metadata')
 def test_12_full_history_four_channel_trend(self):
  t=self.token(self.authorize('pim'))
  r=self.rpc(t['access_token'],'tools/call',{'name':'get_financial_trend','arguments':{'from':'2026-08-05','to':'2026-10-01','channels':['all','meta','google','infl'],'granularity':'day'}})
  self.assertEqual(r[0],200);answer=json.loads(r[1])['result'];self.assertFalse(answer['isError'],str(answer)[:500]);channels=answer['structuredContent']['result']['channels'];self.assertEqual(set(channels),{'all','meta','google','infl'});self.assertTrue(all(len(rows)==58 for rows in channels.values()))
 def test_13_preview_scenario_is_read_only_and_reconciles(self):
  t=self.token(self.authorize('pim'));args={'from':'2026-09-01','to':'2026-09-30','monthly_fixed':500}
  a=json.loads(self.rpc(t['access_token'],'tools/call',{'name':'get_meta_test_review','arguments':args})[1])['result'];self.assertFalse(a['isError']);r=a['structuredContent']['result'];self.assertTrue(r['contract_unchanged']);self.assertEqual(r['contract']['monthly_fixed'],1500);self.assertEqual(r['scenario']['monthlyFixed'],500);self.assertAlmostEqual(r['scenario']['fixed'],500,places=7);self.assertAlmostEqual(sum(row['companyProfit'] for row in r['daily']),r['scenario']['companyProfit'],places=7)
  current=json.loads(self.rpc(t['access_token'],'tools/call',{'name':'get_financial_summary','arguments':{'from':args['from'],'to':args['to'],'channel':'meta'}})[1])['result']['structuredContent']['result']['channels']['meta'];self.assertAlmostEqual(current['management']['fixed'],1500,places=7)
if __name__=='__main__':unittest.main(verbosity=2)
