import {compute,series,sum,shift,googleScopeData} from './metrics.js?v=meta-review-1';
const START='2026-08-05';
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export function calendarFee(date,monthly,contractStart=START){
 if(date<contractStart)return 0;
 const d=new Date(date+'T12:00:00Z');return monthly/new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
}
export function reviewWeights(data,costs,from,to,basis='revenue'){
 const all=compute(data,costs,from,to,'all');
 if(basis==='orders')return {basis,weights:all.correctionAllocation.weights,normalized:all.correctionAllocation.normalized};
 if(basis!=='revenue')throw Error('Onbekende retourverdeling');
 if(!data.meta||!data.google||!data.creators||!data.shopify)return {basis,weights:null,reason:'Omzetbronnen voor de retourverdeling ontbreken.'};
 const creator=compute(data,costs,from,to,'infl');
 const gross=all.marginBuild.find(x=>x.key==='gross')?.value;
 const creatorGross=creator.marginBuild.find(x=>x.key==='gross')?.value;
 const denominator=gross==null||creatorGross==null?null:Math.max(0,gross-creatorGross);
 const nonbrand=googleScopeData(data,'nonbrand');
 if(denominator===null||!nonbrand.google)return {basis,weights:null,reason:'Omzetaandelen zijn niet volledig beschikbaar.'};
 const metaRevenue=sum(data.meta.daily_meta.filter(x=>x.d>=from&&x.d<=to),x=>x.rev7+x.rev1v);
 const googleRevenue=sum(nonbrand.google.daily_google.filter(x=>x.d>=from&&x.d<=to),'rev');
 if(denominator===0 && (metaRevenue>0||googleRevenue>0))return {basis,weights:null,reason:'Wel toegeschreven advertentieomzet, maar geen winkelomzet in deze periode.'};
 const meta=denominator>0?metaRevenue/denominator:0,google=denominator>0?googleRevenue/denominator:0,normalization=Math.max(1,meta+google);
 return {basis,weights:{meta:meta/normalization,google:google/normalization,other:Math.max(0,1-(meta+google)/normalization)},normalized:normalization>1,denominator,metaRevenue,googleRevenue,creatorGross,
  explanation:'Influencerretouren worden rechtstreeks toegerekend. De overige correcties en retourbegroting volgen de omzetaandelen; overlappende attributie wordt genormaliseerd.'};
}
export function reviewBreakEven({marginRate,netContributionRate,bonusRate,spend,fixed}){
 if(!(spend>0)||!(marginRate>0)||!(netContributionRate>0))return {product:null,current:null,scenario:null};
 const product=1/marginRate,scenario=(spend+fixed)/(spend*netContributionRate);
 // Hold product mix and proportional return burden constant. Existing bonus
 // starts at the original product BEROAS; scenario bonus starts after all costs.
 const profit=roas=>roas*spend*netContributionRate-spend-fixed-Math.max(0,(roas*spend-spend/marginRate)*bonusRate);
 let hi=Math.max(product,scenario,1);while(profit(hi)<0&&hi<1e6)hi*=2;
 if(profit(hi)<0)return {product,current:null,scenario};
 let lo=0;for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(profit(mid)>=0)hi=mid;else lo=mid;}
 return {product,current:hi,scenario};
}
export function metaReview(data,costs,from,to,{allocation='revenue',monthlyFixed=costs.meta_management?.monthly_fixed}={}){
 if(!validDay(from)||!validDay(to)||from<START||to<from)throw Error('Kies datums vanaf 5 augustus 2026.');
 if(!Number.isFinite(monthlyFixed)||monthlyFixed<0||monthlyFixed>100000)throw Error('Ongeldige vaste vergoeding.');
 const contract=costs.meta_management;if(!contract)throw Error('Bonusafspraak ontbreekt.');
 const current=compute(data,costs,from,to,'meta');
 const allocationInfo=reviewWeights(data,costs,from,to,allocation);
 const options=allocationInfo.weights?{correctionWeights:allocationInfo.weights}:{};
 const allocated=compute(data,costs,from,to,'meta',options);
 const warnings=[];
 if(!allocationInfo.weights)warnings.push(allocationInfo.reason??'Retourverdeling ontbreekt.');
 if(allocationInfo.normalized)warnings.push('Meta en Google claimen samen meer omzet dan de winkel. Hun retouraandelen zijn genormaliseerd; kanaalomzet mag niet worden opgeteld.');
 if(!allocated.returnReserve.available)warnings.push('Retourbegroting ontbreekt; het testresultaat blijft onbekend.');
 if(allocated.returnReserve.stale)warnings.push('De retouraudit is ouder dan 48 uur; begrotingen kunnen achterlopen.');
 const daily=new Map(),periods=[];
 let bonus=0,fixed=0;
 for(let d=from;d<=to;d=shift(d,1)){const fee=calendarFee(d,monthlyFixed,contract.contract_start);fixed+=fee;daily.set(d,{d,fixed:fee,contribution:null,adjustment:null,bonus:null,total:null});}
 for(const p of current.management.periods){
  const start=p.calculationFrom??[p.from,contract.calculation_start??START,START].sort().at(-1),until=p.through;
  const selected=[...daily.keys()].filter(d=>d>=p.from&&d<=p.to);
  const blockAllocation=reviewWeights(data,costs,start,until,allocation);
  const blockOptions={includeDaan:false,correctionWeights:blockAllocation.weights};
  const block=compute(data,costs,start,until,'meta',blockOptions);
  const rows=series(data,costs,start,until,'meta','day',blockOptions);
  const complete=blockAllocation.weights&&block.marginRate>0&&block.returnReserve.available&&rows.length&&rows.every(r=>r.result!==null)&&selected.every(d=>d<=until)&&p.bonus!==null;
  if(!complete){bonus=null;periods.push({from:p.from,to:p.to,through:until,complete:false,bonus:null});continue;}
  const contributions=rows.map(r=>({d:r.from,contribution:(r.result-calendarFee(r.from,monthlyFixed,contract.contract_start))/block.marginRate*contract.bonus_rate}));
  const raw=sum(contributions,'contribution'),total=Math.max(0,raw),closingAdjustment=total-raw;
  const days=contributions.map(r=>({...r,adjustment:r.d===until?closingAdjustment:0,bonus:r.contribution+(r.d===until?closingAdjustment:0)}));
  const part=sum(days.filter(r=>selected.includes(r.d)),'bonus');if(bonus!==null)bonus+=part;
  for(const row of days){const target=daily.get(row.d);if(target)Object.assign(target,row,{total:target.fixed+row.bonus});}
  periods.push({from:p.from,to:p.to,through:until,calculationFrom:start,complete:true,provisional:until<p.to,rawBonus:raw,bonus:total,closingAdjustment,allocated:part,marginRate:block.marginRate,allocation:blockAllocation,daily:days});
 }
 const valid=!!allocationInfo.weights&&allocated.returnReserve.available&&allocated.result!==null&&allocated.management.total!==null&&bonus!==null;
 const totalDaan=bonus===null?null:fixed+bonus;
 const operating=allocated.result===null||allocated.management.total===null?null:allocated.result+allocated.management.total;
 const companyProfit=valid?operating-totalDaan:null;
 const grossRevenue=allocated.channels.meta.grossRevenue,spend=allocated.channels.meta.mediaSpend;
 const contributionRate=operating===null||!(grossRevenue>0)||spend===null?null:(operating+spend)/grossRevenue;
 const be=reviewBreakEven({marginRate:allocated.marginRate,netContributionRate:contributionRate,bonusRate:contract.bonus_rate,spend,fixed});
 if(contributionRate!==null&&contributionRate<=contract.bonus_rate)warnings.push('De bonus op omzet boven break-even is relatief hoog tegenover de beschikbare marge. De bestaande afspraak kan winstgevend groeien onmogelijk maken.');
 const store=compute(data,costs,from,to,'all'),storeDays=new Map(series(data,costs,from,to,'all').map(r=>[r.from,r]));
 const chart=series(data,costs,from,to,'meta','day',options).map(r=>{const day=daily.get(r.from),pre=r.result===null||r.management.total===null?null:r.result+r.management.total,s=storeDays.get(r.from);return {d:r.from,currentProfit:r.result,companyProfit:valid&&day?.total!==null&&pre!==null?pre-day.total:null,storeProfit:s?.result??null,storeScenario:valid&&s?.result!==null&&s?.management.total!==null&&day?.total!==null?s.result+s.management.total-day.total:null,currentDaan:r.management.total,scenarioDaan:day?.total??null,contribution:day?.contribution??null,bonus:day?.bonus??null,fixed:day?.fixed??null,returnReserve:r.returnReserve.impact};});
 const projectedRevenue=allocated.revenue===null||allocated.returnReserve.refundExcl===null?null:allocated.revenue-allocated.returnReserve.refundExcl;
 const ledger=allocated.marginBuild.map(row=>row.key==='daanFixed'?{...row,value:-fixed}:row.key==='daanBonus'?{...row,label:'Daan · testbonus na retouren en vaste kosten',value:bonus===null?null:-bonus}:row.key==='result'?{...row,value:companyProfit}:row.key==='margin'?{...row,value:companyProfit!==null&&projectedRevenue>0?companyProfit/projectedRevenue*100:null}:row);
 const adDays=(data.meta?.daily_ads??[]).filter(r=>r.d>=from&&r.d<=to),ads=new Map();
 for(const day of adDays)for(const ad of day.ads??[]){const name=String(ad.n??'Onbekend');if(!ads.has(name))ads.set(name,{name,spend:0,revenueIncl:0,orders:0});const target=ads.get(name);target.spend+=ad.spend??0;target.revenueIncl+=(ad.rev7??0)+(ad.rev1v??0);target.orders+=ad.purch??0;}
 return {period:{from,to},allocation:allocationInfo,contract,current,allocated,store,scenario:{monthlyFixed,fixed,bonus,totalDaan,companyProfit,storeProfit:valid&&store.result!==null&&store.management.total!==null?store.result+store.management.total-totalDaan:null,operating,projectedRevenue,margin:companyProfit!==null&&projectedRevenue>0?companyProfit/projectedRevenue*100:null,change:companyProfit===null||current.result===null?null:companyProfit-current.result,breakEven:be},daily:chart,periods,ledger,warnings,
  ads:[...ads.values()].map(r=>({...r,revenueExcl:r.revenueIncl/(1+costs.assumed_vat),roas:r.spend>0?r.revenueIncl/r.spend:null})).sort((a,b)=>b.spend-a.spend),
  explanation:'Testmodel, geen wijziging van de bonusafspraak: dezelfde bonusfactor op omzet boven break-even, maar pas nadat toegerekende werkelijke/verwachte retourlast en de vaste kalenderdagvergoeding zijn gedekt. Verliesdagen tellen negatief mee; alleen het volledige contractblok krijgt een ondergrens van nul. De bestaande afspraak blijft zichtbaar ter vergelijking.'};
}
