/**
 * Twee dingen, volledig los van de Mac van de gebruiker:
 *
 * 1. fetch(): vangt Shopify's "Orderaanmaak"-webhook op (real-time, gratis)
 *    en zet nieuwe orders in data/shopify.json — zelfde schema/dedup-logica
 *    als scripts/sync_shopify.py.
 * 2. scheduled(): cron-trigger (elke 15 min) die Meta's Marketing API
 *    rechtstreeks aanroept en data/meta.json bijwerkt — poort van
 *    scripts/sync_dashboard_data.py naar de Cloudflare-runtime, zodat Meta-
 *    verversing niet meer afhangt van of de Mac wakker is (die bleek bij lage
 *    accu agressief geplande achtergrond-wakes te onderdrukken).
 *
 * Secrets (via `wrangler secret put`, nooit in code/git):
 *   GITHUB_TOKEN            fine-grained PAT, alleen deze repo, Contents: Read/write
 *   SHOPIFY_WEBHOOK_SECRET  gedeelde geheim van Shopify Admin > Instellingen > Meldingen > Webhooks
 *   META_ACCESS_TOKEN       Meta Marketing API system-user token (ads_read)
 *   META_SYNC_TRIGGER_KEY   willekeurige sleutel om de cron-sync ook handmatig te kunnen triggeren via GET /run-meta-sync?key=...
 */

const REPO = "koenbrandbikes-del/daan-bonus-dashboard";
const SHOPIFY_PATH = "data/shopify.json";
const META_PATH = "data/meta.json";
const STATUS_PATH = "data/status.json";
const BRANCH = "main";
const TEST_CODES = new Set(["pim100", "koen100", "job100"]);
const GH_API = "https://api.github.com";
const META_ACCOUNT_DEFAULT = "1326701336329006";
const CLEAN_S = "2026-08-05";
const LOOKBACK_DAYS = 3;
const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"];
const ATC_TYPES = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];

