import { inspectPublicWebsite, researchPublicURL, researchSmallJSON } from './research.ts';

/* Bounded public-web discovery. No AI-generated contact values and no emails.
 * Search is basic/1 credit; requests are reserved durably before HTTP. Only the
 * free Researcher plan with pay-as-you-go disabled is accepted in this release.
 */
const discoveryModule = (() => {
  const MARKETPLACES = ['alibaba.com','made-in-china.com','amazon.com','ebay.com','aliexpress.com','temu.com','pinterest.com','wikipedia.org','google.com','bing.com','tavily.com','europages.com','kompass.com','volza.com','panjiva.com','importyeti.com','go4worldbusiness.com','tradeindia.com','exporthub.com','tradewheel.com','globalsources.com','yelp.com','yellowpages.com','justdial.com'];
  const PRODUCTS: Record<string, RegExp> = {
    spc: /\bSPC(?:\s+(?:vinyl|rigid|click|stone|plastic|composite))*\s+(?:floor|plank|tile)|\bstone plastic composite\b|\brigid core\b|石塑地板/i,
    laminate: /\blaminate(?:d)?\s+(?:wood\s+)?floor|Laminat|stratifi[eé]|laminaat|laminat parke|强化.{0,4}地板/i,
    engineered: /\bengineered(?:\s+(?:wood|oak|hardwood|timber))?\s+floor|Mehrschichtparkett|contrecoll[eé]|multiplank|实木复合地板/i,
    uv_panel: /\bUV\b.{0,25}\b(?:wall|panel|marble|sheet)|UV.{0,5}(?:墙|板)/i,
    pvc_fluted: /\b(?:PVC|plastic)\b.{0,30}\bfluted\b|\bfluted\b.{0,30}\bPVC\b|长城板/i,
    pvc_grille: /\bPVC\b.{0,25}\b(?:grille|slat|slatted)|PVC.{0,5}格栅/i,
    coex_panel: /\bco[ -]?extrud(?:ed|ing|e|sion)\b.{0,50}\b(?:wall|panel|clad)|共挤.{0,5}(?:墙|板)/i,
    wpc_panel: /\bWPC\b.{0,35}\b(?:wall|panel|clad)|\bwood plastic composite\b.{0,35}\b(?:wall|panel|clad)|WPC.{0,5}(?:墙|板)/i,
    pvc_marble: /\bPVC\b.{0,30}\bmarble|\bmarble\b.{0,30}\bPVC\b|PVC.{0,5}大理石/i,
    acoustic: /\bacoustic\b.{0,30}\b(?:panel|slat)|Akustikpaneele|panneaux acoustiques|吸音板/i,
    wpc_decking: /\b(?:WPC|composite)\s+deck(?:ing)?\b|wood plastic composite.{0,25}deck|WPC.{0,5}户外地板/i
  };
  const TYPES: Record<string, RegExp> = {
    importer: /\bimport(?:er|ing|s|ed)?\b|Importeur|importateur|importador|مستورد|استيراد|进口/i,
    distributor: /\bdistribut(?:or|ion|eurs?)\b|dystrybutor|موزع|توزيع|经销|分销/i,
    wholesaler: /\bwholesale(?:r|rs)?\b|trade only|dealers only|Großhandel|grossiste|groothandel|hurtownia|mayorista|الجملة|批发/i,
    contractor: /\bcontractor|commercial (?:fit[ -]?out|project)|construction projects?|مقاولات|工程|建筑/i
  };
  const clean = (v: unknown, limit = 600) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0, limit) : '';
  function checked(r: any): any { if (r.error) throw new Error('获客任务暂时无法保存，请稍后查看任务状态'); return r.data; }
  function capabilities() { return { enabled: Deno.env.get('TAVILY_FREE_SEARCH_ENABLED') === 'true' && /^tvly-[A-Za-z0-9_-]{10,250}$/.test(Deno.env.get('TAVILY_API_KEY') || ''), provider: 'Tavily', freeOnly: true, monthlyAttemptCap: 900, maxQueries: 6, maxCandidates: 50, maxWebsitePages: 2 }; }
  function fact(topic: string, re: RegExp, text: string, source: string, at: string) {
    const found = re.exec(text); if (!found) return null;
    const line = text.lastIndexOf('\n', found.index), minimum = Math.max(0, found.index - 100);
    const start = line >= minimum ? line + 1 : minimum;
    return { topic, excerpt: clean(text.slice(start, start + 450)), source_url: source, checked_at: at, state: 'pending' };
  }
  function assess(sources: any[], criteria: any) {
    const evidence: any[] = [], productMatches = new Set<string>(), buyerMatches = new Set<string>();
    let country = false, warehouse = false, retail = false;
    const countries: Record<string,string[]> = { 'Saudi Arabia':['Saudi Arabia','KSA','المملكة العربية السعودية','السعودية'], 'United Arab Emirates':['United Arab Emirates','UAE','الإمارات'], USA:['United States','USA'], 'United Kingdom':['United Kingdom','UK','Britain'], 'Türkiye':['Türkiye','Turkey'], Philippines:['Philippines','Philippine'] };
    for (const s of sources) {
      const text = String(s.content || s.excerpt || ''), url = s.url || s.source_url, at = s.checked_at || new Date().toISOString();
      for (const [key,re] of Object.entries(PRODUCTS)) { const item = fact('产品：'+key,re,text,url,at); if (item) { productMatches.add(key); if (evidence.length<30) evidence.push(item); } }
      for (const [key,re] of Object.entries(TYPES)) { const item = fact('采购渠道：'+key,re,text,url,at); if (item) { buyerMatches.add(key); if (evidence.length<30) evidence.push(item); } }
      const storage = fact('仓储相关描述（待确认）',/\bwarehouse|distribution cent(?:er|re)|مستودع|مستودعات|仓库|仓储/i,text,url,at);
      if (storage) { warehouse = true; if(evidence.length<30)evidence.push(storage); }
      const terms = countries[criteria.country] || [criteria.country];
      const lower=text.toLowerCase();
      const countryMatch=terms.find(term=>term && new RegExp('(?:^|[^\\p{L}\\p{N}])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^\\p{L}\\p{N}])','iu').test(text));
      if (countryMatch) {
        country=true;
        const start=Math.max(0,lower.indexOf(countryMatch.toLowerCase())-80);
        if(evidence.length<30)evidence.push({topic:'目标国家文字（仍需核实经营地址）',excerpt:clean(text.slice(start,start+450)),source_url:url,checked_at:at,state:'pending'});
      }
      retail ||= /\bonline shop|shopping cart|\bretail(?:er)?\b|homeowner|DIY/i.test(text);
    }
    const groups: Record<string,string[]>={spc:['spc'],laminate:['laminate'],engineered:['engineered'],wall:['uv_panel','pvc_fluted','pvc_grille','coex_panel','wpc_panel','pvc_marble'],acoustic:['acoustic'],wpc:['wpc_decking','wpc_panel']};
    const wanted = (criteria.groups||[]).flatMap((g:string)=>groups[g]||[]), matching=[...productMatches].filter(k=>wanted.includes(k));
    const wantedBuyers=[...buyerMatches].filter(k=>(criteria.types||[]).includes(k));
    const score=(matching.length?30:0)+(wantedBuyers.length?30:buyerMatches.size?10:0)+(country?15:0)+(warehouse?10:0);
    const reasons=[matching.length?'出现目标产品词语':'未找到目标产品明确原文',wantedBuyers.length?'出现目标B端业务词语':'采购类型待确认',country?'出现目标国家文字':'所在国家待确认',warehouse?'出现仓储描述':'仓库待确认'];
    if(retail&&!buyerMatches.size)reasons.push('出现零售描述，B端资格待确认');
    return { score, product_matches: matching, buyer_matches:[...buyerMatches], country_mentioned:country, warehouse_mentioned:warehouse, evidence, reasons, suitability:matching.length&&wantedBuyers.length&&country?'优先核实':'待核实' };
  }
  async function usage(key: string) {
    const r=await fetch('https://api.tavily.com/usage',{redirect:'error',credentials:'omit',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(4000)});
    if(!r.ok)throw new Error('无法确认免费搜索额度，已停止；不会调用付费搜索');
    const v=await researchSmallJSON(r,40000), a=v.account;
    if(!a || !['researcher','free','researcher (free)'].includes(String(a.current_plan||'').toLowerCase()) || Number(a.plan_limit)>1000 || Number(a.paygo_limit)!==0 || Number(a.paygo_usage)!==0 || !Number.isFinite(Number(a.plan_usage)) || !Number.isFinite(Number(a.plan_limit)) || Number(a.plan_usage)>=Number(a.plan_limit)) throw new Error('搜索账号免费计划或余额未通过核对，任务已停止；请核对Researcher免费计划且按量付费关闭');
    return {used:Number(a.plan_usage),limit:Number(a.plan_limit)};
  }
  async function search(q: string, criteria: any) {
    const key=Deno.env.get('TAVILY_API_KEY')!; await usage(key);
    const response=await fetch('https://api.tavily.com/search',{method:'POST',redirect:'error',credentials:'omit',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({query:q,search_depth:'basic',topic:'general',max_results:20,include_answer:false,include_raw_content:false,include_images:false,auto_parameters:false,include_usage:true,exclude_domains:MARKETPLACES})});
    if(!response.ok)throw new Error([401,402,403,432,433].includes(response.status)?'搜索免费授权或余额不可用，已停止；不充值、不自动重试':response.status===429?'免费搜索限流，本次不重复调用，请稍后新建任务':'搜索服务未确认成功，本次不自动重试');
    const payload=await researchSmallJSON(response,600000);
    if(!Array.isArray(payload.results))throw new Error('搜索结果格式无效，本次不自动重试');
    const results:any[]=[],seen=new Set<string>(),at=new Date().toISOString();
    for(const item of payload.results.slice(0,20)){
      try {
        const url=researchPublicURL(String(item.url||'')),domain=url.hostname.toLowerCase().replace(/^www\./,'');
        if(MARKETPLACES.some(d=>domain===d||domain.endsWith('.'+d))||seen.has(domain))continue;
        seen.add(domain);
        const source={url:url.href,title:clean(item.title,300),excerpt:clean(item.content,3500),checked_at:at,kind:'search_index',query:q};
        const assessment=assess([source],criteria);
        results.push({domain,website:url.origin+'/',title:source.title,source,score:assessment.score,data:{...assessment,suggestions:[],pages:[],checked_at:at,notice:'搜索索引摘录尚未核实公司身份；匹配分数不代表进口量或采购资格。'}});
      } catch { /* Reject private/file/social/signed URLs; never construct contact details. */ }
    }
    results.sort((a,b)=>b.score-a.score);
    return {results,credits:payload.usage?.credits??null};
  }
  async function inspect(c:any,j:any){
    const raw=await inspectPublicWebsite(c.website,16000),at=new Date().toISOString();
    const assessment=assess([...c.sources,...raw.pages],j.criteria),emails=raw.suggestions.filter((s:any)=>s.field==='company_email'),phones=raw.suggestions.filter((s:any)=>s.field==='company_phone');
    return {...assessment,score:Math.min(100,assessment.score+(emails.length?10:0)+(phones.length?5:0)),suggestions:raw.suggestions,evidence:assessment.evidence,pages:raw.pages.map(({url,title,checked_at}:any)=>({url,title,checked_at})),checked_at:at,warnings:raw.warnings,notice:'公开网页候选资料。产品、批发、仓库、进口等词语只用于查阅，不能单独证明采购能力；请核实身份、国家及业务类型后导入。联系人姓名、营业年限、采购量不推测。'};
  }
  async function worker(db:any){
    if(!capabilities().enabled)return {processed:0,disabled:true};
    const task=checked(await db.rpc('crm_discovery_claim'));if(!task)return {processed:0};
    let result:any={},error:string|null=null;
    try {
      if(task.kind==='search')result=await search(task.query,task.job.criteria);
      else result=await inspect(task.candidate,task.job);
    } catch(e) {error=e instanceof Error&& !/fetch|abort|signal|timeout/i.test(e.message)?e.message:'公开搜索或网页读取超时，本次不会自动重复搜索；可人工打开已有来源核实';}
    checked(await db.rpc('crm_discovery_finish',{p_job:task.job.id,p_lease:task.lease,p_kind:task.kind,p_step:task.step??null,p_candidate:task.candidate?.id??null,p_result:result,p_error:error}));
    // Auth/quota failures pause this job before any further query reservations.
    if(task.kind==='search'&&error&&/免费计划|免费授权|余额|免费搜索额度/.test(error))checked(await db.from('crm_discovery_jobs').update({status:'paused',error}).eq('id',task.job.id).eq('status','running').is('lease_token',null));
    return {processed:1,kind:task.kind,status:error?'failed':'completed'};
  }
  return {worker,capabilities};
})();
export const discoveryWorker = discoveryModule.worker;
export const discoveryCapabilities = discoveryModule.capabilities;
