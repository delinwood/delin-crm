import { createClient } from 'npm:@supabase/supabase-js@2';
import '../../../js/mail-merge.js';
import { inboundWorker } from './inbound.ts';
import { researchWorker, researchCapabilities } from './research.ts';
import { discoveryWorker, discoveryCapabilities } from './discovery.ts';

const env = (key: string) => Deno.env.get(key) || '';
const origin = () => new URL(env('CRM_SITE_URL') || 'https://delinwood.github.io/delin-crm').origin;
const endpoint = () => `${env('SUPABASE_URL')}/functions/v1/crm-mail`;
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const cfg = { COMPANY_NAME_EN: 'DELIN WOOD INDUSTRY (SHANDONG) CO., LTD.', COMPANY_WEBSITE: 'https://www.ddllwood.com', MOQ: 'half a 20-foot container' };
const encoder = new TextEncoder();
const b64 = (v: Uint8Array) => btoa(Array.from(v, x => String.fromCharCode(x)).join(''));
const url64 = (v: Uint8Array) => b64(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => url64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (s: string) => url64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailRE = /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
const cleanEmail = (s: string) => String(s || '').trim().toLowerCase();
// A separate release gate keeps new read scopes off until privacy/configuration review.
const readAvailable = () => env('MAIL_READ_ENABLED') === 'true';
async function syncInbox(sender?: string) {
  if (!readAvailable()) return { processed: 0, related: 0, disabled: true };
  return inboundWorker(db, { host: new URL(env('CRM_SITE_URL')).hostname, sender,
    token: async (a, timeoutMs) => (await googleToken({ grant_type: 'refresh_token', refresh_token: await unseal(a.refresh_cipher, a.user_id) }, timeoutMs)).access_token });
}
// RFC 2047 words are limited to 75 characters; split only at Unicode boundaries.
function encodedHeader(s: string) {
  const parts: string[] = []; let part = '';
  for (const ch of s) {
    if (encoder.encode(part + ch).length > 42) { parts.push(part); part = ''; }
    part += ch;
  }
  if (part) parts.push(part);
  return parts.map(p => `=?UTF-8?B?${b64(encoder.encode(p))}?=`).join('\r\n ');
}
const headers = () => ({ 'Access-Control-Allow-Origin': origin(), 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers(), 'Content-Type': 'application/json' } });
function check<T>(r: { data: T; error: any }): T { if (r.error) throw new Error(r.error.message); return r.data; }
function requireConfig() {
  for (const k of ['CRM_SITE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MAIL_TOKEN_KEY', 'MAIL_UNSUBSCRIBE_KEY', 'MAIL_WORKER_SECRET']) {
    if (!env(k)) throw new Error('邮件服务尚未完成配置，请联系老板');
  }
}
async function tokenKey() {
  const bytes = Uint8Array.from(atob(env('MAIL_TOKEN_KEY')), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('MAIL_TOKEN_KEY must be 32 bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(s: string, user: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(user) }, await tokenKey(), encoder.encode(s)));
  return `${b64(iv)}.${b64(data)}`;
}
async function unseal(s: string, user: string) {
  const [iv, data] = s.split('.').map(x => Uint8Array.from(atob(x), c => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(user) }, await tokenKey(), data));
}
async function unsubscribeToken(id: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env('MAIL_UNSUBSCRIBE_KEY')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return url64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(id))));
}
async function googleToken(params: Record<string, string>, timeoutMs = 15000) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ ...params, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') }), signal: AbortSignal.timeout(timeoutMs) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error === 'invalid_grant' ? 'Gmail授权已失效，请重新连接' : '无法刷新Gmail授权，请稍后重新连接');
  return data;
}
async function user(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!jwt) throw new Error('请先登录CRM');
  const r = await db.auth.getUser(jwt);
  if (r.error || !r.data.user) throw new Error('登录已过期');
  const me = check(await db.from('profiles').select('*').eq('id', r.data.user.id).single());
  if (!me?.active) throw new Error('账号已停用');
  return me;
}
async function ownCampaign(id: string, me: any) {
  const c = check(await db.from('mail_campaigns').select('*').eq('id', id).single());
  if (c.sender_id !== me.id && me.role !== 'admin') throw new Error('无权操作');
  return c;
}
const customerSnapshot = (c: any) => Object.fromEntries(['company_name','contact_name','country','city','customer_type','products','company_email'].map(k => [k, c[k] ?? (k === 'products' ? [] : '')]));
const sameSnapshot = (c: any, snapshot: any) => Object.entries(customerSnapshot(c)).every(([key,value]) => JSON.stringify(value) === JSON.stringify(snapshot?.[key]));
function scheduleInput(input: any) {
  if (!input.schedule) return null;
  const start = Date.parse(input.schedule.start_at);
  const interval = input.schedule.interval_days == null ? null : input.schedule.interval_days;
  const max = interval == null ? 1 : input.schedule.max_sends;
  if (!Number.isFinite(start) || start < Date.now() - 60000 || start > Date.now() + 366 * 86400000 ||
      (interval != null && ![3,7].includes(interval)) || !Number.isInteger(max) || max < 0 || max > 100) throw new Error('请设置有效的首次时间、3/7天间隔及发送轮数');
  return { start_at: new Date(start).toISOString(), interval_days: interval, max_sends: max };
}
async function preview(input: any, me: any) {
  const schedule = scheduleInput(input);
  if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 400 || input.ids.some((id: string) => !uuid.test(id))) throw new Error('每次请选择1至400家客户');
  const ids = [...new Set(input.ids)];
  const account = check(await db.from('mail_accounts').select('email,connected').eq('user_id', me.id).maybeSingle());
  if (!account?.connected) throw new Error('请先连接自己的Gmail');
  let template: any = null;
  if (input.template_id) {
    template = check(await db.from('templates').select('*').eq('id', input.template_id).single());
    if (template.channel !== 'email' || (template.owner_id && template.owner_id !== me.id)) throw new Error('无权使用模板');
  }
  const clients = check(await db.from('clients').select('*').in('id', ids));
  const archived = check(await db.from('crm_client_state').select('client_id').in('client_id', ids).not('archived_at', 'is', null));
  const flags = check(await db.from('client_tracking').select('client_id,attention_level').in('client_id', ids));
  const suppressed = check(await db.from('mail_suppressions').select('email').in('email', clients.map((c: any) => cleanEmail(c.company_email))));
  const holds = check(await db.from('crm_mail_review_holds').select('email,expires_at').eq('active', true).in('email', clients.map((c: any) => cleanEmail(c.company_email))));
  const recent = check(await db.from('mail_messages').select('recipient,status,attempted_at,created_at').in('recipient', clients.map((c: any) => cleanEmail(c.company_email))).or(`status.in.(queued,sending),attempted_at.gte.${new Date(Date.now() - 86400000).toISOString()}`));
  const companyRecent = check(await db.from('mail_messages').select('client_id,status').in('client_id', ids).or(`status.in.(queued,sending),attempted_at.gte.${new Date(Date.now() - 86400000).toISOString()}`));
  const plans = schedule ? check(await db.from('mail_plans').select('recipient').in('recipient', clients.map((c: any) => cleanEmail(c.company_email))).in('status', ['running','paused'])) : [];
  const ready: any[] = [], skipped: any[] = [], seen = new Set();
  for (const id of ids) {
    const c = clients.find((c: any) => c.id === id);
    // Never return inaccessible company names to callers.
    if (!c || (me.role !== 'admin' && c.owner_id !== me.id)) { skipped.push({ id, company_name: '无权发送的客户', reason: '客户不存在或不属于你' }); continue; }
    const recipient = cleanEmail(c.company_email);
    let reason = '';
    if (archived.some((s: any) => s.client_id === id)) reason = '客户已归档或合并';
    else if (c.status === '无效' || flags.some((f: any) => f.client_id === id && f.attention_level === '无效')) reason = '无效客户';
    else if (!emailRE.test(recipient)) reason = '邮箱为空或格式不正确';
    else if (suppressed.some((s: any) => s.email === recipient)) reason = '已退订或退信';
    else if (holds.some((s: any) => s.email === recipient && (!s.expires_at || Date.parse(s.expires_at) > Date.now()))) reason = '退信待核实，暂缓联系';
    else if (seen.has(recipient)) reason = '本批次邮箱重复';
    else if (plans.some((p: any) => p.recipient === recipient)) reason = '已有定时/循环计划，请先停止原计划';
    else if (schedule && ['已回复','成交'].includes(c.status)) reason = '客户已回复或成交，不能自动循环联系';
    else if (!schedule && recent.some((s: any) => s.recipient === recipient && (['queued', 'sending'].includes(s.status) || ['sent', 'unknown', 'bounced'].includes(s.status)))) reason = '已在队列或24小时内已发送';
    else if (!schedule && companyRecent.some((s: any) => s.client_id === id && ['queued','sending','sent','unknown','bounced'].includes(s.status))) reason = '该公司已有邮件在队列或24小时内已发送（含其他联系人）';
    if (reason) { skipped.push({ id, company_name: c.company_name, reason }); continue; }
    seen.add(recipient);
    const custom = input.custom && typeof input.custom.subject === 'string' && typeof input.custom.body === 'string' ? input.custom : template;
    const draft = (globalThis as any).CRM_MAIL.draft(c, { ...me, sender_email: account.email }, cfg, custom);
    if (/[\r\n]/.test(draft.subject) || /\{\{\w+\}\}/.test(draft.subject + draft.body) || draft.subject.length > 250 || draft.body.length > 30000 || !draft.subject.trim() || !draft.body.trim()) throw new Error('标题/正文过长、为空或包含未替换字段');
    if (schedule) {
      const drafts = [draft];
      if (schedule.interval_days && schedule.max_sends !== 1) {
        drafts.push((globalThis as any).CRM_MAIL.followup(c, { ...me, sender_email: account.email }, cfg, 1));
        if (schedule.max_sends !== 2) drafts.push((globalThis as any).CRM_MAIL.followup(c, { ...me, sender_email: account.email }, cfg, 2));
      }
      ready.push({ client_id: id, company_name: c.company_name, recipient, snapshot: customerSnapshot(c), drafts });
    } else ready.push({ client_id: id, company_name: c.company_name, recipient, ...draft });
  }
  const delivery = (globalThis as any).CRM_MAIL.deliveryBatch(ready, schedule);
  if (delivery.blocked) throw new Error('邮件检查发现未替换字段、非法字符或空白内容，请修改模板后重新预览');
  return { ready, skipped, sender: account.email, delivery, ...(schedule ? { schedule } : {}) };
}

