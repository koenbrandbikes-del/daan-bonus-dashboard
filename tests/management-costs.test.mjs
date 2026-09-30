import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {managementCosts,compute,shift} from '../assets/blended/metrics.js';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url)));
const costs=read('assets/blended/costs.json');
const data={meta:read('data/meta.json'),shopify:read('data/shopify.json'),google:read('data/google.json'),creators:read('data/creators.json')};
data.meta.snap='2026-09-30';
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('management bonus matches original Meta formula and daily allocations reconcile',()=>{
 const m=managementCosts(data,costs,'2026-09-14','2026-09-30');
 const original=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/function bonCalc\(fx,tb\)\{[\s\S]*?\n\}/)[0];
 const ctx={BONUS_PCT:0.10};vm.createContext(ctx);vm.runInContext(original,ctx);
 const p=m.periods[0];
 const reference=ctx.bonCalc({be:p.breakEvenRoas},{spend:p.spend,roas:p.revenue/p.spend});
 close(p.bonus,reference.raw);close(m.bonus,reference.raw);
 close(m.fixed,1500*17/30);
 let total=0;for(let d='2026-09-14';d<='2026-09-30';d=shift(d,1))total+=managementCosts(data,costs,d,d).total;
 close(m.total,total);
});
test('fixed fee follows calendar-month lengths and no fee before contract',()=>{
 close(managementCosts(data,costs,'2026-09-01','2026-09-30').fixed,1500);
 close(managementCosts(data,costs,'2026-08-01','2026-08-31').fixed,1500);
 close(managementCosts(data,costs,'2026-07-01','2026-07-15').fixed,0);
});
test('company result subtracts fixed and bonus exactly once, overhead remains 4%',()=>{
 const withFee=compute(data,costs,'2026-09-23','2026-09-29');
 const old=compute(data,{...costs,meta_management:undefined},'2026-09-23','2026-09-29');
 close(old.result-withFee.result,withFee.management.total);
 close(withFee.spend-old.spend,withFee.management.total);
 close(withFee.overhead,withFee.revenue*0.04);
 close(withFee.channels.meta.spend,withFee.channels.meta.mediaSpend+withFee.management.total);
});
test('missing bonus source stays unknown rather than a zero cost',()=>{
 const m=managementCosts({...data,meta:null},costs,'2026-09-23','2026-09-29');
 assert.equal(m.bonus,null);assert.equal(m.total,null);close(m.fixed,350);
});
