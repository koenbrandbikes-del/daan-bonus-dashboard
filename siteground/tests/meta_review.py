"""Authenticated preview routes using real PHP sessions and release layout."""
import unittest
import security as auth
class Preview(unittest.TestCase):
 @classmethod
 def setUpClass(cls):auth.Security.setUpClass()
 @classmethod
 def tearDownClass(cls):auth.Security.tearDownClass()
 def test_anonymous_preview_and_modules_are_protected(self):
  c=auth.Client(auth.Security.port)
  for route in ['meta-test','daan-test']:
   status,body,headers,_=c.request(route);self.assertEqual(status,303);self.assertTrue(headers['location'].endswith('/login'));self.assertNotIn('daily_meta',body)
  for route in ['meta-review.js','meta-review-app.js','meta-review.css']:self.assertEqual(c.request('assets/blended/'+route)[0],401)
 def test_preview_return_after_login_and_all_four_accounts(self):
  for name in ['koen','floris','pim','bas']:
   c=auth.Client(auth.Security.port);c.request('daan-test');r=c.login(name);self.assertTrue(r[2]['location'].endswith('/daan-test'))
   for route in ['meta-test','daan-test']:
    r=c.request(route);self.assertEqual(r[0],200);self.assertIn('data-secured="true"',r[1]);self.assertIn('session-hidden',r[1]);self.assertIn('meta-review-app.js',r[1]);self.assertIn('no-store',r[2]['cache-control']);self.assertNotIn('daily_meta',r[1])
   self.assertEqual(c.request('assets/blended/meta-review.js')[0],200)
 def test_original_dashboard_and_contract_unchanged(self):
  c=auth.Client(auth.Security.port);c.login();self.assertIn('data-secured="true"',c.request('')[1]);self.assertIn('meta-test',c.request('account')[1]);self.assertEqual(c.request('data/meta.json')[0],200)
if __name__=='__main__':unittest.main(verbosity=2)
