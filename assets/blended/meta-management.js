// Preserve the existing 10% ROAS-gap formula; include its own cost from 1 October.
export function solveMetaBonus(revenue,marginBeforeBonus,spend,rate){
 if(![revenue,marginBeforeBonus,spend,rate].every(Number.isFinite)||revenue<0||spend<0||rate<0||rate>1)return null;
 if(revenue<=0 || marginBeforeBonus<=spend || rate===0)return 0;
 // B = rate * (R - S * R / (P - B)). Stable smaller quadratic root.
 const k=rate*revenue;
 const root=Math.sqrt((marginBeforeBonus-k)**2+4*k*spend);
 return 2*k*(marginBeforeBonus-spend)/(marginBeforeBonus+k+root);
}
export function makeDynamicManagement(compute,contractManagement){
 return function(data,costs,from,to){
  const selected=contractManagement(data,costs,from,to),cfg=costs.meta_management;
  if(!cfg || to<'2026-10-01')return selected;
  const daily=new Map(selected.daily.map(r=>[r.d,{...r}])),periods=[];
  const vat=1+costs.assumed_vat;
  for(const block of selected.periods){
   if(block.through<'2026-10-01'){periods.push(block);continue;}
   const start=[block.calculationFrom||block.from,cfg.calculation_start||block.from,'2026-10-01'].sort().at(-1),end=block.through;
   const rows=data.meta?.daily_meta?.filter(r=>r.d>=start && r.d<=end)||[];
   const dates=new Set(rows.map(r=>r.d));
   let complete=end>=start && dates.size===rows.length;
   for(let d=start;complete && d<=end;d=new Date(Date.parse(d)+864e5).toISOString().slice(0,10))if(!dates.has(d))complete=false;
   const chosen=[...daily.values()].filter(r=>r.periodFrom===block.from && r.d>='2026-10-01');
   if(!complete || chosen.some(r=>r.d>end)){for(const r of chosen)Object.assign(r,{bonus:null,total:null});periods.push({...block,bonus:null});continue;}
   const base=compute(data,costs,start,end,'meta',{skipManagement:true,includeDaan:false});
   const fixed=contractManagement(data,costs,start,end).fixed;
   const netRevenue=base.revenueIncl-(base.returnReserve.available?base.returnReserve.refundExcl*vat:0);
   const available=base.result==null?null:base.result+base.channels.meta.mediaSpend-fixed;
   if(available==null || !base.returnReserve.available || !Number.isFinite(netRevenue)){for(const r of chosen)Object.assign(r,{bonus:null,total:null});periods.push({...block,bonus:null});continue;}
   const periodBonus=solveMetaBonus(netRevenue,available,base.channels.meta.mediaSpend,cfg.bonus_rate);
   const be=available-periodBonus>0 && netRevenue>0?netRevenue/(available-periodBonus):null;
   const options={skipManagement:true,includeDaan:false,marginRate:base.marginRate,baselineRates:base.baselineRates,correctionWeights:base.correctionAllocation.weights};
   const contributions=rows.map(r=>{
    const day=compute(data,costs,r.d,r.d,'meta',options);
    const revenue=day.revenueIncl-day.returnReserve.refundExcl*vat;
    return {d:r.d,contribution:be==null?0:(revenue-r.spend*be)*cfg.bonus_rate};
   });
   const rawBonus=contributions.reduce((s,r)=>s+r.contribution,0),closing=periodBonus-rawBonus;
   const days=contributions.map(r=>({...r,adjustment:r.d===end?closing:0,bonus:r.contribution+(r.d===end?closing:0)}));
   let allocated=0;
   for(const row of days){const picked=daily.get(row.d);if(picked){allocated+=row.bonus;Object.assign(picked,row,{total:picked.fixed+row.bonus});}}
   periods.push({...block,calculationFrom:start,bonus:periodBonus,rawBonus,closingAdjustment:closing,allocated,breakEvenRoas:be,revenue:netRevenue,availableMargin:available,daily:days,costBasis:'returns-reserve-fixed-own-bonus',effectiveFrom:'2026-10-01'});
  }
  const days=[...daily.values()],bonus=days.some(r=>r.bonus==null)?null:days.reduce((n,r)=>n+r.bonus,0);
  return {fixed:selected.fixed,bonus,total:bonus==null?null:selected.fixed+bonus,periods,daily:days};
 };
}

// Planning estimate with the same net revenue, return costs and bonus solver.
// This is a new 30-day scenario, not a revision of historical contract payouts.
export function simulateMetaScenario(compute,contractManagement,data,costs,{from,to,dailySpend,roas,referenceFrom,referenceTo}){
 const validDate=d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d;
 if(![from,to,referenceFrom,referenceTo].every(validDate)||from>to||referenceFrom>referenceTo||from<'2026-10-01'||!Number.isFinite(dailySpend)||dailySpend<0||dailySpend>1e9||!Number.isFinite(roas)||roas<0||roas>100)return {available:false,reason:'Ongeldige scenarioperiode of invoer'};
 const days=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;
 if(days>366)return {available:false,reason:'Scenario maximaal één jaar'};
 const dates=new Set((data.meta?.daily_meta||[]).filter(r=>r.d>=referenceFrom&&r.d<=referenceTo).map(r=>r.d));
 for(let d=referenceFrom;d<=referenceTo;d=new Date(Date.parse(d)+864e5).toISOString().slice(0,10))if(!dates.has(d))return {available:false,reason:'Meta-dag ontbreekt in de kostenreferentie'};
 const basis=compute(data,costs,referenceFrom,referenceTo,'meta',{skipManagement:true,includeDaan:false});
 if(basis.result==null||!basis.returnReserve.available||!(basis.expectedRevenueIncl>0)||!costs.meta_management)return {available:false,reason:'Kostenmix of retourbegroting ontbreekt'};
 const contributionRate=(basis.result+basis.channels.meta.mediaSpend)/basis.expectedRevenueIncl;
 const fixed=contractManagement(data,costs,from,to).fixed;
 const spend=dailySpend*days,revenue=spend*roas,availableBeforeBonus=revenue*contributionRate-fixed;
 const bonus=solveMetaBonus(revenue,availableBeforeBonus,spend,costs.meta_management.bonus_rate);
 if(bonus==null)return {available:false,reason:'Scenario kon niet worden berekend'};
 const result=availableBeforeBonus-spend-bonus;
 return {available:true,from,to,days,referenceFrom,referenceTo,spend,revenue,fixed,bonus,totalDaan:fixed+bonus,result,
  contributionRate,breakEvenRoas:revenue>0 && availableBeforeBonus-bonus>0?revenue/(availableBeforeBonus-bonus):null,
  profitMargin:revenue>0?result/(revenue/(1+costs.assumed_vat))*100:null};
}
