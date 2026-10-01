export function checkShopifyOrders(orders) {
  const seen = new Set();
  for (const o of orders) {
    if (!o.num || typeof o.num !== "string" || seen.has(o.num)) throw Error("Ontbrekend of dubbel ordernummer");
    seen.add(o.num);
    if (!Array.isArray(o.items) || !o.items.length || o.items.some(i => typeof i !== "string" || !i.trim())) throw Error("Onvolledige productregels");
    if (o.item_refs !== undefined && (!Array.isArray(o.item_refs) || o.item_refs.length !== o.items.length || o.item_refs.some(ref => !ref || typeof ref !== "object" || Array.isArray(ref) || Object.values(ref).some(v => typeof v !== "string")))) throw Error("Ongeldige productcodes");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d) || !Number.isFinite(Date.parse(o.d)) || new Date(o.d).toISOString().slice(0,10) !== o.d) throw Error("Ongeldige orderdatum");
    if (!Number.isFinite(o.incl)) throw Error("Ongeldig orderbedrag");
  }
  const sales = orders.filter(o => !o.test);
  const latest = [...sales].sort((a,b) => b.d.localeCompare(a.d) || Number(b.num.replace(/\D/g,""))-Number(a.num.replace(/\D/g,"")))[0];
  return {checked_at:new Date().toISOString(),orders:orders.length,sales:sales.length,test_orders:orders.length-sales.length,latest_num:latest?.num,latest_date:latest?.d};
}
const cacheVersion = "lw-dashboard-v3";
const validSourceDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
export function validateSource(key, d) {
  const rows = d?.[key === "meta" ? "daily_meta" : key === "google" ? "daily_google" : "orders"];
  if (!Array.isArray(rows) || !rows.length) throw Error("Geen geldige gegevens");
  if (rows.some(x => !validSourceDate(x.d))) throw Error("Ongeldige datums");
  const numeric = key === "meta" ? ["spend","rev7","rev1v","purch"] : key === "google" ? ["spend","rev","conv"] : key === "shopify" ? ["incl"] : ["omzet_excl","commissie"];
  if (rows.some(x => numeric.some(k => !Number.isFinite(x[k])))) throw Error("Ongeldige bedragen");
  if (["meta","google"].includes(key)) {
    const dates = rows.map(x=>x.d);
    if (new Set(dates).size !== dates.length) throw Error("Dubbele daggegevens");
    if (rows.some(x=>numeric.some(k=>x[k]<0))) throw Error("Negatieve advertentiecijfers");
    if (dates.some((d,i)=>i>0 && d<=dates[i-1])) throw Error("Daggegevens niet op datum gesorteerd");
    if (key === "meta" && (!validSourceDate(d.snap) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.snap_time || "") || dates.at(-1)>d.snap)) throw Error("Ongeldig Meta-meetmoment");
    if (key === "google" && (!validSourceDate(d.coverage_from) || !validSourceDate(d.coverage_to) || dates[0]<d.coverage_from || dates.at(-1)>d.coverage_to)) throw Error("Ongeldige Google-dekking");
  }
  if (["google","creators"].includes(key) && !Number.isFinite(Date.parse(d.synced_at))) throw Error("Ongeldig synchronisatietijdstip");
  if (key === "shopify") checkShopifyOrders(rows);
  if (key === "creators" && d.startup_costs) {
    const c=d.startup_costs, seen=new Set();
    if(!Array.isArray(c.rows) || !c.rows.length || c.count!==c.rows.length || !Number.isFinite(c.total)) throw Error("Ongeldige opstartkosten");
    let total=0;
    for(const r of c.rows) {
      if(!r.creator || typeof r.code!=="string" || !r.code.trim() || seen.has(r.code.toLowerCase())) throw Error("Dubbele/ontbrekende influencer in opstartkosten");
      seen.add(r.code.toLowerCase());
      const values=[r.beamer_cost,r.accessory_cost,r.extra_accessory_cost,r.shipping];
      if(values.some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(r.total)||Math.abs(values.reduce((n,v)=>n+v,0)-r.total)>.011) throw Error("Opstartkosten sluiten niet aan");
      total+=r.total;
    }
    if(Math.abs(total-c.total)>.011) throw Error("Totaal opstartkosten sluit niet aan");
  }
  return d;
}
export function validateReturns(d) {
 if(d?.version!==2 || d.complete!==true || !validSourceDate(d.coverage_from) || !Number.isFinite(Date.parse(d.synced_at)) || !Array.isArray(d.daily) || !d.daily.length || !d.model || d.orders || d.corrections)throw Error('Onvolledige geaggregeerde retourregistratie');
 const dates=new Set();
 for(const r of d.daily){
  if(!validSourceDate(r.d)||dates.has(r.d)||r.num||r.id)throw Error('Ongeldige retourdag');dates.add(r.d);
  for(const key of ['gross','actual','creatorGross','creatorActual'])if(!r[key] || Object.values(r[key]).some(v=>v!==null && (!Number.isFinite(v)||v<-.01)))throw Error('Ongeldige retourtotalen');
  for(const key of ['all','creator']){const p=r.reserve?.[key];if(!p || Object.values(p).some(v=>!Number.isFinite(v)||v<-.01) || Math.abs(p.impact-(p.refundExcl+p.handling-p.overheadCredit))>.011)throw Error('Ongeldige retourbegroting');}
  if(r.actual.incl>r.gross.incl+.01 || r.creatorActual.incl>r.actual.incl+.01 || r.actual.orders!==r.gross.orders)throw Error('Retourtotalen sluiten niet aan');
 }
 const m=d.model;
 if(!Number.isInteger(m.horizon)||m.horizon<28||!validSourceDate(m.asOf)||!Array.isArray(m.weeks)||typeof m.available!=='boolean'||(m.available && (!Number.isFinite(m.rate)||m.rate<0||m.rate>=1||!Number.isFinite(m.fraction)||m.fraction<0||m.fraction>1)))throw Error('Ongeldig retourmodel');
 return d;
}
export function validateCosts(d) {
  if (!d || !d.items || !Object.keys(d.items).length || Object.values(d.items).some(v=>!Number.isFinite(v)||v<0)) throw Error("Ongeldige kostprijzen");
  for (const key of ["payment_rate","overhead_rate","assumed_vat"]) if (!Number.isFinite(d[key]) || d[key]<0 || d[key]>1) throw Error("Ongeldig kostentarief");
  for(const [name,parts] of Object.entries(d.item_components || {})) {
    const values=['purchase','inbound_shipping','fulfillment','source_adjustment'].map(k=>parts[k]);
    if(values.some(v=>!Number.isFinite(v)) || values.slice(0,3).some(v=>v<0) || !Number.isFinite(d.items[name]) || Math.abs(values.reduce((a,b)=>a+b,0)-d.items[name])>0.01) throw Error("Ongeldige kostprijsuitsplitsing");
  }
  const m=d.meta_management;
  if (!m || !Number.isFinite(m.monthly_fixed) || m.monthly_fixed<0 || !Number.isFinite(m.bonus_rate) || m.bonus_rate<0 || m.bonus_rate>1 || !validSourceDate(m.contract_start) || !Number.isInteger(m.bonus_period_days) || m.bonus_period_days<1) throw Error("Ongeldige bonusregeling");
  if(d.returns?.orders?.some(r=>r.received_packages!==undefined && (!Number.isInteger(r.received_packages)||r.received_packages<0))) throw Error("Ongeldig aantal retourpakketten");
  return d;
}
export async function fetchJSON(url, {timeoutMs=8000, attempts=2}={}) {
  let last;
  for (let attempt=0;attempt<attempts;attempt++) {
    const controller=new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async()=>{const r=await fetch(url,{cache:"no-cache",signal:controller.signal}); if(!r.ok) throw Error("HTTP "+r.status); return await r.json();})(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("Ophalen duurde te lang"));},timeoutMs);}),
      ]);
    } catch(e) { last=e; } finally { clearTimeout(timer); }
  }
  throw last;
}
export async function load() {
  const data={},errors={};
  async function resource(key,url,validate) {
    try {
      const d=validate(await fetchJSON(url));
      try { sessionStorage.setItem(cacheVersion+key,JSON.stringify(d)); } catch {}
      return d;
    } catch(e) {
      errors[key]=e.message;
      try { const cached=JSON.parse(sessionStorage.getItem(cacheVersion+key)); if(cached) return validate(cached); } catch {}
      return null;
    }
  }
  const [costs,status]=await Promise.all([
    resource("costs","assets/blended/costs.json",validateCosts),
    fetchJSON("data/status.json").catch(()=>null),
    (async()=>{const d=await resource("returns","data/returns.json",validateReturns);if(d)data.returns=d;})(),
    ...["meta","google","shopify","creators"].map(async key=>{
      const d=await resource(key,`data/${key}.json`,d=>validateSource(key,d));
      if(d) data[key]=d;
      if(key==="shopify" && d) data.shopify_check=checkShopifyOrders(d.orders);
    }),
  ]);
  if(!costs) throw Error("Kostenregister niet beschikbaar of ongeldig; resultaat kan niet veilig worden berekend");
  if(data.returns?.cost_basis!==JSON.stringify([costs.items,costs.assumed_vat,costs.payment_rate,costs.overhead_rate])){
    if(data.returns){errors.returns='Retourbegroting gebruikt andere kostentarieven; dagelijkse herberekening nodig';delete data.returns;}
  }
  if(status) data.source_status=status;
  else errors.status="Synchronisatiestatus niet beschikbaar";
  return {data,errors,costs};
}
