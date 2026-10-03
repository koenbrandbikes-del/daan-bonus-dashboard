// Same source datasets and financial engine as cijfers.lumeworks.nl.
// Private build only: retain the bonus rate and periods; use the requested dynamic cost basis.
let lwFinancialData, lwFinancialCosts, lwFinancialError;
try {
  lwFinancialCosts=lwFinanceEngine.validateCosts(_loadJSON('assets/blended/costs.json'));
  if(!lwFinancialCosts.meta_management || !Number.isFinite(lwFinancialCosts.meta_management.bonus_rate) || !Number.isFinite(lwFinancialCosts.assumed_vat))throw Error('Kostenbasis ontbreekt');
  lwFinancialData={meta:_META,google:_GOOGLE,shopify:_SHOPIFY,
    creators:_loadJSON('data/creators.json'),returns:_loadJSON('data/returns.json')};
  for(const key of ['meta','google','shopify','creators'])lwFinanceEngine.validateSource(key,lwFinancialData[key]);
  lwFinanceEngine.validateReturns(lwFinancialData.returns);
  if(lwFinancialData.returns.cost_basis!==JSON.stringify([lwFinancialCosts.items,lwFinancialCosts.assumed_vat,lwFinancialCosts.payment_rate,lwFinancialCosts.overhead_rate]))throw Error('Retourbegroting gebruikt andere kostentarieven');
} catch(error){lwFinancialError='Financiële onderbouwing niet beschikbaar: '+error.message+'. Vernieuw de pagina.';}
const lwMoney=v=>v==null?'—':eur(v);
const lwExactMoney=v=>v==null?'—':v.toLocaleString('nl-NL',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
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
  const rev=m.expectedRevenueIncl;
  const bruto=m.availableBeforeAds;
  return {rev,bruto,net:m.result,roas:m.roas,profitMargin:m.profitMargin};
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
    if(['net','profitMargin'].includes(key) && !filtered && v.net!=null)node.classList.add(v.net>=0?'good':'bad');
  }
  tile('rev','Netto omzet',filtered?'—':lwMoney(v.rev),filtered?'niet op advertentiegroep herleidbaar':'incl. btw · na retouren');
  tile('roas','Netto ROAS',!filtered && v.roas!=null?x2(v.roas):'—',filtered?'niet op advertentiegroep herleidbaar':'omzet / advertentiekosten');
  tile('bruto','Marge vóór advertenties',filtered?'—':lwMoney(v.bruto),filtered?'niet op advertentiegroep herleidbaar':'na Daan en retourbegroting');
  const netTile=document.querySelector('[data-kpi="net"]');
  if(netTile && !document.querySelector('[data-kpi="profitMargin"]')){
    const marginTile=document.createElement('div');marginTile.className='kpi-item';marginTile.dataset.kpi='profitMargin';
    marginTile.addEventListener('click',()=>toggleKpiChart('profitMargin'));
    marginTile.innerHTML='<div class="kpi-lbl"></div><div class="kpi-val"></div><div class="kpi-sub"></div>';
    netTile.after(marginTile);
  }
  tile('profitMargin','Netto winstmarge',!filtered && m?.profitMargin!=null?m.profitMargin.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%':'—',filtered?'bekijk het volledige account':'doel '+Math.round(SCALE_T*100)+'%');
  tile('net','Netto resultaat',filtered?'—':lwMoney(v.net),filtered?'bekijk het volledige account':m && !m.returnReserve.available?'incl. Daan · retourbegroting niet beschikbaar':'na alle kosten · excl. btw');
  const attribution=document.querySelector('[data-kpi="attr"]');if(attribution){attribution.querySelector('.kpi-lbl').textContent='Meta-attributie';attribution.querySelector('.kpi-sub').textContent='platformclaim · kan overlappen';}
  lwArrangeKpis();
  lwPaintDaanMonth();
  const beRow=document.getElementById('mBe')?.closest('.mrow');
  const bonusCell=document.getElementById('bonusAmt')?.closest('.mc');
  const extraRow=document.getElementById('mSpend')?.closest('.mrow');
  if(beRow && bonusCell)beRow.append(bonusCell);
  const repeatedRoas=document.getElementById('mRoas')?.closest('.mc');if(repeatedRoas)repeatedRoas.hidden=true;
  if(extraRow)extraRow.hidden=true;
  for(const badge of document.querySelectorAll('.capi-badge'))if(badge.textContent.startsWith('Tracking v.a.'))badge.remove();

  const marginCard=document.querySelector('[data-kpi="profitMargin"]');
  if(marginCard && !filtered && m?.profitMargin!=null && m.profitMargin>=0 && m.profitMargin<SCALE_T*100){marginCard.classList.remove('good');marginCard.classList.add('warn');}
  const headline=document.getElementById('kpiHeadline');
  headline.className='kpi-headline';
  // No narrative that merely repeats a KPI. Keep actionable data errors only.
  headline.textContent=lwFinancialError || (m?.result==null?'Netto resultaat nog niet vast te stellen: controleer de financiële onderbouwing.':filtered?'Financieel resultaat is alleen beschikbaar voor het volledige account; wis de analysefilters voor de financiële vergelijking.':'');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(!headline.textContent && lwFinancialData?.meta.snap<today)headline.textContent='Laatste Meta-dag: '+fmtS(lwFinancialData.meta.snap)+'. De gegevens lopen achter; controleer de gegevensaanvoer.';
  if(P==='aug'){for(const id of ['mSpendSub','mPurchSub']){const node=document.getElementById(id);if(node)node.textContent='';}}
  const available=m && m.result!=null?m.result+m.channels.meta.mediaSpend:null;
  const be=m?.breakEvenRoas ?? null;
  document.getElementById('mBe').textContent=be==null?'—':x2(be);
  document.getElementById('mBeSub').textContent='incl. retouren, begroting en Daan';
  document.getElementById('mScaleSub').textContent='doel bij de huidige kostenmix';
  document.getElementById('bonusLbl').textContent='BONUS IN SELECTIE';
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
  if(!m){details.innerHTML='<summary>Financiële onderbouwing</summary><p>'+lwEscapeAttr(lwFinancialError)+'</p>';return;}
  const baseRows=m.marginBuild.filter(r=>r.key!=='margin');
  const reserve=m.returnReserve,w=m.correctionAllocation.weights;
  const find=key=>baseRows.find(r=>r.key===key)?.value;
  const add=(a,b)=>a==null||b==null?null:a+b;
  const combinedReturns=add(find('returns'),reserve.available?find('returnReserve'):0);
  const rows=baseRows.filter(r=>!['returnReserve','daanBonus'].includes(r.key)).map(r=>r.key==='returns'?{...r,label:'Retourkosten',value:combinedReturns}:r.key==='daanFixed'?{...r,label:'Daan · vergoeding',value:add(r.value,find('daanBonus'))}:r.key==='source_adjustment'?{...r,label:'Verschil kostprijssheet · raming'}:r);
  const percentage=(value,kind)=>kind==='total'?(m.profitMargin==null?'—':m.profitMargin.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'):value==null||!(m.revenue>0)?'—':((kind==='total'?value:Math.abs(value))/m.revenue*100).toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
  const compensationOpen=details.querySelector('[data-daan-breakdown]')?.open;
  const compensation='<div class="lw-daan-breakdown"><div class="lw-finance-row"><span>Vaste vergoeding</span><strong>'+lwExactMoney(m.management.fixed)+'</strong></div><div class="lw-finance-row"><span>Bonus in deze selectie</span><strong>'+lwExactMoney(m.management.bonus)+'</strong></div><p class="lw-finance-note">Een negatieve dagbijdrage verlaagt de opgebouwde bonus. De bonus over het contractblok wordt nooit negatief; de vaste vergoeding blijft behouden.</p><div class="table-wrap"><table><thead><tr><th>Dag</th><th>Vast</th><th>Bonusbijdrage</th><th>Blokcorrectie</th><th>Totaal</th></tr></thead><tbody>'+m.management.daily.map(r=>'<tr><td>'+r.d.slice(8,10)+'-'+r.d.slice(5,7)+'</td><td>'+lwExactMoney(r.fixed)+'</td><td>'+lwExactMoney(r.contribution)+'</td><td>'+lwExactMoney(r.adjustment)+'</td><td>'+lwExactMoney(r.total)+'</td></tr>').join('')+'</tbody></table></div></div>';
  const returnsOpen=details.querySelector('[data-return-breakdown]')?.open;
  const returnBackground='<div class="lw-daan-breakdown"><div class="lw-finance-row"><span>Werkelijke retourafhandeling · toegerekend</span><strong>'+lwMoney(-find('returns'))+'</strong></div>'+(reserve.available?'<div class="lw-finance-row"><span>Nog verwachte retouromzet · excl. btw</span><strong>'+lwMoney(reserve.refundExcl)+'</strong></div><div class="lw-finance-row"><span>Nog verwachte afhandeling</span><strong>'+lwMoney(reserve.handling)+'</strong></div><div class="lw-finance-row"><span>Correctie overige kosten</span><strong>− '+lwMoney(reserve.overheadCredit)+'</strong></div><p class="lw-finance-note">Totaal begroting = verwachte retouromzet + afhandeling − correctie overige kosten. Historische retourorders: '+(reserve.rate*100).toLocaleString('nl-NL',{maximumFractionDigits:2})+'% op basis van '+reserve.matureOrders+' afgeronde winkelorders. Mediaan '+reserve.median+' dagen tot retour; begrotingshorizon '+reserve.horizon+' dagen. Dit winkelgemiddelde wordt bij nieuwe gegevens opnieuw berekend.</p>':'<p class="lw-finance-note">Retourbegroting niet beschikbaar: '+lwEscapeAttr(reserve.reason||'onvoldoende gegevens')+'</p>')+'<p class="lw-finance-note">'+lwMoney(lwFinancialCosts.returns?.cost_per_return??20)+' afhandeling per ontvangen retourpakket; annuleringen tellen niet als retourpakket. Werkelijke terugbetalingen staan al bij omzetcorrecties en worden hier niet opnieuw afgetrokken. Werkelijke retouren vervangen de begroting automatisch. Zonder betrouwbare orderkoppeling krijgt Meta '+(w?.meta==null?'een onbekend aandeel':(w.meta*100).toLocaleString('nl-NL',{maximumFractionDigits:1})+'%')+' van de niet-influencerretouren, op basis van aankopen; Google telt alleen non-branded mee.</p></div>';
  const lines=rows.map(r=>{
   const content='<span>'+lwEscapeAttr(r.label)+(['daanFixed','returns','source_adjustment'].includes(r.key)?' <span aria-hidden="true">▾</span>':'')+'</span><strong>'+lwMoney(r.value)+' <span style="font-weight:400;color:#93a2b8">— '+percentage(r.value,r.kind)+'</span></strong>';
   if(r.key==='source_adjustment'){
    const gaps=Object.entries(lwFinancialCosts.item_components||{}).filter(([,parts])=>parts.source_adjustment!==0).map(([name,parts])=>lwEscapeAttr(name)+': '+lwExactMoney(parts.source_adjustment)+' per stuk').join('; ');
    return '<details data-cost-breakdown><summary class="lw-finance-row" data-finance-key="source_adjustment">'+content+'</summary><p class="lw-finance-note">De totale kostprijs in de sheet wijkt af van de uitgesplitste onderdelen. Het verschil is meegenomen om de winst niet te hoog te tonen. De oorzaak moet nog in de sheet worden bevestigd. '+gaps+'.</p></details>';
   }
   if(r.key==='returns')return '<details data-return-breakdown'+(returnsOpen?' open':'')+'><summary class="lw-finance-row" data-finance-key="returns">'+content+'</summary>'+returnBackground+'</details>';
   return r.key==='daanFixed'?'<details data-daan-breakdown'+(compensationOpen?' open':'')+'><summary class="lw-finance-row" data-finance-key="daanFixed">'+content+'</summary>'+compensation+'</details>':'<div class="lw-finance-row '+r.kind+'" data-finance-key="'+r.key+'">'+content+'</div>';
  }).join('');
  const model=reserve.available?'Retourbegroting: '+(reserve.rate*100).toFixed(2)+'% retourorders · '+reserve.matureOrders+' afgeronde orders · mediaan '+reserve.median+' dagen · horizon '+reserve.horizon+' dagen.':reserve.reason;
  const expected='<details class="lw-finance-note"><summary style="padding:8px 0">Uitsplitsing en break-evenberekening</summary><p>Retourkosten: '+lwMoney(-find('returns'))+' werkelijke afhandeling + '+(reserve.available?lwMoney(reserve.impact):'onbekende begroting')+' nog verwachte retouren. Reeds terugbetaalde omzet staat apart bij omzetcorrecties.</p>'+
    (reserve.available?'<p>Begrote retouren: '+lwMoney(reserve.refundExcl)+' retouromzet excl. btw + '+lwMoney(reserve.handling)+' afhandeling − '+lwMoney(reserve.overheadCredit)+' correctie overige kosten.</p>':'')+
    '<p>Daan: '+lwMoney(-find('daanFixed'))+' vast + '+lwMoney(find('daanBonus')==null?null:-find('daanBonus'))+' bonus.</p><p>De kostprijssheet levert product- en leveringskosten. Betaalkosten, overige kosten, werkelijke retouren, retourbegroting en Daan worden daarnaast verwerkt.</p><p>Operationele BEROAS = netto Meta-omzet incl. btw ('+lwMoney(v.rev)+') ÷ beschikbare marge vóór advertenties, na Daan ('+lwMoney(available)+') = '+(be==null?'niet haalbaar':x2(be))+'. Bonus: '+(lwFinancialCosts.meta_management.bonus_rate*100)+'% × (netto omzet − advertentiekosten × BEROAS), per contractblok. Vanaf 1 oktober wordt de eigen bonus in de BEROAS verwerkt; bonus en BEROAS worden tegelijk opgelost. Vóór 1 oktober blijft de oorspronkelijke bonusberekening behouden. Verliesdagen tellen mee; het bloktotaal heeft minimum nul.</p></details>';
  details.innerHTML='<summary>Netto marge en retouren <span>'+lwMoney(m.result)+'</span></summary><div class="lw-finance-body"><p class="lw-finance-note">Kostenaandelen: omzet excl. btw na werkelijke correcties. Netto winstmarge: ook na begrote retouromzet.</p>'+lines+expected+(reserve.stale?'<p class="lw-finance-note">Retourbron is ouder dan 48 uur; begroting is niet verder afgebouwd.</p>':'')+'</div>';
  document.getElementById('beSummary').innerHTML='<div class="be-stat"><div class="be-lbl">Operationele BEROAS</div><div class="be-val">'+(be==null?'—':x2(be))+'</div></div><p class="lw-finance-note">Inclusief retouren, begroting en vaste vergoeding. Zie de volledige kostenopbouw hierboven. De producttabel hieronder toont alleen de kostprijssheet.</p>';
  renderKpiChart();
}
const lwKeyboardCards=new WeakSet();
const lwOriginalKpiBar=renderKpiBar;
renderKpiBar=function(...args){if(args[5]==='juli'){args[3]=null;args[4]=null;args[5]=null;}lwOriginalKpiBar(...args);lwPaintFinance();};
const lwOriginalAggregate=kpiAggregate;
kpiAggregate=function(gran,from,to,seg,platform,placement){
  const original=lwOriginalAggregate(gran,from,to,seg,platform,placement);
  if(!lwFinancialData || lwFinancialError || (seg&&seg!=='all') || (platform&&platform!=='all') || (placement&&placement!=='all'))
    return original.map(r=>({...r,rev:null,roas:null,bruto:null,net:null,profitMargin:null}));
  const start=from||'2026-08-05',end=to||SNAP;
  const corrected=new Map(lwFinanceEngine.series(lwFinancialData,lwFinancialCosts,start,end,'meta',gran).map(r=>[gran==='month'?r.key.slice(0,7):r.key,r]));
  return original.map(r=>({...r,...lwNetMetrics(corrected.get(r.key))}));
};
KPI_META.rev.label='Netto Meta-omzet · incl. btw';
KPI_META.roas.label='Netto Meta ROAS';
KPI_META.bruto.label='Marge vóór ads · excl. btw';
KPI_META.net.label='Netto resultaat · incl. Daan en retouren';
KPI_META.profitMargin={label:'Netto winstmarge',fmt:v=>v==null?'—':v.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'};
const lwOriginalKpiToggle=toggleKpiChart;
toggleKpiChart=function(key){lwOriginalKpiToggle(key);for(const node of document.querySelectorAll('.kpi-item[role=button]'))node.setAttribute('aria-pressed',String(kpiChartSel.includes(node.dataset.kpi)));};

function lwArrangeKpis(){
 const strip=document.getElementById('kpiStrip');
 if(!strip)return;
 let ads=document.getElementById('lwAdsDetails');
 if(!ads){ads=document.createElement('details');ads.id='lwAdsDetails';ads.className='lw-ads-details';ads.innerHTML='<summary>Advertenties & analyse <span aria-hidden="true">⌄</span></summary><div class="lw-secondary-kpis"></div>';strip.after(ads);}
 const primary=['net','profitMargin','rev','roas'].map(k=>strip.querySelector('[data-kpi="'+k+'"]')).filter(Boolean);
 const secondary=['spend','purch','cac','bruto','attr'].map(k=>strip.querySelector('[data-kpi="'+k+'"]')).filter(Boolean);
 strip.replaceChildren(...primary);
 ads.querySelector('.lw-secondary-kpis').replaceChildren(...secondary);
 const filters=document.getElementById('filterBar');if(filters)ads.append(filters);
 ads.querySelector('summary').firstChild.textContent=filtersActive()?'Advertenties & analyse · filters actief ':'Advertenties & analyse ';
 let basis=document.getElementById('lwKpiBasis');if(!basis){basis=document.createElement('p');basis.id='lwKpiBasis';basis.className='lw-kpi-basis';strip.after(basis);}
 const pd=PERIODS[P]||PERIODS.aug;
 basis.textContent='Winst excl. btw · inclusief Daan en retourbegroting'+(pd.to===SNAP?' · laatste dag kan nog wijzigen':'');
 for(const card of [...primary,...secondary]){
  card.setAttribute('role','button');card.setAttribute('tabindex','0');card.setAttribute('aria-pressed',String(kpiChartSel.includes(card.dataset.kpi)));
  if(lwKeyboardCards.has(card))continue;lwKeyboardCards.add(card);
  card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.click();card.setAttribute('aria-pressed',String(kpiChartSel.includes(card.dataset.kpi)));}});
 }
}

