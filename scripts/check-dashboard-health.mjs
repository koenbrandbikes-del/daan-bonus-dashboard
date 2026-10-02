import fs from 'node:fs';
import {fetchJSON,validateSource,validateCosts,validateReturns} from '../assets/blended/data.js';
const base=process.env.DASHBOARD_URL || 'https://koenbrandbikes-del.github.io/daan-bonus-dashboard/';
const sample={checked_at:new Date().toISOString(),url:base,checks:[]};
async function check(name,task){const start=Date.now();try{await task();sample.checks.push({name,ok:true,duration_ms:Date.now()-start});}catch(e){sample.checks.push({name,ok:false,duration_ms:Date.now()-start,error:e.message});}}
const get=path=>fetchJSON(new URL(path+'?health='+Date.now(),base).href);
await Promise.all([
 ...['meta','google','shopify','creators'].map(key=>check(key,async()=>{
  const d=validateSource(key,await get('data/'+key+'.json'));
  let age;
  if(key==='meta'){
   const wall=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()).replace(' ','T');
   age=(Date.parse(wall+'Z')-Date.parse(d.snap+'T'+d.snap_time+':00Z'))/60000;
  }else if(d.synced_at) age=(Date.now()-Date.parse(d.synced_at))/60000;
  if(age!=null && (age < -5 || age > (key==='creators'?180:45))) throw Error(`Bron ${Math.round(age)} minuten oud`);
 })),
 check('returns',async()=>{const d=validateReturns(await get('data/returns.json'));if(Date.now()-Date.parse(d.synced_at)>48*3600e3)throw Error('Retourcontrole meer dan 48 uur oud');}),
 check('costs',async()=>validateCosts(await get('assets/blended/costs.json'))),
 check('sync-status',async()=>{
  const s=await get('data/status.json');
  for(const k of ['meta','google','shopify']) if(s[k]?.status!=='ok'||!Number.isFinite(Date.parse(s[k]?.last_success))) throw Error(k+': synchronisatie niet bevestigd');
 }),
 check('page-and-assets',async()=>{
  const text=async path=>{const r=await fetch(new URL(path,base),{signal:AbortSignal.timeout(8000),cache:'no-cache'});if(!r.ok)throw Error(path+': HTTP '+r.status);return r.text();};
  const html=await text('blended.html');
  if(!html.includes('<title>LumeWorks</title>')) throw Error('Onverwachte pagina');
  const paths=[...html.matchAll(/(?:src|href)="(assets\/[^" ]+)"/g)].map(m=>m[1]);
  if(!paths.length)throw Error('Pagina-assets ontbreken');
  await Promise.all(paths.map(async path=>{if(!(await text(path)).trim())throw Error('Leeg bestand: '+path);}));
 }),
]);
sample.ok=sample.checks.every(c=>c.ok);
fs.writeFileSync('dashboard-health.json',JSON.stringify(sample,null,2)+'\n');
for(const c of sample.checks) console.log(`${c.ok?'OK':'FAIL'} ${c.name}${c.error?': '+c.error:''}`);
if(!sample.ok)process.exitCode=1;
