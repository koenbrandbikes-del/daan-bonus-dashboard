import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {managementCosts,compute,shift,series} from '../assets/blended/metrics.js';
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

test('Meta Daan switch reconciles profit, costs and chart including company totals',()=>{
 const f='2026-09-01',t='2026-09-30';
 const withDaan=compute(data,costs,f,t,'meta');
 const without=compute(data,costs,f,t,'meta',{includeDaan:false});
 close(without.result-withDaan.result,withDaan.management.total);
 close(withDaan.spend-without.spend,withDaan.management.total);
 close(without.spend,without.channels.meta.mediaSpend);
 close(without.revenue,withDaan.revenue);
 for(const includeDaan of [true,false]) {
  const total=compute(data,costs,f,t,'meta',{includeDaan});
  for(const gran of ['day','week','month']) {
   const rows=series(data,costs,f,t,'meta',gran,{includeDaan});
   close(rows.reduce((n,r)=>n+r.result,0),total.result);
  }
 }
 close(compute(data,costs,f,t,'all',{includeDaan:false}).result-compute(data,costs,f,t,'all').result,withDaan.management.total);
 assert.equal(compute({...data,shopify:null},costs,f,t,'meta',{includeDaan:false}).result,null);
});

function blockFixture(contributions, snap='2026-09-30') {
 const fixtureCosts={...costs,meta_management:{monthly_fixed:1500,contract_start:'2026-09-01',bonus_period_days:30,bonus_rate:0.1},returns:null};
 const shopify={orders:[{d:'2026-09-01',num:'#fixture',items:['LumeWorks Prime'],incl:149}]};
 const base={meta:{snap,daily_meta:[]},shopify};
 const margin=149/1.21-44.5-149*fixtureCosts.payment_rate-(149/1.21)*fixtureCosts.overhead_rate;
 const be=149/margin;
 for(let d='2026-09-01',i=0;d<=snap;d=shift(d,1),i++) base.meta.daily_meta.push({d,spend:1000,rev7:1000*be+(contributions[i]||0)/0.1,rev1v:0,purch:1});
 return {data:base,costs:fixtureCosts};
}
test('positive and negative days offset without a daily floor and daily costs reconcile',()=>{
 const f=blockFixture([100,-40]);
 const full=managementCosts(f.data,f.costs,'2026-09-01','2026-09-30');
 close(full.bonus,60);close(full.fixed,1500);close(full.total,1560);
 close(full.daily[0].contribution,100);close(full.daily[1].contribution,-40);
 close(managementCosts(f.data,f.costs,'2026-09-02','2026-09-02').bonus,-40);
 close(full.periods[0].closingAdjustment,0);
 close(full.daily.reduce((n,d)=>n+d.total,0),full.total);
});
test('negative block receives one closing correction, not a floor on every loss day',()=>{
 const f=blockFixture([100,-140]);
 const m=managementCosts(f.data,f.costs,'2026-09-01','2026-09-30');
 close(m.bonus,0);close(m.periods[0].rawBonus,-40);
 close(m.daily[1].contribution,-140);close(m.daily[1].bonus,-140);
 close(m.daily.at(-1).adjustment,40);
 assert.equal(m.daily.filter(d=>Math.abs(d.adjustment)>1e-7).length,1);
 close(m.daily.reduce((n,d)=>n+d.bonus,0),0);
 close(m.total,1500);
});
test('pending block floor is provisional and moves to latest available day',()=>{
 const f=blockFixture([100,-140],'2026-09-02');
 const m=managementCosts(f.data,f.costs,'2026-09-01','2026-09-02');
 close(m.bonus,0);close(m.daily.at(-1).contribution,-140);close(m.daily.at(-1).adjustment,40);
 assert.equal(m.periods[0].through,'2026-09-02');
 const later=blockFixture([100,-140,100],'2026-09-03');
 const n=managementCosts(later.data,later.costs,'2026-09-01','2026-09-03');
 close(n.bonus,60);close(n.daily[1].bonus,-140);close(n.daily[1].adjustment,0);
});
test('missing middle day or duplicate day remains unknown while fixed fee stays known',()=>{
 for(const variant of ['missing','duplicate']) {
  const f=blockFixture([100,-40]);
  if(variant==='missing') f.data.meta.daily_meta.splice(10,1);
  else f.data.meta.daily_meta.push({...f.data.meta.daily_meta[10]});
  const m=managementCosts(f.data,f.costs,'2026-09-01','2026-09-30');
  assert.equal(m.bonus,null);assert.equal(m.total,null);close(m.fixed,1500);
  assert(m.daily.every(d=>d.bonus===null && d.fixed===50));
 }
});
