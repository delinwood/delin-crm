/* Free-only search providers for automatic prospecting.
 * Failover order is fixed. SearXNG is a registry slot only: this module never calls it.
 * No provider may top up, auto-reload, or spend a paid balance.
 * Callers pass env and fetch so tests can run without live keys.
 */

export const FAILOVER_ORDER = ['tavily', 'firecrawl', 'serpapi', 'brave'];

export const PROVIDER_CATALOG = [
  { id: 'tavily', name: 'Tavily Free', order: 10, failover: true, unit: '次', searchWeight: 1, envFlag: 'TAVILY_FREE_SEARCH_ENABLED', envKey: 'TAVILY_API_KEY', keyPattern: /^tvly-[A-Za-z0-9_-]{10,250}$/ },
  { id: 'firecrawl', name: 'Firecrawl Free', order: 20, failover: true, unit: '积分', searchWeight: 2, scrapeWeight: 1, envFlag: 'FIRECRAWL_FREE_SEARCH_ENABLED', envKey: 'FIRECRAWL_API_KEY', keyPattern: /^fc-[A-Za-z0-9_-]{10,250}$/ },
  { id: 'serpapi', name: 'SerpAPI Free', order: 30, failover: true, unit: '次', searchWeight: 1, envFlag: 'SERPAPI_FREE_SEARCH_ENABLED', envKey: 'SERPAPI_API_KEY', keyPattern: /^[a-f0-9]{32,128}$/i },
  { id: 'brave', name: 'Brave Search', order: 40, failover: true, unit: '次', searchWeight: 1, envFlag: 'BRAVE_FREE_SEARCH_ENABLED', envKey: 'BRAVE_SEARCH_API_KEY', keyPattern: /^[A-Za-z0-9_-]{20,200}$/ },
  { id: 'searxng', name: 'SearXNG', order: 50, failover: false, implemented: false, unit: '次', searchWeight: 1, note: '自建 SearXNG 只保留注册位。本版不读取地址、不发起请求、不占用额度。' }
];

const QUOTA_TEXT = /免费计划|免费授权|免费搜索额度|免费积分|不会自动付费|不会调用付费|无法确认|已用尽|余额不可用|已尝试过|高于免费|按量付费/;

export function quotaError(message, options = {}) {
  const error = new Error(message);
  error.quota = true;
  error.counted = options.counted === true;
  error.exhaust = options.exhaust === true;
  return error;
}

export function isQuotaError(error) {
  return !!(error && (error.quota || QUOTA_TEXT.test(String(error.message || ''))));
}

export function braveStorageAllowed(env) {
  return env.get('BRAVE_STORAGE_RIGHTS_OK') === 'true';
}

export function providerById(id) {
  return PROVIDER_CATALOG.find(provider => provider.id === id) || null;
}

export function isConfigured(provider, env) {
  if (!provider?.failover || provider.implemented === false) return false;
  if (env.get(provider.envFlag) !== 'true') return false;
  return provider.keyPattern.test(env.get(provider.envKey) || '');
}

export function configuredFailover(env) {
  return PROVIDER_CATALOG.filter(provider => isConfigured(provider, env));
}

function keyOf(provider, env) {
  const key = env.get(provider.envKey) || '';
  if (!provider.keyPattern.test(key)) throw quotaError(provider.name + '免费授权配置无效，已停止；不会自动付费', { exhaust: true });
  return key;
}

async function call(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new Error('搜索服务未确认成功，本次不自动重试');
  }
}

export async function readBoundedJSON(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('搜索结果过大，本次不自动重试');
    try { return JSON.parse(text); } catch { throw new Error('搜索结果格式无效，本次不自动重试'); }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('搜索结果过大，本次不自动重试');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('搜索结果格式无效，本次不自动重试'); }
}

