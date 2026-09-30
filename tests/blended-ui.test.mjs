import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
const root = new URL("../", import.meta.url);
async function boot(
  query = "",
  failSource = "",
  transform = (url, data) => data,
) {
  const dom = new JSDOM(
      fs.readFileSync(new URL("blended.html", root), "utf8"),
      {
        url: "http://localhost/blended.html" + query,
        runScripts: "outside-only",
      },
    ),
    w = dom.window;
  w.fetch = async (url) => {
    if (url.includes(failSource) && failSource) throw Error("Unavailable");
    return {
      ok: true,
      json: async () =>
        transform(url, JSON.parse(fs.readFileSync(new URL(url, root), "utf8"))),
    };
  };
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const scripts = ["metrics.js", "data.js", "date-picker.js", "creator-summary.js", "app.js"]
    .map((f) =>
      fs
        .readFileSync(new URL("assets/blended/" + f, root), "utf8")
        .replace(/^import[\s\S]*?;\s*/gm, "")
        .replace(/export /g, ""),
    )
    .join("\n");
  w.eval(scripts.replace(/start\(\);\s*$/, "globalThis.ready=start();"));
  await w.ready;
  return w;
}
test("drilldowns, comparing two metrics, channel switching and Google splits", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29&googleScope=all&metrics=cost"),
    d = w.document;
  const click = (s) => {
    assert(d.querySelector(s), s);
    d.querySelector(s).click();
  };
  assert.equal(d.querySelectorAll(".kpi").length, 6);

  assert(
    d
      .querySelector("#detail")
      .textContent.includes("Van klantomzet naar marge"),
  );
  click("[data-detail]");
  assert(
    d.querySelector("#detail").textContent.includes("Producten en kostprijzen"),
  );
  click("[data-detail]");
  assert(d.querySelector("#detail").textContent.includes("Volledige orders"));
  click("#detailBack");
  click("[data-metric=revenue]");
  click("[data-metric=cost]");
  click("[data-metric=spend]");
  assert.equal(d.querySelectorAll(".kpi.active").length, 2);
  click("[data-metric=result]");
  assert.equal(d.querySelector(".replacement"),null);
  assert(d.querySelector("[data-metric=result]").classList.contains("active"));
  click("#chartMode");
  assert(d.querySelector("#chart table"));
  click("[data-channel=google]");
  assert(d.querySelector("#detail").textContent.includes("C | Corporate"));
  for (const v of ["intent", "actions", "customers", "campaign"]) {
    const g = d.querySelector("#googleGroup");
    g.value = v;
    g.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert(d.querySelector("#detail tbody").textContent.length > 10);
  }
  click("[data-channel=infl]");
  click("[data-detail]");
  assert(d.querySelector("#detail").textContent.includes("Betaalstatus"));
  click("[data-channel=meta]");
  click("[data-detail]");
  assert(d.querySelector("#detail th").textContent.includes("Dag"));
  click("[data-channel=all]");
  click("[data-metric=result]");
  click("[data-metric=spend]");
  click("[data-detail*=products]");
  assert(
    d.querySelector("#detail").textContent.includes("Producten en kostprijzen"),
  );
  click("[data-metric=spend]");
  click("[data-metric=result]");
  const totals = [...d.querySelectorAll("#table tfoot td")].map(
    (x) => x.textContent,
  );
  assert.equal(totals[1], "—");
  assert.equal(
    totals[4],
    "—",
    "never sum overlapping attribution into a total ROAS",
  );
  w.close();
});
test("malformed dates recover and unavailable source does not become zero", async () => {
  const w = await boot("?from=2026-99-99&to=2026-99-99", "google.json"),
    d = w.document;
  assert(d.querySelector(".kpis"));
  assert(
    d.querySelector("[data-metric=spend] strong").textContent.includes("—"),
  );
  assert(
    d.querySelector("[data-metric=result] strong").textContent.includes("—"),
  );
  assert(d.querySelector(".signals").textContent.includes("niet beschikbaar"));
  w.close();
});
test("calendar ranges apply, compare and cancel without changing dates", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29"),
    d = w.document;
  d.querySelector("#periodButton").click();
  assert.equal(d.querySelector("#periodMenu").hidden, false);
  d.querySelector('#periodMenu [data-date="2026-09-10"]').click();
  d.querySelector('#periodMenu [data-date="2026-09-15"]').click();
  d.querySelector("#periodMenu .cal-apply").click();
  assert.equal(new URL(w.location.href).searchParams.get("from"), "2026-09-10");
  assert.equal(new URL(w.location.href).searchParams.get("to"), "2026-09-15");
  d.querySelector("#comparePeriodButton").click();
  d.querySelector('#comparePeriodMenu [data-date="2026-09-01"]').click();
  d.querySelector('#comparePeriodMenu [data-date="2026-09-06"]').click();
  d.querySelector("#comparePeriodMenu .cal-apply").click();
  assert.equal(new URL(w.location.href).searchParams.get("compare"), "custom");
  assert.match(
    d.querySelector("#comparePeriodButton").textContent,
    /1 sep.*6 sep/,
  );
  d.querySelector("#periodButton").click();
  d.querySelector('#periodMenu [data-date="2026-09-02"]').click();
  d.querySelector("#periodMenu").dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(d.querySelector("#periodMenu").hidden, true);
  assert.equal(new URL(w.location.href).searchParams.get("from"), "2026-09-10");
  d.querySelector("#periodButton").click();
  d.querySelector('#periodMenu [data-preset="lastmonth"]').click();
  assert.match(d.querySelector("#periodButton").textContent, /aug/);
});
test("Google defaults to non-brand and keeps the scope in charts, detail and URL", async () => {
  const w = await boot("?channel=google&from=2026-09-23&to=2026-09-29"),
    d = w.document;
  assert.equal(
    d
      .querySelector("[data-google-scope=nonbrand]")
      .getAttribute("aria-pressed"),
    "true",
  );
  const source = JSON.parse(
    fs.readFileSync(new URL("data/google.json", root), "utf8"),
  );
  const expected = source.daily_campaigns
    .filter(
      (r) =>
        ["23981395562", "23985056312", "23980131321", "23981395565"].includes(
          r.id,
        ) &&
        r.d >= "2026-09-23" &&
        r.d <= "2026-09-29",
    )
    .reduce((s, r) => s + r.spend, 0);
  const shown = d.querySelector("[data-metric=spend] strong").textContent;
  assert(shown.includes(Math.round(expected).toLocaleString("nl-NL")));
  assert.match(d.querySelector("#detail").textContent, /Non-branded/);
  d.querySelector("[data-google-scope=brand]").click();
  assert.equal(
    new URL(w.location.href).searchParams.get("googleScope"),
    "brand",
  );
  assert.match(d.querySelector("#detail").textContent, /Branded/);
  d.querySelector("[data-channel=all]").click();
  assert.equal(d.querySelector(".google-scope"), null);
  w.close();
});
test("products default to best sellers and upsell groups open matching orders", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29"),
    d = w.document;
  assert.equal(
    d.querySelector("#table tbody tr td").textContent.trim(),
    "LumeWorks Prime →",
  );
  assert.equal(
    d.querySelectorAll("#table th")[1].getAttribute("aria-sort"),
    "descending",
  );
  assert(d.querySelector(".basket-insights"));
  d.querySelector('[data-basket="with"]').click();
  assert.match(d.querySelector("#detail h3").textContent, /met accessoire/);
  assert(d.querySelectorAll("#table tbody tr").length > 0);
  d.querySelector("#detailBack").click();
  assert(d.querySelector(".basket-insights"));
  d.querySelector('#table [data-sort="0"]').click();
  assert.equal(
    d.querySelector("#table th").getAttribute("aria-sort"),
    "ascending",
  );
  w.close();
});
test("calendar survives transient focus loss and clicks on rebuilt day buttons", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29"),
    d = w.document;
  d.querySelector("#periodButton").click();
  d.activeElement.blur();
  await Promise.resolve();
  assert.equal(d.querySelector("#periodMenu").hidden, false);
  d.querySelector('#periodMenu [data-date="2026-09-10"]').click();
  assert.equal(d.querySelector("#periodMenu").hidden, false);
  d.querySelector('#periodMenu [data-date="2026-09-15"]').click();
  assert.equal(d.querySelector("#periodMenu").hidden, false);
  d.querySelector("#periodMenu .cal-apply").click();
  assert.equal(new URL(w.location.href).searchParams.get("to"), "2026-09-15");
  w.close();
});

