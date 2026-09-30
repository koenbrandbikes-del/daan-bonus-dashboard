/**
 * Twee remote MCP-servers op hetzelfde Worker, voor read-only toegang tot
 * de dashboards vanuit een MCP-client (ChatGPT Developer Mode, Claude,
 * enz.):
 *
 *   /mcp         — alleen het Meta-bonusdashboard (spend/ROAS/marge/bonus).
 *                  Dit is de link voor Pim, extern gedeeld, geen auth
 *                  (onderliggende data staat toch al publiek op de site).
 *   /mcp-intern  — hetzelfde plús affiliates/creators, en de plek om
 *                  later andere kanalen (Google Ads, TrackBee, ...) aan
 *                  toe te voegen. Alleen voor intern gebruik, dus wél
 *                  achter een sleutel (?key=..., env.MCP_INTERNAL_KEY,
 *                  zelfde patroon als /run-meta-sync) — niet omdat de
 *                  onderliggende data geheim is (dat is 'ie niet), maar
 *                  om te voorkomen dat iemand anders 'm toevallig vindt
 *                  en er per ongeluk op meeleest.
 *
 * Beide gebruiken dezelfde tool-registraties (registerMetaTools /
 * registerAffiliateTools hieronder) — /mcp-intern registreert gewoon
 * allebei.
 *
 * Stateless Streamable HTTP (WebStandardStreamableHTTPServerTransport,
 * sessionIdGenerator: undefined) — geen sessie-state nodig, alle tools zijn
 * pure lees-aanroepen op publieke data (data/*.json op GitHub Pages, geen
 * GitHub-token nodig). Vereist compatibility_flags = ["nodejs_compat"] in
 * wrangler.toml (de SDK raakt Node-builtins aan bij het inladen).
 *
 * In ChatGPT: Instellingen › Apps & Connectors › Developer mode aan ›
 * Create › de juiste URL hieronder.
 *
 * Belangrijk: een stateless transport-instantie kan maar 1 request
 * afhandelen ("Stateless transport cannot be reused across requests" — zie
 * de SDK zelf) — dus per inkomend fetch()-verzoek een geheel nieuwe
 * McpServer + transport aanmaken, nooit hergebruiken tussen requests.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  loadAll, resolvePeriod, metaTotalsForRange, round2,
  shopifyOrdersInRange, shopifySummary,
  shopByNum, affiliateOrdersInRange, affiliateSummary,
  computeBonus,
} from "./dashboardData.js";

const periodShape = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Startdatum YYYY-MM-DD (inclusief). Samen met 'to' gebruiken voor een vrije periode."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Einddatum YYYY-MM-DD (inclusief)."),
  preset: z.enum(["vandaag", "gisteren", "week", "maand", "alles"]).optional()
    .describe("Snelkoppeling i.p.v. from/to. 'maand' = lopende bonusperiode (sinds 5 aug 2026), dat is ook de default als niets is opgegeven."),
};

const MAX_ORDERS = 300;

function jsonResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] };
}

function registerMetaTools(server) {
  server.registerTool(
    "get_status",
    {
      title: "Synchronisatiestatus",
      description: "Laat zien hoe vers de dashboarddata is: laatste succesvolle sync per bron (Meta, Shopify). Begin hiermee als je twijfelt of de cijfers actueel zijn.",
      inputSchema: {},
    },
    async () => {
      const { status } = await loadAll();
      return jsonResult({ meta: status.meta, shopify: status.shopify });
    }
  );

  server.registerTool(
    "get_meta_kpis",
    {
      title: "Meta-advertentiecijfers",
      description: "Meta (Facebook/Instagram) advertentie-uitgaven, omzet-attributie (7d-click + 1d-view) en ROAS voor een periode. Dit is Meta's eigen toerekening, niet per se gelijk aan de echte Shopify-omzet — gebruik get_shopify_summary voor de daadwerkelijke omzet.",
      inputSchema: periodShape,
    },
    async (args) => {
      const { meta } = await loadAll();
      const pd = resolvePeriod(meta, args);
      const t = pd.tb || metaTotalsForRange(meta.daily_meta, pd.from, pd.to);
      const roas = t.spend > 0 ? round2((t.rev7 + t.rev1v) / t.spend) : 0;
      return jsonResult({
        from: pd.from, to: pd.to,
        spend: t.spend, omzet_attributie: round2(t.rev7 + t.rev1v),
        roas, aankopen: t.purch, impressies: t.impr, clicks: t.cl,
      });
    }
  );

  server.registerTool(
    "get_bonus_estimate",
    {
      title: "Bonusberekening (Daan)",
      description: "Schat de bonus zoals op het Meta-bonusdashboard: max(0, Meta-spend × (Meta-ROAS − break-even-ROAS)) × 10%. Break-even-ROAS komt uit de werkelijke Shopify-productmarge (calcOrder), niet uit Meta's cijfers.",
      inputSchema: periodShape,
    },
    async (args) => {
      const { meta, shopify } = await loadAll();
      const pd = resolvePeriod(meta, args);
      return jsonResult(computeBonus(meta, shopify, pd.from, pd.to));
    }
  );

  server.registerTool(
    "get_shopify_summary",
    {
      title: "Shopify-omzet en marge",
      description: "Werkelijke Shopify-omzet, kostprijs en marge voor een periode (testorders uitgesloten). Kostprijs = inkoop+verzending+fulfilment per product plus Shopify-fee (2%) en overhead (4%) — zelfde methode als de Orderdetail-tabel op het dashboard.",
      inputSchema: periodShape,
    },
    async (args) => {
      const { meta, shopify } = await loadAll();
      const pd = resolvePeriod(meta, args);
      return jsonResult(shopifySummary(shopify, { from: pd.from, to: pd.to }));
    }
  );

  server.registerTool(
    "list_shopify_orders",
    {
      title: "Shopify-orders (detail)",
      description: "Losse Shopify-orders met producten, omzet, kostprijs en marge% — zelfde als de Orderdetail-tabel op het Meta-dashboard. Testorders uitgesloten. Resultaat afgekapt op 'limit' (nieuwste eerst).",
      inputSchema: { ...periodShape, limit: z.number().int().min(1).max(MAX_ORDERS).optional().describe(`Max. aantal orders (standaard 100, max ${MAX_ORDERS}).`) },
    },
    async (args) => {
      const { meta, shopify } = await loadAll();
      const pd = resolvePeriod(meta, args);
      const orders = shopifyOrdersInRange(shopify, { from: pd.from, to: pd.to });
      const limit = Math.min(args.limit || 100, MAX_ORDERS);
      return jsonResult({ from: pd.from, to: pd.to, totaal_orders: orders.length, getoond: Math.min(limit, orders.length), orders: orders.slice(0, limit) });
    }
  );
}

function registerAffiliateTools(server) {
  server.registerTool(
    "list_creators",
    {
      title: "Creators/affiliates (overzicht)",
      description: "Alle creators/affiliates met hun totale orders, omzet en commissie sinds de start van de Creators-sheet (all-time, niet periode-gebonden — commissie-uitbetaling loopt per kalendermaand).",
      inputSchema: {},
    },
    async () => {
      const { creators } = await loadAll();
      return jsonResult({ synced_at: creators.synced_at, totals: creators.totals, creators: creators.creators });
    }
  );

  server.registerTool(
    "get_affiliate_summary",
    {
      title: "Affiliate-omzet en marge (samengevat)",
      description: "Omzet, commissie, kostprijs en netto marge van affiliate/creator-sales (orders met een kortingscode) voor een periode, optioneel gefilterd op één creator. Omzet is het echte Shopify-orderbedrag ná de 10%-klantkorting die bij deze codes hoort — dat drukt de marge al, los van de commissie.",
      inputSchema: { ...periodShape, creator: z.string().optional().describe("Filter op exact 1 creator-naam (zie list_creators voor de namen).") },
    },
    async (args) => {
      const { meta, shopify, creators } = await loadAll();
      const pd = resolvePeriod(meta, args);
      const shopOrders = shopifyOrdersInRange(shopify, {});
      const totalShopIncl = shopOrders
        .filter(o => o.d >= pd.from && o.d <= pd.to)
        .reduce((s, o) => s + o.omzet_incl, 0);
      const map = shopByNum(shopify);
      const enriched = affiliateOrdersInRange(creators, map, { from: pd.from, to: pd.to, creator: args.creator });
      return jsonResult({ from: pd.from, to: pd.to, creator: args.creator || "alle", ...affiliateSummary(enriched, totalShopIncl) });
    }
  );

  server.registerTool(
    "list_affiliate_orders",
    {
      title: "Affiliate-orders (detail)",
      description: "Losse affiliate/creator-orders met product, kortingscode, omzet, kostprijs, marge% en commissie — zelfde als de Orderdetail-tabel op het Creators-dashboard. Filterbaar op periode, creator en productcategorie (Prime/Atlas/Titan/Scherm/Accessoires).",
      inputSchema: {
        ...periodShape,
        creator: z.string().optional().describe("Filter op exact 1 creator-naam."),
        product_category: z.enum(["Prime", "Atlas", "Titan", "Scherm", "Bundel", "Accessoires"]).optional(),
        limit: z.number().int().min(1).max(MAX_ORDERS).optional().describe(`Max. aantal orders (standaard 100, max ${MAX_ORDERS}).`),
      },
    },
    async (args) => {
      const { meta, shopify, creators } = await loadAll();
      const pd = resolvePeriod(meta, args);
      const map = shopByNum(shopify);
      const orders = affiliateOrdersInRange(creators, map, {
        from: pd.from, to: pd.to, creator: args.creator, product_category: args.product_category,
      });
      const limit = Math.min(args.limit || 100, MAX_ORDERS);
      return jsonResult({ from: pd.from, to: pd.to, totaal_orders: orders.length, getoond: Math.min(limit, orders.length), orders: orders.slice(0, limit) });
    }
  );
}

async function runMcp(request, register) {
  const server = new McpServer({ name: "daan-bonus-dashboard", version: "1.0.0" });
  register(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** /mcp — extern (Pim), alleen Meta-dashboard, geen auth. */
export async function handleMcpRequest(request) {
  return runMcp(request, registerMetaTools);
}

/** /mcp-intern — Meta + affiliates, achter ?key=env.MCP_INTERNAL_KEY. */
export async function handleInternalMcpRequest(request, env) {
  const url = new URL(request.url);
  if (!env.MCP_INTERNAL_KEY || url.searchParams.get("key") !== env.MCP_INTERNAL_KEY) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  return runMcp(request, (server) => {
    registerMetaTools(server);
    registerAffiliateTools(server);
  });
}
