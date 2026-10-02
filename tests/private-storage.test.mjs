import test from 'node:test';
import assert from 'node:assert/strict';
import {privateStorageEnabled,privateGet,privatePut,privateRequest} from '../cloudflare-worker/src/private-storage.js';
import {webcrypto,createHmac,createHash} from 'node:crypto';
import worker from '../cloudflare-worker/src/index.js';
globalThis.crypto??=webcrypto;
const env={LW_STORAGE_ORIGIN:'https://www.lumeworks.nl/cijfers',LW_STORAGE_SECRET:'test-only-not-a-production-secret'};
test('private mode is explicit and partial configuration never falls back to public storage',()=>{
  assert.equal(privateStorageEnabled({}),false);assert.equal(privateStorageEnabled(env),true);
  assert.throws(()=>privateStorageEnabled({LW_STORAGE_ORIGIN:env.LW_STORAGE_ORIGIN}));assert.throws(()=>privateStorageEnabled({LW_STORAGE_SECRET:'x'}));
});
test('private requests sign method, path and exact UTF-8 body; no secrets in URL',async t=>{
  const requests=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({content:'{}',sha:'revision'}),{status:200});});
  await privateGet(env,'data/status.json');await privatePut(env,'data/status.json','{"name":"€ cijfers"}','revision');
  for(const {url,init} of requests){
    assert.equal(url.origin,'https://www.lumeworks.nl');assert.equal(url.pathname,'/cijfers/api/storage/data/status.json');assert.equal(url.search,'');assert.equal(init.redirect,'error');
    const headers=init.headers;
    const signed=[headers['X-LW-Timestamp'],headers['X-LW-Nonce'],init.method,url.pathname,createHash('sha256').update(init.body??'').digest('hex')].join('\n');
    assert.equal(headers['X-LW-Signature'],createHmac('sha256',env.LW_STORAGE_SECRET).update(signed).digest('hex'));
  }
  assert.notEqual(requests[0].init.headers['X-LW-Nonce'],requests[1].init.headers['X-LW-Nonce']);
  assert.deepEqual(JSON.parse(requests[1].init.body),{content:'{"name":"€ cijfers"}',sha:'revision'});
});
test('private read errors cannot look like empty valid datasets; CAS conflicts survive',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:401}));await assert.rejects(privateGet(env,'data/meta.json'),/401/);
  globalThis.fetch=async()=>new Response('',{status:404});assert.equal(await privateGet(env,'data/meta.json'),null);
  globalThis.fetch=async()=>new Response('',{status:409});assert.equal((await privatePut(env,'data/meta.json','{}','old')).status,409);
});
test('private storage refuses insecure origin, arbitrary files and secret-bearing redirects',async()=>{
  await assert.rejects(privateRequest({...env,LW_STORAGE_ORIGIN:'http://www.lumeworks.nl/cijfers'},'data/meta.json'));
  await assert.rejects(privateRequest(env,'../config.json'));
  await assert.rejects(privateRequest({...env,LW_STORAGE_ORIGIN:'https://user:pass@www.lumeworks.nl/cijfers'},'data/meta.json'));
});
test('public and internal MCP endpoints are shut at private cutover',async()=>{
  for(const path of ['/mcp','/mcp-intern'])assert.equal((await worker.fetch(new Request('https://example.com'+path),env)).status,403);
});