test("video feedback: today comparison, direct metric chooser, channel columns and descriptions", async () => {
  const w = await boot("?from=2026-09-30&to=2026-09-30&compare=previous"),
    d = w.document;
  assert.match(d.querySelector(".subtitle").textContent, /vs\. 29 sep/);
  assert.match(
    d.querySelector("[data-metric=revenue] .delta").textContent,
    /Vorige periode/,
  );
  assert(!d.querySelector("[data-flow]"));
  assert.equal(d.querySelector("#compareMetric"), null);
  d.querySelector("[data-metric=cost]").click();
  assert.equal(d.querySelector(".replacement"),null);
  assert(d.querySelector("[data-metric=cost]").classList.contains("active"));
  assert.match(
    d.querySelector("#marketingMix").textContent,
    /Waarvan non-branded/,
  );
  d.querySelector("[data-channel=google]").click();
  assert.equal(d.querySelector(".kpi").dataset.metric, "revenue");
  const heads = [...d.querySelectorAll("#detail th")].map((n) => n.textContent);
  assert.match(heads[1], /waarde/);
  assert.match(heads[2], /Uitgaven/);
  assert(d.querySelector("#detail .row-description"));
});

test("channel table totals never add overlapping attributed revenue", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29&metrics=spend"),
    d = w.document;
  const footer = [...d.querySelectorAll("#detail tfoot td")].map(
    (c) => c.textContent,
  );
  assert.equal(footer[1], "—");
  assert.match(footer[2], /€/);
});

