"""Preserve the original single Meta/bonus dashboard behind the existing login.

Compile inline event handlers into nonce-authorized listeners; never use eval,
unsafe-inline scripts, or public GitHub financial endpoints.
"""
import base64, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]

def dashboard():
    source = (ROOT / 'index.html').read_text()
    # Only the secured Meta build shares the finance/return engine with Cijfers.
    # The public original and contractual bonus calculation remain unchanged.
    engine = []
    for path in ['assets/blended/return-reserve.js', 'assets/blended/metrics.js']:
        part = (ROOT / path).read_text()
        part = re.sub(r'^import[^\n]*\n', '', part, flags=re.M)
        part = re.sub(r'\bexport (?=(?:async )?(?:function|const|let|class))', '', part)
        if path.endswith('metrics.js'):
            part = part.replace('const management=managementCosts(data,costs,from,to);', 'const management=options.skipManagement?{fixed:0,bonus:0,total:0,periods:[],daily:[]}:managementCosts(data,costs,from,to);')
        engine.append(part)
    dynamic = (ROOT / 'siteground/private/dynamic-meta-costs.js').read_text().replace('export function ', 'function ')
    engine.append(dynamic + '\nmanagementCosts=makeDynamicManagement(compute,managementCosts);')
    bridge = (ROOT / 'siteground/private/original-meta-finance.js').read_text()
    source = source.replace('/* ═══ INIT ═', 'const lwFinanceEngine=(()=>{\n' + '\n'.join(engine) + '\nreturn {compute,series};})();\n' + bridge + '\n/* ═══ INIT ═', 1)
    source = source.replace('</head>', '<style>.lw-finance{margin:12px 0 20px;border:1px solid #ffffff1a;border-radius:14px;background:#151b4033}.lw-finance summary{display:flex;justify-content:space-between;gap:16px;cursor:pointer;padding:16px;font-size:13px}.lw-finance summary span{font-variant-numeric:tabular-nums}.lw-finance-body{padding:0 16px 16px}.lw-finance-row{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:8px 0;font-size:12px;border-bottom:1px solid #ffffff08}.lw-finance-row strong{font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}.lw-finance-row.total,.lw-finance-row.subtotal{border-top:1px solid #ffffff25;margin-top:5px;padding-top:12px}.lw-finance-note{font-size:11px;line-height:1.6;color:#93a2b8;margin:12px 0 0}.kpi-headline{line-height:1.6}</style></head>')
    handlers = []
    def event_attribute(match):
        event, body = match.groups()
        args = []
        def argument(m):
            expr = m[1]
            # The legacy escN exists solely for JS-string escaping. Data attributes
            # use the original name and HTML escaping instead.
            if expr == 'escN': expr = 'r.n'
            i = len(args); args.append(expr)
            return f'this.dataset.lwArg{i}'
        body = re.sub(r"'\$\{([^}]+)\}'", argument, body)
        if '${' in body: raise ValueError('Unrecognized dynamic handler')
        i = len(handlers); handlers.append((event, body))
        attrs = f'data-lw-{event}="{i}"'
        for j, expr in enumerate(args): attrs += f' data-lw-arg{j}="${{lwEscapeAttr({expr})}}"'
        return attrs
    source = re.sub(r'on(click|input|change|keydown)="([^"]*)"', event_attribute, source)
    if re.search(r'\bon\w+="', source): raise ValueError('Uncompiled event attribute')
    source = source.replace('href="favicon-meta.png"', 'href="assets/blended/favicon-finance.svg"')
    badge = ROOT / 'meta-badge.gif'
    if badge.exists(): source = source.replace('src="meta-badge.gif"', 'src="data:image/gif;base64,' + base64.b64encode(badge.read_bytes()).decode() + '"')
    source = source.replace('<html lang="nl">', '<html lang="nl" data-secured="true" class="session-hidden">')
    source = source.replace('</head>', '<style>.session-hidden .page{visibility:hidden}</style><script defer src="device.js"></script></head>')
    source = source.replace('if(xhr.status !== 200)', 'if(xhr.status===401){location.replace("login");throw new Error("Login vereist");}\n  if(xhr.status !== 200)')
    # Keep all original calculations and interface; add only the account link.
    source = source.replace('<div class="hd">', '<a href="account" style="display:block;text-align:right;padding-top:12px;color:#93A2B8">Account · __USER__</a><div class="hd">')
    source = source.replace('<body>', '<body><div id="sessionRetry" hidden style="padding:24px;text-align:center">Verbinding controleren. <button>Opnieuw proberen</button></div>')
    listener = '''
function lwEscapeAttr(value){return String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
const lwOriginalHandlers = [HANDLERS];
const lwBound = new WeakMap();
function lwBindOriginal(root){
  const nodes = [root, ...root.querySelectorAll('[data-lw-click],[data-lw-input],[data-lw-change],[data-lw-keydown]')];
  for(const node of nodes){
    if(!(node instanceof Element))continue;
    let bound=lwBound.get(node);if(!bound){bound=new Set();lwBound.set(node,bound);}
    for(const type of ['click','input','change','keydown']){
      const id=node.getAttribute('data-lw-'+type);
      if(id===null||bound.has(type))continue;
      const fn=lwOriginalHandlers[Number(id)];if(!fn)continue;
      node.addEventListener(type,function(event){fn.call(this,event);});bound.add(type);
    }
  }
}
new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n instanceof Element)lwBindOriginal(n);}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>lwBindOriginal(document.documentElement));
'''.replace('HANDLERS', ',\n'.join('function(event){'+body+'}' for _,body in handlers))
    # Install before original rendering; function declarations and global lexical
    # variables remain accessible when the listener actually runs.
    source = source.replace('<script>', '<script>' + listener, 1)
    # Each inline script is nonce-authorized by the authenticated PHP renderer.
    source = source.replace('<script>', '<script nonce="__CSP_NONCE__">')
    return source

def php_implementation():
    html = dashboard()
    if '\nLW_ORIGINAL_META;' in html: raise ValueError('Heredoc collision')
    return '''
function originalMetaDashboard(): never {
 global $user,$base,$cspNonce,$method;
 header('Content-Type: text/html; charset=utf-8');
 $html=<<<'LW_ORIGINAL_META'
''' + html + '''
LW_ORIGINAL_META;
 $html=str_replace(['__USER__','__CSP_NONCE__'],[h(ucfirst($user['name'])),h($cspNonce)],$html);
 session_write_close();if($method!=='HEAD')echo $html;exit;
}
'''
