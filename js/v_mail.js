(function () {
  const { esc, opt, $, $$ } = UI;
  const labels = { queued: '待发送', sending: '正在发送', sent: 'Gmail已接受', failed: '发送失败', unknown: '状态待核实', skipped: '已跳过', cancelled: '已取消', bounced: '已确认退信' };
  let chosen = [], draftInput = null, approved = null, requestID = null, busy = false, refreshTimer = null;
  const api = async (action, data = {}) => {
    if (DB.mode === 'demo') throw new Error('演示模式不发送真实邮件，请使用正式系统');
    const r = await DB.init().functions.invoke('crm-mail', { body: { action, ...data } });
    if (r.error) {
      let message = '邮件服务尚未配置或暂不可用';
      try { message = (await r.error.context.json()).error || message; } catch { /* Do not claim sent. */ }
      throw new Error(message);
    }
    if (r.data?.error) throw new Error(r.data.error);
    return r.data;
  };
  const digest = async v => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  UI.mailCompose = ids => { chosen = [...new Set(ids)]; approved = null; draftInput = null; requestID = null; location.hash = '#/mail-compose'; };
  async function compose() {
    if (chosen.length > 400) { UI.toast('单次最多400封，请减少勾选客户', 1); location.hash = '#/list'; return; }
    if (!chosen.length) { location.hash = '#/list'; UI.toast('请先在客户列表勾选客户'); return; }
    const templates = (await DB.listTemplates()).filter(t => t.channel === 'email');
    let account = null, error = '';
    try { account = (await api('status')).account; } catch (e) { error = e.message; }
    UI.render(`<div class="pagehead"><h1>${chosen.length === 1 ? '发送邮件' : '批量个性化邮件'}</h1><a class="btn ghost" href="#/mail">邮件中心</a></div>
      <section class="card pad"><p>已选 ${chosen.length} 家客户 · 单次最多400封 · 每位客户单独收信</p>
      ${account?.connected ? `<p>发件邮箱：<b>${esc(account.email)}</b> · 系统24小时上限 ${account.daily_limit} 封</p>` : `<div class="warn">${esc(error || '请先连接Gmail')} <a href="#/mail">连接邮箱 ›</a></div>`}
      <form id="mailDraft"><label>邮件模板<select name="template">${opt('', '自动生成：按公司、产品和客户类型个性化', '')}${templates.map(t => opt(t.id, t.name, '')).join('')}${opt('_custom', '自定义模板（支持合并字段）', '')}</select></label>
      <div id="mailCustom" hidden><label>标题<input name="subject" maxlength="250" placeholder="Supply enquiry for {{company}}"></label><label>正文<textarea name="body" rows="12" placeholder="Hi {{contact_first}}, ... {{products}}"></textarea></label><p class="muted small">可用字段：{{company}} {{contact_first}} {{contact_name}} {{country}} {{city}} {{products}} {{customer_type}} {{my_name}} {{my_title}} {{my_company}} {{my_email}} {{my_whatsapp}} {{my_website}} {{moq}}</p></div>
      <p class="muted small">产品资料为空时会询问采购品类，不会声称客户销售某种产品。只使用结构化客户字段；不会自动把未核实备注写入邮件。邮件末尾自动附退订链接。</p>
      <label class="inl"><input type="checkbox" name="permission" required> 我已核实客户适合本次商务联系，并有适用的联系依据</label>
      <button class="primary" ${!account?.connected ? 'disabled' : ''}>生成并预览全部邮件</button></form></section><section id="mailPreview"></section>`, 'mail');
    const form = $('#mailDraft');
    form.template.onchange = () => { $('#mailCustom').hidden = form.template.value !== '_custom'; approved = null; $('#mailPreview').innerHTML = ''; };
    form.oninput = () => { approved = null; $('#mailPreview').innerHTML = ''; };
    form.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      busy = true; const btn = form.querySelector('button'); btn.disabled = true;
      try {
        draftInput = { ids: chosen, template_id: form.template.value && form.template.value !== '_custom' ? form.template.value : null };
        if (form.template.value === '_custom') draftInput.custom = { subject: form.subject.value, body: form.body.value };
        approved = await api('preview', draftInput); requestID = crypto.randomUUID();
        $('#mailPreview').innerHTML = `<section class="card pad"><h2>待发送 ${approved.ready.length} 封 · 跳过 ${approved.skipped.length} 家</h2>
          ${approved.skipped.length ? `<details><summary>查看跳过原因</summary>${approved.skipped.map(c => `<p>${esc(c.company_name)}：${esc(c.reason)}</p>`).join('')}</details>` : ''}
          <p>请展开检查邮件。提交后进入后台队列，默认每个邮箱每分钟最多1封，达到24小时额度后等待恢复。</p>
          ${approved.ready.map((m, i) => `<details class="mail-preview"><summary>${i + 1}. ${esc(m.company_name)} · ${esc(m.recipient)}</summary><b>${esc(m.subject)}</b><pre class="tbody">${esc(m.body)}</pre><small>发送时自动附退订链接</small></details>`).join('')}
          <label class="inl"><input type="checkbox" id="mailReviewed"> 我已检查邮件内容和收件人，确认发送</label><button class="primary" id="mailSubmit" ${!approved.ready.length ? 'disabled' : ''}>确认发送 ${approved.ready.length} 封</button><p id="mailResult" role="status"></p></section>`;
        $('#mailSubmit').onclick = submit;
      } catch (e) { UI.toast(e.message, 1); }
      finally { busy = false; btn.disabled = false; }
    };
  }
  async function submit() {
    if (busy || !approved || !$('#mailReviewed')?.checked) return UI.toast('请先检查并勾选确认', 1);
    const snapshot = approved; busy = true; $('#mailSubmit').disabled = true;
    try {
      const result = await api('enqueue', { ...draftInput, id: requestID, confirmed: true, digest: await digest(snapshot.ready), name: `客户开发 ${UI.today()}` });
      chosen = []; approved = null; location.hash = '#/mail'; UI.toast('已加入发送队列；可在邮件中心查看进度');
    } catch (e) { $('#mailResult').textContent = e.message; $('#mailSubmit').disabled = false; }
    finally { busy = false; }
  }
  async function allRows(table, query) {
    const out = [];
    for (let start = 0; ; start += 1000) {
      const rows = DB.chk(await query(DB.t(table)).range(start, start + 999)); out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }
  async function center() {
    clearTimeout(refreshTimer);
    let account = null, messages = [], campaigns = [], error = '';
    try {
      account = (await api('status')).account;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const since = new Date(Math.min(start.getTime(), Date.now() - 86400000)).toISOString();
      [messages, campaigns] = await Promise.all([
        allRows('mail_messages', q => q.select('*').or(`created_at.gte.${since},attempted_at.gte.${since},sent_at.gte.${since},status.in.(queued,sending)`).order('created_at', { ascending: false }).order('id')),
        DB.t('mail_campaigns').select('*').order('created_at', { ascending: false }).limit(100).then(r => DB.chk(r))
      ]);
    } catch (e) { error = e.message; }
    const date = d => d ? new Date(d).toLocaleDateString('sv-SE') : '';
    const today = messages.filter(m => date(m.sent_at) === UI.today());
    const mine = messages.filter(m => m.sender_id === UI.ME.id && Date.parse(m.attempted_at || '') > Date.now() - 86400000).length;
    const isAdmin = UI.ME.role === 'admin';
    UI.render(`<div class="pagehead"><h1>邮件中心</h1><div class="actions"><button class="ghost" id="mailRefresh">刷新</button><a class="btn primary" href="#/list">选择客户写邮件</a></div></div>
      ${error ? `<div class="warn">${esc(error)}。配置完成后才可发信。</div>` : ''}
      <section class="card pad"><h2>我的发件邮箱</h2><p>${account?.connected ? `已连接：<b>${esc(account.email)}</b> <button class="ghost sm" id="mailDisconnect">断开连接</button>` : '<button class="primary" id="mailConnect">连接 Gmail</button>'} · <a href="#/me">修改工作邮箱和签名</a></p>
      <p>系统过去24小时已尝试 ${mine} 封${account ? `，系统上限 ${account.daily_limit} 封，剩余 ${Math.max(0, account.daily_limit - mine)} 封` : ''}。Gmail网页、手机等其他渠道发送的邮件不计入这里，Google可能提前限发。</p>
      <p class="muted small">连接时只请求邮箱身份和发信权限。此版本不读取收件箱，回复、垃圾箱落点和退信不能自动识别；收到退信后可在记录中标记。</p></section>
      <section class="kpis">${[['今日已发送（邮箱已接受）', today.length], ['待发送', messages.filter(m => m.status === 'queued').length], ['发送中', messages.filter(m => m.status === 'sending').length], ['今日尝试中失败/待核实', messages.filter(m => date(m.attempted_at) === UI.today() && ['failed','unknown'].includes(m.status)).length]].map(([label, n]) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`).join('')}</section>
      ${isAdmin ? `<section class="card pad"><h2>今日团队统计</h2><table class="mini"><thead><tr><th>业务员</th><th>今日已发送</th><th>今日失败</th><th>今日待核实</th></tr></thead><tbody>${UI.USERS.map(u => `<tr><td>${esc(u.full_name)}</td><td>${today.filter(m => m.sender_id === u.id).length}</td><td>${messages.filter(m => m.sender_id === u.id && date(m.attempted_at) === UI.today() && m.status === 'failed').length}</td><td>${messages.filter(m => m.sender_id === u.id && date(m.attempted_at) === UI.today() && m.status === 'unknown').length}</td></tr>`).join('')}</tbody></table><form id="mailLimit" class="inl"><select name="user">${UI.USERS.filter(u => u.active).map(u => opt(u.id, u.full_name, UI.ME.id)).join('')}</select><label>24小时系统上限<input name="limit" type="number" min="1" max="400" value="50" required></label><button class="ghost sm">保存上限</button></form></section>` : ''}
      <section class="card pad"><h2>最近100个发送任务</h2>${campaigns.map(c => `<div class="mail-campaign"><span>${esc(c.name)} · ${esc(UI.userName(c.sender_id))} · ${{running:'运行中',paused:'已暂停',cancelled:'已取消',completed:'已完成'}[c.status]}</span>${['running','paused'].includes(c.status) ? ` <button class="ghost sm" data-campaign="${esc(c.id)}" data-state="${c.status === 'running' ? 'paused' : 'running'}">${c.status === 'running' ? '暂停' : '继续'}</button><button class="ghost sm" data-campaign="${esc(c.id)}" data-state="cancelled">取消待发送</button>` : ''}<button class="ghost sm" data-history="${esc(c.id)}">全部记录</button></div>`).join('') || '<p>暂无发送任务</p>'}<p class="muted small">暂停/取消会阻止后续邮件，已经提交给Gmail的邮件无法撤回。</p></section>
      <section class="card pad"><h2>近期发送记录 <small>当前显示 ${messages.length} 条</small></h2><button class="ghost sm" id="mailExport">导出当前记录 CSV</button><div class="tblwrap"><table class="mini"><thead><tr><th>客户</th><th>业务员</th><th>收件人</th><th>状态</th><th>发送时间</th><th>详情</th></tr></thead><tbody>${messages.map(m => `<tr><td>${esc(m.company_name)}</td><td>${esc(UI.userName(m.sender_id))}</td><td>${esc(m.recipient)}</td><td>${esc(labels[m.status])}<div class="muted small">${esc(m.error || '')}</div></td><td>${esc(m.sent_at ? new Date(m.sent_at).toLocaleString('zh-CN') : '—')}</td><td><button class="ghost sm" data-message="${esc(m.id)}">查看</button></td></tr>`).join('')}</tbody></table></div></section>`, 'mail');
    $('#mailRefresh').onclick = center;
    if ($('#mailConnect')) $('#mailConnect').onclick = async () => { try { const r = await api('connect'); location.assign(r.url); } catch (e) { UI.toast(e.message, 1); } };
    if ($('#mailDisconnect')) $('#mailDisconnect').onclick = async () => { if (confirm('断开发件邮箱并暂停当前任务？')) try { await api('disconnect'); await center(); } catch (e) { UI.toast(e.message, 1); } };
    $$('[data-campaign]').forEach(b => b.onclick = async () => { try { await api('campaign', { id: b.dataset.campaign, status: b.dataset.state }); await center(); } catch (e) { UI.toast(e.message, 1); } });
    const detail = m => UI.modal(`<h2>${esc(m.subject)}</h2><p>${esc(m.recipient)} · ${esc(labels[m.status])}</p><pre class="tbody">${esc(m.body)}</pre><p>${esc(m.error || '')}</p><button class="ghost" id="mailBounce">确认退信并停止联系</button> <button class="ghost" id="mailStop">客户要求停止联系</button>`, el => {
      const suppress = async reason => { if (!confirm('确认停止向该邮箱发送后续邮件？')) return; try { await api('suppress', { message_id: m.id, reason }); el.remove(); await center(); } catch (e) { UI.toast(e.message, 1); } };
      el.querySelector('#mailBounce').onclick = () => suppress('bounced'); el.querySelector('#mailStop').onclick = () => suppress('optout');
    });
    $$('[data-message]').forEach(b => b.onclick = () => detail(messages.find(m => m.id === b.dataset.message)));
    $$('[data-history]').forEach(b => b.onclick = async () => { try { const rows = await allRows('mail_messages', q => q.select('*').eq('campaign_id', b.dataset.history).order('created_at').order('id')); UI.modal(`<h2>任务全部记录</h2>${rows.map(m => `<details><summary>${esc(m.company_name)} · ${esc(labels[m.status])}</summary><b>${esc(m.subject)}</b><pre class="tbody">${esc(m.body)}</pre><p>${esc(m.error || '')}</p></details>`).join('')}`); } catch (e) { UI.toast(e.message, 1); } });
    if ($('#mailLimit')) $('#mailLimit').onsubmit = async e => { e.preventDefault(); try { await api('limit', { user_id: e.target.user.value, limit: Number(e.target.limit.value) }); UI.toast('已保存系统额度'); await center(); } catch (e) { UI.toast(e.message, 1); } };
    $('#mailExport').onclick = () => {
      const quote = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
      const rows = [['客户','业务员','收件人','标题','状态','发送时间','错误'], ...messages.map(m => [m.company_name, UI.userName(m.sender_id), m.recipient, m.subject, labels[m.status], m.sent_at, m.error])];
      UI.download(`邮件记录_${UI.today()}.csv`, new Blob(['\ufeff' + rows.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    };
    // Refresh while this view is open, without stealing focus from controls/dialogs.
    refreshTimer = setTimeout(() => { if (location.hash === '#/mail' && !document.hidden && !document.querySelector('.modal') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) center(); }, 30000);
  }
  UI.views.mail = { render: center };
  UI.views['mail-compose'] = { render: compose };
  const originalLogs = DB.listLogs.bind(DB);
  DB.listLogs = async cid => {
    const logs = await originalLogs(cid);
    if (DB.mode === 'demo') return logs;
    const r = await DB.t('mail_messages').select('id,sender_id,subject,body,sent_at,status').eq('client_id', cid).not('sent_at', 'is', null).order('sent_at', { ascending: false });
    if (r.error && ['42P01','PGRST205'].includes(r.error.code)) return logs;
    const sent = DB.chk(r).map(m => ({ id: m.id, channel: 'email', entry_date: new Date(m.sent_at).toLocaleDateString('sv-SE'), created_at: m.sent_at,
      author_name: UI.userName(m.sender_id), content: `[系统发送 · ${labels[m.status]}] ${m.subject}\n${m.body}` }));
    return [...logs, ...sent].sort((a, b) => (b.entry_date + b.created_at).localeCompare(a.entry_date + a.created_at));
  };
})();
