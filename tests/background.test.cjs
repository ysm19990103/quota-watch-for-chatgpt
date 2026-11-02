const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const Q=require('../extension/core.js');
function event(){const listeners=[];return {listeners,addListener:f=>listeners.push(f)};}
function harness(options={}){
 const data={local:{settings:{autoMonitor:false,...options.settings}},session:{}},tabs=new Map((options.tabs||[]).map(tab=>[tab.id,{...tab}])),alarms=new Map(),badges=new Map(),messages=[],reloads=[],notifications=[];
 const storage=kind=>({get:async key=>key?{[key]:structuredClone(data[kind][key])}:structuredClone(data[kind]),set:async v=>Object.assign(data[kind],structuredClone(v)),setAccessLevel:async()=>{}});
 let id=40,allowNotifications=false;
 const chrome={
   runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:event(),onInstalled:event(),onStartup:event()},
   i18n:{getUILanguage:()=> 'en'},storage:{local:storage('local'),session:storage('session')},
   alarms:{onAlarm:event(),get:async n=>alarms.get(n),create:async(n,v)=>alarms.set(n,v),clear:async n=>alarms.delete(n)},
   action:{setBadgeText:async v=>badges.set(v.tabId??'global',v.text),setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
   permissions:{contains:async()=>allowNotifications},notifications:{create:async(n,v)=>{notifications.push(v);return n;}},
   tabs:{onRemoved:event(),onUpdated:event(),query:async info=>[...tabs.values()].filter(tab=>(info?.active===undefined||tab.active===info.active)&&(!info?.url||(Array.isArray(info.url)?info.url:[info.url]).some(pattern=>tab.url?.startsWith(pattern.replace(/\*+$/,''))))),get:async id=>{if(!tabs.has(id))throw Error('No tab');return tabs.get(id);},create:async opts=>{if(opts.active!==false)for(const tab of tabs.values())tab.active=false;const t={id:++id,status:'complete',active:opts.active!==false,...opts};tabs.set(id,t);return t;},update:async(id,v)=>{if(!tabs.has(id))throw Error('No tab');if(v.active)for(const tab of tabs.values())tab.active=false;return Object.assign(tabs.get(id),v);},reload:async id=>reloads.push(id),sendMessage:async(id,m)=>{messages.push({id,m});return {ok:true,found:true};}}
 };
 const ctx=vm.createContext({chrome,QuotaWatch:Q,importScripts:()=>{},console,URL,Date,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),ctx);
 const call=async(m,sender)=>{let done;const result=new Promise(r=>done=r);chrome.runtime.onMessage.listeners[0](m,sender,done);return await result;};
 const ui={id:'test',url:'chrome-extension://test/popup.html'};
 const site=(id=1,doc='doc1')=>({id:'test',url:'https://chatgpt.com/codex/settings/usage',tab:{id},frameId:0,documentId:doc});
 const ready=async()=>{await new Promise(resolve=>setImmediate(resolve));await vm.runInContext('queue',ctx);};
 return {chrome,ctx,data,tabs,alarms,badges,messages,reloads,notifications,call,ui,site,ready,allow:()=>allowNotifications=true};
}
test('site cannot enable monitoring, edit preferences or clear another tab',async()=>{
 const h=harness();await h.ready();for(const type of ['START','STOP','SETTINGS','CLEAR','GET'])assert.equal((await h.call({type,settings:{notifications:true}},h.site())).ok,false,type);
 assert.equal(h.tabs.size,0);
});
test('foreign origins, foreign extensions and child frames cannot write usage',async()=>{
 const h=harness();await h.ready();for(const sender of [{...h.site(),url:'https://evil.test'},{...h.site(),id:'evil'},{...h.site(),frameId:1}])assert.equal((await h.call({type:'HELLO'},sender)).ok,false);
});
test('new document discards previous account readings and rejects delayed old document messages',async()=>{
 const h=harness();await h.ready();h.tabs.set(1,{id:1,active:true,url:Q.USAGE_URL});
 await h.call({type:'HELLO'},h.site());const row=Q.parseCard('Weekly\n20% remaining');await h.call({type:'OBSERVE',rows:[row]},h.site());
 assert.equal(h.data.session.state.tabs[1].rows.length,1);
 await h.call({type:'HELLO'},h.site(1,'newdoc'));assert.equal(h.data.session.state.tabs[1].rows.length,0);
 assert.equal((await h.call({type:'OBSERVE',rows:[row]},h.site())).ok,false);
});
test('one tab cannot replace a different tab reading; payload stores only normalized fields',async()=>{
 const h=harness();await h.ready();
 for(const id of [1,2]){h.tabs.set(id,{id,active:id===1,url:Q.USAGE_URL});await h.call({type:'HELLO'},h.site(id));await h.call({type:'OBSERVE',tabId:99,rows:[{...Q.parseCard(`Weekly\n${id*20}% remaining`),email:'fictional@example.test'}]},h.site(id));}
 assert.equal(h.data.session.state.tabs[1].rows[0].remaining,20);assert.equal(h.data.session.state.tabs[2].rows[0].remaining,40);assert.equal(h.data.session.state.tabs[99],undefined);assert.equal(JSON.stringify(h.data.session).includes('@'),false);
});
test('monitor reloads only its background Usage page',async()=>{
 const h=harness();await h.ready();await h.call({type:'START'},h.ui);const id=h.data.session.state.monitor.tabId;
 await h.chrome.alarms.onAlarm.listeners[0]({name:'monitor'});assert.deepEqual(h.reloads,[id]);
 h.tabs.get(id).active=true;await h.chrome.alarms.onAlarm.listeners[0]({name:'monitor'});assert.deepEqual(h.reloads,[id]);assert.equal(h.messages.at(-1).m.type,'SCAN');
 h.tabs.get(id).url='https://chatgpt.com/c/fictional';h.tabs.get(id).active=false;await h.chrome.alarms.onAlarm.listeners[0]({name:'monitor'});await h.ready();assert.deepEqual(h.reloads,[id]);const replacement=h.data.session.state.monitor.tabId;assert.notEqual(replacement,id);assert.equal(h.tabs.get(replacement).url,Q.USAGE_URL);
});
test('automatic monitoring starts in the background and refreshes without a manual START',async()=>{
 const h=harness({settings:{autoMonitor:true,interval:1}});await h.ready();
 assert.equal(h.tabs.size,1);const id=h.data.session.state.monitor.tabId;assert.equal(h.tabs.get(id).url,Q.USAGE_URL);assert.equal(h.tabs.get(id).active,false);assert.equal(h.alarms.get('monitor').periodInMinutes,1);
 h.chrome.alarms.onAlarm.listeners[0]({name:'monitor'});await h.ready();assert.deepEqual(h.reloads,[id]);
});
test('closing monitor tab stops scheduled reloads',async()=>{
 const h=harness();await h.ready();await h.call({type:'START'},h.ui);const id=h.data.session.state.monitor.tabId;
 h.tabs.delete(id);h.chrome.tabs.onRemoved.listeners[0](id);await h.ready();assert.equal(h.data.session.state.monitor,null);assert.equal(h.alarms.has('monitor'),false);
});
test('watchdog recreates an automatically monitored Usage tab after it is closed',async()=>{
 const h=harness({settings:{autoMonitor:true}});await h.ready();const old=h.data.session.state.monitor.tabId;
 h.tabs.delete(old);h.chrome.tabs.onRemoved.listeners[0](old);await h.ready();assert.equal(h.data.session.state.monitor,null);
 h.chrome.alarms.onAlarm.listeners[0]({name:'tick'});await h.ready();const replacement=h.data.session.state.monitor.tabId;assert.notEqual(replacement,old);assert.equal(h.tabs.get(replacement).url,Q.USAGE_URL);assert.equal(h.tabs.get(replacement).active,false);
});
test('watchdog replaces a monitor that navigates away without reloading that page',async()=>{
 const h=harness({settings:{autoMonitor:true}});await h.ready();const old=h.data.session.state.monitor.tabId;
 h.tabs.get(old).url='https://chatgpt.com/c/fictional';h.chrome.tabs.onUpdated.listeners[0](old,{url:h.tabs.get(old).url,status:'loading'});await h.ready();assert.equal(h.data.session.state.monitor,null);
 h.chrome.alarms.onAlarm.listeners[0]({name:'tick'});await h.ready();assert.notEqual(h.data.session.state.monitor.tabId,old);assert.deepEqual(h.reloads,[]);
});
test('pausing automatic refresh persists and prevents watchdog recreation',async()=>{
 const h=harness({settings:{autoMonitor:true}});await h.ready();const count=h.tabs.size;
 await h.call({type:'STOP'},h.ui);h.chrome.alarms.onAlarm.listeners[0]({name:'tick'});await h.ready();assert.equal(h.data.local.settings.autoMonitor,false);assert.equal(h.data.session.state.monitor,null);assert.equal(h.tabs.size,count);assert.equal(h.alarms.has('monitor'),false);
});
test('startup adopts an existing exact Usage tab instead of creating a duplicate',async()=>{
 const existing={id:7,url:'https://chatgpt.com/settings/usage',active:false,status:'complete'};const h=harness({settings:{autoMonitor:true},tabs:[existing]});await h.ready();
 assert.equal(h.tabs.size,1);assert.equal(h.data.session.state.monitor.tabId,7);assert.ok(h.alarms.has('monitor'));
});
test('notification preference requires separately granted permission',async()=>{
 const h=harness();await h.ready();await h.call({type:'SETTINGS',settings:{notifications:true}},h.ui);assert.equal(h.data.local.settings.notifications,false);
 h.allow();await h.call({type:'SETTINGS',settings:{notifications:true}},h.ui);assert.equal(h.data.local.settings.notifications,true);
});
test('low-usage notification deduplicates; reset alert does not grant allowance',async()=>{
 const h=harness();await h.ready();h.allow();await h.call({type:'SETTINGS',settings:{notifications:true}},h.ui);h.tabs.set(1,{id:1,active:true,url:Q.USAGE_URL});await h.call({type:'HELLO'},h.site());
 const row=Q.parseCard('Weekly\n10% remaining\nResets in 1m');await h.call({type:'OBSERVE',rows:[row]},h.site());await h.call({type:'OBSERVE',rows:[row]},h.site());assert.equal(h.notifications.length,1);
 row.resetAt=Date.now()-1000;await h.call({type:'OBSERVE',rows:[row]},h.site());assert.equal(h.notifications.length,2);assert.equal(h.data.session.state.tabs[1].rows[0].remaining,10);assert.equal(h.badges.get(1),'—');
});
test('background worker restart reconstructs quota from session storage',async()=>{
 const h=harness();await h.ready();h.data.local.settings.autoMonitor=true;h.data.session.state={tabs:{1:{documentId:'x',rows:[Q.parseCard('Weekly\n55% remaining')]}},monitor:{tabId:1},notified:{}};h.tabs.set(1,{id:1,active:false,url:Q.USAGE_URL});await vm.runInContext('init()',h.ctx);assert.equal(h.badges.get('global'),'55%');assert.ok(h.alarms.has('monitor'));
});
test('read-current-page round trip can write usage while request is waiting',async()=>{
 const h=harness();await h.ready();h.tabs.set(1,{id:1,active:true,url:Q.USAGE_URL});await h.call({type:'HELLO'},h.site());
 h.chrome.tabs.sendMessage=async(id,m)=>{if(m.type==='SCAN'){await h.call({type:'OBSERVE',rows:[Q.parseCard('Weekly\n25% remaining')]},h.site());return {ok:true,found:true};}};
 const result=await Promise.race([h.call({type:'SCAN',selected:1},h.ui),new Promise((_,reject)=>setTimeout(()=>reject(Error('Deadlock')),500))]);
 assert.equal(result.found,true);assert.equal(h.data.session.state.tabs[1].rows[0].remaining,25);
});
