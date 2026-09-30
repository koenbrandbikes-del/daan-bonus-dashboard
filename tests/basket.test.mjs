import test from "node:test";
import assert from "node:assert/strict";
import { basketMetrics } from "../assets/blended/metrics.js";
test("meeverkoop counts orders once, separates bundles and excludes unrelated or test orders", () => {
  const orders = [
    {
      items: [
        "LumeWorks Prime",
        "Prime travelcase",
        "Prime travelcase",
        "Schoonmaak kit",
      ],
      incl: 200,
    },
    { items: ["LumeWorks Prime"], incl: 150 },
    { items: ["Prime travelcase"], incl: 20 },
    { items: ["De complete Prime setup"], incl: 300 },
    { items: ["LumeWorks Titan", "Unknown product"], incl: 350 },
    { items: ["LumeWorks Prime", "Mini stand"], incl: 190, test: true },
  ];
  const b = basketMetrics(orders);
  assert.equal(b.base.length, 3);
  assert.equal(b.withExtra.length, 1);
  assert.equal(b.rate, 1 / 3);
  assert.equal(b.bundleOrders.length, 1);
  assert.equal(b.avgWith, 200);
  assert.equal(b.avgWithout, 250);
  assert.equal(b.byModel[0].rate, 0.5);
  assert.equal(basketMetrics([]).rate, null);
  assert.equal(basketMetrics([]).avgWith, null);
});
