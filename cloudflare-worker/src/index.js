/**
 * Vangt Shopify's "Orderaanmaak"-webhook op (real-time, gratis) en zet nieuwe
 * orders rechtstreeks in data/shopify.json van de daan-bonus-dashboard repo —
 * zelfde schema en dedup-logica als scripts/sync_shopify.py, zodat beide
 * paden veilig naast elkaar kunnen bestaan.
 *
 * Secrets (via `wrangler secret put`, nooit in code/git):
 *   GITHUB_TOKEN            fine-grained PAT, alleen deze repo, Contents: Read/write
 *   SHOPIFY_WEBHOOK_SECRET  gedeelde geheim van Shopify Admin > Instellingen > Meldingen > Webhooks
 */

const REPO = "koenbrandbikes-del/daan-bonus-dashboard";
const FILE_PATH = "data/shopify.json";
const BRANCH = "main";
const TEST_CODES = new Set(["pim100", "koen100", "job100"]);
const GH_API = "https://api.github.com";

export { verifyHmac, mapOrder, timingSafeEqual, orderNumInt, toAmsterdamDate };

export default {
  async fetch(request, env) {
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
      // Andere event-types die per ongeluk op dezelfde webhook binnenkomen —
      // niet relevant, wel bevestigen zodat Shopify niet blijft retryen.
      return new Response("ignored topic", { status: 200 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      // Kapotte payload retryen heeft geen zin — 200 zodat Shopify het
      // niet blijft proberen, maar wel loggen voor `wrangler tail`.
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
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      console.error("merge mislukt:", e.message);
      // 500 zodat Shopify het later opnieuw probeert (transiënte GitHub-fout).
      return new Response("merge failed: " + e.message, { status: 500 });
    }
  },
};

async function verifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = base64FromBuffer(sig);
  return timingSafeEqual(computed, hmacHeader);
}

function base64FromBuffer(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
  const incl = Math.round(parseFloat(o.total_price || o.current_total_price || "0") * 100) / 100;
  const rec = { d: toAmsterdamDate(createdAt), num: name, items, code, incl };
  if (TEST_CODES.has(code.toLowerCase()) || incl < 10) rec.test = true;
  return rec;
}

// Neemt géén afhankelijkheid van of Shopify het tijdzone-offset in de string
// laat staan (REST/webhook doet dat meestal wel, GraphQL normaliseert naar
// UTC) — rekent altijd expliciet om naar Europe/Amsterdam. Anders valt een
// bestelling vlak na lokale middernacht op de verkeerde kalenderdag (bug die
// eerder order #1122 trof: 00:05 lokale tijd werd als "vorige dag" gelezen).
function toAmsterdamDate(isoString) {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function orderNumInt(num) {
  const m = /\d+/.exec(num || "");
  return m ? parseInt(m[0], 10) : -1;
}

async function ghRequest(path, token, init) {
  const r = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "daan-shopify-webhook",
      ...(init && init.headers),
    },
  });
  return r;
}

async function mergeOrderIntoRepo(order, token) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const getRes = await ghRequest(
      `/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      token
    );
    if (!getRes.ok) {
      throw new Error(`GET contents ${getRes.status}: ${await getRes.text()}`);
    }
    const getJson = await getRes.json();
    const currentText = decodeBase64(getJson.content);
    const current = JSON.parse(currentText);
    const orders = Array.isArray(current.orders) ? current.orders : [];

    if (orders.some((o) => o.num === order.num)) {
      return { ok: true, skipped: true, reason: "order already present", num: order.num };
    }

    const merged = [...orders, order].sort(
      (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : orderNumInt(a.num) - orderNumInt(b.num))
    );
    const newContent = JSON.stringify({ orders: merged }, null, 1) + "\n";

    const putRes = await ghRequest(`/repos/${REPO}/contents/${FILE_PATH}`, token, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `Shopify webhook: order ${order.num}`,
        content: encodeBase64(newContent),
        sha: getJson.sha,
        branch: BRANCH,
      }),
    });

    if (putRes.ok) {
      return { ok: true, skipped: false, num: order.num, total: merged.length };
    }
    if (putRes.status === 409 && attempt < 3) {
      // Iemand anders schreef tegelijk (bv. de reguliere sync draaide net) —
      // even wachten en opnieuw GET+merge+PUT proberen.
      await new Promise((r) => setTimeout(r, 300 * attempt));
      continue;
    }
    throw new Error(`PUT contents ${putRes.status}: ${await putRes.text()}`);
  }
  throw new Error("kon niet mergen na 3 pogingen (blijvende 409-conflicten)");
}

function decodeBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