test("Google campaign table uses current enabled status, including active campaigns with zero spend", async () => {
  const query = "?channel=google&googleScope=all&from=2026-09-23&to=2026-09-29";
  const normal = await boot(query);
  const w = await boot(query, "", (url, data) => {
    if (!url.includes("google.json")) return data;
    return {
      ...data,
      campaigns: [
        { id: "23981395562", name: "Active search", status: "ENABLED" },
        { id: "23985056312", name: "Paused PMAX", status: "PAUSED" },
        { id: "23981332205", name: "Removed brand", status: "REMOVED" },
        { id: "new-zero", name: "Active without spend", status: "ENABLED" },
      ],
    };
  });
  const body = w.document.querySelector("#detail tbody").textContent;
  assert.match(body, /Active search/);
  assert.match(body, /Active without spend/);
  assert.doesNotMatch(body, /Paused PMAX|Removed brand/);
  assert.equal(w.document.querySelectorAll("#detail tbody tr").length, 2);
  assert.equal(
    w.document.querySelector(".kpis").textContent,
    normal.document.querySelector(".kpis").textContent,
  );
});

test("cost story keeps VAT and margin bases explicit and preserves calculation order", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29&metrics=cost"),
    d = w.document;
  assert.match(
    d.querySelector(".vat-bridge").textContent,
    /17,36% van klantomzet/,
  );
  assert.match(
    d.querySelector(".vat-bridge").textContent,
    /Nieuwe basis: 100%/,
  );
  const rows = [...d.querySelectorAll("#table tbody tr")];
  assert.equal(rows.length, 9);
  assert.match(rows[0].textContent, /Omzet excl. btw100%/);
  assert.match(rows[2].textContent, /Marge na product en levering/);
  assert.match(rows[8].textContent, /Nettowinst · voorlopig/);
  assert.equal(d.querySelectorAll("#table [data-sort]").length, 0);
  assert(d.querySelector("#detail .pager").hidden);
  d.querySelector("[data-detail*=products]").click();
  d.querySelector("[data-detail]").click();
  assert.match(d.querySelector("#table").textContent, /Betaalkosten \(2%\)/);
  assert.match(
    d.querySelector("#table").textContent,
    /Marge vóór marketing en overhead/,
  );
  assert.doesNotMatch(d.querySelector("#detail").textContent, /Fees geraamd/);
});

