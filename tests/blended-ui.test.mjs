import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
const root = new URL("../", import.meta.url);
async function boot(query = "", failSource = "") {
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
      json: async () => JSON.parse(fs.readFileSync(new URL(url, root), "utf8")),
    };
  };
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const scripts = ["metrics.js", "data.js", "app.js"]
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
  const w = await boot("?from=2026-09-23&to=2026-09-29"),
    d = w.document;
  const click = (s) => {
    assert(d.querySelector(s), s);
    d.querySelector(s).click();
  };
  assert.equal(d.querySelectorAll(".kpi").length, 5);
  click("[data-metric=cost]");
  assert(d.querySelector("#detail").textContent.includes("Kostenopbouw"));
  click("[data-detail]");
  assert(
    d.querySelector("#detail").textContent.includes("Producten en kostprijzen"),
  );
  click("[data-detail]");
  assert(d.querySelector("#detail").textContent.includes("Volledige orders"));
  click("#detailBack");
  click("[data-metric=revenue]");
  click("#compareMetric");
  click("[data-metric=spend]");
  assert.equal(d.querySelectorAll(".kpi.active").length, 2);
  click("[data-metric=result]");
  assert(d.querySelector(".replacement"));
  click("[data-replace=revenue]");
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
  click("[data-detail*=products]");
  assert(
    d.querySelector("#detail").textContent.includes("Producten en kostprijzen"),
  );
  click("[data-metric=spend]");
  const totals = [...d.querySelectorAll("#table tfoot td")].map(
    (x) => x.textContent,
  );
  assert.equal(totals[2], "—");
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
