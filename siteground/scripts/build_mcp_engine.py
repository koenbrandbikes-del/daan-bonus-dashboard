"""Explicit maintenance build of the pinned, static, bounded QuickJS runner.
Run on Linux x86_64 with gcc and glibc static development libraries.
The deployment never downloads or compiles third-party code on SiteGround.
"""
import base64,hashlib,pathlib,platform,subprocess,tarfile,tempfile,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
COMMIT='535a7c250ff4a577ec36c3e103daab6dadeea650'
FILES=['quickjs.c','quickjs.h','quickjs-atom.h','quickjs-opcode.h','dtoa.c','dtoa.h','libregexp.c','libregexp.h','libregexp-opcode.h','libunicode.c','libunicode.h','libunicode-table.h','cutils.c','cutils.h','list.h','LICENSE']
if platform.system()!='Linux' or platform.machine()!='x86_64':raise SystemExit('Build on Linux x86_64.')
with tempfile.TemporaryDirectory() as work:
    work=pathlib.Path(work);archive=work/'source.tar.gz'
    with urllib.request.urlopen('https://codeload.github.com/bellard/quickjs/tar.gz/'+COMMIT,timeout=30) as r:archive.write_bytes(r.read(16*1024*1024))
    with tarfile.open(archive) as tar:
        for name in FILES:
            member=tar.getmember('quickjs-'+COMMIT+'/'+name)
            if not member.isfile() or member.size>4*1024*1024:raise ValueError('Unexpected source')
            (work/name).write_bytes(tar.extractfile(member).read())
    output=work/'engine'
    subprocess.run(['gcc','-static','-Os','-fwrapv','-D_GNU_SOURCE','-DCONFIG_VERSION="2026-10-02"','-I',str(work),str(ROOT/'siteground/scripts/mcp_runner.c'),*[str(work/n) for n in ['quickjs.c','dtoa.c','libregexp.c','libunicode.c','cutils.c']],'-lm','-lpthread','-ldl','-o',str(output)],check=True)
    subprocess.run(['strip',str(output)],check=True)
    data=output.read_bytes()
    (ROOT/'assets/blended/mcp-engine.js').write_text('// sha256:'+hashlib.sha256(data).hexdigest()+'\n'+base64.b64encode(data).decode()+'\n')
    (ROOT/'assets/blended/mcp-license.js').write_text('/*\n'+(work/'LICENSE').read_text()+'\nSource: https://github.com/bellard/quickjs/commit/'+COMMIT+'\n*/\n')
    print('Engine built. Run the full MCP, security and deployment tests before publishing.')
