const button=document.querySelector('#showPassword');
button?.addEventListener('click',()=>{const input=document.querySelector('#password');const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Verberg':'Toon';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Wachtwoord verbergen':'Wachtwoord tonen');});

const form=document.querySelector('#loginForm');
const submit=document.querySelector('#loginSubmit');
const feedback=document.querySelector('#loginFeedback');
let submitting=false;
let slowTimer;
const resetLogin=()=>{
  submitting=false;clearTimeout(slowTimer);
  if(!form||!submit)return;
  form.removeAttribute('aria-busy');submit.disabled=false;submit.classList.remove('is-loading');
  submit.querySelector('.button-label').textContent='Inloggen';
  if(feedback)feedback.textContent='';
};
form?.addEventListener('submit',event=>{
  if(submitting){event.preventDefault();return;}
  if(navigator.onLine===false){
    event.preventDefault();feedback.textContent='Geen verbinding. Controleer je internet en probeer opnieuw.';return;
  }
  // Use the normal form POST: password managers, native validation and no-JS remain supported.
  // Never disable credential inputs: disabled controls are omitted from the POST.
  submitting=true;form.setAttribute('aria-busy','true');submit.disabled=true;submit.classList.add('is-loading');
  submit.querySelector('.button-label').textContent='Even geduld';feedback.textContent='Je wordt ingelogd…';
  slowTimer=setTimeout(()=>{feedback.textContent='Dit duurt langer dan verwacht. Controleer je verbinding. Vernieuw de pagina om opnieuw te proberen.';},25000);
});
addEventListener('pageshow',resetLogin);
addEventListener('online',()=>{if(!submitting&&feedback)feedback.textContent='';});
