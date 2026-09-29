/**
 * Gedeelde databron + rekenlogica voor de MCP-tools (mcp.js) — leest
 * dezelfde data/*.json als index.html/blended.html, maar via de publieke
 * GitHub Pages-URL's (niet de GitHub Contents API), want:
 *   - geen GITHUB_TOKEN nodig voor read-only MCP-vragen, dus geen extra
 *     scope-risico op die secret;
 *   - exact dezelfde bytes die de dashboards zelf tonen, dus geen aparte
 *     bron die uit de pas kan lopen.
 *
 * Rekenlogica (calcOrder, ITEM_FIXED, KP, BTW, shopifyBeroas, bonCalc, en
 * de affiliate-kostprijscorrectie) is 1-op-1 overgenomen uit index.html en
 * blended.html. Bij wijziging van kostprijzen/fees/bonusformule daar, hier
 * ook bijwerken — er is bewust geen gedeeld bestand met de browser-kant
 * (die is puur client-side, dit draait op de Worker), dus dit is een
 * tweede plek om in sync te houden, net zoals blended.html al een eigen
 * kopie van calcOrder() had t.o.v. index.html.
 */

const PAGES_BASE = "https://koenbrandbikes-del.github.io/daan-bonus-dashboard";

const BTW = 1.21;
const SHOPIFY_FEE = 0.02;
const OVERHEAD_FEE = 0.04;
const BONUS_PCT = 0.10;

const KP = [
  { name: "Prime", incl: 149, excl: 123.14, winst: 71.43 },
  { name: "Atlas", incl: 239, excl: 197.52, winst: 117.10 },
  { name: "Titan", incl: 349, excl: 288.43, winst: 159.06 },
];

const ITEM_FIXED = {
  "LumeWorks Prime": 43.80,
  "LumeWorks Atlas": 67.74,
  "LumeWorks Titan": 110.85,
  "Projectiescherm 100 inch": 37.81,
  "Pro stand": 20.66,
  "LumeWorks USB-C naar HDMI-kabel": 6.09,
  "Mini stand": 12.68,
  "Prime travelcase": 10.80,
  "Schoonmaak kit": 4.95,
  "Atlas afstandsbediening": 4.95,
  "Titan afstandsbediening": 4.95,
  "De complete Prime setup": 95.26,
  "De complete Atlas setup": 114.80,
  "De complete Titan setup": 159.82,
};

function round2(v) { return Math.round(v * 100) / 100; }

function calcOrder(o) {
  const excl = o.incl / BTW;
  let fixed = 0, hasUnknown = false;
  for (const it of o.items || [o.product]) {
    const c = ITEM_FIXED[it];
    if (c == null) hasUnknown = true;
    else fixed += c;
  }
  const variable = o.incl * SHOPIFY_FEE + excl * OVERHEAD_FEE;
  const cost = hasUnknown ? null : fixed + variable;
  const winst = cost == null ? null : excl - cost;
  return { excl, winst, cost };
}

function shopifyBeroas(orders, from, to) {
  let incl = 0, winst = 0;
  for (const o of orders) {
    if (o.test || (from && o.d < from) || (to && o.d > to)) continue;
    const p = calcOrder(o);
    if (p.winst != null) { incl += o.incl; winst += p.winst; }
  }
  return winst > 0 ? incl / winst : KP[0].incl / KP[0].winst;
}

/* ═══ Data fetchen (publieke GitHub Pages-JSON, geen auth) ═══════════ */

const _cache = new Map();
const CACHE_MS = 60_000; // dashboards zelf verversen ook maar om de 15 min

async function fetchJSON(path) {
  const now = Date.now();
  const hit = _cache.get(path);
  if (hit && now - hit.t < CACHE_MS) return hit.v;
  const r = await fetch(`${PAGES_BASE}/${path}?_=${Math.floor(now / CACHE_MS)}`);
  if (!r.ok) throw new Error(`Kon ${path} niet laden: HTTP ${r.status}`);
  const v = await r.json();
  _cache.set(path, { t: now, v });
  return v;
}

