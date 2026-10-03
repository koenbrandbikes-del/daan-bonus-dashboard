// Read-only chart controls shared by Cijfers and the secured Meta dashboard.
const referenceValues = new Map();
export function thresholdCounts(values, threshold) {
 const out={above:0,below:0,equal:0,missing:0};
 for(const value of values){if(!Number.isFinite(value))out.missing++;else if(value>threshold)out.above++;else if(value<threshold)out.below++;else out.equal++;}
 return out;
}
export function attachChartReference(svg,{min,max,left,right,top,bottom,format,series,key='chart',unit='periodes'}){
 if(!svg||!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return;
 const doc=svg.ownerDocument,ns='http://www.w3.org/2000/svg';
 svg.querySelectorAll('[data-reference-layer]').forEach(n=>n.remove());
 const parent=svg.closest('.chart,.kpi-chart-svgwrap,.period-chart')||svg.parentElement;
 parent.querySelectorAll(':scope > .chart-reference-controls').forEach(n=>n.remove());
 const node=(name,attrs)=>{const n=doc.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
 const y=v=>top+(max-v)/(max-min)*(bottom-top);
 const layer=node('g',{'data-reference-layer':'',class:'chart-reference-layer'});svg.append(layer);
 if(min<=0&&max>=0)layer.append(node('line',{x1:left,x2:right,y1:y(0),y2:y(0),class:'chart-zero-line','pointer-events':'none'}));
 const line=node('line',{x1:left,x2:right,class:'chart-threshold-line','pointer-events':'none'});
 const hit=node('rect',{x:left,width:right-left,height:24,fill:'transparent',class:'chart-threshold-hit',tabindex:0,role:'slider','aria-label':'Vergelijkingsgrens; omhoog of omlaag slepen','aria-valuemin':min,'aria-valuemax':max});
 layer.append(line,hit);
 for(const type of ["mousedown","mouseup","mousemove","touchstart","touchmove","touchend"])hit.addEventListener(type,e=>e.stopPropagation());
 const controls=doc.createElement('div');controls.className='chart-reference-controls';
 const label=doc.createElement('label');label.textContent='Vergelijkingsgrens ';const input=doc.createElement('input');input.type='number';input.step='any';input.min=min;input.max=max;input.setAttribute('aria-label','Waarde vergelijkingsgrens');label.append(input);
 const reset=doc.createElement('button');reset.type='button';reset.textContent='Terug naar 0';
 const valueLabel=doc.createElement('span');valueLabel.className='chart-reference-value';
 const counts=doc.createElement('div');counts.className='chart-reference-counts';counts.setAttribute('aria-live','polite');
 controls.append(label,valueLabel,reset,counts);parent.append(controls);
 for(const type of ["mousedown","mouseup","mousemove","touchstart","touchmove","touchend","pointerdown","pointerup","pointermove"])controls.addEventListener(type,e=>e.stopPropagation());
 let value=Math.max(min,Math.min(max,referenceValues.get(key)??0)),dragging=false;
 const paint=v=>{
  if(!Number.isFinite(v))return;value=Math.max(min,Math.min(max,v));referenceValues.set(key,value);
  line.setAttribute('y1',y(value));line.setAttribute('y2',y(value));hit.setAttribute('y',y(value)-12);
  hit.setAttribute('aria-valuenow',value);hit.setAttribute('aria-valuetext',format(value));
  input.value=String(Number(value.toFixed(4)));valueLabel.textContent=format(value);
  counts.replaceChildren(...series.map(s=>{const c=thresholdCounts(s.values,value),p=doc.createElement('span');p.textContent=s.label+': '+c.above+' boven · '+c.below+' onder'+(c.equal?' · '+c.equal+' gelijk':'')+(c.missing?' · '+c.missing+' onbekend':'')+' ('+unit+')';return p;}));
 };
 const pointerValue=e=>{
  const matrix=svg.getScreenCTM?.();let py;
  if(matrix&&svg.createSVGPoint){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;py=p.matrixTransform(matrix.inverse()).y;}
  else {const r=svg.getBoundingClientRect(),h=Number(svg.getAttribute('viewBox').split(/\s+/)[3]);if(!r.height)return value;py=(e.clientY-r.top)/r.height*h;}
  return max-(py-top)/(bottom-top)*(max-min);
 };
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])hit.addEventListener(type,e=>{
  e.stopPropagation();
  if(type==='pointerdown'){if(e.button!==0)return;e.preventDefault();dragging=true;hit.setPointerCapture?.(e.pointerId);}
  else if(type==='pointermove'&&dragging)paint(pointerValue(e));
  else if(type==='pointerup'&&dragging){paint(pointerValue(e));dragging=false;hit.releasePointerCapture?.(e.pointerId);}
  else if(type==='pointercancel')dragging=false;
 });
 hit.addEventListener('keydown',e=>{const step=(max-min)/100;if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();paint(e.key==='Home'?min:e.key==='End'?max:value+(e.key==='ArrowUp'?step:-step)*(e.shiftKey?10:1));}});
 input.addEventListener('input',()=>{if(input.value.trim()!==''&&input.validity.valid)paint(Number(input.value));});
 input.addEventListener('change',()=>paint(value));reset.addEventListener('click',()=>paint(0));paint(value);
 return {setValue:paint,getValue:()=>value};
}
export function comparisonRanges(from,to,start='2026-08-05'){
 const iso=d=>d.toISOString().slice(0,10),shift=(d,n)=>iso(new Date(Date.parse(d)+n*864e5));
 const length=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;
 const endPrevMonth=iso(new Date(Date.UTC(Number(to.slice(0,4)),Number(to.slice(5,7))-1,0)));
 const startPrevMonth=endPrevMonth.slice(0,7)+'-01';
 const monday=shift(to,-((new Date(to+'T12:00:00Z').getUTCDay()+6)%7));
 return [{key:'previous',label:'Vorige periode',from:shift(from,-length),to:shift(from,-1)},{key:'lastweek',label:'Vorige week',from:shift(monday,-7),to:shift(monday,-1)},{key:'lastmonth',label:'Vorige maand',from:startPrevMonth,to:endPrevMonth}].map(r=>({...r,available:r.from>=start&&r.to>=r.from}));
}
export function periodComparisonChart(host,lines,{format,key='periods',title='Periodes vergelijken',unit='dagen'}){
 const doc=host.ownerDocument,ns='http://www.w3.org/2000/svg';host.replaceChildren();host.className='period-chart';
 const vals=lines.flatMap(l=>l.values).filter(Number.isFinite);if(!vals.length){host.textContent='Geen betrouwbare waarden voor deze vergelijking.';return;}
 const min=Math.min(0,...vals),max=Math.max(1,...vals),W=960,H=250,L=85,R=20,T=20,B=36,n=Math.max(...lines.map(l=>l.values.length));
 const x=i=>L+(n<=1?.5:i/(n-1))*(W-L-R),y=v=>T+(max-v)/(max-min)*(H-T-B),colors=['#8BE0BE','#38BDF8','#FFAD55','#B98DE0'];
 const heading=doc.createElement('h3');heading.textContent=title;host.append(heading);
 const legend=doc.createElement('div');legend.className='legend';lines.forEach((l,i)=>{const span=doc.createElement('span');span.style.color=colors[i%4];span.textContent=l.label;legend.append(span);});host.append(legend);
 const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',title+'; periodes uitgelijnd op hun eerste dag');host.append(svg);
 const el=(name,attrs,text)=>{const e=doc.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;svg.append(e);return e;};
 for(const v of [min,(min+max)/2,max]){el('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),class:'chart-grid'});el('text',{x:L-8,y:y(v)+4,'text-anchor':'end'},format(v));}
 lines.forEach((l,j)=>{let path='',open=false;l.values.forEach((v,i)=>{if(!Number.isFinite(v)){open=false;return;}path+=(open?'L':'M')+x(i)+','+y(v)+' ';open=true;const c=el('circle',{cx:x(i),cy:y(v),r:3,fill:colors[j%4]});const tip=doc.createElementNS(ns,'title');tip.textContent=l.label+' · '+(l.dates?.[i]??unit+' '+(i+1))+': '+format(v);c.append(tip);});el('path',{d:path,stroke:colors[j%4],'stroke-width':2.5,fill:'none','data-period-line':l.label});});
 for(let i=0;i<n;i++)if(i%Math.ceil(n/7)===0||i===n-1)el('text',{x:x(i),y:H-8,'text-anchor':'middle'},'Dag '+(i+1));
 const note=doc.createElement('p');note.className='hint';note.textContent='Dagen vanaf de start van elke periode. Een langere periode heeft meer punten; ontbrekende waarden blijven leeg. Dit vergelijkt dagprestaties, geen periodetotalen.';host.append(note);
 attachChartReference(svg,{min,max,left:L,right:W-R,top:T,bottom:H-B,format,series:lines,key,unit});
}
