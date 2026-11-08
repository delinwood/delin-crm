import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import {
  FAILOVER_ORDER, PROVIDER_CATALOG, acceptFirecrawlCredits, acceptSerpapiAccount, acceptTavilyUsage,
  braveStorageAllowed, configuredFailover, failoverSearch, isQuotaError, mergeProviderStatus,
  probeProvider, quotaError, redactSearchResult
} from '../supabase/functions/crm-mail/discovery-providers.mjs';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const envOf = values => ({ get: key => values[key] });
const keys = {
  TAVILY_FREE_SEARCH_ENABLED: 'true',
  TAVILY_API_KEY: 'tvly-testkey-abcdefghij',
  FIRECRAWL_FREE_SEARCH_ENABLED: 'true',
  FIRECRAWL_API_KEY: 'fc-testkey-abcdefghij',
  SERPAPI_FREE_SEARCH_ENABLED: 'true',
  SERPAPI_API_KEY: 'a'.repeat(64),
  BRAVE_FREE_SEARCH_ENABLED: 'true',
  BRAVE_SEARCH_API_KEY: 'B'.repeat(32)
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

test('failover order is free providers only and SearXNG stays an extension slot', () => {
  assert.deepEqual(FAILOVER_ORDER, ['tavily', 'firecrawl', 'serpapi', 'brave']);
  assert.equal(PROVIDER_CATALOG.find(provider => provider.id === 'searxng').failover, false);
  assert.equal(configuredFailover(envOf({ ...keys, SEARXNG_BASE_URL: 'https://search.example.test' })).some(provider => provider.id === 'searxng'), false);
  assert.deepEqual(configuredFailover(envOf(keys)).map(provider => provider.id), FAILOVER_ORDER);
  assert.equal(braveStorageAllowed(envOf(keys)), false);
  assert.equal(braveStorageAllowed(envOf({ ...keys, BRAVE_STORAGE_RIGHTS_OK: 'true' })), true);
  assert.equal(braveStorageAllowed(envOf({ ...keys, BRAVE_STORAGE_RIGHTS_OK: 'TRUE' })), false);
});

test('free-plan guards hard-stop paid, paygo, and exhausted balances', () => {
  const freeTavily = { account: { current_plan: 'Researcher', plan_usage: 10, plan_limit: 1000, paygo_limit: 0, paygo_usage: 0 } };
  assert.equal(acceptTavilyUsage(freeTavily).remaining, 990);
  assert.equal(acceptTavilyUsage({ account: { ...freeTavily.account, paygo_limit: null } }).remaining, 990);
  for (const account of [
    { current_plan: 'Bootstrap', plan_usage: 0, plan_limit: 1000, paygo_limit: 0, paygo_usage: 0 },
    { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1001, paygo_limit: 0, paygo_usage: 0 },
    { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_limit: 1, paygo_usage: 0 },
    { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_limit: 0, paygo_usage: 1 },
    { current_plan: 'Researcher', plan_usage: 1000, plan_limit: 1000, paygo_limit: 0, paygo_usage: 0 }
  ]) assert.throws(() => acceptTavilyUsage({ account }), error => error.exhaust === true && /免费计划|按量付费/.test(error.message));

  assert.equal(acceptFirecrawlCredits({ data: { planCredits: 1000, remainingCredits: 40 } }, 2).remaining, 40);
  assert.throws(() => acceptFirecrawlCredits({ data: { planCredits: 3000, remainingCredits: 100 } }, 2), error => error.exhaust === true);
  assert.throws(() => acceptFirecrawlCredits({ data: { planCredits: 1000, remainingCredits: 1001 } }, 2), error => /高于免费/.test(error.message));
  assert.throws(() => acceptFirecrawlCredits({ data: { planCredits: 1000, remainingCredits: 1 } }, 2), error => error.exhaust === true && /已用尽/.test(error.message));

  const freeSerp = { plan_name: 'Free Plan', plan_monthly_price: 0, searches_per_month: 250, plan_searches_left: 3, extra_credits: 10 };
  assert.equal(acceptSerpapiAccount(freeSerp).remaining, 3);
  assert.throws(() => acceptSerpapiAccount({ ...freeSerp, plan_monthly_price: 25, searches_per_month: 1000, plan_name: 'Starter' }), error => error.exhaust === true);
  assert.throws(() => acceptSerpapiAccount({ ...freeSerp, plan_searches_left: 0, extra_credits: 10, total_searches_left: 10 }), error => /增购/.test(error.message) && error.exhaust === true);
});

test('Brave excerpts are not stored unless the storage-rights flag is exactly true', () => {
  const result = { results: [{ domain: 'buyer.example', website: 'https://buyer.example/', title: 'Brave title', score: 75, source: { url: 'https://buyer.example/about', title: 'Brave title', excerpt: 'SPC flooring importer in Saudi Arabia', provider: 'brave', storage: 'ephemeral' }, data: { evidence: [{ excerpt: 'SPC flooring importer' }], suggestions: [{ value: 'secret' }], reasons: ['出现目标产品词语'], score: 75 } }] };
  const hidden = redactSearchResult(result, { provider: 'brave', storageAllowed: false });
  assert.equal(hidden.results[0].title, 'buyer.example');
  assert.equal(hidden.results[0].source.excerpt, '');
  assert.equal(hidden.results[0].source.title, '');
  assert.deepEqual(hidden.results[0].data.evidence, []);
  assert.equal(hidden.results[0].score, 75);
  assert.equal(JSON.stringify(hidden).includes('SPC flooring importer'), false);
  const kept = redactSearchResult(result, { provider: 'brave', storageAllowed: true });
  assert.match(kept.results[0].source.excerpt, /SPC flooring importer/);
  const other = redactSearchResult({ results: [{ title: 'Keep', source: { excerpt: 'laminate flooring', provider: 'firecrawl' } }] }, { provider: 'firecrawl', storageAllowed: false });
  assert.match(other.results[0].source.excerpt, /laminate flooring/);
});

test('confirmed exhaustion switches provider and a usage outage does not spend the backup', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url);
    calls.push({ href, body: init?.body || null, headers: init?.headers || {} });
    if (href.includes('api.tavily.com/usage')) return jsonResponse({ account: { current_plan: 'Researcher', plan_usage: 1000, plan_limit: 1000, paygo_limit: 0, paygo_usage: 0 } });
    if (href.includes('api.tavily.com/search')) return jsonResponse({ error: 'should not search' }, 500);
    if (href.includes('firecrawl.dev/v2/team/credit-usage')) return jsonResponse({ success: true, data: { planCredits: 1000, remainingCredits: 80 } });
    if (href.includes('firecrawl.dev/v2/search')) return jsonResponse({ success: true, data: { web: [{ url: 'https://buyer.example/', title: 'Buyer', description: 'SPC flooring importer Saudi Arabia' }] } });
    throw new Error('unexpected ' + href);
  };
  const attempts = [];
  const found = await failoverSearch({
    providers: configuredFailover(envOf(keys)).slice(0, 2),
    query: 'SPC flooring importer Saudi Arabia',
    excludeDomains: ['alibaba.com'],
    env: envOf(keys),
    fetchImpl,
    begin: async provider => { attempts.push(['begin', provider.id, provider.searchWeight]); return 'attempt-' + provider.id; },
    finish: async (id, patch) => { attempts.push(['finish', id, patch.status, patch.count, patch.exhaust]); }
  });
  assert.equal(found.provider, 'firecrawl');
  assert.equal(found.hits[0].url, 'https://buyer.example/');
  assert.equal(calls.some(call => call.href.includes('api.tavily.com/search')), false);
  assert.equal(JSON.parse(calls.find(call => call.href.includes('firecrawl.dev/v2/search')).body).scrapeOptions, undefined);
  assert.deepEqual(attempts.filter(item => item[0] === 'begin').map(item => item[1]), ['tavily', 'firecrawl']);
  assert.equal(attempts.find(item => item[1] === 'attempt-tavily')[3], false);
  assert.equal(attempts.find(item => item[1] === 'attempt-tavily')[4], true);

  const backupCalls = [];
  await assert.rejects(() => failoverSearch({
    providers: configuredFailover(envOf(keys)).slice(0, 2),
    query: 'SPC flooring',
    excludeDomains: [],
    env: envOf(keys),
    fetchImpl: async url => {
      backupCalls.push(String(url));
      if (String(url).includes('/usage')) return jsonResponse({ error: 'down' }, 503);
      return jsonResponse({ success: true, data: { web: [] } });
    },
    begin: async () => 'a',
    finish: async () => {}
  }), error => isQuotaError(error) && error.exhaust === false);
  assert.equal(backupCalls.some(url => url.includes('firecrawl')), false);
});

