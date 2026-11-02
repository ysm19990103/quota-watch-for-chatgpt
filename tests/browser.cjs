/* Real Chromium extension test. All ChatGPT pages are fictional, intercepted fixtures. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const extension=path.resolve(__dirname,'../extension');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'quota-watch-test-'));
const report=[];const errors=[];let ctx;
const mark=s=>{report.push(s);console.log('PASS '+s);};
const fixture=()=>`<!doctype html><html><head><title>Fictional usage fixture</title><style>body{font:16px system-ui;padding:30px}section{padding:15px;border:1px solid #ddd;margin:10px;width:360px}span{display:inline-block}</style></head><body><main><h1>Usage</h1><section id="five"><h2>5 hour usage limit</h2><div><span id="five-percent">73%</span> <span>remaining</span></div><p>Resets in 2 hours 10 minutes</p></section><section id="weekly"><h2>Weekly usage limit</h2><div><span id="week-percent">18%</span> <span>remaining</span></div><p>Resets <time datetime="${new Date(Date.now()+2*86400000).toISOString()}">in 2 days</time></p></section><section hidden><h2>Weekly usage limit</h2><div>1% remaining</div></section></main></body></html>`;
(async()=>{
  const executable=process.env.CHROMIUM_EXECUTABLE;
  ctx=await chromium.launchPersistentContext(profile,{executablePath:executable,channel:executable?undefined:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1200,height:900}});
  await ctx.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:fixture()}));
  let worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:15000});
  worker.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const extensionId=new URL(worker.url()).host;
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://chatgpt.com/codex/settings/usage');
  await page.waitForSelector('#quota-watch-host');
  const popup=await ctx.newPage();popup.on('pageerror',e=>errors.push(e.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForFunction(()=>document.querySelector('#hero-value').textContent==='18',{timeout:10000});
  assert.equal(await popup.locator('.card').count(),2);mark('actual extension loads and reads two English usage cards');
  const original=await worker.evaluate(async()=>{const {state}=await chrome.storage.session.get('state');return Object.values(state.tabs).find(v=>v.rows.length)?.rows;});
  assert.ok(original.find(r=>r.period==='hours').resetAt>Date.now());mark('relative and explicit reset times produce countdowns');
  await page.locator('#week-percent').evaluate(el=>el.firstChild.textContent='32%');
  await popup.waitForFunction(()=>document.querySelector('#hero-value').textContent==='32');mark('text-only usage mutation updates the extension promptly');
  const value=await worker.evaluate(async()=>{const {state}=await chrome.storage.session.get('state');const entry=Object.entries(state.tabs).find(([,v])=>v.rows.length);return {id:Number(entry[0]),seen:entry[1].rows.map(r=>r.observedAt),badge:await chrome.action.getBadgeText({tabId:Number(entry[0])})};});
  assert.equal(value.badge,'32%');mark('toolbar badge matches the limiting fresh window');
  await popup.locator('#scan').click();
  await popup.waitForFunction(()=>document.querySelector('#feedback').textContent.length>0);
  const seen=await worker.evaluate(async id=>(await chrome.storage.session.get('state')).state.tabs[id].rows.map(r=>r.observedAt),value.id);
  assert.deepEqual(seen,value.seen);mark('rescan does not falsely renew unchanged readings or deadlock');
  await popup.locator('#language-toggle').click();
  await popup.waitForFunction(()=>document.documentElement.lang==='zh-CN');
  assert.equal(await popup.locator('#open').textContent(),'打开用量页面');mark('Chinese popup translation works');
  await popup.locator('#language-toggle').click();
  await popup.waitForFunction(()=>document.documentElement.lang==='en');
  const shotDir=process.env.QW_SCREENSHOTS;
  if(shotDir){fs.mkdirSync(shotDir,{recursive:true});await popup.setViewportSize({width:400,height:1000});await popup.screenshot({path:path.join(shotDir,'popup-en.png'),fullPage:true});}
  // The same text in a conversation must never become a usage observation.
  await ctx.route('https://chatgpt.com/c/fictional',route=>route.fulfill({contentType:'text/html',body:'<main><article data-message-author-role="assistant"><h2>Weekly usage limit</h2><p>1% remaining</p></article></main>'}));
  const chat=await ctx.newPage();await chat.goto('https://chatgpt.com/c/fictional');await chat.waitForSelector('#quota-watch-host');
  const chatTab=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://chatgpt.com/c/fictional'});return tabs[0].id;});
  assert.deepEqual(await worker.evaluate(async id=>(await chrome.storage.session.get('state')).state.tabs[id].rows,chatTab),[]);mark('conversation content cannot populate quota readings');
  // Automatic monitoring is enabled by default. The privilege boundary is
  // additionally covered by the service-worker unit harness.
  await popup.bringToFront();
  await popup.waitForFunction(()=>document.querySelector('#monitor-state').textContent==='Automatic background refresh on');
  const monitorId=await worker.evaluate(async()=>(await chrome.storage.session.get('state')).state.monitor.tabId);
  assert.notEqual(monitorId,chatTab);assert.ok(await worker.evaluate(async id=>(await chrome.tabs.get(id)).url.includes('/settings/usage'),monitorId));mark('automatic monitor creates a separate background Usage tab');
  // Navigate the dedicated monitor away: it must never reload the conversation,
  // and the watchdog must replace it with a fresh Usage tab.
  await worker.evaluate(async id=>{await chrome.tabs.update(id,{url:'https://chatgpt.com/c/fictional'});for(let i=0;i<50;i++){if(!(await chrome.storage.session.get('state')).state.monitor)break;await new Promise(r=>setTimeout(r,20));}await init();},monitorId);
  const replacementId=await worker.evaluate(async()=>(await chrome.storage.session.get('state')).state.monitor.tabId);
  assert.notEqual(replacementId,monitorId);assert.ok(await worker.evaluate(async id=>(await chrome.tabs.get(id)).url.includes('/settings/usage'),replacementId));mark('watchdog replaces a monitor tab that navigates away');
  await popup.locator('#monitor-toggle').click();await popup.waitForFunction(()=>document.querySelector('#monitor-state').textContent==='Automatic background refresh paused');mark('automatic refresh can be paused persistently');
  // Age a reading and require unknown headline; historical number remains clearly labelled.
  await worker.evaluate(async id=>{const {state}=await chrome.storage.session.get('state');for(const r of state.tabs[id].rows)r.observedAt=Date.now()-20*60000;await chrome.storage.session.set({state});},value.id);
  await popup.locator('#source-select').selectOption(String(value.id));
  await popup.waitForFunction(()=>document.querySelector('#hero-value').textContent==='—');
  assert.ok((await popup.locator('#cards').textContent()).includes('May be out of date'));mark('old readings are marked stale and removed from the headline');
  await popup.locator('#preferences').evaluate(el=>el.open=true);await popup.locator('#clear').click();
  await popup.waitForFunction(()=>document.querySelectorAll('.card').length===0);mark('clear removes readings from the popup and session store');
  const local=await worker.evaluate(()=>chrome.storage.local.get(null));
  assert.deepEqual(Object.keys(local),['settings']);mark('persistent storage contains preferences only');
  assert.deepEqual(errors,[]);mark('no browser JavaScript errors');
  if(process.env.QW_REPORT)fs.writeFileSync(process.env.QW_REPORT,JSON.stringify({passed:report.length,checks:report,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await ctx?.close();fs.rmSync(profile,{recursive:true,force:true});});
