const {test}=require('node:test');
const assert=require('node:assert/strict');
const Q=require('../extension/core.js');
const NOW=Date.parse('2026-11-02T08:00:00Z');
test('remaining and used percentages are not inverted',()=>{
  for(const [s,want] of [['73% remaining',73],['Remaining: 73%',73],['27% used',73],['Used 27%',73],['剩余 73%',73],['73% 剩余',73],['已使用27%',73],['27%已使用',73],['73% available',73],['27% consumed',73],['0% remaining',0],['100% remaining',100],['99.5% used',0.5]])assert.equal(Q.readPercent(s),want,s);
});
test('unknown, conflicting, negative and out-of-range percentages fail closed',()=>{
  for(const s of ['75%','75% complete','101% remaining','-5% remaining','−5% remaining','73% remaining 19% remaining','73% remaining 20% used','Remaining —','Unlimited','NaN% remaining'])assert.equal(Q.readPercent(s),null,s);
  assert.equal(Q.readPercent('73% remaining / 27% used'),73);
});
test('requires a quota period or recognized model/feature label',()=>{
  assert.equal(Q.parseCard('The answer is 73% remaining.',NOW),null);
  assert.equal(Q.parseCard('Weekly usage\n73% remaining',NOW).remaining,73);
  assert.equal(Q.parseCard('GPT-6 Astra\n73% remaining',NOW).scope,'GPT-6 Astra');
});
test('parses EN/ZH quota windows without plan-specific assumptions',()=>{
  for(const [s,p,m] of [['5 hour usage limit\n73% remaining','hours',300],['5-hour usage limit\n73% remaining','hours',300],['Weekly limit\n73% remaining','weekly',10080],['每周额度\n剩余73%','weekly',10080],['每月额度\n剩余73%','monthly',null],['3 小时额度\n已用27%','hours',180]]){const r=Q.parseCard(s,NOW);assert.equal(r.period,p,s);assert.equal(r.minutes,m,s);}
});
test('does not invent a fixed reset from the quota window name',()=>{assert.equal(Q.parseCard('Weekly limit\n73% remaining',NOW).resetAt,null);});
test('explicit relative reset is anchored to observation time',()=>{
  assert.equal(Q.parseReset('Resets in 2h 10m',NOW).resetAt,NOW+130*60000);
  assert.equal(Q.parseReset('Resets in\n2 hours 10 minutes',NOW).resetAt,NOW+130*60000);
  assert.equal(Q.parseReset('2小时10分钟后重置',NOW).resetAt,NOW+130*60000);
});
test('ISO reset honors timezone; ambiguous labels remain unparsed',()=>{
  assert.equal(Q.parseReset('Resets 2026-11-02T18:00:00+08:00',NOW).resetAt,NOW+2*3600000);
  assert.equal(Q.parseReset('Resets Nov 4, 9:00 AM',NOW).resetAt,null);
  assert.equal(Q.parseReset('Resets Nov 4, 9:00 AM',NOW).resetLabel,'Nov 4, 9:00 AM');
  assert.equal(Q.parseReset('Resets user@example.com',NOW).resetLabel,null);
});
test('passed reset requires new observation, never refills allowance',()=>{
  const row=Q.parseCard('Weekly limit\n2% remaining\nResets in 2m',NOW);
  assert.equal(Q.rowStatus(row,NOW+3*60000),'expired');
  assert.equal(Q.summary([row],NOW+3*60000),null);assert.equal(row.remaining,2);
});
test('old readings age out even while their page is open',()=>{
  const r=Q.parseCard('Weekly\n75% remaining',NOW);
  assert.equal(Q.rowStatus(r,NOW+240001,2),'stale');
  assert.equal(Q.summary([r],NOW+240001,2),null);
});
test('summary uses lowest fresh observed window and excludes expired windows',()=>{
  const rows=[Q.parseCard('5 hour limit\n4% remaining\nResets in 1m',NOW),Q.parseCard('Weekly\n70% remaining',NOW)];
  assert.equal(Q.summary(rows,NOW).remaining,4);assert.equal(Q.summary(rows,NOW+61000).remaining,70);
});
test('validates all untrusted fields at the service worker boundary',()=>{
  const r=Q.parseCard('Weekly\n73% remaining',NOW);
  assert.equal(Q.sanitizeRow({...r,remaining:Infinity},NOW),null);
  assert.equal(Q.sanitizeRow({...r,scope:'Alice@example.com'},NOW),null);
  assert.equal(Q.sanitizeRow({...r,observedAt:NOW+100000},NOW),null);
  const clean=Q.sanitizeRow({...r,secret:'should not be copied',resetLabel:'https://example.com'},NOW);
  assert.equal(clean.secret,undefined);assert.equal(clean.resetLabel,null);
});
test('monitor URL excludes conversations, other sites, fragments and queries',()=>{
  for(const s of ['https://chatgpt.com/codex/settings/usage','https://chatgpt.com/settings/usage'])assert.ok(Q.isSafeMonitor(s));
  for(const s of ['https://chatgpt.com/c/123','https://chatgpt.com/#settings/Usage','https://chatgpt.com/codex/settings/usage?next=/c/123','https://chatgpt.com.evil.test/codex/settings/usage','http://chatgpt.com/codex/settings/usage','https://elsewhere.test/codex/settings/usage'])assert.equal(Q.isSafeMonitor(s),false,s);
  assert.ok(Q.isUsagePage('https://chatgpt.com/#settings/Usage'));
});
test('language and formatting',()=>{assert.equal(Q.language('auto','zh-CN'),'zh');assert.equal(Q.language('en','zh-CN'),'en');assert.equal(Q.formatPercent(73.5),'73.5');assert.equal(Q.duration(130*60000),'2h 10m');});
