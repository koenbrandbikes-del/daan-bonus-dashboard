#!/usr/bin/env python3
import csv,io,importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
class Producers(unittest.TestCase):
    def test_csv_transport_preserves_formatted_financial_values_and_tab_identity(self):
        m=load('private_sheets','siteground/scripts/private_sheets.py');requests=[]
        def api(path):
            requests.append(path)
            if 'fields=' in path:return {'sheets':[{'properties':{'sheetId':42,'title':"Floris' kosten"}}]}
            return {'values':[['Creator','Kosten','Datum'],['Floris','€1.234,56','05-08-2026'],['Pim, Bas','€0,00','']]}
        m.api=api;result=m.fetch_csv('https://docs.google.com/spreadsheets/d/example_ID/export?format=csv&gid=42')
        self.assertEqual(list(csv.reader(io.StringIO(result)))[1],['Floris','€1.234,56','05-08-2026'])
        self.assertIn('%27Floris%27%27%20kosten%27',requests[1]);self.assertIn('FORMATTED_VALUE',requests[1])
        m.fetch_csv('https://docs.google.com/spreadsheets/d/example_ID/export?gid=42');self.assertEqual(len(requests),3)
    def test_no_public_fallback_missing_credentials(self):
        m=load('private_sheets','siteground/scripts/private_sheets.py')
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(RuntimeError,'fallback is disabled'):m.credentials()
    def test_unknown_tabs_empty_rows_untrusted_url_blocked(self):
        m=load('private_sheets','siteground/scripts/private_sheets.py');m.api=lambda path:{'sheets':[{'properties':{'sheetId':1,'title':'Known'}}]} if 'fields=' in path else {'values':[]}
        for url in ['https://evil.example/spreadsheets/d/id/export?gid=1','https://docs.google.com/spreadsheets/d/id/export?gid=2','https://docs.google.com/spreadsheets/d/id/export?gid=1']:
            with self.subTest(url=url),self.assertRaises(ValueError):m.fetch_csv(url)
    def test_uploader_requires_pre_generation_revision(self):
        m=load('uploader','siteground/scripts/upload_data.py')
        with patch('sys.argv',['upload']),self.assertRaisesRegex(RuntimeError,'BEFORE'):m.main()
    def test_pull_capture_then_conflict_uses_original_revision(self):
        m=load('uploader','siteground/scripts/upload_data.py');calls=[]
        with tempfile.TemporaryDirectory() as root:
            path=pathlib.Path(root)/'data/status.json';rev=pathlib.Path(root)/'revisions.json'
            m.request=lambda *a,**k:{'content':'{"status":"original"}','sha':'old'}
            with patch('sys.argv',['upload','--root',root,'--paths','data/status.json','--capture',str(rev),'--pull']):m.main()
            self.assertEqual(json.loads(path.read_text())['status'],'original');path.write_text('{"status":"new"}')
            def request(path,method='GET',payload=None):
                if method=='GET':return {'sha':'concurrent','content':'{}'}
                calls.append(payload);raise RuntimeError('HTTP 409')
            m.request=request
            with patch('sys.argv',['upload','--root',root,'--paths','data/status.json','--expected-revisions',str(rev)]),self.assertRaisesRegex(RuntimeError,'409'):m.main()
            self.assertEqual(calls[0]['sha'],'old')
if __name__=='__main__':unittest.main(verbosity=2)
