import {simulateMetaScenario} from '../../assets/blended/meta-management.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {compute,series,contractManagementCosts as managementCosts} from '../../assets/blended/metrics.js';
import {makeDynamicManagement,solveMetaBonus} from '../private/dynamic-meta-costs.js';
const dynamicManagement=makeDynamicManagement(compute,managementCosts);
const data=Object.fromEntries(['meta','google','shopify','creators','returns'].map(k=>[k,JSON.parse(readFileSync('data/'+k+'.json','utf8'))]));
const costs=JSON.parse(readFileSync('assets/blended/costs.json','utf8'));

const html=execFileSync('python',['-c','import sys;sys.path.insert(0,"siteground/scripts");from build_meta_dashboard import dashboard;print(dashboard())'],{maxBuffer:4e6}).toString();
const dom=new JSDOM(html);
test('one original dashboard retains compensation, simulator, ads and orders',()=>{
 for(const id of ['simSlider','adTagMenu','acc-sim','acc-be','acc-ord'])assert.ok(dom.window.document.getElementById(id),id);
 assert.ok(html.includes('BONUS_PCT   = 0.10'));
 assert.ok(!html.includes('href="meta-test"'));
 assert.ok(!html.includes('href="daan-test"'));
 assert.ok(!html.includes('koenbrandbikes-del.github.io'));
});
test('all original script code parses and handlers work without inline execution',()=>{
 for(const script of dom.window.document.querySelectorAll('script:not([src])')){
  assert.equal(script.getAttribute('nonce'),'__CSP_NONCE__');
  new Function(script.textContent); // Parse only in the test, never in the application.
 }
 for(const node of dom.window.document.querySelectorAll('*'))for(const a of node.attributes)assert.ok(!/^on\w+/i.test(a.name));
 assert.ok(html.includes('lwOriginalHandlers'));
 assert.ok(!html.includes('eval('));
 assert.ok(!html.includes('new Function'));
});
test('handler compilation handles dynamic names safely and keeps financial source local',()=>{
 assert.ok(html.includes('${lwEscapeAttr(r.n)}'));
 assert.ok(html.includes('this.dataset.lwArg0'));
 assert.ok(html.includes('_loadJSON("data/meta.json")'));
 assert.ok(html.includes('_loadJSON("data/shopify.json")'));
 assert.ok(html.includes('location.replace("login")'));
});

