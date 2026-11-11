importScripts('config.js', 'lib/save.js');

const cfg = self.DELIN_CONFIG;
const today = () => new Date().toLocaleDateString('sv-SE');

function storageGet() {
  return chrome.storage.local.get('session').then(bag => bag.session || null);
}
function storageSet(session) {
  return session ? chrome.storage.local.set({ session }) : chrome.storage.local.remove('session');
}
function pickSession(data) {
  const source = data && (data.access_token ? data : data.currentSession);
  if (!source?.access_token || !source?.refresh_token) throw new Error('没有可用的登录状态');
  return {
    access_token: source.access_token,
    refresh_token: source.refresh_token,
    expires_at: source.expires_at || Math.floor(Date.now() / 1000) + Number(source.expires_in || 3600)
  };
}
function userId(token) {
  const part = String(token || '').split('.')[1] || '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  const sub = JSON.parse(json).sub;
  if (!/^[0-9a-f-]{36}$/i.test(sub || '')) throw new Error('登录状态无效，请重新登录');
  return sub;
}
async function refresh(refreshToken) {
  const response = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await storageSet(null);
    throw new Error('登录已过期，请重新登录');
  }
  const session = pickSession(data);
  await storageSet(session);
  return session;
}
async function ensureSession() {
  const session = await storageGet();
  if (!session?.access_token || !session?.refresh_token) throw new Error('请先登录 Delin CRM');
  if (Number(session.expires_at || 0) * 1000 < Date.now() + 60000) return refresh(session.refresh_token);
  return session;
}
async function api(path, { method = 'GET', body, auth = true, prefer = false } = {}) {
  const headers = { apikey: cfg.anonKey, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = 'return=representation';
  if (auth) headers.Authorization = 'Bearer ' + (await ensureSession()).access_token;
  const response = await fetch(cfg.url + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = { message: text.slice(0, 300) }; } }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || data?.msg || data?.error || '请求失败');
    error.status = response.status;
    error.code = data?.code || '';
    throw error;
  }
  return data;
}
function publicUser(profile) {
  return { id: profile.id, full_name: profile.full_name, username: profile.username, role: profile.role };
}
async function profile() {
  const session = await ensureSession();
  const rows = await api('/rest/v1/profiles?id=eq.' + userId(session.access_token) + '&select=id,username,full_name,role,active');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.active || (row.role !== 'admin' && row.role !== 'sales')) {
    await storageSet(null);
    throw new Error('账号已停用，或不能写入客户');
  }
  return row;
}
async function login(username, password) {
  let email = String(username || '').trim();
  if (!email || !password) throw new Error('请填写用户名和密码');
  if (!email.includes('@')) {
    let found = null;
    try { found = await api('/rest/v1/rpc/login_email', { method: 'POST', body: { p_username: email.toLowerCase() }, auth: false }); }
    catch (e) { found = null; }
    email = typeof found === 'string' && found.includes('@') ? found : email.toLowerCase() + '@delinfloor.com';
  }
  const response = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.toLowerCase(), password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(/invalid|credentials/i.test(data.error_description || data.msg || '') ? '用户名或密码错误' : (data.error_description || data.msg || '登录失败'));
  await storageSet(pickSession(data));
  return publicUser(await profile());
}
async function syncFromCrm() {
  const tabs = await chrome.tabs.query({ url: cfg.crmMatch });
  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'read-crm-session' });
      if (!response?.session) continue;
      await storageSet(pickSession(response.session));
      return publicUser(await profile());
    } catch (e) { /* This CRM tab has no bridge yet. */ }
  }
  return null;
}
function missingFunction(error) {
  return error?.code === 'PGRST202' || error?.status === 404 || /crm_match_linkedin_person|42883|schema cache/i.test(error?.message || '');
}
async function visibleRows(person) {
  const filters = [];
  const slug = CRM_SAVE.linkedinKey(person.linkedin);
  if (slug) filters.push('contact_linkedin.ilike.*' + encodeURIComponent(slug) + '*');
  if (person.email) filters.push('company_email.eq.' + encodeURIComponent(person.email));
  const select = 'id,company_name,owner_id,website,company_email,company_phone,whatsapp,contact_name,contact_title,contact_linkedin,city,state,country';
  let clients = [];
  let contacts = [];
  try {
    if (filters.length) clients = await api('/rest/v1/clients_view?select=' + select + '&or=(' + filters.join(',') + ')&limit=20') || [];
    const contactFilters = [];
    if (slug) contactFilters.push('data->>linkedin.ilike.*' + encodeURIComponent(slug) + '*');
    if (person.email) contactFilters.push('data->>email.eq.' + encodeURIComponent(person.email));
    if (contactFilters.length) {
      contacts = await api('/rest/v1/crm_records_view?select=id,client_id,account_id,data&kind=eq.contact&or=(' + contactFilters.join(',') + ')&limit=20') || [];
      const known = new Set(clients.map(row => row.id));
      const missing = [...new Set(contacts.map(row => row.account_id || row.client_id).filter(id => id && !known.has(id)))];
      if (missing.length) clients = clients.concat(await api('/rest/v1/clients_view?select=' + select + '&id=in.(' + missing.join(',') + ')') || []);
    }
  } catch (e) { /* Company name, website and phone still come from check_duplicate. */ }
  return { clients, contacts };
}
async function matchPerson(raw) {
  const person = CRM_SAVE.visiblePerson(raw);
  const body = {
    p_company: person.companyName || '',
    p_website: person.website || '',
    p_phone: person.phone || person.whatsapp || '',
    p_email: person.email || '',
    p_linkedin: person.linkedin || ''
  };
  const me = await profile();
  try {
    const rows = await api('/rest/v1/rpc/crm_match_linkedin_person', { method: 'POST', body });
    return { person, me: publicUser(me), source: 'server', notice: '', matches: rows || [], plan: CRM_SAVE.plan(person, rows || [], me) };
  } catch (error) {
    if (!missingFunction(error)) throw error;
    const dup = await api('/rest/v1/rpc/check_duplicate', {
      method: 'POST',
      body: { p_name: CRM_SAVE.nameKey(person.companyName), p_domain: CRM_SAVE.domain(person.website), p_phone: CRM_SAVE.phoneKey(person.phone || person.whatsapp) }
    });
    const visible = await visibleRows(person);
    const matches = CRM_SAVE.matchLocal(person, visible.clients, visible.contacts, dup || [], me);
    return {
      person, me: publicUser(me), source: 'fallback', matches, plan: CRM_SAVE.plan(person, matches, me),
      notice: '数据库里的 LinkedIn / 邮箱查重函数还没启用。现在对照你能看到的客户，以及全库的公司名、网站和电话。老板审核迁移后，才会同时对照其他人客户里的邮箱和 LinkedIn。'
    };
  }
}
function recordLink(id) {
  return { client: cfg.crmHome + '#/client/' + id, business: cfg.crmHome + '#/business/' + id };
}
async function savePerson(message) {
  const found = await matchPerson(message.person || {});
  const me = await profile();
  const person = found.person;
  if (message.action === 'create') {
    if (!found.plan.canCreate) throw new Error(found.matches.length ? '已有相同客户，业务员不能重复新建' : '请填写公司名称');
    const created = await api('/rest/v1/clients', {
      method: 'POST', prefer: true,
      body: CRM_SAVE.clientRow(person, { pool: !!message.pool, role: me.role, userId: me.id, today: today() })
    });
    const row = Array.isArray(created) ? created[0] : created;
    if (!row?.id) throw new Error('客户已提交，但没有返回编号，请在 CRM 里搜索公司名');
    return { id: row.id, created: true, ...recordLink(row.id) };
  }
  if (message.action !== 'attach' && message.action !== 'claim') throw new Error('请选择新建，或保存到已有客户');
  const match = found.matches.find(row => row.client_id === message.clientId);
  if (!match?.client_id) throw new Error('这条客户已变化或不在你的权限内，请重新查重');
  if (message.action === 'claim') {
    if (!match.pool) throw new Error('只能领取公海里的客户');
    await api('/rest/v1/rpc/claim_client', { method: 'POST', body: { p_client_id: match.client_id } });
  } else if (!match.writable && me.role !== 'admin') throw new Error('只能写入自己负责的客户。公海客户请先领取。');
  const full = await api('/rest/v1/clients_view?id=eq.' + match.client_id + '&select=id,company_name,contact_name,contact_title,contact_linkedin,company_email,company_phone,whatsapp,website,city,state,country');
  const current = Array.isArray(full) ? full[0] : null;
  if (!current) throw new Error('客户已变化，请重新查重');
  let contacts = [];
  try { contacts = await api('/rest/v1/crm_records_view?select=id,data&kind=eq.contact&account_id=eq.' + match.client_id + '&limit=50'); }
  catch (e) { contacts = []; }
  if (CRM_SAVE.sameContact(person, current, contacts || [])) return { id: match.client_id, created: false, duplicateContact: true, ...recordLink(match.client_id) };
  const contact = CRM_SAVE.contactData(person, today());
  if (contact) {
    await api('/rest/v1/rpc/crm_save_record', {
      method: 'POST',
      body: { p_kind: 'contact', p_client: match.client_id, p_data: contact, p_id: null, p_version: null }
    });
  }
  const patch = CRM_SAVE.blankPatch(current, person);
  if (Object.keys(patch).length) await api('/rest/v1/clients?id=eq.' + match.client_id, { method: 'PATCH', body: patch, prefer: true });
  return { id: match.client_id, created: false, ...recordLink(match.client_id) };
}

const handlers = {
  status: async () => {
    try { return { user: publicUser(await profile()) }; }
    catch (e) { return { user: null, error: e.message }; }
  },
  login: message => login(message.username, message.password),
  logout: async () => { await storageSet(null); return { user: null }; },
  sync: async () => ({ user: await syncFromCrm() }),
  match: message => matchPerson(message.person),
  save: message => savePerson(message)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !handlers[message?.type]) return;
  handlers[message.type](message)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: error.message || '操作失败' }));
  return true;
});
