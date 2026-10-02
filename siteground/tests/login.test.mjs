import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function setup(online=true){
 const events={},timers=[];
 const el=()=>({handlers:{},attrs:{},disabled:false,textContent:'',type:'password',classList:{add(){},remove(){}},addEventListener(k,f){this.handlers[k]=f},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}});
 const form=el(),submit=el(),feedback=el(),password=el(),toggle=el(),label=el();submit.querySelector=()=>label;
 const elements={'#loginForm':form,'#loginSubmit':submit,'#loginFeedback':feedback,'#password':password,'#showPassword':toggle};
 vm.runInNewContext(readFileSync(new URL('../private/login.js',import.meta.url),'utf8'),{document:{querySelector:k=>elements[k]},navigator:{onLine:online},addEventListener:(k,f)=>events[k]=f,setTimeout:f=>(timers.push(f),1),clearTimeout(){}});
 const send=()=>{let prevented=false;form.handlers.submit({preventDefault(){prevented=true}});return prevented};
 return {form,submit,feedback,password,toggle,label,events,timers,send};
}
test('offline prevents a request and explains recovery',()=>{const s=setup(false);assert.equal(s.send(),true);assert.equal(s.submit.disabled,false);assert.match(s.feedback.textContent,/Geen verbinding/)});
test('single native POST keeps credentials enabled and blocks duplicates',()=>{const s=setup();assert.equal(s.send(),false);assert.equal(s.submit.disabled,true);assert.equal(s.password.disabled,false);assert.equal(s.send(),true);assert.equal(s.form.attrs['aria-busy'],'true');s.timers[0]();assert.match(s.feedback.textContent,/langer/);assert.equal(s.submit.disabled,true);s.events.pageshow();assert.equal(s.submit.disabled,false);assert.equal(s.send(),false)});
test('password visibility has an accessible state',()=>{const s=setup();s.toggle.handlers.click();assert.equal(s.password.type,'text');assert.equal(s.toggle.attrs['aria-pressed'],'true');s.toggle.handlers.click();assert.equal(s.password.type,'password')});