test('paid HTTP failure counts the attempt and still tries the next free provider', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('/usage')) return jsonResponse({ account: { current_plan: 'Researcher', plan_usage: 1, plan_limit: 1000, paygo_limit: 0, paygo_usage: 0 } });
    if (String(url).includes('api.tavily.com/search')) return jsonResponse({ error: 'payment' }, 402);
    if (String(url).includes('credit-usage')) return jsonResponse({ success: true, data: { planCredits: 1000, remainingCredits: 10 } });
    if (String(url).includes('/v2/search')) return jsonResponse({ success: true, data: { web: [] } });
    throw new Error('unexpected');
  };
  const finished = [];
  await failoverSearch({
    providers: configuredFailover(envOf(keys)).slice(0, 2), query: 'wall panels', excludeDomains: [], env: envOf(keys), fetchImpl,
    begin: async provider => provider.id, finish: async (id, patch) => finished.push([id, patch.count, patch.exhaust, patch.status])
  });
  assert.equal(calls.filter(url => url.includes('api.tavily.com/search')).length, 1);
  assert.equal(calls.some(url => url.includes('firecrawl.dev/v2/search')), true);
  assert.deepEqual(finished[0], ['tavily', true, true, 'failed']);
});

test('no configured provider and probe results never echo secrets', async () => {
  await assert.rejects(() => failoverSearch({ providers: [], query: 'x', excludeDomains: [], env: envOf({}), fetchImpl: () => { throw new Error('network'); }, begin: async () => { throw new Error('should not reserve'); }, finish: async () => {} }), error => /不会自动付费/.test(error.message));
  const seen = [];
  const probe = await probeProvider('serpapi', envOf(keys), async url => {
    seen.push(String(url));
    return jsonResponse({ api_key: keys.SERPAPI_API_KEY, plan_name: 'Free Plan', plan_monthly_price: 0, searches_per_month: 250, plan_searches_left: 4, extra_credits: 0 });
  });
  assert.equal(JSON.stringify(probe).includes(keys.SERPAPI_API_KEY), false);
  assert.equal(probe.remaining, 4);
  assert.equal(seen[0].includes(keys.SERPAPI_API_KEY), true);
});

