const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {parseHTML}=require('linkedom');
const Q=require('../extension/core.js');
const html=fs.readFileSync(require.resolve('../extension/popup.html'),'utf8');
const script=fs.readFileSync(require.resolve('../extension/popup.js'),'utf8');
const wait=()=>new Promise(r=>setImmediate(r));
async function run(rows=[],overrides={}){
 const {document,window}=parseHTML(html);const messages=[],changes=[];
 // Linkedom's HTMLSelectElement value is getter-only; provide the DOM setter
 // used by the real popup without emulating layout or browser permissions.
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(v){for(const o of this.querySelectorAll('option')){if(o.getAttribute('value')===String(v))o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 let view={ok:true,settings:{...Q.DEFAULTS,language:'en'},monitor:false,selected:1,activeId:1,source:'active',rows,tabs:[{id:1,rows:rows.length,monitor:false,active:true}],lastScan:Date.now(),...overrides};
 const chrome={runtime:{sendMessage:async m=>{messages.push(m);if(m.type==='GET')return structuredClone(view);if(m.type==='SETTINGS')view.settings={...view.settings,...m.settings};if(m.type==='START')view.monitor=true;if(m.type==='STOP')view.monitor=false;if(m.type==='CLEAR')view.rows=[];return {ok:true,found:true};}},storage:{onChanged:{addListener:f=>changes.push(f)}},permissions:{request:async()=>false}};
 const context=vm.createContext({QuotaWatch:Q,document,window,chrome,navigator:{language:'en'},Date,Intl,console,setInterval:()=>1});
 vm.runInContext(script,context);await wait();
 return {document,messages,context,update:async v=>{view={...view,...v};await vm.runInContext('refresh()',context);}};
}
test('popup has an honest empty state and no invented limit',async()=>{const h=await run();assert.equal(h.document.getElementById('hero-value').textContent,'—');assert.equal(h.document.getElementById('empty').hidden,false);assert.equal(h.document.querySelectorAll('.card').length,0);});
test('popup renders percentages, source, meter and reset',async()=>{const r=Q.parseCard('Weekly\n18% remaining\nResets in 2h');const h=await run([r]);assert.equal(h.document.getElementById('hero-value').textContent,'18');assert.equal(h.document.querySelector('[role=meter]').getAttribute('aria-valuenow'),'18');assert.ok(h.document.querySelector('.absolute').textContent);assert.equal(h.document.querySelectorAll('.card.low').length,1);});
test('stale and expired values remain history only',async()=>{const r=Q.parseCard('Weekly\n18% remaining');r.observedAt=Date.now()-20*60000;const h=await run([r]);assert.equal(h.document.getElementById('hero-value').textContent,'—');assert.ok(h.document.querySelector('.old').textContent.includes('out of date'));r.resetAt=Date.now()-1000;await h.update({rows:[r]});assert.ok(h.document.querySelector('.old').textContent.includes('Reset time passed'));});
test('language toggle, monitor switch and clear button call the right extension actions',async()=>{const h=await run([Q.parseCard('Weekly\n51% remaining')]);await h.document.getElementById('language-toggle').onclick();assert.equal(h.document.documentElement.lang,'zh-CN');assert.equal(h.document.getElementById('open').textContent,'打开用量页面');await h.document.getElementById('monitor-toggle').onclick();assert.equal(h.document.getElementById('monitor-toggle').textContent,'暂停自动刷新');await h.document.getElementById('clear').onclick();assert.equal(h.document.querySelectorAll('.card').length,0);assert.ok(h.messages.some(m=>m.type==='CLEAR'));});
test('denied notification permission leaves alerts disabled',async()=>{const h=await run();const el=h.document.getElementById('notifications');el.checked=true;await el.onchange({target:el});assert.equal(el.checked,false);assert.ok(h.document.getElementById('feedback').textContent.includes('not granted'));});
