import test from "node:test";
import assert from "node:assert/strict";
import { googleScopeData } from "../assets/blended/metrics.js";
test("brand split reconciles while keeping hidden inventory separate", () => {
  const data = {
    google: {
      daily_google: [{ d: "2026-09-01", spend: 100, rev: 1000, conv: 10 }],
      daily_intent: [
        { d: "2026-09-01", intent: "brand", spend: 20, rev: 600, conv: 6 },
        { d: "2026-09-01", intent: "other", spend: 50, rev: 300, conv: 3 },
      ],
    },
  };
  const b = googleScopeData(data, "brand").google.daily_google[0],
    n = googleScopeData(data, "nonbrand").google.daily_google[0],
    u = googleScopeData(data, "unknown").google.daily_google[0];
  assert.equal(n.spend, 50);
  assert.equal(n.rev, 300);
  assert.equal(u.spend, 30);
  for (const k of ["spend", "rev", "conv"])
    assert.equal(b[k] + n[k] + u[k], data.google.daily_google[0][k]);
  assert.equal(googleScopeData(data, "all"), data);
  assert.equal(
    googleScopeData({ google: { daily_google: [] } }, "nonbrand").google,
    null,
  );
});
