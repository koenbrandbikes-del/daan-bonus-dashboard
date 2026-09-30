import test from "node:test";
import assert from "node:assert/strict";
import {
  compute,
  series,
  finance,
  previous,
} from "../assets/blended/metrics.js";
const C = {
  items: { Prime: 40 },
  assumed_vat: 0.21,
  payment_rate: 0.02,
  overhead_rate: 0.04,
};
const D = {
  shopify: {
    orders: [
      { d: "2026-09-01", num: "#1", incl: 121, items: ["Prime"] },
      { d: "2026-09-02", num: "#2", incl: 242, items: ["Prime", "Prime"] },
    ],
  },
  meta: {
    daily_meta: [
      { d: "2026-09-01", spend: 10, rev7: 50, rev1v: 10, purch: 1 },
      { d: "2026-09-02", spend: 90, rev7: 120, rev1v: 0, purch: 2 },
    ],
  },
  google: { daily_google: [{ d: "2026-09-01", spend: 5, rev: 30, conv: 0.5 }] },
  creators: {
    orders: [{ d: "2026-09-01", num: "#1", commissie: 12, omzet_excl: 100 }],
  },
};
test("financial waterfall includes overhead and counts quantities", () => {
  const v = compute(D, C, "2026-09-01", "2026-09-02");
  assert.equal(v.revenue, 300);
  assert.equal(v.fixed, 120);
  assert.equal(v.fees, 7.26);
  assert.equal(v.spend, 117);
  assert.ok(Math.abs(v.result - 43.74) < 1e-8);
  assert.equal(v.overhead, 12);
  assert.equal(v.roas, 363 / 117);
});
test("channel selection uses attributed numerator and estimated store margin", () => {
  const m = compute(D, C, "2026-09-01", "2026-09-02", "meta");
  assert.equal(m.revenue, 180);
  assert.equal(m.roas, 1.8);
  assert.equal(m.result, m.revenue * ((m.excl-m.cost-m.overhead)/m.incl) - m.spend);
  const g = compute(D, C, "2026-09-01", "2026-09-02", "google");
  assert.equal(g.count, 0.5);
  assert.equal(g.roas, 6);
});
test("weighted weekly ROAS not average of days", () => {
  const s = series(D, C, "2026-09-01", "2026-09-02", "meta", "week");
  assert.equal(s.length, 1);
  assert.equal(s[0].roas, 1.8);
});
test("unknown costs block final result", () => {
  const f = finance([{ items: ["unknown"], incl: 121 }], C);
  assert.equal(f.cost, null);
  assert.equal(f.unknown, 1);
});
test("missing sources are not zero", () => {
  const v = compute({ ...D, google: null }, C, "2026-09-01", "2026-09-02");
  assert.equal(v.spend, null);
  assert.equal(v.result, null);
  assert.equal(v.roas, null);
  const s = compute({ ...D, shopify: null }, C, "2026-09-01", "2026-09-02");
  assert.equal(s.cost, null);
  assert.equal(s.revenue, null);
});
test("zero spend produces no ratio; returned creator orders excluded", () => {
  const v = compute(D, C, "2026-10-01", "2026-10-02", "meta");
  assert.equal(v.roas, null);
  assert.equal(v.spend, 0);
  const d = {
    ...D,
    creators: { orders: [{ ...D.creators.orders[0], retour: true }] },
  };
  assert.equal(compute(d, C, "2026-09-01", "2026-09-02", "infl").spend, 0);
});
test("previous period spans equal days across year boundary", () =>
  assert.deepEqual(previous("2026-01-01", "2026-01-07"), {
    from: "2025-12-25",
    to: "2025-12-31",
  }));
