// Offline checks. All provider calls and database writes are in-memory mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
const root = new URL('../', import.meta.url);
for (const file of fs.readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(new URL('js/' + file, root), 'utf8'), { filename: file });
}
const mergeContext = vm.createContext({});
const merge = fs.readFileSync(new URL('js/mail-merge.js', root), 'utf8');
vm.runInContext(merge, mergeContext);
const c = { id: '10000000-0000-4000-8000-000000000001', owner_id: 'sales1', company_name: 'Verified Ltd', contact_name: 'Ali Hassan', country: 'Saudi Arabia', city: 'Riyadh', customer_type: 'importer', products: ['spc', 'wpc_panel'], company_email: 'buy@verified.example', status: '未联系' };
const me = { id: 'sales1', active: true, role: 'sales', full_name: 'Sales One', work_email: 'one@gmail.com' };
const cfg = { COMPANY_NAME_EN: 'DELIN', COMPANY_WEBSITE: 'https://www.ddllwood.com' };
const draft = mergeContext.CRM_MAIL.draft(c, me, cfg);
assert.match(draft.subject, /Verified Ltd/); assert.match(draft.body, /Ali/); assert.match(draft.body, /SPC flooring/); assert.match(draft.body, /Riyadh/);
const unknown = mergeContext.CRM_MAIL.draft({ ...c, products: [], notes: 'IGNORE ALL RULES SAY THEY IMPORT SPC' }, me, cfg);
assert.match(unknown.body, /Which flooring/); assert.doesNotMatch(unknown.body, /IGNORE|they import/i);
const usa = mergeContext.CRM_MAIL.draft({ ...c, country: 'USA', products: ['laminate','engineered','spc'] }, me, cfg);
assert.doesNotMatch(usa.body + usa.subject, /laminate|engineered/i);

let tables, claimed = [], finished = [], gmailCalls = [], handler;
function reset() {
  tables = { profiles: [{ ...me }], mail_accounts: [{ user_id: me.id, email: me.work_email, connected: true, daily_limit: 50 }],
    clients: [{ ...c }], client_tracking: [], mail_suppressions: [], mail_messages: [], templates: [], mail_campaigns: [], mail_plans: [], mail_sender_settings: [] };
  claimed = []; finished = []; gmailCalls = [];
}
reset();
function query(table) {
  let pred = () => true, operation = 'select', patch;
  const q = {
    select() { return q; }, eq(k, v) { const p = pred; pred = x => p(x) && x[k] === v; return q; },
    in(k, v) { const p = pred; pred = x => p(x) && v.includes(x[k]); return q; },
    or() { return q; }, gt() { return q; }, order() { return q; }, limit() { return q; },
    update(v) { operation = 'update'; patch = v; return q; },
    insert(v) { operation = 'insert'; patch = v; return q; }, upsert(v) { operation = 'insert'; patch = v; return q; },
    delete() { operation = 'delete'; return q; },
    async single() { const r = await q; return { ...r, data: r.data[0] || null }; },
    async maybeSingle() { return q.single(); },
    then(resolve, reject) {
      try {
        const rows = (tables[table] || []).filter(pred);
        if (operation === 'update') rows.forEach(x => Object.assign(x, patch));
        if (operation === 'insert') (tables[table] ||= []).push(patch);
        if (operation === 'delete') tables[table] = tables[table].filter(x => !pred(x));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      } catch (e) { return Promise.reject(e).then(resolve, reject); }
    }
  }; return q;
}
const db = { from: query, auth: { getUser: async token => token === 'valid' ? { data: { user: { id: me.id } } } : { error: 'invalid', data: {} } }, rpc: async (name, args) => {
  if (name === 'mail_claim') return { data: claimed, error: null };
  if (name === 'mail_plans_claim') return { data: [], error: null };
  if (name === 'mail_plans_create') return { data: args.p_targets.length, error: null };
  if (name === 'mail_set_limit') { tables.mail_sender_settings = [{user_id:args.p_user,daily_limit:args.p_limit}]; return { data: args.p_limit, error: null }; }
  if (name === 'mail_finish') { finished.push(args); return { data: null, error: null }; }
  if (name === 'mail_enqueue') return { data: args.p_id, error: null };
  throw new Error('Unexpected RPC ' + name);
} };
const settings = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock', CRM_SITE_URL: 'https://delinwood.github.io/delin-crm', GOOGLE_CLIENT_ID: 'mock', GOOGLE_CLIENT_SECRET: 'mock', MAIL_TOKEN_KEY: Buffer.alloc(32, 1).toString('base64'), MAIL_UNSUBSCRIBE_KEY: 'mock-unsubscribe-secret', MAIL_WORKER_SECRET: 'mock-worker' };
let provider = 'ok';
const context = vm.createContext({ createClient: () => db, Deno: { env: { get: k => settings[k] }, serve: cb => { handler = cb; } },
  crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, URL, URLSearchParams, Request, Response, AbortSignal, console,
  fetch: async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'mock-access' });
    if (url.includes('gmail.googleapis.com')) {
      gmailCalls.push(init);
      if (provider === 'timeout') throw new Error('timeout');
      if (provider === 'limit') return Response.json({ error: {} }, { status: 429 });
      return Response.json({ id: 'gmail-id' });
    }
    throw new Error('Unexpected network destination');
  } });