test('status merge keeps the job startable when only the primary free quota is gone', () => {
  const env = envOf(keys);
  const ledger = [
    { id: 'tavily', remaining: 0, limit: 900, exhausted: false },
    { id: 'firecrawl', remaining: 20, limit: 1000, exhausted: false },
    { id: 'serpapi', remaining: 250, limit: 250, exhausted: false },
    { id: 'brave', remaining: 1000, limit: 1000, exhausted: false }
  ];
  const live = [{ id: 'tavily', remaining: 0, exhausted: true }, { id: 'firecrawl', remaining: 20, exhausted: false }];
  const merged = mergeProviderStatus({ env, ledger, live });
  assert.equal(merged.enabled, true);
  assert.equal(merged.paidFallback, false);
  assert.equal(merged.providers.find(provider => provider.id === 'tavily').state, 'exhausted');
  assert.equal(merged.providers.find(provider => provider.id === 'firecrawl').state, 'ready');
  assert.equal(merged.providers.find(provider => provider.id === 'brave').persistsResults, false);
  const none = mergeProviderStatus({ env: envOf({}), ledger, live: [] });
  assert.equal(none.enabled, false);
  assert.equal(none.providers.every(provider => provider.state === 'unconfigured'), true);
});

test('quota copy and migration keep the installed Tavily cap instead of forcing 980', () => {
  const sql = read('supabase/migrations/20261108030000_free_search_failover.sql');
  const discovery = read('supabase/functions/crm-mail/discovery.ts');
  const lookup = read('js/v_lookup_tools.js');
  const page = read('js/v_discovery.js');
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, />=\\s\*980/);
  assert.match(sql, />=\\s\*900/);
  assert.doesNotMatch(sql, /monthly_attempt_cap,\s*980|values \('tavily'[^)]*980/);
  assert.match(sql, /\('searxng','SearXNG',50,null,false,false/);
  assert.doesNotMatch(sql, /'companies|companies_house/i);
  assert.doesNotMatch(sql, /tvly-|fc-[A-Za-z0-9]|api_key\s*[:=]\s*'/);
  assert.match(sql, /enable row level security/);
  assert.match(discovery, /spc:/);
  assert.match(discovery, /laminate:/);
  assert.match(discovery, /wpc_decking:/);
  assert.match(discovery, /redactSearchResult/);
  assert.match(read('supabase/functions/crm-mail/discovery-providers.mjs'), /paygo_limit/);
  assert.match(lookup, /免费源用完自动切换；不会自动付费/);
  assert.match(lookup, /未配置/);
  assert.match(lookup, /已用尽/);
  assert.match(page, /免费源用完自动切换；不会自动付费/);
  assert.doesNotMatch(page, /每月最多900|每月最多980/);
  const context = { UI: { views: {} }, document: {}, DB: {} };
  vm.runInNewContext(lookup, context);
  const lines = context.UI.discoveryQuotaLines({
    discovery_providers: [
      { id: 'tavily', name: 'Tavily Free', remaining: 0, limit: 900, unit: '次', exhausted: false, in_failover: true },
      { id: 'firecrawl', name: 'Firecrawl Free', remaining: 12, limit: 1000, unit: '积分', in_failover: true },
      { id: 'serpapi', name: 'SerpAPI Free', remaining: 250, limit: 250, unit: '次', in_failover: true },
      { id: 'brave', name: 'Brave Search', remaining: 1000, limit: 1000, unit: '次', in_failover: true }
    ]
  }, { providers: [
    { id: 'tavily', configured: true, state: 'exhausted', remaining: 0 },
    { id: 'firecrawl', configured: true, state: 'ready', remaining: 12 },
    { id: 'serpapi', configured: false },
    { id: 'brave', configured: true, state: 'ready', remaining: 1000, persistsResults: false }
  ] });
  assert.match(lines.join('\n'), /免费源用完自动切换；不会自动付费/);
  assert.match(lines.join('\n'), /Tavily Free：已用尽/);
  assert.match(lines.join('\n'), /Firecrawl Free：剩余 12／1000 积分/);
  assert.match(lines.join('\n'), /SerpAPI Free：未配置/);
  assert.match(lines.join('\n'), /Brave Search：剩余 1000／1000 次（摘录不入库，仅当次排序）/);
  assert.equal(isQuotaError(quotaError('免费搜索额度已用尽；不会自动付费', { exhaust: true })), true);
  assert.equal(isQuotaError(new Error('免费搜索限流，本次不重复调用')), false);
});

test('discovery and lookup pages show every provider and still start when the backup has quota', async t => {
  const chrome = '/usr/local/bin/google-chrome';
  if (!fs.existsSync(chrome)) { t.skip('chrome is not installed'); return; }
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, 'http://127.0.0.1').pathname;
    const path = new URL('.' + (file === '/' ? '/tests/discovery-quota-fixture.html' : file), root);
    if (!path.pathname.startsWith(root.pathname) || (!path.pathname.endsWith('.html') && !path.pathname.includes('/js/'))) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': path.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const chromeRun = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:${port}/tests/discovery-quota-fixture.html`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let dom = '';
  const code = await new Promise(resolve => {
    const timer = setTimeout(() => { chromeRun.kill('SIGKILL'); resolve(dom.includes('QUOTA_READY') ? 0 : 'timeout'); }, 12000);
    chromeRun.stdout.on('data', chunk => {
      dom += chunk;
      if (dom.includes('QUOTA_READY')) { clearTimeout(timer); chromeRun.kill('SIGKILL'); resolve(0); }
    });
    chromeRun.on('close', () => { clearTimeout(timer); resolve(dom.includes('QUOTA_READY') ? 0 : 'closed'); });
  });
  server.close();
  if (code !== 0) assert.fail(`chrome exited ${code}\n${dom.slice(0, 1500)}`);
  assert.equal(code, 0);
  assert.match(dom, /QUOTA_READY/);
  assert.match(dom, /免费源用完自动切换；不会自动付费/);
  assert.match(dom, /Tavily Free：已用尽/);
  assert.match(dom, /Firecrawl Free：剩余 12／1000 积分/);
  assert.match(dom, /SerpAPI Free：未配置/);
  assert.match(dom, /Brave Search：剩余 1000／1000 次（摘录不入库，仅当次排序）/);
  assert.match(dom, /START_ENABLED/);
  assert.match(dom, /SUBMITTED:spc,wall/);
  assert.match(dom, /ALL_EXHAUSTED_DISABLED/);
  assert.match(dom, /本人近 24 小时可再提交 20／20 家/);
});
