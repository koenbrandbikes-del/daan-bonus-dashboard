"""Read the existing CSV-shaped inputs through authenticated, read-only Sheets API."""
import csv,io,json,os,re,urllib.parse,urllib.request
_credentials=None
_titles={}
def credentials():
    global _credentials
    if _credentials is None:
        raw=os.environ.get('LW_SHEETS_SERVICE_ACCOUNT')
        if not raw:raise RuntimeError('Private Sheets credentials missing; public export fallback is disabled')
        from google.oauth2 import service_account
        _credentials=service_account.Credentials.from_service_account_info(json.loads(raw),scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    if not _credentials.valid:
        from google.auth.transport.requests import Request
        _credentials.refresh(Request())
    return _credentials
def api(path):
    req=urllib.request.Request('https://sheets.googleapis.com/v4/'+path,headers={'Authorization':'Bearer '+credentials().token})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def fetch_csv(url):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname!='docs.google.com':raise ValueError('Only configured Google Sheets inputs are supported')
    match=re.fullmatch(r'/spreadsheets/d/([A-Za-z0-9_-]+)/export',parsed.path)
    gid=urllib.parse.parse_qs(parsed.query).get('gid',[''])[0]
    if not match or not gid.isdigit():raise ValueError('Invalid sheet input')
    spreadsheet=match[1]
    if spreadsheet not in _titles:
        metadata=api('spreadsheets/'+spreadsheet+'?fields=sheets.properties')
        _titles[spreadsheet]={str(s['properties']['sheetId']):s['properties']['title'] for s in metadata['sheets']}
    title=_titles[spreadsheet].get(gid)
    if title is None:raise ValueError('Configured sheet tab is missing')
    range_name="'"+title.replace("'","''")+"'"
    result=api('spreadsheets/'+spreadsheet+'/values/'+urllib.parse.quote(range_name,safe='')+'?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE')
    rows=result.get('values',[])
    if not rows:raise ValueError('Private sheet is empty; existing dashboard data must be retained')
    out=io.StringIO();csv.writer(out,lineterminator='\n').writerows(rows);return out.getvalue()
