/* Real Manifest V3 integration. Every page is synthetic and the fresh profile is disposable. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require('playwright');

const extension = path.resolve(__dirname, '../extension');
const usageURL = 'https://chatgpt.com/codex/settings/usage';
const chatURL = 'https://chatgpt.com/c/fictional';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-watch-synthetic-'));
const reportPath = process.env.QW_REPORT || path.resolve(__dirname, '../test-results/browser/report.json');
const screenshotDir = process.env.QW_SCREENSHOTS;
const checks = [], errors = [], requests = new Map(), browserEvents = [];
let diagnostics = null;
let ctx, worker, popup, extensionId, currentCheck, failure, blockedConnections = 0, weekly = 18;
const startedAt = new Date().toISOString();
const environment = {
  node: process.version,
  playwright: require('playwright/package.json').version,
  platform: process.platform,
  architecture: process.arch,
  osRelease: os.release(),
  osVersion: os.version(),
  runnerImage: process.env.ImageOS || null,
  runnerImageVersion: process.env.ImageVersion || null,
  commit: process.env.GITHUB_SHA || null,
  runURL: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  mode: 'bundled Chromium, headless, unpacked Manifest V3 extension',
  profile: 'new temporary profile; reused only for this synthetic restart test',
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, description, timeout = 15000) {
  const until = Date.now() + timeout;
  let last;
  do {
    try { const result = await fn(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  } while (Date.now() < until);
  throw new Error(`Timed out: ${description}${last ? ` (${last.message})` : ''}`);
}
function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    status: failure ? 'failed' : 'passed', startedAt, finishedAt: new Date().toISOString(),
    environment, passed: checks.length, checks, failure, errors, diagnostics, browserEvents,
    network: { policy: 'Deny-all loopback proxy active before browser startup; exact synthetic URLs fulfilled by Playwright; all other page requests aborted', blockedConnections, fixtureRequests: Object.fromEntries(requests) },
    limitations: ['Synthetic UI fixtures only; no signed-in account or live ChatGPT compatibility tested.', 'OS notification delivery and browser toolbar geometry are outside this harness; badge values are inspected through the real chrome.action API.'],
  }, null, 2) + '\n');
}
async function check(name, fn) {
  currentCheck = name;
  const start = Date.now();
  await fn();
  checks.push({ name, durationMs: Date.now() - start });
  console.log(`PASS ${name}`);
}
const usageFixture = () => `<!doctype html><html><head><title>Synthetic Usage</title><style>body{font:16px system-ui;padding:30px}section{padding:15px;border:1px solid #ddd;margin:10px;width:360px}span{display:inline-block}</style></head><body><main><h1>Usage</h1><section><h2>5 hour usage limit</h2><div><span>73%</span> <span>remaining</span></div><p>Resets in 2 hours 10 minutes</p></section><section><h2>Weekly usage limit</h2><div><span id="week-percent">${weekly}%</span> <span>remaining</span></div><p>Resets <time datetime="${new Date(Date.now() + 2 * 86400000).toISOString()}">in 2 days</time></p></section><section hidden><h2>Weekly usage limit</h2><div>1% remaining</div></section></main></body></html>`;
const chatFixture = '<!doctype html><title>Synthetic conversation</title><main><article data-message-author-role="assistant"><h2>Weekly usage limit</h2><p>1% remaining</p></article><textarea aria-label="Synthetic draft">Fictional unsent draft</textarea></main>';
// Nothing is forwarded. This protects startup/restored tabs before context.route exists,
// and also prevents a future worker network call from reaching a live endpoint.
const denyProxy = http.createServer((_req, res) => { blockedConnections++; res.writeHead(403); res.end('Synthetic test: network denied'); });
denyProxy.on('connect', (_req, socket) => { blockedConnections++; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
denyProxy.on('connection', socket => { socket.on('error', () => {}); });

async function launch() {
  const port = denyProxy.address().port;
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-quic'],
    viewport: { width: 1200, height: 900 },
    timeout: 30000,
  });
  ctx.setDefaultTimeout(15000);
  const watchPage = page => page.on('pageerror', error => errors.push(error.message));
  ctx.on('page', watchPage);
  ctx.pages().forEach(watchPage);
  ctx.on('requestfailed', request => {
    if ([usageURL, chatURL].includes(request.url())) browserEvents.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText });
  });
  ctx.on('console', message => { if (message.type() === 'error' && message.location().url.startsWith('chrome-extension://')) errors.push(message.text()); });
  await ctx.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (request.method() === 'GET' && (url === usageURL || url === chatURL)) {
      requests.set(url, (requests.get(url) || 0) + 1);
      await route.fulfill({ contentType: 'text/html', body: url === usageURL ? usageFixture() : chatFixture });
    } else await route.abort('blockedbyclient');
  });
  worker = ctx.serviceWorkers().find(item => item.url().endsWith('/background.js')) || await ctx.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.__qwTestTabEvents = [];
    chrome.tabs.onCreated.addListener(tab => globalThis.__qwTestTabEvents.push({ type: 'created', id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl, status: tab.status }));
    chrome.tabs.onUpdated.addListener((id, change, tab) => globalThis.__qwTestTabEvents.push({ type: 'updated', id, change, url: tab.url, pendingUrl: tab.pendingUrl, status: tab.status }));
  });
  const cdp = await ctx.newCDPSession(ctx.pages()[0]);
  const version = await cdp.send('Browser.getVersion');
  environment.chromium = version.product;
  environment.browserRevision = version.revision;
  environment.javascriptVersion = version.jsVersion;
  await cdp.detach();
  console.log('BROWSER_ENVIRONMENT ' + JSON.stringify(environment));
}
async function state() { return worker.evaluate(async () => (await chrome.storage.session.get('state')).state); }
async function prefs() { return worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings); }
async function monitor() {
  return eventually(async () => {
    const value = await state();
    if (!value?.monitor) return null;
    return worker.evaluate(async id => { try { return await chrome.tabs.get(id); } catch { return null; } }, value.monitor.tabId);
  }, 'monitor tab exists');
}
async function openPopup() {
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#monitor-state').textContent.length > 0);
  return popup;
}
async function selectSource(id) {
  await eventually(async () => await popup.locator(`#source-select option[value="${id}"]`).count(), 'source option exists');
  await popup.locator('#source-select').selectOption(String(id));
}
async function waitHero(value) {
  await popup.waitForFunction(expected => document.querySelector('#hero-value').textContent === expected, value);
}
async function fireAlarm(name) {
  // Exercise Chrome's real alarm event, never call the production handler/init directly.
  await worker.evaluate(async name => {
    globalThis.__qwTestAlarms ||= [];
    if (!globalThis.__qwTestAlarmListener) {
      globalThis.__qwTestAlarmListener = alarm => globalThis.__qwTestAlarms.push(alarm.name);
      chrome.alarms.onAlarm.addListener(globalThis.__qwTestAlarmListener);
    }
    globalThis.__qwTestAlarms.length = 0;
    await chrome.alarms.create(name, { when: Date.now() + 150 });
  }, name);
  await eventually(() => worker.evaluate(name => globalThis.__qwTestAlarms?.includes(name), name), `${name} delivered by Chrome`);
  // The observer fires beside the async production handler. A GET message is queued
  // behind it, making this a deterministic completion barrier through the public API.
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET' }));
}
async function snapshot(label) {
  if (!screenshotDir || !popup || popup.isClosed()) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  await popup.screenshot({ path: path.join(screenshotDir, `${label}.png`), fullPage: true });
}

(async () => {
  denyProxy.listen(0, '127.0.0.1');
  await once(denyProxy, 'listening');
  await check('unpacked extension installs and starts its actual Manifest V3 worker', async () => {
    await launch();
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.background.service_worker, 'background.js');
    assert.equal(manifest.version, require('../extension/manifest.json').version);
  });
  let monitorId, monitorPage;
  await check('startup creates a separate inactive Usage tab without a user action', async () => {
    const tab = await monitor(); monitorId = tab.id;
    assert.equal(tab.url || tab.pendingUrl, usageURL);
    assert.equal(tab.active, false);
    assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/codex/settings/usage' }))).length, 1);
    monitorPage = await eventually(() => ctx.pages().find(page => page.url() === usageURL), 'monitor Playwright page');
    // Startup can precede route installation; the deny proxy makes that fail closed.
    // This one bootstrap reload is test setup, not evidence of automatic refresh.
    await monitorPage.reload();
    await monitorPage.waitForSelector('#quota-watch-host');
    await openPopup();
    await waitHero('18');
  });
  await check('content script reads two visible cards and reset times through Chrome messaging', async () => {
    assert.equal(await popup.locator('.card').count(), 2);
    const rows = (await state()).tabs[monitorId].rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.find(row => row.period === 'hours').resetAt > Date.now());
    assert.ok(rows.find(row => row.period === 'weekly').resetAt > Date.now());
  });
  await check('DOM text mutations update popup and real global/tab toolbar badge values', async () => {
    await monitorPage.locator('#week-percent').evaluate(el => el.firstChild.textContent = '32%');
    await waitHero('32');
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '32%');
    assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), monitorId), '32%');
  });
  await check('conflicting or removed cards invalidate previously fresh observations', async () => {
    const original = await monitorPage.locator('main').innerHTML();
    await monitorPage.locator('main').evaluate(el => {
      el.innerHTML = '<h1>Usage</h1>' + [22, 33, 44].map(value => `<section><h2>Weekly usage limit</h2><p>${value}% remaining</p></section>`).join('');
    });
    await waitHero('—');
    assert.deepEqual((await state()).tabs[monitorId].rows, []);
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '—');
    await monitorPage.locator('main').evaluate((el, markup) => { el.innerHTML = markup; }, original);
    await waitHero('32');
    await monitorPage.locator('main').evaluate(el => { el.innerHTML = '<h1>Usage</h1><p>No allowance available</p>'; });
    await waitHero('—');
    assert.deepEqual((await state()).tabs[monitorId].rows, []);
    await monitorPage.locator('main').evaluate(el => {
      el.style.minHeight = '200px';
      el.innerHTML = '<h1>Usage</h1><section style="display:none"><h2>Weekly usage limit</h2><p>2% remaining</p></section><section style="visibility:hidden"><h2>5 hour usage limit</h2><p>3% remaining</p></section>';
    });
    // An empty observation stays empty even when hidden descendants contain quotas.
    await popup.locator('#feedback').evaluate(el => { el.textContent = ''; });
    await popup.locator('#scan').click();
    await popup.waitForFunction(() => document.querySelector('#feedback').textContent.length > 0);
    await waitHero('—');
    assert.deepEqual((await state()).tabs[monitorId].rows, []);
    await monitorPage.locator('main').evaluate((el, markup) => { el.innerHTML = markup; }, original);
    await waitHero('32');
  });
  await check('popup rescan round trip completes without renewing unchanged timestamps', async () => {
    const before = (await state()).tabs[monitorId].rows.map(row => row.observedAt);
    await popup.locator('#feedback').evaluate(el => { el.textContent = ''; });
    await popup.locator('#scan').click();
    await popup.waitForFunction(() => document.querySelector('#feedback').textContent.length > 0);
    assert.deepEqual((await state()).tabs[monitorId].rows.map(row => row.observedAt), before);
  });
  await check('English/Chinese popup controls and refresh preference writes work', async () => {
    await popup.locator('#language-toggle').click();
    await popup.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(await popup.locator('#open').textContent(), '打开用量页面');
    await popup.locator('#language-toggle').click();
    await popup.waitForFunction(() => document.documentElement.lang === 'en');
    await popup.locator('#preferences').evaluate(el => el.open = true);
    await popup.locator('#interval').selectOption('2');
    await eventually(async () => (await prefs())?.interval === 2, 'interval persisted');
    await eventually(async () => (await worker.evaluate(() => chrome.alarms.get('monitor')))?.periodInMinutes === 2, 'two-minute alarm installed');
    await popup.locator('#threshold').selectOption('30');
    await eventually(async () => (await prefs())?.threshold === 30, 'threshold persisted');
    await popup.locator('#interval').selectOption('1');
    await eventually(async () => (await worker.evaluate(() => chrome.alarms.get('monitor')))?.periodInMinutes === 1, 'one-minute alarm installed');
    await snapshot('popup-en');
  });
  let chat, chatId, draft;
  await check('synthetic conversation text never becomes a quota observation', async () => {
    chat = await ctx.newPage(); await chat.goto(chatURL); await chat.waitForSelector('#quota-watch-host');
    chatId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, chatURL);
    await eventually(async () => (await state()).tabs[chatId], 'conversation HELLO');
    assert.deepEqual((await state()).tabs[chatId].rows, []);
    draft = await chat.locator('textarea').inputValue();
  });
  await check('selected one-minute alarm automatically reloads background Usage and updates readings', async () => {
    await popup.bringToFront();
    const beforeUsage = requests.get(usageURL), beforeChat = requests.get(chatURL);
    weekly = 27;
    assert.equal((await worker.evaluate(() => chrome.alarms.get('monitor'))).periodInMinutes, 1);
    await eventually(() => requests.get(usageURL) > beforeUsage, 'real periodic reload (no manual alarm or page reload)', 90000);
    await selectSource(monitorId); await waitHero('27');
    assert.equal(requests.get(chatURL), beforeChat);
    assert.equal(await chat.locator('textarea').inputValue(), draft);
  });
  await check('active Usage tab is scanned without reloading', async () => {
    await monitorPage.bringToFront();
    await eventually(async () => (await worker.evaluate(id => chrome.tabs.get(id), monitorId)).active, 'Usage tab active');
    const before = requests.get(usageURL);
    await fireAlarm('monitor');
    assert.equal(requests.get(usageURL), before);
    await popup.bringToFront();
  });
  await check('watchdog recreates a closed monitor via a real Chrome alarm', async () => {
    await worker.evaluate(id => chrome.tabs.remove(id), monitorId);
    await eventually(async () => !(await state()).monitor, 'closed monitor state cleared');
    await fireAlarm('tick');
    const replacement = await monitor();
    assert.notEqual(replacement.id, monitorId); assert.equal(replacement.url || replacement.pendingUrl, usageURL);
    assert.equal(replacement.active, false);
    monitorId = replacement.id;
    monitorPage = await eventually(() => ctx.pages().find(page => page.url() === usageURL), 'replacement page');
    await selectSource(monitorId); await waitHero('27');
  });
  await check('navigated monitor is never refreshed as a conversation and watchdog replaces it', async () => {
    const oldId = monitorId;
    await monitorPage.goto(chatURL); await monitorPage.waitForSelector('#quota-watch-host');
    await eventually(async () => !(await state()).monitor, 'navigated monitor released');
    const before = requests.get(chatURL);
    await fireAlarm('monitor');
    const replacement = await monitor();
    assert.notEqual(replacement.id, oldId); assert.notEqual(replacement.id, chatId);
    assert.equal(replacement.url || replacement.pendingUrl, usageURL);
    await fireAlarm('tick');
    assert.equal(requests.get(chatURL), before);
    assert.equal(await monitorPage.locator('textarea').inputValue(), 'Fictional unsent draft');
    assert.deepEqual((await state()).tabs[oldId].rows, []);
    monitorId = replacement.id;
    await selectSource(monitorId); await waitHero('27');
  });
  await check('pause cancels refresh and survives watchdog events and popup reopen', async () => {
    await popup.locator('#monitor-toggle').click();
    await popup.waitForFunction(() => document.querySelector('#monitor-state').textContent === 'Automatic background refresh paused');
    assert.equal((await prefs()).autoMonitor, false);
    assert.equal(await worker.evaluate(() => chrome.alarms.get('monitor')), undefined);
    const before = requests.get(usageURL);
    await fireAlarm('tick');
    assert.equal((await state()).monitor, null);
    assert.equal(requests.get(usageURL), before);
    await popup.close(); await openPopup();
    assert.equal(await popup.locator('#monitor-state').textContent(), 'Automatic background refresh paused');
  });
  await check('stale readings leave the headline and clear removes all observed rows', async () => {
    await worker.evaluate(async id => {
      const { state } = await chrome.storage.session.get('state');
      for (const row of state.tabs[id].rows) row.observedAt = Date.now() - 20 * 60000;
      await chrome.storage.session.set({ state });
    }, monitorId);
    await selectSource(monitorId); await waitHero('—');
    assert.ok((await popup.locator('#cards').textContent()).includes('May be out of date'));
    await popup.locator('#preferences').evaluate(el => el.open = true);
    await popup.locator('#clear').click();
    await eventually(async () => Object.values((await state()).tabs).every(tab => tab.rows.length === 0), 'all readings cleared');
    await eventually(async () => await popup.locator('.card').count() === 0, 'popup cleared');
    assert.deepEqual(Object.keys(await worker.evaluate(() => chrome.storage.local.get(null))), ['settings']);
  });
  await check('browser restart preserves interval/language/pause preferences and clears session readings', async () => {
    await popup.locator('#interval').selectOption('5');
    await eventually(async () => (await prefs()).interval === 5, 'five-minute preference saved');
    await popup.locator('#language').selectOption('zh');
    await eventually(async () => (await prefs()).language === 'zh', 'Chinese preference saved');
    // Seed a synthetic marker in session storage so restart clearing is observable.
    await worker.evaluate(() => chrome.storage.session.set({ syntheticRestartMarker: true }));
    // Close fixtures before restart so Chrome session restoration cannot be mistaken
    // for the extension creating a tab while paused.
    for (const page of ctx.pages()) if (page !== popup) await page.close();
    await ctx.close(); ctx = null;
    await launch(); await openPopup();
    assert.equal(await popup.locator('#monitor-state').textContent(), '后台自动刷新已暂停');
    assert.equal(await popup.locator('#interval').inputValue(), '5');
    assert.equal(await popup.locator('#language').inputValue(), 'zh');
    assert.equal((await prefs()).threshold, 30);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('syntheticRestartMarker')), {});
    assert.equal(Object.values((await state()).tabs).length, 0);
    assert.equal((await state()).monitor, null);
    assert.equal(await worker.evaluate(() => chrome.alarms.get('monitor')), undefined);
    assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }))).length, 0);
  });
  await check('resume after restart creates a Usage tab and restores the selected interval', async () => {
    await popup.locator('#monitor-toggle').click();
    const tab = await monitor();
    assert.equal(tab.url || tab.pendingUrl, usageURL);
    assert.equal((await worker.evaluate(() => chrome.alarms.get('monitor'))).periodInMinutes, 5);
    await waitHero('27');
    assert.equal((await prefs()).autoMonitor, true);
    await snapshot('popup-zh-after-restart');
  });
  await check('no extension or fixture JavaScript errors', async () => assert.deepEqual(errors, []));
})().catch(async error => {
  try {
    diagnostics = await worker?.evaluate(async () => {
      const { state } = await chrome.storage.session.get('state');
      return {
        monitor: state?.monitor,
        tabs: (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl, active: tab.active, status: tab.status })),
        observations: Object.fromEntries(Object.entries(state?.tabs || {}).map(([id, tab]) => [id, { rowCount: tab.rows.length, lastScan: tab.lastScan }])),
        events: globalThis.__qwTestTabEvents,
      };
    });
    console.error('SYNTHETIC_BROWSER_DIAGNOSTICS ' + JSON.stringify(diagnostics));
  } catch (diagnosticError) { diagnostics = { unavailable: diagnosticError.message }; }
  failure = { check: currentCheck, message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { if (failure) await snapshot('failure'); } catch { /* Preserve original failure. */ }
  try { await ctx?.close(); } catch { /* Still write diagnostics and remove profile. */ }
  denyProxy.closeAllConnections();
  denyProxy.close();
  fs.rmSync(profile, { recursive: true, force: true });
  writeReport();
  console.log(`Browser report: ${reportPath}`);
});
