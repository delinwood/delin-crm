(function () {
  const { esc, opt, $, $$ } = UI;
  const labels = { queued: '待发送', sending: '正在发送', sent: 'Gmail已接受', failed: '发送失败', unknown: '状态待核实', skipped: '已跳过', cancelled: '已取消', bounced: '已确认退信' };
  let chosen = [], draftInput = null, approved = null, requestID = null, busy = false, refreshTimer = null;
  let selectedLimitUser = null;
  const limitLabel = value => value === 0 ? '不设系统每日上限' : `${value} 封/过去24小时`;
  const localDateTime = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
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
  const deliveryReport = report => `<section class="card pad"><h3>发信前检查</h3><p>${report.blocked ? `${report.blocked} 家存在必须修复的问题` : '未发现程序可识别的阻断问题'} · ${report.warnings} 家有内容提醒</p><p class="muted small">这是内容规则检查，不是垃圾邮件评分，不验证邮箱存在或采购意愿，也不能预测收件箱结果。请只联系匹配且有适用联系依据的客户。</p>${report.notes.map(n => `<p class="warn">${esc(n)}</p>`).join('')}${report.customers.filter(m => m.drafts.some(d => d.issues.length)).map(m => `<details><summary>${esc(m.company_name)}：查看提醒</summary>${m.drafts.map(d => d.issues.length ? `<p><b>${d.round === 0 ? '首封' : `跟进${d.round}`}</b></p><ul>${d.issues.map(x => `<li>${x.level === 'block' ? '必须修复：' : '建议：'}${esc(x.text)}</li>`).join('')}</ul>` : '').join('')}</details>`).join('')}</section>`;
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
      ${account?.connected ? `<p>发件邮箱：<b>${esc(account.email)}</b> · ${limitLabel(account.daily_limit)}</p>` : `<div class="warn">${esc(error || '请先连接Gmail')} <a href="#/mail">连接邮箱 ›</a></div>`}
      <form id="mailDraft"><label>邮件模板<select name="template">${opt('', '自动生成：按公司、产品和客户类型个性化', '')}${templates.map(t => opt(t.id, t.name, '')).join('')}${opt('_custom', '自定义模板（支持合并字段）', '')}</select></label>
      <div id="mailCustom" hidden><label>标题<input name="subject" maxlength="250" placeholder="Supply enquiry for {{company}}"></label><label>正文<textarea name="body" rows="12" placeholder="Hi {{contact_first}}, ... {{products}}"></textarea></label><p class="muted small">可用字段：{{company}} {{contact_first}} {{contact_name}} {{country}} {{city}} {{products}} {{customer_type}} {{my_name}} {{my_title}} {{my_company}} {{my_email}} {{my_whatsapp}} {{my_website}} {{moq}}</p></div>
      <p class="muted small">产品资料为空时会询问采购品类，不会声称客户销售某种产品。只使用结构化客户字段；不会自动把未核实备注写入邮件。邮件末尾自动附退订链接。</p>
      <h3>发送时间与自动跟进</h3><div class="grid2"><label>首次发送<select name="timing"><option value="now">现在</option><option value="delay">几天后</option><option value="date">指定日期时间</option></select></label>
      <label id="mailDelay" hidden>延后天数<input name="delay_days" type="number" min="0" max="365" value="3"></label><label id="mailDate" hidden>首次时间（本机时区）<input name="start_at" type="datetime-local" value="${localDateTime(new Date(Date.now()+86400000))}"></label>
      <label>重复发送<select name="interval_days"><option value="">仅发送一次</option><option value="3">每3天发送一次</option><option value="7">每7天发送一次</option></select></label></div>
      <div id="mailRepeat" hidden><label>共发送几轮（含首封）<input name="max_sends" type="number" min="1" max="100" value="3"></label><label class="inl"><input type="checkbox" name="forever">持续循环，直到我暂停或停止</label>
      <p class="muted small">每位客户按上封成功发送后的3天或7天计时。首封使用所选模板，后续使用公司/联系人/产品个性化跟进内容；第三轮后交替使用两封跟进正文。确认前可预览全部不同正文。客户回复后请点击“已回复，停止”；本系统不读取收件箱。</p></div>
      <label class="inl"><input type="checkbox" name="permission" required> 我已核实客户适合本次商务联系，并有适用的联系依据</label>
      <button class="primary" ${!account?.connected ? 'disabled' : ''}>生成并预览全部邮件</button></form></section><section id="mailPreview"></section>`, 'mail');
    const form = $('#mailDraft');
    const updateTiming = () => { $('#mailDelay').hidden = form.timing.value !== 'delay'; $('#mailDate').hidden = form.timing.value !== 'date'; $('#mailRepeat').hidden = !form.interval_days.value; form.max_sends.disabled = form.forever.checked; };
    form.timing.onchange = updateTiming; form.interval_days.onchange = updateTiming; form.forever.onchange = updateTiming;
    form.template.onchange = () => { $('#mailCustom').hidden = form.template.value !== '_custom'; approved = null; $('#mailPreview').innerHTML = ''; };
    form.oninput = () => { approved = null; $('#mailPreview').innerHTML = ''; };
    form.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      busy = true; const btn = form.querySelector('button'); btn.disabled = true;
      try {
        draftInput = { ids: chosen, template_id: form.template.value && form.template.value !== '_custom' ? form.template.value : null };
        if (form.template.value === '_custom') draftInput.custom = { subject: form.subject.value, body: form.body.value };
        if (form.timing.value !== 'now' || form.interval_days.value) {
          let start = new Date(Date.now()+60000);
          if (form.timing.value === 'date') start = new Date(form.start_at.value);
          if (form.timing.value === 'delay') {
            const days = Number(form.delay_days.value);
            if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('延后天数须为0至365的整数');
            start.setDate(start.getDate()+days);
          }
          if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now()) throw new Error('请选择未来的发送时间');
          draftInput.schedule = { start_at: start.toISOString(), interval_days: form.interval_days.value ? Number(form.interval_days.value) : null, max_sends: form.interval_days.value ? (form.forever.checked ? 0 : Number(form.max_sends.value)) : 1 };
        }
        approved = await api('preview', draftInput); requestID = crypto.randomUUID();
        $('#mailPreview').innerHTML = `<section class="card pad"><h2>待发送 ${approved.ready.length} 封 · 跳过 ${approved.skipped.length} 家</h2>
          ${deliveryReport(CRM_MAIL.deliveryBatch(approved.ready, approved.schedule))}
          ${approved.skipped.length ? `<details><summary>查看跳过原因</summary>${approved.skipped.map(c => `<p>${esc(c.company_name)}：${esc(c.reason)}</p>`).join('')}</details>` : ''}
          <p>${approved.schedule ? `首次：${esc(new Date(approved.schedule.start_at).toLocaleString('zh-CN'))}；${approved.schedule.interval_days ? `之后每${approved.schedule.interval_days}天，${approved.schedule.max_sends === 0 ? '持续循环直到手动停止' : `共${approved.schedule.max_sends}轮（含首封）`}` : '仅一次'}。关闭网页仍会运行。` : '提交后进入后台队列。'} 每个邮箱每分钟最多1封，达到所设额度后等待恢复。</p>
          ${approved.ready.map((m, i) => `<details class="mail-preview"><summary>${i + 1}. ${esc(m.company_name)} · ${esc(m.recipient)}</summary>${(m.drafts || [m]).map((d,j) => `<h3>${j === 0 ? '首封' : `跟进正文${j}`}</h3><b>${esc(d.subject)}</b><pre class="tbody">${esc(d.body)}</pre>`).join('')}<small>发送时自动附退订链接；客户资料改变时暂停并要求重新检查。</small></details>`).join('')}
          <label class="inl"><input type="checkbox" id="mailReviewed"> 我已检查所有正文、收件人和发送计划，确认执行</label><button class="primary" id="mailSubmit" ${!approved.ready.length ? 'disabled' : ''}>${approved.schedule ? '确认创建自动计划' : `确认发送 ${approved.ready.length} 封`}</button><p id="mailResult" role="status"></p></section>`;
        $('#mailSubmit').onclick = submit;
      } catch (e) { UI.toast(e.message, 1); }
      finally { busy = false; btn.disabled = false; }
    };
  }
  async function submit() {
    if (busy || !approved || !$('#mailReviewed')?.checked) return UI.toast('请先检查并勾选确认', 1);
    if (CRM_MAIL.deliveryBatch(approved.ready, approved.schedule).blocked) return UI.toast('请修复邮件检查发现的问题后重新预览', 1);
    const snapshot = approved; busy = true; $('#mailSubmit').disabled = true;
    try {
      const result = await api('enqueue', { ...draftInput, id: requestID, confirmed: true, digest: await digest(snapshot.schedule ? { ready: snapshot.ready, schedule: snapshot.schedule } : snapshot.ready), name: `客户开发 ${UI.today()}` });
      chosen = []; approved = null; location.hash = '#/mail'; UI.toast(result.scheduled ? '自动计划已保存，到时在后台执行' : '已加入发送队列；可在邮件中心查看进度');
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
    let account = null, messages = [], campaigns = [], plans = [], limits = [], error = '', limitDirty = false;
    try {
      const status = await api('status'); account = status.account; limits = status.limits || [];
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const since = new Date(Math.min(start.getTime(), Date.now() - 86400000)).toISOString();
      [messages, campaigns, plans] = await Promise.all([
        allRows('mail_messages', q => q.select('*').or(`created_at.gte.${since},attempted_at.gte.${since},sent_at.gte.${since},status.in.(queued,sending)`).order('created_at', { ascending: false }).order('id')),
        DB.t('mail_campaigns').select('*').order('created_at', { ascending: false }).limit(100).then(r => DB.chk(r)),
        allRows('mail_plans', q => q.select('*').or(`status.in.(running,paused),created_at.gte.${new Date(Date.now()-30*86400000).toISOString()}`).order('created_at',{ascending:false}).order('id'))
      ]);
    } catch (e) { error = e.message; }
    if (location.hash !== '#/mail') return;
    const date = d => d ? new Date(d).toLocaleDateString('sv-SE') : '';
    const today = messages.filter(m => date(m.sent_at) === UI.today());
    const mine = messages.filter(m => m.sender_id === UI.ME.id && Date.parse(m.attempted_at || '') > Date.now() - 86400000).length;
    const isAdmin = UI.ME.role === 'admin';
    selectedLimitUser ||= UI.ME.id;
    UI.render(`<div class="pagehead"><h1>邮件中心</h1><div class="actions"><button class="ghost" id="mailRefresh">刷新</button><a class="btn ghost" href="#/inbound">客户回复 / 退信同步</a><a class="btn primary" href="#/list">选择客户写邮件</a></div></div>
      ${error ? `<div class="warn">${esc(error)}。配置完成后才可发信。</div>` : ''}
      <section class="card pad"><h2>我的发件邮箱</h2><p>${account?.connected ? `已连接：<b>${esc(account.email)}</b> <button class="ghost sm" id="mailDisconnect">断开连接</button>` : '<button class="primary" id="mailConnect">连接 Gmail</button>'} · <a href="#/me">修改工作邮箱和签名</a></p>
      <p>系统过去24小时已尝试 ${mine} 封${account ? `，${limitLabel(account.daily_limit)}${account.daily_limit === 0 ? '' : `，剩余 ${Math.max(0, account.daily_limit - mine)} 封`}` : ''}。不设系统每日上限仍保留每分钟1封的节奏；Gmail网页、手机等其他渠道发送的邮件不计入这里，Google可能提前限发。</p>
      <p class="muted small">${account?.read_enabled ? '已开启关联来信同步，可在“客户回复 / 退信同步”查看和审查；不会读取并保存所有邮箱正文，无法判断对方垃圾箱落点。' : '当前未开启邮件读取，不会自动同步回复或识别退信。可在“客户回复 / 退信同步”查看启用条件，现有发信权限不受影响；收到退信后仍可在记录中人工标记。'}</p></section>
      <section class="card pad"><h2>投递保护</h2><p>已启用：发信前内容检查、每分钟最多1封、24小时去重、退订链接、已确认退信停发、Google限发后暂停。纯文本发送，不添加追踪像素。</p><p class="muted small">以上不能保证进入收件箱。这里只显示 Gmail 是否接受邮件，不显示对方垃圾箱或投诉率。收到退信请在发送记录中标记；客户拒绝或回复后请停止循环联系。使用 @gmail.com 时身份认证由 Google 发信服务处理；公司域名邮箱需另行核实 SPF、DKIM、DMARC。</p><p><a href="https://support.google.com/mail/answer/81126?hl=zh-Hans" target="_blank" rel="noopener noreferrer">Google 官方发件人指南</a></p></section>
      <section class="kpis">${[['今日已发送（邮箱已接受）', today.length], ['待发送', messages.filter(m => m.status === 'queued').length], ['发送中', messages.filter(m => m.status === 'sending').length], ['今日尝试中失败/待核实', messages.filter(m => date(m.attempted_at) === UI.today() && ['failed','unknown'].includes(m.status)).length]].map(([label, n]) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`).join('')}</section>
      ${isAdmin ? `<section class="card pad"><h2>今日团队统计</h2><table class="mini"><thead><tr><th>业务员</th><th>今日已发送</th><th>今日失败</th><th>今日待核实</th></tr></thead><tbody>${UI.USERS.map(u => `<tr><td>${esc(u.full_name)}</td><td>${today.filter(m => m.sender_id === u.id).length}</td><td>${messages.filter(m => m.sender_id === u.id && date(m.attempted_at) === UI.today() && m.status === 'failed').length}</td><td>${messages.filter(m => m.sender_id === u.id && date(m.attempted_at) === UI.today() && m.status === 'unknown').length}</td></tr>`).join('')}</tbody></table><h3>老板设置每日额度</h3><form id="mailLimit" class="inl"><label>账号<select name="user">${UI.USERS.filter(u => u.active).map(u => opt(u.id, u.full_name, selectedLimitUser)).join('')}</select></label><label>模式<select name="mode"><option value="limited">自定义限额</option><option value="unlimited">不设系统每日上限</option></select></label><label>过去24小时上限<input name="limit" type="number" min="1" max="2147483647" required></label><button class="primary sm">保存设置</button><span id="mailLimitState" role="status"></span></form><p class="muted small">修改后点击“保存设置”。每个账号独立保存，未连接邮箱的账号也可预先设置。单批仍最多400封；Gmail限额不会被取消。</p></section>` : ''}
      <section class="card pad"><h2>定时与循环邮件 <small>${plans.length} 位客户的计划</small></h2><p class="muted small">间隔从上封实际发送成功时计算。客户回复后请停止后续计划；无效、退订或退信客户不再继续。</p><div class="tblwrap"><table class="mini"><thead><tr><th>客户 / 发件人</th><th>状态</th><th>下次时间</th><th>间隔 / 已发轮数</th><th>操作</th></tr></thead><tbody>${plans.map(p => `<tr><td>${esc(p.company_name)}<br><small>${esc(p.recipient)} · ${esc(UI.userName(p.sender_id))}</small></td><td>${{running:'运行中',paused:'已暂停',stopped:'已停止',completed:'已完成'}[p.status]}<p class="muted small">${esc(p.last_error || '')}</p></td><td>${['running','paused'].includes(p.status) ? esc(new Date(p.next_run_at).toLocaleString('zh-CN')) : '—'}</td><td>${p.interval_days ? `每${p.interval_days}天` : '仅一次'} · ${p.sent_count}/${p.max_sends || '持续'}</td><td><button class="ghost sm" data-plan-preview="${esc(p.id)}">正文</button>${['running','paused'].includes(p.status) ? `<button class="ghost sm" data-plan="${esc(p.id)}" data-state="${p.status === 'running' ? 'paused' : 'running'}">${p.status === 'running' ? '暂停' : '继续'}</button><button class="ghost sm" data-plan="${esc(p.id)}" data-state="stopped">停止 / 已回复</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">暂无自动计划。勾选客户后，在发送邮件页面设置时间与间隔。</td></tr>'}</tbody></table></div></section>
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
    $$('[data-plan-preview]').forEach(b => b.onclick = () => { const p = plans.find(p => p.id === b.dataset.planPreview); UI.modal(`<h2>${esc(p.company_name)}的自动邮件</h2>${p.drafts.map((d,i) => `<h3>${i === 0 ? '首封' : `跟进正文${i}`}</h3><b>${esc(d.subject)}</b><pre class="tbody">${esc(d.body)}</pre>`).join('')}`); });
    $$('[data-plan]').forEach(b => b.onclick = async () => { if (b.dataset.state === 'stopped' && !confirm('停止该客户的后续自动邮件？已提交给Gmail的邮件无法撤回。')) return; try { await api('plan', { id: b.dataset.plan, status: b.dataset.state }); await center(); } catch (e) { UI.toast(e.message,1); } });
    if ($('#mailLimit')) {
      const form = $('#mailLimit'), note = $('#mailLimitState');
      const setMode = () => { form.limit.disabled = form.mode.value === 'unlimited'; };
      const load = () => { selectedLimitUser = form.user.value; const value = limits.find(x => x.user_id === form.user.value)?.daily_limit ?? 50; form.mode.value = value === 0 ? 'unlimited' : 'limited'; form.limit.value = value || 400; setMode(); limitDirty = false; note.textContent = `已保存：${limitLabel(value)}`; };
      load(); form.user.onchange = load;
      form.oninput = () => { limitDirty = true; note.textContent = '尚未保存'; setMode(); };
      form.onsubmit = async e => { e.preventDefault(); const btn = form.querySelector('button'); btn.disabled = true; try { const value = form.mode.value === 'unlimited' ? 0 : Number(form.limit.value); const r = await api('limit', { user_id: form.user.value, limit: value }); if (r.daily_limit !== value) throw new Error('服务器未确认保存，请刷新核对'); limitDirty = false; UI.toast(`已保存：${limitLabel(r.daily_limit)}`); await center(); } catch (e) { note.textContent = e.message; UI.toast(e.message,1); btn.disabled = false; } };
    }
    $('#mailExport').onclick = () => {
      const quote = s => '"' + String(s ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
      const rows = [['客户','业务员','收件人','标题','状态','发送时间','错误'], ...messages.map(m => [m.company_name, UI.userName(m.sender_id), m.recipient, m.subject, labels[m.status], m.sent_at, m.error])];
      UI.download(`邮件记录_${UI.today()}.csv`, new Blob(['\ufeff' + rows.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    };
    // Refresh while this view is open, without stealing focus from controls/dialogs.
    const refresh = () => { if (location.hash !== '#/mail') return; if (!document.hidden && !limitDirty && !document.querySelector('.modal') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) center(); else refreshTimer = setTimeout(refresh,30000); };
    refreshTimer = setTimeout(refresh,30000);
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