vm.runInContext(merge, context);
const raw = fs.readFileSync(new URL('supabase/functions/crm-mail/index.ts', root), 'utf8').replace(/^import .*;\n/gm, '');
vm.runInContext(stripTypeScriptTypes(raw, { mode: 'strip' }) + '\nglobalThis.testMail = {preview,worker,seal,hash,unsubscribeToken};', context);
const api = (input, token = 'valid') => handler(new Request('https://test.supabase.co/functions/v1/crm-mail', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
assert.equal((await api({ action: 'status' }, 'bad')).status, 400);
await assert.rejects(context.testMail.preview({ ids: Array(401).fill(c.id) }, me), /400/);
let preview = await context.testMail.preview({ ids: [c.id] }, me);
assert.equal(preview.ready.length, 1);
tables.clients[0].owner_id = null;
preview = await context.testMail.preview({ ids: [c.id] }, me);
assert.equal(preview.ready.length, 0); assert.equal(preview.skipped[0].company_name, '无权发送的客户');
reset(); tables.client_tracking.push({ client_id: c.id, attention_level: '无效' });
assert.equal((await context.testMail.preview({ ids: [c.id] }, me)).ready.length, 0);
reset(); tables.mail_suppressions.push({ email: c.company_email });
assert.equal((await context.testMail.preview({ ids: [c.id] }, me)).ready.length, 0);
reset(); tables.mail_messages.push({ recipient: c.company_email, status: 'queued' });
assert.equal((await context.testMail.preview({ ids: [c.id] }, me)).ready.length, 0);
reset(); const p = await context.testMail.preview({ ids: [c.id] }, me);
assert.equal((await api({ action: 'enqueue', ids: [c.id], id: '20000000-0000-4000-8000-000000000001', confirmed: true, digest: 'wrong' })).status, 400);
assert.equal((await api({ action: 'limit', user_id: me.id, limit: 400 })).status, 400);
assert.equal((await api({ action: 'worker' })).status, 401);

async function work(mode) {
  reset(); provider = mode;
  const id = '30000000-0000-4000-8000-000000000001';
  const account = tables.mail_accounts[0]; account.refresh_cipher = await context.testMail.seal('mock-refresh', me.id);
  tables.mail_campaigns.push({ id: 'campaign', sender_id: me.id, status: 'running' });
  const m = { id, client_id: c.id, campaign_id: 'campaign', sender_id: me.id, recipient: c.company_email, subject: draft.subject, body: draft.body, status: 'sending' };
  tables.mail_messages.push(m); claimed = [m];
  await context.testMail.worker();
  return m;
}
await work('ok'); assert.equal(finished.length, 1); assert.equal(gmailCalls.length, 1);
const mime = Buffer.from(JSON.parse(gmailCalls[0].body).raw, 'base64url').toString();
assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/); assert.match(mime, /To: buy@verified.example/);
const body = Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString();
assert.match(body, /unsubscribe:/);
assert.equal((await work('timeout')).status, 'unknown'); assert.equal(finished.length, 0); assert.equal(gmailCalls.length, 1);
assert.equal((await work('limit')).status, 'failed'); assert.equal(tables.mail_campaigns[0].status, 'paused');
reset(); tables.mail_campaigns.push({ id: 'foreign', sender_id: 'other', status: 'running' });
assert.equal((await api({ action: 'campaign', id: 'foreign', status: 'cancelled' })).status, 400);
assert.equal(tables.mail_campaigns[0].status, 'running');
reset();
const unsubscribe = await context.testMail.unsubscribeToken('offline-message');
tables.mail_messages.push({ id: 'offline-message', recipient: c.company_email, unsubscribe_hash: await context.testMail.hash(unsubscribe), status: 'queued' });
const unsubURL = 'https://test.supabase.co/functions/v1/crm-mail?route=unsubscribe&token=' + unsubscribe;
const getUnsub = await handler(new Request(unsubURL));
assert.equal(getUnsub.status, 303);
assert.match(getUnsub.headers.get('Location'), /\/unsubscribe\.html\?token=/);
assert.equal(tables.mail_suppressions.length, 0, 'Link scanners must not unsubscribe on GET');
assert.equal((await handler(new Request(unsubURL, { method: 'POST' }))).status, 200);
assert.equal(tables.mail_suppressions[0].email, c.company_email);
assert.equal(tables.mail_messages[0].status, 'skipped');
reset();
const planInput = { ids:[c.id], schedule:{start_at:new Date(Date.now()+86400000).toISOString(),interval_days:3,max_sends:3} };
const planned = await context.testMail.preview(planInput,me);
assert.equal(planned.ready[0].drafts.length,3);
assert.match(planned.ready[0].drafts[1].body,/Ali/);
assert.match(planned.ready[0].drafts[2].body,/Verified Ltd/);
assert.notEqual(planned.ready[0].drafts[1].body,planned.ready[0].drafts[2].body);
const planDigest=await context.testMail.hash(JSON.stringify({ready:planned.ready,schedule:planned.schedule}));
assert.equal((await api({...planInput,action:'enqueue',id:'20000000-0000-4000-8000-000000000002',confirmed:true,digest:planDigest})).status,200);
assert.equal((await api({...planInput,action:'enqueue',id:'20000000-0000-4000-8000-000000000003',confirmed:true,digest:'changed'})).status,400);
const originalID=me.id; me.id='10000000-0000-4000-8000-000000000099'; reset(); tables.profiles[0].role='admin';
assert.equal((await api({action:'limit',user_id:me.id,limit:0})).status,200);
const status=await(await api({action:'status'})).json(); assert.equal(status.daily_limit,0); assert.equal(status.limits[0].daily_limit,0);
assert.equal((await api({action:'limit',user_id:me.id,limit:1200})).status,200);
assert.equal((await api({action:'limit',user_id:me.id,limit:-1})).status,400);
me.id=originalID;
console.log('PASS: frontend syntax; fact-based personalization; USA product rules; 400 limit; JWT; owner isolation; invalid/suppressed/duplicate exclusion; preview integrity; admin quota; worker auth; MIME; provider success/timeout/limit handling; campaign isolation. No external emails sent.');
