// Private Meta cost basis: preserve rate, calendar fee and signed daily allocation.
// Bonus is zero at operational break-even, so it does not enter its own denominator.
export function makeDynamicManagement(compute,contractManagement){
 return function(data,costs,from,to){
  const selected=contractManagement(data,costs,from,to),cfg=costs.meta_management;
  if(!cfg)return selected;
  let bonus=0;const periods=[],daily=new Map(selected.daily.map(r=>[r.d,{...r}]));
  const vat=1+costs.assumed_vat;
  for(const block of selected.periods){
   const start=block.calculationFrom|| (cfg.calculation_start && cfg.calculation_start>block.from?cfg.calculation_start:block.from);
   const end=block.through;
   const rows=data.meta?.daily_meta?.filter(r=>r.d>=start && r.d<=end)||[];
   const dates=new Set(rows.map(r=>r.d));
   let complete=start>= '2026-08-05' && end>=start && dates.size===rows.length;
   for(let d=start;complete && d<=end;d=new Date(Date.parse(d)+864e5).toISOString().slice(0,10))if(!dates.has(d))complete=false;
   if(!complete || [...daily.values()].some(r=>r.periodFrom===block.from && r.d>end)){bonus=null;periods.push({...block,bonus:null});continue;}
   const base=compute(data,costs,start,end,'meta',{skipManagement:true,includeDaan:false});
   const fixed=contractManagement(data,costs,start,end).fixed;
   const netRevenue=base.revenueIncl-(base.returnReserve.available?base.returnReserve.refundExcl*vat:0);
   const available=base.result==null?null:base.result+base.channels.meta.mediaSpend-fixed;
   if(available==null || !base.returnReserve.available || !Number.isFinite(netRevenue)){bonus=null;periods.push({...block,bonus:null});continue;}
   const be=available>0 && netRevenue>0?netRevenue/available:null;
   const weights=base.correctionAllocation.weights;
   const options={skipManagement:true,includeDaan:false,marginRate:base.marginRate,baselineRates:base.baselineRates,correctionWeights:weights};
   const contributions=rows.map(r=>{
    const day=compute(data,costs,r.d,r.d,'meta',options);
    const revenue=day.revenueIncl-day.returnReserve.refundExcl*vat;
    return {d:r.d,contribution:be==null?0:(revenue-r.spend*be)*cfg.bonus_rate};
   });
   const rawBonus=contributions.reduce((s,r)=>s+r.contribution,0),periodBonus=Math.max(0,rawBonus),closing=periodBonus-rawBonus;
   const days=contributions.map(r=>({...r,adjustment:r.d===end?closing:0,bonus:r.contribution+(r.d===end?closing:0)}));
   let allocated=0;
   for(const row of days){const chosen=daily.get(row.d);if(chosen){allocated+=row.bonus;Object.assign(chosen,row,{total:chosen.fixed+row.bonus});}}
   if(bonus!=null)bonus+=allocated;
   periods.push({...block,bonus:periodBonus,rawBonus,closingAdjustment:closing,allocated,breakEvenRoas:be,revenue:netRevenue,availableMargin:available,daily:days,costBasis:'returns-reserve-fixed'});
  }
  return {fixed:selected.fixed,bonus,total:bonus==null?null:selected.fixed+bonus,periods,daily:[...daily.values()]};
 };
}