export function acceptTavilyUsage(payload) {
  const account = payload?.account;
  if (!account || !['researcher', 'free', 'researcher (free)'].includes(String(account.current_plan || '').toLowerCase()) || Number(account.plan_limit) > 1000 || Number(account.paygo_limit) !== 0 || Number(account.paygo_usage) !== 0 || !Number.isFinite(Number(account.plan_usage)) || !Number.isFinite(Number(account.plan_limit)) || Number(account.plan_usage) >= Number(account.plan_limit)) {
    throw quotaError('搜索账号免费计划或余额未通过核对，任务已停止；请核对Researcher免费计划且按量付费关闭', { exhaust: true });
  }
  const limit = Number(account.plan_limit);
  const used = Number(account.plan_usage);
  return { used, limit, remaining: limit - used };
}

export function acceptFirecrawlCredits(payload, cost) {
  const data = payload?.data || payload;
  const plan = Number(data?.planCredits);
  const remaining = Number(data?.remainingCredits);
  if (!Number.isFinite(plan) || plan <= 0 || plan > 1000) throw quotaError('Firecrawl 不是已核对的免费计划（每月不超过1000积分）；已停止，不会自动付费', { exhaust: true });
  if (!Number.isFinite(remaining) || remaining < 0) throw quotaError('无法确认 Firecrawl 免费积分，已停止；不会调用付费搜索', { exhaust: false });
  if (remaining > plan) throw quotaError('Firecrawl 余额高于免费计划额度，已停止；不会使用增购或自动充值积分', { exhaust: true });
  if (remaining < cost) throw quotaError('Firecrawl 免费积分已用尽；不会自动付费', { exhaust: true });
  return { remaining, limit: plan };
}

export function acceptSerpapiAccount(account) {
  const price = Number(account?.plan_monthly_price);
  const included = Number(account?.searches_per_month);
  const left = Number(account?.plan_searches_left);
  const extra = Number(account?.extra_credits || 0);
  if (!account || !/free/i.test(String(account.plan_name || '')) || price !== 0 || !Number.isFinite(included) || included <= 0 || included > 250 || !Number.isFinite(left)) {
    throw quotaError('SerpAPI 不是已核对的免费计划（每月不超过250次）；已停止，不会自动付费', { exhaust: true });
  }
  if (left < 1) throw quotaError('SerpAPI 免费次数已用尽；不会使用增购次数，也不会自动付费', { exhaust: true });
  if (extra > 0 && left < 1) throw quotaError('SerpAPI 免费次数已用尽；不会使用增购次数，也不会自动付费', { exhaust: true });
  return { remaining: left, limit: included };
}

export function braveMonthlyRemaining(headers) {
  const remaining = String(headers?.get?.('x-ratelimit-remaining') || '').split(',').map(part => Number(part.trim()));
  const limits = String(headers?.get?.('x-ratelimit-limit') || '').split(',').map(part => Number(part.trim()));
  if (remaining.length < 2 || limits.length < 2 || remaining.some(n => !Number.isFinite(n)) || limits.some(n => !Number.isFinite(n))) return null;
  let index = 0;
  for (let i = 1; i < limits.length; i += 1) if (limits[i] > limits[index]) index = i;
  if (!(limits[index] >= 60)) return null;
  return remaining[index];
}

function httpFailure(status, label, extra = []) {
  if ([401, 402, 403, ...extra].includes(status)) throw quotaError(label + '免费授权或余额不可用，已停止；不充值、不自动重试', { counted: true, exhaust: true });
  if (status === 429) throw new Error(label + '免费搜索限流，本次不重复调用，请稍后新建任务');
  throw new Error('搜索服务未确认成功，本次不自动重试');
}

async function tavilyUsage(env, fetchImpl) {
  const provider = providerById('tavily');
  const key = keyOf(provider, env);
  const response = await call(fetchImpl, 'https://api.tavily.com/usage', { redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw quotaError('无法确认免费搜索额度，已停止；不会调用付费搜索', { exhaust: false });
  return acceptTavilyUsage(await readBoundedJSON(response, 40000));
}

async function tavilySearch(env, fetchImpl, query, excludeDomains) {
  const usage = await tavilyUsage(env, fetchImpl);
  const key = keyOf(providerById('tavily'), env);
  const response = await call(fetchImpl, 'https://api.tavily.com/search', {
    method: 'POST', redirect: 'error', credentials: 'omit',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ query, search_depth: 'basic', topic: 'general', max_results: 20, include_answer: false, include_raw_content: false, include_images: false, auto_parameters: false, include_usage: true, exclude_domains: excludeDomains })
  });
  if (!response.ok) httpFailure(response.status, 'Tavily ', [432, 433]);
  const payload = await readBoundedJSON(response, 600000);
  if (!Array.isArray(payload.results)) throw new Error('搜索结果格式无效，本次不自动重试');
  return { hits: payload.results.slice(0, 20).map(item => ({ url: String(item.url || ''), title: String(item.title || ''), excerpt: String(item.content || '') })), vendorRemaining: usage.remaining - 1 };
}