async function loadAll() {
  const [meta, shopify, status, creators] = await Promise.all([
    fetchJSON("data/meta.json"),
    fetchJSON("data/shopify.json"),
    fetchJSON("data/status.json"),
    fetchJSON("data/creators.json"),
  ]);
  return { meta, shopify, status, creators };
}

/* ═══ Periode-helpers ═════════════════════════════════════════════════
   Alle tools accepteren óf {from,to} (YYYY-MM-DD, inclusief) óf een
   preset ("vandaag"/"gisteren"/"week"/"maand"/"alles"). Zonder iets van
   beide: "maand" (de lopende bonusperiode, zelfde default als het
   dashboard zelf). */
function resolvePeriod(meta, { from, to, preset } = {}) {
  if (from || to) {
    return { from: from || meta.tb.aug_clean.from, to: to || meta.snap, label: `${from || "?"} – ${to || "?"}` };
  }
  const p = preset || "maand";
  const map = {
    vandaag: meta.tb.vandaag, gisteren: meta.tb.gisteren,
    week: meta.tb.week, maand: meta.tb.aug_clean, alles: meta.tb.aug_clean,
  };
  const tb = map[p] || meta.tb.aug_clean;
  return { from: tb.from, to: tb.to, label: p, tb };
}

function metaTotalsForRange(dailyMeta, from, to) {
  const t = { spend: 0, rev7: 0, rev1v: 0, purch: 0, impr: 0, cl: 0 };
  for (const d of dailyMeta) {
    if (d.d < from || d.d > to) continue;
    t.spend += d.spend; t.rev7 += d.rev7; t.rev1v += d.rev1v;
    t.purch += d.purch; t.impr += d.impr; t.cl += d.cl;
  }
  t.spend = round2(t.spend); t.rev7 = round2(t.rev7); t.rev1v = round2(t.rev1v);
  return t;
}

/* ═══ Shopify-orders (Orderdetail-equivalent) ═══════════════════════ */

function shopifyOrdersInRange(shopify, { from, to } = {}) {
  return shopify.orders
    .filter(o => !o.test && (!from || o.d >= from) && (!to || o.d <= to))
    .map(o => {
      const p = calcOrder(o);
      return {
        num: o.num, d: o.d, items: o.items, code: o.code || null,
        omzet_incl: o.incl, omzet_excl: round2(p.excl),
        kosten: p.cost != null ? round2(p.cost) : null,
        marge_pct: p.winst != null ? round2(p.winst / p.excl * 100) : null,
      };
    })
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}

function shopifySummary(shopify, { from, to } = {}) {
  const orders = shopifyOrdersInRange(shopify, { from, to });
  let omzetIncl = 0, omzetExcl = 0, cogs = 0, winst = 0, knownExcl = 0;
  for (const o of orders) {
    omzetIncl += o.omzet_incl; omzetExcl += o.omzet_excl;
    if (o.kosten != null) { cogs += o.kosten; winst += (o.omzet_excl - o.kosten); knownExcl += o.omzet_excl; }
  }
  return {
    from, to, orders: orders.length,
    omzet_incl: round2(omzetIncl), omzet_excl: round2(omzetExcl),
    kosten: round2(cogs), marge_euro: round2(winst),
    marge_pct: knownExcl > 0 ? round2(winst / knownExcl * 100) : null,
    break_even_roas: winst > 0 ? round2(omzetIncl / winst) : null,
    orders_zonder_kostprijs: orders.filter(o => o.kosten == null).length,
  };
}

/* ═══ Affiliates/creators ═════════════════════════════════════════════
   Zelfde correctie als blended.html: de sheet's eigen "Grondslag excl.
   BTW" is bij een deel van de orders onbetrouwbaar, dus waar een
   Shopify-order-match bestaat (op ordernummer) wordt dát bedrag gebruikt
   — inclusief het effect van de 10%-klantkorting op de marge. */

