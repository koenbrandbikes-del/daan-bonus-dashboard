// No financial responses, cookies, or passwords are put in browser storage.
const base=new URL('.',document.currentScript.src);
if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname}).catch(()=>{});
let installPrompt;
addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;document.querySelectorAll('#installApp').forEach(b=>b.hidden=false);});
document.querySelector('#installApp')?.addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;document.querySelectorAll('#installApp').forEach(b=>b.hidden=true);});
const secured=document.documentElement.dataset.secured==='true';
if(secured){
  let pending;
  const verify=()=>pending??=(async()=>{try{const r=await fetch(new URL('api/session',base),{cache:'no-store',credentials:'same-origin'});if(r.status===401){document.documentElement.classList.add('session-hidden');sessionStorage.clear();location.replace(new URL('login',base));return;}if(!r.ok)throw Error('Unavailable');if(!document.hidden)document.documentElement.classList.remove('session-hidden');const el=document.querySelector('#sessionRetry');if(el)el.hidden=true;}catch{document.documentElement.classList.add('session-hidden');const el=document.querySelector('#sessionRetry');if(el)el.hidden=false;}finally{pending=null;}})();
  addEventListener('pageshow',()=>verify());
  addEventListener('pagehide',()=>document.documentElement.classList.add('session-hidden'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)document.documentElement.classList.add('session-hidden');else verify();});
  setInterval(verify,60000);
  document.querySelector('#sessionRetry button')?.addEventListener('click',()=>location.reload());
  // Remove obsolete financial caches from the earlier dashboard on this origin.
  for(const key of Object.keys(sessionStorage))if(key.startsWith('lw-dashboard-'))sessionStorage.removeItem(key);
}
