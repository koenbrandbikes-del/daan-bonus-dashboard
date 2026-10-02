// Intentionally network only: a saved app must never retain financial pages/data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="nl"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LumeWorks • Cijfers</title><body style="background:#0a0d26;color:#f1f5f9;font:16px system-ui;padding:32px"><h1>Cijfers</h1><p>Je bent offline. Maak verbinding en open Cijfers opnieuw.</p><a style="color:#14a6f1" href="./">Opnieuw openen</a></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}})));
});
