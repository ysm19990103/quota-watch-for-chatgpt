// Exercises the shipped content script against an in-memory DOM. This is not
// a substitute for a real Chrome extension / account integration test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {parseHTML}=require('linkedom');
const Q=require('../extension/core.js');
const content=fs.readFileSync(require.resolve('../extension/content.js'),'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(body,url=Q.USAGE_URL,widget=false){
 const {document,window}=parseHTML('<!doctype html><html><body>'+body+'</body></html>');
 const messages=[],handlers=[],intervals=[];
 let now=Date.parse('2026-11-02T08:00:00Z');
 class Clock extends Date {static now(){return now;}}
 window.HTMLElement.prototype.getClientRects=function(){return this.hidden||this.style.display==='none'?[]:[{width:100,height:30}];};
 const chrome={runtime:{sendMessage:async m=>{messages.push(structuredClone(m));return {ok:true,settings:{...Q.DEFAULTS,widget}};},onMessage:{addListener:f=>handlers.push(f)}}};
 const sandbox={QuotaWatch:Q,document,window,chrome,Date:Clock,URL,console,location:new URL(url),navigator:{language:'en'},MutationObserver:window.MutationObserver,
 getComputedStyle:el=>({display:el.style.display||'block',visibility:el.style.visibility||'visible'}),setTimeout:(f,m)=>{const t=setTimeout(f,m);t.unref();return t;},clearTimeout,setInterval:f=>{intervals.push(f);return intervals.length;},clearInterval:()=>{}};
 vm.runInNewContext(content,sandbox);await wait(5);
 return {document,messages,handlers,intervals,now:v=>now=v,sandbox,rows:()=>messages.filter(m=>m.type==='OBSERVE').at(-1)?.rows||[],scan:()=>new Promise(res=>handlers[0]({type:'SCAN'},{},res))};
}
const cards='<main><h1>Usage</h1><section><h2>5 hour usage limit</h2><div><span>73%</span><span>remaining</span></div><p>Resets in 2 hours 10 minutes</p></section><section><h2>Weekly usage limit</h2><div><span>18%</span><span>remaining</span></div><p>Resets <time datetime="2026-11-04T08:00:00Z">Nov 4</time></p></section></main>';
test('content script extracts distinct usage windows from a split-span layout',async()=>{
 const h=await run(cards);assert.equal(h.rows().length,2);assert.deepEqual(h.rows().map(r=>r.remaining).sort((a,b)=>a-b),[18,73]);
 assert.equal(h.rows().find(r=>r.period==='hours').resetAt,Date.parse('2026-11-02T10:10:00Z'));
 assert.equal(h.rows().find(r=>r.period==='weekly').resetAt,Date.parse('2026-11-04T08:00:00Z'));
});
test('Chinese labels and used-percent display',async()=>{
 const h=await run('<main><section><h2>每周额度</h2><p>已使用 81%</p><p>2小时10分钟后重置</p></section></main>');assert.equal(h.rows().length,1);assert.equal(h.rows()[0].remaining,19);
});
test('does not scan conversation content, code or user input',async()=>{
 const h=await run('<main><article data-message-author-role="assistant"><h2>Weekly usage limit</h2><p>1% remaining</p></article><textarea>Weekly limit 2% remaining</textarea><pre>Weekly limit 3% remaining</pre></main>','https://chatgpt.com/c/example');assert.equal(h.rows().length,0);
 const u=await run('<main><div data-message-author-role="user"><h2>Weekly</h2><p>1% remaining</p></div></main>');assert.equal(u.rows().length,0);
});
test('reads labelled usage dialog on a conversation page without reading conversation',async()=>{
 const h=await run('<main><article>Weekly 1% remaining</article></main><div role="dialog"><h2>Usage</h2><section><h3>Weekly limit</h3><p>63% remaining</p></section></div>','https://chatgpt.com/c/example');assert.equal(h.rows().length,1);assert.equal(h.rows()[0].remaining,63);
});
test('can read an explicitly labelled Work usage sidebar widget',async()=>{
 const h=await run('<aside><button aria-label="Work usage">Work · weekly 55% remaining</button></aside><main>Conversation</main>','https://chatgpt.com/c/example');assert.equal(h.rows().length,1);assert.equal(h.rows()[0].remaining,55);assert.equal(h.rows()[0].scope,'work');
});
test('ignores hidden cards and never infers a naked progress bar direction',async()=>{
 const h=await run('<main><section hidden><h2>Weekly</h2><p>1% remaining</p></section><section aria-hidden="true"><h2>Weekly</h2><p>2% remaining</p></section><section><h2>5 hour limit</h2><div role="progressbar" aria-valuenow="70">70%</div></section></main>');assert.equal(h.rows().length,0);
});
test('visible wrappers cannot expose CSS-hidden usage cards',async()=>{
 for(const style of ['display:none','visibility:hidden']){
  const h=await run(`<main><section style="${style}"><h2>Weekly</h2><p>1% remaining</p></section></main>`);
  assert.deepEqual(h.rows(),[],style);
 }
});
test('conflicting duplicate quota cards fail closed',async()=>{
 const h=await run('<main><section><h2>Weekly</h2><p>55% remaining</p></section><section><h2>Weekly</h2><p>67% remaining</p></section></main>');assert.equal(h.rows().length,0);
});
test('previous readings clear when usage cards disappear or become conflicting',async()=>{
 for(const replacement of ['', '<section><h2>Weekly</h2><p>55% remaining</p></section><section><h2>Weekly</h2><p>67% remaining</p></section>']){
  const h=await run(cards);assert.equal(h.rows().length,2);
  h.document.querySelector('main').innerHTML=replacement;
  const result=await h.scan();assert.equal(result.found,false);
  assert.deepEqual(h.rows(),[]);assert.equal(h.messages.at(-1).type,'OBSERVE');
 }
});
test('three contradictory cards reject the window without throwing or keeping old readings',async()=>{
 const h=await run(cards);
 h.document.querySelector('main').innerHTML=[20,40,60].map(n=>`<section><h2>Weekly</h2><p>${n}% remaining</p></section>`).join('');
 const result=await h.scan();assert.equal(result.found,false);assert.deepEqual(h.rows(),[]);
});
test('unchanged DOM rescans preserve observation time and relative reset anchor',async()=>{
 const h=await run(cards);const before=h.rows();h.now(Date.parse('2026-11-02T08:03:00Z'));await h.scan();assert.deepEqual(h.rows(),before);
});
test('new displayed value produces a new observation',async()=>{
 const h=await run(cards);h.now(Date.parse('2026-11-02T08:01:00Z'));const n=[...h.document.querySelectorAll('span')].find(n=>n.textContent==='18%');n.textContent='25%';await h.scan();assert.equal(h.rows().find(r=>r.period==='weekly').remaining,25);assert.equal(h.rows().find(r=>r.period==='weekly').observedAt,Date.parse('2026-11-02T08:01:00Z'));
});
test('client-side reset countdown ticks do not make an old quota fresh',async()=>{
 const h=await run(cards);const before=h.rows().find(r=>r.period==='hours');h.now(Date.parse('2026-11-02T08:05:00Z'));
 const reset=[...h.document.querySelectorAll('p')].find(n=>n.textContent.startsWith('Resets in'));reset.textContent='Resets in 2 hours 5 minutes';await h.scan();
 const after=h.rows().find(r=>r.period==='hours');assert.equal(after.observedAt,before.observedAt);assert.equal(after.resetAt,before.resetAt);
});
test('floating widget is isolated and contains no captured conversation content',async()=>{
 const h=await run(cards,Q.USAGE_URL,true);const host=h.document.getElementById('quota-watch-host');assert.ok(host);assert.equal(host.shadowRoot,null);assert.equal(h.rows().length,2);
});
test('SPA navigation clears the previous view before any new reading',async()=>{
 const h=await run(cards);h.sandbox.location=new URL('https://chatgpt.com/c/example');await h.scan();assert.equal(h.messages.at(-1).type,'HELLO');
});
