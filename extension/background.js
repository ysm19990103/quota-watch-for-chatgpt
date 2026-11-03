'use strict';
importScripts('core.js');
const Q=globalThis.QuotaWatch;
let queue=Promise.resolve();
function serialized(fn){const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;}
async function prefs(){return {...Q.DEFAULTS,...(await chrome.storage.local.get('settings')).settings};}
async function state(){return {tabs:{},monitor:null,notified:{},...(await chrome.storage.session.get('state')).state};}
async function save(s){await chrome.storage.session.set({state:s});}
function ownUI(sender){return sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));}
function site(sender){return sender.id===chrome.runtime.id && sender.tab?.id!==undefined && sender.frameId===0 && Q.isChatGPT(sender.url);}
async function tabSend(id,msg){try{return await chrome.tabs.sendMessage(Number(id),msg);}catch{return null;}}
async function configureMonitorAlarm(p){
  const current=await chrome.alarms.get('monitor');
  if(!current||current.periodInMinutes!==p.interval){
    if(current)await chrome.alarms.clear('monitor');
    await chrome.alarms.create('monitor',{periodInMinutes:p.interval,delayInMinutes:p.interval});
  }
}
async function clearMonitor(s){s.monitor=null;await chrome.alarms.clear('monitor');}
function monitorTab(tab){return Q.isSafeMonitor(tab.pendingUrl||tab.url);}
async function ensureMonitor(s,p){
  if(!p.autoMonitor){await clearMonitor(s);return {tab:null,created:false};}
  let tab=null,created=false;
  if(s.monitor){
    try{
      const candidate=await chrome.tabs.get(s.monitor.tabId);
      // Chrome can briefly omit both URL fields before a newly created tab's
      // first commit. Retain only the already tracked loading tab in that gap;
      // this is not permission to reload it or adopt an unrelated blank tab.
      if(monitorTab(candidate)||(candidate.status==='loading'&&!candidate.url&&!candidate.pendingUrl))tab=candidate;
    }catch{}
  }
  if(!tab){
    s.monitor=null;
    try{
      const candidates=await chrome.tabs.query({url:[`${Q.USAGE_URL}*`,'https://chatgpt.com/settings/usage*']});
      tab=candidates.filter(monitorTab).sort((a,b)=>Number(a.active)-Number(b.active))[0]||null;
    }catch{}
    if(!tab){tab=await chrome.tabs.create({url:Q.USAGE_URL,active:false});created=true;}
    s.monitor={tabId:tab.id};
  }
  await configureMonitorAlarm(p);
  return {tab,created};
}
async function showBadge(s,p){
  const monitor=s.monitor&&s.tabs[s.monitor.tabId];
  const r=Q.summary(monitor?.rows||[],Date.now(),p.interval);
  await chrome.action.setBadgeText({text:r?Math.floor(r.remaining)+'%':'—'});
  await chrome.action.setBadgeBackgroundColor({color:r&&r.remaining<=p.threshold?'#a65030':'#176149'});
  await chrome.action.setTitle({title:r?`Quota Watch · ${Q.formatPercent(r.remaining)}% remaining · monitor tab`:'Quota Watch · open to read ChatGPT usage'});
  for(const [id,v] of Object.entries(s.tabs)){
    const row=Q.summary(v.rows,Date.now(),p.interval);
    try{
      await chrome.action.setBadgeText({tabId:Number(id),text:row?Math.floor(row.remaining)+'%':r?'':'—'});
      await chrome.action.setBadgeBackgroundColor({tabId:Number(id),color:row&&row.remaining<=p.threshold?'#a65030':'#176149'});
      await chrome.action.setTitle({tabId:Number(id),title:row?`Quota Watch · ${Q.formatPercent(row.remaining)}% remaining · this tab`:'Quota Watch · no fresh reading in this tab'});
    }catch{delete s.tabs[id];}
  }
}
async function notice(title,message,id){try{await chrome.notifications.create(id,{type:'basic',iconUrl:'icons/128.png',title,message});return true;}catch{return false;}}
async function alerts(s,p){
  if(!p.notifications || !(await chrome.permissions.contains({permissions:['notifications']})))return;
  const lang=Q.language(p.language,chrome.i18n.getUILanguage());
  const entries=s.monitor ? [[String(s.monitor.tabId),s.tabs[s.monitor.tabId]]] : Object.entries(s.tabs);
  for(const [tabId,v] of entries){for(const r of v?.rows||[]){
    const base=`${tabId}:${r.id}:${r.resetAt||'unknown'}`;
    const status=Q.rowStatus(r,Date.now(),p.interval);
    if(status==='fresh'&&r.remaining<=p.threshold&&!s.notified['low:'+base]){if(await notice(Q.tr(lang,'low'),`${Q.rowTitle(r,lang)}: ${Q.formatPercent(r.remaining)}% ${Q.tr(lang,'remaining')}`,'qw-low'))s.notified['low:'+base]=Date.now();}
    if(status==='fresh'&&r.remaining>p.threshold)delete s.notified['low:'+base];
    if(status==='expired'&&!s.notified['reset:'+base]){if(await notice(Q.tr(lang,'resetDue'),Q.tr(lang,'resetBody'),'qw-reset'))s.notified['reset:'+base]=Date.now();}
  }}
  for(const [key,time] of Object.entries(s.notified))if(Date.now()-time>8*86400000)delete s.notified[key];
}
async function view(requested){
  const s=await state(),p=await prefs();
  const active=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
  let selected=requested!==undefined&&s.tabs[requested]?Number(requested):null;
  if(selected===null && active&&s.tabs[active.id]?.rows.length)selected=active.id;
  if(selected===null && s.monitor)selected=s.monitor.tabId;
  if(selected===null)selected=Number(Object.entries(s.tabs).sort((a,b)=>(b[1].lastScan||0)-(a[1].lastScan||0))[0]?.[0])||null;
  return {ok:true,settings:p,monitor:!!p.autoMonitor,selected,activeId:active?.id,source:selected===s.monitor?.tabId?'monitorTab':selected===active?.id?'active':'otherTab',rows:s.tabs[selected]?.rows||[],tabs:Object.entries(s.tabs).map(([id,v])=>({id:Number(id),rows:v.rows.length,monitor:Number(id)===s.monitor?.tabId,active:Number(id)===active?.id})),lastScan:s.tabs[selected]?.lastScan||null};
}
async function openUsage(s,p){
  if(p.autoMonitor){
    try{const {tab}=await ensureMonitor(s,p);await save(s);if(tab){await chrome.tabs.update(tab.id,{active:true});return;}}catch{await clearMonitor(s);await save(s);}
  }
  await chrome.tabs.create({url:Q.USAGE_URL});
}
async function handle(m,sender){
  if(!m||typeof m.type!=='string')return {ok:false};
  if(site(sender)){
    const s=await state(),p=await prefs(),id=sender.tab.id;
    if(m.type==='HELLO'){
      s.tabs[id]={rows:[],documentId:sender.documentId,lastScan:0};
      await showBadge(s,p);await save(s);return {ok:true,settings:p};
    }
    if(m.type==='OBSERVE'){
      if(!s.tabs[id]||s.tabs[id].documentId!==sender.documentId)return {ok:false};
      if(!Array.isArray(m.rows)||m.rows.length>12)return {ok:false};
      const rows=m.rows.map(r=>Q.sanitizeRow(r)).filter(Boolean);
      s.tabs[id].rows=rows;s.tabs[id].lastScan=Date.now();await alerts(s,p);await showBadge(s,p);await save(s);return {ok:true};
    }
    if(m.type==='HIDE_WIDGET'){p.widget=false;await chrome.storage.local.set({settings:p});for(const id of Object.keys(s.tabs))await tabSend(id,{type:'PREFS',settings:p});return {ok:true};}
    if(m.type==='OPEN_USAGE'){await openUsage(s,p);return {ok:true};}
    return {ok:false};
  }
  if(!ownUI(sender))return {ok:false};
  const s=await state(),p=await prefs();
  if(m.type==='GET')return view(m.selected);
  if(m.type==='OPEN_USAGE'){await openUsage(s,p);return {ok:true};}
  if(m.type==='START'){
    p.autoMonitor=true;await chrome.storage.local.set({settings:p});await ensureMonitor(s,p);await showBadge(s,p);await save(s);return {ok:true};
  }
  if(m.type==='STOP'){p.autoMonitor=false;await chrome.storage.local.set({settings:p});await clearMonitor(s);await showBadge(s,p);await save(s);return {ok:true};}
  if(m.type==='SCAN'){
    const v=await view(m.selected);const id=v.selected||v.activeId;
    if(!id)return {ok:false,error:'notReady'};
    return await tabSend(id,{type:'SCAN'})||{ok:false,error:'notReady'};
  }
  if(m.type==='SETTINGS'){
    const q=m.settings||{};
    if(['en','zh','auto'].includes(q.language))p.language=q.language;
    if(typeof q.widget==='boolean')p.widget=q.widget;
    if(typeof q.autoMonitor==='boolean')p.autoMonitor=q.autoMonitor;
    if([1,2,5,10].includes(q.interval))p.interval=q.interval;
    if([10,20,30].includes(q.threshold))p.threshold=q.threshold;
    if(typeof q.notifications==='boolean')p.notifications=q.notifications&&await chrome.permissions.contains({permissions:['notifications']});
    await chrome.storage.local.set({settings:p});
    await ensureMonitor(s,p);await save(s);
    for(const id of Object.keys(s.tabs))await tabSend(id,{type:'PREFS',settings:p});
    await showBadge(s,p);return {ok:true};
  }
  if(m.type==='CLEAR'){
    for(const [id,v] of Object.entries(s.tabs)){v.rows=[];v.lastScan=0;await tabSend(id,{type:'CLEAR_LOCAL'});}s.notified={};await showBadge(s,p);await save(s);return {ok:true};
  }
  return {ok:false};
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  // A scan sends an OBSERVE reply back to this worker. Never hold the write queue
  // while waiting for that content-script round trip.
  const task=m?.type==='SCAN'&&ownUI(sender)?handle(m,sender):serialized(()=>handle(m,sender));
  task.then(respond,()=>respond({ok:false,error:'notReady'}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>serialized(async()=>{
  const s=await state(),p=await prefs();
  if(alarm.name==='tick')await ensureMonitor(s,p);
  if(alarm.name==='monitor'&&p.autoMonitor){
    const result=await ensureMonitor(s,p);
    if(result.tab&&!result.created){
      // ensureMonitor awaits alarm setup. Its Tab is a snapshot that may now
      // describe a conversation or an in-flight navigation; recheck at use.
      let tab;try{tab=await chrome.tabs.get(result.tab.id);}catch{}
      if(tab&&Q.isSafeMonitor(tab.url)&&!tab.pendingUrl&&tab.status!=='loading'){
        if(!tab.active)await chrome.tabs.reload(tab.id);
        else tabSend(tab.id,{type:'SCAN'}).catch(()=>{});
      }
    }
  }else if(alarm.name==='monitor'){
    await clearMonitor(s);
  }
  await alerts(s,p);await showBadge(s,p);await save(s);
}).catch(()=>{}));
chrome.tabs.onRemoved.addListener(id=>serialized(async()=>{const s=await state();delete s.tabs[id];if(s.monitor?.tabId===id){s.monitor=null;await chrome.alarms.clear('monitor');}await showBadge(s,await prefs());await save(s);}).catch(()=>{}));
chrome.tabs.onUpdated.addListener((id,change)=>{
  if(change.status!=='loading'&&!change.url)return;
  serialized(async()=>{const s=await state();if(!s.tabs[id]&&s.monitor?.tabId!==id)return;if(change.status==='loading')delete s.tabs[id];
    if(change.url&&s.monitor?.tabId===id&&!Q.isSafeMonitor(change.url)){s.monitor=null;await chrome.alarms.clear('monitor');}
    if(change.url)delete s.tabs[id];await showBadge(s,await prefs());await save(s);
  }).catch(()=>{});
});
async function init(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});if(!await chrome.alarms.get('tick'))await chrome.alarms.create('tick',{periodInMinutes:1});await serialized(async()=>{const s=await state(),p=await prefs();await ensureMonitor(s,p);await showBadge(s,p);await save(s);});}
chrome.runtime.onInstalled.addListener(()=>init().catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>init().catch(()=>{}));
init().catch(()=>{});
