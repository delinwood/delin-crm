import { inspectPublicWebsite, researchPublicURL } from './research.ts';
import { configuredFailover, contactsFromText, failoverSearch, firecrawlScrape, isConfigured, isQuotaError, mergeProviderStatus, probeProvider, providerById, quotaError, readerMayFallback, redactSearchResult, braveStorageAllowed } from './discovery-providers.mjs';

/* Bounded public-web discovery. No AI-generated contact values and no emails.
 * Search stays on free tiers only. A provider that is confirmed exhausted is
 * skipped and the next configured free provider is used. Nothing auto-pays.
 * Brave excerpts stay out of CRM tables unless BRAVE_STORAGE_RIGHTS_OK=true.
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
  const env = { get: (key: string) => Deno.env.get(key) };
  const clean = (v: unknown, limit = 600) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0, limit) : '';
  function checked(r: any): any { if (r.error) throw new Error('获客任务暂时无法保存，请稍后查看任务状态'); return r.data; }
  function quotaFromRpc(r: any) {
    if (!r.error) return r.data;
    const message = String(r.error.message || '');
    if (isQuotaError({ message })) throw quotaError(message, { exhaust: true });
    throw new Error('获客任务暂时无法保存，请稍后查看任务状态');
  }
  async function ledger(db: any) {
    try {
      const rows = checked(await db.rpc('crm_discovery_provider_quota'));
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }
  async function capabilities(db?: any) {
    const configured = configuredFailover(env);
    const live = await Promise.all(configured.map(async provider => {
      try { return { id: provider.id, ...await probeProvider(provider.id, env, fetch) }; }
      catch (error) { return { id: provider.id, exhausted: isQuotaError(error) && (error as any).exhaust === true, remaining: (error as any)?.exhaust ? 0 : null, checked: false }; }
    }));
    const merged = mergeProviderStatus({ env, ledger: db ? await ledger(db) : [], live });
    return { ...merged, maxQueries: 6, maxCandidates: 50, maxWebsitePages: 2, configuredIds: configured.map(provider => provider.id) };
  }
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
  function pack(hits: any[], criteria: any, provider: string, storageAllowed: boolean, query: string) {
    const results: any[] = [], seen = new Set<string>(), at = new Date().toISOString();
    for (const item of hits) {
      try {
        const url = researchPublicURL(String(item.url || '')), domain = url.hostname.toLowerCase().replace(/^www\./, '');
        if (MARKETPLACES.some(d => domain === d || domain.endsWith('.' + d)) || seen.has(domain)) continue;
        seen.add(domain);
        const excerpt = clean(item.excerpt, 3500);
        const source = { url: url.href, title: clean(item.title, 300), excerpt, checked_at: at, kind: 'search_index', provider, storage: provider === 'brave' ? (storageAllowed ? 'rights_ok' : 'ephemeral') : 'allowed', query };
        const assessment = assess([{ ...source, content: excerpt }], criteria);
        results.push({ domain, website: url.origin + '/', title: source.title, source, score: assessment.score, data: { ...assessment, suggestions: [], pages: [], checked_at: at, notice: '搜索索引摘录尚未核实公司身份；匹配分数不代表进口量或采购资格。' } });
      } catch { /* Reject private/file/social/signed URLs; never construct contact details. */ }
    }
    results.sort((a, b) => b.score - a.score);
    return redactSearchResult({ results, credits: null, provider }, { provider, storageAllowed }); // Brave text is removed here and again in crm_discovery_finish.
  }
  async function search(q: string, criteria: any, db: any, task: any) {
    const providers = configuredFailover(env);
    const outcome = await failoverSearch({
      providers, query: q, excludeDomains: MARKETPLACES, env, fetchImpl: fetch,
      begin: async (provider: any) => quotaFromRpc(await db.rpc('crm_search_attempt_begin', { p_job: task.job.id, p_lease: task.lease, p_step: task.step, p_provider: provider.id, p_kind: 'search', p_weight: provider.searchWeight })),
      finish: async (attemptId: string, patch: any) => { checked(await db.rpc('crm_search_attempt_finish', { p_attempt: attemptId, p_lease: task.lease, p_status: patch.status, p_error: patch.error, p_count: patch.count, p_exhaust: patch.exhaust })); }
    });
    return pack(outcome.hits, criteria, outcome.provider, outcome.storageAllowed, q);
  }
  function present(raw: any, c: any, j: any, notice: string) {
    const assessment = assess([...(c.sources || []), ...raw.pages], j.criteria);
    const emails = (raw.suggestions || []).filter((s: any) => s.field === 'company_email');
    const phones = (raw.suggestions || []).filter((s: any) => s.field === 'company_phone');
    return { ...assessment, score: Math.min(100, assessment.score + (emails.length ? 10 : 0) + (phones.length ? 5 : 0)), suggestions: raw.suggestions, evidence: assessment.evidence, pages: raw.pages.map(({ url, title, checked_at }: any) => ({ url, title, checked_at })), checked_at: new Date().toISOString(), warnings: raw.warnings || [], notice };
  }
  async function scrapeBackup(db: any, task: any, website: string) {
    const provider = providerById('firecrawl');
    if (!provider || !isConfigured(provider, env)) throw new Error('官网读取失败，且没有可用的免费抓取备份');
    const url = researchPublicURL(website);
    const attemptId = quotaFromRpc(await db.rpc('crm_search_attempt_begin', { p_job: task.job.id, p_lease: task.lease, p_step: null, p_provider: 'firecrawl', p_kind: 'scrape', p_weight: provider.scrapeWeight }));
    try {
      const page = await firecrawlScrape(env, fetch, url.href);
      const finalURL = researchPublicURL(page.url);
      if (finalURL.hostname.replace(/^www\./, '') !== url.hostname.replace(/^www\./, '')) throw new Error('官网跳转到其他网站，未采用跳转后的内容');
      quotaFromRpc(await db.rpc('crm_search_attempt_finish', { p_attempt: attemptId, p_lease: task.lease, p_status: 'completed', p_error: null, p_count: true, p_exhaust: false }));
      const at = new Date().toISOString();
      const stored = { url: finalURL.href, title: clean(page.title, 300), content: page.markdown, checked_at: at };
      return { pages: [stored], suggestions: contactsFromText(page.markdown, finalURL.href, at), warnings: ['官网读取改用 Firecrawl 免费抓取一页；未启用付费额度。'] };
    } catch (error) {
      const quota = isQuotaError(error);
      await db.rpc('crm_search_attempt_finish', { p_attempt: attemptId, p_lease: task.lease, p_status: 'failed', p_error: error instanceof Error ? error.message : '抓取失败', p_count: quota ? (error as any).counted === true : true, p_exhaust: quota && (error as any).exhaust === true });
      throw error;
    }
  }
  async function inspect(c: any, j: any, db: any, task: any) {
    const notice = '公开网页候选资料。产品、批发、仓库、进口等词语只用于查阅，不能单独证明采购能力；请核实身份、国家及业务类型后导入。联系人姓名、营业年限、采购量不推测。';
    try {
      return present(await inspectPublicWebsite(c.website, 16000), c, j, notice);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!readerMayFallback(message)) throw error;
      return present(await scrapeBackup(db, task, c.website), c, j, notice + ' 本次官网正文来自 Firecrawl 免费抓取备份。');
    }
  }
  async function worker(db: any) {
    const configured = configuredFailover(env);
    if (!configured.length) return { processed: 0, disabled: true };
    const task = checked(await db.rpc('crm_discovery_claim', { p_providers: configured.map(provider => provider.id) }));
    if (!task) return { processed: 0 };
    let result: any = {}, error: string | null = null;
    try {
      if (task.kind === 'search') result = await search(task.query, task.job.criteria, db, task);
      else result = await inspect(task.candidate, task.job, db, task);
    } catch (e) { error = e instanceof Error && !/fetch|abort|signal|timeout/i.test(e.message) ? e.message : '公开搜索或网页读取超时，本次不会自动重复搜索；可人工打开已有来源核实'; }
    checked(await db.rpc('crm_discovery_finish', { p_job: task.job.id, p_lease: task.lease, p_kind: task.kind, p_step: task.step ?? null, p_candidate: task.candidate?.id ?? null, p_result: result, p_error: error }));
    if (task.kind === 'search' && error && isQuotaError({ message: error })) checked(await db.from('crm_discovery_jobs').update({ status: 'paused', error }).eq('id', task.job.id).eq('status', 'running').is('lease_token', null));
    return { processed: 1, kind: task.kind, status: error ? 'failed' : 'completed' };
  }
  return { worker, capabilities };
})();
export const discoveryWorker = discoveryModule.worker;
export async function discoveryCapabilities(db?: any) { return discoveryModule.capabilities(db); }
