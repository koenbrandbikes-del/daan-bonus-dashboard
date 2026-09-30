import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorSummary} from '../assets/blended/creator-summary.js';
test('creator investment separates lifetime code results from unverified shipment costs',()=>{
 const html=creatorSummary({collaborations:{total:41,with_orders:20,without_orders:21}},{influencer_gifting:{product:'LumeWorks Prime',quantity:41},items:{'LumeWorks Prime':43.8,'LumeWorks Atlas':67.74,'LumeWorks Titan':110.85}});
 assert.match(html,/51%/);
 assert.match(html,/1\.795,80/);
 assert.match(html,/geraamde productinvestering/);
 assert.match(html,/onafhankelijk van de gekozen periode/);
 assert.equal(creatorSummary({collaborations:{total:41,with_orders:20,without_orders:22}},{}),'');
});
