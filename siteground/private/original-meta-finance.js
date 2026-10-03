// Same source datasets and financial engine as cijfers.lumeworks.nl.
// Private build only: retain the bonus rate and periods; use the requested dynamic cost basis.
let lwFinancialData, lwFinancialCosts, lwFinancialError;
try {
  lwFinancialCosts=_loadJSON('assets/blended/costs.json');
  if(!lwFinancialCosts.meta_management || !Number.isFinite(lwFinancialCosts.meta_management.bonus_rate) || !Number.isFinite(lwFinancialCosts.assumed_vat))throw Error('Kostenbasis ontbreekt');
  lwFinancialData={meta:_META,google:_GOOGLE,shopify:_SHOPIFY,
    creators:_loadJSON('data/creators.json'),returns:_loadJSON('data/returns.json')};
  if(lwFinancialData.returns?.version!==2 || !lwFinancialData.returns.complete)
    throw Error('Retourregistratie is onvolledig');
} catch(error){lwFinancialError='Financiële onderbouwing kon niet worden geladen. Vernieuw de pagina.';}
const lwMoney=v=>v==null?'—':eur(v);
function lwTargetRoas(be,pct){
 const vat=1+(lwFinancialCosts?.assumed_vat??0);
 return be>0 && 1/be-pct/vat>0?1/(1/be-pct/vat):null;
}
function lwFinancial(from,to){
  if(lwFinancialError)return null;
  try{return lwFinanceEngine.compute(lwFinancialData,lwFinancialCosts,from,to,'meta');}
  catch(error){lwFinancialError='Financiële onderbouwing is onvolledig. Vernieuw de pagina.';return null;}
}
function lwNetMetrics(m){
  if(!m)return {rev:null,bruto:null,net:null,roas:null};
  const media=m.channels.meta.mediaSpend;
  const reserve=m.returnReserve;
  // Expected refund revenue includes VAT; operating result remains excluding VAT.
  const rev=m.revenueIncl==null?null:m.revenueIncl-(reserve.available?reserve.refundExcl*(1+lwFinancialCosts.assumed_vat):0);
  const bruto=m.actualResult==null?null:m.actualResult+m.spend;
  return {rev,bruto,net:m.result,roas:media>0 && rev!=null?rev/media:null};
}
function lwNetDailySource(from,to){
 if(lwFinancialError || filtersActive())return [];
 return lwFinanceEngine.series(lwFinancialData,lwFinancialCosts,from,to,'meta','day').map(r=>({
  d:r.key,spend:r.channels.meta.mediaSpend,purch:r.count,rev:lwNetMetrics(r).rev,pro:0,shopRev:0
 }));
}
function lwPaintFinance(){
  const pd=PERIODS[P]||PERIODS.aug, m=lwFinancial(pd.from,pd.to), v=lwNetMetrics(m);
  const filtered=filtersActive();
  function tile(key,label,value,note){
    const node=document.querySelector('[data-kpi="'+key+'"]');if(!node)return;
    node.querySelector('.kpi-lbl').textContent=label;
    node.querySelector('.kpi-val').textContent=value;
    node.querySelector('.kpi-sub').textContent=note;
    node.classList.remove('good','warn','bad');
    if(key==='net' && !filtered && v.net!=null)node.classList.add(v.net>=0?'good':'bad');
  }
  tile('rev','Netto Meta-omzet',filtered?'—':lwMoney(v.rev),filtered?'niet op advertentiegroep herleidbaar':'incl. btw · na echte en begrote retouren');
  tile('roas','Netto Meta ROAS',!filtered && v.roas!=null?x2(v.roas):'—',filtered?'niet op advertentiegroep herleidbaar':'na echte en begrote retouren');
  tile('bruto','Marge vóór ads',filtered?'—':lwMoney(v.bruto),filtered?'niet op advertentiegroep herleidbaar':'excl. btw · na werkelijke correcties');
  tile('net','Netto resultaat',filtered?'—':lwMoney(v.net),filtered?'bekijk het volledige account':m && !m.returnReserve.available?'incl. Daan · retourbegroting niet beschikbaar':'incl. Daan en begrote retouren · excl. btw');
  const headline=document.getElementById('kpiHeadline');
  headline.className='kpi-headline';
  headline.textContent=lwFinancialError || (m?.result==null?'Netto resultaat nog niet vast te stellen: controleer de financiële onderbouwing.':
    'Meta '+(m.result>=0?'houdt '+lwMoney(m.result)+' over':'maakt '+lwMoney(-m.result)+' verlies')+' na kosten, Daan en retouren.'+(filtered?' Financieel resultaat geldt voor het volledige account.':''));
  const available=m && m.result!=null?m.result+m.channels.meta.mediaSpend:null;
  const be=available>0 && v.rev>0?v.rev/available:null;
  document.getElementById('mBe').textContent=be==null?'—':x2(be);
  document.getElementById('mBeSub').textContent='incl. retouren, begroting en Daan';
  document.getElementById('mScaleSub').textContent='incl. dynamische bonus · marge excl. btw';
  document.getElementById('bonusAmt').textContent=lwMoney(m?.management.bonus);
  document.getElementById('bonusBadge').textContent=lwFinancialCosts?.meta_management?'ROAS-bonus '+(lwFinancialCosts.meta_management.bonus_rate*100)+'% · eigen bonus in BEROAS vanaf 1 okt':'Kostenbasis ontbreekt';
  document.getElementById('roasHeroLbl').textContent='NETTO META ROAS';
  document.getElementById('roasHeroVal').textContent=v.roas==null?'—':x2(v.roas);
  document.getElementById('roasDelta').textContent='Na werkelijke en begrote retouren';
  document.getElementById('mRoas').textContent=v.roas==null?'—':x2(v.roas);
  document.getElementById('mRoasSub').textContent='na retourcorrecties';
  const target=pct=>lwTargetRoas(be,pct);
  document.getElementById('mScale').textContent=target(SCALE_T)==null?'—':x2(target(SCALE_T));
  if(be!=null && target(SCALE_H)!=null && v.roas!=null){CX.be=be;renderGauge(be,target(SCALE_T),target(SCALE_H),v.roas,m.count);updateSim();}
  else document.getElementById('gaugeOuter').innerHTML='<p class="lw-finance-note">Geen haalbare break-even-ROAS bij deze kostenbasis.</p>';
  let details=document.getElementById('lwFinanceDetails');
  if(!details){details=document.createElement('details');details.id='lwFinanceDetails';details.className='lw-finance';document.getElementById('kpiHeadline').after(details);}
  if(!m){details.innerHTML='<summary>Financiële onderbouwing</summary><p>'+lwFinancialError+'</p>';return;}
  const baseRows=m.marginBuild.filter(r=>r.key!=='margin');
  const reserve=m.returnReserve,w=m.correctionAllocation.weights;
  const find=key=>baseRows.find(r=>r.key===key)?.value;
  const add=(a,b)=>a==null||b==null?null:a+b;
  const combinedReturns=add(find('returns'),reserve.available?find('returnReserve'):0);
  const rows=baseRows.filter(r=>!['returnReserve','daanBonus'].includes(r.key)).map(r=>r.key==='returns'?{...r,label:'Retourkosten',value:combinedReturns}:r.key==='daanFixed'?{...r,label:'Daan · vergoeding',value:add(r.value,find('daanBonus'))}:r);
  const percentage=(value,kind)=>value==null||!(m.revenue>0)?'—':((kind==='total'?value:Math.abs(value))/m.revenue*100).toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
  const lines=rows.map(r=>'<div class="lw-finance-row '+r.kind+'" data-finance-key="'+r.key+'"><span>'+lwEscapeAttr(r.label)+'</span><strong>'+lwMoney(r.value)+' <span style="font-weight:400;color:#93a2b8">— '+percentage(r.value,r.kind)+'</span></strong></div>').join('');
  const model=reserve.available?'Retourbegroting: '+(reserve.rate*100).toFixed(2)+'% retourorders · '+reserve.matureOrders+' afgeronde orders · mediaan '+reserve.median+' dagen · horizon '+reserve.horizon+' dagen.':reserve.reason;
  const expected='<details class="lw-finance-note"><summary style="padding:8px 0">Uitsplitsing en break-evenberekening</summary><p>Retourkosten: '+lwMoney(-find('returns'))+' werkelijke afhandeling + '+(reserve.available?lwMoney(reserve.impact):'onbekende begroting')+' nog verwachte retouren. Reeds terugbetaalde omzet staat apart bij omzetcorrecties.</p>'+
    (reserve.available?'<p>Begrote retouren: '+lwMoney(reserve.refundExcl)+' retouromzet excl. btw + '+lwMoney(reserve.handling)+' afhandeling − '+lwMoney(reserve.overheadCredit)+' correctie overige kosten.</p>':'')+
    '<p>Daan: '+lwMoney(-find('daanFixed'))+' vast + '+lwMoney(find('daanBonus')==null?null:-find('daanBonus'))+' bonus.</p><p>De kostprijssheet levert product- en leveringskosten. Betaalkosten, overige kosten, werkelijke retouren, retourbegroting en Daan worden daarnaast verwerkt.</p><p>Operationele BEROAS = netto Meta-omzet incl. btw ('+lwMoney(v.rev)+') ÷ beschikbare marge vóór advertenties, na Daan ('+lwMoney(available)+') = '+(be==null?'niet haalbaar':x2(be))+'. Bonus: '+(lwFinancialCosts.meta_management.bonus_rate*100)+'% × (netto omzet − advertentiekosten × BEROAS), per contractblok. Vanaf 1 oktober wordt de eigen bonus in de BEROAS verwerkt; bonus en BEROAS worden tegelijk opgelost. Vóór 1 oktober blijft de oorspronkelijke bonusberekening behouden. Verliesdagen tellen mee; het bloktotaal heeft minimum nul.</p></details>';
  details.innerHTML='<summary>Netto marge en retouren <span>'+lwMoney(m.result)+'</span></summary><div class="lw-finance-body"><p class="lw-finance-note">Percentages van netto omzet excl. btw, na werkelijke omzetcorrecties.</p>'+lines+expected+
    '<p class="lw-finance-note">'+lwEscapeAttr(model||'Retourbegroting niet beschikbaar')+(reserve.stale?' Retourbron is ouder dan 48 uur; begroting is niet verder afgebouwd.':'')+'</p>'+
    '<p class="lw-finance-note">'+(w?'Meta krijgt '+(w.meta*100).toFixed(1)+'% van de niet-influencercorrecties op basis van aankopen. Google telt alleen non-branded mee.':'Kanaaltoewijzing ontbreekt.')+' €'+(lwFinancialCosts.returns?.cost_per_return??20)+' per ontvangen retourpakket; annuleringen tellen niet als retourpakket. Werkelijke retouren vervangen de begroting automatisch.</p></div>';
  document.getElementById('beSummary').innerHTML='<div class="be-stat"><div class="be-lbl">Operationele BEROAS</div><div class="be-val">'+(be==null?'—':x2(be))+'</div></div><p class="lw-finance-note">Inclusief retouren, begroting en vaste vergoeding. Zie de volledige kostenopbouw hierboven. De producttabel hieronder toont alleen de kostprijssheet.</p>';
  renderKpiChart();
}
const lwOriginalKpiBar=renderKpiBar;
renderKpiBar=function(...args){lwOriginalKpiBar(...args);lwPaintFinance();};
const lwOriginalAggregate=kpiAggregate;
kpiAggregate=function(gran,from,to,seg,platform,placement){
  const original=lwOriginalAggregate(gran,from,to,seg,platform,placement);
  if(!lwFinancialData || lwFinancialError || (seg&&seg!=='all') || (platform&&platform!=='all') || (placement&&placement!=='all'))
    return original.map(r=>({...r,rev:null,roas:null,bruto:null,net:null}));
  const start=from||'2026-08-05',end=to||SNAP;
  const corrected=new Map(lwFinanceEngine.series(lwFinancialData,lwFinancialCosts,start,end,'meta',gran).map(r=>[gran==='month'?r.key.slice(0,7):r.key,r]));
  return original.map(r=>({...r,...lwNetMetrics(corrected.get(r.key))}));
};
KPI_META.rev.label='Netto Meta-omzet · incl. btw';
KPI_META.roas.label='Netto Meta ROAS';
KPI_META.bruto.label='Marge vóór ads · excl. btw';
KPI_META.net.label='Netto resultaat · incl. Daan en retouren';
