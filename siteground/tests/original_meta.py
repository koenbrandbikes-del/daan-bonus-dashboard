"""Real login, financial-data protection and original single-dashboard rendering."""
import re, unittest
import security as auth

class OriginalMeta(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if auth.BASE != '': raise RuntimeError('Run with LW_TEST_BASE empty')
  auth.Security.setUpClass()
  router=auth.Security.dir/'router.php'
  router.write_text(router.read_text().replace('<?php','<?php define("LW_ORIGINAL_META",true);',1))
 @classmethod
 def tearDownClass(cls):auth.Security.tearDownClass()
 def test_anonymous_cannot_read_original_or_financial_sources(self):
  c=auth.Client(auth.Security.port)
  self.assertEqual(c.request('')[0],303)
  for path in ['data/meta.json','data/google.json','data/shopify.json','assets/product-costs.js']:
   self.assertEqual(c.request(path)[0],401)
 def test_original_dashboard_with_existing_accounts_and_strict_csp(self):
  for name in ['koen','floris','pim','bas']:
   c=auth.Client(auth.Security.port);self.assertEqual(c.login(name)[0],303)
   status,html,headers,_=c.request('')
   self.assertEqual(status,200)
   self.assertIn('Daan · Meta Bonusdashboard',html)
   self.assertIn('Bonussimulator',html)
   self.assertIn('Orderdetail',html)
   self.assertNotIn('href="meta-test"',html)
   self.assertNotIn('href="daan-test"',html)
   self.assertNotIn('daily_meta":',html)
   nonce=re.search(r"script-src 'self' 'nonce-([^']+)'",headers['content-security-policy'])[1]
   self.assertIn('nonce="'+nonce+'"',html)
   self.assertNotIn("script-src 'self' 'unsafe-inline'",headers['content-security-policy'])
   self.assertIn('no-store',headers['cache-control'])
   self.assertEqual(c.request('data/meta.json')[0],200)
   self.assertNotIn('Beveiligde testdashboards',c.request('account')[1])
   self.assertEqual(c.request('meta-test')[0],404)
   self.assertEqual(c.request('daan-test')[0],404)
if __name__=='__main__':unittest.main(verbosity=2)
