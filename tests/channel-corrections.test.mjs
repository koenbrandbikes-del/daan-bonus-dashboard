import test from 'node:test';
import assert from 'node:assert/strict';
import {compute,series,googleScopeData} from '../assets/blended/metrics.js';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const costs={items:{Prime:40},assumed_vat:.21,payment_rate:.02,overhead_rate:.04,
  influencer_gifting:null,returns:{cost_per_return:20,orders:[
    {num:'#1',paid_incl:121,refunded_incl:121,kind:'received_return',received_packages:1},
    {num:'#2',paid_incl:121,refunded_incl:121,kind:'cancelled',received_packages:0},
    {num:'#3',paid_incl:121,refunded_incl:121,kind:'received_return',received_packages:1},
  ]}};
const campaigns=[
  {id:'23981332205',d:'2026-09-01',conv:1.5,rev:100,spend:5},
  {id:'23981332205',d:'2026-09-02',conv:1.5,rev:100,spend:5},
  {id:'23981395565',d:'2026-09-01',conv:.5,rev:60.5,spend:2.5},
  {id:'23981395565',d:'2026-09-02',conv:1.5,rev:181.5,spend:7.5},
];
const data={shopify:{orders:Array.from({length:10},(_,i)=>({num:'#'+(i+1),
  d:[0,2].includes(i)?'2026-09-01':'2026-09-02',incl:121,items:['Prime']}))},
  meta:{daily_meta:[{d:'2026-09-01',purch:1,rev7:121,rev1v:0,spend:10},
    {d:'2026-09-02',purch:3,rev7:363,rev1v:0,spend:30}]},
  google:{daily_campaigns:campaigns,daily_google:[
    {d:'2026-09-01',conv:2,rev:160.5,spend:7.5},
    {d:'2026-09-02',conv:3,rev:281.5,spend:12.5}]},
  creators:{orders:[{num:'#1',d:'2026-09-01',commissie:12,omzet_excl:100}]}};
const from='2026-09-01',to='2026-09-02';
test('remaining refunds and return packages use order shares, preserving exact influencer corrections',()=>{
  const m=compute(data,costs,from,to,'meta');
  const a=m.correctionAllocation;
  assert.equal(a.totalOrders,10);assert.equal(a.orders,9);assert.equal(a.googleNonbrandOrders,2);
  close(a.weights.meta,4/9);close(a.weights.google,2/9);close(a.weights.other,3/9);
  assert.equal(a.pool.refundedIncl,242);assert.equal(a.pool.returnCost,20);
  assert.equal(a.direct.refundedIncl,121);assert.equal(a.direct.returnCost,20);
  close(a.pool.cancelledCostCredit,40);close(a.pool.overheadCredit,8);close(a.pool.profitImpact,172);
  close(Object.values(a.allocations).reduce((n,v)=>n+v.returnCost,0)+a.direct.returnCost,40);
  close(Object.values(a.allocations).reduce((n,v)=>n+v.refundedIncl,0)+a.direct.refundedIncl,363);
  close(m.revenue,484-242*4/9);
  close(m.result,4*53.58-172*4/9-40);
  close(m.profitMargin,m.result/(m.revenue/1.21)*100);
  const infl=compute(data,costs,from,to,'infl');close(infl.result,-74.42);
  const all=compute(data,costs,from,to);close(all.revenue,700);close(all.returnCost,40);close(all.result,175.8);
});
test('Google uses only nonbrand orders and charges its share once in All; Brand has no allocated share',()=>{
  const nb=compute(googleScopeData(data,'nonbrand'),costs,from,to,'google');
  close(nb.result,2*53.58-172*2/9-10);
  const all=compute(data,costs,from,to,'google');
  close(all.channels.google.corrections.returnCost,nb.channels.google.corrections.returnCost);
  const brand=compute(googleScopeData(data,'brand'),costs,from,to,'google');
  assert.equal(brand.channels.google.corrections.returnCost,0);
  assert.equal(brand.channels.google.corrections.refundedIncl,0);
  assert.equal(brand.correctionAllocation.googleNonbrandOrders,2);
});
test('overlapping purchase claims normalize the remaining pot to 100 percent',()=>{
  const overlap={...data,meta:{daily_meta:[{d:from,purch:18,rev7:484,spend:40}]}};
  const a=compute(overlap,costs,from,to,'meta').correctionAllocation;
  assert.equal(a.normalized,true);close(a.weights.meta,.9);close(a.weights.google,.1);close(a.weights.other,0);
  close(a.allocations.meta.returnCost+a.allocations.google.returnCost,20);
});
test('daily and weekly charts reconcile net channel revenue and profit to the selected period',()=>{
  for(const channel of ['meta','google'])for(const gran of ['day','week','month']) {
    const scoped=channel==='google'?googleScopeData(data,'nonbrand'):data;
    const total=compute(scoped,costs,from,to,channel);
    const points=series(scoped,costs,from,to,channel,gran);
    close(points.reduce((n,p)=>n+p.revenue,0),total.revenue);
    close(points.reduce((n,p)=>n+p.result,0),total.result);
    close(points.reduce((n,p)=>n+p.channels[channel].corrections.returnCost,0),total.channels[channel].corrections.returnCost);
  }
});
test('missing nonbrand classification blocks a correction estimate rather than treating all Google orders as nonbrand',()=>{
  const missing={...data,google:{daily_google:data.google.daily_google}};
  const m=compute(missing,costs,from,to,'meta');
  assert.equal(m.correctionAllocation.weights,null);assert.equal(m.result,null);
  assert.equal(m.marginBuild.find(r=>r.key==='netRevenue').value,null);
  assert.equal(m.profitMargin,null);
});
test('vertical margin build adds to the KPI for every channel and Google scope',()=>{
  for(const channel of ['all','meta','infl','google'])for(const scope of channel==='google'?['all','brand','nonbrand']:['all']) {
    const value=compute(googleScopeData(data,scope),costs,from,to,channel);
    close(value.marginBuild.filter(r=>r.kind==='line').reduce((n,r)=>n+r.value,0),value.result);
    close(value.marginBuild.find(r=>r.key==='result').value,value.result);
    close(value.marginBuild.find(r=>r.key==='margin').value,value.profitMargin);
    if(channel==='meta'||channel==='all')assert(value.marginBuild.some(r=>r.key==='daanFixed'));
  }
});

test('cost components retain received products, release cancelled costs and reconcile every channel',()=>{
 const c={...costs,item_components:{Prime:{purchase:30,inbound_shipping:2,fulfillment:7,source_adjustment:1}}};
 for(const channel of ['all','meta','google','infl']) {
  const m=compute(data,c,from,to,channel);
  const ledger=m.marginBuild.filter(r=>r.kind==='line');
  close(ledger.reduce((s,r)=>s+r.value,0),m.result);
  assert(m.marginBuild.some(r=>r.key==='fulfillment'));
 }
 const all=compute(data,c,from,to);
 close(all.purchase,270);close(all.inbound_shipping,18);close(all.fulfillment,63);close(all.source_adjustment,9);
 close(all.purchase+all.inbound_shipping+all.fulfillment+all.source_adjustment,all.fixed);
 const meta=compute(data,c,from,to,'meta');
 close(meta.correctionAllocation.pool.purchaseCredit,30);
 const daily=series(data,c,from,to,'meta','day');
 close(daily.reduce((s,r)=>s+r.marginBuild.find(x=>x.key==='purchase').value,0),meta.marginBuild.find(x=>x.key==='purchase').value);
});
