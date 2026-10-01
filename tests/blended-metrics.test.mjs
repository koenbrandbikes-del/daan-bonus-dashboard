import test from "node:test";
import assert from "node:assert/strict";
import {
  compute,
  series,
  finance,
  previous,
} from "../assets/blended/metrics.js";
const C = {
  items: { Prime: 40 },
  assumed_vat: 0.21,
  payment_rate: 0.02,
  overhead_rate: 0.04,
};
const D = {
  shopify: {
    orders: [
      { d: "2026-09-01", num: "#1", incl: 121, items: ["Prime"] },
      { d: "2026-09-02", num: "#2", incl: 242, items: ["Prime", "Prime"] },
    ],
  },
  meta: {
    daily_meta: [
      { d: "2026-09-01", spend: 10, rev7: 50, rev1v: 10, purch: 1 },
      { d: "2026-09-02", spend: 90, rev7: 120, rev1v: 0, purch: 2 },
    ],
  },
  google: { daily_google: [{ d: "2026-09-01", spend: 5, rev: 30, conv: 0.5 }] },
  creators: {
    orders: [{ d: "2026-09-01", num: "#1", commissie: 12, omzet_excl: 100 }],
  },
};
test('audited refunds reduce revenue once, keep paid fees and charge only received returns', () => {
 const costs={...C,returns:{cost_per_return:20,orders:[
  {num:'#1',paid_incl:121,refunded_incl:60.5,kind:'received_return'},
  {num:'#2',paid_incl:242,refunded_incl:242,kind:'cancelled'}]}};
 const value=compute(D,costs,'2026-09-01','2026-09-02');
 assert.equal(value.incl,60.5);
 assert.equal(value.refundedIncl,302.5);
 assert.equal(value.fixed,40);
 assert.equal(value.fees,7.26);
 assert.equal(value.returnCost,20);
 assert.equal(value.receivedReturns,1);
 assert.ok(Math.abs(value.cost-67.26)<1e-8);
 assert.equal(finance(value.orderRows,costs).incl,60.5);
 const days=series(D,costs,'2026-09-01','2026-09-02','all');
 assert.ok(Math.abs(days.reduce((s,r)=>s+r.result,0)-value.result)<1e-8);
 assert.equal(value.profitMargin,value.result/50*100);
 assert.equal(value.channels.infl.revenue,60.5);
});
test('refund without a return reason does not invent a physical return or inventory recovery',()=>{
 const costs={...C,returns:{cost_per_return:20,orders:[{num:'#1',paid_incl:121,refunded_incl:121,kind:'unknown'}]}};
 const value=compute(D,costs,'2026-09-01','2026-09-01');
 assert.equal(value.incl,0);
 assert.equal(value.returnCost,0);
 assert.equal(value.fixed,40);
 assert.equal(value.unknownReturns,1);
 assert.equal(value.profitMargin,null);
});
test("financial waterfall includes overhead and counts quantities", () => {
  const v = compute(D, C, "2026-09-01", "2026-09-02");
  assert.equal(v.revenue, 300);
  assert.equal(v.fixed, 120);
  assert.equal(v.fees, 7.26);
  assert.equal(v.spend, 117);
  assert.ok(Math.abs(v.result - 43.74) < 1e-8);
  assert.equal(v.overhead, 12);
  assert.equal(v.roas, 363 / 117);
});
test("channel selection uses attributed numerator and estimated store margin", () => {
  const m = compute(D, C, "2026-09-01", "2026-09-02", "meta");
  assert.equal(m.revenue, 180);
  assert.equal(m.roas, 1.8);
  assert.equal(m.result, m.revenue * ((m.excl-m.cost-m.overhead)/m.incl) - m.spend);
  const g = compute(D, C, "2026-09-01", "2026-09-02", "google");
  assert.equal(g.count, 0.5);
  assert.equal(g.roas, 6);
});
test("weighted weekly ROAS not average of days", () => {
  const s = series(D, C, "2026-09-01", "2026-09-02", "meta", "week");
  assert.equal(s.length, 1);
  assert.equal(s[0].roas, 1.8);
});
test("unknown costs block final result", () => {
  const f = finance([{ items: ["unknown"], incl: 121 }], C);
  assert.equal(f.cost, null);
  assert.equal(f.unknown, 1);
});
test("missing sources are not zero", () => {
  const v = compute({ ...D, google: null }, C, "2026-09-01", "2026-09-02");
  assert.equal(v.spend, null);
  assert.equal(v.result, null);
  assert.equal(v.roas, null);
  const s = compute({ ...D, shopify: null }, C, "2026-09-01", "2026-09-02");
  assert.equal(s.cost, null);
  assert.equal(s.revenue, null);
});
test("zero spend produces no ratio; returned creator orders excluded", () => {
  const v = compute(D, C, "2026-10-01", "2026-10-02", "meta");
  assert.equal(v.roas, null);
  assert.equal(v.spend, 0);
  const d = {
    ...D,
    creators: { orders: [{ ...D.creators.orders[0], retour: true }] },
  };
  assert.equal(compute(d, C, "2026-09-01", "2026-09-02", "infl").spend, 0);
});
test("previous period spans equal days across year boundary", () =>
  assert.deepEqual(previous("2026-01-01", "2026-01-07"), {
    from: "2025-12-25",
    to: "2025-12-31",
  }));

