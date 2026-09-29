/**
 * Remote MCP-server, voor read-only toegang tot het Meta-bonusdashboard
 * (spend/ROAS/marge/bonus) vanuit een MCP-client (ChatGPT Developer Mode,
 * Claude, enz.) — gebouwd op verzoek van Koen zodat Pim er vanuit zijn
 * eigen ChatGPT vragen aan kan stellen, zonder de website te hoeven
 * scrapen. Bewust beperkt tot het Meta-dashboard (niet het Creators-
 * dashboard/affiliates) — dat kan later alsnog toegevoegd worden door
 * hier extra tools te registreren, dashboardData.js heeft de affiliate-
 * logica al klaarstaan (shopByNum/affiliateOrdersInRange/affiliateSummary,
 * nu ongebruikt in dit bestand).
 *
 * Stateless Streamable HTTP (WebStandardStreamableHTTPServerTransport,
 * sessionIdGenerator: undefined) — geen sessie-state nodig, alle tools zijn
 * pure lees-aanroepen op publieke data (data/*.json op GitHub Pages, geen
 * auth/secrets nodig). Vereist compatibility_flags = ["nodejs_compat"] in
 * wrangler.toml (de SDK raakt Node-builtins aan bij het inladen).
 *
 * Endpoint: POST/GET/DELETE naar /mcp. In ChatGPT: Instellingen ›
 * Apps & Connectors › Developer mode aan › Create › URL hieronder + "/mcp".
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

function buildServer() {
  const server = new McpServer({ name: "daan-bonus-dashboard", version: "1.0.0" });

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

  return server;
}

export async function handleMcpRequest(request) {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