test('secured financial values share audited costs with a dynamic bonus, preserving controls',async()=>{
 const product=readFileSync('assets/product-costs.js','utf8');
 const source=readFileSync('index.html','utf8');
 const render=async document=>{
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const d=new JSDOM(document.replace(/<script src="assets\/product-costs.js[^>]*><\/script>/,'<script>'+product+'</script>'),{
   url:'https://meta.lumeworks.nl/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   beforeParse(w){
    w.fetch=async()=>({ok:true,status:200,json:async()=>({})});
    w.XMLHttpRequest=class{open(method,url){this.url=url;}send(){this.status=200;this.responseText=readFileSync(this.url,'utf8');}};
   }
  });
  await new Promise(resolve=>d.window.addEventListener('load',resolve,{once:true}));
  assert.deepEqual(errors.map(e=>e.message),[]);
  return d;
 };
 const original=await render(source);const secured=await render(html);
 try{
  for(const id of ['simSlider','adsHdr'])assert.equal(secured.window.document.getElementById(id).textContent,original.window.document.getElementById(id).textContent);
  const values=d=>[...d.window.document.querySelectorAll('[data-kpi="spend"] .kpi-val,[data-kpi="purch"] .kpi-val,[data-kpi="cac"] .kpi-val')].map(n=>n.textContent);
  assert.deepEqual(values(secured),values(original));
  const compare=()=>{
   const period=secured.window.eval('PERIODS[P]');
   const expected=compute(data,costs,period.from,period.to,'meta',{includeDaan:false});
   const management=dynamicManagement(data,costs,period.from,period.to);
   expected.result=expected.result==null || management.total==null?null:expected.result-management.total;
   const money=v=>'€'+v.toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:0});
   assert.equal(secured.window.document.querySelector('[data-kpi="net"] .kpi-val').textContent,expected.result==null?'—':money(expected.result));
   const shared=compute(data,costs,period.from,period.to,'meta');
   assert.ok(Math.abs(shared.result-expected.result)<1e-7);
   assert.equal(secured.window.document.querySelector('[data-kpi="roas"] .kpi-val').textContent,shared.roas.toFixed(2)+'×');
   assert.equal(secured.window.document.querySelector('[data-kpi="profitMargin"] .kpi-val').textContent,shared.profitMargin.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%');
   assert.ok(!secured.window.document.getElementById('kpiHeadline').textContent.includes('houdt'));
   assert.ok(!secured.window.document.getElementById('kpiHeadline').textContent.includes('verlies na kosten'));
   assert.deepEqual([...secured.window.document.querySelectorAll('#kpiStrip > [data-kpi]')].map(n=>n.dataset.kpi),['net','profitMargin','rev','roas']);
   assert.equal(secured.window.document.querySelectorAll('#lwAdsDetails [data-kpi]').length,5);
   assert.equal(secured.window.document.querySelector('#lwAdsDetails').open,false);
   const ledger=secured.window.document.getElementById('lwFinanceDetails');
   assert.ok(ledger.textContent.includes('Begrote retouren'));
   assert.ok(ledger.textContent.includes('Daan · vergoeding'));
   assert.ok(ledger.querySelector('[data-daan-breakdown] summary'));
   assert.ok(ledger.querySelector('[data-return-breakdown] summary'));
   assert.equal(secured.window.document.getElementById('periodBtnTxt').textContent.includes('Augustus'),false);
   assert.ok(ledger.querySelector('[data-return-breakdown]').textContent.includes('Werkelijke terugbetalingen'));
   assert.ok(ledger.querySelector('[data-return-breakdown]').textContent.includes('Google telt alleen non-branded mee'));
   assert.ok(ledger.querySelector('[data-daan-breakdown]').textContent.includes('vaste vergoeding blijft behouden'));
   assert.equal(ledger.querySelectorAll('[data-finance-key="returns"]').length,1);
   assert.equal(ledger.querySelectorAll('[data-finance-key="returnReserve"]').length,0);
   assert.ok(ledger.querySelector('[data-finance-key="returns"] strong').textContent.includes('%'));
   assert.ok(ledger.textContent.includes('annuleringen tellen niet als retourpakket'));
   const points=secured.window.eval('kpiAggregate("day",PERIODS[P].from,PERIODS[P].to,"all","all","all")');
   const reference=series(data,costs,period.from,period.to,'meta','day',{includeDaan:false});
   for(const r of reference){const management=dynamicManagement(data,costs,r.from,r.to);r.result=r.result==null || management.total==null?null:r.result-management.total;}
   const byDate=new Map(reference.map(r=>[r.key,r]));
   for(const p of points)assert.ok(Math.abs(p.net-byDate.get(p.key).result)<1e-7);
  };
  compare();
  secured.window.document.querySelector('[data-p="vandaag"]').click();
  original.window.document.querySelector('[data-p="vandaag"]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(values(secured),values(original));
  compare();
  const margin=secured.window.document.querySelector('[data-kpi="profitMargin"]');
  margin.dispatchEvent(new secured.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(margin.getAttribute('aria-pressed'),'true');
  assert.ok(secured.window.document.getElementById('kpiChartWrap').classList.contains('open'));
  margin.dispatchEvent(new secured.window.KeyboardEvent('keydown',{key:' ',bubbles:true}));
  assert.equal(margin.getAttribute('aria-pressed'),'false');
  const slider=secured.window.document.getElementById('simSlider');slider.value='3';slider.dispatchEvent(new secured.window.Event('input',{bubbles:true}));
  assert.equal(slider.value,'3');
 }finally{original.window.close();secured.window.close();}
});
test('return risk and the fixed fee raise break-even and reduce the block bonus without double deductions',()=>{
 const from='2026-10-01',to='2026-10-01';
 const dynamic=dynamicManagement(data,costs,from,to);
 const old=managementCosts(data,costs,from,to);
 assert(dynamic.bonus<old.bonus);
 assert.equal(dynamic.fixed,old.fixed);
 assert.ok(Math.abs(dynamic.daily.reduce((n,r)=>n+r.bonus,0)-dynamic.bonus)<1e-7);
 for(const p of dynamic.periods){assert.ok(Math.abs(p.bonus-Math.max(0,p.rawBonus))<1e-7);assert.ok(p.breakEvenRoas>0);}
 const noFixed=dynamicManagement(data,{...costs,meta_management:{...costs.meta_management,monthly_fixed:0}},from,to);
 assert(noFixed.bonus>dynamic.bonus);
 const unavailable=dynamicManagement({...data,returns:undefined},costs,from,to);assert.equal(unavailable.bonus,null);
});
test('October fixed-point bonus exactly satisfies the original ROAS-gap formula and leaves history untouched',()=>{
 assert.deepEqual(dynamicManagement(data,costs,'2026-09-14','2026-09-30'),managementCosts(data,costs,'2026-09-14','2026-09-30'));
 for(const [revenue,margin,spend,rate] of [[1210,500,200,.1],[100,20,10,.1],[3000,1000,999,.1],[3000,1000,1200,.1]]){
  const b=solveMetaBonus(revenue,margin,spend,rate),be=revenue/(margin-b);
  assert.ok(Math.abs(b-Math.max(0,rate*(revenue-spend*be)))<1e-8);
  assert.ok(b>=0 && b<=Math.max(0,margin-spend));
 }
 assert.equal(solveMetaBonus(100,20,25,.1),0);
});

