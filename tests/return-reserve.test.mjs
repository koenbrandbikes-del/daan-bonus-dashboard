import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {returnReserve} from '../assets/blended/return-reserve.js';import {compute,series} from '../assets/blended/metrics.js';import {validateReturns} from '../assets/blended/data.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const data={returns:read('data/returns.json'),...Object.fromEntries(['shopify','meta','google','creators'].map(k=>[k,read('data/'+k+'.json')]))},costs=read('assets/blended/costs.json');
const synthetic=()=>({returns:{complete:true,synced_at:'2026-10-01T12:00:00Z',coverage_from:'2026-08-05',orders:[...Array.from({length:100},(_,i)=>({num:'#'+(5000+i),d:'2026-08-10',paid_incl:121,test:false,cancelled:false,refunds:i<3?[{id:'r'+i,d:'2026-08-24',amount_incl:121,kind:'received_return'}]:[]})),{num:'#5900',d:'2026-09-25',paid_incl:121,test:false,cancelled:false,refunds:[]},{num:'#5901',d:'2026-09-26',paid_incl:121,test:false,cancelled:false,refunds:[]}]},shopify:{orders:[]}});
test('public refund register validates aggregates and contains no new order identifiers or raw refund events',()=>{
 validateReturns(data.returns);const text=JSON.stringify(data.returns);assert.doesNotMatch(text,/"(?:num|id|name|refunds|createdAt)"|gid:\/\/|#\d+/);
 const bad=structuredClone(data.returns);bad.daily.push({...bad.daily[0]});assert.throws(()=>validateReturns(bad),/retourdag/);
 const broken=structuredClone(data.returns);broken.daily[0].reserve.all.impact+=1;assert.throws(()=>validateReturns(broken),/retourbegroting/);
});
test('recent week has a positive reserve; mature observed cohorts use only actual returns',()=>{
 const r=returnReserve(data,costs,'2026-09-24','2026-09-30');assert(r.available);assert(r.impact>0);assert.equal(r.horizon,35);assert.equal(r.matureOrders,146);assert.equal(r.matureReturns,4);
 close(r.impact,r.refundExcl+r.handling-r.overheadCredit);assert.equal(returnReserve(data,costs,'2026-08-05','2026-08-20').impact,0);
});
test('actual receipt replaces an order reserve and new mature data recalibrates the model',()=>{
 const sample=synthetic(),r=returnReserve(sample,costs,'2026-09-24','2026-09-30');close(r.rate,.03);
 const fresh=structuredClone(sample),o=fresh.returns.orders.find(o=>o.num==='#5900');o.refunds.push({id:'new',d:'2026-10-01',amount_incl:121,kind:'received_return'});
 const next=returnReserve(fresh,costs,'2026-09-24','2026-09-30');assert(!next.rows.some(o=>o.num===o.num && o.num==='#5900'));assert(next.impact<r.impact);
 fresh.returns.orders.find(o=>o.num==='#5004').refunds.push({id:'late',d:'2026-08-24',amount_incl:121,kind:'received_return'});
 const recalibrated=returnReserve({...fresh,returns:structuredClone(fresh.returns)},costs,'2026-09-24','2026-09-30');close(recalibrated.rate,.04);
});
test('every channel ledger and daily chart include exactly its allocated reserve',()=>{
 const from='2026-09-24',to='2026-09-30';
 for(const channel of ['all','meta','google','infl']){
  const m=compute(data,costs,from,to,channel);close(m.actualResult-m.result,m.returnReserve.impact);
  close(m.marginBuild.filter(r=>r.kind==='line').reduce((n,r)=>n+r.value,0),m.result);
  close(series(data,costs,from,to,channel,'day').reduce((n,r)=>n+r.result,0),m.result);
  close(m.returnReserve.refundExcl+m.returnReserve.handling-m.returnReserve.overheadCredit,m.returnReserve.impact);
 }
 const all=compute(data,costs,from,to),meta=compute(data,costs,from,to,'meta'),google=compute(data,costs,from,to,'google'),infl=compute(data,costs,from,to,'infl');
 close(meta.returnReserve.impact+google.returnReserve.impact+infl.returnReserve.impact+all.returnReserve.remainingImpact*all.correctionAllocation.weights.other,all.returnReserve.impact);
});
test('stale audit freezes age; missing or sparse training data never becomes a zero estimate',()=>{
 const sample=synthetic();sample.returns.synced_at='2026-09-30T20:00:00Z';const r=returnReserve(sample,costs,'2026-09-24','2026-09-30');assert.equal(r.asOf,'2026-09-30');
 assert.equal(returnReserve({},costs,'2026-09-24','2026-09-30').impact,null);
 const sparse=synthetic();sparse.returns.orders=sparse.returns.orders.slice(-10);assert.equal(returnReserve(sparse,costs,'2026-09-24','2026-09-30').impact,null);
});
test('new Shopify orders after the refund audit retain a young-order reserve',()=>{
 const base=returnReserve(data,costs,'2026-10-02','2026-10-02');
 const fresh={...data,shopify:{orders:[...data.shopify.orders,{num:'#future',d:'2026-10-02',incl:121,items:['LumeWorks Prime']}]}};
 const r=returnReserve(fresh,costs,'2026-10-02','2026-10-02');assert(r.impact>base.impact);close(r.packages-base.packages,r.rate);
});
test('updated actual aggregate corrects the original sale cohort without double subtracting the old snapshot',()=>{
 const r=compute(data,costs,'2026-09-01','2026-09-30');const rows=data.returns.daily.filter(r=>r.d>='2026-09-01' && r.d<='2026-09-30');
 close(r.refundedIncl,rows.reduce((n,r)=>n+r.actual.refundedIncl,0));close(r.returnCost,rows.reduce((n,r)=>n+r.actual.returnCost,0));
 const old=compute({...data,returns:undefined},costs,'2026-09-01','2026-09-30');assert(r.refundedIncl>old.refundedIncl);assert(r.actualResult<old.result);
});
