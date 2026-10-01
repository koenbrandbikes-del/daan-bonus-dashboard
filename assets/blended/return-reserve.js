const day=s=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const age=(a,b)=>Math.floor((Date.parse(b)-Date.parse(a))/864e5);
const total=(rows,key)=>rows.reduce((n,r)=>n+r[key],0);
// A cohort is only mature after at least four weeks AND the observed lag tail.
// Unreported new returns never silently age out when the source stops syncing.
function buildReserve(data,costs,from,to) {
 const source=data.returns;
 if(!source?.complete)return {available:false,reason:'Retourhistorie ontbreekt',impact:null,rows:[]};
 const asOf=day(source.synced_at),stale=Date.now()-Date.parse(source.synced_at)>48*3600e3;
 const known=new Map((data.shopify?.orders||[]).map(o=>[o.num,o]));
 const audited=source.orders.filter(o=>!o.test && !known.get(o.num)?.test && o.paid_incl>0 && !o.cancelled);
 const delays=audited.flatMap(o=>o.refunds.filter(r=>r.kind==='received_return').map(r=>age(o.d,r.d))).sort((a,b)=>a-b);
 const p95=delays.length?delays[Math.ceil(delays.length*.95)-1]:null;
 const horizon=Math.max(28,p95==null?28:Math.ceil((p95+1)/7)*7);
 const mature=audited.filter(o=>age(o.d,asOf)>=horizon);
 const returned=mature.filter(o=>o.refunds.some(r=>r.kind==='received_return'));
 const available=mature.length>=50 && returned.length>=3;
 const rate=available?returned.length/mature.length:null;
 const matureEvents=returned.map(o=>({delay:Math.min(...o.refunds.filter(r=>r.kind==='received_return').map(r=>age(o.d,r.d))),fraction:Math.min(1,o.refunds.filter(r=>r.kind==='received_return').reduce((s,r)=>s+r.amount_incl,0)/o.paid_incl)}));
 const fraction=available?total(matureEvents,'fraction')/matureEvents.length:null;
 const median=delays.length?(delays[Math.floor((delays.length-1)/2)]+delays[Math.floor(delays.length/2)])/2:null;
 const seen=new Set(source.orders.map(o=>o.num));
 const recent=(data.shopify?.orders||[]).filter(o=>!seen.has(o.num) && !o.test && o.incl>0 && !costs.returns?.orders?.some(r=>r.num===o.num)).map(o=>({num:o.num,d:o.d,paid_incl:o.paid_incl??o.incl,refunds:[],unconfirmed:true}));
 const rows=available?[...audited,...recent].filter(o=>o.d>=from && o.d<=to && !o.refunds.length).map(o=>{
   const days=Math.max(0,age(o.d,asOf)),cdf=days>=horizon?1:matureEvents.filter(r=>r.delay<=days).length/matureEvents.length;
   const probability=rate*(1-cdf)/(1-rate*cdf);
   const packages=probability,refundExcl=probability*o.paid_incl*fraction/(1+costs.assumed_vat);
   const handling=packages*(costs.returns?.cost_per_return??20),overheadCredit=refundExcl*costs.overhead_rate;
   return {num:o.num,d:o.d,probability,packages,refundExcl,handling,overheadCredit,impact:refundExcl+handling-overheadCredit};
 }):[];
 const weeks=new Map();
 for(const o of audited){const d=new Date(o.d+'T12:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const week=d.toISOString().slice(0,10);if(!weeks.has(week))weeks.set(week,{week,orders:0,returns:0,lagTotal:0});const w=weeks.get(week);w.orders++;const events=o.refunds.filter(r=>r.kind==='received_return');if(events.length){w.returns++;w.lagTotal+=Math.min(...events.map(r=>age(o.d,r.d)));}}
 return {available,stale,asOf,horizon,rate,fraction,median,p95,matureOrders:mature.length,matureReturns:returned.length,reason:available?null:'Te weinig afgeronde orders voor een betrouwbare retourbegroting',rows,
  impact:available?total(rows,'impact'):null,packages:available?total(rows,'packages'):null,refundExcl:available?total(rows,'refundExcl'):null,handling:available?total(rows,'handling'):null,overheadCredit:available?total(rows,'overheadCredit'):null,
  weeks:[...weeks.values()].map(w=>({...w,meanLag:w.returns?w.lagTotal/w.returns:null,mature:age(w.week,asOf)>=horizon+6}))};
}

const models=new WeakMap();
export function returnReserve(data,costs,from,to) {
 const source=data.returns;
 if(source?.version===2)return aggregateReserve(data,costs,from,to);
 if(!source?.complete)return {available:false,reason:'Retourhistorie ontbreekt',impact:null,rows:[]};
 let cached=models.get(source);
 if(!cached || cached.shopify!==data.shopify || cached.costs!==costs){cached={shopify:data.shopify,costs,model:buildReserve(data,costs,source.coverage_from,'9999-12-31')};models.set(source,cached);}
 const model=cached.model,rows=model.rows.filter(r=>r.d>=from && r.d<=to);
 return {...model,rows,stale:Date.now()-Date.parse(source.synced_at)>48*3600e3,...Object.fromEntries(['impact','packages','refundExcl','handling','overheadCredit'].map(k=>[k,model.available?total(rows,k):null]))};
}

const financialKeys=['incl','excl','fixed','knownFixed','fees','cost','returnCost','refundedIncl','refundedOrders','receivedReturnPackages','receivedReturns','unknownReturns','overhead','unknown','orders','purchase','inbound_shipping','fulfillment','source_adjustment','unallocated'];
export function auditedFinance(data,from,to,key) {
 if(data.returns?.version!==2)return null;
 const rows=data.returns.daily.filter(r=>r.d>=from && r.d<=to);
 return Object.fromEntries(financialKeys.map(k=>[k,rows.some(r=>r[key][k]==null)?null:rows.reduce((n,r)=>n+r[key][k],0)]));
}
export function applyAudit(gross,auditedGross,auditedActual) {
 if(!auditedGross || !auditedActual)return gross;
 const corrected={...gross};
 for(const k of financialKeys) {
  if(['orders','unknown'].includes(k))continue;
  if(['returnCost','refundedIncl','refundedOrders','receivedReturnPackages','receivedReturns','unknownReturns'].includes(k)) corrected[k]=auditedActual[k];
  else corrected[k]=gross[k]==null || auditedGross[k]==null || auditedActual[k]==null?null:gross[k]-(auditedGross[k]-auditedActual[k]);
 }
 return corrected;
}
function aggregateReserve(data,costs,from,to) {
 const source=data.returns,model=source.model,selected=source.daily.filter(r=>r.d>=from && r.d<=to);
 const keys=['impact','packages','refundExcl','handling','overheadCredit'];
 const parts=who=>Object.fromEntries(keys.map(k=>[k,model.available?selected.reduce((n,r)=>n+r.reserve[who][k],0):null]));
 const all=parts('all'),creator=parts('creator');
 // Orders first seen after the audit retain day-zero risk until the next sync.
 if(model.available){
  const creators=new Set((data.creators?.orders||[]).map(o=>o.num));
  const fresh=(data.shopify?.orders||[]).filter(o=>!o.test && o.incl>0 && o.d>model.asOf && o.d>=from && o.d<=to);
  for(const o of fresh){const refundExcl=o.incl*model.rate*model.fraction/(1+costs.assumed_vat),handling=model.rate*(costs.returns?.cost_per_return??20),overheadCredit=refundExcl*costs.overhead_rate;
   const extra={impact:refundExcl+handling-overheadCredit,refundExcl,handling,overheadCredit,packages:model.rate};
   for(const k of keys){all[k]+=extra[k];if(creators.has(o.num))creator[k]+=extra[k];}
  }
 }
 return {...model,...all,creatorParts:creator,rows:[],stale:Date.now()-Date.parse(source.synced_at)>48*3600e3};
}