async function firecrawlCredits(env, fetchImpl, cost) {
  const key = keyOf(providerById('firecrawl'), env);
  const response = await call(fetchImpl, 'https://api.firecrawl.dev/v2/team/credit-usage', { redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw quotaError('无法确认 Firecrawl 免费积分，已停止；不会调用付费搜索', { exhaust: false });
  return acceptFirecrawlCredits(await readBoundedJSON(response, 40000), cost);
}

async function firecrawlSearch(env, fetchImpl, query) {
  await firecrawlCredits(env, fetchImpl, 2);
  const key = keyOf(providerById('firecrawl'), env);
  const response = await call(fetchImpl, 'https://api.firecrawl.dev/v2/search', {
    method: 'POST', redirect: 'error', credentials: 'omit',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ query: String(query).slice(0, 500), limit: 10, sources: [{ type: 'web' }] })
  });
  if (!response.ok) httpFailure(response.status, 'Firecrawl ');
  const payload = await readBoundedJSON(response, 600000);
  const web = Array.isArray(payload?.data?.web) ? payload.data.web : [];
  if (!payload?.success && !web.length) throw new Error('搜索结果格式无效，本次不自动重试');
  return { hits: web.slice(0, 10).map(item => ({ url: String(item.url || ''), title: String(item.title || ''), excerpt: String(item.description || '') })), vendorRemaining: null };
}

export async function firecrawlScrape(env, fetchImpl, url) {
  await firecrawlCredits(env, fetchImpl, 1);
  const key = keyOf(providerById('firecrawl'), env);
  const response = await call(fetchImpl, 'https://api.firecrawl.dev/v2/scrape', {
    method: 'POST', redirect: 'error', credentials: 'omit',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 12000 })
  });
  if (!response.ok) httpFailure(response.status, 'Firecrawl ');
  const payload = await readBoundedJSON(response, 700000);
  const markdown = String(payload?.data?.markdown || '');
  if (!payload?.success || markdown.trim().length < 80) throw new Error('官网公开内容暂时无法读取，请人工核实');
  const title = String(payload?.data?.metadata?.title || '').slice(0, 300);
  const finalURL = String(payload?.data?.metadata?.sourceURL || payload?.data?.metadata?.url || url);
  return { url: finalURL, title, markdown: markdown.slice(0, 70000) };
}