export {
  verifyHmac, mapOrder, timingSafeEqual, orderNumInt, toAmsterdamDate,
  amsterdamTodayStr, addDaysStr, dowMonday0, sumDaily, validateMeta,
  parseMetaInsights, parseMetaAdsetInsights,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/run-meta-sync") {
      if (!env.META_SYNC_TRIGGER_KEY || url.searchParams.get("key") !== env.META_SYNC_TRIGGER_KEY) {
        return new Response("unauthorized", { status: 401 });
      }
      try {
        const result = await runMetaSync(env);
        return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const topic = request.headers.get("X-Shopify-Topic") || "";
    const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";
    const rawBody = await request.text();

    const valid = await verifyHmac(rawBody, hmacHeader, env.SHOPIFY_WEBHOOK_SECRET);
    if (!valid) {
      return new Response("invalid signature", { status: 401 });
    }

    if (!topic.startsWith("orders/")) {
      return new Response("ignored topic", { status: 200 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return new Response("bad payload, acknowledged", { status: 200 });
    }

    const order = mapOrder(payload);
    if (!order) {
      console.error("kon order niet mappen:", JSON.stringify(payload).slice(0, 300));
      return new Response("unmappable order, acknowledged", { status: 200 });
    }

    try {
      const result = await mergeOrderIntoRepo(order, env.GITHUB_TOKEN);
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      console.error("merge mislukt:", e.message);
      return new Response("merge failed: " + e.message, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runMetaSync(env).catch((e) => console.error("meta cron-sync mislukt:", e.message))
    );
  },
};

/* ═══ Shopify (webhook) ══════════════════════════════════════════════ */

async function verifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = base64FromBuffer(sig);
  return timingSafeEqual(computed, hmacHeader);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function mapOrder(o) {
  const name = o.name || (o.order_number ? `#${o.order_number}` : null);
  const createdAt = o.created_at;
  if (!name || !createdAt || !Array.isArray(o.line_items)) return null;

  const items = [];
  for (const li of o.line_items) {
    const qty = Math.max(1, parseInt(li.quantity, 10) || 1);
    for (let i = 0; i < qty; i++) items.push(li.title);
  }
  const code = (o.discount_codes && o.discount_codes[0] && o.discount_codes[0].code) || "";
  const incl = round2(parseFloat(o.total_price || o.current_total_price || "0"));
  const rec = { d: toAmsterdamDate(createdAt), num: name, items, code, incl };
  if (TEST_CODES.has(code.toLowerCase()) || incl < 10) rec.test = true;
  return rec;
}

function orderNumInt(num) {
  const m = /\d+/.exec(num || "");
  return m ? parseInt(m[0], 10) : -1;
}

async function mergeOrderIntoRepo(order, token) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const file = await ghGetFile(token, SHOPIFY_PATH);
    if (!file) throw new Error(`GET contents mislukt voor ${SHOPIFY_PATH}`);
    const current = JSON.parse(file.content);
    const orders = Array.isArray(current.orders) ? current.orders : [];

    if (orders.some((o) => o.num === order.num)) {
      return { ok: true, skipped: true, reason: "order already present", num: order.num };
    }

    const merged = [...orders, order].sort(
      (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : orderNumInt(a.num) - orderNumInt(b.num))
    );
    const newContent = JSON.stringify({ orders: merged }, null, 1) + "\n";
    const put = await ghPutFile(token, SHOPIFY_PATH, newContent, file.sha, `Shopify webhook: order ${order.num}`);
    if (put.ok) return { ok: true, skipped: false, num: order.num, total: merged.length };
    if (put.status === 409 && attempt < 3) { await sleep(300 * attempt); continue; }
    throw new Error(`PUT contents ${put.status}: ${put.text}`);
  }
  throw new Error("kon niet mergen na 3 pogingen (blijvende 409-conflicten)");
}

/* ═══ Meta (cron) ═════════════════════════════════════════════════════
   Poort van scripts/sync_dashboard_data.py — zelfde incrementele aanpak
   (alleen vandaag + korte lookback, rest van de geschiedenis blijft staan),
   zelfde validatie, alleen dan als Cloudflare cron i.p.v. lokaal script. ═══ */

async function runMetaSync(env) {
  const TOKEN = env.META_ACCESS_TOKEN;
  const ACCOUNT = env.META_AD_ACCOUNT_ID || META_ACCOUNT_DEFAULT;
  if (!TOKEN) throw new Error("Geen META_ACCESS_TOKEN secret ingesteld");

  const TODAY = amsterdamTodayStr();
  const YEST = addDaysStr(TODAY, -1);
  const dow = dowMonday0(TODAY);
  const WK_S = addDaysStr(TODAY, -dow);
  const WK_S_C = WK_S < CLEAN_S ? CLEAN_S : WK_S;
  const PWK_E = addDaysStr(WK_S, -1);
  const PWK_S = addDaysStr(PWK_E, -6);
  let LOOKBACK_FROM = addDaysStr(TODAY, -(LOOKBACK_DAYS - 1));
  if (LOOKBACK_FROM < CLEAN_S) LOOKBACK_FROM = CLEAN_S;

  const file = await ghGetFile(env.GITHUB_TOKEN, META_PATH);
  const existing = file ? JSON.parse(file.content) : { daily_meta: [], daily_ads: [] };

  const dailyMeta = new Map((existing.daily_meta || []).map((d) => [d.d, {
    spend: d.spend, rev7: d.rev7, rev1v: d.rev1v, purch: d.purch, impr: d.impr, cl: d.cl,
  }]));
  const dailyAds = new Map((existing.daily_ads || []).map((d) => [d.d, d.ads]));
  const existingDayCount = dailyMeta.size;

  let d = LOOKBACK_FROM;
  while (d <= TODAY) {
    const dayData = await metaInsights(TOKEN, ACCOUNT, d, d);
    dailyMeta.set(d, dayData);
    dailyAds.set(d, await metaInsightsByAdset(TOKEN, ACCOUNT, d, d));
    d = addDaysStr(d, 1);
  }

  const errors = validateMeta(dailyMeta, dailyAds);
  if (errors.length) {
    await updateStatus(env.GITHUB_TOKEN, "meta", false, errors.join("; "));
    throw new Error("validatie mislukt: " + errors.join("; "));
  }
  if (existingDayCount > 0 && dailyMeta.size < existingDayCount) {
    const msg = `nieuwe dataset (${dailyMeta.size} dagen) kleiner dan bestaande (${existingDayCount}) — niet overschreven`;
    await updateStatus(env.GITHUB_TOKEN, "meta", false, msg);
    throw new Error(msg);
  }

  const v = dailyMeta.get(TODAY) || zeroDay();
  const g = dailyMeta.get(YEST) || zeroDay();
  const w = sumDaily(dailyMeta, WK_S_C, TODAY);
  const aug = sumDaily(dailyMeta, CLEAN_S, TODAY);
  const pw = await metaInsights(TOKEN, ACCOUNT, PWK_S, PWK_E);
  const jul = (existing.tb && existing.tb.jul) || null;

  const sortedDates = [...dailyMeta.keys()].sort();
  const metaOut = {
    snap: TODAY,
    snap_time: amsterdamNowHHMM(),
    tb: {
      vandaag: { from: TODAY, to: TODAY, ...v },
      gisteren: { from: YEST, to: YEST, ...g },
      week: { from: WK_S_C, to: TODAY, ...w },
      prevweek: { from: PWK_S, to: PWK_E, ...pw },
      jul,
      aug_clean: { from: CLEAN_S, to: TODAY, ...aug },
    },
    daily_meta: sortedDates.map((ds) => ({ d: ds, ...dailyMeta.get(ds) })),
    daily_ads: sortedDates.filter((ds) => dailyAds.has(ds)).map((ds) => ({ d: ds, ads: dailyAds.get(ds) })),
  };

  const put = await ghPutFile(
    env.GITHUB_TOKEN, META_PATH, JSON.stringify(metaOut, null, 1) + "\n",
    file ? file.sha : null, `Meta cron-sync ${TODAY} ${metaOut.snap_time}`
  );
  if (!put.ok) throw new Error(`PUT ${META_PATH} ${put.status}: ${put.text}`);

  await updateStatus(env.GITHUB_TOKEN, "meta", true, null);
  return { ok: true, days: dailyMeta.size, snap: TODAY, snap_time: metaOut.snap_time };
}

function zeroDay() { return { spend: 0, rev7: 0, rev1v: 0, purch: 0, impr: 0, cl: 0 }; }

function avAction(list, atype, window) {
  for (const a of (list || [])) {
    if (a.action_type === atype) return window ? parseFloat(a[window] || 0) : parseFloat(a.value || 0);
  }
  return 0;
}

function parseMetaInsights(json) {
  const rows = json.data || [];
  if (!rows.length) return zeroDay();
  const row = rows[0];
  const acts = row.actions || [], avls = row.action_values || [];
  const p7 = Math.max(...PURCHASE_TYPES.map((t) => avAction(acts, t, "7d_click")));
  const p1v = Math.max(...PURCHASE_TYPES.map((t) => avAction(acts, t, "1d_view")));
  const r7 = Math.max(...PURCHASE_TYPES.map((t) => avAction(avls, t, "7d_click")));
  const r1v = Math.max(...PURCHASE_TYPES.map((t) => avAction(avls, t, "1d_view")));
  return {
    spend: round2(parseFloat(row.spend || 0)),
    rev7: round2(r7), rev1v: round2(r1v),
    purch: Math.round(p7 + p1v),
    impr: parseInt(row.impressions || 0, 10),
    cl: parseInt(row.clicks || 0, 10),
  };
}

function parseMetaAdsetInsights(json) {
  const out = [];
  for (const row of (json.data || [])) {
    const acts = row.actions || [], avls = row.action_values || [];
    const p7 = Math.max(...PURCHASE_TYPES.map((t) => avAction(acts, t, "7d_click")));
    const p1v = Math.max(...PURCHASE_TYPES.map((t) => avAction(acts, t, "1d_view")));
    const r7 = Math.max(...PURCHASE_TYPES.map((t) => avAction(avls, t, "7d_click")));
    const r1v = Math.max(...PURCHASE_TYPES.map((t) => avAction(avls, t, "1d_view")));
    const a7 = Math.max(...ATC_TYPES.map((t) => avAction(acts, t, "7d_click")));
    const a1v = Math.max(...ATC_TYPES.map((t) => avAction(acts, t, "1d_view")));
    out.push({
      n: row.adset_name || "?",
      spend: round2(parseFloat(row.spend || 0)),
      rev7: round2(r7), rev1v: round2(r1v),
      purch: Math.round(p7 + p1v),
      ctr: round2(parseFloat(row.ctr || 0)),
      cpc: round2(parseFloat(row.cpc || 0)),
      atc: Math.round(a7 + a1v),
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

async function metaInsights(token, account, start, end) {
  const url = new URL(`https://graph.facebook.com/v21.0/act_${account}/insights`);
  url.searchParams.set("fields", "spend,impressions,clicks,actions,action_values");
  url.searchParams.set("action_attribution_windows", JSON.stringify(["7d_click", "1d_view"]));
  url.searchParams.set("time_range", JSON.stringify({ since: start, until: end }));
  url.searchParams.set("level", "account");
  url.searchParams.set("access_token", token);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Meta API fout (${start}–${end}): ${r.status} ${await r.text()}`);
  return parseMetaInsights(await r.json());
}

async function metaInsightsByAdset(token, account, start, end) {
  const url = new URL(`https://graph.facebook.com/v21.0/act_${account}/insights`);
  url.searchParams.set("fields", "adset_name,spend,impressions,clicks,ctr,cpc,actions,action_values");
  url.searchParams.set("action_attribution_windows", JSON.stringify(["7d_click", "1d_view"]));
  url.searchParams.set("time_range", JSON.stringify({ since: start, until: end }));
  url.searchParams.set("level", "adset");
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", token);
  const r = await fetch(url.toString());
  if (!r.ok) { console.error(`Meta adset API fout (${start}–${end}): ${r.status}`); return []; }
  return parseMetaAdsetInsights(await r.json());
}

function sumDaily(dailyMetaMap, from, to) {
  const total = { spend: 0, rev7: 0, rev1v: 0, purch: 0, impr: 0, cl: 0 };
  for (const [ds, x] of dailyMetaMap) {
    if (ds >= from && ds <= to) {
      total.spend += x.spend; total.rev7 += x.rev7; total.rev1v += x.rev1v;
      total.purch += x.purch; total.impr += x.impr; total.cl += x.cl;
    }
  }
  total.spend = round2(total.spend); total.rev7 = round2(total.rev7); total.rev1v = round2(total.rev1v);
  return total;
}

function validateMeta(dailyMetaMap, dailyAdsMap) {
  const errors = [];
  const dates = [...dailyMetaMap.keys()].sort();
  if (!dates.length) { errors.push("daily_meta is leeg"); return errors; }
  for (const ds of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { errors.push(`ongeldige datum: ${ds}`); continue; }
    const x = dailyMetaMap.get(ds);
    for (const f of ["spend", "rev7", "rev1v", "purch", "impr", "cl"]) {
      if (typeof x[f] !== "number" || isNaN(x[f])) { errors.push(`${ds}: ontbrekend/ongeldig veld ${f}`); continue; }
      if (x[f] < 0) errors.push(`${ds}: negatieve ${f} (${x[f]})`);
    }
  }
  for (const ds of dates) {
    if (!dailyAdsMap.has(ds)) continue;
    const adsSpend = round2(dailyAdsMap.get(ds).reduce((s, a) => s + a.spend, 0));
    const daySpend = dailyMetaMap.get(ds).spend;
    if (daySpend > 0 && Math.abs(adsSpend - daySpend) / daySpend > 0.15) {
      errors.push(`${ds}: som advertentiegroep-spend (${adsSpend}) wijkt >15% af van dagtotaal (${daySpend})`);
    }
  }
  return errors;
}

/* ═══ Tijd/datum-helpers (Europe/Amsterdam, string-based, geen lokale-tijdzone-aannames) ═══ */

function toAmsterdamDate(isoString) {
  const d = new Date(isoString);
  return fmtAmsterdamParts(d);
}
function amsterdamTodayStr() { return fmtAmsterdamParts(new Date()); }
function fmtAmsterdamParts(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function amsterdamNowHHMM() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("hour")}:${get("minute")}`;
}
// Pure kalenderrekenen op YYYY-MM-DD strings via UTC-genormaliseerde Date's —
// voorkomt dat de Workers-runtime-tijdzone (altijd UTC) dagberekeningen
// zou kunnen verstoren.
function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function dowMonday0(dateStr) {
  const jsDow = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=zo..6=za
  return (jsDow + 6) % 7; // 0=ma..6=zo
}

function round2(v) { return Math.round(v * 100) / 100; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ═══ GitHub Contents API — generieke helpers, gedeeld door beide paden ═══ */

async function ghRequest(path, token, init) {
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "daan-dashboard-worker",
      ...(init && init.headers),
    },
  });
}

async function ghGetFile(token, path) {
  const r = await ghRequest(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`, token);
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`GET ${path} ${r.status}: ${await r.text()}`);
  }
  const json = await r.json();
  return { content: decodeBase64(json.content), sha: json.sha };
}

async function ghPutFile(token, path, content, sha, message) {
  const body = { message, content: encodeBase64(content), branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghRequest(`/repos/${REPO}/contents/${path}`, token, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, text: r.ok ? null : await r.text() };
}

async function updateStatus(token, source, ok, error) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let status = {};
    const file = await ghGetFile(token, STATUS_PATH);
    if (file) { try { status = JSON.parse(file.content); } catch (e) { status = {}; } }
    const prev = status[source] || {};
    status[source] = {
      status: ok ? "ok" : "error",
      last_success: ok ? new Date().toISOString() : (prev.last_success || null),
      error: error || null,
    };
    const put = await ghPutFile(
      token, STATUS_PATH, JSON.stringify(status, null, 1) + "\n",
      file ? file.sha : null, `status: ${source} ${ok ? "ok" : "error"}`
    );
    if (put.ok) return;
    if (put.status === 409 && attempt < 3) { await sleep(300 * attempt); continue; }
    console.error(`status.json update mislukt: ${put.status} ${put.text}`);
    return;
  }
}

function decodeBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function base64FromBuffer(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
