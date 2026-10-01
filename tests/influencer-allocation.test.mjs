import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compute,series} from '../assets/blended/metrics.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
test('gift investment is allocated once across all influencer revenue and deducted from profit',()=>{
 const data=Object.fromEntries(['shopify','meta','google','creators'].map(k=>[k,read('data/'+k+'.json')]));
 const costs=read('assets/blended/costs.json');
 const from=data.creators.orders.map(o=>o.d).sort()[0],to=data.creators.orders.map(o=>o.d).sort().at(-1);
 const full=compute(data,costs,from,to,'infl');
 const expected=data.creators.startup_costs.total;
 assert.equal(expected,2349.28);
 assert(Math.abs(full.channels.infl.giftAllocated-expected)<1e-8);
 const daily=series(data,costs,from,to,'infl');
 assert(Math.abs(daily.reduce((n,r)=>n+r.channels.infl.giftAllocated,0)-expected)<1e-8);
 const without=compute(data,{...costs,influencer_gifting:null},from,to,'infl');
 assert(Math.abs(without.result-full.result-expected)<1e-8);
 assert(Math.abs(full.spend-without.spend-expected)<1e-8);
});
