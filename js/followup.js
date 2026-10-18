/* Customer flags and recurring, in-app email reminders. No email is sent here. */
(function () {
  const LEVELS = ['紧急', '重要', '普通', '无效'], PERIOD = 3 * 86400000;
  const now = () => new Date().toISOString();
  UI.attention = c => c.status === '无效' ? '无效' : (c.attention_level || '普通');
  UI.isInvalid = c => UI.attention(c) === '无效';
  UI.emailDue = c => !!(c.owner_id && !UI.isInvalid(c) && c.email_anchor_at
    && c.reminder_owner_id === c.owner_id && Date.now() >= Date.parse(c.email_anchor_at) + PERIOD);
  UI.emailDueDate = c => c.email_anchor_at ? new Date(Date.parse(c.email_anchor_at) + PERIOD).toLocaleString('zh-CN') : '领取后开始计时';
  UI.attentionBadge = c => `<span class="attention attention-${LEVELS.indexOf(UI.attention(c))}">${UI.esc(UI.attention(c))}</span>`;
  UI.attentionControl = c => (UI.ME.role === 'admin' || c.owner_id === UI.ME.id)
    ? `<select data-attention="${UI.esc(c.id)}" aria-label="客户标记">${LEVELS.map(l => UI.opt(l, l, UI.attention(c))).join('')}</select>` : UI.attentionBadge(c);
  UI.bindAttention = () => UI.$$('[data-attention]').forEach(el => el.onchange = async () => {
    const c = UI.CLIENTS.find(c => c.id === el.dataset.attention); if (!c) return;
    const previous = UI.attention(c), level = el.value;
    const reason = level === '无效' ? prompt('请填写标记为无效的原因，供老板审查：') : '';
    if (level === '无效' && !String(reason || '').trim()) { el.value = previous; return; }
    el.disabled = true;
    try { await DB.setAttention(c.id, level, reason || ''); await UI.refresh(); await UI.route(); UI.toast('客户标记已更新'); }
    catch (e) { el.value = previous; UI.toast(e.message, 1); }
    finally { el.disabled = false; }
  });

  let tracking = new Map();
  const listClients = DB.listClients.bind(DB), getClient = DB.getClient.bind(DB), listAudit = DB.listAudit.bind(DB);
  const optionalRows = async query => {
    const r = await query;
    if (r.error && ['42P01', 'PGRST205'].includes(r.error.code)) return [];
    return DB.chk(r) || [];
  };
  const demoTracking = () => {
    const db = DB.load(); db.client_tracking = db.client_tracking || {};
    db.clients.forEach(c => {
      let t = db.client_tracking[c.id];
      if (!t || t.reminder_owner_id !== c.owner_id) db.client_tracking[c.id] = {
        ...(t || {}), client_id: c.id, attention_level: t?.attention_level || '普通',
        reminder_owner_id: c.owner_id || null, email_anchor_at: c.owner_id ? now() : null
      };
    });
    DB.save(); return Object.values(db.client_tracking);
  };
  DB.listClients = async () => {
    const clients = await listClients(); let flags = [];
    if (DB.mode === 'demo') flags = demoTracking();
    else for (let from = 0; ; from += 1000) {
      const rows = await optionalRows(DB.t('client_tracking').select('*').order('client_id').range(from, from + 999));
      flags.push(...rows); if (rows.length < 1000) break;
    }
    tracking = new Map(flags.map(t => [t.client_id, t]));
    return clients.map(c => ({ ...c, ...(tracking.get(c.id) || {}), id: c.id }));
  };
  DB.getClient = async id => ({ ...await getClient(id), ...(tracking.get(id) || {}), id });
  DB.setAttention = async (id, level, reason) => {
    if (!LEVELS.includes(level)) throw new Error('请选择有效的客户标记');
    if (level === '无效' && !reason.trim()) throw new Error('请填写无效原因');
    if (DB.mode !== 'demo') return DB.chk(await DB.init().rpc('set_client_attention', { p_client_id: id, p_level: level, p_reason: reason }));
    const c = await getClient(id), me = DB.me();
    if (!me || !me.active || (me.role !== 'admin' && c.owner_id !== me.id)) throw new Error('只能标记自己负责的客户');
    if (c.status === '无效' && level !== '无效') throw new Error('此客户已被管理员设为无效，请联系老板恢复');
    demoTracking(); const t = DB.load().client_tracking[id], old = t.attention_level;
    if (old === level && t.invalid_reason === reason) return;
    if (old === '无效' && level !== '无效') t.email_anchor_at = c.owner_id ? now() : null;
    Object.assign(t, { attention_level: level, invalid_reason: level === '无效' ? reason.trim() : '', marked_at: now(), marked_by: me.id });
    DB.audit(id, 'attention', { attention_level: [old, level], invalid_reason: t.invalid_reason }); DB.save();
  };
  if (DB.mode === 'demo') {
    const bulkDelete = DB.bulkDeleteClients.bind(DB);
    DB.bulkDeleteClients = async ids => { const deleted = await bulkDelete(ids); deleted.forEach(id => delete DB.load().client_tracking?.[id]); DB.save(); return deleted; };
    const addLog = DB.addLog.bind(DB);
    DB.addLog = async (id, data) => {
      const result = await addLog(id, data); demoTracking();
      const c = DB.load().clients.find(c => c.id === id), t = DB.load().client_tracking[id];
      if (data.channel === 'email' && c.owner_id === DB.me().id) {
        const today = UI.today(), date = data.entry_date || today;
        const sent = date >= today ? now() : new Date(date + 'T00:00:00+08:00').toISOString();
        if (sent > t.email_anchor_at) { t.email_anchor_at = sent; DB.save(); }
      }
      return result;
    };
  } else {
    DB.listAudit = async (options = {}) => {
      const original = await listAudit(options); let q = DB.t('client_attention_events').select('*').order('at', { ascending: false }).limit(options.limit || 200);
      if (options.client_id) q = q.eq('client_id', options.client_id);
      const events = await optionalRows(q);
      return [...original, ...events.map(e => ({ ...e, action: 'attention', actor_name: UI.userName(e.actor_id),
        detail: { attention_level: [e.old_level, e.new_level], invalid_reason: e.reason } }))]
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, options.limit || 200);
    };
  }
  const bindShell = UI.bindShell;
  UI.bindShell = () => { bindShell(); showReminders(); };
  function showReminders() {
    if (!UI.ME || !document.querySelector('main')) return;
    document.querySelector('#emailReminderNotice')?.remove();
    const due = UI.CLIENTS.filter(c => (UI.ME.role === 'admin' || c.owner_id === UI.ME.id) && UI.emailDue(c));
    if (!due.length) return;
    const notice = document.createElement('div'); notice.id = 'emailReminderNotice'; notice.className = 'warn email-reminder';
    notice.innerHTML = `<b>✉️ ${UI.ME.role === 'admin' ? '团队' : '你有'} ${due.length} 家客户到期需要邮件跟进</b> <a href="#/email-reminders">查看提醒</a> · 每3天提醒，登记邮件跟进后重新计时`;
    document.querySelector('main').prepend(notice);
    // Persistent per-account, per-customer three-day buckets suppress repeated toasts.
    if (UI.ME.role !== 'admin') {
      let fresh = false;
      for (const c of due) {
        const bucket = Math.floor((Date.now() - Date.parse(c.email_anchor_at)) / PERIOD);
        const key = `fcrm_email_notice:${UI.ME.id}:${c.id}`;
        const token = `${c.email_anchor_at}:${bucket}`;
        try { if (localStorage.getItem(key) !== token) { localStorage.setItem(key, token); fresh = true; } } catch (e) { /* Banner remains available if storage is disabled. */ }
      }
      if (fresh) UI.toast(`邮件跟进提醒：${due.length} 家客户已到期`);
    }
  }
  setInterval(() => { if (!document.hidden) showReminders(); }, 60000);
})();
