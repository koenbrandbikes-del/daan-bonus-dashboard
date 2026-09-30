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
  return {source:"google_ads_api",customer_id:CUSTOMER,currency:"EUR",time_zone:"Europe/Amsterdam",synced_at:now.toISOString(),coverage_from:START,coverage_to:today,attribution:"Primary conversions and conversion value by ad interaction date; may include non-purchase goals and overlap with other channels.",daily_google:daily,vandaag:period(today),gisteren:period(shift(today,-1))};
}
