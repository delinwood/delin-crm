/* Customer flags and recurring in-app chase reminders. */
(function () {
  const LEVELS = ['紧急', '重要', '普通', '无效'], PERIOD = 7 * 86400000;
  const now = () => new Date().toISOString();
  UI.attention = c => c.status === '无效' ? '无效' : (c.attention_level || '普通');
  UI.isInvalid = c => UI.attention(c) === '无效';
  UI.chaseEligible = c => !!(c.owner_id && !UI.isInvalid(c) && c.status !== '成交'
    && (c.chase_assigned_at || DB.mode === 'demo') && UI.USERS.some(u => u.id === c.owner_id && u.role === 'sales'));
  UI.emailDue = c => !!(UI.chaseEligible(c) && c.email_anchor_at
    && c.reminder_owner_id === c.owner_id && Date.now() >= Date.parse(c.email_anchor_at) + PERIOD);
  UI.emailDueDate = c => UI.chaseEligible(c) && c.email_anchor_at
    ? new Date(Date.parse(c.email_anchor_at) + PERIOD).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无追单提醒';
  UI.chaseButton = c => UI.chaseEligible(c) && UI.ME.role === 'sales' && c.owner_id === UI.ME.id
    ? `<button class="btn ghost sm" type="button" data-chase="${UI.esc(c.id)}">标记已追单</button>` : '';
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-chase]');
    if (!button) return;
    const c = UI.CLIENTS.find(row => row.id === button.dataset.chase);
    if (!c || !UI.chaseButton(c)) return;
    UI.modal(`<h2>登记已追单</h2><p>${UI.esc(c.company_name)} · 只登记已发生的联系</p>
      <form><label>联系渠道<select name="channel">${C.CHANNELS.map(([id,label]) => UI.opt(id,label,'email')).join('')}</select></label>
      <label>沟通记录<textarea name="note" required maxlength="2000"></textarea></label>
      <label><input type="checkbox" name="replied"> 本次已收到客户回复</label>
      <p role="status" class="err"></p><button class="primary">保存追单记录</button></form>`, (modal, close) => {
      const form = modal.querySelector('form'), save = form.querySelector('button');
      form.onsubmit = async event => {
        event.preventDefault();
        const { channel, note, replied } = form.elements;
        if (!note.value.trim()) return;
        save.disabled = true;
        try {
          if (DB.mode === 'demo') await DB.addLog(c.id, { entry_date: UI.today(), channel: channel.value, content: '已追单：' + note.value.trim(), next_follow_up: c.next_follow_up, status: replied.checked ? '已回复' : undefined });
          else DB.chk(await DB.init().rpc('crm_mark_chased', { p_client: c.id, p_channel: channel.value, p_note: note.value, p_replied: replied.checked }));
        } catch (error) {
          form.querySelector('[role=status]').textContent = error.message;
          save.disabled = false;
          return;
        }
        close(); UI.toast('已记录追单，7 天提醒重新计时');
        try { await UI.refresh(); await UI.route(); } catch (error) { UI.toast(error.message, 1); }
      };
    });
  });
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
    const [clients,flags]=await Promise.all([listClients(),(async()=>{let flags=[];
    if (DB.mode === 'demo') flags = demoTracking();
    else for (let from = 0; ; from += 1000) {
      const rows = await optionalRows(DB.t('client_tracking').select('*').order('client_id').range(from, from + 999));
      flags.push(...rows); if (rows.length < 1000) break;
    }
    return flags;})()]);
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
      if (c.owner_id === DB.me().id && data.entry_date <= UI.today()) {
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
    notice.innerHTML = `<b>✉️ ${UI.ME.role === 'admin' ? '团队' : '你有'} ${due.length} 家客户到期需要追单</b> <a href="#/email-reminders">查看提醒</a> · 每7天提醒，登记实际联系后重新计时`;
    document.querySelector('main').prepend(notice);
    // Persistent per-account, per-customer seven-day buckets suppress repeated toasts.
    if (UI.ME.role !== 'admin') {
      let fresh = false;
      for (const c of due) {
        const bucket = Math.floor((Date.now() - Date.parse(c.email_anchor_at)) / PERIOD);
        const key = `fcrm_chase_notice:${UI.ME.id}:${c.id}`;
        const token = `${c.email_anchor_at}:${bucket}`;
        try { if (localStorage.getItem(key) !== token) { localStorage.setItem(key, token); fresh = true; } } catch (e) { /* Banner remains available if storage is disabled. */ }
      }
      if (fresh) UI.toast(`追单提醒：${due.length} 家客户已到期`);
    }
  }
  setInterval(() => { if (!document.hidden) showReminders(); }, 60000);
})();