updateSim=function(){
 if(!lwFinancialData||lwFinancialError||SNAP<'2026-10-01'){
  for(const id of ['simBonus','simDiff'])document.getElementById(id).textContent='—';
  return;
 }
 const input=document.getElementById('simSpend'),slider=document.getElementById('simSlider');
 const roas=Number(slider.value),dailySpend=input.value.trim()===''?NaN:Number(input.value);
 const from=SNAP,to=new Date(Date.parse(from)+29*864e5).toISOString().slice(0,10);
 const referenceFrom=new Date(Math.max(Date.parse('2026-08-05'),Date.parse(SNAP)-29*864e5)).toISOString().slice(0,10);
 const scenario=lwFinanceEngine.simulate({from,to,dailySpend,roas,referenceFrom,referenceTo:SNAP});
 document.getElementById('simRval').textContent=x2(roas);
 document.getElementById('simBonus').textContent=scenario.available?lwMoney(scenario.bonus):'—';
 document.getElementById('simDiff').textContent=scenario.available?lwMoney(scenario.result):'—';
 document.getElementById('simSpendTotal').textContent=scenario.available?lwMoney(scenario.spend)+' advertenties · '+fmtS(from)+'–'+fmtS(to)+' (30 dagen)':'Vul een geldig dagbudget in; nul is toegestaan.';
 const note=document.getElementById('lwSimBasis');
 if(note)note.textContent=scenario.available?'Scenario, geen afrekening. Kostenmix '+fmtS(referenceFrom)+'–'+fmtS(SNAP)+', inclusief retourbegroting. Daan: '+lwExactMoney(scenario.fixed)+' vast + '+lwExactMoney(scenario.bonus)+' bonus. De vaste vergoeding volgt kalenderdagen.':'Scenario niet beschikbaar: '+scenario.reason;
};


