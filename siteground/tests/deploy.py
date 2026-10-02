#!/usr/bin/env python3
import base64,copy,hashlib,json,os,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'siteground/deploy'))
from bundle import bundle
PHP=os.getenv('LW_PHP_BIN','php')
class Deploy(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.package=bundle('a'*40)
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=pathlib.Path(self.tmp.name)
  (self.p/'deploy-server.php').write_bytes((ROOT/'siteground/deploy/server.php').read_bytes())
  (self.p/'releases'/'bootstrap-1234567890abcdef').mkdir(parents=True)
  (self.p/'current-release.txt').write_text('bootstrap-1234567890abcdef')
  for n in ['config.json','state.sqlite','sessions']:(self.p/n).write_text('KEEP-'+n)
 def tearDown(self):self.tmp.cleanup()
 def runPackage(self,m):return subprocess.run([PHP,str(self.p/'deploy-server.php')],input=json.dumps(m),text=True,capture_output=True)
 def test_code_only_and_private_state_preserved(self):
  self.assertFalse(any('config.json' in n or 'state.sqlite' in n or n.endswith('.json') for n in self.package['files']))
  self.assertEqual(self.runPackage(self.package).returncode,0)
  app=(self.p/'releases'/('a'*40)/'app.php').read_text()
  self.assertIn("LW_PRIVATE.'/state.sqlite'",app);self.assertIn("LW_CODE.'/static/'",app)
  for n in ['config.json','state.sqlite','sessions']:self.assertEqual((self.p/n).read_text(),'KEEP-'+n)
 def test_bad_hash_never_activates(self):
  m=copy.deepcopy(self.package);m['files']['login.php']['sha256']='0'*64
  self.assertNotEqual(self.runPackage(m).returncode,0);self.assertTrue((self.p/'current-release.txt').read_text().startswith('bootstrap-'))
 def test_traversal_and_financial_upload_denied(self):
  for name in ['../outside.php','config.json','state.sqlite','static/assets/blended/costs.json']:
   m=copy.deepcopy(self.package);m['files'][name]={'data':'eA==','sha256':hashlib.sha256(b'x').hexdigest()}
   self.assertNotEqual(self.runPackage(m).returncode,0)
 def test_invalid_php_never_activates(self):
  m=copy.deepcopy(self.package);b=b'<?php syntax !!!';m['files']['app.php']={'data':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest()}
  self.assertNotEqual(self.runPackage(m).returncode,0)
 def test_atomic_switch_rollback_and_stale_request(self):
  self.assertEqual(self.runPackage(self.package).returncode,0)
  self.assertNotEqual(self.runPackage({'action':'rollback','revision':'b'*40}).returncode,0)
  self.assertEqual((self.p/'current-release.txt').read_text(),'a'*40)
  self.assertEqual(self.runPackage({'action':'rollback','revision':'a'*40}).returncode,0)
  self.assertTrue((self.p/'current-release.txt').read_text().startswith('bootstrap-'))
 def test_incomplete_release_denied(self):
  m=copy.deepcopy(self.package);del m['files']['static/device.js'];self.assertNotEqual(self.runPackage(m).returncode,0)
 def test_private_data_sync_and_database_backup(self):
  import sqlite3
  from data_bundle import bundle as data_bundle,PATHS
  dbpath=self.p/'state.sqlite';dbpath.unlink();db=sqlite3.connect(dbpath)
  db.execute('CREATE TABLE datasets(path TEXT PRIMARY KEY,content TEXT,sha TEXT,updated INTEGER)')
  db.execute('CREATE TABLE users(name TEXT,password_hash TEXT)');db.execute("INSERT INTO users VALUES('koen','KEEP-HASH')")
  versions={}
  for path in PATHS:
   b='{"old":true}';sha=hashlib.sha256(b.encode()).hexdigest();versions[path]={'sha':sha};db.execute('INSERT INTO datasets VALUES(?,?,?,?)',(path,b,sha,1))
  db.commit();db.close()
  payload=data_bundle('a'*40,versions)
  self.assertEqual(self.runPackage(payload).returncode,0)
  db=sqlite3.connect(dbpath);self.assertEqual(db.execute('SELECT password_hash FROM users').fetchone()[0],'KEEP-HASH')
  for path,item in payload['files'].items():self.assertEqual(db.execute('SELECT sha FROM datasets WHERE path=?',(path,)).fetchone()[0],item['sha256'])
  db.close();self.assertEqual(len(list((self.p/'data-backups').glob('*.sqlite'))),1)
  self.assertNotEqual(self.runPackage(payload).returncode,0) # Original revisions cannot overwrite a newer state.
 def test_financial_data_never_enters_code_bundle(self):
  for name in self.package['files']:self.assertNotIn(name,['data/meta.json','data/google.json','data/shopify.json','assets/blended/costs.json'])

if __name__=='__main__':unittest.main(verbosity=2)
