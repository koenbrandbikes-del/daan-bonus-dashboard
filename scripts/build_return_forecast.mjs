// Private register arrives over stdin. Only aggregate financial output leaves this process.
import fs from 'node:fs';import {finance,reconciledOrder} from '../assets/blended/metrics.js';import {returnReserve} from '../assets/blended/return-reserve.js';
const source=JSON.parse(fs.readFileSync(0,'utf8')),read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const shopify=read('data/shopify.json'),creators=read('data/creators.json'),costs=read('assets/blended/costs.json');
const seen=new Set(source.orders.map(o=>o.num));costs.returns={...costs.returns,orders:[...costs.returns.orders.filter(o=>!seen.has(o.num)),...source.corrections]};
const data={shopify,returns:source},model=returnReserve(data,costs,'2026-08-05','9999-12-31');
const creatorNums=new Set(creators.orders.map(o=>o.num));
const fields=['incl','excl','fixed','knownFixed','fees','cost','returnCost','refundedIncl','refundedOrders','receivedReturnPackages','receivedReturns','unknownReturns','overhead','unknown','orders','purchase','inbound_shipping','fulfillment','source_adjustment','unallocated'];
const pick=f=>Object.fromEntries(fields.map(k=>[k,f[k]]));
const empty=()=>({impact:0,packages:0,refundExcl:0,handling:0,overheadCredit:0});
const audit=new Map(source.orders.map(o=>[o.num,o]));
const rows=shopify.orders.filter(o=>!o.test && o.d>='2026-08-05').map(o=>({...o,incl:audit.get(o.num)?.paid_incl??o.incl}));
const daily=[...new Set(rows.map(o=>o.d))].sort().map(d=>{
 const selected=rows.filter(o=>o.d===d).map(o=>reconciledOrder(o,costs));
 const gross=selected.map(o=>({...o,incl:o.paid_incl??o.incl,refunded_incl:0,return_kind:undefined,return_cost:0,return_packages:0}));
 const reserve=model.rows.filter(o=>o.d===d),parts=(arr)=>arr.reduce((n,r)=>{for(const k of Object.keys(n))n[k]+=r[k];return n;},empty());
 return {d,gross:pick(finance(gross,{...costs,returns:null})),actual:pick(finance(selected,costs)),creatorGross:pick(finance(gross.filter(o=>creatorNums.has(o.num)),{...costs,returns:null})),creatorActual:pick(finance(selected.filter(o=>creatorNums.has(o.num)),costs)),reserve:{all:parts(reserve),creator:parts(reserve.filter(o=>creatorNums.has(o.num)))}};
});
const {rows:privateRows,...metadata}=model;
const safe={version:2,complete:true,synced_at:source.synced_at,coverage_from:source.coverage_from,date_basis:'refund_processing_proxy',cost_basis:JSON.stringify([costs.items,costs.assumed_vat,costs.payment_rate,costs.overhead_rate]),model:metadata,daily};
process.stdout.write(JSON.stringify(safe,null,2)+'\n');
