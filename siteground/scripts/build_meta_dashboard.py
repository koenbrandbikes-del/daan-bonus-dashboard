"""Preserve the original single Meta/bonus dashboard behind the existing login.

Compile inline event handlers into nonce-authorized listeners; never use eval,
unsafe-inline scripts, or public GitHub financial endpoints.
"""
import base64, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]

def dashboard():
    source = (ROOT / 'index.html').read_text()
    # Only the secured Meta build shares the finance/return engine with Cijfers.
    # The public original stays unchanged; the private cost basis is dynamic.
    source = source.replace('1/(1/CX.be-SCALE_T)', 'lwTargetRoas(CX.be,SCALE_T)').replace('1/(1/CX.be-SCALE_H)', 'lwTargetRoas(CX.be,SCALE_H)')
    source = source.replace('Augustus (v.a. 5 aug)', 'Sinds start (5 aug)').replace('aug:      {label:"Augustus"', 'aug:      {label:"Sinds start"').replace('aug:{main:"Augustus",range:"(v.a. 5 aug)"}', 'aug:{main:"Sinds start",range:"(5 aug)"}')
    source = source.replace('const metricLabel=isRoas?"Meta ROAS":"CAC";', 'const metricLabel=isRoas?"Netto Meta ROAS":"CAC";')
    source = source.replace('const dailySource = kpiDailySeriesFiltered(filterStrategy,filterPlatform,filterPlacement);', 'const dailySource = isRoas?lwNetDailySource(rangeFrom,rangeTo):kpiDailySeriesFiltered(filterStrategy,filterPlatform,filterPlacement);')
    source = source.replace('Hypothetische ROAS incl. BTW', 'Netto ROAS na retouren').replace('Hypothetisch adspend per dag', 'Advertentiebudget per dag')
    source = source.replace('<div class="sl">ROAS – BEROAS</div>', '<div class="sl">Netto resultaat</div>')
    source = source.replace('<div class="sim-cards">', '<p id="lwSimBasis" class="lw-finance-note"></p><div class="sim-cards">')
    source = source.replace('+ \'worden.</strong><br>\' + String((e && e.message) || e).replace(/</g,"&lt;") + \'</div>\';', '+ \'worden.</strong><p>Controleer je verbinding en probeer opnieuw. We tonen geen oude bedragen als actuele cijfers.</p><button type="button" onclick="location.reload()">Opnieuw proberen</button></div>\';')
    source = re.sub(r'  <div class="acc-item" id="acc-sim">.*?(?=  <div class="acc-item" id="acc-be">)', '', source, flags=re.S)
    source = source.replace('let yMin=Math.min(...allVals), yMax=Math.max(...allVals);', 'let yMin=Math.min(0,...allVals), yMax=Math.max(0,...allVals);')
    source = source.replace('let yMin=Math.min(...allRatioVals), yMax=Math.max(...allRatioVals);', 'let yMin=Math.min(0,...allRatioVals), yMax=Math.max(0,...allRatioVals);')
    source = source.replace('attachKpiChartHover(plot,data,xAt,padL,padR,W,H,padT,padB);', 'attachKpiChartHover(plot,data,xAt,padL,padR,W,H,padT,padB); lwChartTools.attachChartReference(document.getElementById("kpiChartSvg"),{min:yMin,max:yMax,left:padL,right:W-padR,top:padT,bottom:H-padB,format:fmtY,series:plot.map(s=>({label:s.meta.label,values:s.vals})),key:"meta:"+kpiChartSel.join(":")+":"+rangeFrom+":"+rangeTo,unit:kpiChartGran==="week"?"weken":kpiChartGran==="month"?"maanden":"dagen"});')
    source = source.replace('attachRatioChartHover(data,ratio3,xAt,W,metric);', 'attachRatioChartHover(data,ratio3,xAt,W,metric); lwChartTools.attachChartReference(document.getElementById("kpiChartSvg"),{min:yMin,max:yMax,left:padL,right:W-padR,top:roasTop,bottom:roasBot,format:fmtRatio,series:[{label:metricLabel,values:data.map(valOf)}],key:"meta:"+metric+":"+rangeFrom+":"+rangeTo,unit:"dagen"});')
    source = re.sub(r'  /\* simulator —.*?\n  document.getElementById\("footerDate"\)', '  document.getElementById("footerDate")', source, flags=re.S)
    chart_tools = (ROOT / 'assets/blended/chart-reference.js').read_text().replace('export ', '')
    source = source.replace('/* ═══ INIT ═', 'const lwChartTools=(()=>{' + chart_tools + ';return {attachChartReference,comparisonRanges,periodComparisonChart};})();\n/* ═══ INIT ═', 1)
    source = source.replace('</head>', '<style>'+(ROOT / 'assets/blended/chart-reference.css').read_text()+'</style></head>')
    engine = []
    for path in ['assets/blended/data.js', 'assets/blended/return-reserve.js', 'assets/blended/meta-management.js', 'assets/blended/metrics.js']:
        part = (ROOT / path).read_text()
        part = re.sub(r'^import[^\n]*\n', '', part, flags=re.M)
        part = re.sub(r'\bexport (?=(?:async )?(?:function|const|let|class))', '', part)
        engine.append(part)
    bridge = (ROOT / 'siteground/private/original-meta-finance.js').read_text()
    source = source.replace('/* ═══ INIT ═', 'const lwFinanceEngine=(()=>{\n' + '\n'.join(engine) + '\nreturn {compute,series,validateSource,validateReturns,validateCosts,simulate:options=>simulateMetaScenario(compute,contractManagementCosts,lwFinancialData,lwFinancialCosts,options)};})();\n' + bridge + '\n/* ═══ INIT ═', 1)
    source = source.replace('</head>', '<style>.kpi-item[data-kpi=profitMargin]{cursor:default}.lw-finance{margin:12px 0 20px;border:1px solid #ffffff1a;border-radius:14px;background:#151b4033}.lw-finance summary{display:flex;justify-content:space-between;gap:16px;cursor:pointer;padding:16px;font-size:13px}.lw-finance summary span{font-variant-numeric:tabular-nums}.lw-finance-body{padding:0 16px 16px}.lw-finance-row{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:8px 0;font-size:12px;border-bottom:1px solid #ffffff08}.lw-finance-row strong{font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}.lw-finance-row.total,.lw-finance-row.subtotal{border-top:1px solid #ffffff25;margin-top:5px;padding-top:12px}.lw-daan-breakdown{padding:0 10px 12px;border-bottom:1px solid #ffffff15}.lw-daan-breakdown .table-wrap{overflow-x:auto}.lw-daan-breakdown table{width:100%;font-size:11px;text-align:right;font-variant-numeric:tabular-nums}.lw-daan-breakdown td,.lw-daan-breakdown th{padding:6px 8px;white-space:nowrap}.lw-daan-breakdown td:first-child,.lw-daan-breakdown th:first-child{text-align:left}.lw-finance summary.lw-finance-row{padding:8px 0;font-size:12px}.lw-finance-note{font-size:11px;line-height:1.6;color:#93a2b8;margin:12px 0 0}.kpi-headline{line-height:1.6}</style></head>')
    source = source.replace('</head>', '<style>' + (ROOT / 'siteground/private/original-meta-ceo.css').read_text() + '</style></head>')
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