// The calendar-month view is independent of the analysis period and filters.
// Allocation and contractual bonus floors remain owned by the shared engine.
function lwPaintDaanMonth(){
 let card=document.getElementById('lwDaanMonth');
 if(!card){
  card=document.createElement('section');card.id='lwDaanMonth';card.className='lw-daan-month';card.setAttribute('aria-labelledby','lwDaanMonthTitle');
  card.innerHTML='<div class="lw-month-heading"><h2 id="lwDaanMonthTitle">Jouw maandvergoeding</h2><span id="lwDaanMonthDate"></span></div><div class="lw-month-values"><div><span>Basis per maand</span><strong id="lwMonthFixed">—</strong></div><div class="lw-month-bonus"><span>Bonus opgebouwd</span><strong id="lwMonthBonus">—</strong></div><div><span>Basis + bonus</span><strong id="lwMonthTotal">—</strong></div></div><p id="lwMonthNote" class="lw-finance-note"></p><details class="lw-month-plan"><summary>Wat levert meer omzet op? <span aria-hidden="true">⌄</span></summary><div class="lw-month-plan-body"><label for="lwRevenueSlider">Verwachte netto maandomzet <output id="lwRevenueValue" for="lwRevenueSlider">—</output></label><input id="lwRevenueSlider" type="range" min="0" max="300" step="5" value="100" aria-describedby="lwGrowthBasis"><p id="lwGrowthPace" class="lw-finance-note"></p><div class="lw-month-values"><div><span>Verwachte maandbonus</span><strong id="lwGrowthBonus">—</strong></div><div><span>Totale vergoeding</span><strong id="lwGrowthTotal">—</strong></div><div><span>Netto winst LumeWorks</span><strong id="lwGrowthProfit">—</strong></div></div><p id="lwGrowthFixed" class="lw-finance-note"></p><p id="lwGrowthBasis" class="lw-finance-note"></p></div></details>';
  document.getElementById('lwKpiBasis').after(card);
  card.querySelector('input').addEventListener('input',lwPaintDaanScenario);
 }
 const from=SNAP.slice(0,7)+'-01';
 const m=lwFinancial(from,SNAP),fixed=lwFinancialCosts?.meta_management?.monthly_fixed;
 const bonus=m?.management.bonus,total=bonus==null||!Number.isFinite(fixed)?null:fixed+bonus;
 document.getElementById('lwDaanMonthDate').textContent=new Date(SNAP+'T12:00:00Z').toLocaleDateString('nl-NL',{month:'long',year:'numeric',timeZone:'Europe/Amsterdam'})+' · t/m '+fmtS(SNAP);
 document.getElementById('lwMonthFixed').textContent=lwFinancialError?'—':lwMoney(fixed);
 document.getElementById('lwMonthBonus').textContent=lwMoney(bonus);
 document.getElementById('lwMonthTotal').textContent=lwMoney(total);
 document.getElementById('lwMonthNote').textContent=m?'Voorlopig, geen uitbetaling. De basis geldt voor de hele maand; de bonus is de bijdrage van '+fmtS(from)+'–'+fmtS(SNAP)+'. Retouren en verliesdagen kunnen de bonus wijzigen. De bestaande afrekening per contractblok blijft gelden.':'Maandvergoeding niet beschikbaar: controleer de financiële gegevens.';
 lwPaintDaanScenario();
}
function lwPaintDaanScenario(){
 const from=SNAP.slice(0,7)+'-01',to=new Date(Date.UTC(Number(SNAP.slice(0,4)),Number(SNAP.slice(5,7)),0)).toISOString().slice(0,10);
 const elapsed=Number(SNAP.slice(8,10)),days=Number(to.slice(8,10));
 const m=lwFinancial(from,SNAP),scale=Number(document.getElementById('lwRevenueSlider').value)/100;
 const referenceFrom=new Date(Math.max(Date.parse('2026-08-05'),Date.parse(SNAP)-29*864e5)).toISOString().slice(0,10);
 const spend=m?.channels.meta.mediaSpend,roas=m?.roas;
 const scenario=lwFinancialError?{available:false,reason:'Financiële gegevens ontbreken'}:lwFinanceEngine.simulate({from,to,dailySpend:spend/elapsed*scale,roas,referenceFrom,referenceTo:SNAP});
 const put=(id,v)=>document.getElementById(id).textContent=v;
 put('lwRevenueValue',scenario.available?lwMoney(scenario.revenue):'—');
 put('lwGrowthBonus',scenario.available?lwMoney(scenario.bonus):'—');
 put('lwGrowthTotal',scenario.available?lwMoney(scenario.totalDaan):'—');
 put('lwGrowthProfit',scenario.available?lwMoney(scenario.result):'—');
 document.getElementById('lwGrowthProfit').className=scenario.available?(scenario.result<0?'lw-negative':'lw-positive'):'';
 const pace=scale===1?'Huidig maandtempo':scale>1?'+'+Math.round((scale-1)*100)+'% omzet ten opzichte van huidig maandtempo':Math.round(scale*100)+'% van huidig maandtempo';
 put('lwGrowthPace',pace+' · '+days+' kalenderdagen');
 put('lwGrowthFixed',scenario.available?'Vaste basis Daan: '+lwMoney(scenario.fixed)+' · '+(scenario.revenue>0?(scenario.fixed/(scenario.revenue/(1+lwFinancialCosts.assumed_vat))*100).toLocaleString('nl-NL',{maximumFractionDigits:1})+'% van omzet excl. btw':'geen omzet')+' · advertenties '+lwMoney(scenario.spend):'');
 put('lwGrowthBasis',scenario.available?'Scenario voor de hele maand, geen opgebouwde bonus. Netto omzet incl. btw, winst excl. btw. Advertentiebudget groeit mee bij dezelfde netto ROAS ('+x2(roas)+'). Productkosten en retouren volgen de kostenmix van de afgelopen 30 dagen; de vaste basis blijft gelijk. De huidige dag kan nog wijzigen.':'Scenario niet beschikbaar: '+scenario.reason);
 document.getElementById('lwRevenueSlider').setAttribute('aria-valuetext',scenario.available?lwMoney(scenario.revenue)+' netto maandomzet; '+lwMoney(scenario.bonus)+' verwachte bonus':'Scenario niet beschikbaar');
}
