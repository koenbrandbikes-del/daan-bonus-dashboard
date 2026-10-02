const button=document.querySelector('#showPassword');
button?.addEventListener('click',()=>{const input=document.querySelector('#password');const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Verberg':'Toon';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Wachtwoord verbergen':'Wachtwoord tonen');});