test("footer reports actual source timestamps, order validation and cadence", async () => {
 const w=await boot("?from=2026-09-23&to=2026-09-29"),d=w.document;
 const footer=d.querySelector("#updateSummary");
 assert.equal(footer.querySelectorAll(".update-source").length,4);
 assert.match(footer.textContent,/Elke 15 minuten/);
 assert.match(footer.textContent,/Elk uur/);
 assert.match(footer.textContent,/Orders gecontroleerd:/);
 assert(footer.querySelector("#refreshData"));
 const failed=await boot("?from=2026-09-23&to=2026-09-29","google.json");
 assert.match(failed.document.querySelectorAll(".update-source")[1].textContent,/Niet beschikbaar/);
 assert(failed.document.querySelectorAll(".update-source")[1].querySelector(".warning"));
});

test("Shopify status explains validation and opens the matching order list", async () => {
 const w=await boot("?from=2026-09-23&to=2026-09-29"),d=w.document;
 assert.match(d.querySelector("#status").textContent,/Ordergegevens gecontroleerd/);
 assert.match(d.querySelector("#status").textContent,/98 orders/);
 assert.doesNotMatch(d.querySelector("#status").textContent,/Controle nog nodig/);
 d.querySelector("#viewShopifyOrders").click();
 assert.match(d.querySelector("#detail h3").textContent,/Alle orders/);
 const bad=await boot("", "",(url,data)=>url.includes("shopify.json") ? {...data,orders:[...data.orders,data.orders[0]]} : data);
 assert.match(bad.document.querySelector("#status").textContent,/Niet beschikbaar/);
 assert.equal(bad.document.querySelector("#viewShopifyOrders"),null);
});

test("channel revenue bar totals attributed revenue, excludes branded Google and opens channel", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29"), d = w.document;
  const segments = [...d.querySelectorAll(".revenue-bar > button")];
  assert.equal(segments.length, 3);
  assert(Math.abs(segments.reduce((n,s)=>n+parseFloat(s.style.flexGrow),0)-1)<0.001);
  assert(d.querySelector('.revenue-legend [data-channel=google]').getAttribute('aria-label').includes('non-branded'));
  assert.equal(d.querySelector('.mix-tooltip'),null);
  assert(d.querySelector('.revenue-legend b').textContent.includes('%'));
  const googleAmount = d.querySelector('.revenue-legend [data-channel=google] small').textContent;
  d.querySelector('.revenue-legend [data-channel=google]').click();
  assert.equal(d.querySelector('.kpi[data-metric=revenue] strong').textContent,googleAmount);
  assert.equal(d.querySelector('.channel-revenue'),null);
  w.close();
});

test("missing source suppresses revenue distribution and healthy status tick", async () => {
  const w = await boot("?from=2026-09-23&to=2026-09-29", "google.json"), d = w.document;
  assert.equal(d.querySelectorAll('.revenue-bar > button').length,0);
  assert(d.querySelector('.channel-revenue').textContent.includes('Verdeling niet beschikbaar'));
  assert(!d.querySelector('#statusButton').classList.contains('status-ok'));
  assert(d.querySelector('#statusButton').getAttribute('aria-label').includes('aandacht nodig'));
  w.close();
});

