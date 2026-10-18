import { createClient } from 'npm:@supabase/supabase-js@2';
import '../../../js/mail-merge.js';

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
async function googleToken(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ ...params, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') }), signal: AbortSignal.timeout(15000) });
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
async function preview(input: any, me: any) {
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
  const flags = check(await db.from('client_tracking').select('client_id,attention_level').in('client_id', ids));
  const suppressed = check(await db.from('mail_suppressions').select('email').in('email', clients.map((c: any) => cleanEmail(c.company_email))));
  const recent = check(await db.from('mail_messages').select('recipient,status,attempted_at,created_at').in('recipient', clients.map((c: any) => cleanEmail(c.company_email))).or(`status.in.(queued,sending),attempted_at.gte.${new Date(Date.now() - 86400000).toISOString()}`));
  const ready: any[] = [], skipped: any[] = [], seen = new Set();
  for (const id of ids) {
    const c = clients.find((c: any) => c.id === id);
    // Never return inaccessible company names to callers.
    if (!c || (me.role !== 'admin' && c.owner_id !== me.id)) { skipped.push({ id, company_name: '无权发送的客户', reason: '客户不存在或不属于你' }); continue; }
    const recipient = cleanEmail(c.company_email);
    let reason = '';
    if (c.status === '无效' || flags.some((f: any) => f.client_id === id && f.attention_level === '无效')) reason = '无效客户';
    else if (!emailRE.test(recipient)) reason = '邮箱为空或格式不正确';
    else if (suppressed.some((s: any) => s.email === recipient)) reason = '已退订或退信';
    else if (seen.has(recipient)) reason = '本批次邮箱重复';
    else if (recent.some((s: any) => s.recipient === recipient && (['queued', 'sending'].includes(s.status) || ['sent', 'unknown', 'bounced'].includes(s.status)))) reason = '已在队列或24小时内已发送';
    if (reason) { skipped.push({ id, company_name: c.company_name, reason }); continue; }
    seen.add(recipient);
    const custom = input.custom && typeof input.custom.subject === 'string' && typeof input.custom.body === 'string' ? input.custom : template;
    const draft = (globalThis as any).CRM_MAIL.draft(c, { ...me, sender_email: account.email }, cfg, custom);
    if (/[\r\n]/.test(draft.subject) || /\{\{\w+\}\}/.test(draft.subject + draft.body) || draft.subject.length > 250 || draft.body.length > 30000 || !draft.subject.trim() || !draft.body.trim()) throw new Error('标题/正文过长、为空或包含未替换字段');
    ready.push({ client_id: id, company_name: c.company_name, recipient, ...draft });
  }
  return { ready, skipped, sender: account.email };
}

async function worker() {
  const messages = check(await db.rpc('mail_claim')) || [];
  for (const m of messages) {
    let requested = false;
    try {
      const a = check(await db.from('mail_accounts').select('*').eq('user_id', m.sender_id).single());
      const token = await googleToken({ grant_type: 'refresh_token', refresh_token: await unseal(a.refresh_cipher, m.sender_id) });
      const campaign = check(await db.from('mail_campaigns').select('status').eq('id', m.campaign_id).single());
      const active = check(await db.from('profiles').select('active').eq('id', m.sender_id).single());
      const suppression = check(await db.from('mail_suppressions').select('email').eq('email', m.recipient).maybeSingle());
      const currentAccount = check(await db.from('mail_accounts').select('connected,email').eq('user_id', m.sender_id).single());
      const customer = check(await db.from('clients').select('owner_id,status,company_email').eq('id', m.client_id).maybeSingle());
      const flag = check(await db.from('client_tracking').select('attention_level').eq('client_id', m.client_id).maybeSingle());
      const sender = check(await db.from('profiles').select('role').eq('id', m.sender_id).single());
      const eligible = customer && customer.status !== '无效' && flag?.attention_level !== '无效' && cleanEmail(customer.company_email) === m.recipient && (sender.role === 'admin' || customer.owner_id === m.sender_id);
      if (!active.active || !currentAccount.connected || currentAccount.email !== a.email || !eligible || campaign.status !== 'running' || suppression) {
        check(await db.from('mail_messages').update({ status: campaign.status === 'paused' ? 'queued' : 'skipped', error: '发送前任务/账号状态已变化' }).eq('id', m.id)); continue;
      }
      const unsub = `${endpoint()}?route=unsubscribe&token=${await unsubscribeToken(m.id)}`;
      const body = `${m.body}\n\nIf you prefer not to receive further business enquiries from us, unsubscribe: ${unsub}`;
      const base64Body = b64(encoder.encode(body)).match(/.{1,76}/g)!.join('\r\n');
      const mime = [`From: ${a.email}`, `To: ${m.recipient}`, `Subject: ${encodedHeader(m.subject)}`,
        `Message-ID: <${m.id}@${new URL(env('CRM_SITE_URL')).hostname}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64', `List-Unsubscribe: <${unsub}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click', '', base64Body].join('\r\n');
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
          check(await db.from('mail_accounts').update({ next_send_at: new Date(Date.now() + 86400000).toISOString() }).eq('user_id', m.sender_id));
        }
      }
    } catch (e) {
      check(await db.from('mail_messages').update({ status: requested ? 'unknown' : 'failed', error: requested ? '发送状态待核实，请检查Gmail发件箱；不自动重试' : String((e as Error).message).slice(0, 200) }).eq('id', m.id));
      if (!requested) check(await db.from('mail_campaigns').update({ status: 'paused' }).eq('sender_id', m.sender_id).eq('status', 'running'));
    }
  }
  return { processed: messages.length };
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
      const previous = check(await db.from('mail_accounts').select('email').eq('user_id', row.user_id).maybeSingle());
      if (previous && previous.email !== cleanEmail(identity.email)) {
        const pending = check(await db.from('mail_messages').select('id').eq('sender_id', row.user_id).in('status', ['queued','sending']).limit(1));
        if (pending.length) throw new Error('请先取消原邮箱的待发送任务，再切换发件邮箱');
      }
      const patch = { email: cleanEmail(identity.email), refresh_cipher: await seal(token.refresh_token, row.user_id), connected: true, updated_at: new Date().toISOString() };
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
      check(await db.from('mail_oauth_states').delete().eq('user_id', me.id));
      check(await db.from('mail_oauth_states').insert({ state_hash: await hash(state), user_id: me.id, verifier }));
      const params = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: `${endpoint()}?route=callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/gmail.send', state, login_hint: me.work_email, code_challenge: await hash(verifier), code_challenge_method: 'S256' });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }
    if (input.action === 'status') {
      const a = check(await db.from('mail_accounts').select('email,connected,daily_limit,next_send_at').eq('user_id', me.id).maybeSingle());
      return json({ account: a, configured: true });
    }
    if (input.action === 'disconnect') {
      const a = check(await db.from('mail_accounts').select('*').eq('user_id', me.id).maybeSingle());
      if (a) {
        check(await db.from('mail_accounts').update({ connected: false }).eq('user_id', me.id));
        check(await db.from('mail_campaigns').update({ status: 'paused' }).eq('sender_id', me.id).eq('status', 'running'));
        // Revoke with Google after disabling local sends. No token in URL or logs.
        try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: await unseal(a.refresh_cipher, me.id) }), signal: AbortSignal.timeout(10000) }); } catch { /* Disabled locally; Google account can revoke too. */ }
        check(await db.from('mail_accounts').update({ refresh_cipher: '' }).eq('user_id', me.id));
      }
      return json({ ok: true });
    }
    if (input.action === 'preview') return json(await preview(input, me));
    if (input.action === 'enqueue') {
      if (!uuid.test(input.id || '') || input.confirmed !== true) throw new Error('请先预览并确认发送');
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
      if (me.role !== 'admin' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 400) throw new Error('仅老板可设置每日1至400封');
      check(await db.from('mail_accounts').update({ daily_limit: input.limit }).eq('user_id', input.user_id));
      return json({ ok: true });
    }
    if (input.action === 'suppress') {
      const m = check(await db.from('mail_messages').select('*').eq('id', input.message_id).single());
      if (m.sender_id !== me.id && me.role !== 'admin') throw new Error('无权操作');
      const reason = input.reason === 'bounced' ? '业务员确认退信' : '客户要求不再联系';
      check(await db.from('mail_suppressions').upsert({ email: m.recipient, reason }));
      if (input.reason === 'bounced') check(await db.from('mail_messages').update({ status: 'bounced', error: reason }).eq('id', m.id));
      check(await db.from('mail_messages').update({ status: 'skipped', error: reason }).eq('recipient', m.recipient).eq('status', 'queued'));
      return json({ ok: true });
    }
    throw new Error('不支持的操作');
  } catch (e) {
    // No tokens, provider responses, recipient details or request bodies in logs.
    return json({ error: (e as Error).message || '邮件服务暂不可用' }, 400);
  }
});
