import { creatorSummary } from "./creator-summary.js?v=startup-costs-1";
import { createDatePicker } from "./date-picker.js?v=store-start-1";
import { load } from "./data.js?v=return-reserve-1";
import {
  compute,
  googleScopeData,
  googleCampaignGroups,
  basketMetrics,
  finance,
  itemCost,
  reconciledOrder,
  sum,
  shift,
  series,
  aggregate,
  previous,
  inRange,
} from "./metrics.js?v=return-reserve-1";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const euro = (v) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(v);
const num = (v) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 }).format(v);
const ratio = (v) => (v == null ? "—" : num(v) + "×");
const fmt = (d) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
const names = {
  all: "Overzicht",
  meta: "Meta",
  google: "Google Ads",
  infl: "Influencers",
};
const colors = {
  revenue: "#4EA8DE",
  spend: "#E5B863",
  cost: "#B98DE0",
  result: "#8FC49B",
  profitMargin: "#B99CDE",
  roas: "#B98DE0",
  count: "#86d9d2",
  cpa: "#86d9d2",
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
let D,
  C,
  E,
  state,
  tableModel,
  sortKey = 0,
  sortDir = 1,
  page = 0,
  search = "",
  compareMode = true,
  pending = null,
  chartTable = false,
  analysisCollapsed = false,
  selectedDays = new Set();
const stale = (k) => {
  if (D.source_status?.[k]?.status && D.source_status[k].status !== "ok") return true;
  if (k === "shopify") {
    const t=Date.parse(D.source_status?.shopify?.last_success);
    return !Number.isFinite(t) || Date.now()-t>24*60*60000;
  }
  if (k === "meta") {
    if (!D.meta) return true;
    const wall = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .format(new Date())
      .replace(" ", "T");
    return (
      Date.parse(wall + "Z") -
        Date.parse(D.meta.snap + "T" + D.meta.snap_time + ":00Z") >
      45 * 60000
    );
  }
  return (
    ["google", "creators"].includes(k) &&
    (!Number.isFinite(Date.parse(D[k]?.synced_at)) ||
      Date.now() - Date.parse(D[k].synced_at) >
        (k === "google" ? 45 : 180) * 60000)
  );
};
const STORE_START = "2026-08-05";
const boundDate = d => d < STORE_START ? STORE_START : d;
const defaults = () => ({
  channel: "all",
  from: boundDate(shift(today, -7)),
  to: shift(today, -1),
  metrics: ["revenue", "result"],
  compare: "previous",
  gran: "auto",
  detail: null,
  sub: null,
  group: "campaign",
  googleScope: "nonbrand",
  daan: "with",
});
function readState() {
  const q = new URLSearchParams(location.search),
    s = defaults();
  for (const k of [
    "channel",
    "googleScope",
    "from",
    "to",
    "compare",
    "gran",
    "group",
    "pfrom",
    "pto",
  ])
    if (q.has(k)) s[k] = q.get(k);
  if (!["nonbrand", "brand", "all"].includes(s.googleScope))
    s.googleScope = "nonbrand";
  // Opening a dashboard always includes the real operating cost.
  // Without Daan is a temporary comparison chosen inside the page.
  s.daan="with";
  if (!(s.channel in names)) s.channel = "all";
  if (!["previous", "off", "custom"].includes(s.compare))
    s.compare = "previous";
  if (!["auto", "day", "week", "month"].includes(s.gran)) s.gran = "auto";
  if (
    !validDate(s.from) ||
    !validDate(s.to) ||
    s.from > s.to ||
    s.to > today ||
    new Date(s.to) - new Date(s.from) > 3 * 366 * 864e5
  ) {
    s.from = defaults().from;
    s.to = defaults().to;
  }
  if (
    s.compare === "custom" &&
    (!validDate(s.pfrom) || !validDate(s.pto) || s.pfrom > s.pto)
  )
    s.compare = "previous";
  s.from=boundDate(s.from);
  s.to=boundDate(s.to);
  if(s.compare==='custom' && (s.pfrom<STORE_START || s.pto>today)) { s.compare='off'; delete s.pfrom; delete s.pto; }
  const allowed =
    s.channel === "all"
      ? ["revenue", "cost", "spend", "roas", "result", "profitMargin"]
      : s.channel === "meta" ? ["revenue", "spend", "result", "profitMargin", "count", "roas", "cpa"] : ["revenue", "spend", "result", "profitMargin", "count", "roas", "cpa"];
  if (q.has("metrics"))
    s.metrics = [
      ...new Set(
        q
          .get("metrics")
          .split(",")
          .filter((k) => allowed.includes(k)),
      ),
    ].slice(0, 2);
  if (!q.has("metrics") && s.channel !== "all") s.metrics = ["result", "profitMargin"];
  if (!s.metrics.length) s.metrics = ["revenue"];
  if (q.has("detail")) {
    try {
      const d = JSON.parse(q.get("detail"));
      if (
        [
          "product",
          "basket",
          "creator",
          "ad",
          "campaign",
          "orders",
          "products",
          "costs",
        ].includes(d.type) &&
        typeof d.name === "string"
      )
        s.detail = d;
    } catch {}
  }
  return s;
}
function validDate(s) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s || "") &&
    Number.isFinite(Date.parse(s + "T12:00Z")) &&
    new Date(s + "T12:00Z").toISOString().slice(0, 10) === s
  );
}
function persist(push = true) {
  const q = new URLSearchParams();
  for (const k of [
    "channel",
    "googleScope",
    "daan",
    "from",
    "to",
    "compare",
    "gran",
    "group",
    "pfrom",
    "pto",
  ])
    if (state[k]) q.set(k, state[k]);
  q.set("metrics", state.metrics.join(","));
  if (state.detail) q.set("detail", JSON.stringify(state.detail));
  history[push ? "pushState" : "replaceState"](null, "", "?" + q);
  try {
    localStorage.setItem(
      "lumeworks_period",
      JSON.stringify({ from: state.from, to: state.to }),
    );
  } catch {}
}
function change(fn) {
  fn();
  state.from=boundDate(state.from); state.to=boundDate(state.to);
  if(state.compare==='custom' && (state.pfrom<STORE_START || state.pto>today)) {state.compare='off'; delete state.pfrom; delete state.pto;}
  page = 0;
  search = "";
  sortKey = 0;
  pending = null;
  persist();
  render();
}
function viewCompute(data,costs,from,to,channel) {
  const base=compute(data,costs,state.from,state.to,channel,{includeDaan:state.daan!=="without"});
  return compute(data,costs,from,to,channel,{includeDaan:state.daan!=="without", ...(channel!=="all" && from>=state.from && to<=state.to ? {marginRate:base.marginRate,baselineRates:base.baselineRates,correctionWeights:base.correctionAllocation.weights} : {})});
}
function metricMeta(k) {
  const all = state.channel === "all";
  return {
    revenue: {
      label: all ? "Omzet excl. btw" : "Kanaalomzet excl. btw",
      sub: all ? "Excl. 21% btw" : state.channel === "infl" ? "Via kortingscodes · excl. 21% btw" : "Na toegerekende omzetcorrecties · excl. 21% btw",
      fmt: euro,
    },
    cost: {
      label: "Product- en orderkosten",
      sub: "Bestaande tarieven + berekende betaalkosten",
      fmt: euro,
    },
    spend: {
      label: all
        ? "Marketingkosten"
        : state.channel === "infl"
          ? "Samenwerkingskosten"
          : "Marketingkosten",
      sub:
        state.channel === "infl"
          ? "Commissies + toegerekende opstartkosten"
          : all
            ? (state.daan==="without" ? "Zonder kosten Daan" : "Inclusief kosten Daan")
            : state.channel === "meta" ? (state.daan==="without" ? "Alleen advertenties" : "Ads + kosten Daan") : names[state.channel],
      fmt: euro,
    },
    result: {
      label: state.channel==="infl" ? "Resultaat · eigen orders" : state.channel!=="all" ? "Nettowinst · geschat" : "Nettowinst · voorlopig",
      sub: state.channel==="meta" ? (state.daan==="without" ? "Zonder kosten Daan" : "Inclusief kosten Daan") : "Inclusief 4% overhead",
      fmt: euro,
    },
    profitMargin: { label: "Winstmarge", sub: all ? "Van omzet excl. btw · voorlopig" : "Van kanaalomzet excl. btw · geschat", fmt: v => v == null ? "—" : num(v) + "%" },
    roas: {
      label: all ? "Blended ROAS" : "Kanaalrendement",
      sub: all
        ? "Omzet incl. btw / bekende marketingkosten"
        : state.channel === "infl"
          ? "Inclusief toegerekende opstartkosten"
          : "Kanaalomzet incl. btw / alle kanaalkosten",
      fmt: ratio,
    },
    cpa: { label: "Kosten per aankoop", sub: "Per toegerekende aankoop", fmt: euro },
    count: {
      label:
        state.channel === "infl"
          ? "Influencer-orders"
          : state.channel === "google"
            ? "Toegerekende conversies"
            : "Aankopen",
      sub:
        state.channel === "google"
          ? "Meetbasis nog controleren"
          : "Geen nieuweklant-CAC",
      fmt: num,
    },
  }[k];
}
function delta(k, cur, prev) {
  if (state.compare === "off") return "";
  if (!prev || cur[k] == null || prev[k] == null)
    return `<span class="delta-note">Geen vergelijkbare vorige periode</span>`;
  const d = cur[k] - prev[k],
    f = metricMeta(k).fmt;
  const direction = d > 0 ? "▲" : d < 0 ? "▼" : "→";
  const tone =
    d === 0 || ["cost", "spend", "cpa"].includes(k)
      ? "neutral"
      : d > 0
        ? "positive"
        : "negative";
  if (k === "profitMargin") return `<span class="delta-main ${tone}"><span class="delta-badge">${d>0?"+":d<0?"−":""}${num(Math.abs(d))} procentpunt</span></span><span class="delta-base">Vorige periode: ${f(prev[k])}</span>`;
  const amount = (d > 0 ? "+" : d < 0 ? "−" : "") + f(Math.abs(d));
  const pct =
    prev[k] > 0 && Math.abs(d / prev[k]) <= 5
      ? (d > 0 ? "+" : d < 0 ? "−" : "") +
        num(Math.abs((d / prev[k]) * 100)) +
        "%"
      : null;
  const label =
    state.compare === "custom" ? "Vergelijkingsperiode" : "Vorige periode";
  return `<span class="delta-main ${tone}"><span class="delta-badge">${direction} ${esc(pct || amount)}</span>${pct ? `<span class="delta-amount">${esc(amount)}</span>` : ""}</span><span class="delta-base">${label}: ${esc(f(prev[k]))}</span>`;
}
const boundedComparison = p => p && p.from >= STORE_START && p.to <= today ? p : null;
function getPrev() {
  if (state.compare === "off") return null;
  const p =
    state.compare === "custom"
      ? { from: state.pfrom, to: state.pto }
      : previous(state.from, state.to);
  if (state.compare !== "custom" && state.to === today) {
    const monday = shift(
      today,
      -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7),
    );
    if (state.from === today.slice(0, 8) + "01") {
      const end = shift(state.from, -1);
      return boundedComparison({
        from: end.slice(0, 8) + "01",
        to:
          end.slice(0, 8) +
          String(Math.min(+today.slice(8), +end.slice(8))).padStart(2, "0"),
      });
    }
    if (state.from === monday && state.from !== today)
      return boundedComparison({ from: shift(state.from, -7), to: shift(state.to, -7) });
  }
  return boundedComparison(p);
}
function coverage(key, from = state.from, to = state.to) {
  const d = D[key];
  if (!d) return false;
  if (["meta","google"].includes(key)) {
    const dates=new Set(d[key==="meta"?"daily_meta":"daily_google"].map(r=>r.d));
    for(let day=from;day<=to;day=shift(day,1)) if(!dates.has(day)) return false;
    return true;
  }
  if (key === "creators")
    return to <= d.synced_at?.slice(0, 10) && from >= "2026-07-16";
  return from >= "2026-08-01";
}
const googleScopeNames = {
  nonbrand: "Non-branded",
  brand: "Branded",

  all: "Alles inclusief branded",
};
function analysisData() {
  return state.channel === "google" ? googleScopeData(D, state.googleScope) : D;
}
function channelRevenueBar(cur) {
  if (state.channel !== "all") return "";
  const google = compute(googleScopeData(D,"nonbrand"),C,state.from,state.to,"google");
  const channels = [
    {key:"meta",name:"Meta",color:"#4EA8DE",revenue:cur.channels.meta.revenue==null?null:cur.channels.meta.revenue/(1+C.assumed_vat)},
    {key:"google",name:"Google Ads",color:"#E5B863",revenue:google.revenue},
    {key:"infl",name:"Influencers",color:"#B98DE0",revenue:cur.channels.infl.revenue==null?null:cur.channels.infl.revenue/(1+C.assumed_vat)},
  ];
  const complete=cur.revenue!=null && channels.every(c=>c.revenue!=null && c.revenue>=0);
  const total=cur.revenue;
  const claimed=complete ? sum(channels,"revenue") : null;
  const overlap=complete ? Math.max(0,claimed-total) : null;
  channels.push({key:"other",name:"Overig / niet toegerekend",color:"#7D8BA5",revenue:complete?Math.max(0,total-claimed):null});
  const share=c=>complete&&total>0?num(c.revenue/total*100)+'%':'—';
  const label=c=>`${c.name}${c.key==='google'?' non-branded':''}: ${euro(c.revenue)}, ${share(c)} van Shopify-omzet excl. btw`;
  return `<section class="channel-revenue" aria-label="Toegerekende kanaalomzet"><span class="mix-label">Toegerekende omzet · geen sluitende verdeling</span>${!complete?'<p class="hint">Verdeling niet beschikbaar: een bron ontbreekt.</p>':''}<div class="revenue-legend">${channels.map(c=>{
 const tag=c.key==='other'?'span':'button';
 return `<${tag} class="revenue-item" ${c.key==='other'?'':`data-mix="${c.key}" data-channel="${c.key}"`} aria-label="${label(c)}"><i class="channel-dot" style="background-color:${c.color}"></i><span>${c.name}</span><b>${share(c)}</b><small>${euro(c.revenue)}</small></${tag}>`;
 }).join('')}</div><p class="mix-explanation">Referentie: Shopify-omzet excl. btw (${euro(total)}). Kanalen kunnen dezelfde order claimen en zijn niet optelbaar. Overig is alleen het positieve rekenkundige verschil; geen bewezen organische omzet. ${overlap>0?`Kanaalclaims liggen ${euro(overlap)} boven de winkelomzet.`:''}</p></section>`;

}
function googleFilter() {
  if (state.channel !== "google") return "";
  const unknown = (D.google?.daily_campaigns || []).filter(
    (r) => inRange(r, state.from, state.to) && !googleCampaignGroups[r.id],
  );
  const missing = unknown.length
    ? `<p class="hint">Nieuwe campagne nog niet ingedeeld: ${[...new Set(unknown.map((r) => esc(r.name)))].join(", ")}. Bekijk via Alles inclusief branded.</p>`
    : "";
  return `<section class="panel google-scope" aria-label="Google Ads merkverkeer"><p class="eyebrow">GOOGLE ADS · MERKVERKEER</p><div class="scope-options">${Object.entries(
    googleScopeNames,
  )
    .map(([key, label]) => {
      const m = compute(
        googleScopeData(D, key),
        C,
        state.from,
        state.to,
        "google",
      );
      return `<button data-google-scope="${key}" aria-pressed="${state.googleScope === key}" class="${state.googleScope === key ? "active" : ""}"><b>${label}</b><small>${euro(m.spend)} uitgaven · ${euro(m.revenue)} waarde</small></button>`;
    })
    .join(
      "",
    )}</div><details class="scope-explanation"><summary>Meetbasis & campagne-indeling</summary><p class="hint">Nu in alle cijfers, grafieken en details: <strong>${googleScopeNames[state.googleScope]}</strong>. Indeling op campagne: Corporate Search + Branded Shopping zijn branded; Generiek B2C, Generiek PMAX, Generiek B2B en Concurrentie zijn non-branded. Inclusief volledige Shopping- en PMAX-resultaten. Dit is geen indeling naar nieuwe klanten. Het bedrijfsoverzicht telt alle advertentiekosten mee.</p></details>${missing}</section>`;
}
const campaignKeywords = {
  23981332205: [
    "lumeworks",
    "lumeworks atlas",
    "lumeworks prime",
    "lumeworks titan",
  ],
  23980131321: [
    "bedrijfscadeau",
    "cadeau medewerker",
    "cadeau werknemer",
    "origineel relatiegeschenk",
    "premium relatiegeschenk",
    "relatiecadeau",
    "relatiecadeau beamer",
    "relatiegeschenk",
    "relatiegeschenk beamer",
    "zakelijk cadeau",
  ],
  23981395562: [
    "beamer",
    "beamer compact",
    "beamer draagbaar",
    "beamer ingebouwde apps",
    "beamer mini",
    "beamer netflix",
    "beamer slaapkamer",
    "beamer smart",
    "beamer thuisbioscoop",
    "beamer voor buiten",
    "beamer voor thuis",
  ],
  23981395565: [
    "beamer-store",
    "beamer-winkel",
    "beamerexpert",
    "lumenix",
    "lumina",
    "stobe",
  ],
};
const campaignDescriptions = {
  23981332205:
    "Corporate Search · zoekopdrachten naar LumeWorks en de modellen.",
  23989624267: "Branded Shopping · productadvertenties gericht op merkverkeer.",
  23981395562:
    "Generieke Search voor consumenten · mensen die naar beamers zoeken.",
  23985056312:
    "Generieke Performance Max · bereik over Google-kanalen, met LumeWorks uitgesloten als zoekterm.",
  23980131321:
    "Zakelijke Search · onder meer relatiegeschenken. Conversies kunnen offerteaanvragen zijn.",
  23981395565: "Concurrentie Search · zoekopdrachten naar andere merken.",
};
function orderDate(o) {
  if (!o.created_at || !Number.isFinite(Date.parse(o.created_at)))
    return o.d + " · tijd onbekend";
  return (
    o.d +
    " · " +
    new Intl.DateTimeFormat("nl-NL", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(o.created_at))
  );
}
const orderColumnWidths=[64,88,190,96,100,76,78];
function returnSummary(cur) {
 const affected=cur.orderRows.filter(o=>o.refunded_incl>0);
 return `<details class="panel" id="returnEstimate"><summary><span>Omzetcorrecties & retouren · ${cur.refundedOrders} orders</span><span>${euro(cur.refundedIncl)}</span></summary><p>Al van omzet afgetrokken: <strong>${euro(cur.refundedIncl)} terugbetalingen, inclusief in behandeling</strong>. Extra retourafhandeling: <strong>${euro(cur.returnCost)}</strong> (${cur.receivedReturnPackages} geregistreerde retourpakketten × ${euro(C.returns?.cost_per_return??20)}).</p><p class="hint">${D.returns?`Dagtotalen gecontroleerd op ${fmt(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(D.returns.synced_at)))}; dagelijks vernieuwd via de bestaande Shopify-pipeline. De eventuele orderregels hieronder horen bij de eerdere controle van ${esc(C.returns?.checked_on || 'onbekend')}.`:`Controle op ${esc(C.returns?.checked_on || 'onbekend')} · momentopname; actuele retourcontrole ontbreekt.`} Retourindeling gecontroleerd op ${esc(C.returns?.classification_checked_on || C.returns?.checked_on || "onbekend")}. Toegerekend aan de oorspronkelijke besteldatum, niet de terugbetaaldatum. Pakketaantal uit de registratie; bij deze historische orders is één pakket per retourorder aangenomen. Meerdere artikelen zijn niet automatisch meerdere pakketten.</p>${C.returns?.report_audit?`<p class="hint">Historische aansluiting met Shopify: ${C.returns.report_audit.orders} orders met verkoopherroepingen gecontroleerd t/m ${esc(C.returns.report_audit.through)}. Omzet, winst en winstmarge zijn voor deze orders ook in eerdere perioden gecorrigeerd. Rapportbedragen worden niet nogmaals afgetrokken. Bij terugbetalingen in behandeling gebruiken we het gecontroleerde ordertotaal; het rapport kan daar nog een afwijkend bedrag tonen.</p>`:""}${affected.length?`<div class="table-wrap"><table><thead><tr><th>Order</th><th>Terugbetaling</th><th>Shopify-herroeping</th><th>Retourkosten</th><th>Reden</th></tr></thead><tbody>${affected.map(o=>`<tr><td>${esc(o.num)}</td><td>${euro(o.refunded_incl)}</td><td>${o.sales_reversal_report==null?"—":euro(o.sales_reversal_report)}</td><td>${euro(o.return_cost)}</td><td>${o.return_kind==="received_return"?"Retour ontvangen":o.return_kind==="cancelled"?"Geannuleerd":"Reden onbekend"}${o.store_credit?" · winkeltegoed":""}${o.refund_status==="pending"?" · terugbetaling in behandeling":""}</td></tr>`).join("")}</tbody></table></div>`:""}<p class="hint">${cur.unknownReturns ? `${cur.unknownReturns} terugbetaalde orders hebben geen retourreden: hiervoor is nog geen €20 geboekt. ` : ""}Product- en leveringskosten blijven bij verzonden orders staan; de waarde van teruggekomen voorraad is nog niet uitgesplitst. Bij annuleringen vervallen deze kosten. Betaalkosten blijven berekend over het oorspronkelijk betaalde bedrag. Daan-bonus volgt de bestaande Meta-contractberekening.</p></details>`;
}
function overviewOrders(cur) {
 const rows=[...cur.orderRows].sort((a,b)=>b.d.localeCompare(a.d)||Number(b.num.replace(/\D/g,''))-Number(a.num.replace(/\D/g,'')));
 return `<details class="panel" id="overviewOrders"><summary><span>Orderdetail · ${fmt(state.from)} – ${fmt(state.to)} · ${rows.length} orders</span></summary><div class="order-controls"><input id="overviewOrderSearch" type="search" aria-label="Zoek op ordernummer of product" placeholder="Zoek order of product…"><span>Versleep kolomranden om te verbreden</span></div><div class="table-wrap"><table style="width:${sum(orderColumnWidths,x=>x)}px"><colgroup>${orderColumnWidths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><thead><tr>${["Order","Datum","Producten","Omzet incl. btw","Product + levering","Betaalkosten","Marge %"].map((label,i)=>`<th>${label}<span class="column-resizer" data-resize-column="${i}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Breedte ${label}" aria-valuemin="48" aria-valuemax="600" aria-valuenow="${orderColumnWidths[i]}"></span></th>`).join('')}</tr></thead><tbody>${rows.map(o=>{
 const f=finance([o],C),margin=f.cost!=null&&f.excl>0?(f.excl-f.cost)/f.excl*100:null;
 return `<tr data-order-search="${esc((o.num+' '+o.items.join(' ')).toLowerCase())}"><td title="${o.refunded_incl ? esc("Terugbetaald: "+euro(o.refunded_incl)+" · retourafhandeling: "+euro(o.return_cost)) : ""}">${esc(o.num)}${o.refunded_incl ? " *" : ""}</td><td title="${esc(orderDate(o))}">${fmt(o.d)}</td><td title="${esc(o.items.join(', '))}">${esc(o.items.map(x=>x.replace(/^LumeWorks /,'')).join(', '))}</td><td>${euro(o.incl)}</td><td>${euro(f.fixed)}</td><td>${euro(f.fees)}</td><td>${margin==null?'—':num(margin)+'%'}</td></tr>`;
 }).join('')}</tbody></table></div><p id="overviewOrderEmpty" class="hint" ${rows.length?'hidden':''}>Geen orders gevonden in deze selectie.</p><p class="order-cost-note">Omzet na gecontroleerde terugbetalingen. Marge na product-, betaal- en retourkosten, vóór marketing en overhead. Datum en producten: volledige details bij aanwijzen.</p></details>`;
}
function returnForecastPanel(cur) {
 const r=cur.returnReserve;
 if(!r.available)return `<details class="panel" id="returnForecast"><summary>Retourbegroting · niet beschikbaar</summary><p class="hint">${esc(r.reason)}. De getoonde winst bevat alleen geregistreerde correcties; er is geen nulreserve aangenomen.</p></details>`;
 return `<details class="panel" id="returnForecast"><summary><span>Retourbegroting · nog te verwachten</span><span class="summary-value">${euro(r.impact)}</span></summary><dl class="margin-build"><div class="margin-row"><dt>Verwachte terugbetalingen · excl. btw</dt><dd>${euro(r.refundExcl)}</dd></div><div class="margin-row"><dt>Verwachte retourafhandeling · €20/pakket</dt><dd>${euro(r.handling)}</dd></div><div class="margin-row"><dt>Lagere 4% overhead na terugbetaling</dt><dd>${euro(r.overheadCredit==null?null:-r.overheadCredit)}</dd></div><div class="margin-row total"><dt>Reservering in resultaat</dt><dd>${euro(r.impact)}</dd></div><div class="margin-row"><dt>Resultaat vóór reservering</dt><dd>${euro(cur.actualResult)}</dd></div></dl><p class="hint">Voorlopige winkelbasis: ${num(r.rate*100)}% retourorders, ${r.matureReturns} retouren op ${r.matureOrders} orders van minstens ${r.horizon} dagen oud. Mediaan ${r.median==null?'—':num(r.median)} dagen van bestelling tot verwerking; 95% binnen ${r.p95??'—'} dagen. Laatste retourcontrole: ${fmt(r.asOf)}. ${r.stale?'Controle is ouder dan 48 uur; de leeftijd blijft op dat controlemoment vastgezet.':''}</p><div class="table-wrap"><table><thead><tr><th>Bestelweek</th><th>Orders</th><th>Retourorders</th><th>Gem. vertraging</th><th>Rijpheid</th></tr></thead><tbody>${r.weeks.map(w=>`<tr><td>${fmt(w.week)}</td><td>${w.orders}</td><td>${w.returns}</td><td>${w.meanLag==null?'—':num(w.meanLag)+' dagen'}</td><td>${w.mature?'Voldoende oud':'Nog in ontwikkeling'}</td></tr>`).join('')}</tbody></table></div><p class="hint">Per open order neemt de verwachte resterende kans af met de gemeten vertraging. Al geregistreerde retouren en annuleringen krijgen geen extra reservering. Werkelijke correcties vervangen de raming bij de volgende controle; het model herijkt op nieuwe, voldoende oude orders. Terugbetaaldatum is een benadering van ontvangst, geen vastgelegde pakketontvangstdatum. Eén pakket per retourorder blijft een aanname. Het beperkte aantal retouren maakt deze eerste begroting onzeker. Meta en Google gebruiken het gedeelde winkelpercentage en dezelfde verdeling naar orderaandeel als de werkelijke correcties; influencerorders worden apart gehouden. We doen geen alsof er al genoeg data is voor eigen retourpercentages per advertentiekanaal. ROAS en Daan-bonus behouden hun contractbasis; de begroting verlaagt alleen het resultaat en de winstmarge.</p></details>`;
}
function netMarginPanel(cur) {
  return `<details class="panel net-margin" id="netMarginBuild"><summary><span>Opbouw netto marge</span><span class="summary-value">${cur.profitMargin==null?'—':num(cur.profitMargin)+'%'}</span></summary><dl class="margin-build">${cur.marginBuild.map(r=>`<div class="margin-row ${r.kind}" data-margin-row="${r.key}"><dt>${esc(r.label)}</dt><dd>${r.kind==='percent'?(r.value==null?'—':num(r.value)+'%'):euro(r.value)}</dd></div>`).join('')}</dl><p class="hint">${['meta','google'].includes(state.channel)?'Kanaalraming: product- en betaalkosten volgen de winkelmix vóór correcties. Terugbetalingen en retourkosten worden verdeeld naar orderaandeel; vrijval bij annulering is verwerkt.':state.channel==='infl'?'Eigen gekoppelde Shopify-orders, na correcties; opstartkosten zijn toegerekend naar omzetaandeel.':'Shopify-omzet na gecontroleerde correcties, met alle opgenomen kanaalkosten.'} Aandeel winkelwinst = kanaalresultaat / totaal winkelresultaat over dezelfde periode; overlappende kanaalramingen tellen niet noodzakelijk op tot 100%. Netto marge = resultaat / netto omzet excl. btw. Een onbekend bedrag blijft leeg. Actuele tarieven uit de kostprijssheet gelden ook voor historische orders; ingangsdatums ontbreken. Transport betreft levering naar Nederland. Fulfilment is het tarief per product/bundel uit de sheet; een los klantverzendtarief en korting bij gecombineerde pakketten ontbreken. Atlas bevat €3,06 broncorrectie. Retourafhandeling komt er afzonderlijk bij; teruggekomen producten blijven kosten tot voorraadherstel bekend is.</p></details>`;
}
function correctionAllocationPanel(cur) {
  const a=cur.correctionAllocation;
  const rows=[['Meta',a.weights?.meta,a.allocations.meta],['Google non-branded',a.weights?.google,a.allocations.google],['Overig',a.weights?.other,a.allocations.other],['Influencers · eigen orders',null,a.direct]];
  return `<details class="panel" id="channelCorrections"><summary>Retouren & omzetcorrecties per kanaal · verdeling</summary><p>${num(a.totalOrders)} Shopify-orders; ${num(a.excludedInfluencerOrders)} gekoppeld aan influencers. De overige ${num(a.orders)} orders vormen de verdeelbasis. Meta claimt ${num(a.metaOrders)} aankopen; Google non-branded ${num(a.googleNonbrandOrders)}.</p><div class="table-wrap"><table><thead><tr><th>Kanaal</th><th>Aandeel resterende orders</th><th>Omzetcorrectie incl. btw</th><th>Retourafhandeling</th><th>Verlaging resultaat</th></tr></thead><tbody>${rows.map(([name,weight,v])=>`<tr><td>${name}</td><td>${weight==null?(name.startsWith('Influencers')?'Eigen orderkoppeling':'—'):num(weight*100)+'%'}</td><td>${euro(v.refundedIncl)}</td><td>${euro(v.returnCost)}</td><td>${euro(v.profitImpact)}</td></tr>`).join('')}</tbody></table></div><p class="hint">Influencerorders worden rechtstreeks verwerkt en uit de verdeelpot gehaald. De rest volgt Meta-aankopen en Google non-branded aankopen / resterende Shopify-orders. ${a.normalized?'De platformclaims overlappen: aandelen zijn evenredig begrensd tot samen 100%.':'Niet toegerekende aandelen blijven bij overig.'} Een ontbrekende bron geeft geen verzonnen verdeling. Branded Google krijgt geen afzonderlijk deel; in de weergave Alles zit hetzelfde Google-deel één keer.</p><p class="hint">De kanaalraming begint met de winkelmarge vóór correcties. Daarna verwerken we terugbetaalde omzet excl. btw en €20 per geregistreerd retourpakket, met vrijval van productkosten bij annulering en lagere 4% overhead over terugbetaalde omzet. Zo tellen correcties één keer mee. De verdeling verandert alleen kanaalramingen; het Shopify-totaal bevat de volledige correcties al. Dagen in de grafiek gebruiken dezelfde aandelen als de geselecteerde periode. Dit blijft een schatting op basis van de gecontroleerde momentopname.</p></details>`;
}
function marketingMix(cur) {
  const metaResult = compute(D,C,state.from,state.to,"meta",{includeDaan:state.daan!=="without"});
  const influencer = compute(D, C, state.from, state.to, "infl");
  const nonbrand = compute(
    googleScopeData(D, "nonbrand"),
    C,
    state.from,
    state.to,
    "google",
  );
  const limit = cur.count > 0 && cur.cost != null && cur.revenue != null ? (cur.revenue-cur.cost-cur.overhead)/cur.count : null;
  const purchaseRows = Object.entries(cur.channels).map(([k,v])=>{
    const spend=k==='google'?nonbrand.spend:v.spend;
    const count=k==='google'?nonbrand.count:v.orders;
    const cpa=spend!=null && count>0 ? spend/count : null;
    return `<tr><td>${names[k]}${k==='google'?'<small class="row-description">Non-branded</small>':''}</td><td>${num(count)}</td><td>${euro(cpa)}</td><td>${euro(limit)}</td><td>${cpa!=null && limit!=null ? euro(limit-cpa) : '—'}</td></tr>`;
  }).join('');
  const attributed=[metaResult.revenue,nonbrand.revenue,influencer.revenue];
  const other=cur.revenue!=null && attributed.every(v=>v!=null&&v>=0)?Math.max(0,cur.revenue-sum(attributed,v=>v)):null;
  const otherRow=`<tr data-other-revenue><td>Overig / niet toegerekend</td><td>${euro(other)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
  return `<details class="panel" id="marketingMix"><summary>Kanalen naast elkaar</summary>${channelRevenueBar(cur)}<div class="table-wrap"><table><thead><tr><th>Kanaal</th><th>Kanaalomzet excl. btw</th><th>Kosten</th><th>ROAS</th><th>Winst · geschat</th><th>Winstmarge · geschat</th></tr></thead><tbody>${Object.entries(
    cur.channels,
  )
    .map(([k, v]) => {
      const revIncl = k === "google" ? nonbrand.revenueIncl : v.revenue;
      const rev = revIncl==null?null:revIncl/(1+C.assumed_vat);
      const denominator = k === "google" ? nonbrand.spend : v.spend;
      const profit = k === "infl" ? influencer.result : k === "meta" ? metaResult.result :
        nonbrand.result!=null && v.spend!=null && nonbrand.spend!=null ? nonbrand.result-(v.spend-nonbrand.spend) : null;
      return `<tr><td><button class="link" data-channel="${k}">${names[k]} →</button></td><td>${euro(rev)}${k === "google" ? '<small class="row-description">Non-branded</small>' : ""}</td><td>${euro(v.spend)}${k==='infl'?`<small class="row-description">Commissies ${euro(v.commission)} + opstartkosten ${euro(v.giftAllocated)}</small>`:''}${k === "google" ? `<small class="row-description">Waarvan non-branded ${euro(nonbrand.spend)}</small>` : ""}</td><td>${ratio(denominator > 0 && revIncl != null ? revIncl / denominator : null)}</td><td>${euro(profit)}</td><td><strong>${profit!=null && rev>0 ? num(profit/rev*100)+"%" : "—"}</strong></td></tr>`;
    })
    .join(
      "",
     )}${otherRow}</tbody></table></div><p class="hint">Alle kanaalomzet hieronder is excl. btw. ROAS blijft op omzet incl. btw, zoals de advertentieplatforms en de bonusregeling. Google-ROAS: non-branded omzet incl. btw / non-branded kosten. Resultaat: geschatte marge minus alle kanaalkosten, inclusief branded bij Google. Winstmarge = geschat resultaat / kanaalomzet excl. btw. Meta en Google gebruiken de winkelmarge vóór correcties, daarna de verdeling naar orderaandeel. Omzet en winst zijn na toegerekende correcties; influencerresultaat gebruikt de eigen gekoppelde orders. Kanaalresultaten zijn niet optelbaar. Overig is het positieve verschil tussen Shopify-omzet excl. btw en de kanaalclaims; kosten en winst zijn niet afzonderlijk toe te rekenen.</p></details><details class="panel" id="acquisitionCompare"><summary>Kosten per aankoop & break-even</summary><p class="hint">Vergelijk bekende marketingkosten per toegerekende aankoop. CAC voor uitsluitend nieuwe klanten is nog niet beschikbaar.</p><div class="table-wrap"><table><thead><tr><th>Kanaal</th><th>Aankopen</th><th>Kosten per aankoop</th><th>Break-even · raming</th><th>Ruimte per aankoop</th></tr></thead><tbody>${purchaseRows}</tbody></table></div><p class="hint">Break-even is één winkelbenchmark: (omzet excl. btw − product-, betaal- en bedrijfskosten) / Shopify-orders. Dezelfde grens geldt hier voor elk kanaal; verschillen in klant- en productmix zijn niet bekend. Positieve ruimte is geen bewezen kanaalwinst. Google gebruikt non-branded conversies; overlap tussen aankoopmetingen kan de kosten per aankoop te laag laten lijken. Influencers: commissies plus geregistreerde opstartkosten, verdeeld naar omzetaandeel.</p></details>`;
}
function resultLimitations(cur, keys) {
  const messages = [];
  if (['all','meta'].includes(state.channel) && state.daan !== 'without' && cur.management.total == null) {
    const missing = cur.management.periods.filter(p => p.bonus == null);
    const historical = missing.some(p => p.from < '2026-08-01' || (D.meta?.daily_meta?.[0]?.d && p.from < D.meta.daily_meta[0].d));
    messages.push(`Resultaat onvolledig: ${historical ? 'historische bonusgegevens Daan ontbreken' : 'bonus Daan nog niet berekenbaar'}.`);
  }
  if (cur.channels.infl.giftTotal==null && ["all","infl"].includes(state.channel)) messages.push("Opstartkosten influencers ontbreken; resultaat niet volledig berekenbaar.");
  if (cur.unknown) messages.push(`${cur.unknown} productregels zonder kostprijs; resultaat niet berekenbaar.`);
  if (["meta","google"].includes(state.channel) && !cur.correctionAllocation.weights) messages.push("Verdeling van correcties niet berekenbaar: benodigde order- of kanaalgegevens ontbreken.");
  if (E.returns || cur.returnReserve.stale) messages.push("Retourcontrole niet actueel; de reservering gebruikt het laatst gecontroleerde moment.");
  if (E.status) messages.push("Synchronisatiestatus niet beschikbaar; actualiteit is niet volledig controleerbaar.");
  if (E.costs) messages.push("Kostenregister niet vernieuwd: berekening gebruikt de laatst gecontroleerde tarieven.");
  const unavailable = keys.filter(k => !D[k] || E[k] || stale(k) || !coverage(k));
  if (unavailable.length) messages.push(`Brongegevens onvolledig: ${unavailable.map(k=>k==='shopify'?'Shopify':k==='creators'?'Influencers':names[k]).join(', ')}. Totalen kunnen onvolledig zijn.`);
  if (!messages.length && cur.result == null) messages.push('Resultaat niet berekenbaar met de beschikbare omzet- en kostengegevens.');
  return messages;
}
function steeringSummary(cur, prev) {
  if (!prev || cur.revenue == null || prev.revenue == null) return 'Er is geen volledige vergelijkingsperiode beschikbaar.';
  const p=getPrev();
  const movement=(value,before,noun)=>{
    const diff=value-before;
    if(diff===0) return `${noun} blijft gelijk`;
    const pct=before>0 && Math.abs(diff/before)<=5 ? ` (${num(Math.abs(diff/before*100))}%)` : '';
    return `${noun}: ${euro(Math.abs(diff))} ${diff>0?'meer':'minder'}${pct}`;
  };
  let text=`Ten opzichte van ${fmt(p.from)} – ${fmt(p.to)}: `+movement(cur.revenue,prev.revenue,state.channel==='all'?'omzet':'toegerekende omzet excl. btw');
  if(cur.result!=null && prev.result!=null) text+='; '+movement(cur.result,prev.result,state.channel==='all'?'voorlopig resultaat':state.channel==='infl'?'resultaat eigen orders':'geschat resultaat');
  text+='.';
  if(cur.profitMargin!=null && prev.profitMargin!=null) text+=` Winstmarge: van ${num(prev.profitMargin)}% naar ${num(cur.profitMargin)}% (van elke €100 omzet excl. btw blijft ${num(cur.profitMargin)} euro ${state.channel==='all'?'voorlopig':state.channel==='infl'?'na toegerekende kosten':'naar schatting'} over).`;
  if(cur.spend!=null && prev.spend!=null && prev.spend>0 && prev.revenue>0 && cur.spend>prev.spend && cur.spend/prev.spend>cur.revenue/prev.revenue) text+=' Marketingkosten groeien sneller dan omzet.';
  return text;
}
function knownMarketingCosts(cur) {
  if (!['all','meta'].includes(state.channel) || state.daan==='without' || cur.management.total!=null) return '';
  const values=state.channel==='all' ? [cur.channels.meta.mediaSpend,cur.channels.google.spend,cur.channels.infl.spend] : [cur.channels.meta.mediaSpend];
  if(values.some(v=>v==null)) return '';
  const known=sum(values,v=>v)+cur.management.fixed+sum(cur.management.periods.filter(p=>p.allocated!=null),p=>p.allocated);
  return `<p class="known-costs">Bekende marketingkosten: <strong>${euro(known)}</strong>, exclusief de ontbrekende bonus. Het volledige totaal en resultaat blijven onberekenbaar.</p>`;
}
function channelBenchmark(cur) {
  if(state.channel==='all') return '';
  const shop=compute(D,C,state.from,state.to,'all',{includeDaan:state.daan!=='without'});
  const limit=shop.count>0 && shop.cost!=null && shop.revenue!=null ? (shop.revenue-shop.cost-shop.overhead)/shop.count : null;
  const room=cur.cpa!=null && limit!=null ? limit-cur.cpa : null;
  return `<section class="channel-benchmark" aria-label="Kosten per aankoop en break-even"><span>Kosten per aankoop <strong>${euro(cur.cpa)}</strong></span><span>Break-even · winkelraming <strong>${euro(limit)}</strong></span><span>Ruimte per aankoop <strong>${euro(room)}</strong></span><details><summary>Hoe lees je dit?</summary><p>Gemiddelde winkelmarge vóór marketing per Shopify-order. Dezelfde benchmark voor ieder kanaal; productmix en overlap in attributie kunnen afwijken. Positieve ruimte is geen bewezen kanaalwinst en kosten per aankoop zijn geen nieuweklant-CAC.</p></details></section>`;
}
let datePickers = [];
function render() {
  datePickers.forEach((p) => p.update());
  const cur = viewCompute(analysisData(), C, state.from, state.to, state.channel),
    p = getPrev();
  const keys =
    state.channel === "all"
      ? ["meta", "google", "shopify", "creators"]
      : state.channel === "infl"
        ? ["creators"]
        : [state.channel];
  const prev =
    p && keys.every((k) => coverage(k, p.from, p.to))
      ? viewCompute(analysisData(), C, p.from, p.to, state.channel)
      : null;
  $("#comparison").value = state.compare;
  $("#from").value = state.from;
  $("#to").value = state.to;
  $("#tabs").innerHTML = Object.entries(names)
    .map(
      ([k, n]) =>
        `<button role="tab" id="tab-${k}" aria-controls="content" aria-selected="${state.channel === k}" tabindex="${state.channel === k ? 0 : -1}" data-channel="${k}">${n}</button>`,
    )
    .join("");
  $("#content").setAttribute("aria-labelledby", "tab-" + state.channel);
  const metrics = ["revenue", "result", "profitMargin", "spend"];
  const secondaryMetrics = state.channel === "all" ? ["cost", "roas"] : ["count", "roas", "cpa"];
  const limitations = resultLimitations(cur, keys);
  const notes = [];
  if(state.channel === "all") notes.push(`Shopify-correcties gecontroleerd op ${D.returns?.model?.asOf || C.returns?.checked_on || "onbekend"}: ${euro(cur.refundedIncl)} terugbetaald en ${euro(cur.returnCost)} extra retourkosten voor orders in deze periode. Dit is een momentopname.`);
  if (keys.some((k) => !D[k] || E[k] || stale(k) || !coverage(k)))
    notes.push(
      "Een bron is niet beschikbaar, verouderd of dekt niet de volledige periode. Bekijk de datastatus; totalen kunnen onvolledig zijn.",
    );

  if (state.channel === "infl")
    notes.push(
      "Kosten bevatten commissies en de geregistreerde opstartkosten naar omzetaandeel. Dit is een verdeelsleutel, geen boeking op verzenddatum; nieuwe omzet herverdeelt historische kosten.",
    );

  if (cur.unknown)
    notes.unshift(
      `${cur.unknown} productregels zonder kostprijs. Resultaat is niet berekenbaar.`,
    );
  if (
    state.channel === "all" &&
    prev &&
    cur.result != null &&
    prev.result != null &&
    cur.result < prev.result &&
    cur.revenue > prev.revenue
  )
    notes.push(
      "Omzet stijgt, maar het voorlopige resultaat daalt. Vergelijk omzet en resultaat voor de onderliggende ontwikkeling.",
    );
  notes.push(state.channel === "all" ? `Omzet ${euro(cur.revenue)} excl. btw; marketingkosten ${euro(cur.spend)} en resultaat ${euro(cur.result)} na 4% overhead.` : `Kanaalomzet ${euro(cur.revenue)} excl. btw tegenover ${euro(cur.spend)} bekende kanaalkosten. Kosten per toegerekende aankoop: ${euro(cur.cpa)}.`);
  const comparisonText =
    state.compare === "off"
      ? "Zonder vergelijking"
      : p
        ? `vs. ${fmt(p.from)} – ${fmt(p.to)}`
        : "Geen eerdere periode vanaf 5 aug beschikbaar";
  const storeResult=state.channel==='all'?cur.result:compute(D,C,state.from,state.to,'all',{includeDaan:state.daan!=='without'}).result;
  const profitShare=cur.result!=null && storeResult>0 ? cur.result/storeResult*100 : null;
  const metricCard = (k) => {
     const m = metricMeta(k);
     return `<button class="kpi ${state.metrics.includes(k) ? "active" : ""}" data-metric="${k}" aria-pressed="${state.metrics.includes(k)}"><span class="label">${m.label}</span><strong>${m.fmt(cur[k])}</strong><small>${k === "result" && state.channel === "all" && cur.result != null && cur.revenue > 0 ? (state.daan==="without" ? "Zonder kosten Daan" : (cur.returnReserve.available?"Met Daan · na retourbegroting":"Met Daan · na 4% overhead")) : k === "result" && state.channel!=="all" ? (cur.result!=null && cur.revenue>0 ? num(cur.profitMargin)+"% van omzet excl. btw · geschat"+(cur.returnReserve.available?" · na retourbegroting":"") : "Marge niet beschikbaar") : k === "cost" && cur.cost != null && cur.revenue > 0 ? num((cur.cost / cur.revenue) * 100) + "% van omzet · geraamde basis" : k === "revenue" && state.channel === "all" ? num(cur.count) + " orders · " + euro(cur.incl) + " incl. btw" : m.sub}${k==='result' && state.channel!=='all' ? `<span class="profit-share" title="Aandeel van ${euro(storeResult)} winkelwinst; kanaalramingen kunnen overlappen">${profitShare==null?'Aandeel winkelwinst niet beschikbaar':num(profitShare)+'% van winkelwinst'}</span>` : ''}</small><small class="delta">${delta(k, cur, prev)}</small></button>`;
   };
  $("#content").innerHTML =
    `<div class="view-head"><div><p class="eyebrow">${state.channel === "all" ? "HET TOTAALBEELD" : "KANAALANALYSE"}</p><h2>${state.channel === "all" ? "Financieel overzicht" : names[state.channel]}</h2></div><div class="subtitle">${fmt(state.from)} – ${fmt(state.to)} ${state.to.slice(0, 4)}<br>${comparisonText}${state.to === today ? "<br><small>Vandaag loopt nog · vergeleken met hele dagen</small>" : ""}</div></div>
 ${limitations.length ? `<div class="result-limitations" role="status">${limitations.map(t=>`<p>${esc(t)}</p>`).join('')}<button class="link" data-show-status>Bronnen bekijken</button></div>` : ''}
 ${state.daan==='without' && ['all','meta'].includes(state.channel) ? '<p class="scenario-note">Scenario zonder kosten Daan · vergoeding uitgesloten van resultaat</p>' : ''}
 ${googleFilter()}
 <section class="kpis overview-kpis primary-kpis" aria-label="Kerncijfers">${metrics.map(metricCard).join('')}</section>
 <section class="steering-summary" aria-label="Ontwikkeling"><p>${esc(state.compare==='off' ? `Geselecteerde periode: ${euro(cur.revenue)} ${state.channel==='all'?'omzet excl. btw':'toegerekende omzet excl. btw'} en ${euro(cur.result)} ${state.channel==='all'?'voorlopige':'geschatte'} winst.` : steeringSummary(cur,prev))}</p><details class="signals"><summary>${state.channel==='all'?'Toelichting · kosten & retouren':'Schattingen & meetbasis'}</summary>${notes.map(n=>`<div class="signal">${esc(n)}</div>`).join('')}</details></section>
 ${netMarginPanel(cur)}
 ${returnForecastPanel(cur)}
 ${channelBenchmark(cur)}
 <section class="panel ${analysisCollapsed?'is-collapsed':''}" id="analysis" tabindex="-1"><div class="panel-head"><div><p class="analysis-label">VERDIEP JE IN DE CIJFERS</p><h2><button class="analysis-heading" id="collapseAnalysis" aria-expanded="${!analysisCollapsed}" aria-controls="analysisBody analysisTools">${state.metrics.map((k) => metricMeta(k).label).join(" & ") || "Analyse"}</button></h2><p class="subtitle">Klik bovenaan maximaal twee cijfers aan om ze hier te vergelijken.</p></div><div class="toolbar" id="analysisTools" ${analysisCollapsed?"hidden":""}><div class="gran-buttons" aria-label="Grafiek groeperen">${['day','week','month'].map((g,i)=>`<button data-gran="${g}" aria-pressed="${state.gran===g || state.gran==='auto' && g===((Date.parse(state.to)-Date.parse(state.from))/864e5<=31?'day':(Date.parse(state.to)-Date.parse(state.from))/864e5<=180?'week':'month')}">${['Dag','Week','Maand'][i]}</button>`).join('')}</div><select id="gran" hidden><option value="auto">Automatisch</option><option value="day">Dag</option><option value="week">Week</option><option value="month">Maand</option></select><button id="chartMode">${chartTable ? "Grafiek tonen" : "Tabel tonen"}</button></div></div><div id="analysisBody" ${analysisCollapsed?"hidden":""}><div id="replacement"></div><div id="chart"></div><div id="dayComparison"></div><details class="detail-fold" id="detailFold"><summary>Onderliggende cijfers & uitsplitsing</summary><div id="detail"></div></details></div></section>
 <details class="panel" id="costOverview"><summary>${state.channel==='all'?'Kostenopbouw & rendement':'Meer marketingcijfers'}</summary><section class="kpis secondary-kpis" aria-label="Aanvullende cijfers">${secondaryMetrics.map(metricCard).join('')}</section>${knownMarketingCosts(cur)}${state.channel==='all'?`<dl class="cost-lines">${cur.marginBuild.filter(r=>['purchase','inbound_shipping','fulfillment','source_adjustment','unallocated','products','payments','returns'].includes(r.key)).map(r=>`<div><dt>${esc(r.label)}</dt><dd>${euro(r.value==null?null:-r.value)}</dd></div>`).join('')}<div class="cost-subtotal"><dt>Totaal product- en orderkosten</dt><dd>${euro(cur.cost)}</dd></div><div><dt>Marketingkosten ${state.daan==='without'?'zonder Daan':'met Daan'}</dt><dd>${euro(cur.spend)}</dd></div><div><dt>Overige bedrijfskosten · 4%</dt><dd>${euro(cur.overhead)}</dd></div></dl><p class="hint">Productkosten zijn geraamd. Open onderliggende cijfers in de grafiek voor de uitsplitsing.</p>`:''}${['all','meta'].includes(state.channel)?`<div class="daan-choice compact"><span>Kosten Daan meetellen</span><div class="daan-toggle" aria-label="Kosten Daan meetellen"><button data-daan="with" aria-pressed="${state.daan!=='without'}">Met Daan</button><button data-daan="without" aria-pressed="${state.daan==='without'}">Zonder Daan</button></div><button class="link" data-daan-details>Vast + bonus bekijken</button></div>`:''}</details>
 ${state.channel === "all" ? marketingMix(cur)+returnSummary(cur) : ""}
 ${['all','meta','google'].includes(state.channel) ? correctionAllocationPanel(cur) : ''}
 ${['all','meta'].includes(state.channel) ? `<details class="panel management">
 <summary class="management-heading"><span>Meta-beheer<small>Vaste vergoeding en prestatiebonus</small></span><span class="management-heading-total">${euro(cur.management.total)}</span></summary>
 <div class="management-amounts">
  <div><span>Vaste vergoeding</span><strong>${euro(cur.management.fixed)}</strong><small>€ 1.500 per maand, verdeeld over de geselecteerde dagen.</small></div>
  <div><span>Prestatiebonus</span><strong>${euro(cur.management.bonus)}</strong><small>Dagelijkse bonusopbouw inclusief negatieve verliesdagen en eventuele blokcorrectie.</small></div>
  <div class="management-total"><span>Totaal Meta-beheer</span><strong>${euro(cur.management.total)}</strong><small>${state.daan==='without'?'Uitgesloten van deze analyse.':'Meegenomen in de marketingkosten.'}</small></div>
 </div>
 <p class="management-note">De 4% overige bedrijfskosten wordt apart berekend.</p>
 <details class="management-calculation"><summary>Hoe wordt de bonus berekend?</summary>
 <p>Per dag: 10% × (Meta-omzet − advertentiekosten × break-even-ROAS). Verliesdagen geven een negatief bedrag en verlagen de opgebouwde bonus. Alle dagen binnen één contractblok gebruiken dezelfde break-even-ROAS.</p>
 <p>We tellen de dagbedragen op per contractblok van 30 dagen. Alleen het bloktotaal krijgt een minimum van € 0. Als het saldo negatief is, wordt op de laatste blokdag één correctie geboekt. Bij een lopend blok gebeurt dit voorlopig op de laatste beschikbare dag; dit kan bij nieuwe data veranderen. Je selectie telt de dagbedragen en correcties op de geselecteerde dagen mee.</p>
 <div class="table-wrap"><table><thead><tr><th>Bonusperiode</th><th>Bonus hele periode</th><th>Hiervan in je selectie</th></tr></thead><tbody>${cur.management.periods.map(p=>`<tr><td>${fmt(p.from)} – ${fmt(p.to)}<small>${p.bonus==null?'Nog niet berekenbaar':p.through<p.to?'Voorlopig · bijgewerkt t/m '+fmt(p.through):'Periode afgelopen'}</small></td><td>${euro(p.bonus)}</td><td>${euro(p.allocated)}</td></tr>`).join('')}</tbody></table></div>
 <p class="management-method">Rekenregel: 10% × max(0, Meta-omzet − advertentiekosten × break-even-ROAS). Break-even is gebaseerd op de Shopify-marge na productkosten, betaalkosten en 4% overige bedrijfskosten. De contractperiodes starten op 16 juli 2026. De bonus van een lopende periode kan nog veranderen. De vaste vergoeding is € 1.500 gedeeld door de kalenderdagen van de betreffende maand.</p>
 </details><details class="management-calculation"><summary>Dagelijkse vergoeding & bonusopbouw</summary><p class="hint">Negatieve bonusopbouw verlaagt de kosten op die dag. Blokcorrectie voorkomt een negatieve bonus over het hele contractblok. Ontbrekende brongegevens blijven onbekend; de vaste dagvergoeding is wel bekend.</p><div class="table-wrap"><table><thead><tr><th>Dag</th><th>Vast</th><th>Bonusopbouw</th><th>Blokcorrectie</th><th>Dagkosten</th></tr></thead><tbody>${cur.management.daily.map(r=>`<tr><td>${fmt(r.d)}<small>${r.d.slice(0,4)}</small></td><td>${euro(r.fixed)}</td><td>${euro(r.contribution)}</td><td>${euro(r.adjustment)}</td><td>${euro(r.total)}</td></tr>`).join('')}</tbody></table></div></details></details>` : ''}
 ${state.channel === "infl" ? creatorSummary(D.creators,C) : state.channel === "all" && D.creators?.collaborations ? `<details class="panel creator-overview"><summary><span>Influencers · investering & opbrengst</span><small>${D.creators.collaborations.total} samenwerkingen · ${Math.round(D.creators.collaborations.without_orders/D.creators.collaborations.total*100)}% zonder codebestellingen</small></summary>${creatorSummary(D.creators,C)}</details>` : ""}
 ${state.channel === "all" ? overviewOrders(cur) : ""}
`;
  $("#gran").value = state.gran;
  renderChart();
  renderDetail();
  if(state.detail) $("#detailFold").open=true;
  if(state.metrics.some(k=>secondaryMetrics.includes(k))) $("#costOverview").open=true;
  renderStatus();
  bindContent();
}
function renderUpdateSummary() {
  const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("nl-NL", {timeZone:"Europe/Amsterdam",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "Tijdstip niet beschikbaar";
  const metaStamp = D.meta?.snap && D.meta?.snap_time ? `${fmt(D.meta.snap)} ${D.meta.snap.slice(0,4)} · ${D.meta.snap_time}` : "Tijdstip niet beschikbaar";
  const sources = [
    ["meta", "Meta", metaStamp, "Elke 15 minuten"],
    ["google", "Google Ads", stamp(D.google?.synced_at), "Elke 15 minuten"],
    ["creators", "Influencers", stamp(D.creators?.synced_at), "Elk uur"],
    ["shopify", "Shopify", D.source_status?.shopify?.last_success ? "Bron bijgewerkt: " + stamp(D.source_status.shopify.last_success) : D.shopify_check ? "Orders gecontroleerd: " + stamp(D.shopify_check.checked_at) : "Ordergegevens niet gecontroleerd", "Nieuwe orders automatisch"],
  ];
  $("#updateSummary").innerHTML = `<div class="update-heading"><strong>Data & updates</strong><button id="refreshData" class="quiet">Gegevens verversen</button></div><div class="update-sources">${sources.map(([key,name,time,cadence]) => {
    const bad = !D[key] || E[key] || stale(key);
    const status = !D[key] ? "Niet beschikbaar" : E[key] ? "Laatste bewaarde gegevens" : stale(key) ? "Verversing vertraagd" : key === "shopify" ? (D.shopify_check ? "Ordergegevens gecontroleerd" : "Controle niet beschikbaar") : "Bijgewerkt";
    return `<div class="update-source"><span class="update-dot ${bad ? "warning" : ""}" aria-hidden="true"></span><div><strong>${name}</strong><span>${esc(time)}</span><small>${cadence}</small><small class="update-status">${status}</small></div></div>`;
  }).join("")}</div><p class="hint">Tijden in Nederland. Bronupdates en ordercontrole staan afzonderlijk vermeld. Ververs om de nieuwste beschikbare gegevens te laden. TrackBee-metingen komen via Google Ads binnen.</p>`;
  $("#refreshData").onclick = async () => {
    const button = $("#refreshData"); button.disabled = true; button.textContent = "Gegevens ophalen…";
    try { ({data:D,costs:C,errors:E}=await load()); render(); }
    catch { button.disabled=false; button.textContent="Verversen mislukt · opnieuw proberen"; }
  };
}
function renderStatus() {
  const keys=['meta','google','creators','shopify'];
  const healthy=keys.every(k=>D[k] && !E[k] && !stale(k) && coverage(k)) && !E.status && !E.costs && !E.returns && D.returns && Date.now()-Date.parse(D.returns.synced_at)<48*3600e3 &&
    compute(analysisData(),C,state.from,state.to,state.channel,{includeDaan:state.daan!=='without'}).result!=null;
  const timestamps=[D.source_status?.meta?.last_success,D.google?.synced_at,D.creators?.synced_at,D.source_status?.shopify?.last_success].map(t=>Date.parse(t)).filter(Number.isFinite);
  const latest=timestamps.length?new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(Math.max(...timestamps))):'tijdstip onbekend';
  $('#statusButton').innerHTML=`<span class="live-dot ${healthy?'':'warning'}" aria-hidden="true"></span>`;
  $('#statusButton').className='status-info';
  $('#statusButton').setAttribute('aria-label','Data & updates bekijken');
  $('#statusButton').title='Data & updates';
  $('#dashboardStatus').innerHTML=`<button id="statusBadge" class="status-badge ${healthy?'is-healthy':'is-warning'}" aria-expanded="${!$('#status').hidden}" aria-controls="status"><span class="live-dot ${healthy?'':'warning'}" aria-hidden="true"></span><span><strong>${healthy?'Gegevens actueel':'Gegevens controleren'}</strong><small>Laatste bronupdate: ${esc(latest)} · Meta, Google, Shopify, influencers</small></span><span class="badge-arrow" aria-hidden="true">›</span></button>`;
  $('#statusBadge').onclick=()=>{const open=$('#status').hidden;$('#status').hidden=!open;$('#statusBadge').setAttribute('aria-expanded',String(open));$('#statusButton').setAttribute('aria-expanded',String(open));};
  $('#status').innerHTML=`<div id="updateSummary" aria-live="polite"></div><details class="order-check"><summary>Shopify-ordercontrole</summary>${D.shopify_check ? `<p>${D.shopify_check.orders} unieke orders · ${D.shopify_check.test_orders} testorders uitgesloten. Laatste order: ${esc(D.shopify_check.latest_num)} · ${esc(D.shopify_check.latest_date)}.</p><p>${(()=>{const m=compute(D,C,state.from,state.to,'all');return `Geselecteerde periode: ${num(m.count)} orders · ${euro(m.incl)} omzet incl. btw.`})()}</p><button id="viewShopifyOrders">Shopify-orders bekijken</button>` : '<p>Ordercontrole niet beschikbaar.</p>'}<p class="hint">Dezelfde orderbron als het Meta-dashboard. Controle op unieke ordernummers, datums, bedragen en productregels bij laden; dit is niet het tijdstip van een nieuwe bestelling.</p></details>`;
  renderUpdateSummary();
  if($('#viewShopifyOrders')) $('#viewShopifyOrders').onclick=()=>{change(()=>{state.channel='all';state.metrics=['revenue'];state.detail={type:'orders',name:'Alle orders'};state.sub=null;});$('#detailFold').open=true;$('#detail').scrollIntoView({block:'start'});};
}
function chartRows() {
  const days = (new Date(state.to) - new Date(state.from)) / 864e5;
  const g =
    state.gran === "auto"
      ? days <= 31
        ? "day"
        : days <= 180
          ? "week"
          : "month"
      : state.gran;
  return series(analysisData(), C, state.from, state.to, state.channel, g, {includeDaan:state.daan!=="without"});
}
function renderDayComparison() {
  const dates=[...selectedDays].filter(d=>d>=state.from && d<=state.to).sort();
  selectedDays=new Set(dates);
  $("#dayComparison").hidden=!dates.length;
  const from=dates[0],to=dates.at(-1);
  const totals=dates.length ? viewCompute(analysisData(),C,from,to,state.channel) : null;
  $("#dayComparison").innerHTML=`<section class="selection-overview" aria-label="Geselecteerde periode">${totals ? `<div class="panel-head"><div><h3>Geselecteerde periode</h3><p class="subtitle">${fmt(from)} – ${fmt(to)} ${to.slice(0,4)} · ${dates.length} ${dates.length===1?'dag':'dagen'}</p></div><button id="clearDays">Selectie wissen</button></div><div class="selection-totals">${state.metrics.map(k=>`<div><span>${metricMeta(k).label}</span><strong data-selection-metric="${k}">${metricMeta(k).fmt(totals[k])}</strong></div>`).join('')}</div>` : ''}<details class="range-access"><summary>${totals?'Selectie aanpassen':'Periode met datums kiezen'}</summary><label>Van<input id="rangeStart" type="date" min="${state.from}" max="${state.to}" value="${from||state.from}"></label><label>Tot<input id="rangeEnd" type="date" min="${state.from}" max="${state.to}" value="${to||state.to}"></label><button id="applyChartRange">Selecteren</button></details></section>`;
}
function renderChart() {
  renderDayComparison();
  if(!state.metrics.length) { $("#chart").innerHTML='<p class="hint">Klik bovenaan op een cijfer om de grafiek te openen.</p>'; return; }
  const rows = chartRows(),
    keys = state.metrics;
  if (chartTable) {
    $("#chart").innerHTML =
      `<div class="table-wrap"><table><thead><tr><th>Periode</th>${keys.map((k) => `<th>${metricMeta(k).label}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr class="${selectedDays.has(r.from)?'selected-bucket':''}"><td><button class="link" aria-pressed="${selectedDays.has(r.from)}" data-bucket="${r.from}|${r.to}">${fmt(r.from)} – ${fmt(r.to)}</button></td>${keys.map((k) => `<td>${metricMeta(k).fmt(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return;
  }
  const chartColor = k => keys.indexOf(k) === 0 ? "#38BDF8" : "#FFAD55";
  const same = keys.every((k) =>
    ["revenue", "cost", "spend", "result"].includes(k),
  );
  const groups = same ? [keys] : keys.map((k) => [k]);
  $("#chart").innerHTML =
    groups
      .map((group) => {
        const vals = rows.flatMap((r) =>
          group.map((k) => r[k]).filter((v) => v !== null),
        );
        if (!vals.length)
          return '<div class="empty">Geen betrouwbare gegevens voor deze selectie.</div>';
        const min = Math.min(0, ...vals),
          max = Math.max(1, ...vals),
          W = 960,
          H = 230,
          L = 72,
          R = 20,
          T = 18,
          B = 34,
          ph = H - T - B,
          pw = W - L - R;
        const y = (v) => T + ((max - v) / (max - min)) * ph,
          x = (i) => L + ((i + 0.5) / rows.length) * pw;
        return `<div class="chart"><div class="legend">${group.map((k) => `<span><i class="dot" style="background:${chartColor(k)}"></i>${metricMeta(k).label}</span>`).join("")}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(group.map((k) => metricMeta(k).label).join(" en "))} per periode. Exacte waarden via Tabel tonen.">${[min, (min + max) / 2, max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${esc(metricMeta(group[0]).fmt(v))}</text>`).join("")}${group
          .map((k) => {
            const chunks = [];
            let points = [];
            for (let i = 0; i < rows.length; i++) {
              if (rows[i][k] == null) {
                if (points.length) chunks.push(points);
                points = [];
              } else points.push(`${x(i)},${y(rows[i][k])}`);
            }
            if (points.length) chunks.push(points);
            return (
              chunks
                .map(
                  (p) =>
                    `<polyline points="${p.join(" ")}" stroke="${chartColor(k)}" stroke-width="2.5" fill="none"/>`,
                )
                .join("") +
              rows
                .map((r, i) =>
                  r[k] == null
                    ? ""
                    : `<circle class="point ${selectedDays.has(r.from) ? "selected-point" : ""}" data-bucket="${r.from}|${r.to}" cx="${x(i)}" cy="${y(r[k])}" r="${rows.length > 90 ? 2 : 4}" fill="${chartColor(k)}"><title>${fmt(r.from)}${r.to!==r.from?' – '+fmt(r.to):''}: ${metricMeta(k).fmt(r[k])}</title></circle>`,
                )
                .join("")
            );
          })
          .join(
            "",
          )}${rows.map((r, i) => (i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmt(r.from)}</text>` : "")).join("")}</svg></div>`;
      })
      .join("") +
    `<p class="chart-help">Klik een punt of sleep om te selecteren. Elk punt omvat de volledige periode ${rows[0]?.from===rows[0]?.to?'van die dag':'die in de tabel staat'}. Dezelfde selectie geldt in grafiek en tabel.</p>`;
  bindChartDrag(rows);
}
function selectChartRange(from,to) {
  if(!validDate(from)||!validDate(to)||from>to||from<state.from||to>state.to) return;
  selectedDays.clear();
  for(let d=from;d<=to;d=shift(d,1)) selectedDays.add(d);
  renderChart();
}
function bindChartDrag(rows) {
  $$('#chart svg').forEach(svg=>{
    svg.style.touchAction='pan-y';
    const overlay=document.createElementNS('http://www.w3.org/2000/svg','rect');
    overlay.setAttribute('y','18');overlay.setAttribute('height','178');overlay.setAttribute('fill','#ffffff18');overlay.setAttribute('stroke','#fff');overlay.setAttribute('pointer-events','none');
    svg.append(overlay);
    const boundary=document.createElementNS('http://www.w3.org/2000/svg','line');
    boundary.classList.add('selection-boundary');
    boundary.style.stroke='#fff';
    for(const [key,value] of Object.entries({y1:'18',y2:'196',stroke:'#fff','pointer-events':'none',display:'none'})) boundary.setAttribute(key,value);
    svg.append(boundary);
    const index=e=>{
      const point=e.target?.closest?.('[data-bucket]');
      if(point){const found=rows.findIndex(r=>point.dataset.bucket===r.from+'|'+r.to);if(found>=0)return found;}
      const matrix=svg.getScreenCTM?.();
      let x;
      if(matrix && svg.createSVGPoint){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY??0;x=p.matrixTransform(matrix.inverse()).x;}
      else x=(e.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*960;
      return Math.max(0,Math.min(rows.length-1,Math.round((x-72)/868*rows.length-.5)));
    };
    const paint=(a,b)=>{
      const left=72+((Math.min(a,b)+.5)/rows.length)*868;
      const right=72+((Math.max(a,b)+.5)/rows.length)*868;
      overlay.setAttribute('x',String(left));overlay.setAttribute('width',String(right-left));
      boundary.setAttribute('x1',String(left));boundary.setAttribute('x2',String(left));
      boundary.setAttribute('display',a===b?'inline':'none');
    };
    const picked=rows.map((r,i)=>selectedDays.has(r.from)?i:-1).filter(i=>i>=0);
    if(picked.length) paint(picked[0],picked.at(-1));
    let first=null;
    svg.onpointerdown=e=>{if(e.button!==0)return;first=index(e);svg.setPointerCapture?.(e.pointerId);paint(first,first);};
    svg.onpointermove=e=>{if(first!=null)paint(first,index(e));};
    svg.onpointerup=e=>{if(first==null)return;const last=index(e),a=Math.min(first,last),b=Math.max(first,last);first=null;selectChartRange(rows[a].from,rows[b].to);};
    svg.onpointercancel=()=>{first=null;if(picked.length)paint(picked[0],picked.at(-1));else{overlay.setAttribute('width','0');boundary.setAttribute('display','none');}};
  });
}
function col(label, type = "text") {
  return { label, type };
}
function renderDetail() {
  const from = state.sub?.from || state.from,
    to = state.sub?.to || state.to,
    cur = viewCompute(analysisData(), C, from, to, state.channel),
    det = state.detail,
    k = state.metrics[0] || "revenue";
  let title = "",
    note = "",
    cols = [],
    rows = [],
    groupControl = "",
    productInsights = "";
  const action = (type, name) => ({ type, name });
  const standard = [
    col("Naam"),
    col("Uitgaven", "eur"),
    col("Toegerekende waarde incl. btw", "eur"),
    col(state.channel === "google" ? "Conversies" : "Aankopen", "num"),
    col("ROAS", "ratio"),
  ];
  if (state.channel === "all") {
    if (
      det?.type === "product" ||
      det?.type === "orders" ||
      det?.type === "basket"
    ) {
      title = det.type === "product" ? det.name : "Alle orders";
      cols = [
        col("Order"),
        col("Datum en tijd"),
        col("Producten"),
        col("Omzet incl. btw", "eur"),
        col("Product en levering", "eur"),
        col("Betaalkosten (2%)", "eur"),
        col("Marge vóór marketing en overhead", "percent"),
      ];
      const basketGroups = basketMetrics(cur.orderRows);
      const selectedOrders =
        det.type === "basket"
          ? {
              with: basketGroups.withExtra,
              without: basketGroups.withoutExtra,
              bundles: basketGroups.bundleOrders,
            }[det.name] || []
          : cur.orderRows;
      if (det.type === "basket")
        title =
          {
            with: "Beamerorders met accessoire",
            without: "Beamerorders zonder accessoire",
            bundles: "Complete setups",
          }[det.name] || "Orders";
      rows = selectedOrders
        .filter((o) => det.type !== "product" || o.items.includes(det.name))
        .map((o) => {
          const f = finance([o], C);
          return {
            cells: [
              o.num,
              orderDate(o),
              o.items.join(", "),
              o.incl,
              f.fixed,
              f.fees,
              f.cost != null && f.excl > 0 ? (f.excl - f.cost) / f.excl : null,
            ],
          };
        });
      note =
        "Volledige orders met dit product. Tijd wordt getoond wanneer die in de bron is opgeslagen; oudere exports bevatten alleen de datum. Product en levering omvat inkoop, verzending en fulfilment. Betaalkosten zijn berekend met 2% van het orderbedrag incl. btw. De marge is na deze kosten, als percentage van omzet excl. btw; marketing en overhead gaan er nog af. Orderomzet wordt niet verdeeld over producten.";
    } else if (
      ["cost", "result", "roas"].includes(k) &&
      det?.type !== "products"
    ) {
      title = "Van klantomzet naar marge";
      const pct = (v) =>
        v != null && cur.revenue > 0 ? v / cur.revenue : null;
      const minus = (v) => (v == null ? null : -v);
      const margin =
        cur.fixed != null && cur.revenue != null
          ? cur.revenue - cur.fixed
          : null;
      const budget = margin != null ? margin - cur.fees - cur.overhead - cur.returnCost - (cur.returnReserve.available ? cur.returnReserve.impact : 0) : null;
      cols = [
        col("Opbouw"),
        col("% omzet excl. btw", "percent"),
        col("Bedrag", "eur"),
        col("Betekenis"),
      ];
      const row = (
        label,
        value,
        meaning,
        actionValue = null,
        subtotal = false,
      ) => ({
        cells: [label, pct(value), value, meaning],
        action: actionValue,
        subtotal,
      });
      rows = [
        row(
          "Omzet excl. btw",
          cur.revenue,
          "Dit is de 100%-basis voor alle percentages hieronder",
          null,
          true,
        ),
        ...(C.item_components ? cur.marginBuild.filter(r=>['purchase','inbound_shipping','fulfillment','source_adjustment','unallocated'].includes(r.key)).map(r=>row('− '+r.label,r.value,'Actuele kostprijssheet · geen historische ingangsdatums',action('products',r.label))) : [row('− Product en levering',minus(cur.fixed),'Inkoop, verzending en fulfilment samen',action('products','Product en levering'))]),
        row(
          "= Marge na product en levering",
          margin,
          "Wat overblijft om betaal-, bedrijfs- en marketingkosten te betalen",
          null,
          true,
        ),
        row(
          "− Betaalkosten",
          minus(cur.fees),
          "2% van oorspronkelijk betaald bedrag; terugbetaling van transactiekosten niet aangenomen",
        ),
        row("− Retourafhandeling", minus(cur.returnCost), "€20 per bevestigde retourorder · één pakket aangenomen"),
        row(
          "− Overige bedrijfskosten",
          minus(cur.overhead),
          "Overhead · berekend met 4% van omzet excl. btw",
        ),
        ...(cur.returnReserve.available?[row('− Begrote retouren',minus(cur.returnReserve.impact),'Nog te verwachten terugbetalingen en afhandeling, na overheadvrijval')]:[]),
        row(
          "= Beschikbaar voor marketing en resultaat",
          budget,
          "Bij dit marketingbedrag is het berekende resultaat nul",
          null,
          true,
        ),
        row(
          "− Marketinguitgaven",
          minus(state.daan==="without" ? cur.spend : cur.spend==null||cur.management.total==null?null:cur.spend-cur.management.total),
          "Meta- en Google-advertenties en influencercommissies plus toegerekende beamers",
        ),
        {...row("− Meta salaris", minus(state.daan==="without"?0:cur.management.total), ""), salary: {fixed:cur.management.fixed,bonus:cur.management.bonus,excluded:state.daan==="without"}},
        row(
          "= Nettowinst · voorlopig",
          cur.result,
          "Wat overblijft volgens de huidige kostentarieven",
          null,
          true,
        ),
      ];
      const showPct = (v) => (pct(v) == null ? "—" : num(pct(v) * 100) + "%");
      productInsights = `<section class="cost-story" aria-label="Marge en kosten"><div class="vat-bridge"><div><span>Klantomzet incl. btw</span><b>${euro(cur.incl)}</b><small>${cur.incl > 0 ? "100%" : "—"}</small></div><span aria-hidden="true">−</span><div><span>Btw (21%)</span><b>${euro(cur.incl == null ? null : cur.incl - cur.revenue)}</b><small>${cur.incl > 0 ? num((C.assumed_vat / (1 + C.assumed_vat)) * 100) + "% van klantomzet" : "—"}</small></div><span aria-hidden="true">=</span><div><span>Omzet excl. btw</span><b>${euro(cur.revenue)}</b><small>Nieuwe basis: ${cur.revenue > 0 ? "100%" : "—"}</small></div></div><div class="margin-cards"><div><span>Marge na product en levering</span><b>${showPct(margin)}</b><small>${euro(margin)} over voor overige kosten en resultaat</small></div><div><span>Marketingkosten</span><b>${showPct(cur.spend)}</b><small>${euro(cur.spend)} van omzet excl. btw</small></div><div><span>Resultaatmarge</span><b>${showPct(cur.result)}</b><small>${euro(cur.result)} na alle opgenomen kosten</small></div></div><p class="cost-reading">${budget != null && cur.spend != null && cur.revenue > 0 ? `Van elke €100 omzet excl. btw is €${num(pct(budget) * 100)} beschikbaar voor marketing en resultaat. Marketing gebruikt €${num(pct(cur.spend) * 100)}; er ${cur.result < 0 ? "ontbreekt" : "blijft"} €${num(Math.abs(pct(cur.result) * 100))}${cur.result < 0 ? " om quitte te spelen" : " over"}.` : "De marge is nog niet berekenbaar: omzet of kosten ontbreken."}</p></section>`;
      note =
        "Vaste rekenvolgorde. Klik op Product en levering voor de onderliggende producten en orders. Betaal- en bedrijfskosten zijn berekend met vaste percentages; niet met afzonderlijke facturen. Inkoop, transport naar Nederland en fulfilment zijn uitgesplitst volgens de actuele kostprijssheet. Een los klantverzendtarief ontbreekt.";
    } else if (k === "spend") {
      title = "Marketingkosten per kanaal";
      cols = standard;
      rows = Object.entries(cur.channels).map(([key, v]) => ({
        cells: [
          names[key],
          v.spend,
          v.revenue,
          v.orders,
          v.spend > 0 ? v.revenue / v.spend : null,
        ],
        channel: key,
      }));
      note =
        "Influencerbedragen bevatten commissies en opstartkosten naar omzetaandeel. Betaald/openstaand is geen extra kostenpost.";
    } else {
      title = "Producten en kostprijzen";
      const basket = basketMetrics(cur.orderRows);
      const rate = (n) => (n == null ? "—" : num(n * 100) + "%");
      const prevRange = getPrev();
      const prevBasket =
        prevRange &&
        !state.sub &&
        coverage("shopify", prevRange.from, prevRange.to)
          ? basketMetrics(
              compute(D, C, prevRange.from, prevRange.to, "all").orderRows,
            )
          : null;
      const movement =
        basket.rate != null && prevBasket?.rate != null
          ? `${basket.rate >= prevBasket.rate ? "+" : ""}${num((basket.rate - prevBasket.rate) * 100)} procentpunt t.o.v. vergelijkingsperiode`
          : "Aandeel beamerorders met minstens één accessoire";
      productInsights = `<section class="basket-insights" aria-label="Upsell en meeverkoop"><h3>Upsell & meeverkoop</h3><div class="basket-stats">
      <button data-basket="with"><span>Beamer + accessoire</span><b>${rate(basket.rate)}</b><small>${basket.withExtra.length} van ${basket.base.length} beamerorders · bekijk orders →</small><small>${movement}</small></button>
      <button data-basket="without"><span>Zonder accessoire</span><b>${basket.withoutExtra.length} orders</b><small>${basket.base.length ? rate(basket.withoutExtra.length / basket.base.length) : "—"} van beamerorders · bekijk orders →</small><small>Hier zit ruimte voor meeverkoop</small></button>
      <div><span>Gemiddelde orderwaarde</span><b>${euro(basket.avgWith)} <em>met accessoire</em></b><small>${euro(basket.avgWithout)} zonder accessoire · incl. btw</small><small>Verschil tussen ordergroepen, geen bewezen extra omzet</small></div>
      <button data-basket="bundles"><span>Complete setups</span><b>${basket.bundleOrders.length} orders</b><small>Bundels apart van losse beamerorders · bekijk →</small></button></div>
      <div class="table-wrap"><table class="basket-models"><thead><tr><th>Beamermodel</th><th>Beamerorders</th><th>Met accessoire</th><th>Meeverkoop</th></tr></thead><tbody>${basket.byModel.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.orders}</td><td>${r.withExtra}</td><td>${rate(r.rate)}</td></tr>`).join("") || '<tr><td colspan="4">Geen losse beamerorders in deze periode.</td></tr>'}</tbody></table></div>
      <p class="hint">Meeverkoop = een losse beamer en minstens één bekend accessoire in dezelfde order; elke order telt één keer. Complete setups tellen apart. Gratis artikelen kunnen meetellen: betaalde upsells, aanbodacceptatie en accessoire-omzet zijn zonder regelprijzen niet vast te stellen. Een order met meerdere beamermodellen telt bij elk model; tel die modelrijen niet op.</p></section>`;
      if (!D.shopify)
        productInsights = `<p class="hint">Meeverkoopanalyse niet beschikbaar: ordergegevens ontbreken.</p>`;
      sortKey = 1;
      sortDir = -1;
      cols = [
        col("Product"),
        col("Aantal", "num"),
        col("Orders", "num"),
        col("Mee met beamer", "num"),
        col("Meeverkoop", "percent"),
        col("Tarief per stuk", "eur2"),
        col("Product en levering", "eur"),
      ];
      const map = new Map();
      for (const o of cur.orderRows.filter(o => o.return_kind !== "cancelled"))
        for (const [i, item] of o.items.entries()) {
          if (!map.has(item)) map.set(item, { n: 0, orders: new Set(), total: 0, unknown: false, rates: new Set() });
          const r = map.get(item);
          r.n++;
          const rate = itemCost(item, C, o.item_refs?.[i]);
          if (rate == null) r.unknown = true;
          else { r.total += rate; r.rates.add(rate); }
          r.orders.add(o.num);
        }
      rows = [...map].map(([name, r]) => ({
        cells: [
          name,
          r.n,
          r.orders.size,
          basket.accessories.includes(name)
            ? basket.base.filter((o) => o.items.includes(name)).length
            : null,
          basket.accessories.includes(name) && basket.base.length
            ? basket.base.filter((o) => o.items.includes(name)).length /
              basket.base.length
            : null,
          !r.unknown && r.rates.size === 1 ? [...r.rates][0] : null,
          r.unknown ? null : r.total,
        ],
        action: action("product", name),
      }));
      note =
        "Standaard gesorteerd op meest verkochte stuks. Mee met beamer toont accessoire-orders naast een losse beamer; meeverkoop is het aandeel van alle losse beamerorders. Klik een product voor orders. Productomzet is zonder regelprijzen niet beschikbaar.";
    }
  } else if (state.channel === "meta") {
    title = det?.name || "Advertentiegroepen";
    cols = standard;
    const raw = (D.meta?.daily_ads || [])
      .filter((x) => inRange(x, from, to))
      .flatMap((x) =>
        x.ads.map((a) => ({
          name: a.n,
          d: x.d,
          spend: a.spend,
          revenue: (a.rev7 || 0) + (a.rev1v || 0),
          orders: a.purch,
        })),
      );
    if (det?.type === "ad") {
      cols = [col("Dag"), ...standard.slice(1)];
      rows = raw
        .filter((a) => a.name === det.name)
        .map((a) => ({
          cells: [
            a.d,
            a.spend,
            a.revenue,
            a.orders,
            a.spend > 0 ? a.revenue / a.spend : null,
          ],
        }));
    } else
      rows = aggregate(raw, (r) => r.name).map((r) => ({
        cells: [r.name, r.spend, r.revenue, r.orders, r.roas],
        action: action("ad", r.name),
      }));
    note =
      "Historische export groepeert op advertentiegroepnaam; gelijke namen kunnen samengevoegd zijn. Campagne-ID’s ontbreken nog in deze bron. Totalen per advertentiegroep kunnen afwijken van accountdata.";
  } else if (state.channel === "infl") {
    const byNum = new Map((D.shopify?.orders || []).map((o) => [o.num, reconciledOrder(o,C)]));
    if (det?.type === "creator") {
      title = det.name;
      cols = [
        col("Order"),
        col("Datum en tijd"),
        col("Code"),
        col("Omzet incl. btw", "eur"),
        col("Commissie", "eur"),
        col("Status"),
      ];
      rows = cur.creatorRows
        .filter((o) => o.creator === det.name)
        .map((o) => ({
          cells: [
            o.num,
            orderDate(byNum.get(o.num) || o),
            o.code,
            byNum.get(o.num)?.incl ?? o.omzet_excl * 1.21,
            o.commissie,
            o.status || "Onbekend",
          ],
        }));
      note =
        "Deze ordertabel toont commissies. Toegerekende opstartkosten staan in het creatortotaal. Betaalstatus verandert de verdiende commissie niet.";
    } else {
      title = "Creators";
      cols = [
        col("Creator"),
        col("Influencer-orders", "num"),
        col("Toegerekende omzet incl. btw", "eur"),
        col("Commissies + opstartkosten", "eur"),
        col("Omzet / kosten", "ratio"),
      ];
      rows = aggregate(
        cur.creatorRows.map((o) => ({
          name: o.creator,
          orders: 1,
          revenue: byNum.get(o.num)?.incl ?? o.omzet_excl * 1.21,
          spend: o.commissie + Math.max(0,byNum.get(o.num)?.incl ?? o.omzet_excl*1.21)*cur.channels.infl.giftRate,
        })),
        (r) => r.name,
      ).map((r) => ({
        cells: [r.name, r.orders, r.revenue, r.spend, r.roas],
        action: action("creator", r.name),
      }));
      note =
        "Geregistreerde opstartkosten van alle influencers in de kostentabel worden verdeeld naar aandeel in alle geregistreerde influenceromzet, ook de kosten van samenwerkingen zonder orders. Nieuwe omzet kan deze verdeling wijzigen.";
    }
  } else {
    const available = analysisData().google?.daily_campaigns || [];
    const campaign = available.filter((r) => inRange(r, from, to));
    const activeCampaigns = (D.google?.campaigns || []).filter(
      (r) =>
        r.status === "ENABLED" &&
        (state.googleScope === "all" ||
          googleCampaignGroups[r.id] === state.googleScope),
    );
    groupControl = `<label>Uitsplitsing<select id="googleGroup"><option value="campaign">Campagnes</option><option value="intent">Branded / non-branded</option><option value="actions">Aankoopmetingen</option><option value="customers">Nieuwe / terugkerende klanten</option></select></label>`;
    title =
      "Google Ads · " +
      googleScopeNames[state.googleScope] +
      " · " +
      ({
        campaign: "actieve campagnes",
        intent: "campagne-indeling",
        actions: "aankoopmetingen",
        customers: "klantstatus",
      }[state.group] || "campagnes");
    cols = standard;
    if (state.group === "customers") {
      cols = [
        col("Klantstatus"),
        col("Aankopen", "num"),
        col("Conversiewaarde incl. btw", "eur"),
      ];
      rows = [{ cells: ["Onbekend", cur.count, cur.revenueIncl] }];
      note =
        "Geen betrouwbare nieuwe-klantclassificatie beschikbaar. Onbekend wordt niet als nieuw geteld.";
    } else if (state.group === "actions") {
      cols = [
        col("Aankoopmeting"),
        col("Aankopen", "num"),
        col("Conversiewaarde incl. btw", "eur"),
      ];
      rows = aggregate(
        (analysisData().google?.daily_actions || [])
          .filter((r) => inRange(r, from, to))
          .map((r) => ({ name: r.name, revenue: r.rev, orders: r.conv })),
        (r) => r.name,
      ).map((r) => ({ cells: [r.name, r.orders, r.revenue] }));
      note =
        state.googleScope !== "all"
          ? "De bron heeft aankoopmetingen alleen op accountniveau. Kies Alles inclusief branded om deze te bekijken; ze worden niet als segmentcijfers gepresenteerd."
          : "Beide aankoopmetingen tellen nu mee. Of dezelfde aankopen dubbel worden gemeten is nog niet vastgesteld. Er zijn geen Google-instellingen aangepast.";
    } else if (state.group === "intent") {
      const grouped = aggregate(
        campaign.map((r) => ({
          name: googleCampaignGroups[r.id] || "unknown",
          spend: r.spend,
          revenue: r.rev,
          orders: r.conv,
        })),
        (r) => r.name,
      );
      rows = grouped.map((r) => ({
        cells: [
          googleScopeNames[r.name] || "Nieuwe campagne · nog indelen",
          r.spend,
          r.revenue,
          r.orders,
          r.roas,
        ],
      }));
      note =
        "Volledige campagnecijfers volgens de gecontroleerde campagne-indeling. Branded: Corporate Search en Branded Shopping. Non-branded: generieke Search, PMAX, B2B en Concurrentie.";
    } else if (det?.type === "campaign") {
      title = det.name;
      cols = [col("Dag"), ...standard.slice(1)];
      rows = campaign
        .filter((r) => r.id === det.id || r.name === det.name)
        .map((r) => ({
          cells: [
            r.d,
            r.spend,
            r.rev,
            r.conv,
            r.spend > 0 ? r.rev / r.spend : null,
          ],
        }));
      const campaignId =
        det.id || campaign.find((r) => r.name === det.name)?.id;
      productInsights = `<details class="campaign-keywords" open><summary>Ingestelde zoekwoorden</summary><p>${campaignKeywords[campaignId] ? campaignKeywords[campaignId].map(esc).join(" · ") : "Shopping en Performance Max werken niet met een gewone lijst Search-zoekwoorden."}</p><small>Gecontroleerd in Google Ads op 30 september 2026. Dit zijn ingestelde zoekwoorden, niet de volledige zoekopdrachten van bezoekers.</small></details>`;
      note =
        (campaignDescriptions[det.id] ||
          campaignDescriptions[campaign.find((r) => r.name === det.name)?.id] ||
          "") +
        " Hieronder staan de resultaten per dag. Zoektermen zijn nog niet per campagne beschikbaar in deze export.";
    } else {
      const totals = new Map(
        aggregate(
          campaign.map((r) => ({
            id: r.id,
            spend: r.spend,
            revenue: r.rev,
            orders: r.conv,
          })),
          (r) => r.id,
        ).map((r) => [r.name, r]),
      );
      rows = activeCampaigns.map((c) => {
        const r = totals.get(c.id) || {
          spend: 0,
          revenue: 0,
          orders: 0,
          roas: null,
        };
        return {
          cells: [c.name, r.spend, r.revenue, r.orders, r.roas],
          description: campaignDescriptions[c.id],
          action: { type: "campaign", name: c.name, id: c.id },
        };
      });
      note =
        "Alleen campagnes die nu in Google Ads zijn ingeschakeld, binnen de gekozen branded/non-branded groep. De tabel toont hun cijfers over de geselecteerde periode. Hoofdcijfers blijven alle kosten en resultaten van die periode bevatten, ook van inmiddels gepauzeerde campagnes.";
      if (!Array.isArray(D.google?.campaigns))
        note =
          "De actuele campagnestatus wordt nog opgehaald. Er worden geen campagnes als actief aangenomen.";
    }
    if (!available.length) note += " Campagnedetails worden nog opgehaald.";
    if (
      D.google?.details_error ||
      Date.now() - Date.parse(D.google?.details_synced_at || 0) > 45 * 60000
    )
      note +=
        " Let op: campagnedetails zijn niet actueel; aansluiting op accounttotalen kan afwijken.";
  }
  if (
    ["Meta", "Google Ads"].some((n) => title.startsWith(n)) ||
    cols[1]?.label === "Uitgaven"
  ) {
    if (cols[1]?.label === "Uitgaven") {
      [cols[1], cols[2]] = [cols[2], cols[1]];
      rows.forEach(
        (r) => ([r.cells[1], r.cells[2]] = [r.cells[2], r.cells[1]]),
      );
    }
  }
  if (state.channel === "infl" && !det) {
    const order = [0, 2, 3, 1, 4];
    cols = order.map((i) => cols[i]);
    rows.forEach((r) => (r.cells = order.map((i) => r.cells[i])));
  }
  tableModel = {
    title,
    note,
    cols,
    rows,
    sequential: title === "Van klantomzet naar marge",
  };
  $("#detail").innerHTML =
    `<div class="crumbs">${det ? '<button id="detailBack">← Terug naar uitsplitsing</button>' : ""}${state.sub ? `<span class="tag">Details: ${fmt(from)} – ${fmt(to)}</span><button id="clearSub">Hele periode</button><button id="useSub">Als hoofdperiode</button>` : ""}</div><div class="panel-head"><div><h3>${esc(title)}</h3><p class="hint">${esc(note)}</p></div><div class="toolbar">${groupControl}<button id="export">CSV exporteren</button></div></div>${productInsights}<label ${tableModel.sequential ? "hidden" : ""}>Zoeken in tabel<input type="search" id="search" class="search" placeholder="Zoek een regel…" value="${esc(search)}"></label><div id="table"></div>`;
  if ($("#googleGroup")) $("#googleGroup").value = state.group;
  renderTable();
}
function filtered() {
  if (tableModel.sequential) return tableModel.rows;
  let rows = tableModel.rows.filter((r) =>
    r.cells.some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  rows.sort((a, b) => {
    const av = a.cells[sortKey],
      bv = b.cells[sortKey];
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    return (
      (typeof av === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "nl")) * sortDir
    );
  });
  return rows;
}
function cell(v, c) {
  if (c.type === "percent") return v == null ? "—" : num(v * 100) + "%";
  return c.type === "eur2"
    ? v == null
      ? "—"
      : new Intl.NumberFormat("nl-NL", {
          style: "currency",
          currency: "EUR",
        }).format(v)
    : c.type === "eur"
      ? euro(v)
      : c.type === "ratio"
        ? ratio(v)
        : c.type === "num"
          ? num(v)
          : esc(v ?? "—");
}
function totalsHtml(rows, cols) {
  if (
    tableModel.sequential ||
    ["Van omzet naar resultaat", "Kostenopbouw"].includes(tableModel.title)
  )
    return "";
  const values = cols.map((c, i) => {
    if (!i) return "Totaal selectie";
    if (
      tableModel.title === "Marketingkosten per kanaal" &&
      c.label !== "Uitgaven"
    )
      return "—";
    if (c.type === "percent" || c.label === "Mee met beamer") return "—";
    if (c.label === "Tarief per stuk" || c.label === "Orders") return "—";
    if (c.type === "ratio") {
      const spend = cols.findIndex((x) => /Uitgaven|Commissies/.test(x.label)),
        rev = cols.findIndex((x) => /waarde|omzet/.test(x.label));
      if (spend < 0 || rev < 0) return "—";
      const a = sum(rows, (r) => r.cells[spend]),
        b = sum(rows, (r) => r.cells[rev]);
      return ratio(a > 0 ? b / a : null);
    }
    if (["eur", "num"].includes(c.type))
      return rows.some((r) => r.cells[i] == null)
        ? "Onvolledig"
        : cell(
            sum(rows, (r) => r.cells[i]),
            c,
          );
    return "";
  });
  return (
    "<tfoot><tr>" +
    values.map((v) => "<td>" + v + "</td>").join("") +
    "</tr></tfoot>"
  );
}
function renderTable() {
  const { cols } = tableModel,
    rows = filtered();
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  const visible = rows.slice(page * 25, page * 25 + 25);
  $("#table").innerHTML =
    `<div class="table-wrap"><table class="${tableModel.sequential ? "cost-breakdown" : ""}"><thead><tr>${cols.map((c, i) => (tableModel.sequential ? `<th scope="col">${c.label}</th>` : `<th scope="col" aria-sort="${i === sortKey ? (sortDir === 1 ? "ascending" : "descending") : "none"}"><button data-sort="${i}">${c.label} ${i === sortKey ? (sortDir === 1 ? "↑" : "↓") : ""}</button></th>`)).join("")}</tr></thead><tbody>${visible.map((r) => `<tr class="${r.subtotal ? "subtotal" : ""}">${r.cells.map((v, i) => `<td>${i === 0 && (r.action || r.channel) ? `<button class="link" ${r.channel ? `data-channel="${r.channel}"` : `data-detail="${esc(JSON.stringify(r.action))}"`}>${esc(v)} →</button>${r.description ? `<small class="row-description">${esc(r.description)}</small>` : ""}` : r.salary && i===3 ? `<details class="salary-breakdown"><summary>${r.salary.excluded?'Uitgesloten · ':' '}Vast + bonus</summary><dl><div><dt>Vaste vergoeding</dt><dd>${euro(r.salary.fixed)}</dd></div><div><dt>Prestatiebonus</dt><dd>${euro(r.salary.bonus)}</dd></div></dl><small>€ 1.500 per maand naar rato; bonus volgens het Meta-dashboard.</small></details>` : cell(v, cols[i])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">Geen regels beschikbaar voor deze selectie.</td></tr>`}</tbody>${totalsHtml(rows, cols)}</table></div><div class="pager" ${tableModel.sequential ? "hidden" : ""}><span>${rows.length} regels · pagina ${page + 1} / ${Math.max(1, Math.ceil(rows.length / 25))}</span><div><button id="pagePrev" ${page === 0 ? "disabled" : ""} aria-label="Vorige pagina">←</button> <button id="pageNext" ${(page + 1) * 25 >= rows.length ? "disabled" : ""} aria-label="Volgende pagina">→</button></div></div>`;
}
function selectMetric(k) {
  analysisCollapsed=false;
  change(()=>{
    const i=state.metrics.indexOf(k);
    if(i>=0) state.metrics.splice(i,1);
    else { if(state.metrics.length>=2) state.metrics.shift(); state.metrics.push(k); }
    state.detail=null; state.sub=null;
  });
}
function bindContent() {
 $$('#overviewOrders [data-resize-column]').forEach(handle=>{
  const index=Number(handle.dataset.resizeColumn);
  const resize=width=>{
   orderColumnWidths[index]=Math.min(600,Math.max(48,Math.round(width)));
   $('#overviewOrders colgroup').children[index].style.width=orderColumnWidths[index]+'px';
   $('#overviewOrders table').style.width=sum(orderColumnWidths,x=>x)+'px';
   handle.setAttribute('aria-valuenow',orderColumnWidths[index]);
  };
  handle.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resize(orderColumnWidths[index]+(e.key==='ArrowRight'?16:-16));}};
  handle.onpointerdown=e=>{
   e.preventDefault();const start=e.clientX,width=orderColumnWidths[index];
   handle.setPointerCapture(e.pointerId);
   handle.onpointermove=event=>resize(width+event.clientX-start);
   const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;};
   handle.onpointerup=finish;handle.onpointercancel=finish;
  };
 });

 const orderSearch=$('#overviewOrderSearch');
 if(orderSearch) orderSearch.oninput=()=>{
  const query=orderSearch.value.trim().toLowerCase();
  let visible=0;
  $$('#overviewOrders [data-order-search]').forEach(row=>{row.hidden=!row.dataset.orderSearch.includes(query);if(!row.hidden)visible++;});
  $('#overviewOrderEmpty').hidden=visible>0;
 };

  const mix=$('.channel-revenue');
  if(mix) {
    const show=e=>{const b=e.target.closest('[data-mix]');if(!b)return;mix.querySelectorAll('[data-mix]').forEach(n=>n.classList.toggle('mix-active',n.dataset.mix===b.dataset.mix));};
    mix.onpointerover=show;mix.onfocusin=show;
    const hide=()=>{mix.querySelectorAll('.mix-active').forEach(n=>n.classList.remove('mix-active'));};
    mix.onpointerleave=hide;mix.onfocusout=hide;
  }

  $("#content").onclick = (e) => {
    const b = e.target.closest("button,[data-bucket]");
    if (!b) return;
    if (b.hasAttribute("data-show-status")) {
      $("#status").hidden=false; $("#statusButton").setAttribute("aria-expanded","true"); $("#status").scrollIntoView({block:"start",behavior:"smooth"});
    } else if (b.id === "collapseAnalysis") {
      analysisCollapsed=!analysisCollapsed; $("#analysisBody").hidden=analysisCollapsed; $("#analysisTools").hidden=analysisCollapsed; $("#analysis").classList.toggle("is-collapsed",analysisCollapsed); b.setAttribute("aria-expanded",String(!analysisCollapsed));
    } else if (b.id === "applyChartRange") {
      selectChartRange($("#rangeStart").value,$("#rangeEnd").value);
    } else if (b.dataset.gran) {
      change(()=>state.gran=b.dataset.gran);

    } else if (b.id === "clearDays") {
      selectedDays.clear();
      renderChart();
    } else if (b.dataset.chartMetric) {
      selectMetric(b.dataset.chartMetric);
    } else if (b.dataset.basket) {
      change(() => (state.detail = { type: "basket", name: b.dataset.basket }));
    } else if (b.dataset.googleScope) {
      change(() => {
        state.googleScope = b.dataset.googleScope;
        state.detail = null;
        state.sub = null;
      });
    } else if (b.hasAttribute("data-daan-details")) {
      $(".management").open=true; $(".management").scrollIntoView({block:"center",behavior:"smooth"});
    } else if (b.dataset.daan) {
      change(()=>{state.daan=b.dataset.daan;});
    } else if (b.dataset.metric) {
      selectMetric(b.dataset.metric);
      document
        .querySelector(`[data-metric="${b.dataset.metric}"]`)
        ?.focus({ preventScroll: true });
      const a = $("#analysis");
      if (a.getBoundingClientRect().top > innerHeight * 0.8)
        a.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "start",
        });
    } else if (b.dataset.flow)
      change(() => {
        state.metrics = [b.dataset.flow];
        state.detail = null;
      });
    else if (b.dataset.channel) switchChannel(b.dataset.channel);
    else if (b.dataset.detail)
      change(() => (state.detail = JSON.parse(b.dataset.detail)));
    else if (b.dataset.bucket) {
      const [from, to] = b.dataset.bucket.split("|");
      if(b.tagName.toLowerCase()!=="circle") selectChartRange(from,to);
    } else if (b.dataset.sort !== undefined) {
      const i = +b.dataset.sort;
      sortDir = sortKey === i ? -sortDir : 1;
      sortKey = i;
      renderTable();
    } else if (b.dataset.replace) {
      const next = pending;
      change(() => {
        state.metrics = state.metrics.map((k) =>
          k === b.dataset.replace ? next : k,
        );
        state.detail = null;
      });
    } else if (b.id === "compareMetric") {
      compareMode = !compareMode;

      persist();
      render();
    } else if (b.id === "cancelReplace") {
      $("#replacement").innerHTML = "";
      pending = null;
    } else if (b.id === "detailBack") change(() => (state.detail = null));
    else if (b.id === "clearSub") {
      state.sub = null;
      renderDetail();
    } else if (b.id === "useSub")
      change(() => {
        state.from = state.sub.from;
        state.to = state.sub.to;
        state.sub = null;
        $("#preset").value = "custom";
      });
    else if (b.id === "chartMode") {
      chartTable = !chartTable;
      render();
    } else if (b.id === "pageNext") {
      page++;
      renderTable();
    } else if (b.id === "pagePrev") {
      page--;
      renderTable();
    } else if (b.id === "export") exportCsv();
  };
  $("#content").onchange = (e) => {
    if (e.target.id === "gran") change(() => (state.gran = e.target.value));
    if (e.target.id === "googleGroup")
      change(() => {
        state.group = e.target.value;
        state.detail = null;
      });
  };
  $("#content").oninput = (e) => {
    if (e.target.id === "search") {
      search = e.target.value;
      page = 0;
      renderTable();
    }
  };
}
function switchChannel(ch) {
  change(() => {
    state.channel = ch;
    state.metrics = ch === "all" ? ["revenue", "result"] : ["result", "profitMargin"];
    state.detail = null;
    state.sub = null;
    compareMode = true;
  });
}
function exportCsv() {
  const quote = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [
    ["LumeWorks", tableModel.title],
    ["Periode", state.sub?.from || state.from, state.sub?.to || state.to],
    ["Meetbasis", tableModel.note],
    [
      "Google-selectie",
      state.channel === "google"
        ? googleScopeNames[state.googleScope]
        : "Alle advertentiekosten",
    ],
    ["Meta bijgewerkt", D.meta?.snap, D.meta?.snap_time],
    ["Google bijgewerkt", D.google?.synced_at],
    ["Creators bijgewerkt", D.creators?.synced_at],
    [
      "Status",
      "Voorlopige cijfers; 21% btw, fees geraamd, overige influencerkosten onbekend, Google-meetbasis niet ontdubbeld",
    ],
    tableModel.cols.map((c) => c.label),
    ...filtered().map((r) =>
      r.cells.map((v, i) =>
        tableModel.cols[i].type === "percent" ? cell(v, tableModel.cols[i]) : v,
      ),
    ),
  ];
  const blob = new Blob(
      ["\uFEFF" + rows.map((r) => r.map(quote).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lumeworks-${state.channel}-${state.from}-${state.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function presetRange(p) {
  let from,
    to = shift(today, -1);
  if (p === "today") from = to = today;
  else if (p === "yesterday") from = to;
  else if (p === "week") {
    to = today;
    from = shift(today, -((new Date(today + "T12:00:00").getDay() + 6) % 7));
  } else if (p === "month") {
    from = today.slice(0, 8) + "01";
    to = today;
  } else if (p === "lastmonth") {
    to = shift(today.slice(0, 8) + "01", -1);
    from = to.slice(0, 8) + "01";
  } else if (p === "all") {
    from = STORE_START;
    to = today;
  } else from = shift(to, -6);
  return {from:boundDate(from), to:boundDate(to)};
}
function activePeriodPreset() {
  return ["today", "yesterday", "seven", "week", "month", "lastmonth", "all"].find(key => {
    const range = presetRange(key);
    return range.from === state.from && range.to === state.to;
  });
}
function applyPreset(p) {
  change(() => {
    Object.assign(state, presetRange(p));
    state.sub = null;
    state.detail = null;
  });
}
async function start() {
  try {
    ({ data: D, costs: C, errors: E } = await load());
    const hadQuery = !!location.search;
    state = readState();
    for(const id of ["from","to","prevFrom","prevTo"]) {$("#"+id).min=STORE_START; $("#"+id).max=today;}
    persist(false);
    render();
    $("#preset").value = hadQuery ? "custom" : "seven";
    datePickers = [
      createDatePicker({
        host: $("#periodPicker"),
        id: "period",
        label: "Periode",
        today,
        min: STORE_START,
        options: [
          ["today", "Vandaag"],
          ["yesterday", "Gisteren"],
          ["week", "Deze week"],
          ["seven", "Laatste 7 afgesloten dagen"],
          ["month", "Deze maand"],
          ["lastmonth", "Vorige maand"],
          ["all", "Sinds start"],
        ],
        getRange: () => ({ from: state.from, to: state.to, preset: activePeriodPreset() }),
        onPreset: applyPreset,
        onApply: (from, to) =>
          change(() => {
            state.from = from;
            state.to = to;
            state.sub = null;
            state.detail = null;
          }),
      }),
      createDatePicker({
        host: $("#comparisonPicker"),
        id: "comparePeriod",
        label: "Vergelijken",
        today,
        min: STORE_START,
        options: [
          ["previous", "Vorige periode"],
          ["off", "Niet vergelijken"],
        ],
        getRange: () => ({
          preset: state.compare,
          ...(getPrev() || {from:state.from,to:state.to}),
          ...(state.compare === "custom"
            ? { from: state.pfrom, to: state.pto }
            : {}),
          label:
            state.compare === "custom"
              ? null
              : state.compare === "off"
                ? "Niet vergelijken"
                : "Vorige periode",
        }),
        onPreset: (value) => change(() => (state.compare = value)),
        onApply: (from, to) =>
          change(() => {
            state.compare = "custom";
            state.pfrom = from;
            state.pto = to;
          }),
      }),
    ];
    $("#tabs").onclick = (e) => {
      const b = e.target.closest("[data-channel]");
      if (b) switchChannel(b.dataset.channel);
    };
    $("#tabs").onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const tabs = $$("#tabs button"),
        i = tabs.indexOf(document.activeElement),
        next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 3
              : (i + (e.key === "ArrowRight" ? 1 : 3)) % 4;
      switchChannel(tabs[next].dataset.channel);
      $$("#tabs button")[next].focus();
    };
    $("#preset").onchange = (e) => {
      $("#dates").hidden = e.target.value !== "custom";
      if (e.target.value !== "custom") applyPreset(e.target.value);
    };
    $("#comparison").onchange = (e) => {
      if (e.target.value === "custom") {
        $("#compareDates").hidden = false;
        const p = previous(state.from, state.to);
        $("#prevFrom").value = p.from;
        $("#prevTo").value = p.to;
      } else {
        $("#compareDates").hidden = true;
        change(() => (state.compare = e.target.value));
      }
    };
    $("#dates").onsubmit = (e) => {
      e.preventDefault();
      const f = $("#from").value,
        t = $("#to").value;
      if (!validDate(f) || !validDate(t) || f < STORE_START || f > t || t > today || new Date(t) - new Date(f) > 3 * 366 * 864e5) {
        $("#to").setCustomValidity(
          "Kies een periode vanaf 5 augustus 2026, niet in de toekomst.",
        );
        $("#to").reportValidity();
        return;
      }
      $("#to").setCustomValidity("");
      change(() => {
        state.from = f;
        state.to = t;
        state.sub = null;
        state.detail = null;
      });
      $("#dates").hidden = true;
    };
    $("#to").oninput = () => $("#to").setCustomValidity("");
    $("#compareDates").onsubmit = (e) => {
      e.preventDefault();
      const f = $("#prevFrom").value,
        t = $("#prevTo").value;
      if (!validDate(f) || !validDate(t) || f < STORE_START || f > t || t > today) {
        $("#prevTo").setCustomValidity("Kies een geldige afgesloten periode.");
        $("#prevTo").reportValidity();
        return;
      }
      change(() => {
        state.compare = "custom";
        state.pfrom = f;
        state.pto = t;
      });
      $("#compareDates").hidden = true;
    };
    $("#prevTo").oninput = () => $("#prevTo").setCustomValidity("");
    $("#statusButton").onclick = () => {
      const el = $("#status");
      el.hidden = !el.hidden;
      $("#statusButton").setAttribute("aria-expanded", String(!el.hidden));
      $("#statusBadge").setAttribute("aria-expanded",String(!el.hidden));
      if(!el.hidden) el.scrollIntoView({block:'nearest',behavior:'smooth'});
    };
    window.onpopstate = () => {
      state = readState();
      compareMode = true;
      render();
    };
  } catch (e) {
    $("#content").innerHTML =
      `<div class="panel error"><h2>Overzicht kon niet geladen worden</h2><p>${esc(e.message)}</p><button onclick="location.reload()">Opnieuw proberen</button></div>`;
  }
}
start();
