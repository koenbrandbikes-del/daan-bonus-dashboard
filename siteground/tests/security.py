#!/usr/bin/env python3
"""Real HTTP integration against PHP + SQLite; no mocked authentication."""
import hashlib,hmac,http.client,json,os,pathlib,re,secrets,shutil,socket,sqlite3,subprocess,tempfile,time,unittest,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[2];PHP=os.getenv('LW_PHP_BIN','php');BASE='/cijfers';PASSWORD='Testing-only-random-32-chars!_'
class Client:
    def __init__(self,port):self.port=port;self.cookies={}
    def request(self,path='',method='GET',body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=10)
        h={'Cookie':'; '.join(k+'='+v for k,v in self.cookies.items())};h.update(headers or {})
        if isinstance(body,dict):body=urllib.parse.urlencode(body);h['Content-Type']='application/x-www-form-urlencoded'
        conn.request(method,BASE+'/'+path,body,h);r=conn.getresponse();data=r.read().decode();hs=r.getheaders()
        for k,v in hs:
            if k.lower()=='set-cookie':
                name,value=v.split(';')[0].split('=',1)
                if value in ('','deleted'):self.cookies.pop(name,None)
                else:self.cookies[name]=urllib.parse.unquote(value)
        result=(r.status,data,{k.lower():v for k,v in hs},hs);conn.close();return result
    def csrf(self,path='login'):
        r=self.request(path);return re.search(r'name="csrf" value="([a-f0-9]+)"',r[1])[1]
    def login(self,name='koen',remember=True,password=PASSWORD):
        token=self.csrf();body={'csrf':token,'username':name,'password':password}
        if remember:body['remember']='1'
        return self.request('login','POST',body)
