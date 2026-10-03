import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {attachChartReference,thresholdCounts,comparisonRanges,periodComparisonChart} from '../assets/blended/chart-reference.js';
test('threshold counts preserve negative, equal and missing values without treating unknown as zero',()=>{
 assert.deepEqual(thresholdCounts([-5,0,1,null,undefined,NaN],0),{above:1,below:1,equal:1,missing:3});
 assert.deepEqual(thresholdCounts([-5,0,1],-5),{above:2,below:0,equal:1,missing:0});
});
test('reference line has a fixed zero, keyboard/numeric adjustment, reset and accurate inverse SVG coordinates',()=>{
 const d=new JSDOM('<div class="chart"><svg viewBox="0 0 960 250"></svg></div>'),w=d.window,svg=w.document.querySelector('svg');
 const api=attachChartReference(svg,{min:-100,max:100,left:70,right:940,top:20,bottom:220,format:v=>v+' euro',series:[{label:'Winst',values:[-50,0,50,null]}],key:'test'});
 const gate=svg.querySelector('.chart-threshold-hit'),zero=svg.querySelector('.chart-zero-line');
 assert.equal(zero.getAttribute('y1'),'120');
 gate.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));assert.equal(api.getValue(),2);
 const input=w.document.querySelector('input');input.value='50';input.dispatchEvent(new w.Event('input'));assert.equal(api.getValue(),50);
 assert.match(w.document.querySelector('.chart-reference-counts').textContent,/0 boven · 2 onder · 1 gelijk · 1 onbekend/);
 input.value='';input.dispatchEvent(new w.Event('input'));assert.equal(api.getValue(),50);
 let selected=false;svg.addEventListener('pointerdown',()=>selected=true);
 svg.getScreenCTM=()=>({inverse:()=>({})});svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {y:(this.y-200)/.5};}});
 const event=(type,y)=>{const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{button:0,pointerId:1,clientX:200,clientY:y});gate.dispatchEvent(e);};
 event('pointerdown',200);event('pointermove',230);event('pointerup',230);assert.equal(api.getValue(),60);assert.equal(selected,false);
 assert.equal(zero.getAttribute('y1'),'120');
 w.document.querySelector('button').click();assert.equal(api.getValue(),0);
 api.setValue(500);assert.equal(api.getValue(),100);
 assert.equal(attachChartReference(svg,{min:NaN,max:100}),undefined);w.close();
});
test('comparison ranges never enable dates before the store start and cover exact preceding calendar month',()=>{
 const october=comparisonRanges('2026-10-01','2026-10-03');
 assert.deepEqual(october.find(r=>r.key==='lastmonth'),{key:'lastmonth',label:'Vorige maand',from:'2026-09-01',to:'2026-09-30',available:true});
 assert.equal(comparisonRanges('2026-08-05','2026-08-10').find(r=>r.key==='previous').available,false);
 assert.equal(comparisonRanges('2026-09-01','2026-09-03').find(r=>r.key==='lastmonth').available,false);
});
test('period chart breaks missing values, keeps unequal lengths, offers exact dates and neutral labels',()=>{
 const w=new JSDOM('<div id="host"></div>').window,host=w.document.getElementById('host');
 periodComparisonChart(host,[{label:'Nu',values:[1,null,3],dates:['1 okt','2 okt','3 okt']},{label:'Vorige',values:[-1,2],dates:['1 sep','2 sep']}],{format:v=>v+'%',key:'gap'});
 const path=host.querySelector('[data-period-line=Nu]');assert.equal((path.getAttribute('d').match(/M/g)||[]).length,2);
 assert.equal(host.querySelectorAll('circle').length,4);assert.match(host.textContent,/geen periodetotalen/);assert.match(host.querySelector('title').textContent,/1 okt/);assert.ok(host.querySelector('.chart-zero-line'));w.close();
});
