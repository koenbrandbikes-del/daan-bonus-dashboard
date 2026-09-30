// Google Ads reporting: service-account JWT, no interactive login or refresh token.
const CUSTOMER = "7645288282";
const START = "2026-08-01";
const API = "v24";
const fields = ["spend", "conv", "rev", "impr", "cl"];
const round2 = n => Math.round(n * 100) / 100;
const shift = (s,n) => { const d=new Date(s+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
const encode = x => b64(new TextEncoder().encode(JSON.stringify(x)));

async function accessToken(credentials) {
  const account = JSON.parse(credentials);
  const now = Math.floor(Date.now()/1000);
  const jwt = encode({alg:"RS256",typ:"JWT"})+"."+encode({iss:account.client_email,scope:"https://www.googleapis.com/auth/adwords",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
  const pem = account.private_key.replace(/-----[^-]+-----/g,"").replace(/\s/g,"");
  const key = await crypto.subtle.importKey("pkcs8",Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(jwt));
  const r = await fetch("https://oauth2.googleapis.com/token",{method:"POST",signal:AbortSignal.timeout(30000),body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt+"."+b64(sig)})});
  if(!r.ok) throw new Error(`Google authentication HTTP ${r.status}`);
  const body=await r.json();
  if(!body.access_token) throw new Error("Google access token ontbreekt");
  return body.access_token;
}

export function parseGoogleRows(chunks, from, to) {
  if(!Array.isArray(chunks) || chunks.some(x=>x.error)) throw new Error("Ongeldig Google Ads-antwoord");
  const days=new Map();
  for(let d=from;d<=to;d=shift(d,1)) days.set(d,{d,spend:0,conv:0,rev:0,impr:0,cl:0});
  for(const row of chunks.flatMap(x=>x.results||[])) {
    if(row.customer?.id!==CUSTOMER || row.customer.currencyCode!=="EUR" || row.customer.timeZone!=="Europe/Amsterdam") throw new Error("Onverwacht Google Ads-account, valuta of tijdzone");
    const d=row.segments?.date, m=row.metrics;
    if(!days.has(d) || !m) throw new Error("Onverwachte Google Ads-datum of statistieken");
    const value={d,spend:Number(m.costMicros||0)/1e6,conv:Number(m.conversions||0),rev:Number(m.conversionsValue||0),impr:Number(m.impressions||0),cl:Number(m.clicks||0)};
    if(fields.some(k=>!Number.isFinite(value[k])) || value.spend<0 || value.impr<0 || value.cl<0) throw new Error("Ongeldige Google Ads-statistieken");
    days.set(d,value); // Account/day query returns one row per date; keep fractional conversions.
  }
  return [...days.values()];
}

export async function fetchGoogleData(credentials, existing={}, now=new Date()) {
  if(!credentials) throw new Error("GOOGLE_ADS_SERVICE_ACCOUNT secret ontbreekt");
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=t=>parts.find(p=>p.type===t).value;
  const today=`${part("year")}-${part("month")}-${part("day")}`;
  // Re-fetch 95 days for delayed conversions / attribution adjustments; retain older history.
  const from=existing.source==="google_ads_api" && existing.daily_google?.length ? [START,shift(today,-94)].sort().pop() : START;
  const token=await accessToken(credentials);
  const query=`SELECT customer.id, customer.currency_code, customer.time_zone, segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${from}' AND '${today}' ORDER BY segments.date`;
  const r=await fetch(`https://googleads.googleapis.com/${API}/customers/${CUSTOMER}/googleAds:searchStream`,{method:"POST",signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({query})});
  if(!r.ok) throw new Error(`Google Ads reporting HTTP ${r.status}`);
  // One customer row/day, at most 95 days after initial backfill; never campaign-sized data.
  const fresh=parseGoogleRows(await r.json(),from,today);
  const daily=[...(existing.source==="google_ads_api" ? (existing.daily_google||[]).filter(x=>x.d<from) : []),...fresh];
  const period=d=>({from:d,to:d,...(daily.find(x=>x.d===d)||{spend:0,conv:0,rev:0,impr:0,cl:0})});
  let details={};
  try {
    details=await fetchDetails(token,from,today,existing);
    details.details_synced_at=now.toISOString();
  } catch(e) {
    // Account totals remain current; keep the last successful detail dataset.
    details={campaigns:existing.campaigns||[],daily_campaigns:existing.daily_campaigns||[],daily_actions:existing.daily_actions||[],daily_intent:existing.daily_intent||[],details_synced_at:existing.details_synced_at||null,details_error:"Details tijdelijk niet beschikbaar"};
    console.error("Google detail sync failed",e.message);
  }
  return {...details,source:"google_ads_api",customer_id:CUSTOMER,currency:"EUR",time_zone:"Europe/Amsterdam",synced_at:now.toISOString(),coverage_from:START,coverage_to:today,attribution:"Primary conversions and conversion value by ad interaction date; may include non-purchase goals and overlap with other channels.",daily_google:daily,vandaag:period(today),gisteren:period(shift(today,-1))};
}

// Bounded reporting queries, with no customer identity or raw search terms persisted.
async function queryDetails(token,query){
  const r=await fetch(`https://googleads.googleapis.com/${API}/customers/${CUSTOMER}/googleAds:searchStream`,{method:"POST",signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({query})});
  if(!r.ok)throw new Error(`Google details HTTP ${r.status}`);
  const chunks=await r.json();
  if(!Array.isArray(chunks)||chunks.some(c=>c.error))throw new Error("Invalid detail response");
  const rows=chunks.flatMap(c=>c.results||[]);
  if(rows.length>=10000)throw new Error("Detail row limit reached; preserve previous complete data");
  return rows;
}
function values(row){
 const m=row.metrics||{};const v={d:row.segments?.date,spend:Number(m.costMicros||0)/1e6,rev:Number(m.conversionsValue||0),conv:Number(m.conversions||0)};
 if(!v.d||![v.spend,v.rev,v.conv].every(Number.isFinite))throw new Error("Invalid detail metrics");
 return v;
}
export function classifySearchTerm(term){return /lume\s*works/i.test(term)?"brand":"other";}
async function fetchDetails(token,from,to,existing){
 const where=`WHERE segments.date BETWEEN '${from}' AND '${to}'`;
 const currentCampaigns=await queryDetails(token,`SELECT campaign.id, campaign.name, campaign.status FROM campaign LIMIT 10000`);
 const campaigns=currentCampaigns.map(r=>({id:r.campaign.id,name:r.campaign.name,status:r.campaign.status}));
 const campaignRows=await queryDetails(token,`SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign ${where} LIMIT 10000`);
 const actionRows=await queryDetails(token,`SELECT segments.date, segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM customer ${where} LIMIT 10000`);
 const termRows=await queryDetails(token,`SELECT segments.date, search_term_view.search_term, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM search_term_view ${where} LIMIT 10000`);
 const daily_campaigns=campaignRows.map(r=>({...values(r),id:r.campaign.id,name:r.campaign.name,type:r.campaign.advertisingChannelType}));
 const daily_actions=actionRows.map(r=>({...values(r),name:r.segments.conversionActionName}));
 const intent=new Map();for(const r of termRows){const v=values(r),kind=classifySearchTerm(r.searchTermView?.searchTerm||""),key=v.d+kind;if(!intent.has(key))intent.set(key,{d:v.d,intent:kind,spend:0,rev:0,conv:0});const x=intent.get(key);x.spend+=v.spend;x.rev+=v.rev;x.conv+=v.conv;}
 const merge=(key,rows)=>[...(existing[key]||[]).filter(r=>r.d<from),...rows];
 return {campaigns,daily_campaigns:merge("daily_campaigns",daily_campaigns),daily_actions:merge("daily_actions",daily_actions),daily_intent:merge("daily_intent",[...intent.values()])};
}
