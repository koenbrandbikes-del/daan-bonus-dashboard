import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifySearchTerm } from "../cloudflare-worker/src/googleAds.js";
test("brand classification leaves all other terms unclassified", () => {
  for (const s of ["LumeWorks", "lume works beamer", "LUMEWORKS PRIME"])
    assert.equal(classifySearchTerm(s), "brand");
  for (const s of ["beamer slaapkamer", "prime", "concurrent"])
    assert.equal(classifySearchTerm(s), "other");
});
test("live campaign detail totals reconcile to daily account totals", () => {
  const d = JSON.parse(
    fs.readFileSync(new URL("../data/google.json", import.meta.url)),
  );
  assert(d.daily_campaigns.length);
  for (const day of d.daily_google) {
    const rows = d.daily_campaigns.filter((r) => r.d === day.d);
    for (const k of ["spend", "rev", "conv"])
      assert.ok(
        Math.abs(rows.reduce((s, r) => s + r[k], 0) - day[k]) < 0.011,
        `${day.d} ${k}`,
      );
  }
});
