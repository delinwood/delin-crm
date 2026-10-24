/* Public website enrichment. No target credentials, paid fallback or automatic CRM overwrite. */
const researchModule = (() => {
  type DB = any;
  type Page = { url: string; title: string; content: string; checked_at: string };
  type Suggestion = { id: string; field: string; label: string; value: string; source_url: string; checked_at: string; excerpt: string; state: 'pending' };
  type Evidence = { topic: string; source_url: string; checked_at: string; excerpt: string; state: 'pending' };
  type SearchResult = { url: string; title: string; snippet: string; checked_at: string; name_matches: string[]; country_mentioned: boolean; candidate_website: string; source_kind: 'search_index'; state: 'pending' };
  type Budget = { end: number };
  const BLOCKED_HOSTS = ['localhost','metadata.google.internal','metadata.google','instance-data','facebook.com','fb.com','fb.me','instagram.com','linkedin.com','lnkd.in','whatsapp.com','wa.me','t.me','tiktok.com','x.com','twitter.com','youtube.com','youtu.be','r.jina.ai','s.jina.ai','bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','nip.io','sslip.io','localtest.me','lvh.me','ngrok.io','ngrok-free.app','trycloudflare.com'];
  const INTERNAL_ENDINGS = /\.(?:local|localhost|internal|intranet|lan|home|corp|test|invalid|example|onion|arpa)$/i;
  const SAFE_FIELDS = new Set(['company_email','company_phone','address','notes','website']);
  const EMAIL = /[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi;
  function capabilities() { return { reader: true, search: Deno.env.get('JINA_FREE_SEARCH_ENABLED') === 'true' && !!Deno.env.get('JINA_SEARCH_KEY')?.trim(), maxPages: 3, maxSearchResults: 5, monthlySearchJobs: 100, dailyPerUser: 20, batchSize: 10, paidFallback: false, searchTokenBudgetEnforced: false }; }
  function checked<T>(r: { data: T; error: any }): T { if (r.error) throw new Error('资料任务数据库操作失败，请稍后重试'); return r.data; }
  function remaining(b: Budget, cap: number) { const n = Math.min(cap, b.end - Date.now()); if (n < 300) throw new Error('本次任务处理超时，请稍后重试'); return n; }
  function hostAllowed(host: string) {
    const h = host.toLowerCase();
    return h.length <= 253 && h.includes('.') && /^[a-z0-9.-]+$/.test(h) && !h.endsWith('.') && h.split('.').every(p => p.length > 0 && p.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p)) && !/^[\d.]+$/.test(h) && /[a-z]/.test(h.split('.').pop() || '') && !INTERNAL_ENDINGS.test(h) && !BLOCKED_HOSTS.some(d => h === d || h.endsWith('.' + d));
  }
  function publicURL(value: string, base?: string): URL {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error('官网网址格式不安全或无效');
    let u: URL; try { u = new URL(raw, base); } catch { throw new Error('请先填写完整的公司官网网址'); }
    if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port || !hostAllowed(u.hostname)) throw new Error('仅支持公开公司官网，不支持内网、IP地址、短链接或社交平台');
    if (/\.(?:pdf|zip|exe|dmg|xls[xm]?|doc[xm]?|ppt[xm]?|jpe?g|png|gif|svg|webp|mp[34])$/i.test(u.pathname) || /(?:^|\/)(?:login|signin|sign-in|account|admin|wp-admin|oauth|checkout|cart)(?:\/|$)/i.test(u.pathname)) throw new Error('仅处理公开网页，不处理文件、账号页面或结算页面');
    // Never forward query strings, fragments, credentials or signed URLs to the Reader.
    if (u.search) throw new Error('官网网址不能含查询参数，请填写公开首页网址');
    u.hash = ''; return u;
  }
  function publicIP(s: string) {
    if (s.includes(':')) {
      const ip = s.toLowerCase(), parts = ip.split(':'), first = parseInt(parts[0], 16), second = parseInt(parts[1] || '0', 16);
      return /^[0-9a-f:]+$/.test(ip) && first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3ffe && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
    }
    const a = s.split('.').map(Number); if (a.length !== 4 || a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 || a[0] === 100 && a[1] >= 64 && a[1] <= 127 || a[0] === 169 && a[1] === 254 || a[0] === 172 && a[1] >= 16 && a[1] <= 31 || a[0] === 192 && (a[1] === 168 || a[1] === 0 || a[1] === 88 && a[2] === 99) || a[0] === 198 && (a[1] === 18 || a[1] === 19 || a[1] === 51 && a[2] === 100) || a[0] === 203 && a[1] === 0 && a[2] === 113);
  }
  async function smallJSON(response: Response, maxBytes = 900000): Promise<any> {
    if (!response.body) throw new Error('公开网页服务未返回内容');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.length; if (size > maxBytes) throw new Error('网页返回内容过大，请人工核实'); chunks.push(p.value); } } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let at = 0; for (const p of chunks) { bytes.set(p, at); at += p.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('公开网页服务格式无效，请人工核实'); }
  }
  async function publicDNS(host: string, budget: Budget) {
    // Only fixed DNS and Reader endpoints are fetched; CRM never connects to target hosts directly.
    const answers = await Promise.all(['A','AAAA'].map(async type => {
      const u = new URL('https://dns.google/resolve'); u.searchParams.set('name', host); u.searchParams.set('type', type);
      const response = await fetch(u, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(remaining(budget, 3500)) });
      if (!response.ok) throw new Error('无法核实官网的公开网络地址，任务已停止');
      const json = await smallJSON(response, 60000); if (json.Status !== 0) throw new Error('官网域名无法解析，请核对网址');
      const records = Array.isArray(json.Answer) ? json.Answer : [];
      if (records.some((r: any) => r.type === 5 && !hostAllowed(String(r.data || '').replace(/\.$/, '')))) throw new Error('官网域名指向不受支持的网络地址');
      return records.filter((r: any) => r.type === 1 || r.type === 28).map((r: any) => String(r.data || ''));
    }));
    const ips = answers.flat(); if (!ips.length || ips.some(ip => !publicIP(ip))) throw new Error('官网未能通过公开网络地址检查，任务已停止');
  }
  async function searchCompany(db: DB, job: any, company: any, budget: Budget) {
    if (!capabilities().search) throw new Error('公司搜索尚未配置免费授权；当前未调用搜索服务，也不会启用付费后备服务');
    const key=(Deno.env.get('JINA_SEARCH_KEY')||'').trim();
    if(!/^[A-Za-z0-9_.-]{10,500}$/.test(key))throw new Error('公司搜索免费授权配置无效，请联系老板重新配置；未提交搜索');
    const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
    const name = text(company.company_name, 180), country = text(company.country, 80);
    if (name.length < 2) throw new Error('公司名称过短，无法提交准确的公开公司搜索');
    // A search-key account may be enabled only after an administrator confirms
    // free balance, no payment method and no automatic recharge. This flag is an
    // explicit release gate, not a billing API or an assertion about its balance.
    const reservation: any = checked(await db.from('crm_research_jobs').update({ search_attempted_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'running').eq('lease_until', job.lease_until).is('search_attempted_at', null).select('id').abortSignal(AbortSignal.timeout(remaining(budget, 2000))));
    if (!reservation?.length) throw new Error('此任务已有搜索尝试或状态变化；为避免重复调用不会自动重试。请查看结果或人工新建任务');
    const query = '"' + name + '"' + (country ? ' "' + country + '"' : '') + ' official website -site:linkedin.com -site:facebook.com -site:instagram.com -site:whatsapp.com';
    const requestURL = new URL('https://s.jina.ai/'); requestURL.searchParams.set('q', query); requestURL.searchParams.set('num', '5'); requestURL.searchParams.set('fallback', 'false');
    let response:Response;
    try{response = await fetch(requestURL, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(remaining(budget, 5000)), headers: {
      Authorization: 'Bearer ' + key, Accept: 'application/json', 'X-Respond-With': 'no-content', 'X-Robots-Txt': 'DelinCRMResearch', 'X-Timeout': '4', DNT: '1'
    } });}catch{throw new Error('公司搜索超时或网络不可用，本任务不会自动重复调用；不会启用付费后备服务');}
    // Official OpenAPI explicitly ignores X-Token-Budget on Search; do not send
    // it or advertise it as a billing cap. No-content avoids fetching candidates.
    if (!response.ok) throw new Error([401,402,403].includes(response.status) ? '搜索免费授权或余额不可用，已停止；不会充值、重试或启用付费服务' : response.status === 429 ? '搜索免费服务限流，本任务已停止且不会自动重复调用' : '公司搜索暂不可用，本任务不会自动重复调用；请人工核查');
    const payload = await smallJSON(response, 250000);
    if (payload.code && payload.code !== 200 || !Array.isArray(payload.data)) throw new Error('公司搜索服务返回格式无效，已停止，不会重复调用');
    const tokens = [...new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(v => v.length > 2 && !['the','company','limited','ltd','inc','llc','corporation','corp','group'].includes(v)))].slice(0, 12);
    const seen = new Set<string>(), candidates: any[] = [];
    for (const item of payload.data.slice(0, 5)) {
      if (typeof item?.url !== 'string') continue;
      try { const url = publicURL(item.url); if (seen.has(url.href)) continue; seen.add(url.href); candidates.push({ url, title: text(item.title, 300), snippet: text(item.description || item.snippet, 900) }); } catch { /* Reject private, social, short, signed and unsupported result URLs. */ }
    }
    const filtered = await Promise.allSettled(candidates.map(async item => {
      await publicDNS(item.url.hostname, budget);
      const combined = (item.title + ' ' + item.snippet + ' ' + item.url.hostname).toLowerCase();
      return { url: item.url.href, title: item.title, snippet: item.snippet, checked_at: new Date().toISOString(), name_matches: tokens.filter(token => combined.includes(token)), country_mentioned: !!country && combined.includes(country.toLowerCase()), candidate_website: item.url.origin + '/', source_kind: 'search_index', state: 'pending' } as SearchResult;
    }));
    return { query, checked_at: new Date().toISOString(), results: filtered.filter((r): r is PromiseFulfilledResult<SearchResult> => r.status === 'fulfilled').map(r => r.value), notice: '搜索引擎索引的候选结果，可能同名或过时；没有读取候选网站正文。名称/国家文本出现仅供核对，不证明该网站属于客户，需人工确认。' };
  }
  function sameSite(a: URL, b: URL) { return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, ''); }
  async function readPage(target: URL, root: URL, budget: Budget, dnsChecked: Set<string>): Promise<Page> {
    if (!sameSite(target, root)) throw new Error('仅处理同一个公司官网的公开页面');
    if (!dnsChecked.has(target.hostname)) { await publicDNS(target.hostname, budget); dnsChecked.add(target.hostname); }
    const response = await fetch('https://r.jina.ai/' + target.href, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(remaining(budget, 8500)), headers: {
      Accept: 'application/json', 'X-Engine': 'direct', 'X-Timeout': '7', 'X-Token-Budget': '6000', 'X-Robots-Txt': 'DelinCRMResearch', 'X-With-Links-Summary': 'true', DNT: '1'
    } });
    if (!response.ok) throw new Error(response.status === 429 ? '免费网页服务达到频率限制，请稍后重试' : response.status === 401 || response.status === 402 ? '免费网页服务不可用，已停止；不会启用付费调用' : '官网拒绝访问、超时或暂时不可用，请人工核实');
    const payload = await smallJSON(response); if (payload.code && payload.code !== 200) throw new Error('官网公开内容暂时无法读取，请人工核实');
    const data = payload.data; if (!data || typeof data.url !== 'string' || typeof data.content !== 'string') throw new Error('网页服务未返回可核实的来源信息');
    const finalURL = publicURL(data.url); if (!sameSite(finalURL, root)) throw new Error('官网跳转到其他网站，未采用跳转后的内容');
    if (!dnsChecked.has(finalURL.hostname)) { await publicDNS(finalURL.hostname, budget); dnsChecked.add(finalURL.hostname); }
    const content = data.content.slice(0, 70000).replace(/\u0000/g, '');
    if (content.trim().length < 80 || /^(?:access denied|forbidden|just a moment|verify you are human|404 not found)/i.test(content.trim())) throw new Error('官网内容不足或需要验证，请人工核实');
    return { url: finalURL.href, title: String(data.title || '').slice(0, 300), content, checked_at: new Date().toISOString() };
  }
  function links(page: Page, root: URL) {
    const out: URL[] = [], seen = new Set([page.url]);
    for (const match of page.content.matchAll(/\[([^\]\n]{0,160})\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (!/(?:contact|about|company|who we are|warehouse|distribution|wholesale|联系我们|关于我们|公司介绍)/i.test(match[1] + ' ' + match[2])) continue;
      try { const u = publicURL(match[2], page.url); if (!sameSite(u, root) || seen.has(u.href)) continue; seen.add(u.href); out.push(u); if (out.length === 2) break; } catch { /* Ignore unsupported or private links. */ }
    }
    return out;
  }
  const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>*\s-]+/, '').replace(/\s+/g, ' ').trim();
  function excerptAt(text: string, pos: number, length = 360) { const start = Math.max(text.lastIndexOf('\n', Math.max(0, pos - 100)), 0); return plain(text.slice(start, start + length)).slice(0, length); }
  function extract(pages: Page[]) {
    const suggestions: Suggestion[] = [], evidence: Evidence[] = [], seen = new Set<string>();
    const add = (field: string, label: string, value: string, page: Page, excerpt: string) => {
      value = value.trim(); const key = field + ':' + value.toLowerCase();
      if (!SAFE_FIELDS.has(field) || !value || seen.has(key) || suggestions.length >= 24 || suggestions.filter(s => s.field === field).length >= 8) return;
      seen.add(key); suggestions.push({ id: 's' + (suggestions.length + 1), field, label, value: value.slice(0, field === 'notes' ? 1200 : 500), source_url: page.url, checked_at: page.checked_at, excerpt: excerpt.slice(0, 500), state: 'pending' });
    };
    for (const page of pages) {
      // Text parsing only: retrieved text cannot execute instructions or mark qualifications verified.
      for (const match of page.content.matchAll(new RegExp(EMAIL.source, EMAIL.flags))) {
        const value = match[0].replace(/[.,;:]+$/, '').toLowerCase();
        if (/\.(?:png|jpe?g|webp|svg|gif)$/i.test(value) || /^(?:example|test|noreply|no-reply)@/i.test(value) || /@(?:example\.(?:com|org|net)|sentry\.io)$/i.test(value)) continue;
        add('company_email', '公开邮箱', value, page, excerptAt(page.content, match.index || 0));
      }
      for (const line of page.content.split('\n')) {
        if (/(?:\btel(?:ephone)?\b|\bphone\b|\bmobile\b|\bwhatsapp\b|电话|联系电话|手机)/i.test(line)) for (const m of line.matchAll(/(?:\+\d{1,3}[ .()-]*)?\(?\d[\d ()\u00a0.-]{5,}\d/g)) { const digits = m[0].replace(/\D/g, ''); if (digits.length >= 7 && digits.length <= 15 && !/^0+$/.test(digits)) add('company_phone', '公开电话（国际区号待核对）', m[0], page, plain(line)); }
        const address = plain(line).match(/^(?:address|office address|head office|地址|公司地址)\s*[:：]\s*(.{12,350})/i); if (address) add('address', '官网地址', address[1], page, plain(line));
        const cleaned = plain(line); if (cleaned.length < 35 || cleaned.length > 700) continue;
        for (const [topic, re] of [
          ['产品相关描述', /\b(?:flooring|laminate|engineered wood|SPC|WPC|wall panels?|wall cladding)\b|地板|墙板/i],
          ['批发/经销相关描述', /\b(?:wholesale|distributor|distribution|dealer network)\b|批发|经销网络/i],
          ['仓储相关描述', /\b(?:warehouse|warehousing|distribution cent(?:re|er))\b|仓库|仓储/i],
          ['进口相关描述（不能代替海关记录）', /\b(?:import(?:er|ing|s)?|imported)\b|进口/i],
          ['工程相关描述', /\b(?:contractor|construction|projects?)\b|工程|建筑/i]
        ] as Array<[string, RegExp]>) if (re.test(cleaned) && evidence.filter(e => e.topic === topic).length < 3) evidence.push({ topic, source_url: page.url, checked_at: page.checked_at, excerpt: cleaned.slice(0, 500), state: 'pending' });
      }
    }
    return { suggestions, evidence };
  }
  async function permitted(db: DB, job: any, budget: Budget) {
    const signal = AbortSignal.timeout(remaining(budget, 3500));
    const [actor, client, archived] = await Promise.all([db.from('profiles').select('id,active,role').eq('id', job.requested_by).maybeSingle().abortSignal(signal), db.from('clients').select('id,company_name,country,website,owner_id').eq('id', job.client_id).maybeSingle().abortSignal(signal), db.rpc('crm_is_archived', { p_client: job.client_id }).abortSignal(signal)]);
    const p: any = checked(actor), c: any = checked(client), a = checked(archived);
    if (!p?.active || !c || a || p.role !== 'admin' && c.owner_id !== p.id) throw new Error('客户归属或账号状态已变化，补资料任务已停止'); return c;
  }
  async function worker(db: DB, options: { timeBudgetMs?: number } = {}) {
    const budget: Budget = { end: Date.now() + Math.max(6000, Math.min(22000, options.timeBudgetMs || 22000)) };
    const jobs: any = checked(await db.rpc('crm_research_claim').abortSignal(AbortSignal.timeout(remaining(budget, 3500)))), job = jobs?.[0]; if (!job) return { processed: 0 };
    try {
      const c = await permitted(db, job, budget), pages: Page[] = [], warnings: string[] = [], dns = new Set<string>(), readBudget = { end: budget.end - 5000 };
      const recovered: any = checked(await db.from('crm_records').select('id,kind,data').eq('id', job.id).maybeSingle().abortSignal(AbortSignal.timeout(remaining(budget, 2000))));
      if (recovered) {
        if (recovered.kind !== 'research' || recovered.data?.source_job !== job.id) throw new Error('补资料结果编号冲突，请联系管理员');
        checked(await db.from('crm_research_jobs').update({ status: 'completed', result_id: job.id, error: null, finished_at: new Date().toISOString(), lease_until: null }).eq('id', job.id).eq('status', 'running').eq('lease_until', job.lease_until).abortSignal(AbortSignal.timeout(remaining(budget, 2000))));
        return { processed: 1, status: 'completed', recovered: true };
      }
      if (job.include_search && !capabilities().search) throw new Error('公司搜索尚未配置免费授权；当前没有调用搜索服务。可取消搜索选项，先使用已核实官网补资料');
      let root: URL | null = null;
      if (String(c.website || '').trim()) { try { root = publicURL(/^https?:\/\//i.test(c.website) ? c.website : 'https://' + c.website); } catch (error) { if (!job.include_search) throw error; warnings.push('已登记官网未通过检查，未读取该网址；搜索结果仍须另行核实。'); } }
      if (!root && !job.include_search) throw new Error('此客户尚未填写可读取的官网。请先核实官网，或在免费搜索启用后选择公司搜索');
      const initial = await Promise.allSettled([root ? readPage(root, root, readBudget, dns) : Promise.resolve(null), job.include_search ? searchCompany(db, job, c, readBudget) : Promise.resolve(null)]);
      let search: any = null;
      if (initial[0].status === 'fulfilled') { if (initial[0].value) pages.push(initial[0].value as Page); } else { if (!job.include_search) throw initial[0].reason; warnings.push(initial[0].reason instanceof Error ? initial[0].reason.message : '已登记官网暂时无法读取'); }
      if (initial[1].status === 'fulfilled') search = initial[1].value; else { if (!pages.length) throw initial[1].reason; warnings.push(initial[1].reason instanceof Error ? initial[1].reason.message : '公司搜索未完成，不会自动重试'); }
      // Search candidates are never fed into Reader. Only the already registered
      // company website supplies additional pages and disclosed contact suggestions.
      if (root && pages.length) {
        const results = await Promise.allSettled(links(pages[0], root).map(url => readPage(url, root!, readBudget, dns)));
        for (const result of results) { if (result.status === 'fulfilled') pages.push(result.value); else warnings.push(result.reason instanceof Error ? result.reason.message : '部分公开页面未能读取'); }
      }
      const result = extract(pages), data = {
        source_job: job.id, status: 'pending_review', method: search ? 'public_company_search_and_website_reader' : 'public_website_reader', search_used: !!search, search,
        company_name: c.company_name, country: c.country || '', website: root?.href || '', checked_at: new Date().toISOString(),
        pages: pages.map(({ url, title, checked_at }) => ({ url, title, checked_at })), suggestions: result.suggestions, evidence: result.evidence,
        warnings: [...new Set(warnings)], notice: '公开网页内容仅为待核实建议，不证明采购量、实际仓库或进口资格。未发现的信息保持未知；联系人姓名与经营年限不推测。未读取社交平台或登录页面。'
      };
      if (!String(c.website || '').trim() && search) {
        const origins = new Set<string>();
        for (const item of search.results as SearchResult[]) { if (origins.has(item.candidate_website)) continue; origins.add(item.candidate_website); result.suggestions.push({ id: 'site' + origins.size, field: 'website', label: '候选官网（尚未确认所属公司）', value: item.candidate_website, source_url: item.url, checked_at: item.checked_at, excerpt: (item.title + ' · ' + item.snippet + '。需人工核对公司名称、所在国家、地址及联系方式；本次未读取该候选网站。').slice(0, 500), state: 'pending' }); }
      }
      await permitted(db, job, budget);
      // A deterministic id allows an expired lease retry without overwriting reviewed evidence.
      const prior: any = checked(await db.from('crm_records').select('id,kind,data').eq('id', job.id).maybeSingle().abortSignal(AbortSignal.timeout(remaining(budget, 3000))));
      if (prior && (prior.kind !== 'research' || prior.data?.source_job !== job.id)) throw new Error('补资料结果编号冲突，请联系管理员');
      if (!prior) checked(await db.from('crm_records').insert({ id: job.id, client_id: job.client_id, kind: 'research', data, created_by: job.requested_by, updated_by: job.requested_by }).abortSignal(AbortSignal.timeout(remaining(budget, 3000))));
      checked(await db.from('crm_research_jobs').update({ status: 'completed', result_id: job.id, error: null, finished_at: new Date().toISOString(), lease_until: null }).eq('id', job.id).eq('status', 'running').eq('lease_until', job.lease_until).abortSignal(AbortSignal.timeout(remaining(budget, 3000))));
      return { processed: 1, status: 'completed', pages: pages.length, suggestions: result.suggestions.length };
    } catch (error) {
      const message = error instanceof Error && !/fetch|abort|signal|timeout/i.test(error.message) ? error.message : '官网访问超时或网络不可用，请稍后重试；不会改动客户资料或启用付费服务';
      checked(await db.from('crm_research_jobs').update({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString(), lease_until: null }).eq('id', job.id).eq('status', 'running').eq('lease_until', job.lease_until).abortSignal(AbortSignal.timeout(1500)));
      return { processed: 1, status: 'failed', error: message };
    }
  }
  // Discovery may read an unconfirmed, public candidate website. Its output is
  // staged evidence only; the caller cannot turn it into a verified CRM field.
  async function inspectWebsite(value: string, timeBudgetMs = 16000) {
    const budget: Budget = { end: Date.now() + Math.max(6000, Math.min(18000, timeBudgetMs)) };
    const root = publicURL(value), dns = new Set<string>(), pages = [await readPage(root, root, budget, dns)], warnings: string[] = [];
    const next = links(pages[0], root)[0];
    if (next && budget.end - Date.now() > 4000) {
      try { pages.push(await readPage(next, root, budget, dns)); } catch { warnings.push('联系或介绍页未能读取，请人工打开来源核实'); }
    }
    return { pages, ...extract(pages), warnings };
  }
  return { worker, capabilities, inspectWebsite, publicURL, smallJSON };
})();

/** Service-role integration: await researchWorker(db); processes at most one leased company. */
export const researchWorker = researchModule.worker;
export function researchCapabilities() { return researchModule.capabilities(); }
export const inspectPublicWebsite = researchModule.inspectWebsite;
export const researchPublicURL = researchModule.publicURL;
export const researchSmallJSON = researchModule.smallJSON;