async function worker() {
  // Inbound changes stop queued follow-ups before this minute's send eligibility check.
  let inbox: any;
  try { inbox = await syncInbox(); } catch { inbox = { error: '来信同步暂不可用，请在邮件中心核对；不影响发信队列处理' }; }
  const plans = check(await db.rpc('mail_plans_claim')) || [];
  for (const p of plans) {
    const id = crypto.randomUUID();
    try {
      check(await db.rpc('mail_plan_enqueue', { p_plan: p.id, p_message: { id, unsubscribe_hash: await hash(await unsubscribeToken(id)) } }));
    } catch {
      check(await db.from('mail_plans').update({ status: 'paused', last_error: '计划入队失败，已暂停；请检查客户信息和邮箱后重新创建' }).eq('id', p.id));
    }
  }
  const messages = check(await db.rpc('mail_claim')) || [];
  for (const m of messages) {
    let requested = false;
    try {
      const a = check(await db.from('mail_accounts').select('*').eq('user_id', m.sender_id).single());
      const token = await googleToken({ grant_type: 'refresh_token', refresh_token: await unseal(a.refresh_cipher, m.sender_id) });
      const campaign = check(await db.from('mail_campaigns').select('status').eq('id', m.campaign_id).single());
      const active = check(await db.from('profiles').select('active').eq('id', m.sender_id).single());
      const suppression = check(await db.from('mail_suppressions').select('email').eq('email', m.recipient).maybeSingle());
      const hold = check(await db.from('crm_mail_review_holds').select('active,expires_at').eq('email', m.recipient).maybeSingle());
      const archived = check(await db.rpc('crm_is_archived', { p_client: m.client_id }));
      const currentAccount = check(await db.from('mail_accounts').select('connected,email').eq('user_id', m.sender_id).single());
      const customer = check(await db.from('clients').select('*').eq('id', m.client_id).maybeSingle());
      const plan = check(await db.from('mail_plans').select('status,snapshot').eq('last_message_id', m.id).maybeSingle());
      const flag = check(await db.from('client_tracking').select('attention_level').eq('client_id', m.client_id).maybeSingle());
      const sender = check(await db.from('profiles').select('role').eq('id', m.sender_id).single());
      const held = hold?.active && (!hold.expires_at || Date.parse(hold.expires_at) > Date.now());
      const eligible = !archived && !held && customer && customer.status !== '无效' && flag?.attention_level !== '无效' && cleanEmail(customer.company_email) === m.recipient && (sender.role === 'admin' || customer.owner_id === m.sender_id);
      const planChanged = plan && (plan.status !== 'running' || ['已回复','成交'].includes(customer?.status) || !sameSnapshot(customer || {}, plan.snapshot));
      if (!active.active || !currentAccount.connected || currentAccount.email !== a.email || !eligible || campaign.status !== 'running' || suppression || planChanged) {
        check(await db.from('mail_messages').update({ status: campaign.status === 'paused' || plan?.status === 'paused' ? 'queued' : 'skipped', attempted_at: null, error: '发送前任务/账号/客户资料状态已变化' }).eq('id', m.id)); continue;
      }
      if ((globalThis as any).CRM_MAIL.deliveryReview(m).blocked) throw new Error('邮件内容检查未通过，请修改模板并重新预览；本次未提交Gmail');
      const unsub = `${endpoint()}?route=unsubscribe&token=${await unsubscribeToken(m.id)}`;
      const body = `${m.body}\n\nIf you prefer not to receive further business enquiries from us, unsubscribe: ${unsub}`;
      const base64Body = b64(encoder.encode(body)).match(/.{1,76}/g)!.join('\r\n');
      const mime = [`From: ${a.email}`, `To: ${m.recipient}`, `Subject: ${encodedHeader(m.subject)}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${m.id}@${new URL(env('CRM_SITE_URL')).hostname}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64', `List-Unsubscribe: <${unsub}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click', '', base64Body].join('\r\n');
      const reserved = check(await db.rpc('crm_reserve_company_mail', { p_client: m.client_id, p_message: m.id }));
      if (!reserved) { check(await db.from('mail_messages').update({ status: 'skipped', attempted_at: null, error: '该公司24小时内已有发送尝试，已避免重复联系' }).eq('id', m.id)); continue; }
      // Reservation can block another worker; recheck stop/review state immediately before POST.
      const latest = check(await db.from('mail_messages').select('status').eq('id', m.id).single());
      if (latest.status !== 'sending') continue;
      const finalPlan = check(await db.from('mail_plans').select('status,snapshot').eq('last_message_id', m.id).maybeSingle());
      const finalCustomer = check(await db.from('clients').select('*').eq('id', m.client_id).maybeSingle());
      const finalHold = check(await db.from('crm_mail_review_holds').select('active,expires_at').eq('email', m.recipient).maybeSingle());
      const finalSuppression = check(await db.from('mail_suppressions').select('email').eq('email', m.recipient).maybeSingle());
      const finalArchived = check(await db.rpc('crm_is_archived', { p_client: m.client_id }));
      if (finalArchived || !finalCustomer || finalCustomer.status === '无效' || cleanEmail(finalCustomer.company_email) !== m.recipient || (sender.role !== 'admin' && finalCustomer.owner_id !== m.sender_id) ||
          finalSuppression || (finalHold?.active && (!finalHold.expires_at || Date.parse(finalHold.expires_at) > Date.now())) ||
          (finalPlan && (finalPlan.status !== 'running' || ['已回复','成交'].includes(finalCustomer.status) || !sameSnapshot(finalCustomer, finalPlan.snapshot)))) {
        check(await db.from('mail_messages').update({ status: 'skipped', attempted_at: null, error: '提交Gmail前已暂停、收到回复或客户资料改变' }).eq('id',m.id).eq('status','sending')); continue;
      }
      requested = true;
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: url64(encoder.encode(mime)) }), signal: AbortSignal.timeout(20000) });
      const result = await r.json();
      if (r.ok && result.id) {
        check(await db.rpc('mail_finish', { p_id: m.id, p_provider: result.id }));
      } else {
        // Do not retry ambiguous server errors: Gmail has no send idempotency key.
        const unknown = r.status >= 500;
        const rate = r.status === 429 || r.status === 403;
        check(await db.from('mail_messages').update({ status: unknown ? 'unknown' : 'failed', error: `Gmail拒绝或异常（${r.status}），请检查邮箱后处理` }).eq('id', m.id));
        if (rate) {
          check(await db.from('mail_campaigns').update({ status: 'paused' }).eq('sender_id', m.sender_id).eq('status', 'running'));
          check(await db.from('mail_plans').update({ status: 'paused', last_error: 'Gmail限发，计划已暂停' }).eq('sender_id', m.sender_id).eq('status', 'running'));
          check(await db.from('mail_accounts').update({ quota_wait: false, next_send_at: new Date(Date.now() + 86400000).toISOString() }).eq('user_id', m.sender_id));
        }
      }
    } catch (e) {
      check(await db.from('mail_messages').update({ status: requested ? 'unknown' : 'failed', error: requested ? '发送状态待核实，请检查Gmail发件箱；不自动重试' : String((e as Error).message).slice(0, 200) }).eq('id', m.id));
      if (!requested) {
        check(await db.from('mail_campaigns').update({ status: 'paused' }).eq('sender_id', m.sender_id).eq('status', 'running'));
        check(await db.from('mail_plans').update({ status: 'paused', last_error: '邮箱授权或准备发送失败，计划已暂停' }).eq('sender_id', m.sender_id).eq('status', 'running'));
      }
    }
  }
  let research: any;
  try { research = await researchWorker(db); } catch { research = { error: '资料任务暂不可用，队列保留' }; }
  let discovery: any;
  try { discovery = await discoveryWorker(db); } catch { discovery = { error: '获客任务暂不可用，队列保留' }; }
  return { processed: messages.length, inbox, research, discovery };
}

