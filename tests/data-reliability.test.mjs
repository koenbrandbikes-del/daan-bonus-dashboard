import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load,fetchJSON,validateSource,validateCosts} from '../assets/blended/data.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
test('real source snapshots and cost register pass validation',()=>{
 for(const k of ['meta','google','shopify','creators']) validateSource(k,read('data/'+k+'.json'));
 validateCosts(read('assets/blended/costs.json'));
});
test('malformed dates, duplicate ad days and invalid rates are rejected',()=>{
 const d=read('data/meta.json');
 assert.throws(()=>validateSource('meta',{...d,daily_meta:[d.daily_meta[0],d.daily_meta[0]]}),/Dubbele/);
 assert.throws(()=>validateSource('meta',{...d,daily_meta:[{...d.daily_meta[0],d:'2026-02-30'}]}),/datums/);
 assert.throws(()=>validateCosts({...read('assets/blended/costs.json'),payment_rate:null}),/tarief/);
});
test('transient errors recover and stuck requests have a bounded timeout',async()=>{
 const old=globalThis.fetch;
 try{
  let calls=0;globalThis.fetch=async()=>{if(++calls===1) throw Error('temporary');return {ok:true,json:async()=>({ok:true})};};
  assert.deepEqual(await fetchJSON('test'),{ok:true});assert.equal(calls,2);
  globalThis.fetch=()=>new Promise(()=>{});
  await assert.rejects(fetchJSON('test',{timeoutMs:10,attempts:2}),/te lang/);
 }finally{globalThis.fetch=old;}
});
test('outage uses only validated cache, including costs, with explicit errors',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.sessionStorage;
 const store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 try{
  globalThis.fetch=async url=>({ok:true,json:async()=>read(url)});
  const fresh=await load();assert(fresh.data.shopify_check);assert.deepEqual(fresh.errors,{});
  globalThis.fetch=async()=>{throw Error('offline');};
  const cached=await load();assert(cached.data.shopify_check);assert(cached.costs);assert(cached.errors.costs);assert(cached.errors.meta);
  store.set('lw-dashboard-v3meta',JSON.stringify({daily_meta:[{d:'bad'}]}));
  assert.equal((await load()).data.meta,undefined);
  store.set('lw-dashboard-v3costs','{}');await assert.rejects(load(),/Kostenregister/);
 }finally{globalThis.fetch=oldFetch;globalThis.sessionStorage=oldStorage;}
});

test('startup totals and components must reconcile before caching',()=>{
 const d=read('data/creators.json');
 assert.throws(()=>validateSource('creators',{...d,startup_costs:{...d.startup_costs,total:d.startup_costs.total+10}}),/Totaal/);
 const rows=d.startup_costs.rows.map((r,i)=>i? r:{...r,shipping:r.shipping+1});
 assert.throws(()=>validateSource('creators',{...d,startup_costs:{...d.startup_costs,rows}}),/sluiten niet aan/);
});

test('cost components must reconcile to the published unit cost',()=>{
 const c=read('assets/blended/costs.json'),name=Object.keys(c.item_components)[0];
 const invalid={...c,item_components:{...c.item_components,[name]:{...c.item_components[name],purchase:c.item_components[name].purchase+1}}};
 assert.throws(()=>validateCosts(invalid),/uitsplitsing/);
});
