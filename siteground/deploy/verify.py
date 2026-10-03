#!/usr/bin/env python3
import sys,time,subprocess,tempfile,pathlib,email,json,re,html
origin='https://cijfers.lumeworks.nl'
def get(path):
    # Use the standard curl HTTPS client; SiteGround rejects urllib requests.
    # Certificate/hostname validation remains enabled, without cookies or credentials.
    with tempfile.TemporaryDirectory() as work:
        headers=pathlib.Path(work)/'headers';body=pathlib.Path(work)/'body'
        result=subprocess.run(['curl','--silent','--show-error','--location','--max-redirs','3','--connect-timeout','15','--max-time','30','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',origin+path],check=True,capture_output=True,text=True)
        blocks=headers.read_text().strip().split('\n\n');last=blocks[-1].split('\n',1)[1]
        return int(result.stdout),email.message_from_string(last),body.read_bytes()
def verify(revision):
    # Give the newly activated code a short, bounded interval to become visible.
    # Never accept an old revision, an error page or an unprotected data route.
    for attempt in range(6):
        code,headers,body=get('/login')
        actual=headers.get('X-LumeWorks-Revision')
        if code==200 and actual==revision:break
        print(f'Login check: HTTP {code}; revision {actual or "missing"}; attempt {attempt+1}/6',flush=True)
        if code==202 and attempt==0:
            title=re.search(r'<title[^>]*>(.*?)</title>',body.decode('utf-8',errors='replace'),re.I|re.S)
            if title:
                hint=' '.join(html.unescape(title[1]).split())[:100]
                print('Unexpected response title: '+hint,flush=True)
        if attempt<5:
            # Retry transient upstream responses normally, without bypassing challenges.
            retry=headers.get('Retry-After','')
            delay=min(30,max(2,int(retry))) if retry.isdigit() else (10 if code in (202,429,503) else 2)
            time.sleep(delay)
    assert code==200 and actual==revision,'Login/revision check failed'
    assert b'name="password"' in body and b'<title>LumeWorks</title>' in body,'Login markup failed'
    for path in ['/data/meta.json','/data/shopify.json','/assets/blended/app.js']:
        assert get(path)[0]==401,'Anonymous data protection failed'
    for path in ['/login.css','/login.js','/manifest.webmanifest']:
        assert get(path)[0]==200,'Public login asset missing'
    code,headers,body=get('/mcp')
    assert code==401 and 'resource_metadata=' in headers.get('WWW-Authenticate',''),'MCP authentication challenge failed'
    code,headers,body=get('/oauth/resource')
    assert code==200,f'MCP metadata unavailable: HTTP {code}; response {body[:160]!r}'
    metadata=json.loads(body)
    assert metadata['resource']==origin+'/mcp' and metadata.get('engine_ready') is True,'MCP calculation engine failed'
    code,headers,body=get('/oauth/.well-known/oauth-authorization-server')
    assert code==200,'OAuth discovery unavailable'
    auth=json.loads(body)
    assert auth['authorization_endpoint']==origin+'/oauth/authorize' and 'S256' in auth['code_challenge_methods_supported'],'OAuth configuration failed'
    # Verify standard discovery, not just a custom metadata endpoint.
    code,headers,body=get('/.well-known/oauth-authorization-server/oauth')
    assert code==200,f'MCP standard OAuth discovery unavailable: HTTP {code}'
    discovery=json.loads(body)
    assert discovery['issuer']==origin+'/oauth' and discovery['authorization_endpoint']==origin+'/oauth/authorize','OAuth issuer mismatch'
    assert 'S256' in discovery['code_challenge_methods_supported'] and 'authorization_code' in discovery['grant_types_supported'],'OAuth standard discovery incomplete'
    print('MCP standard OAuth discovery verified',flush=True)
    for path in ['/meta-test','/daan-test']:
        code,headers,body=get(path)
        assert code==200 and b'name="password"' in body and b'daily_meta' not in body,'Test dashboard anonymous protection failed'
if __name__=='__main__':verify(sys.argv[1]);print('HTTPS, revision, login, anonymous protection, OAuth configuration and live MCP calculation engine verified; standard discovery verified')