Deno.serve(async req => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { headers: headers() });
    requireConfig();
    const url = new URL(req.url), route = url.searchParams.get('route');
    if (route === 'callback') {
      const state = url.searchParams.get('state') || '';
      const row = check(await db.from('mail_oauth_states').delete().eq('state_hash', await hash(state)).gt('expires_at', new Date().toISOString()).select().maybeSingle());
      if (!row || url.searchParams.has('error')) throw new Error('授权取消或已过期，请返回CRM重新连接');
      const token = await googleToken({ code: url.searchParams.get('code') || '', grant_type: 'authorization_code', redirect_uri: `${endpoint()}?route=callback`, code_verifier: row.verifier });
      if (!token.refresh_token || !String(token.scope).split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new Error('未取得持续发信权限，请重新连接并同意发信授权');
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('无法核实发件邮箱');
      const identity = await r.json();
      if (!identity.verified_email || !emailRE.test(identity.email)) throw new Error('邮箱未验证');
      const me = check(await db.from('profiles').select('active,work_email').eq('id', row.user_id).single());
      if (!me.active || cleanEmail(me.work_email) !== cleanEmail(identity.email)) throw new Error('授权邮箱与CRM个人资料中的工作邮箱不一致，请修改资料后重新连接');
      // Reconnection preserves the owner's configured quota and pacing.
      const previous = check(await db.from('mail_accounts').select('*').eq('user_id', row.user_id).maybeSingle());
      const saved = check(await db.from('mail_sender_settings').select('daily_limit').eq('user_id', row.user_id).maybeSingle());
      if (previous && previous.email !== cleanEmail(identity.email)) {
        const pending = check(await db.from('mail_messages').select('id').eq('sender_id', row.user_id).in('status', ['queued','sending']).limit(1));
        if (pending.length) throw new Error('请先取消原邮箱的待发送任务，再切换发件邮箱');
      }
      const patch: any = { email: cleanEmail(identity.email), refresh_cipher: await seal(token.refresh_token, row.user_id), connected: true, daily_limit: saved?.daily_limit ?? previous?.daily_limit ?? 50, updated_at: new Date().toISOString() };
      if (row.request_read) {
        if (!readAvailable() || !String(token.scope).split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) throw new Error('未取得读取授权，发信连接保持原状；请返回CRM重试');
        const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
        if (!profile.ok) throw new Error('无法建立读取同步起点，发信连接保持原状');
        const p = await profile.json(); if (!p.historyId) throw new Error('Gmail未返回同步起点');
        const preserve = previous?.read_enabled && previous.email === patch.email && previous.read_history_id;
        const since = new Date(Date.now() - (row.seed_days === 7 ? 7 : 0) * 86400000).toISOString();
        Object.assign(patch, { read_enabled: true, ...(preserve ? {} : { read_since: since, read_history_id: p.historyId, read_history_page: null, read_seed_since: row.seed_days === 7 ? since : null, read_seed_page: null, read_gap_at: null }), read_error: null });
      } else Object.assign(patch, { read_enabled: false, read_lease_until: null });
      if (previous) check(await db.from('mail_accounts').update(patch).eq('user_id', row.user_id));
      else check(await db.from('mail_accounts').insert({ user_id: row.user_id, ...patch }));
      return new Response(null, { status: 303, headers: { Location: `${env('CRM_SITE_URL').replace(/\/$/, '')}/#/mail`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    if (route === 'unsubscribe') {
      const token = url.searchParams.get('token') || '';
      const m = check(await db.from('mail_messages').select('recipient').eq('unsubscribe_hash', await hash(token)).maybeSingle());
      if (!m) return new Response('链接无效', { status: 404 });
      if (req.method === 'POST') {
        check(await db.from('mail_suppressions').upsert({ email: m.recipient, reason: '收件人退订' }));
        check(await db.from('mail_messages').update({ status: 'skipped', error: '收件人已退订' }).eq('recipient', m.recipient).eq('status', 'queued'));
        check(await db.from('mail_plans').update({ status: 'stopped', last_error: '收件人已退订' }).eq('recipient', m.recipient).in('status', ['running','paused']));
        return new Response('Unsubscribed. You will receive no further outreach emails from this CRM.', { headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' } });
      }
      // Supabase's shared domain rewrites HTML to text/plain. Serve confirmation on Pages.
      return new Response(null, { status: 303, headers: { Location: `${env('CRM_SITE_URL').replace(/\/$/, '')}/unsubscribe.html?token=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const input = await req.json();
    if (input.action === 'worker') {
      if (req.headers.get('Authorization') !== `Bearer ${env('MAIL_WORKER_SECRET')}`) return json({ error: 'Unauthorized' }, 401);
      return json(await worker());
    }
    const me = await user(req);
    if (input.action === 'connect') {
      if (!emailRE.test(me.work_email || '')) throw new Error('请先在个人资料填写要授权的工作邮箱');
      const state = random(), verifier = random();
      const previous = check(await db.from('mail_accounts').select('read_enabled').eq('user_id', me.id).maybeSingle());
      const requestRead = input.enable_read === true || (input.enable_read !== false && previous?.read_enabled === true);
      if (requestRead && !readAvailable()) throw new Error('邮件读取功能等待隐私说明和Google权限配置完成，当前仍可正常发信');
      if (input.enable_read === true && input.confirm_read !== true) throw new Error('请先阅读并确认邮件同步的数据说明');
      const seedDays = requestRead && input.seed_days === 7 ? 7 : 0;
      check(await db.from('mail_oauth_states').delete().eq('user_id', me.id));
      check(await db.from('mail_oauth_states').insert({ state_hash: await hash(state), user_id: me.id, verifier, request_read: requestRead, seed_days: seedDays }));
      const params = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: `${endpoint()}?route=callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/gmail.send' + (requestRead ? ' https://www.googleapis.com/auth/gmail.readonly' : ''), state, login_hint: me.work_email, code_challenge: await hash(verifier), code_challenge_method: 'S256' });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }
    if (input.action === 'status') {
      const a = check(await db.from('mail_accounts').select('email,connected,daily_limit,next_send_at,read_enabled,read_since,read_last_sync_at,read_error,read_gap_at').eq('user_id', me.id).maybeSingle());
      const saved = check(await db.from('mail_sender_settings').select('user_id,daily_limit').eq('user_id', me.id).maybeSingle());
      let limits: any[] = [];
      if (me.role === 'admin') {
        const preferences = check(await db.from('mail_sender_settings').select('user_id,daily_limit'));
        const accounts = check(await db.from('mail_accounts').select('user_id,daily_limit'));
        limits = [...accounts.filter((x: any) => !preferences.some((p: any) => p.user_id === x.user_id)), ...preferences];
      }
      const research = researchCapabilities();
      return json({ account: a, daily_limit: saved?.daily_limit ?? a?.daily_limit ?? 50, limits, configured: true, read_available: readAvailable(), research: { website: research.reader, search: research.search }, discovery: discoveryCapabilities() });
    }
    if (input.action === 'sync') {
      if (!readAvailable()) throw new Error('邮件同步尚未启用，当前没有读取邮箱');
      return json(await syncInbox(me.id));
    }
    if (input.action === 'read-disable') {
      check(await db.from('mail_accounts').update({ read_enabled: false, read_lease_until: null }).eq('user_id', me.id));
      check(await db.from('crm_inbound_queue').delete().eq('sender_id', me.id));
      return json({ ok: true });
    }
    if (input.action === 'sync-retry') {
      check(await db.from('crm_inbound_queue').update({ attempts: 0, error: null }).eq('sender_id', me.id).gte('attempts', 4));
      return json({ ok: true });
    }
    if (input.action === 'disconnect') {
      const a = check(await db.from('mail_accounts').select('*').eq('user_id', me.id).maybeSingle());
      if (a) {
        check(await db.from('mail_accounts').update({ connected: false, read_enabled: false, read_lease_until: null }).eq('user_id', me.id));
        check(await db.from('crm_inbound_queue').delete().eq('sender_id', me.id));
        check(await db.from('mail_campaigns').update({ status: 'paused' }).eq('sender_id', me.id).eq('status', 'running'));
        check(await db.from('mail_plans').update({ status: 'paused', last_error: '邮箱已断开，请连接后手动继续' }).eq('sender_id', me.id).eq('status', 'running'));
        // Revoke with Google after disabling local sends. No token in URL or logs.
        try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: await unseal(a.refresh_cipher, me.id) }), signal: AbortSignal.timeout(10000) }); } catch { /* Disabled locally; Google account can revoke too. */ }
        check(await db.from('mail_accounts').update({ refresh_cipher: '' }).eq('user_id', me.id));
      }
      return json({ ok: true });
    }
    if (input.action === 'preview') return json(await preview(input, me));
    if (input.action === 'enqueue') {
      if (!uuid.test(input.id || '') || input.confirmed !== true) throw new Error('请先预览并确认发送');
      if (input.schedule) {
        const existingPlan = check(await db.from('mail_plans').select('id').eq('batch_id', input.id).eq('sender_id', me.id).limit(1));
        if (existingPlan.length) return json({ id: input.id, scheduled: true });
        const p = await preview(input, me);
        if (await hash(JSON.stringify({ ready: p.ready, schedule: p.schedule })) !== input.digest) throw new Error('客户或计划信息已变化，请重新预览');
        if (!p.ready.length) throw new Error('没有可创建计划的客户');
        const count = check(await db.rpc('mail_plans_create', { p_sender: me.id, p_batch: input.id, p_name: String(input.name || '自动客户邮件'), p_start: p.schedule!.start_at, p_interval: p.schedule!.interval_days, p_max: p.schedule!.max_sends, p_targets: p.ready }));
        return json({ id: input.id, scheduled: true, count });
      }
      const existing = check(await db.from('mail_campaigns').select('id').eq('id', input.id).eq('sender_id', me.id).maybeSingle());
      if (existing) return json({ id: existing.id });
      const p = await preview(input, me);
      // Exact preview digest prevents unseen customer changes from entering a campaign.
      if (await hash(JSON.stringify(p.ready)) !== input.digest) throw new Error('客户信息已变化，请重新预览');
      if (!p.ready.length) throw new Error('没有可发送的客户');
      const messages = [];
      for (const m of p.ready) { const id = crypto.randomUUID(); messages.push({ ...m, id, unsubscribe_hash: await hash(await unsubscribeToken(id)) }); }
      // IDs are retained for deterministic unsubscribe signatures.
      const id = check(await db.rpc('mail_enqueue', { p_sender: me.id, p_id: input.id, p_name: String(input.name || '客户开发邮件'), p_messages: messages }));
      return json({ id, queued: messages.length });
    }
    if (input.action === 'campaign') {
      await ownCampaign(input.id, me);
      if (!['paused','running','cancelled'].includes(input.status)) throw new Error('无效状态');
      check(await db.from('mail_campaigns').update({ status: input.status }).eq('id', input.id));
      if (input.status === 'cancelled') check(await db.from('mail_messages').update({ status: 'cancelled' }).eq('campaign_id', input.id).eq('status', 'queued'));
      return json({ ok: true });
    }
    if (input.action === 'limit') {
      if (me.role !== 'admin' || !uuid.test(input.user_id || '') || !Number.isInteger(input.limit) || input.limit < 0 || input.limit > 2147483647) throw new Error('仅老板可设置非负整数限额；0表示不设系统每日上限');
      const value = check(await db.rpc('mail_set_limit', { p_actor: me.id, p_user: input.user_id, p_limit: input.limit }));
      return json({ ok: true, daily_limit: value });
    }
    if (input.action === 'plan') {
      if (!uuid.test(input.id || '') || !['running','paused','stopped'].includes(input.status)) throw new Error('无效计划操作');
      check(await db.rpc('mail_plan_state', { p_actor: me.id, p_id: input.id, p_state: input.status }));
      return json({ ok: true });
    }
    if (input.action === 'suppress') {
      const m = check(await db.from('mail_messages').select('*').eq('id', input.message_id).single());
      if (m.sender_id !== me.id && me.role !== 'admin') throw new Error('无权操作');
      const reason = input.reason === 'bounced' ? '业务员确认退信' : '客户要求不再联系';
      check(await db.from('mail_suppressions').upsert({ email: m.recipient, reason }));
      if (input.reason === 'bounced') check(await db.from('mail_messages').update({ status: 'bounced', error: reason }).eq('id', m.id));
      check(await db.from('mail_messages').update({ status: 'skipped', error: reason }).eq('recipient', m.recipient).eq('status', 'queued'));
      check(await db.from('mail_plans').update({ status: 'stopped', last_error: reason }).eq('recipient', m.recipient).in('status', ['running','paused']));
      return json({ ok: true });
    }
    throw new Error('不支持的操作');
  } catch (e) {
    // No tokens, provider responses, recipient details or request bodies in logs.
    return json({ error: (e as Error).message || '邮件服务暂不可用' }, 400);
  }
});
