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

test('registered startup investment replaces Prime assumption and separates commissions',()=>{
 const startup={count:1,total:149.87,excluded:['Excluded'],rows:[{creator:'A < B',beamer:'Titan',accessory:'Scherm',extra_accessory:'Pro stand',beamer_cost:101.35,accessory_cost:28.31,extra_accessory_cost:10.81,shipping:9.4,total:149.87}]};
 const html=creatorSummary({startup_costs:startup,totals:{commissie:20},collaborations:{total:2,with_orders:1,without_orders:1}},{influencer_gifting:{source:'creators.startup_costs'}});
 assert.match(html,/149,87/);assert.match(html,/169,87/);assert.match(html,/A &lt; B/);assert.match(html,/Titan \+ Scherm \+ Pro stand/);assert.doesNotMatch(html,/Eén Prime per/);
});
