// Shared pure logic; no network, credentials, or database access.
export const TASKS = ['knowledge','reply','research','training','daily','business'];
export const PRIVATE_TASKS = ['reply','research','daily','business'];
export const cleanText = (v, max = 2000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
export function safeURL(value) {
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function sourceRank(query, source) {
  const q = query.toLowerCase(), text = (source.title+' '+source.text).toLowerCase();
  const terms = [...new Set(q.match(/[a-z0-9]+|[\u3400-\u9fff]{2}/g) || [])];
  return terms.reduce((n,t)=>n+(text.includes(t)?1:0),0);
}
export function selectSources(query, sources, maxChars = 13000) {
  let used = 0; const selected = [];
  for (const s of [...sources].sort((a,b)=>sourceRank(query,b)-sourceRank(query,a))) {
    if (selected.length >= 8 || used >= maxChars) break;
    const text = cleanText(s.text, Math.min(4000,maxChars-used)); if (!text.trim()) continue;
    selected.push({...s,text}); used += text.length;
  }
  return selected;
}
export function qualificationScore(data = {}, now = Date.now()) {
  const weights = {sells_products:25,wholesale:20,warehouse:20,import_evidence:25,annual_volume:10};
  const details = Object.entries(weights).map(([key,weight])=>{
    const f=data[key]||{}, date=Date.parse(f.date), age=(now-date)/86400000;
    const valid=f.state==='confirmed' && !!String(f.source||'').trim() && age>=0 && age<=365 && !!String(f.value||'').trim();
    // Ambiguous or negative values must never earn affirmative procurement points.
    const negative=/没有|无仓库|不做|非批发|\bno\b|\bnot\b|^无$|^否$/i.test(String(f.value||''));
    return {key,weight,earned:valid&&!negative?weight:0,state:f.state||'pending',value:cleanText(f.value,300),source:cleanText(f.source,600),date:f.date||'',reason:valid?(negative?'已确认否定，不加分':'已有来源和一年内核实日期'):age>365?'来源超过一年，需复核':'缺少已确认的内容、来源或有效核实日期'};
  });
  return {score:details.reduce((n,d)=>n+d.earned,0),details,notice:'采购档案证据完整度分，不是进口量排名、信用评级或成交概率；AI不会把网页词语自动确认为采购事实。'};
}
export function eligibleProviders(providers, task, preferred, keys, now = Date.now()) {
  return providers.filter(p=>p.enabled && p.free_only_verified && Date.parse(p.expires_at)>now && p.model && keys[p.id] && (!PRIVATE_TASKS.includes(task)||p.private_allowed))
    .sort((a,b)=>(a.id===preferred?-1:b.id===preferred?1:0)||a.priority-b.priority);
}
export function reservationSize(system, payload, maxOutput=1600) {
  // UTF-8 byte count conservatively exceeds ordinary BPE input tokens. Reserve before every attempt.
  return new TextEncoder().encode(system+payload).length+maxOutput+512;
}
export function validateResult(raw, sources, task) {
  let r;
  try {r=JSON.parse(raw.replace(/^\s*\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60\s*$/,''));} catch {throw new Error('模型返回格式不完整，请查看已计次数后重新尝试');}
  if (!r || typeof r.answer!=='string' || !r.answer.trim()) throw new Error('模型未返回有效答案');
  const sourceMap=new Map(sources.map(s=>[s.id,s]));
  const cited=[...new Set(Array.isArray(r.source_ids)?r.source_ids.filter(x=>typeof x==='string'&&sourceMap.has(x)):[])].slice(0,8);
  const result={answer:cleanText(r.answer,16000),sources:cited.map(id=>sourceMap.get(id))};
  if(task==='reply') {
    if(typeof r.subject!=='string'||typeof r.body!=='string'||!r.subject.trim()||!r.body.trim()||/[\r\n]/.test(r.subject)||r.subject.length>250||r.body.length>20000)
      throw new Error('邮件草稿不完整，本次未发送任何邮件');
    result.subject=cleanText(r.subject,250); result.body=cleanText(r.body,20000);
  }
  if((task==='knowledge'||task==='research')&&!cited.length) result.answer='资料依据不足，以下内容仅为待核实建议，不能视为公司承诺或采购事实。\n\n'+result.answer;
  return result;
}
export function fallbackAllowed(status) { return [403,429,502,503,504].includes(status); }

export function qwenEndpoint(base='https://dashscope.aliyuncs.com/compatible-mode/v1') {
 const u=new URL(base||'https://dashscope.aliyuncs.com/compatible-mode/v1'),h=u.hostname;
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/compatible-mode/v1'||!(h==='dashscope.aliyuncs.com'||(h.startsWith('ws-')&&h.endsWith('.cn-beijing.maas.aliyuncs.com'))))throw new Error('模型服务器地址未通过检查');
 return u.href+'/chat/completions';
}
export function ensurePublicOnly(input) {
 if(!['knowledge','training'].includes(input.task)||input.client_id||input.inbound_id)throw new Error('当前仅开放非机密知识问答与虚构培训，禁止提交真实邮件、客户档案、合同、报价或经营资料');
}
