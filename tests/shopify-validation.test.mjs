import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { checkShopifyOrders } from "../assets/blended/data.js";
import {compute} from "../assets/blended/metrics.js";
test("order validation rejects duplicate identifiers and malformed order details",()=>{
 const row={num:"#1",d:"2026-09-30",incl:121,items:["Prime"]};
 assert.equal(checkShopifyOrders([row]).sales,1);
 assert.throws(()=>checkShopifyOrders([row,row]),/dubbel/);
 for(const update of [{d:"2026-02-30"},{incl:NaN},{items:[]},{items:[null]}]) assert.throws(()=>checkShopifyOrders([{...row,...update}]));
});
test("Meta order list and blended agree on orders and gross revenue since August",()=>{
 const html=fs.readFileSync(new URL("../meta.html",import.meta.url),"utf8");
 assert.match(html,/_SHOPIFY = _loadJSON\("data\/shopify.json"\)/);
 const history=vm.runInNewContext(html.match(/const ORDERS_STATIC = (\[[\s\S]*?\]);/)[1]);
 const data={shopify:JSON.parse(fs.readFileSync(new URL("../data/shopify.json",import.meta.url)))};
 const costs=JSON.parse(fs.readFileSync(new URL("../assets/blended/costs.json",import.meta.url)));
 for(const [from,to] of [["2026-09-23","2026-09-29"],["2026-09-30","2026-09-30"],["2026-08-01","2026-09-30"]]) {
  const ref=[...history,...data.shopify.orders].filter(o=>!o.test&&o.d>=from&&o.d<=to);
  const m=compute(data,costs,from,to);
  assert.equal(m.count,ref.length);
  assert.equal(Math.round(m.incl*100),Math.round(ref.reduce((s,o)=>s+o.incl,0)*100));
 }
});