test('selected period shows totals without daily chips and follows channel metrics', async () => {
  const w=await boot('?from=2026-09-23&to=2026-09-29'),d=w.document;
  assert.equal(d.querySelector("#dayComparison").hidden,true);
  d.querySelector("#rangeStart").value="2026-09-23";
  d.querySelector("#rangeEnd").value="2026-09-25";
  d.querySelector("#applyChartRange").click();
  assert.equal(d.querySelector("#dayComparison").hidden,false);
  assert.equal(d.querySelectorAll('[data-selection-metric]').length,2);
  assert.equal(d.querySelector('[data-select-day]'),null);
  assert.equal(d.querySelector('#dayComparison table'),null);
  assert(d.querySelector('#dayComparison .subtitle').textContent.includes('23 sep – 25 sep'));
  const selectedOrders=JSON.parse(fs.readFileSync(new URL("data/shopify.json",root))).orders.filter(o=>!o.test && o.d>="2026-09-23" && o.d<="2026-09-25");
  const expected=selectedOrders.reduce((n,o)=>n+o.incl,0)/1.21;
  const displayed=Number(d.querySelector("[data-selection-metric=revenue]").textContent.replace(/[^0-9]/g,""));
  assert.equal(displayed,Math.round(expected));
  d.querySelector('#tab-google').click();
  assert.equal(d.querySelectorAll('[data-selection-metric]').length,2);
  d.querySelector('#clearDays').click();
  assert.equal(d.querySelector('.selection-totals'),null);
  assert.equal(d.querySelector("#dayComparison").hidden,true);
  w.close();
});

test('acquisition comparison uses a common store benchmark and channel CPA is selectable', async () => {
 const w=await boot('?from=2026-09-23&to=2026-09-29'),d=w.document;
 assert.equal(d.querySelector('#compareMetric'),null);
 const limits=[...d.querySelectorAll('#acquisitionCompare tbody tr')].map(r=>r.children[3].textContent);
 assert.equal(limits.length,3); assert.equal(new Set(limits).size,1);
 assert(!limits.includes('—'));
 d.querySelector('#tab-google').click();
 assert(d.querySelector('[data-metric=cpa] strong').textContent.includes('€'));
 d.querySelector('[data-metric=cpa]').click();

 assert(d.querySelector('#analysis h2').textContent.includes('Kosten per aankoop'));
 w.close();
});

test('drag selection supports reverse ranges and metric toggles match Meta', async()=>{
 const w=await boot('?from=2026-09-23&to=2026-09-29'),d=w.document;
 const svg=d.querySelector('#chart svg');
 svg.getBoundingClientRect=()=>({left:0,width:960});
 svg.onpointerdown({button:0,clientX:72+4.5*868/7,pointerId:1});
 svg.onpointerup({clientX:72+2.5*868/7});
 assert.equal(d.querySelectorAll('[data-selection-metric]').length,2);
 assert(d.querySelector('#dayComparison .subtitle').textContent.includes('25 sep'));
 assert.equal(d.querySelector('.day-options'),null);
 d.querySelector('[data-metric=result]').click();
 assert.equal(d.querySelector('.replacement'),null);
 assert(!d.querySelector('[data-metric=revenue]').classList.contains('active'));
 d.querySelector('[data-metric=spend]').click();
 d.querySelector('[data-metric=result]').click();
 assert.equal(d.querySelectorAll('.kpi.active').length,0);
 assert(d.querySelector('#chart').textContent.includes('Klik bovenaan'));
 assert(d.querySelector('#status #updateSummary'));
 assert(!d.querySelector('main ~ #updateSummary'));
 w.close();
});

