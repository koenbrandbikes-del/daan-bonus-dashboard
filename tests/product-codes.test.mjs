import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mapOrder} from '../cloudflare-worker/src/index.js';
import {itemCost, finance} from '../assets/blended/metrics.js';
import {checkShopifyOrders} from '../assets/blended/data.js';
const C=JSON.parse(fs.readFileSync(new URL('../assets/blended/costs.json',import.meta.url)));
const input={name:'#test',created_at:'2026-10-01T10:00:00Z',total_price:'300',line_items:[
 {title:'Compleet nieuwe productnaam',quantity:2,sku:'8721008982625',variant_id:57300256096582},
 {title:'Ook hernoemd',quantity:1,sku:'8721008982632',variant_id:56819086524742}
]};
test('webhook preserves stable identifiers per unit; renamed products keep their cost',()=>{
 const o=mapOrder(input);
 assert.equal(o.items.length,3);
 assert.equal(o.item_refs.length,3);
 assert.equal(o.item_refs[1].sku,'8721008982625');
 assert.equal(o.item_refs[2].variant_id,'56819086524742');
 checkShopifyOrders([o]);
 assert.equal(finance([o],C).fixed,2*44.5+4.95);
});
test('EAN, SKU and variant each work independently of name; known identifier beats misleading name',()=>{
 assert.equal(itemCost('Anything',C,{barcode:'8721008982625'}),44.5);
 assert.equal(itemCost('LumeWorks Titan',C,{sku:'8721008982625'}),44.5);
 assert.equal(itemCost('Anything',C,{variant_id:'gid://shopify/ProductVariant/57300256096582'}),44.5);
 assert.equal(itemCost('Anything',C,{variant_id:'56657929077062'}),44.5);
 assert.equal(itemCost('LumeWorks Prime',C,{sku:'NEW-UNKNOWN'}),null);
 assert.equal(itemCost('LumeWorks Prime',C,{sku:'8721008982625',variant_id:'56742735642950'}),null);
});
test('historical name-only orders retain exact and explicitly aliased costs',()=>{
 assert.equal(itemCost('LumeWorks Prime',C),44.5);
 assert.equal(itemCost('LumeWorks Prime | Van gewone avond naar datenight.',C),44.5);
 assert.equal(itemCost('Some unknown Prime',C),null);
 assert.throws(()=>checkShopifyOrders([{...mapOrder(input),item_refs:[{}]}]),/productcodes/);
});
test('all classic dashboards use the same code-based costs',()=>{
 for(const page of ['index.html','meta.html','creators.html']) {
  const html=fs.readFileSync(new URL('../'+page,import.meta.url),'utf8');
  const ctx={LumeProductCosts:globalThis.LumeProductCosts,ITEM_FIXED:C.items,BTW:1.21,SHOPIFY_FEE:0.02,OVERHEAD_FEE:0.04,prodLabel:x=>x};
  vm.createContext(ctx);
  vm.runInContext(html.match(/function calcOrder\(o\)\{[\s\S]*?\n\}/)[0],ctx);
  assert.equal(ctx.calcOrder(mapOrder(input)).cost,2*44.5+4.95+300*.02+(300/1.21)*.04,page);
  assert.match(html,/<script src="assets\/product-costs.js/);
 }
});
