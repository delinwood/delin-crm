/* Bounce, failure, unsubscribe and manual send-pace. Does not send mail or track opens. */
(function () {
  const { esc, $, $$ } = UI;
  const labels = { failed: '发送失败', bounced: '已确认退信', unknown: '状态待核实', permanent_bounce: '同步：永久退信', temporary_bounce: '同步：临时退信' };
  const paceKey = () => 'fcrm_pace_cap:' + (UI.ME && UI.ME.id || 'local');
  async function allRows(table, query) {
    const out = [];
    for (let start = 0; ; start += 1000) {
      const rows = DB.chk(await query(DB.t(table)).range(start, start + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  function problems(messages, inbound) {
    const sent = messages.filter(m => ['failed', 'bounced', 'unknown'].includes(m.status)).map(m => ({
      when: m.attempted_at || m.created_at, company: m.company_name, client_id: m.client_id, who: m.recipient,
      kind: m.status, reason: m.error || '邮件记录里没有更短的原因', source: '记录', detail: m.error || ''
    }));
    const synced = inbound.map(r => {
      const parsed = CRM_OBSERVE.bounceSummary(r.body || '');
      return {
        when: r.received_at, company: (UI.CLIENTS.find(c => c.id === r.client_id) || {}).company_name || '客户',
        client_id: r.client_id, who: parsed.recipient || r.from_email, kind: r.kind,
        reason: parsed.reason || '退信报告里没有标准原因，请打开原文', source: r.reviewed_at ? '已审查' : '待审查',
        detail: r.body || '', inbound: r.id
      };
    });
    return [...sent, ...synced].sort((a, b) => String(b.when || '').localeCompare(String(a.when || ''))).slice(0, 200);
  }
  async function render() {
    if (DB.mode === 'demo') {
      UI.render(`<div class="pagehead"><h1>退信与发信节奏</h1><a class="btn ghost" href="#/mail">邮件中心</a></div><section class="card pad"><p>演示模式不读取真实邮箱，也不会发送邮件。</p>${explain()}</section>`, 'mail');
      return;
    }
    let error = '', messages = [], inbound = [], unsubs = [], account = null;
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    try {
      const status = await DB.init().functions.invoke('crm-mail', { body: { action: 'status' } });
      if (!status.error && !status.data?.error) account = status.data?.account || null;
    } catch (e) { error = e.message; }
    try {
      [messages, inbound] = await Promise.all([
        allRows('mail_messages', q => q.select('id,sender_id,client_id,company_name,recipient,status,error,attempted_at,sent_at,created_at').gte('attempted_at', since).order('attempted_at', { ascending: false }).order('id')),
        DB.t('crm_mail_inbound').select('id,client_id,sender_id,kind,from_email,subject,body,received_at,reviewed_at').in('kind', ['permanent_bounce', 'temporary_bounce']).order('received_at', { ascending: false }).limit(200).then(r => DB.chk(r))
      ]);
    } catch (e) { error = error ? error + ' ' + e.message : e.message; }
    try { unsubs = DB.chk(await DB.init().rpc('crm_mail_unsubscribes')) || []; }
    catch (e) { error = (error ? error + ' ' : '') + e.message; }
    const pace = CRM_OBSERVE.paceDays(messages, 7, new Date());
    const today = pace[pace.length - 1] || { attempts: 0, accepted: 0, failed: 0 };
    const cap = Number(localStorage.getItem(paceKey()) || '');
    const max = Math.max(1, ...pace.map(d => d.attempts));
    const rows = problems(messages.filter(m => ['failed', 'bounced', 'unknown'].includes(m.status)), inbound);
    const mine = UI.ME.id;
    const limit = account ? (account.daily_limit === 0 ? '不设系统每日上限' : account.daily_limit + ' 封/过去24小时') : '连接邮箱后可看到你的系统额度';
    const tried = messages.filter(m => m.sender_id === mine && Date.parse(m.attempted_at || '') > Date.now() - 86400000).length;
    UI.render(`<div class="pagehead"><h1>退信与发信节奏</h1><div class="actions"><a class="btn ghost" href="#/mail">邮件中心</a><a class="btn ghost" href="#/inbound">回复 / 退信同步</a><button class="ghost" id="healthReload">刷新</button></div></div>
      ${error ? `<p class="warn">${esc(error)}。若提示缺少字段或函数，请老板先在 Supabase SQL Editor 执行本次迁移。</p>` : ''}
      <section class="card pad"><h2>最近退信和发送失败</h2><p class="muted small">这里只汇总系统已经记下的结果：Gmail 拒绝、发送失败、人工确认退信，以及邮件同步里的退信报告。不判断对方垃圾箱，也没有打开率或点击率。</p>
        <div class="tblwrap"><table class="mini"><thead><tr><th>时间</th><th>客户</th><th>对方邮箱</th><th>情况</th><th>简要原因</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${esc(r.when ? new Date(r.when).toLocaleString('zh-CN') : '—')}</td><td>${r.client_id ? `<a href="#/client/${esc(r.client_id)}">${esc(r.company)}</a>` : esc(r.company)}</td><td>${esc(r.who || '')}</td><td>${esc(labels[r.kind] || r.kind)} · ${esc(r.source)}</td><td>${esc(r.reason)} <button class="ghost sm" data-health="${i}">原文</button></td></tr>`).join('') || '<tr><td colspan="5">最近没有退信或发送失败。</td></tr>'}
        </tbody></table></div></section>
      <section class="card pad"><h2>发送节奏</h2><p>过去24小时你已尝试 ${tried} 封。${esc(limit)}。每个邮箱每分钟最多 1 封；这是人工掌握的节奏，不是自动群发序列。</p>
        ${cap && today.attempts >= cap ? `<p class="warn">今天已尝试 ${today.attempts} 封，达到你记下的 ${cap} 封。可以先停一下，明天再发。</p>` : ''}
        ${today.attempts >= 40 ? `<p class="warn">今天尝试已有 ${today.attempts} 封。先看退信和失败，再决定要不要继续。</p>` : ''}
        <div class="spark" aria-label="最近7天尝试量">${pace.map(d => `<div title="${esc(d.date)}：尝试 ${d.attempts}，接受 ${d.accepted}，失败或待核实 ${d.failed}"><i style="height:${Math.max(2, d.attempts / max * 100)}%"></i><small>${esc(d.date.slice(8))}</small></div>`).join('')}</div>
        <div class="tblwrap"><table class="mini"><thead><tr><th>日期（北京时间）</th><th>尝试</th><th>Gmail已接受 / 后退信</th><th>失败或待核实</th></tr></thead><tbody>
        ${pace.map(d => `<tr><td>${esc(d.date)}</td><td>${d.attempts}</td><td>${d.accepted}</td><td>${d.failed}</td></tr>`).join('')}</tbody></table></div>
        <form id="paceCap" class="inl"><label>我今天打算最多尝试<input name="cap" type="number" min="1" max="400" value="${cap || ''}" placeholder="例如 20"></label><button class="primary sm">记住这个节奏</button><button class="ghost sm" type="button" id="paceClear">清除</button></form>
        <p class="muted small">这个数字只保存在你的浏览器里，用来提醒自己。它不会改系统额度，也不会自动停止已经排队的邮件。老板仍在邮件中心设置每个账号的 24 小时上限。</p>
        ${UI.ME.role === 'admin' ? teamTable(messages) : ''}</section>
      ${explain(unsubs)}`, 'mail');
    $('#healthReload').onclick = () => render();
    $$('[data-health]').forEach(b => b.onclick = () => { const r = rows[Number(b.dataset.health)]; UI.modal(`<h2>${esc(labels[r.kind] || r.kind)}</h2><p>${esc(r.who || '')} · ${esc(r.reason)}</p><pre class="tbody">${esc(r.detail || '没有更多原文')}</pre><p><a href="#/inbound">去审查同步来信</a></p>`); });
    const form = $('#paceCap');
    form.onsubmit = e => { e.preventDefault(); const n = Number(form.cap.value); if (!Number.isInteger(n) || n < 1 || n > 400) return UI.toast('请填写 1 到 400 的整数', 1); localStorage.setItem(paceKey(), String(n)); UI.toast('已记住今天的节奏'); render(); };
    $('#paceClear').onclick = () => { localStorage.removeItem(paceKey()); render(); };
  }
  function teamTable(messages) {
    const since = Date.now() - 7 * 86400000;
    return `<h3>团队最近7天</h3><table class="mini"><thead><tr><th>业务员</th><th>尝试</th><th>失败或待核实</th></tr></thead><tbody>${UI.USERS.map(u => {
      const rows = messages.filter(m => m.sender_id === u.id && Date.parse(m.attempted_at || '') >= since);
      return `<tr><td>${esc(u.full_name)}</td><td>${rows.length}</td><td>${rows.filter(m => m.status === 'failed' || m.status === 'unknown').length}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function explain(unsubs) {
    const list = Array.isArray(unsubs) ? unsubs : [];
    return `<section class="card pad"><h2>退订</h2><p>每封开发信发出时，系统在正文末尾附上退订链接。链接打开本站的 <a href="unsubscribe.html" target="_blank" rel="noopener noreferrer">unsubscribe.html</a>。收件人确认后，这个邮箱写入停发名单。邮件里的一键退订（List-Unsubscribe）同样有效。只是被邮箱扫描器打开链接，不会退订。</p>
      <p>停发名单会挡住后续队列和自动计划。业务员确认退信，或客户要求停止联系，也走同一份名单。下面能看到的，是你发出过的地址、你负责的客户；老板可以看到全部。</p>
      <p class="muted small">没有邮件里的口令时，退订页会提示链接无效，不会把任何人退订。</p>
      ${list.length ? `<div class="tblwrap"><table class="mini"><thead><tr><th>时间</th><th>邮箱</th><th>原因</th><th>客户</th></tr></thead><tbody>${list.map(r => `<tr><td>${esc(r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '')}</td><td>${esc(r.email)}</td><td>${esc(r.reason)}</td><td>${r.client_id ? `<a href="#/client/${esc(r.client_id)}">${esc(r.company_name || '客户')}</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p>当前没有你能查看的退订或停发记录。</p>'}</section>`;
  }
  UI.views['mail-health'] = { render };
})();