test('planning scenario uses the exact bonus solver, calendar fee and signed company profit',()=>{
 const options={from:'2026-10-03',to:'2026-11-01',dailySpend:200,roas:3,referenceFrom:'2026-09-02',referenceTo:'2026-10-01'};
 const s=simulateMetaScenario(compute,managementCosts,data,costs,options);
 assert.equal(s.available,true);assert.equal(s.days,30);assert.equal(s.spend,6000);
 assert.ok(Math.abs(s.fixed-(29*1500/31+1500/30))<1e-7);
 assert.ok(Math.abs(s.result+s.bonus+s.fixed+s.spend-s.revenue*s.contributionRate)<1e-7);
 if(s.bonus>0)assert.ok(Math.abs(s.bonus-.1*(s.revenue-s.spend*s.breakEvenRoas))<1e-7);
 const zero=simulateMetaScenario(compute,managementCosts,data,costs,{...options,dailySpend:0});assert.equal(zero.bonus,0);assert.equal(zero.result,-zero.fixed);
 const loss=simulateMetaScenario(compute,managementCosts,data,costs,{...options,roas:.5});assert.equal(loss.bonus,0);assert.ok(loss.result<0);
 assert.equal(simulateMetaScenario(compute,managementCosts,{...data,returns:undefined},costs,options).available,false);
 assert.equal(simulateMetaScenario(compute,managementCosts,{...data,meta:{...data.meta,daily_meta:data.meta.daily_meta.filter(r=>r.d!=='2026-09-15')}},costs,options).available,false);
 assert.equal(solveMetaBonus(100,30,-1,.1),null);assert.equal(solveMetaBonus(100,30,10,-.1),null);
});

test('invalid costs, duplicate Meta days and mismatched return basis never show a financial result',async()=>{
 const product=readFileSync('assets/product-costs.js','utf8');
 for(const issue of ['costs','meta','returns']){
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const d=new JSDOM(html.replace(/<script src="assets\/product-costs.js[^>]*><\/script>/,'<script>'+product+'</script>'),{
   url:'https://meta.lumeworks.nl/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   beforeParse(w){w.fetch=async()=>({ok:true,status:200,json:async()=>({})});w.XMLHttpRequest=class{
    open(method,url){this.url=url;}send(){this.status=200;const source=JSON.parse(readFileSync(this.url,'utf8'));
     if(issue==='costs'&&this.url.includes('costs.json'))source.items['LumeWorks Atlas']+=1;
     if(issue==='meta'&&this.url==='data/meta.json')source.daily_meta.push({...source.daily_meta.at(-1)});
     if(issue==='returns'&&this.url==='data/returns.json')source.cost_basis='different tariffs';
     this.responseText=JSON.stringify(source);
    }
   };}
  });
  await new Promise(resolve=>d.window.addEventListener('load',resolve,{once:true}));
  try{
   assert.deepEqual(errors,[],issue);
   assert.equal(d.window.document.querySelector('[data-kpi="net"] .kpi-val').textContent,'—',issue);
   assert.equal(d.window.document.querySelector('[data-kpi="profitMargin"] .kpi-val').textContent,'—',issue);
   assert.ok(d.window.document.getElementById('kpiHeadline').textContent.includes('niet beschikbaar'),issue);
   assert.equal(d.window.document.querySelector('#kpiStrip .good'),null,issue);
  }finally{d.window.close();}
 }
});

test('source outage offers a safe retry instead of showing stale financial placeholders',async()=>{
 const product=readFileSync('assets/product-costs.js','utf8'),vc=new VirtualConsole();vc.on('jsdomError',()=>{});
 const d=new JSDOM(html.replace(/<script src="assets\/product-costs.js[^>]*><\/script>/,'<script>'+product+'</script>'),{
  url:'https://meta.lumeworks.nl/',runScripts:'dangerously',virtualConsole:vc,
  beforeParse(w){w.XMLHttpRequest=class{open(method,url){this.url=url;}send(){this.status=503;this.responseText='unavailable';}};}
 });
 await new Promise(resolve=>d.window.addEventListener('load',resolve,{once:true}));
 try{assert.ok(d.window.document.body.textContent.includes('Opnieuw proberen'));assert.equal(d.window.document.querySelector('[data-kpi="net"]'),null);assert.ok(d.window.document.querySelector('button[data-lw-click]'));}finally{d.window.close();}
});
