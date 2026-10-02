#!/usr/bin/env python3
import sys,time,urllib.request,urllib.error
origin='https://cijfers.lumeworks.nl'
def get(path):
    try:
        with urllib.request.urlopen(origin+path,timeout=30) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def verify(revision):
    # Give the newly activated code a short, bounded interval to become visible.
    # Never accept an old revision, an error page or an unprotected data route.
    for attempt in range(6):
        code,headers,body=get('/login')
        actual=headers.get('X-LumeWorks-Revision')
        if code==200 and actual==revision:break
        print(f'Login check: HTTP {code}; revision {actual or "missing"}; attempt {attempt+1}/6',flush=True)
        if attempt<5:time.sleep(2)
    assert code==200 and actual==revision,'Login/revision check failed'
    assert b'name="password"' in body and b'<title>LumeWorks</title>' in body,'Login markup failed'
    for path in ['/data/meta.json','/data/shopify.json','/assets/blended/app.js']:
        assert get(path)[0]==401,'Anonymous data protection failed'
    for path in ['/login.css','/login.js','/manifest.webmanifest']:
        assert get(path)[0]==200,'Public login asset missing'
if __name__=='__main__':verify(sys.argv[1]);print('HTTPS, deployed revision, login assets and anonymous protection verified')
