// Same source datasets and financial engine as cijfers.lumeworks.nl.
// Loaded into the private build only. Contractual bonus/BEROAS are not rewritten.
let lwFinancialData, lwFinancialCosts, lwFinancialError;
try {
  lwFinancialCosts=_loadJSON('assets/blended/costs.json');
  lwFinancialData={meta:_META,google:_GOOGLE,shopify:_SHOPIFY,
    creators:_loadJSON('data/creators.json'),returns:_loadJSON('data/returns.json')};
  if(lwFinancialData.returns?.version!==2 || !lwFinancialData.returns.complete)
    throw Error('Retourregistratie is onvolledig');
} catch(error){lwFinancialError='Financiële onderbouwing kon niet worden geladen. Vernieuw de pagina.';}
const lwMoney=v=>v==null?'—':eur(v);
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
  document.getElementById('mBeSub').textContent='contractbasis · bonus';
  document.getElementById('mScaleSub').textContent='contractbasis · vóór retourcorrecties';
  document.getElementById('bonusBadge').textContent='Volgens bestaande bonusregeling · niet herberekend voor retouren';
  let details=document.getElementById('lwFinanceDetails');
  if(!details){details=document.createElement('details');details.id='lwFinanceDetails';details.className='lw-finance';document.getElementById('kpiHeadline').after(details);}
  if(!m){details.innerHTML='<summary>Financiële onderbouwing</summary><p>'+lwFinancialError+'</p>';return;}
  const rows=m.marginBuild.filter(r=>r.key!=='margin');
  const reserve=m.returnReserve,w=m.correctionAllocation.weights;
  const lines=rows.map(r=>'<div class="lw-finance-row '+r.kind+'"><span>'+lwEscapeAttr(r.label)+'</span><strong>'+lwMoney(r.value)+'</strong></div>').join('');
  const model=reserve.available?'Retourbegroting: '+(reserve.rate*100).toFixed(2)+'% retourorders · '+reserve.matureOrders+' afgeronde orders · mediaan '+reserve.median+' dagen · horizon '+reserve.horizon+' dagen.':reserve.reason;
  const expected=reserve.available?'<div class="lw-finance-note">Nog verwacht: '+lwMoney(reserve.refundExcl)+' retouromzet excl. btw + '+lwMoney(reserve.handling)+' afhandeling − '+lwMoney(reserve.overheadCredit)+' correctie overige kosten.</div>':'';
  details.innerHTML='<summary>Netto marge en retouren <span>'+lwMoney(m.result)+'</span></summary><div class="lw-finance-body">'+lines+expected+
    '<p class="lw-finance-note">'+lwEscapeAttr(model||'Retourbegroting niet beschikbaar')+(reserve.stale?' Retourbron is ouder dan 48 uur; begroting is niet verder afgebouwd.':'')+'</p>'+
    '<p class="lw-finance-note">'+(w?'Meta krijgt '+(w.meta*100).toFixed(1)+'% van de niet-influencercorrecties op basis van aankopen. Google telt alleen non-branded mee.':'Kanaaltoewijzing ontbreekt.')+' €'+(lwFinancialCosts.returns?.cost_per_return??20)+' per ontvangen retourpakket; annuleringen tellen niet als retourpakket. Werkelijke retouren vervangen de begroting automatisch.</p></div>';
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