async function serpapiAccount(env, fetchImpl) {
  const key = keyOf(providerById('serpapi'), env);
  const url = new URL('https://serpapi.com/account.json');
  url.searchParams.set('api_key', key);
  const response = await call(fetchImpl, url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw quotaError('无法确认 SerpAPI 免费次数，已停止；不会调用付费搜索', { exhaust: false });
  const payload = await readBoundedJSON(response, 40000);
  return acceptSerpapiAccount(payload);
}

async function serpapiSearch(env, fetchImpl, query) {
  await serpapiAccount(env, fetchImpl);
  const key = keyOf(providerById('serpapi'), env);
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', String(query).slice(0, 500));
  url.searchParams.set('num', '10');
  url.searchParams.set('api_key', key);
  const response = await call(fetchImpl, url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (!response.ok) httpFailure(response.status, 'SerpAPI ');
  const payload = await readBoundedJSON(response, 600000);
  if (payload.error) {
    if (/limit|credit|quota|plan|exhaust/i.test(String(payload.error))) throw quotaError('SerpAPI 免费授权或余额不可用，已停止；不充值、不自动重试', { counted: true, exhaust: true });
    throw new Error('搜索服务未确认成功，本次不自动重试');
  }
  if (!Array.isArray(payload.organic_results)) throw new Error('搜索结果格式无效，本次不自动重试');
  return { hits: payload.organic_results.slice(0, 10).map(item => ({ url: String(item.link || ''), title: String(item.title || ''), excerpt: String(item.snippet || '') })), vendorRemaining: null };
}

async function braveSearch(env, fetchImpl, query) {
  const key = keyOf(providerById('brave'), env);
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', String(query).slice(0, 400));
  url.searchParams.set('count', '10');
  url.searchParams.set('result_filter', 'web');
  url.searchParams.set('safesearch', 'strict');
  const response = await call(fetchImpl, url, {
    redirect: 'error', credentials: 'omit',
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) httpFailure(response.status, 'Brave ');
  const payload = await readBoundedJSON(response, 600000);
  const results = payload?.web?.results;
  if (!Array.isArray(results)) throw new Error('搜索结果格式无效，本次不自动重试');
  const vendorRemaining = braveMonthlyRemaining(response.headers);
  return {
    hits: results.slice(0, 10).map(item => ({ url: String(item.url || ''), title: String(item.title || ''), excerpt: String(item.description || '') })),
    vendorRemaining
  };
}

const SEARCHERS = { tavily: tavilySearch, firecrawl: firecrawlSearch, serpapi: serpapiSearch, brave: braveSearch };

export async function searchProvider(id, { env, fetchImpl, query, excludeDomains }) {
  const search = SEARCHERS[id];
  if (!search || id === 'searxng') throw new Error('该搜索源未接入，本次不调用');
  return search(env, fetchImpl, query, excludeDomains);
}

export async function probeProvider(id, env, fetchImpl) {
  if (id === 'tavily') {
    const usage = await tavilyUsage(env, fetchImpl);
    return { remaining: usage.remaining, limit: usage.limit, exhausted: usage.remaining <= 0, checked: true };
  }
  if (id === 'firecrawl') {
    const credits = await firecrawlCredits(env, fetchImpl, 1);
    return { remaining: credits.remaining, limit: credits.limit, exhausted: credits.remaining < 1, checked: true };
  }
  if (id === 'serpapi') {
    const account = await serpapiAccount(env, fetchImpl);
    return { remaining: account.remaining, limit: account.limit, exhausted: account.remaining < 1, checked: true };
  }
  if (id === 'brave') return { remaining: null, limit: null, exhausted: false, checked: false };
  return { remaining: null, limit: null, exhausted: false, checked: false };
}

export async function failoverSearch({ providers, query, excludeDomains, env, fetchImpl, begin, finish }) {
  if (!providers.length) throw quotaError('免费搜索源都未配置；不会自动付费', { exhaust: true });
  let last = null;
  for (const provider of providers) {
    let attemptId = null;
    try {
      attemptId = await begin(provider);
      const outcome = await searchProvider(provider.id, { env, fetchImpl, query, excludeDomains });
      await finish(attemptId, { status: 'completed', count: true, exhaust: outcome.vendorRemaining === 0, error: null });
      return { provider: provider.id, hits: outcome.hits, storageAllowed: provider.id !== 'brave' || braveStorageAllowed(env) };
    } catch (error) {
      if (attemptId) {
        await finish(attemptId, {
          status: 'failed',
          count: isQuotaError(error) ? error.counted === true : true,
          exhaust: isQuotaError(error) && error.exhaust === true,
          error: String(error?.message || '搜索失败').slice(0, 500)
        });
      }
      if (isQuotaError(error) && error.exhaust === true) { last = error; continue; }
      throw error;
    }
  }
  throw last || quotaError('免费搜索额度已用尽；不会自动付费', { exhaust: true });
}

export function readerMayFallback(message) {
  const text = String(message || '');
  return /超时|不可用|限流|拒绝访问|未能读取|免费网页|网络不可用/.test(text) && !/格式不安全|内网|查询参数|社交|短链|文件、账号/.test(text);
}

export function contactsFromText(text, url, at) {
  const suggestions = [];
  const seen = new Set();
  const source = String(text || '').slice(0, 70000);
  const add = (field, label, value, excerpt) => {
    const key = field + ':' + value.toLowerCase();
    if (seen.has(key) || suggestions.length >= 16) return;
    seen.add(key);
    suggestions.push({ id: 's' + (suggestions.length + 1), field, label, value: value.slice(0, 500), source_url: url, checked_at: at, excerpt: String(excerpt || '').slice(0, 500), state: 'pending' });
  };
  for (const match of source.matchAll(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi)) {
    const value = match[0].replace(/[.,;:]+$/, '').toLowerCase();
    if (/\.(?:png|jpe?g|webp|svg|gif)$/i.test(value) || /^(?:example|test|noreply|no-reply)@/i.test(value)) continue;
    add('company_email', '公开邮箱', value, source.slice(Math.max(0, match.index - 40), match.index + 80));
  }
  for (const line of source.split('\n')) {
    if (!/(?:\btel(?:ephone)?\b|\bphone\b|\bmobile\b|\bwhatsapp\b|电话|联系电话|手机)/i.test(line)) continue;
    for (const match of line.matchAll(/(?:\+\d{1,3}[ .()-]*)?\(?\d[\d ()\u00a0.-]{5,}\d/g)) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) add('company_phone', '公开电话（国际区号待核对）', match[0], line);
    }
  }
  return suggestions;
}

export function redactSearchResult(result, { provider, storageAllowed }) {
  if (provider !== 'brave' || storageAllowed) return result;
  const results = (result?.results || []).map(item => ({
    domain: item.domain,
    website: item.website,
    title: item.domain || '',
    score: item.score,
    source: {
      url: item.source?.url || item.website,
      title: '',
      excerpt: '',
      checked_at: item.source?.checked_at || null,
      kind: 'search_index',
      provider: 'brave',
      storage: 'ephemeral'
    },
    data: {
      score: item.data?.score ?? item.score,
      product_matches: item.data?.product_matches || [],
      buyer_matches: item.data?.buyer_matches || [],
      country_mentioned: !!item.data?.country_mentioned,
      warehouse_mentioned: !!item.data?.warehouse_mentioned,
      evidence: [],
      reasons: item.data?.reasons || [],
      suitability: item.data?.suitability || '待核实',
      suggestions: [],
      pages: [],
      checked_at: item.data?.checked_at || null,
      notice: 'Brave 结果只在当次内存中参与排序，摘录未写入 CRM。请用随后读取的官网原文核实。'
    }
  }));
  return { results, credits: null, provider: 'brave', storage: 'ephemeral' };
}

export function mergeProviderStatus({ catalog = PROVIDER_CATALOG, env, ledger = [], live = [] }) {
  const ledgerById = new Map(ledger.map(row => [row.id, row]));
  const liveById = new Map(live.map(row => [row.id, row]));
  const providers = catalog.filter(provider => provider.failover).map(provider => {
    const configured = isConfigured(provider, env);
    const row = ledgerById.get(provider.id);
    const probe = liveById.get(provider.id);
    const persistsResults = provider.id !== 'brave' || braveStorageAllowed(env);
    if (!configured) return { id: provider.id, name: provider.name, configured: false, state: 'unconfigured', remaining: null, limit: row?.limit ?? null, unit: provider.unit, persistsResults, in_failover: true };
    let remaining = Number.isInteger(row?.remaining) ? row.remaining : null;
    let limit = Number.isInteger(row?.limit) ? row.limit : null;
    if (probe && Number.isInteger(probe.remaining)) remaining = remaining == null ? probe.remaining : Math.min(remaining, probe.remaining);
    if (probe && Number.isInteger(probe.limit)) limit = limit == null ? probe.limit : Math.min(limit, probe.limit);
    const exhausted = row?.exhausted === true || probe?.exhausted === true || remaining === 0;
    const state = exhausted ? 'exhausted' : 'ready';
    return { id: provider.id, name: provider.name, configured: true, state, remaining, limit, unit: provider.unit, persistsResults, in_failover: true };
  });
  return {
    enabled: providers.some(provider => provider.state === 'ready'),
    freeOnly: true,
    paidFallback: false,
    provider: providers.find(item => item.state === 'ready')?.name || providers.find(item => item.configured)?.name || '未配置',
    providers,
    failover: FAILOVER_ORDER.slice(),
    extensionOnly: ['searxng']
  };
}
