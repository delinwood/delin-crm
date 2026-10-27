/* Data layer — identical interface for DEMO (localStorage) and SUPABASE (Postgres + RLS).
   Server-side rules live in supabase/schema.sql; the demo mirrors them so the preview behaves the same:
   - admin: everything; sales: only clients owned/created by self, no delete, no owner change, no 无效,
     cannot blank protected initial fields, follow-ups/quotes/samples append-only (samples status may be updated).
   - duplicate check runs across the WHOLE database but reveals only "exists, owned by X". */
(function () {
  const cfg = window.CRM_CONFIG, nowISO = () => new Date().toISOString(), uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const U = window.U = {
    domain(u) { u = String(u || '').trim().toLowerCase(); if (!u) return ''; if (!/^[a-z]+:\/\//.test(u)) u = 'http://' + u; try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } },
    phoneKey(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; },
    nameKey(n) { return String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|ltd|llc|corp|corporation|co|company|limited|group|the|gmbh|sa|sas|srl|bv|nv|sp z o o|ltee|ltée|plc|pty)\b/g, ' ').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ''); },
    diff(before, after, keys) { const d = {}; keys.forEach(k => { const a = JSON.stringify(before[k] ?? ''), b = JSON.stringify(after[k] ?? ''); if (k in after && a !== b) d[k] = [before[k] ?? '', after[k] ?? '']; }); return d; }
  };
  const TRACK = ['company_name','customer_type','country','state','city','address','company_phone','whatsapp','company_email','website','contact_name','contact_title','contact_linkedin','products','apollo_criteria','priority','owner_id','status','next_follow_up','tags','notes','source_note'];

  // ======================= DEMO =======================
  const KEY = 'fcrm_demo_v2';
  // seed dates like "@-3" (days from today) or "@-3T10:00" are resolved at first load, so demo reminders stay current
  const relDates = db => { const f = v => { const m = typeof v === 'string' && v.match(/^@(-?\d+)(T.*)?$/); if (!m) return v; const d = new Date(); d.setDate(d.getDate() + +m[1]);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return m[2] ? new Date(ds + m[2]).toISOString() : ds; };
    Object.values(db).forEach(arr => Array.isArray(arr) && arr.forEach(o => Object.keys(o).forEach(k => { o[k] = f(o[k]); }))); return db; };
  const Demo = {
    db: null, mode: 'demo',
    load() {
      if (this.db) return this.db;
      const raw = localStorage.getItem(KEY);
      this.db = raw ? JSON.parse(raw) : relDates(JSON.parse(JSON.stringify(window.DEMO_SEED)));
      ['audit', 'saved_filters', 'quotes', 'samples', 'logs', 'learning_materials', 'learning_progress'].forEach(k => this.db[k] = this.db[k] || []);
      if (!this.db.templates) this.db.templates = (window.DEFAULT_TEMPLATES || []).map(t => ({ ...t }));
      this.save(); return this.db;
    },
    save() { localStorage.setItem(KEY, JSON.stringify(this.db)); },
    reset() { localStorage.removeItem(KEY); this.db = null; this.load(); },
    me() { const id = sessionStorage.getItem('fcrm_uid'); return id ? this.load().users.find(u => u.id === id && u.active) : null; },
    admin() { const m = this.me(); return m && m.role === 'admin'; },
    canSee(c, me) { me = me || this.me(); return me.role === 'admin' || c.owner_id === me.id || c.created_by === me.id; },
    pub(u) { const { password, ...p } = u; return p; },
    audit(client_id, action, detail) { this.load().audit.push({ id: uid('a'), client_id, actor_id: this.me().id, action, detail: detail || {}, at: nowISO() }); },
    async login(username, password) {
      const u = this.load().users.find(x => x.username === username.trim().toLowerCase());
      if (!u || u.password !== password) throw new Error('用户名或密码错误 Invalid username or password');
      if (!u.active) throw new Error('账号已停用 Account disabled');
      sessionStorage.setItem('fcrm_uid', u.id); return this.pub(u);
    },
    async currentUser() { const m = this.me(); return m ? this.pub(m) : null; },
    async logout() { sessionStorage.removeItem('fcrm_uid'); },
    async updateMyProfile(p) { const u = this.me(); ['full_name', 'name_en', 'title_en', 'work_email', 'whatsapp', 'signature'].forEach(k => { if (k in p) u[k] = p[k]; }); this.save(); return this.pub(u); },
    async listUsers() { return this.load().users.map(u => this.pub(u)); },
    async createUser({ username, full_name, password, role }) {
      if (!this.admin()) throw new Error('仅管理员'); const db = this.load(); username = username.trim().toLowerCase();
      if (db.users.some(u => u.username === username)) throw new Error('用户名已存在');
      db.users.push({ id: uid('u'), username, full_name, password, role, active: true }); this.save();
    },
    async updateUser(id, patch) { if (!this.admin()) throw new Error('仅管理员'); const u = this.load().users.find(x => x.id === id); Object.assign(u, patch); this.save(); },
    enrich(c) {
      const db = this.load(); const ls = db.logs.filter(x => x.client_id === c.id);
      return { ...c, last_follow_up: ls.reduce((m, l) => l.entry_date > m ? l.entry_date : m, '') || null, log_count: ls.length };
    },
    async listClients() { const me = this.me(); return this.load().clients.filter(c => this.canSee(c, me)).map(c => this.enrich(c)); },
    async getClient(id) { const c = this.load().clients.find(x => x.id === id); if (!c || !this.canSee(c)) throw new Error('无权查看或客户不存在 Not found / no access'); return this.enrich(c); },
    guard(before, patch) {
      const me = this.me(); if (me.role === 'admin') return;
      if ('owner_id' in patch && before && patch.owner_id !== before.owner_id) throw new Error('业务员不能更改负责人 Sales cannot change owner');
      if (patch.status === '无效' && (!before || before.status !== '无效')) throw new Error('只有管理员可以标记“无效”');
      if (before) C.PROTECTED.forEach(k => { if (k in patch && String(before[k] || '').trim() && !String(patch[k] || '').trim()) throw new Error(`初始资料不可删除：${k}（可修改，不可清空）`); });
    },
    async checkDuplicate({ name, website, phone }) {
      const d = U.domain(website), p = U.phoneKey(phone), n = U.nameKey(name), me = this.me(), users = this.load().users, out = [];
      this.load().clients.forEach(c => {
        const m = [];
        if (d && U.domain(c.website) === d) m.push('网站 domain');
        if (p && (U.phoneKey(c.company_phone) === p || U.phoneKey(c.whatsapp) === p)) m.push('电话 phone');
        if (n && n.length > 3 && U.nameKey(c.company_name) === n) m.push('名称 name');
        if (m.length) { const vis = this.canSee(c, me); out.push({ match: m.join(' + '), company_name: vis ? c.company_name : null, owner_name: c.owner_id ? (users.find(u => u.id === c.owner_id) || {}).full_name : '公海 Pool', client_id: vis ? c.id : null, mine: c.owner_id === me.id }); }
      });
      return out;
    },
    async createClient(data, opts = {}) {
      const me = this.me(), db = this.load(); this.guard(null, data);
      if (!String(data.company_name || '').trim()) throw new Error('公司名称不能为空');
      if (me.role !== 'admin') { const d = await this.checkDuplicate({ name: data.company_name, website: data.website, phone: data.company_phone }); if (d.length) throw new Error(`客户已存在（${d[0].match}），归属：${d[0].owner_name}`); }
      const c = { tags: [], products: [], ...data, id: uid('c'), created_by: me.id, owner_id: me.role === 'admin' ? (data.owner_id ?? me.id) : me.id, created_at: nowISO(), updated_at: nowISO() };
      db.clients.unshift(c); this.audit(c.id, 'create', { company_name: c.company_name }); this.save(); return c;
    },
    async updateClient(id, patch, action) {
      const db = this.load(), c = db.clients.find(x => x.id === id); if (!c || !this.canSee(c)) throw new Error('无权修改');
      patch = { ...patch }; delete patch.id; delete patch.created_by; delete patch.created_at; this.guard(c, patch);
      const d = U.diff(c, patch, TRACK); if (!Object.keys(d).length) return { ...c };
      Object.assign(c, patch, { updated_at: nowISO() }); this.audit(id, action || ('owner_id' in d ? 'assign' : 'update'), d); this.save(); return { ...c };
    },
    async bulkUpdate(ids, patch) { let n = 0; for (const id of ids) { await this.updateClient(id, { ...patch }); n++; } return n; },
    async claimClient(id) {
      const db = this.load(), c = db.clients.find(x => x.id === id), me = this.me();
      if (!me || me.role !== 'sales') throw new Error('只有业务员可以从公海领取客户');
      if (!c || c.owner_id) throw new Error('该客户已被领取或不在公海');
      c.owner_id = me.id; c.updated_at = nowISO(); this.audit(id, 'claim', { owner_id: me.id }); this.save(); return { ...c };
    },
    async canDeleteClients() { const me = this.me(); return !!(me && me.active && me.role === 'admin' && ['boss', 'admin'].includes(me.username)); },
    async bulkDeleteClients(ids) {
      if (!await this.canDeleteClients()) throw new Error('仅老板账号可以删除客户');
      const selected = new Set(ids), db = this.load(), clients = db.clients.filter(c => selected.has(c.id));
      if (clients.length !== selected.size) throw new Error('部分客户已变化，请刷新后重试');
      clients.forEach(c => this.audit(c.id, 'delete', { company_name: c.company_name }));
      db.clients = db.clients.filter(c => !selected.has(c.id));
      ['logs', 'quotes', 'samples'].forEach(k => db[k] = db[k].filter(r => !selected.has(r.client_id)));
      this.save(); return clients.map(c => c.id);
    },
    async deleteClient(id) { return this.bulkDeleteClients([id]); },
    names() { const u = this.load().users; return id => (u.find(x => x.id === id) || {}).full_name || ''; },
    async listLogs(cid) { await this.getClient(cid); const nm = this.names(); return this.load().logs.filter(l => l.client_id === cid).map(l => ({ ...l, author_name: nm(l.author_id) })).sort((a, b) => (b.entry_date + b.created_at).localeCompare(a.entry_date + a.created_at)); },
    async addLog(cid, { entry_date, channel, content, next_follow_up, status }) {
      const c = await this.getClient(cid), me = this.me();
      const l = { id: uid('l'), client_id: cid, author_id: me.id, entry_date, channel: channel || 'email', content, next_follow_up: next_follow_up || null, created_at: nowISO() };
      this.load().logs.push(l); this.audit(cid, 'log', { channel: l.channel, entry_date }); this.save();
      const patch = { next_follow_up: next_follow_up || null }; if (status && status !== c.status) patch.status = status;
      if (!status && c.status === '未联系') patch.status = '已联系';
      await this.updateClient(cid, patch, 'update'); return l;
    },
    async listQuotes(cid) { if (cid) await this.getClient(cid); const nm = this.names(), me = this.me(); return this.load().quotes.filter(q => cid ? q.client_id === cid : this.canSee(this.db.clients.find(c => c.id === q.client_id) || {}, me)).map(q => ({ ...q, author_name: nm(q.author_id) })).sort((a, b) => b.quote_date.localeCompare(a.quote_date)); },
    async addQuote(cid, q) { const c = await this.getClient(cid); const r = { ...q, id: uid('q'), client_id: cid, author_id: this.me().id, created_at: nowISO() }; this.load().quotes.push(r); this.audit(cid, 'quote', { product: q.product, price: q.price, currency: q.currency, qty: q.qty }); this.save(); if (['未联系', '已联系', '已回复'].includes(c.status)) await this.updateClient(cid, { status: '已报价' }); return r; },
    async deleteQuote(id) { if (!this.admin()) throw new Error('仅管理员'); const db = this.load(); db.quotes = db.quotes.filter(q => q.id !== id); this.save(); },
    async listSamples(cid) { if (cid) await this.getClient(cid); const nm = this.names(), me = this.me(); return this.load().samples.filter(s => cid ? s.client_id === cid : this.canSee(this.db.clients.find(c => c.id === s.client_id) || {}, me)).map(s => ({ ...s, author_name: nm(s.author_id) })).sort((a, b) => (b.sent_date || '').localeCompare(a.sent_date || '')); },
    async addSample(cid, s) { await this.getClient(cid); const r = { ...s, id: uid('s'), client_id: cid, author_id: this.me().id, created_at: nowISO() }; this.load().samples.push(r); this.audit(cid, 'sample', { items: s.items, status: s.status }); this.save(); return r; },
    async updateSample(id, patch) { const s = this.load().samples.find(x => x.id === id); await this.getClient(s.client_id); const d = U.diff(s, patch, ['status', 'feedback', 'tracking_no', 'courier', 'sent_date']); Object.assign(s, patch); this.audit(s.client_id, 'sample', d); this.save(); },
    async listAllLogs(sinceISO) { const me = this.me(), nm = this.names(); return this.load().logs.filter(l => (!sinceISO || l.entry_date >= sinceISO) && this.canSee(this.db.clients.find(c => c.id === l.client_id) || {}, me)).map(l => ({ ...l, author_name: nm(l.author_id) })); },
    async listAudit({ client_id, limit } = {}) {
      const me = this.me(), nm = this.names(), db = this.load();
      return db.audit.filter(a => client_id ? a.client_id === client_id : (me.role === 'admin' || (db.clients.find(c => c.id === a.client_id) && this.canSee(db.clients.find(c => c.id === a.client_id), me))))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit || 200).map(a => ({ ...a, actor_name: nm(a.actor_id), company_name: (db.clients.find(c => c.id === a.client_id) || {}).company_name || a.detail.company_name || '' }));
    },
    async listSavedFilters() { const me = this.me(); return this.load().saved_filters.filter(f => f.user_id === me.id); },
    async saveFilter(name, filters) { const r = { id: uid('f'), user_id: this.me().id, name, filters }; this.load().saved_filters.push(r); this.save(); return r; },
    async deleteFilter(id) { const db = this.load(), me = this.me(); db.saved_filters = db.saved_filters.filter(f => !(f.id === id && f.user_id === me.id)); this.save(); },
    async listTemplates() { const me = this.me(); return this.load().templates.filter(t => !t.owner_id || t.owner_id === me.id); },
    async saveTemplate(t) {
      const me = this.me(), db = this.load();
      if (t.id) { const x = db.templates.find(y => y.id === t.id); if (!x) throw new Error('not found'); if (!x.owner_id && me.role !== 'admin') throw new Error('公共模板仅管理员可改；可“另存为我的模板”'); if (x.owner_id && x.owner_id !== me.id) throw new Error('无权'); Object.assign(x, t); }
      else db.templates.push({ ...t, id: uid('t'), owner_id: (t.shared && me.role === 'admin') ? null : me.id });
      this.save();
    },
    async deleteTemplate(id) { const me = this.me(), db = this.load(), x = db.templates.find(y => y.id === id); if (!x) return; if ((!x.owner_id && me.role !== 'admin') || (x.owner_id && x.owner_id !== me.id)) throw new Error('无权'); db.templates = db.templates.filter(y => y.id !== id); this.save(); },
    async importClients(rows) {
      if (!this.admin()) throw new Error('仅管理员可导入'); const db = this.load(), me = this.me(); let n = 0;
      rows.forEach(r => { const id = uid('c'); db.clients.push({ tags: [], products: [], ...r, id, created_by: me.id, owner_id: r.owner_id || null, status: r.status || '未联系', created_at: nowISO(), updated_at: nowISO() }); n++; });
      this.audit(null, 'import', { count: n }); this.save(); return n;
    },
    async backup() { if (!this.admin()) throw new Error('仅管理员'); const db = this.load(); return { exported_at: nowISO(), mode: 'demo', users: db.users.map(u => this.pub(u)), clients: db.clients, follow_ups: db.logs, quotes: db.quotes, samples: db.samples, audit_log: db.audit, templates: db.templates }; },
    async listLearningMaterials() { const db=this.load(), me=this.me(); return db.learning_materials.filter(x=>x.status==='published'||me.role==='admin').sort((a,b)=>(a.category||'').localeCompare(b.category||'')||(a.sort_order||0)-(b.sort_order||0)); },
    async saveLearningMaterial(row) { if(!this.admin()) throw new Error('仅老板可管理学习资料'); const db=this.load(), now=nowISO(); if(row.id){const x=db.learning_materials.find(v=>v.id===row.id);if(!x)throw new Error('资料不存在');Object.assign(x,row,{updated_at:now});this.save();return x;} const x={...row,id:uid('lm'),created_by:this.me().id,created_at:now,updated_at:now};db.learning_materials.unshift(x);this.save();return x; },
    async deleteLearningMaterial(id) { if(!this.admin()) throw new Error('仅老板可删除学习资料'); this.load().learning_materials=this.load().learning_materials.filter(x=>x.id!==id);this.save(); },
    async learningFileUrl() { throw new Error('演示模式不支持私有文件上传；可先使用资料链接或切换正式 CRM'); },
    async listLearningProgress() { const me=this.me();return this.load().learning_progress.filter(x=>me.role==='admin'||x.user_id===me.id).map(x=>({...x,user:this.load().users.find(u=>u.id===x.user_id)})); },
    async markLearningComplete(materialId) { const db=this.load(),me=this.me();let p=db.learning_progress.find(x=>x.material_id===materialId&&x.user_id===me.id);if(!p){p={id:uid('lp'),material_id:materialId,user_id:me.id};db.learning_progress.push(p);}p.completed_at=nowISO();this.save();return p; },
    async fetchSite(url) {
      try { const r = await fetch('/api/fetch-site?url=' + encodeURIComponent(url)); if (r.ok) return await r.json(); } catch (e) {}
      return { website: url, offline: true };
    }
  };

  // ======================= SUPABASE =======================
  const Supa = {
    sb: null, profile: null, mode: 'supabase',
    init() { if (!this.sb) this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); return this.sb; },
    t(name) { return this.init().from(name); },
    clean(d) { d = { ...d }; ['customer_type', 'priority', 'next_follow_up', 'owner_id', 'state', 'whatsapp'].forEach(k => { if (k in d && d[k] === '') d[k] = null; }); delete d.owner; return d; },
    email(u) { return u.trim().toLowerCase() + '@' + cfg.USERNAME_EMAIL_DOMAIN; },
    chk(r) { if (r.error) throw new Error(r.error.message.replace(/^.*?ERROR:\s*/, '')); return r.data; },
    async login(username, password) { username = username.trim(); let email = username.includes('@') ? username.toLowerCase() : null;
      if (!email) { const r = await this.init().rpc('login_email', { p_username: username }); email = (r.data || this.email(username)); }
      const a = await this.init().auth.signInWithPassword({ email, password }); if (a.error) throw new Error(/invalid/i.test(a.error.message) ? '用户名/邮箱或密码错误 Wrong login or password' : a.error.message); const p = await this.currentUser(); if (!p) throw new Error('账号已停用或未建档 Account disabled / no profile'); return p; },
    async currentUser() {
      const { data } = await this.init().auth.getUser(); if (!data.user) return null;
      const r = await this.t('profiles').select('*').eq('id', data.user.id).maybeSingle(); this.profile = r.data;
      if (!this.profile || !this.profile.active) { await this.init().auth.signOut(); return null; } return this.profile;
    },
    async logout() { await this.init().auth.signOut(); },
    async updateMyProfile(p) { const allowed = {}; ['full_name', 'name_en', 'title_en', 'work_email', 'whatsapp', 'signature'].forEach(k => { if (k in p) allowed[k] = p[k]; }); this.profile = this.chk(await this.init().rpc('update_my_profile', { p: allowed })); return this.profile; },
    async listUsers() { return this.chk(await this.t('profiles').select('*').order('username')); },
    async fn(name, body) { const r = await this.init().functions.invoke(name, { body }); if (r.error) throw new Error(r.error.message); if (r.data && r.data.error) throw new Error(r.data.error); return r.data; },
    async createUser(u) { return this.fn('admin-users', { action: 'create', ...u, email: (u.email || '').trim().toLowerCase() || this.email(u.username) }); },
    async updateUser(id, patch) { return this.fn('admin-users', { action: 'update', id, ...patch }); },
    async listClients() { const out = []; for (let from = 0; ; from += 1000) { const rows = this.chk(await this.t('clients_view').select('*').order('updated_at', { ascending: false }).range(from, from + 999)); out.push(...rows); if (rows.length < 1000) break; } return out; },
    async getClient(id) { const r = this.chk(await this.t('clients_view').select('*').eq('id', id).maybeSingle()); if (!r) throw new Error('无权查看或客户不存在 Not found / no access'); return r; },
    async checkDuplicate({ name, website, phone }) { return this.chk(await this.init().rpc('check_duplicate', { p_name: U.nameKey(name), p_domain: U.domain(website), p_phone: U.phoneKey(phone) })); },
    async createClient(d, opts = {}) { const me = this.profile; d = { ...d, owner_id: me.role === 'admin' ? (d.owner_id === undefined ? me.id : d.owner_id) : me.id }; if (opts.allowDuplicate) d.allow_duplicate = true; return this.chk(await this.t('clients').insert(this.clean(d)).select().single()); },
    async updateClient(id, p) { p = { ...p }; ['id', 'created_by', 'created_at', 'last_follow_up', 'log_count', 'domain'].forEach(k => delete p[k]); return this.chk(await this.t('clients').update(this.clean(p)).eq('id', id).select().single()); },
    async claimClient(id) { return this.chk(await this.init().rpc('claim_client', { p_client_id: id })); },
    async bulkUpdate(ids, patch) { this.chk(await this.t('clients').update(this.clean(patch)).in('id', ids)); return ids.length; },
    async canDeleteClients() {
      if (!this.profile || !this.profile.active || this.profile.role !== 'admin') return false;
      return this.chk(await this.init().rpc('can_delete_clients')) === true;
    },
    async bulkDeleteClients(ids) {
      if (!await this.canDeleteClients()) throw new Error('仅老板账号可以删除客户');
      const selected = [...new Set(ids)];
      if (!selected.length) return [];
      return this.chk(await this.init().rpc('delete_clients', { p_ids: selected }));
    },
    async deleteClient(id) { return this.bulkDeleteClients([id]); },
    async listLogs(cid) { return this.chk(await this.t('follow_ups').select('*, author:profiles(full_name)').eq('client_id', cid).order('entry_date', { ascending: false }).order('created_at', { ascending: false })).map(r => ({ ...r, author_name: r.author ? r.author.full_name : '' })); },
    async addLog(cid, l) { return this.chk(await this.init().rpc('add_follow_up', { p_client: cid, p_date: l.entry_date, p_channel: l.channel || 'email', p_content: l.content, p_next: l.next_follow_up || null, p_status: l.status || null })); },
    async listQuotes(cid) { let q = this.t('quotes').select('*, author:profiles(full_name)').order('quote_date', { ascending: false }); if (cid) q = q.eq('client_id', cid); return this.chk(await q).map(r => ({ ...r, author_name: r.author ? r.author.full_name : '' })); },
    async addQuote(cid, q) { return this.chk(await this.t('quotes').insert({ ...q, client_id: cid }).select().single()); },
    async deleteQuote(id) { this.chk(await this.t('quotes').delete().eq('id', id)); },
    async listSamples(cid) { let q = this.t('samples').select('*, author:profiles(full_name)').order('sent_date', { ascending: false }); if (cid) q = q.eq('client_id', cid); return this.chk(await q).map(r => ({ ...r, author_name: r.author ? r.author.full_name : '' })); },
    async addSample(cid, s) { return this.chk(await this.t('samples').insert({ ...s, client_id: cid }).select().single()); },
    async updateSample(id, p) { return this.chk(await this.t('samples').update(p).eq('id', id)); },
    async listAllLogs(since) { let q = this.t('follow_ups').select('*, author:profiles(full_name)'); if (since) q = q.gte('entry_date', since); return this.chk(await q.limit(5000)).map(r => ({ ...r, author_name: r.author ? r.author.full_name : '' })); },
    async listAudit({ client_id, limit } = {}) { let q = this.t('audit_log').select('*, actor:profiles(full_name), client:clients(company_name)').order('at', { ascending: false }).limit(limit || 200); if (client_id) q = q.eq('client_id', client_id); return this.chk(await q).map(a => ({ ...a, actor_name: a.actor ? a.actor.full_name : '', company_name: a.client ? a.client.company_name : (a.detail && a.detail.company_name) || '' })); },
    async listSavedFilters() { return this.chk(await this.t('saved_filters').select('*').eq('user_id', this.profile.id)); },
    async saveFilter(name, filters) { return this.chk(await this.t('saved_filters').insert({ name, filters }).select().single()); },
    async deleteFilter(id) { this.chk(await this.t('saved_filters').delete().eq('id', id)); },
    async listTemplates() { return this.chk(await this.t('templates').select('*').order('channel').order('stage')); },
    async saveTemplate(t) { const row = { name: t.name, channel: t.channel, stage: t.stage, subject: t.subject || '', body: t.body }; if (t.id) return this.chk(await this.t('templates').update(row).eq('id', t.id)); row.owner_id = (t.shared && this.profile.role === 'admin') ? null : this.profile.id; return this.chk(await this.t('templates').insert(row)); },
    async deleteTemplate(id) { this.chk(await this.t('templates').delete().eq('id', id)); },
    async importClients(rows) { let n = 0; for (let i = 0; i < rows.length; i += 500) { this.chk(await this.t('clients').insert(rows.slice(i, i + 500).map(r => ({ ...this.clean(r), allow_duplicate: true })))); n += Math.min(500, rows.length - i); } return n; },
    async backup() { const g = async t => { const out = []; for (let f = 0; ; f += 1000) { const r = this.chk(await this.t(t).select('*').range(f, f + 999)); out.push(...r); if (r.length < 1000) break; } return out; };
      return { exported_at: nowISO(), mode: 'supabase', users: await g('profiles'), clients: await g('clients'), follow_ups: await g('follow_ups'), quotes: await g('quotes'), samples: await g('samples'), audit_log: await g('audit_log'), templates: await g('templates') }; },
    async listLearningMaterials() { let q=this.t('crm_learning_materials').select('*').order('category').order('sort_order').order('created_at',{ascending:false});return this.chk(await q); },
    async saveLearningMaterial(row) {
      if(!this.profile||this.profile.role!=='admin')throw new Error('仅老板可管理学习资料');
      const file=row.file, materialId=row.id||crypto.randomUUID();let filePath=row.file_path||null;
      if(file){if(file.size>20*1024*1024)throw new Error('单份资料最大20MB');const safe=file.name.replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,120),path=`${materialId}/${crypto.randomUUID()}_${safe}`;const uploaded=await this.init().storage.from('crm-learning').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(uploaded.error)throw new Error(uploaded.error.message);filePath=path;}
      const data={title:row.title,description:row.description||'',category:row.category,required:!!row.required,status:row.status||'draft',sort_order:Number(row.sort_order||0),external_url:row.external_url||null,file_path:filePath,file_name:file?file.name:(row.file_name||null),file_size:file?file.size:(row.file_size||null)};
      try {const saved=row.id?this.chk(await this.t('crm_learning_materials').update(data).eq('id',materialId).select().single()):this.chk(await this.t('crm_learning_materials').insert({...data,id:materialId,created_by:this.profile.id}).select().single());if(file&&row.file_path&&row.file_path!==filePath){const old=await this.init().storage.from('crm-learning').remove([row.file_path]);if(old.error)console.warn('旧学习附件未能清理',old.error.message);}return saved;}
      catch(e){if(filePath&&file)await this.init().storage.from('crm-learning').remove([filePath]);throw e;}
    },
    async deleteLearningMaterial(id) { const row=this.chk(await this.t('crm_learning_materials').select('file_path').eq('id',id).maybeSingle());if(row?.file_path){const r=await this.init().storage.from('crm-learning').remove([row.file_path]);if(r.error)throw new Error(r.error.message);}this.chk(await this.t('crm_learning_materials').delete().eq('id',id)); },
    async learningFileUrl(path) { const r=await this.init().storage.from('crm-learning').createSignedUrl(path,300);if(r.error)throw new Error(r.error.message);return r.data.signedUrl; },
    async listLearningProgress() { const q=this.t('crm_learning_progress').select('*').order('completed_at',{ascending:false});return this.chk(await q); },
    async markLearningComplete(materialId) { return this.chk(await this.t('crm_learning_progress').upsert({material_id:materialId,user_id:this.profile.id,completed_at:nowISO()},{onConflict:'material_id,user_id'}).select().single()); },
    async fetchSite(url) { return this.fn('fetch-site', { url }); },
    reset() {}
  };
  window.DB = cfg.MODE === 'supabase' ? Supa : Demo;
})();