const PROD_CATS = {
  "LumeWorks Prime": "Prime", "LumeWorks Atlas": "Atlas",
  "LumeWorks Titan": "Titan", "Projectiescherm 100 inch": "Scherm",
};
function prodCategory(p) { return PROD_CATS[p] || "Accessoires"; }

function shopByNum(shopify) {
  const m = new Map();
  for (const o of shopify.orders) m.set(o.num, o);
  return m;
}

function affiliateOrdersInRange(creators, shopMap, { from, to, creator, product_category } = {}) {
  return creators.orders
    .filter(o => !o.retour && o.d)
    .filter(o => (!from || o.d >= from) && (!to || o.d <= to))
    .filter(o => !creator || o.creator.toLowerCase() === creator.toLowerCase())
    .filter(o => !product_category || prodCategory(o.product) === product_category)
    .map(o => {
      const match = shopMap.get(o.num);
      const incl = match ? match.incl : o.omzet_excl * BTW;
      const excl = match ? round2(match.incl / BTW) : o.omzet_excl;
      const cost = match ? calcOrder(match).cost : null;
      const winst = cost != null ? excl - cost : null;
      return {
        num: o.num, d: o.d, creator: o.creator, product: o.product,
        category: prodCategory(o.product), code: o.code || null,
        omzet_incl: round2(incl), omzet_excl: round2(excl),
        kosten: cost != null ? round2(cost) : null,
        marge_pct: winst != null ? round2(winst / excl * 100) : null,
        commissie: o.commissie, status: o.status,
        netto_marge_pct: winst != null ? round2((winst - o.commissie) / excl * 100) : null,
        heeft_shopify_match: !!match,
      };
    })
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}

function affiliateSummary(enrichedOrders, totalShopIncl) {
  let omzetIncl = 0, omzetExcl = 0, cogs = 0, commissie = 0, winst = 0, knownExcl = 0;
  for (const o of enrichedOrders) {
    omzetIncl += o.omzet_incl; omzetExcl += o.omzet_excl; commissie += o.commissie;
    if (o.kosten != null) { cogs += o.kosten; winst += (o.omzet_excl - o.kosten); knownExcl += o.omzet_excl; }
  }
  return {
    orders: enrichedOrders.length,
    omzet_incl: round2(omzetIncl), omzet_excl: round2(omzetExcl),
    kosten: round2(cogs), commissie: round2(commissie),
    netto_marge_euro: round2(winst - commissie),
    roas_affiliates: commissie > 0 ? round2(omzetExcl / commissie) : null,
    aandeel_van_totale_omzet_pct: totalShopIncl > 0 ? round2(omzetIncl / totalShopIncl * 100) : null,
    orders_zonder_kostprijs: enrichedOrders.filter(o => o.kosten == null).length,
  };
}

/* ═══ Bonus (zelfde formule als bonCalc() in index.html) ══════════════
   bonus = max(0, spend × (roas − break-even-roas)) × 10%, waarbij roas
   Meta's eigen attributie is (7d-click + 1d-view) — niet de echte
   Shopify-omzet. */
function computeBonus(meta, shopify, from, to) {
  const tot = metaTotalsForRange(meta.daily_meta, from, to);
  const roas = tot.spend > 0 ? (tot.rev7 + tot.rev1v) / tot.spend : 0;
  const be = shopifyBeroas(shopify.orders, from, to);
  const diff = roas - be;
  const bonus = round2(Math.max(0, tot.spend * diff) * BONUS_PCT);
  return { from, to, spend: tot.spend, meta_roas: round2(roas), break_even_roas: round2(be), bonus_eur: bonus };
}

export {
  PAGES_BASE, BTW, KP, ITEM_FIXED, BONUS_PCT,
  round2, calcOrder, shopifyBeroas, loadAll, fetchJSON, resolvePeriod, metaTotalsForRange,
  shopifyOrdersInRange, shopifySummary,
  prodCategory, shopByNum, affiliateOrdersInRange, affiliateSummary,
  computeBonus,
};