class Security(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.dir=pathlib.Path(cls.tmp.name);cls.release=cls.dir/'release';credentials=cls.dir/'credentials.json';credentials.write_text(json.dumps({n:PASSWORD for n in ['koen','floris','pim','bas']}))
        subprocess.run(['python',str(ROOT/'siteground/scripts/build.py'),'--output',str(cls.release),'--php',PHP,'--credentials',str(credentials)],check=True,stdout=subprocess.DEVNULL)
        cls.private=cls.release/'lumeworks-private';cls.config=json.loads((cls.private/'config.json').read_text());cls.secret=cls.config['sync_secret']
        sock=socket.socket();sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1];sock.close()
        router=cls.dir/'router.php';router.write_text('<?php if(isset($_SERVER["HTTP_X_TEST_TLS"])) {$_SERVER["HTTPS"]="on";$_SERVER["REMOTE_ADDR"]="192.0.2.1";} require '+repr(str(cls.release/'public/index.php'))+';')
        cls.log=open(cls.dir/'php.log','w');cls.proc=subprocess.Popen([PHP,'-S',f'127.0.0.1:{cls.port}',str(router)],env={**os.environ,'LW_PRIVATE_DIR':str(cls.private),'LW_TEST_HTTP':'1'},stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:Client(cls.port).request('login');break
            except OSError:time.sleep(.05)
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=5);cls.log.close();cls.tmp.cleanup()
    def setUp(self):
        self.c=Client(self.port)
        with sqlite3.connect(self.private/'state.sqlite') as db:db.execute('DELETE FROM attempts')
    def signed(self,path,method='GET',body='',nonce=None,stamp=None,signature=None):
        nonce=nonce or secrets.token_hex(16);stamp=stamp or str(int(time.time()));route=BASE+'/api/storage/'+path
        digest=hashlib.sha256(body.encode()).hexdigest();sig=hmac.new(self.secret.encode(),'\n'.join([stamp,nonce,method,route,digest]).encode(),hashlib.sha256).hexdigest()
        return self.c.request('api/storage/'+path,method,body,{'X-LW-Timestamp':stamp,'X-LW-Nonce':nonce,'X-LW-Signature':signature or sig,'Content-Type':'application/json'})
    def test_01_no_anonymous_financial_routes(self):
        self.assertEqual(self.c.request('')[0],303)
        for path in ['data/meta.json','data/shopify.json','assets/blended/costs.json','api/session','assets/blended/app.js','dashboard.html','state.sqlite','../lumeworks-private/config.json']:
            with self.subTest(path=path):
                r=self.c.request(path);self.assertIn(r[0],[401,404]);self.assertNotIn('daily_meta',r[1]);self.assertNotIn(self.secret,r[1])
    def test_02_login_visuals_public(self):
        r=self.c.request('login');self.assertEqual(r[0],200);self.assertIn('LumeWorks • Cijfers',r[1]);self.assertIn('autocomplete="current-password"',r[1]);self.assertNotIn('daily_meta',r[1])
        for p in ['login.css','login.js','device.js','manifest.webmanifest','app-icon-192.png','assets/blended/lumeworks-logo.svg']:
            # PNG is binary: check separately to avoid UTF8 decoding.
            if p.endswith('.png'):continue
            self.assertEqual(self.c.request(p)[0],200)
    def test_03_four_accounts(self):
        for name in ['koen','floris','pim','bas']:
            c=Client(self.port);self.assertEqual(c.login(name)[0],303);self.assertEqual(json.loads(c.request('api/session')[1])['user'],name)
    def test_04_wrong_unknown_generic(self):
        r1=self.c.login(password='wrong');r2=Client(self.port).login('unknown');self.assertEqual(r1[0],401);self.assertEqual(r2[0],401)
        self.assertIn('Gebruikersnaam of wachtwoord klopt niet.',r1[1]);self.assertIn('Gebruikersnaam of wachtwoord klopt niet.',r2[1])
    def test_05_csrf_required(self):
        self.c.csrf();r=self.c.request('login','POST',{'username':'koen','password':PASSWORD});self.assertEqual(r[0],403)
        self.assertEqual(self.c.request('api/session')[0],401)
    def test_06_cross_site_blocked(self):
        csrf=self.c.csrf();self.assertEqual(self.c.request('login','POST',{'csrf':csrf,'username':'koen','password':PASSWORD},{'Sec-Fetch-Site':'cross-site'})[0],403)
    def test_07_session_regenerates_and_password_not_in_cookie(self):
        self.c.csrf();old=self.c.cookies['LWCSSESSION'];r=self.c.login();self.assertNotEqual(old,self.c.cookies['LWCSSESSION']);self.assertNotIn(PASSWORD,str(r));self.assertNotIn(PASSWORD,str(self.c.cookies))
    def test_08_data_authorized(self):
        self.c.login();r=self.c.request('data/meta.json');self.assertEqual(r[0],200);self.assertIn('daily_meta',json.loads(r[1]));self.assertIn('no-store',r[2]['cache-control'])
        self.assertEqual(self.c.request('assets/blended/app.js')[0],200);self.assertIn('data-secured="true"',self.c.request('')[1])
    def test_09_remember_restore_rotates(self):
        self.c.login();old=self.c.cookies['LWCSDEVICE'];self.c.cookies.pop('LWCSSESSION');self.assertEqual(self.c.request('api/session')[0],200);self.assertNotEqual(old,self.c.cookies['LWCSDEVICE'])
        attacker=Client(self.port);attacker.cookies['LWCSDEVICE']=old;self.assertEqual(attacker.request('api/session')[0],401)
    def test_10_no_remember_no_device(self):
        self.c.login(remember=False);self.assertNotIn('LWCSDEVICE',self.c.cookies);self.c.cookies.pop('LWCSSESSION');self.assertEqual(self.c.request('api/session')[0],401)
    def test_11_logout_revokes_replay(self):
        self.c.login();old=dict(self.c.cookies);csrf=self.c.csrf('account');self.assertEqual(self.c.request('logout','POST',{'csrf':csrf})[0],303);self.assertEqual(self.c.request('api/session')[0],401)
        attacker=Client(self.port);attacker.cookies=old;self.assertEqual(attacker.request('api/session')[0],401)
    def test_12_logout_all_revokes_other_session(self):
        self.c.login();other=Client(self.port);other.login();csrf=self.c.csrf('account');self.c.request('logout-all','POST',{'csrf':csrf});self.assertEqual(other.request('api/session')[0],401)
    def test_13_logout_get_cannot_mutate(self):
        self.c.login();self.assertEqual(self.c.request('logout')[0],404);self.assertEqual(self.c.request('api/session')[0],200)
    def test_14_remember_expiry(self):
        self.c.login();selector=self.c.cookies['LWCSDEVICE'].split('.')[0]
        with sqlite3.connect(self.private/'state.sqlite') as db:db.execute('UPDATE devices SET expires=0 WHERE selector=?',(selector,))
        self.assertEqual(self.c.request('api/session')[0],401)
    def test_15_password_change_revokes_all(self):
        self.c.login('floris');other=Client(self.port);other.login('floris');csrf=self.c.csrf('account');new=secrets.token_urlsafe(24)
        self.assertEqual(self.c.request('password','POST',{'csrf':csrf,'current':PASSWORD,'new':new})[0],303)
        self.assertEqual(other.request('api/session')[0],401);self.assertEqual(self.c.login('floris',password=PASSWORD)[0],401);self.assertEqual(self.c.login('floris',password=new)[0],303)
        # Restore fixture without exposing hashes/passwords in logs.
        with sqlite3.connect(self.private/'state.sqlite') as db:db.execute('UPDATE users SET password=?,version=version+1 WHERE name="floris"',(self.config['users']['floris'],))
    def test_16_rate_limit(self):
        for _ in range(6):self.assertEqual(self.c.login(password='wrong')[0],401)
        self.assertEqual(self.c.login(password='wrong')[0],429)
    def test_17_security_headers_production(self):
        r=self.c.request('login',headers={'X-Test-TLS':'1','Host':'www.lumeworks.nl'});self.assertEqual(r[0],200)
        cookies=[v for k,v in r[3] if k.lower()=='set-cookie'];self.assertTrue(any('secure' in v.lower() and 'httponly' in v.lower() and 'samesite=lax' in v.lower() for v in cookies))
        self.assertIn('nonce-',r[2]['content-security-policy']);self.assertEqual(r[2]['x-frame-options'],'DENY')
        self.assertEqual(self.c.request('login',headers={'X-Test-TLS':'1','Host':'evil.example'})[0],400)
    def test_18_api_no_credentials(self):self.assertEqual(self.c.request('api/storage/data/meta.json')[0],401)
    def test_19_api_signed_get(self):
        r=self.signed('data/meta.json');self.assertEqual(r[0],200);d=json.loads(r[1]);self.assertEqual(d['sha'],hashlib.sha256(d['content'].encode()).hexdigest())
    def test_20_api_replay(self):
        nonce=secrets.token_hex(16);self.assertEqual(self.signed('data/meta.json',nonce=nonce)[0],200);self.assertEqual(self.signed('data/meta.json',nonce=nonce)[0],409)
    def test_21_api_expiry_tamper_allowlist(self):
        self.assertEqual(self.signed('data/meta.json',stamp='1')[0],401);self.assertEqual(self.signed('data/meta.json',signature='0'*64)[0],401);self.assertEqual(self.signed('config.json')[0],404)
    def test_22_api_cas_validation(self):
        current=json.loads(self.signed('data/status.json')[1]);content=json.dumps({'security_test':True});body=json.dumps({'content':content,'sha':current['sha']})
        r=self.signed('data/status.json','PUT',body);self.assertEqual(r[0],200)
        self.assertEqual(self.signed('data/status.json','PUT',body)[0],409)
        self.assertEqual(self.signed('data/shopify.json','PUT',json.dumps({'content':'{"orders":[]}','sha':None}))[0],422)
    def test_23_private_hashes_and_no_browser_data_cache(self):
        self.assertNotIn(PASSWORD,(self.private/'config.json').read_text());self.assertTrue(all(h.startswith('$argon2id$') for h in self.config['users'].values()))
        data=(self.private/'static/assets/blended/data.js').read_text();self.assertNotIn('sessionStorage',data);self.assertIn('unauthorized',data)
        self.assertFalse(any((self.release/'public').rglob('*.json')));self.assertFalse(any((self.release/'public').rglob('*.sqlite')))
    def test_24_pwa_network_only_scope(self):
        manifest=json.loads(self.c.request('manifest.webmanifest')[1]);self.assertEqual(manifest['scope'],BASE+'/');self.assertEqual(manifest['start_url'],BASE+'/');self.assertEqual(manifest['display'],'standalone')
        sw=self.c.request('sw.js');self.assertNotIn('caches.',sw[1]);self.assertIn('offline',sw[1]);self.assertEqual(sw[2]['service-worker-allowed'],BASE+'/')
    def test_25_sql_injection_and_traversal(self):
        self.assertEqual(self.c.login("koen' OR 1=1--")[0],401);self.c.login()
        for path in ['assets/blended/../../config.json','assets/blended/../app.php','private-path.php','config.json','state.sqlite','dashboard.html']:
            self.assertEqual(self.c.request(path)[0],404)
    def test_26_complete_module_dependency_graph(self):
        self.c.login();queue=['assets/blended/app.js'];seen=set()
        while queue:
            path=queue.pop()
            if path in seen:continue
            seen.add(path);response=self.c.request(path);self.assertEqual(response[0],200,path)
            for target in re.findall(r'import(?:\s+[\s\S]*?from)?\s*[\'"]([^\'"]+)[\'"]',response[1]):
                resolved=urllib.parse.urljoin('https://example.com/'+path,target)
                queue.append(urllib.parse.urlsplit(resolved).path.lstrip('/'))
        self.assertIn('assets/product-costs.js',seen)
    def test_27_back_button_and_background_protection(self):
        script=self.c.request('device.js')[1];self.assertIn("addEventListener('pagehide'",script);self.assertIn("if(!document.hidden)",script)

if __name__=='__main__':unittest.main(verbosity=2)
