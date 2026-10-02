import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  googleScopeData,
  googleCampaignGroups,
} from "../assets/blended/metrics.js";
test("campaign groups include full PMAX and reconcile to account totals", () => {
  const google = JSON.parse(
    fs.readFileSync(new URL("../data/google.json", import.meta.url)),
  );
  assert(google.daily_campaigns.every((r) => googleCampaignGroups[r.id]));
  const brand = googleScopeData({ google }, "brand").google,
    nonbrand = googleScopeData({ google }, "nonbrand").google;
  // Separate account/campaign requests are not one intraday transaction.
  // Keep strict reconciliation on days before the snapshot's Amsterdam day.
  const snapshotDay=google.coverage_to;
  assert(nonbrand.daily_campaigns.some((r) => r.name === "P | Generiek"));
  assert(
    brand.daily_campaigns.every((r) =>
      ["23981332205", "23989624267"].includes(r.id),
    ),
  );
  for (let i = 0; i < google.daily_google.length; i++)
    if(google.daily_google[i].d<snapshotDay)
    for (const k of ["spend", "rev", "conv"])
      assert(
        Math.abs(
          brand.daily_google[i][k] +
            nonbrand.daily_google[i][k] -
            google.daily_google[i][k],
        ) < 0.02,
        `${google.daily_google[i].d} ${k}`,
      );
});
test("missing campaign data stays unknown and new campaigns are not guessed", () => {
  assert.equal(
    googleScopeData({ google: { daily_google: [] } }, "nonbrand").google,
    null,
  );
  const google = {
    daily_google: [{ d: "2026-09-01", spend: 5, rev: 10, conv: 1 }],
    daily_campaigns: [
      { d: "2026-09-01", id: "new", spend: 5, rev: 10, conv: 1 },
    ],
  };
  assert.equal(
    googleScopeData({ google }, "nonbrand").google.daily_google[0].spend,
    0,
  );
  assert.equal(
    googleScopeData({ google }, "unknown").google.daily_google[0].spend,
    5,
  );
});
