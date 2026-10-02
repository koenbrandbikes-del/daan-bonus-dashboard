/** Authenticated private storage; no browser credentials or public financial URLs. */
export function privateStorageEnabled(env) {
  if(Boolean(env.LW_STORAGE_ORIGIN)!==Boolean(env.LW_STORAGE_SECRET))throw Error('Incomplete private storage configuration');
  return Boolean(env.LW_STORAGE_ORIGIN);
}
export async function privateRequest(env,path,method='GET',payload) {
  if(!privateStorageEnabled(env))throw Error('Private storage not configured');
  if(!/^(data\/(meta|google|shopify|creators|returns|status)\.json|assets\/blended\/costs\.json)$/.test(path))throw Error('Dataset not allowed');
  const origin=new URL(env.LW_STORAGE_ORIGIN);
  if(origin.protocol!=='https:' || origin.username || origin.password || origin.search || origin.hash)throw Error('Invalid private storage origin');
  const url=new URL(origin.toString().replace(/\/$/,'')+'/api/storage/'+path);
  const body=payload===undefined?'':JSON.stringify(payload);
  const bytes=new TextEncoder();
  const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
  const timestamp=String(Math.floor(Date.now()/1000));
  const nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
  const digest=hex(await crypto.subtle.digest('SHA-256',bytes.encode(body)));
  const key=await crypto.subtle.importKey('raw',bytes.encode(env.LW_STORAGE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=hex(await crypto.subtle.sign('HMAC',key,bytes.encode([timestamp,nonce,method,url.pathname,digest].join('\n'))));
  return fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-LW-Timestamp':timestamp,'X-LW-Nonce':nonce,'X-LW-Signature':signature},...(method==='GET'?{}:{body})});
}
export async function privateGet(env,path) {
  const r=await privateRequest(env,path);
  if(r.status===404)return null;
  if(!r.ok)throw Error('Private storage read HTTP '+r.status);
  const d=await r.json();if(typeof d.content!=='string'||typeof d.sha!=='string')throw Error('Invalid private storage response');
  return d;
}
export async function privatePut(env,path,content,sha) {
  const r=await privateRequest(env,path,'PUT',{content,sha:sha??null});
  return {ok:r.ok,status:r.status,text:r.ok?null:'Private storage write failed'};
}
