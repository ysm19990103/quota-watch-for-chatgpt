'use strict';
const Q=globalThis.QuotaWatch,$=id=>document.getElementById(id);
let current=null,selected,refreshing=false;
const lang=()=>Q.language(current?.settings.language||'auto',navigator.language);
const t=key=>Q.tr(lang(),key);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function send(msg){try{return await chrome.runtime.sendMessage(msg);}catch{return {ok:false,error:'notReady'};}}
function feedback(key){$('feedback').textContent=t(key);}
function render(){
  if(!current)return;
  document.documentElement.lang=lang()==='zh'?'zh-CN':'en';
  for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=t(e.getAttribute('data-i18n'));
  const now=Date.now(),s=current.settings,rows=current.rows;
  const lead=Q.summary(rows,now,s.interval);
  $('hero-value').textContent=lead?Q.formatPercent(lead.remaining):'—';$('hero-unit').textContent=lead?'%':'';
  $('freshness').textContent=lead?t('fresh'):rows.length?t('stale'):t('unknown');
  $('hero-caption').textContent=lead?Q.rowTitle(lead,lang()):rows.length?t('refresh'):t('needData');
  $('hero-value').title=t('lowHint');
  const newest=rows.length?Math.max(...rows.map(r=>r.observedAt)):null;
  $('seen').textContent=t('seen')+' · '+Q.age(newest,now,lang());
  const source=$('source-select');source.replaceChildren();
  for(const v of current.tabs){const label=(v.monitor?t('monitorTab'):v.active?t('active'):t('otherTab'))+` · #${v.id}`;const option=node('option',label);option.value=v.id;option.selected=v.id===current.selected;source.append(option);}
  if(!current.tabs.length){const option=node('option',t('never'));option.value='';source.append(option);}source.disabled=!current.tabs.length;
  $('cards').replaceChildren();
  for(const r of rows){
    const status=Q.rowStatus(r,now,s.interval);const card=node('section',undefined,'card '+status+(r.remaining<=s.threshold?' low':''));
    const head=node('div',undefined,'card-head');head.append(node('h2',Q.rowTitle(r,lang())));
    const value=node('div',Q.formatPercent(r.remaining)+'%','value');value.append(node('small',' '+t(status==='fresh'?'remaining':'last')));head.append(value);card.append(head);
    const track=node('div',undefined,'track');track.setAttribute('role','meter');track.setAttribute('aria-label',Q.rowTitle(r,lang())+' '+t('remaining'));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(r.remaining));const fill=node('div',undefined,'fill');fill.style.width=r.remaining+'%';track.append(fill);card.append(track);
    const meta=node('div',undefined,'meta');meta.append(node('span',t('page')),node('span',Q.age(r.observedAt,now,lang())));card.append(meta);
    if(r.resetAt){card.append(node('p',t('reset')+' · '+Q.duration(r.resetAt-now,lang()),'reset'));card.append(node('div',new Intl.DateTimeFormat(lang()==='zh'?'zh-CN':'en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(r.resetAt))+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone,'absolute'));}
    else card.append(node('p',r.resetLabel?t('reset')+' · '+r.resetLabel:t('noReset'),'reset'));
    if(status!=='fresh')card.append(node('p',t(status),'old'));
    $('cards').append(card);
  }
  $('empty').hidden=!!rows.length;
  $('monitor-state').textContent=t(current.monitor?'monitorOn':'monitorOff');
  $('monitor-frequency').textContent=current.monitor?`${s.interval} ${t('minutes')}`:'';
  $('monitor-toggle').textContent=t(current.monitor?'stop':'start');
  for(const id of ['widget','notifications'])$(id).checked=s[id];
  for(const id of ['interval','threshold','language'])$(id).value=String(s[id]);
}
async function refresh(){if(refreshing)return;refreshing=true;try{const result=await send({type:'GET',selected});if(result?.ok){current=result;render();}}finally{refreshing=false;}}
async function settings(patch){await send({type:'SETTINGS',settings:patch});await refresh();}
$('open').onclick=async()=>{await send({type:'OPEN_USAGE'});window.close();};
$('scan').onclick=async()=>{const r=await send({type:'SCAN',selected:current?.selected});feedback(r?.ok?(r.found?'fresh':'readFailed'):(r?.error||'notReady'));await refresh();};
$('monitor-toggle').onclick=async()=>{const wasOn=current?.monitor;const r=await send({type:wasOn?'STOP':'START'});selected=undefined;if(r?.ok)feedback(wasOn?'monitorOff':'started');await refresh();};
$('source-select').onchange=e=>{selected=Number(e.target.value);refresh();};
$('widget').onchange=e=>settings({widget:e.target.checked});
$('notifications').onchange=async e=>{let enabled=e.target.checked;if(enabled)enabled=await chrome.permissions.request({permissions:['notifications']});if(!enabled&&e.target.checked)feedback('denied');await settings({notifications:enabled});};
for(const id of ['interval','threshold'])$(id).onchange=e=>settings({[id]:Number(e.target.value)});
$('language').onchange=e=>settings({language:e.target.value});
$('language-toggle').onclick=()=>settings({language:lang()==='zh'?'en':'zh'});
$('clear').onclick=async()=>{await send({type:'CLEAR'});feedback('cleared');await refresh();};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'||area==='local')refresh();});
setInterval(refresh,1000);
refresh();
