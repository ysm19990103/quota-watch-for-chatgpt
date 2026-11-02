/* Pure parsing and presentation helpers. No network, page access or Chrome APIs. */
(function (root) {
  'use strict';
  const VERSION = 2;
  const DEFAULTS = Object.freeze({language:'auto', widget:true, autoMonitor:true, interval:1, threshold:20, notifications:false});
  const USAGE_URL = 'https://chatgpt.com/codex/settings/usage';
  const TEXT = {
    en: {title:'Quota Watch',subtitle:'ChatGPT usage, at a glance',remaining:'remaining',unknown:'Not available',empty:'Open Usage to read your allowance',emptyDetail:'Only numbers reported by ChatGPT are shown. There is no message-count estimate.',open:'Open Usage',scan:'Read current page',start:'Start live monitor',stop:'Stop monitor',monitorHint:'Opens a separate Usage tab. Reloads it only while it is in the background.',monitorOn:'Background monitor running',monitorOff:'Background monitor off',source:'Source',page:'ChatGPT Usage interface',seen:'Last observed',stale:'May be out of date',fresh:'Recently observed',expired:'Reset time passed · refresh needed',reset:'Resets',noReset:'Reset time not exposed',refresh:'Refresh Usage to verify',never:'No reading yet',settings:'Preferences',widget:'Show panel on ChatGPT',alerts:'Low allowance / reset-time alerts',interval:'Monitor interval',threshold:'Alert below',language:'Language',automatic:'Automatic',minutes:'min',clear:'Clear readings',privacy:'Local only · no API key · no chat text stored',scope:'Only exposed quotas are shown. Work/Codex allowances may be shared; regular Chat model quotas may be unavailable.',tab:'Reading from',active:'this ChatGPT tab',monitorTab:'the monitor tab',otherTab:'another ChatGPT tab',dashboard:'Usage dashboard',resetDue:'Reset time reached',resetBody:'The reported reset time has passed. Open Usage to confirm your new allowance.',low:'Low ChatGPT allowance',readFailed:'No readable quota found. Open Settings → Usage, then read again.',started:'Monitor started. Keep its Usage tab open.',cleared:'Readings cleared.',notReady:'Reload your ChatGPT tab after installing the extension.',notice:'Status',last:'Last reported',needData:'Awaiting a fresh reading',beta:'BETA',monitorPaused:'Monitor stopped: Usage tab closed or navigated away.',denied:'Notification permission was not granted.',inspect:'How it works',help:'Reads visible usage cards. Updates when ChatGPT changes them. The monitor reloads its dedicated background Usage tab; it never reloads your conversations. Unknown layouts remain unavailable.',help2:'Data stays in this Chrome session and is cleared when Chrome restarts. Only your preferences persist. This is an independent extension, not an OpenAI product.',lowHint:'Lowest remaining value among observed quota windows',window:'Usage window',primary:'Primary window',secondary:'Secondary window',hours:'hour',days:'day',weekly:'Weekly',monthly:'Monthly',daily:'Daily',work:'Work / Codex',reported:'Reported allowance',code:'Code review',research:'Deep research',messages:'messages remaining',used:'used',lastScan:'Page checked',waiting:'Waiting for Usage page',monitorDetail:'Refreshes may be delayed while Chrome sleeps. Active Usage tabs are not reloaded.'},
    zh: {title:'Quota Watch',subtitle:'随时查看 ChatGPT 剩余额度',remaining:'剩余',unknown:'暂无数据',empty:'打开“用量”读取剩余额度',emptyDetail:'仅显示 ChatGPT 已报告的数值，不按消息条数估算额度。',open:'打开用量页面',scan:'读取当前页面',start:'开启实时监测',stop:'停止监测',monitorHint:'打开独立用量标签页；仅在该页处于后台时自动刷新。',monitorOn:'后台监测运行中',monitorOff:'后台监测未开启',source:'数据来源',page:'ChatGPT 用量界面',seen:'上次读取',stale:'数据可能已过时',fresh:'近期读取',expired:'重置时间已到 · 需刷新确认',reset:'重置',noReset:'未提供重置时间',refresh:'刷新用量页面以确认',never:'尚无读数',settings:'设置',widget:'在 ChatGPT 页面显示悬浮面板',alerts:'低额度 / 重置时间提醒',interval:'监测间隔',threshold:'低于此值提醒',language:'语言',automatic:'自动',minutes:'分钟',clear:'清除读数',privacy:'仅本地处理 · 无需 API 密钥 · 不存储聊天内容',scope:'仅显示页面公开的额度。Work / Codex 可能共享额度；普通聊天模型的剩余额度可能无法读取。',tab:'读数来自',active:'当前 ChatGPT 标签页',monitorTab:'监测标签页',otherTab:'其他 ChatGPT 标签页',dashboard:'用量页面',resetDue:'已到报告的重置时间',resetBody:'页面报告的重置时间已到，请打开用量页面确认新额度。',low:'ChatGPT 剩余额度较低',readFailed:'未找到可读取的额度。请打开“设置 → 用量”后再读取。',started:'监测已开启，请保留用量标签页。',cleared:'已清除读数。',notReady:'安装后请刷新 ChatGPT 标签页。',notice:'状态',last:'上次报告',needData:'等待新读数',beta:'测试版',monitorPaused:'监测已停止：用量标签页已关闭或跳转。',denied:'未获得通知权限。',inspect:'工作方式',help:'读取用量界面的额度卡片；数值变化时自动更新。监测功能只刷新独立后台用量标签页，不刷新对话。不支持的页面结构显示暂无数据。',help2:'读数仅保存在本次 Chrome 会话中，重启后清除；仅偏好设置持久保存。本扩展为独立产品，并非 OpenAI 官方产品。',lowHint:'已观察到的额度窗口中的最低剩余值',window:'额度窗口',primary:'主额度窗口',secondary:'次额度窗口',hours:'小时',days:'天',weekly:'每周',monthly:'每月',daily:'每日',work:'Work / Codex',reported:'页面报告的额度',code:'代码审查',research:'深度研究',messages:'条消息剩余',used:'已使用',lastScan:'页面检查时间',waiting:'等待用量页面',monitorDetail:'Chrome 休眠可能延迟刷新；正在查看的用量标签页不会被重载。'}
  };
  Object.assign(TEXT.en,{
    start:'Resume automatic refresh',
    stop:'Pause automatic refresh',
    monitorHint:'Keeps a separate Usage tab open and refreshes it automatically in the background.',
    monitorOn:'Automatic background refresh on',
    monitorOff:'Automatic background refresh paused',
    started:'Automatic background refresh resumed.',
    monitorPaused:'Automatic background refresh is paused.',
    help:'Reads visible usage cards. A dedicated Usage tab is opened automatically and refreshed only while it is in the background; conversations are never reloaded. Unknown layouts remain unavailable.',
    help2:'Data stays in this Chrome session and is cleared when Chrome restarts. Preferences persist, including whether automatic refresh is paused. This is an independent extension, not an OpenAI product.',
    monitorDetail:'The Usage tab is restored automatically if it closes or navigates away. Refreshes may be delayed while Chrome sleeps; an active Usage tab is scanned without reloading.'
  });
  Object.assign(TEXT.zh,{
    start:'恢复自动刷新',
    stop:'暂停自动刷新',
    monitorHint:'自动保留独立用量标签页，并在后台定时刷新。',
    monitorOn:'后台自动刷新已开启',
    monitorOff:'后台自动刷新已暂停',
    started:'后台自动刷新已恢复。',
    monitorPaused:'后台自动刷新已暂停。',
    help:'读取用量界面的额度卡片；自动打开独立用量标签页，仅在后台时定时刷新，绝不重载对话。不支持的页面结构显示暂无数据。',
    help2:'读数仅保存在本次 Chrome 会话中，重启后清除；偏好设置（包括是否暂停自动刷新）会保留。本扩展为独立产品，并非 OpenAI 官方产品。',
    monitorDetail:'用量标签页被关闭或跳转后会自动恢复。Chrome 休眠可能延迟刷新；正在查看的用量页只扫描而不重载。'
  });
  function language(pref='auto', browser='en') { return pref==='zh'||(pref==='auto' && /^zh/i.test(browser))?'zh':'en'; }
  function tr(lang,key) { return (TEXT[lang]||TEXT.en)[key] || TEXT.en[key] || key; }
  function isChatGPT(raw) { try {const u=new URL(raw);return u.protocol==='https:' && u.hostname==='chatgpt.com';}catch{return false;} }
  function isUsagePage(raw) { try {const u=new URL(raw);return isChatGPT(raw) && (/^\/(?:codex\/)?settings\/usage\/?$/i.test(u.pathname) || /^#settings\/(?:usage|limits)(?:\/|$)/i.test(u.hash));}catch{return false;} }
  function isSafeMonitor(raw) { try {const u=new URL(raw);return isChatGPT(raw) && /^\/(?:codex\/)?settings\/usage\/?$/i.test(u.pathname) && !u.search && !u.hash;}catch{return false;} }
  function percent(n) { return typeof n==='number' && Number.isFinite(n) && n>=0 && n<=100 ? n : null; }
  function normalizeText(text) {return String(text||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();}
  // Require explicit remaining/used wording; a naked progress-bar percentage is ambiguous.
  function readPercent(text) {
    const s=normalizeText(text); const values=[];
    if(/[-−]\s*\d+(?:\.\d+)?\s*%/.test(s))return null;
    const rules=[
      [/(\d+(?:\.\d+)?)\s*%\s*(?:remaining|left|available)\b/ig,false],
      [/\b(?:remaining|left|available)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/ig,false],
      [/(?:剩余|剩餘|可用)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/g,false],
      [/(\d+(?:\.\d+)?)\s*%\s*(?:剩余|剩餘|可用)/g,false],
      [/(\d+(?:\.\d+)?)\s*%\s*(?:used|consumed)\b/ig,true],
      [/\b(?:used|consumed)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/ig,true],
      [/(?:已使用|已用|已消耗)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/g,true],
      [/(\d+(?:\.\d+)?)\s*%\s*(?:已使用|已用|已消耗)/g,true]
    ];
    for (const [re,invert] of rules) for(const m of s.matchAll(re)) {const n=percent(Number(m[1])); if(n===null)return null; values.push(invert?100-n:n);}
    if(!values.length)return null;
    if(values.some(n=>Math.abs(n-values[0])>0.11))return null;
    return Math.round(values[0]*100)/100;
  }
  function classify(text) {
    const s=normalizeText(text);
    let period=null, minutes=null;
    if(/weekly|\bweek\b|每周|每週|周限额|週限額|本周|本週/i.test(s)){period='weekly';minutes=10080;}
    else if(/monthly|\bmonth\b|每月|月限额|本月/i.test(s)){period='monthly';}
    else if(/daily|\bdaily limit\b|每日|每天|日限额/i.test(s)){period='daily';minutes=1440;}
    else {const h=s.match(/(?:^|\s)(\d{1,3})[ -]?(?:hours?|hrs?|小时|小時)(?:\s*(?:usage|limit|额度|限额|用量))?/i);if(h && !/\breset|重置/i.test(s.slice(0,h.index))){period='hours';minutes=Number(h[1])*60;}}
    let scope='reported';
    const model=s.match(/\b(?:GPT[- ]?\d+(?:\.\d+)?(?:[- ](?:mini|nano|pro|thinking|instant|astra|sol|terra|luna))?|o[134](?:-mini)?)(?:\b|$)/i);
    if(model)scope=model[0].replace(/\s+/g,' ');
    else if(/code review|代码审查|代码审核/i.test(s))scope='code';
    else if(/deep research|深度研究/i.test(s))scope='research';
    else if(/\bwork\b|codex/i.test(s))scope='work';
    return {period:period||'window',minutes,scope,hasLabel:!!(period||scope!=='reported')};
  }
  function parseReset(text,now=Date.now(),datetime=null) {
    if(datetime && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(datetime)) {const n=Date.parse(datetime);if(Number.isFinite(n))return {resetAt:n,resetLabel:null};}
    const lines=normalizeText(text).split(/\n/).map(x=>x.trim());
    const index=lines.findIndex(x=>/(?:\bresets?\b|重置|重设|重設)/i.test(x));
    const raw=index<0?null:lines.slice(index,index+3).join(' ');
    if(!raw)return {resetAt:null,resetLabel:null};
    const iso=raw.match(/\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)/);
    if(iso && Number.isFinite(Date.parse(iso[0])))return {resetAt:Date.parse(iso[0]),resetLabel:null};
    // Resolve explicit relative durations only. Do not guess a timezone or a year.
    const relative=raw.match(/resets?\s+in\s+(.+)|(?:将于|还有|還有)?\s*((?:\d+\s*(?:天|小时|小時|分钟|分鐘|分)\s*)+)后?\s*重置|重置(?:时间)?\s*[:：]?\s*((?:\d+\s*(?:天|小时|小時|分钟|分鐘|分)\s*)+)后/i);
    if(relative){const part=relative[1]||relative[2]||relative[3];let total=0;for(const m of part.matchAll(/(\d+)\s*(days?|d\b|hours?|hrs?|h\b|minutes?|mins?|m\b|天|小时|小時|分钟|分鐘|分)/ig)){const unit=m[2].toLowerCase();total+=Number(m[1])*(/^(d|天)/.test(unit)?86400000:/^(h|小)/.test(unit)?3600000:60000);}if(total>0 && total<90*86400000)return {resetAt:now+total,resetLabel:null};}
    const label=raw.replace(/^.*?(?:resets?|重置|重设|重設)\s*(?:at|on|时间)?\s*[:：]?\s*/i,'').trim();
    // A date label is optional. Reject identifiers, emails, URLs and unrelated long prose.
    if(label.length>0 && label.length<=70 && /\d/.test(label) && !/[@<>\/\\]/.test(label) && /^[\p{L}\p{N}\s,:.\-+()年月日时時分上午下午]+$/u.test(label)) return {resetAt:null,resetLabel:label};
    return {resetAt:null,resetLabel:null};
  }
  function parseCard(text,now=Date.now(),datetime=null) {
    if(typeof text!=='string'||text.length>600)return null;
    const remaining=readPercent(text);if(remaining===null)return null;
    const info=classify(text);if(!info.hasLabel)return null;
    const reset=parseReset(text,now,datetime);
    return {id:info.scope+':'+info.period+':'+(info.minutes||''),scope:info.scope,period:info.period,minutes:info.minutes,remaining,...reset,observedAt:now,source:'ui'};
  }
  function sanitizeRow(row,now=Date.now()) {
    if(!row||percent(row.remaining)===null||!['window','hours','weekly','monthly','daily'].includes(row.period))return null;
    if(typeof row.scope!=='string'||!(/^(?:work|reported|code|research)$/u.test(row.scope)||/^(?:GPT[- ]?\d+(?:\.\d+)?(?:[- ](?:mini|nano|pro|thinking|instant|astra|sol|terra|luna))?|o[134](?:-mini)?)$/i.test(row.scope)))return null;
    const minutes=Number.isInteger(row.minutes)&&row.minutes>0&&row.minutes<=525600?row.minutes:null;
    const observedAt=typeof row.observedAt==='number' && row.observedAt>now-86400000 && row.observedAt<=now+5000?Math.min(row.observedAt,now):null;
    if(observedAt===null)return null;
    const resetAt=typeof row.resetAt==='number' && Number.isFinite(row.resetAt) && row.resetAt>now-90*86400000 && row.resetAt<now+366*86400000?row.resetAt:null;
    const resetLabel=typeof row.resetLabel==='string' && row.resetLabel.length<=70 && /\d/.test(row.resetLabel) && /^[\p{L}\p{N}\s,:.\-+()年月日时時分上午下午]+$/u.test(row.resetLabel)?row.resetLabel:null;
    return {id:row.scope+':'+row.period+':'+(minutes||''),scope:row.scope,period:row.period,minutes,remaining:row.remaining,resetAt,resetLabel,observedAt,source:'ui'};
  }
  function rowStatus(row,now=Date.now(),interval=2) {if(row.resetAt && now>=row.resetAt)return 'expired';return now-row.observedAt>Math.max(180000,interval*120000)?'stale':'fresh';}
  function summary(rows,now=Date.now(),interval=2) {const live=rows.filter(r=>rowStatus(r,now,interval)==='fresh');return live.length?live.reduce((a,b)=>a.remaining<=b.remaining?a:b):null;}
  function formatPercent(n){return Number.isInteger(n)?String(n):n.toFixed(1).replace(/\.0$/,'');}
  function duration(ms,lang='en'){if(ms<=0)return tr(lang,'needData');const mins=Math.ceil(ms/60000);const d=Math.floor(mins/1440),h=Math.floor((mins%1440)/60),m=mins%60;return lang==='zh'?`${d?d+'天 ':''}${h?h+'小时 ':''}${m||(!d&&!h)?m+'分':''}`.trim():`${d?d+'d ':''}${h?h+'h ':''}${m||(!d&&!h)?m+'m':''}`.trim();}
  function age(time,now=Date.now(),lang='en'){if(!time)return tr(lang,'never');const s=Math.max(0,Math.floor((now-time)/1000));if(s<60)return lang==='zh'?`${s}秒前`:`${s}s ago`;const m=Math.floor(s/60);return lang==='zh'?`${m}分钟前`:`${m}m ago`;}
  function rowTitle(row,lang='en'){const scope=TEXT.en[row.scope]?tr(lang,row.scope):row.scope;const period=row.period==='hours'?`${row.minutes/60} ${tr(lang,'hours')}`:tr(lang,row.period);return `${scope} · ${period}`;}
  const api=Object.freeze({VERSION,DEFAULTS,USAGE_URL,TEXT,language,tr,isChatGPT,isUsagePage,isSafeMonitor,percent,normalizeText,readPercent,classify,parseReset,parseCard,sanitizeRow,rowStatus,summary,formatPercent,duration,age,rowTitle});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.QuotaWatch=api;
})(globalThis);
