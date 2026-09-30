import test from "node:test";
import assert from "node:assert/strict";
import { mapOrder } from "../cloudflare-worker/src/index.js";
test("order timestamp preserves actual instant and Amsterdam calendar date", () => {
 const o=mapOrder({name:"#1",created_at:"2026-09-30T23:30:00Z",line_items:[{title:"LumeWorks Prime",quantity:1}],total_price:"149"});
 assert.equal(o.d,"2026-10-01"); assert.equal(o.created_at,"2026-09-30T23:30:00.000Z");
 assert.equal(mapOrder({name:"#2",created_at:"bad",line_items:[]}),null);
});
