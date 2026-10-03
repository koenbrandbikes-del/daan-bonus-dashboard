import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

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

test('original and secured dashboard render the same financial values; controls respond',async()=>{
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
  for(const id of ['simSlider','ordHdr','adsHdr'])assert.equal(secured.window.document.getElementById(id).textContent,original.window.document.getElementById(id).textContent);
  const values=d=>[...d.window.document.querySelectorAll('.bonus-amt,.mc-val,.kpi-val')].map(n=>n.textContent);
  assert.deepEqual(values(secured),values(original));
  secured.window.document.querySelector('[data-p="vandaag"]').click();
  original.window.document.querySelector('[data-p="vandaag"]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(values(secured),values(original));
  const slider=secured.window.document.getElementById('simSlider');slider.value='3';slider.dispatchEvent(new secured.window.Event('input',{bubbles:true}));
  assert.equal(slider.value,'3');
 }finally{original.window.close();secured.window.close();}
});
