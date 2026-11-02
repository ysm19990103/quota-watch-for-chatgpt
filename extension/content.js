(function () {
  'use strict';
  if (globalThis.__quotaWatchLoaded) return;
  globalThis.__quotaWatchLoaded=true;
  const Q=globalThis.QuotaWatch;
  const EXCLUDE='[data-message-author-role], [data-testid^="conversation-turn"], article, .markdown, pre, code, textarea, input, [contenteditable="true"], #quota-watch-host';
  let settings={...Q.DEFAULTS}, rows=[], lastScan=0, timer=null, host=null, shadow=null, observer=null, stopped=false;
  let previous=new Map(), route=location.href, lastSignature='', scanPending=false;
  const lang=()=>Q.language(settings.language,navigator.language);
  const t=key=>Q.tr(lang(),key);
  async function send(message) {try {return await chrome.runtime.sendMessage(message);}catch {stopped=true;observer?.disconnect();clearInterval(timer);host?.remove();return null;}}
  function visible(el){if(el.closest('[hidden],[aria-hidden="true"]'))return false;const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&el.getClientRects().length>0;}
  function textOf(el){
    if(el.matches(EXCLUDE)||el.closest(EXCLUDE))return '';
    const clone=el.cloneNode(true);
    for(const n of clone.querySelectorAll(EXCLUDE+',script,style,svg,[hidden],[aria-hidden="true"]'))n.remove();
    // Keep card lines independent so reset labels cannot absorb surrounding text.
    for(const n of clone.querySelectorAll('p,div,span,li,h1,h2,h3,h4,h5,h6,br,time')){n.appendChild(document.createTextNode('\n'));}
    return Q.normalizeText(clone.textContent).replace(/\n\s*\n/g,'\n');
  }
  function roots(){
    const found=[];
    if(Q.isUsagePage(location.href)){const mains=[...document.querySelectorAll('main,[role="main"]')];found.push(...(mains.length?mains:[document.body]));}
    for(const dialog of document.querySelectorAll('[role="dialog"]')){
      const headings=[...dialog.querySelectorAll('h1,h2,h3,[role="heading"],[role="tab"][aria-selected="true"]')];
      if(headings.some(h=>/^(?:usage|usage limits|用量|使用量|额度|使用额度)$/i.test(h.textContent.trim())))found.push(dialog);
    }
    // Sidebar values are read only inside specifically labelled usage widgets.
    for(const el of document.querySelectorAll('aside [data-testid*="usage"],nav [data-testid*="usage"],[data-testid*="sidebar"] [data-testid*="usage"],aside [aria-label],nav [aria-label],[data-testid*="sidebar"] [aria-label]')){
      const label=el.getAttribute('aria-label')||el.getAttribute('data-testid')||'';
      if(/usage|remaining|用量|额度|剩余/i.test(label)&&!el.closest(EXCLUDE))found.push(el);
    }
    return [...new Set(found)].filter(visible);
  }
  function readCards(){
    const now=Date.now(),out=new Map(),accepted=[];
    for(const root of roots()){
      const candidates=[root,...root.querySelectorAll('section,li,div,button,[role="progressbar"],meter')].reverse();
      for(const node of candidates){
        if(!visible(node)||node.closest(EXCLUDE))continue;
        if(accepted.some(child=>child!==node&&node.contains(child)))continue;
        // Skip large containers before cloning. This never walks conversation text.
        if(node.childElementCount>16||node.textContent.length>1600)continue;
        let value=textOf(node);
        if(!value||value.length>600)continue;
        const explicit=node.getAttribute('aria-valuetext');
        if(explicit&&/remaining|used|剩余|已用|已使用/i.test(explicit))value+='\n'+explicit;
        let row=Q.parseCard(value,now,node.querySelector('time[datetime]')?.getAttribute('datetime'));
        if(!row)continue;
        // Smallest qualifying cards win; a wrapper cannot combine several quotas.
        accepted.push(node);
        // Repeat scans are not new account observations. Do not extend freshness or relative reset dates.
        const explicitTime=node.querySelector('time[datetime]')?.getAttribute('datetime');
        const relative=!explicitTime&&/\bresets?\s+in|(?:天|小时|小時|分钟|分鐘|分)\s*后?\s*重置|重置[^\n]*后/i.test(value);
        // A client-side reset countdown ticking is not a new quota observation.
        const fingerprint=JSON.stringify([row.id,row.remaining,relative?'relative':row.resetAt,row.resetLabel]);
        const old=previous.get(row.id);
        if(old?.fingerprint===fingerprint)row=old.row;
        const existing=out.get(row.id);
        if(existing && Math.abs(existing.row.remaining-row.remaining)>0.11){out.set(row.id,{conflict:true});continue;}
        if(existing?.conflict)continue;
        if(!existing||fingerprint.length<existing.fingerprint.length)out.set(row.id,{row,fingerprint});
      }
    }
    return new Map([...out].filter(([,v])=>!v.conflict));
  }
  async function scan(force=false){
    if(stopped)return false;
    if(location.href!==route){route=location.href;previous.clear();rows=[];lastSignature='';await send({type:'HELLO'});}
    const found=readCards();lastScan=Date.now();
    if(found.size){
      previous=found;rows=[...found.values()].map(v=>v.row).slice(0,12);
      const signature=JSON.stringify(rows);
      if(signature!==lastSignature||force){lastSignature=signature;await send({type:'OBSERVE',rows});}
    }
    renderWidget();return found.size>0;
  }
  function schedule(){if(scanPending||stopped)return;scanPending=true;setTimeout(()=>{scanPending=false;scan().catch(()=>{});},350);}
  function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  function renderWidget(){
    if(!settings.widget){host?.remove();host=null;shadow=null;return;}
    if(!document.body)return;
    if(!host){
      host=document.createElement('div');host.id='quota-watch-host';host.style.cssText='all:initial;position:fixed;right:16px;bottom:18px;z-index:2147483000;';
      shadow=host.attachShadow({mode:'closed'});document.body.appendChild(host);
      const css=node('style');css.textContent=':host{all:initial}*{box-sizing:border-box}section{width:232px;background:#ffffff;color:#173b34;border:1px solid #d5e4de;box-shadow:0 8px 30px #102e2320;border-radius:16px;padding:13px 15px;font:13px/1.5 system-ui,-apple-system,sans-serif}header{display:flex;align-items:center;justify-content:space-between;font-weight:700;letter-spacing:.01em}button{border:0;cursor:pointer;background:transparent;color:inherit;font:inherit;padding:0}button:focus-visible{outline:2px solid #16775d;outline-offset:4px}small{display:block;color:#62766e;font-size:11px;margin-top:3px}.number{font-size:27px;font-weight:730;letter-spacing:-.04em;margin:5px 0}.number span{font-size:12px;font-weight:500;letter-spacing:0;margin-left:5px}.low{color:#a34d2d}.foot{display:flex;justify-content:space-between;margin-top:9px;border-top:1px solid #e5ede8;padding-top:8px;font-size:11px}.open{color:#146249;text-decoration:underline}.label{font-size:11px;overflow-wrap:anywhere}.old{color:#a05b27}@media(prefers-color-scheme:dark){section{background:#14271f;color:#e2eee7;border-color:#2e493b}small{color:#abc0b4}.foot{border-color:#355042}.open{color:#9ed6b4}.old,.low{color:#f3bb8e}}@media(max-width:600px){section{width:196px}}';
      shadow.append(css);
    }
    shadow.querySelector('section')?.remove();
    const box=node('section');box.setAttribute('aria-label','Quota Watch');
    const header=node('header');header.append(node('span','◔  Quota Watch'));const close=node('button','×');close.title=t('widget');close.setAttribute('aria-label',lang()==='zh'?'隐藏面板':'Hide panel');close.onclick=()=>{settings.widget=false;send({type:'HIDE_WIDGET'});renderWidget();};header.append(close);box.append(header);
    const current=Q.summary(rows,Date.now(),settings.interval);
    const target=current||rows[0];
    const number=node('div',current?Q.formatPercent(current.remaining)+'%':'—','number'+(current&&current.remaining<=settings.threshold?' low':''));number.append(node('span',current?t('remaining'):t('unknown')));box.append(number);
    if(target){box.append(node('div',Q.rowTitle(target,lang()),'label'));box.append(node('small',t(Q.rowStatus(target,Date.now(),settings.interval)),current?'':'old'));if(target.resetAt)box.append(node('small',t('reset')+' · '+Q.duration(target.resetAt-Date.now(),lang())));box.append(node('small',Q.age(target.observedAt,Date.now(),lang())));}else box.append(node('small',t('empty')));
    const foot=node('div',undefined,'foot');const open=node('button',t('open'),'open');open.onclick=()=>send({type:'OPEN_USAGE'});foot.append(open,node('span',lang()==='zh'?'当前标签页':'This tab'));box.append(foot);shadow.append(box);
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='SCAN'){scan(true).then(found=>respond({ok:true,found}));return true;}
    if(message?.type==='CLEAR_LOCAL'){rows=[];previous.clear();lastSignature='';renderWidget();respond({ok:true});}
    if(message?.type==='PREFS'){settings={...Q.DEFAULTS,...message.settings};renderWidget();respond({ok:true});}
  });
  (async()=>{
    const hello=await send({type:'HELLO'});if(!hello||stopped)return;settings={...Q.DEFAULTS,...hello.settings};
    await scan();
    observer=new MutationObserver(mutations=>{if(mutations.some(m=>!host?.contains(m.target)&&m.target!==host && (m.type!=='childList'||[...m.addedNodes,...m.removedNodes].some(n=>n!==host))))schedule();});
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-valuetext','aria-valuenow','hidden','datetime']});
    timer=setInterval(()=>scan().catch(()=>{}),15000);
    window.addEventListener('focus',schedule);window.addEventListener('popstate',schedule);window.addEventListener('hashchange',schedule);
  })().catch(()=>{});
})();