test('historical report audit includes pending refunds once and reconciles all report rows', async()=>{
 const {readFile}=await import('node:fs/promises');
 const costs=JSON.parse(await readFile(new URL('../assets/blended/costs.json',import.meta.url)));
 const data=JSON.parse(await readFile(new URL('../data/shopify.json',import.meta.url)));
 const audit=costs.returns.orders;
 assert.equal(audit.length,24);
 assert.ok(Math.abs(audit.reduce((s,o)=>s+o.sales_reversal_report,0)+3353)<.001);
 for(const num of ['#1474','#1510']) {
   const order=data.orders.find(o=>o.num===num);
   const f=finance([order],costs);
   assert.equal(f.incl,0);
   assert.equal(f.refundedOrders,1);
   assert.equal(f.returnCost,num==='#1474'?20:0);
 }
 const oldOrders=data.orders.filter(o=>o.d<'2026-09-01');
 assert.ok(finance(oldOrders,costs).refundedIncl>0);
});

test('renamed Prime preserves costs, management bonus and profit across order and chart views', async()=>{
 const {readFile}=await import('node:fs/promises');
 const costs=JSON.parse(await readFile(new URL('../assets/blended/costs.json',import.meta.url)));
 const read=async name=>JSON.parse(await readFile(new URL('../data/'+name+'.json',import.meta.url)));
 const data={shopify:await read('shopify'),meta:await read('meta'),google:await read('google'),creators:await read('creators')};
 const renamed='LumeWorks Prime | Van gewone avond naar datenight.';
 const canonical={...data,shopify:{orders:data.shopify.orders.map(o=>({...o,items:o.items.map(i=>i===renamed?'LumeWorks Prime':i)}))}};
 const actual=compute(data,costs,'2026-09-24','2026-09-30');
 const expected=compute(canonical,costs,'2026-09-24','2026-09-30');
 for(const key of ['cost','spend','result','profitMargin','roas']) {
  assert.ok(Number.isFinite(actual[key]),key+' must be available');
  assert.equal(actual[key],expected[key]);
 }
 assert.ok(Number.isFinite(actual.management.total));
 const row=data.shopify.orders.find(o=>o.items.includes(renamed));
 assert.equal(finance([row],costs).fixed,44.5);
 const points=series(data,costs,'2026-09-24','2026-09-30','all');
 assert.ok(points.every(p=>Number.isFinite(p.result)));
 assert.equal(finance([{...row,items:['Unknown future product']}],costs).cost,null);
});


test('return handling charges per package and influencer profit uses own refunded orders',()=>{
 const costs={...C,returns:{cost_per_return:20,orders:[{num:'#1',paid_incl:121,refunded_incl:121,kind:'received_return',received_packages:2}]}};
 const m=compute(D,costs,'2026-09-01','2026-09-01','infl');
 assert.equal(m.creatorFinance.returnCost,40);
 assert.equal(m.creatorFinance.receivedReturnPackages,2);
 assert.equal(m.revenue,0);
 assert.equal(m.result,-40-2.42-40-12);
 assert.equal(m.result,m.creatorFinance.excl-m.creatorFinance.cost-m.creatorFinance.overhead-m.spend);
 const flagged=compute({...D,creators:{orders:D.creators.orders.map(o=>({...o,retour:true}))}},costs,'2026-09-01','2026-09-01','infl');
 assert.equal(flagged.result,m.result);
 const unverified=compute({...D,creators:{orders:D.creators.orders.map(o=>({...o,retour:true}))}},C,'2026-09-01','2026-09-01','infl');
 assert.equal(unverified.result,null);
 const missing=compute({...D,shopify:{orders:[]}},costs,'2026-09-01','2026-09-01','infl');
 assert.equal(missing.result,null);
});