test('Meta profit and Daan switch are visible, selectable and persist in URL',async()=>{
 const w=await boot('?channel=meta&from=2026-09-01&to=2026-09-29&metrics=result');
 const d=w.document;
 assert.match(d.querySelector('[data-metric="result"]').textContent,/Nettowinst/);
 const withCost=d.querySelector('[data-metric="spend"] strong').textContent;
 d.querySelector('[data-daan="without"]').click();
 assert.equal(d.querySelector('[data-daan="without"]').getAttribute('aria-pressed'),'true');
 assert.equal(new URL(w.location.href).searchParams.get('daan'),'without');
 assert.notEqual(d.querySelector('[data-metric="spend"] strong').textContent,withCost);
 assert.match(d.querySelector('[data-metric="result"]').textContent,/% van omzet excl. btw/);
 d.querySelector('[data-daan="with"]').click();
 assert.equal(d.querySelector('[data-metric="spend"] strong').textContent,withCost);
 w.close();
});
test('compact Daan switch also updates overview and survives switching channels',async()=>{
 const w=await boot('?from=2026-09-01&to=2026-09-29');const d=w.document;
 const before=d.querySelector('[data-metric="result"] strong').textContent;
 d.querySelector('[data-daan="without"]').click();
 assert.notEqual(d.querySelector('[data-metric="result"] strong').textContent,before);
 assert.match(d.querySelector('.management-total').textContent,/Uitgesloten/);
 d.querySelector('#tab-meta').click();
 assert.equal(d.querySelector('[data-daan="without"]').getAttribute('aria-pressed'),'true');
 d.querySelector('#tab-all').click();
 d.querySelector('[data-daan="with"]').click();
 assert.equal(d.querySelector('[data-metric="result"] strong').textContent,before);
 d.querySelector('[data-daan-details]').click();
 assert.equal(d.querySelector('.management').open,true);w.close();
});

test('analysis collapses and salary breakdown is grouped; every channel exposes margin',async()=>{
 const w=await boot('?from=2026-09-23&to=2026-09-29&metrics=cost'),d=w.document;
 const salary=d.querySelector('.salary-breakdown');
 assert(salary);assert.equal(salary.open,false);
 assert.match(salary.closest('tr').textContent,/Meta salaris/);
 salary.querySelector('summary').click();assert.equal(salary.open,true);
 d.querySelector('#collapseAnalysis').click();assert.equal(d.querySelector('#analysisBody').hidden,true);
 d.querySelector('#collapseAnalysis').click();assert.equal(d.querySelector('#analysisBody').hidden,false);
 assert.match(d.querySelector('#marketingMix thead').textContent,/Winstmarge/);
 for(const channel of ['meta','google','infl']){
  d.querySelector('#tab-'+channel).click();
  assert.match(d.querySelector('[data-metric=result]').textContent,/% van omzet excl. btw/);
 }
 w.close();
});

test("channel profit margin is selectable, charted and responds to Daan costs", async () => {
 const w=await boot('?channel=meta&from=2026-09-23&to=2026-09-29&metrics=profitMargin');
 const d=w.document;
 const value=()=>d.querySelector('[data-metric=profitMargin] strong').textContent;
 const before=value();
 assert.match(before,/%/);
 assert.match(d.querySelector('#chart').textContent,/Nettowinstpercentage/);
 assert.match(d.querySelector('[data-metric=profitMargin] .delta').textContent,/procentpunt/);
 d.querySelector('[data-daan=without]').click();
 assert.notEqual(value(),before);
 for(const channel of ['google','infl']) {
  d.querySelector('#tab-'+channel).click();
  assert(d.querySelector('[data-metric=result]').classList.contains('active'));
  assert(d.querySelector('[data-metric=profitMargin]').classList.contains('active'));
  assert.match(d.querySelector('#chart').textContent,/Nettowinstpercentage/);
 }
 w.close();
});

test("overview offers net profit percentage with period comparison and chart",async()=>{
 const w=await boot('?from=2026-09-23&to=2026-09-29&metrics=profitMargin');
 const d=w.document,card=d.querySelector('[data-metric=profitMargin]');
 assert.match(card.textContent,/Nettowinstpercentage/);
 assert.match(card.querySelector('strong').textContent,/%/);
 assert.match(card.querySelector('.delta').textContent,/procentpunt/);
 assert.match(d.querySelector('#chart').textContent,/Nettowinstpercentage/);
 assert.equal(d.querySelector('[data-metric=result] .label').textContent,'Nettowinst');
 w.close();
});
