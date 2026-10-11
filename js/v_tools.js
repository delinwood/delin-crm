(function () {
  const { esc, opt, $, $$ } = UI;
  const cfg = window.CRM_CONFIG;

  // ---------------- TEMPLATES ----------------
  const TS = { channel: 'email', stage: '', client: '' };
  function merge(text, c, me) {
    const prods = (c.products || []).filter(p => !(c.country === 'USA' && C.US_EXCLUDED.includes(p))).map(C.productEN);
    const first = (c.contact_name || '').trim().split(/\s+/)[0];
    const map = { company: c.company_name || '[Company]', contact_first: first || 'there', country: ({ USA: 'the USA', 'United Kingdom': 'the UK', Netherlands: 'the Netherlands', 'United Arab Emirates': 'the UAE', Philippines: 'the Philippines', Czechia: 'the Czech Republic' })[c.country] || c.country || '[Country]',
      products: prods.length ? (prods.length > 2 ? prods.slice(0, 2).join(', ') + ' and more' : prods.join(' and ')) : 'SPC flooring and wall panels', moq: C.MOQ,
      my_name: me.name_en || me.full_name, my_title: me.title_en || 'Sales Manager', my_company: cfg.COMPANY_NAME_EN, my_email: me.work_email || '[your email]',
      my_whatsapp: me.whatsapp || '[your WhatsApp]', my_website: cfg.COMPANY_WEBSITE || '' };
    return (text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => k in map ? map[k] : m);
  }
  async function templates(cid) {
    if (cid) TS.client = cid;
    const all = await DB.listTemplates(), me = UI.ME, admin = me.role === 'admin';
    const c = UI.CLIENTS.find(x => x.id === TS.client) || {};
    const list = all.filter(t => (!TS.channel || t.channel === TS.channel) && (!TS.stage || t.stage === TS.stage));
    const missing = [!me.name_en && '英文名', !me.work_email && '工作邮箱', !me.whatsapp && 'WhatsApp'].filter(Boolean);
    const mine = UI.CLIENTS.filter(x => x.status !== '无效').sort((a, b) => a.company_name.localeCompare(b.company_name));
    UI.render(`<div class="pagehead"><h1>开发信模板 <small>Outreach templates — 业务员自己发送</small></h1><div class="actions"><button class="primary" id="tnew">+ 新模板</button></div></div>
      ${missing.length ? `<div class="info">✍️ 你的签名信息缺少：${missing.join('、')}。<a href="#/me">去补充 ›</a></div>` : ''}
      <section class="card pad filters"><label>客户 Client<select id="tc">${opt('', '（不选：显示占位符）', TS.client)}${mine.map(x => opt(x.id, x.company_name + ' · ' + (x.country || ''), TS.client)).join('')}</select></label>
        <label>渠道<select id="tch">${opt('', '全部', TS.channel)}${C.TPL_CHANNELS.map(x => opt(x[0], x[1], TS.channel)).join('')}</select></label>
        <label>阶段<select id="tst">${opt('', '全部', TS.stage)}${C.STAGES.map(x => opt(x[0], x[1], TS.stage)).join('')}</select></label>
        ${c.id ? `<div class="note">→ <a href="#/client/${esc(c.id)}">${esc(c.company_name)}</a> ${UI.stBadge(c.status)} ${UI.ltBadge(c)}<br><span class="muted small">产品：${esc((c.products || []).map(C.productName).join('、') || '—')} · 联系人：${esc(c.contact_name || '未知（用 "Hi there"）')}</span></div>` : ''}</section>
      <div class="tpls">${list.map(t => { const subj = merge(t.subject, c, me), body = merge(t.body, c, me);
        const mail = c.company_email ? `mailto:${c.company_email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}` : '';
        const wa = t.channel === 'whatsapp' && UI.wa(c.whatsapp || c.company_phone, c) ? UI.wa(c.whatsapp || c.company_phone, c) + '?text=' + encodeURIComponent(body) : '';
        return `<section class="card pad tpl"><div class="sec-h"><h3>${esc(t.name)} <span class="tag">${esc((C.TPL_CHANNELS.find(x => x[0] === t.channel) || [, t.channel])[1])}</span>${t.owner_id ? '<span class="tag">我的</span>' : '<span class="tag">公共</span>'}</h3>
          <div class="qa">${(!t.owner_id && !admin) ? '' : `<button class="ghost sm" data-ed="${esc(t.id)}">编辑</button><button class="ghost sm" data-del="${esc(t.id)}">删除</button>`}<button class="ghost sm" data-dup="${esc(t.id)}">另存为我的</button></div></div>
          ${t.subject ? `<div class="subj"><b>Subject:</b> ${esc(subj)} <button class="ghost sm" data-cp="s">复制标题</button></div>` : ''}<pre class="tbody">${esc(body)}</pre>
          <div class="qa"><button class="primary sm" data-cp="b">📋 复制正文 Copy</button>${mail ? `<a class="btn ghost sm" href="${esc(mail)}">✉️ 用邮箱打开</a>` : ''}${wa ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(wa)}">💬 WhatsApp 打开</a>` : ''}${t.channel === 'linkedin' && c.contact_linkedin ? UI.link(c.contact_linkedin, 'in 打开LinkedIn', 'btn ghost sm') : ''}${c.id ? `<button class="ghost sm" data-log="${esc(t.channel)}" data-name="${esc(t.name)}">✅ 已发送→记一笔跟进</button>` : ''}</div>
          ${t.channel === 'linkedin' ? `<p class="muted small">LinkedIn 邀请附言上限 300 字符：当前 ${body.length}${body.length > 300 && t.stage === 'first' ? ' ⚠️ 超长' : ''}</p>` : ''}</section>`; }).join('') || '<p class="muted">无模板</p>'}</div>
      <p class="muted small">合并字段 Merge fields：{{company}} {{contact_first}} {{country}} {{products}} {{moq}} {{my_name}} {{my_title}} {{my_company}} {{my_email}} {{my_whatsapp}} {{my_website}}。MOQ 默认 ${esc(C.MOQ)}（constants.js 可改）。美国客户自动不提强化/实木复合。</p>`, 'templates');
    $('#tc').onchange = e => { TS.client = e.target.value; templates(); }; $('#tch').onchange = e => { TS.channel = e.target.value; templates(); }; $('#tst').onchange = e => { TS.stage = e.target.value; templates(); };
    $$('.tpl').forEach((el, i) => { const t = list[i];
      el.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => UI.copy(b.dataset.cp === 's' ? merge(t.subject, c, me) : merge(t.body, c, me)));
      const lg = el.querySelector('[data-log]'); if (lg) lg.onclick = async () => { await DB.addLog(c.id, { entry_date: UI.today(), channel: t.channel, content: `已发送模板：${t.name}`, next_follow_up: UI.today(t.stage === 'first' ? 4 : 7) }); UI.toast('已记录跟进，下次跟进日已设定'); await UI.refresh(); };
      const ed = el.querySelector('[data-ed]'); if (ed) ed.onclick = () => editTpl(t);
      const dl = el.querySelector('[data-del]'); if (dl) dl.onclick = async () => { if (!confirm('删除模板？')) return; try { await DB.deleteTemplate(t.id); templates(); } catch (e) { UI.toast(e.message, 1); } };
      el.querySelector('[data-dup]').onclick = () => editTpl({ ...t, id: null, name: t.name + '（我的）', shared: false }); });
    $('#tnew').onclick = () => editTpl({ channel: TS.channel || 'email', stage: TS.stage || 'first', name: '', subject: '', body: '' });
  }
  function editTpl(t) {
    const admin = UI.ME.role === 'admin';
    UI.modal(`<h2>${t.id ? '编辑' : '新建'}模板</h2><form id="tf" class="g2"><label class="span2">名称<input name="name" value="${esc(t.name)}" required></label>
      <label>渠道<select name="channel">${C.TPL_CHANNELS.map(x => opt(x[0], x[1], t.channel)).join('')}</select></label><label>阶段<select name="stage">${C.STAGES.map(x => opt(x[0], x[1], t.stage)).join('')}</select></label>
      <label class="span2">邮件标题 Subject<input name="subject" value="${esc(t.subject || '')}"></label><label class="span2">正文 Body<textarea name="body" rows="14" required>${esc(t.body)}</textarea></label>
      ${admin && !t.id ? '<label class="inl span2"><input type="checkbox" name="shared" checked> 公共模板（全员可用）</label>' : ''}<div class="span2 right"><button class="primary">保存</button></div></form>`, m => {
      m.querySelector('#tf').onsubmit = async e => { e.preventDefault(); const f = e.target;
        try { await DB.saveTemplate({ id: t.id || undefined, name: f.name.value, channel: f.channel.value, stage: f.stage.value, subject: f.subject.value, body: f.body.value, shared: f.shared ? f.shared.checked : false }); m.remove(); UI.toast('已保存'); templates(); } catch (err) { UI.toast(err.message, 1); } }; });
  }

  // ---------------- MY PROFILE ----------------
  function me() {
    const u = UI.ME;
    UI.render(`<div class="pagehead"><h1>我的资料 <small>My profile — 用于开发信签名</small></h1></div>
      <section class="card pad narrow"><form id="mf" class="g2"><label>中文名 Name<input name="full_name" value="${esc(u.full_name)}" required></label><label>英文名 English name<input name="name_en" value="${esc(u.name_en || '')}" placeholder="e.g. Lily Zhang"></label>
        <label>英文职位 Title<input name="title_en" value="${esc(u.title_en || '')}" placeholder="Export Sales Manager"></label><label>工作邮箱 Work email<input name="work_email" type="email" value="${esc(u.work_email || '')}"></label>
        <label>WhatsApp（含国家码）<input name="whatsapp" value="${esc(u.whatsapp || '')}" placeholder="+86 138 0000 0000"></label><label>账号<input value="${esc(u.username)} · ${u.role === 'admin' ? '管理员' : '业务员'}" disabled></label>
        <div class="span2 right"><button class="primary">保存</button></div></form></section>`, 'me');
    $('#mf').onsubmit = async e => { e.preventDefault(); const f = e.target; try { UI.ME = { ...UI.ME, ...(await DB.updateMyProfile({ full_name: f.full_name.value, name_en: f.name_en.value, title_en: f.title_en.value, work_email: f.work_email.value, whatsapp: f.whatsapp.value })) }; UI.toast('已保存'); await UI.refresh(); } catch (err) { UI.toast(err.message, 1); } };
  }

  // ---------------- ADMIN ----------------
  function parseCSV(text) {
    const rows = [], s = text.replace(/^\ufeff/, ''); let row = [], cur = '', q = false;
    for (let i = 0; i < s.length; i++) { const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim()));
  }
  const IMPORT_FIELDS = C.FIELDS.filter(f => f[0] !== 'owner').concat([['owner', '负责业务员(用户名)', 'Owner username']]);
  const ALIASES = { company_name: ['company', 'name', 'companyname', 'organization', 'account'], company_phone: ['phone', 'tel', 'telephone'], company_email: ['email', 'e-mail', 'mail'], website: ['url', 'site', 'domain', 'web'], state: ['province', 'region'], contact_name: ['contact', 'contactperson'], contact_title: ['title', 'jobtitle'], contact_linkedin: ['linkedin', 'linkedinurl'], notes: ['note', 'remarks'], source_note: ['source', 'sourceurl'] };
  const norm = s => String(s || '').toLowerCase().replace(/[\s_\-/()（）:]/g, '');
  function guess(h) { const n = norm(h);
    for (const [k, cn, en] of IMPORT_FIELDS) if (n === norm(k) || n === norm(cn) || n === norm(en) || n === norm(cn + en) || n === norm(cn + ' ' + en)) return k;
    for (const [k, al] of Object.entries(ALIASES)) if (al.includes(n)) return k; return ''; }
  const prodKey = v => { const s = String(v).trim().toLowerCase(); if (!s) return null; const p = C.PRODUCTS.find(x => x[0] === s || x[1].toLowerCase() === s || x[2].toLowerCase() === s || s.startsWith(x[1].toLowerCase()) || s.includes(x[2].toLowerCase())); return p ? p[0] : null; };
  const typeKey = v => { const s = String(v).trim().toLowerCase(); const t = C.TYPES.find(x => x[0] === s || s.includes(x[2].toLowerCase()) || s.includes(x[1])); return t ? t[0] : (s ? 'other' : ''); };
  let IMP = null;

  async function admin() {
    const users = UI.USERS, cnt = id => UI.CLIENTS.filter(c => c.owner_id === id).length;
    UI.render(`<div class="pagehead"><h1>管理 <small>Admin</small></h1></div>
      <div class="grid2"><section class="card pad"><h2>账号 Users</h2><div class="tblwrap"><table class="mini"><thead><tr><th>用户名</th><th>姓名 / 登录邮箱</th><th>角色</th><th>客户数</th><th>状态</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.full_name)}${u.email ? `<div class="muted small">${esc(u.email)}</div>` : ''}</td><td>${u.role === 'admin' ? '管理员' : '业务员'}</td><td>${cnt(u.id)}</td><td>${u.active ? '✅ 启用' : '⛔ 停用'}</td>
          <td><button class="ghost sm" data-pw="${esc(u.id)}">重置密码</button>${u.id !== UI.ME.id ? `<button class="ghost sm" data-tog="${esc(u.id)}" data-a="${u.active ? 1 : 0}">${u.active ? '停用' : '启用'}</button>${!u.active && cnt(u.id) ? `<button class="ghost sm" data-free="${esc(u.id)}">客户放回公海</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>
        <h3>新增账号</h3><form id="nu" class="g2"><input name="username" placeholder="用户名 sales5" required pattern="[a-zA-Z0-9_.]+"><input name="full_name" placeholder="姓名" required><input name="email" type="email" placeholder="登录邮箱（可选）Login email" class="span2"><input name="password" placeholder="初始密码 (≥8位)" required minlength="8"><select name="role">${opt('sales', '业务员', 'sales')}${opt('admin', '管理员', '')}</select><div class="span2 right"><button class="primary sm">创建</button></div></form>
        <p class="muted small">离职处理：先“停用”账号（无法登录），再把其客户“放回公海”或在客户列表批量转给他人；历史跟进记录保留。</p></section>
      <section class="card pad"><h2>备份 Backup</h2><p>导出全部数据（客户、跟进、报价、样品、操作日志、模板、账号），建议每周一次存到网盘。</p>
        <div class="qa"><button class="primary" id="bkx">⬇️ Excel 多表备份</button><button class="ghost" id="bkj">⬇️ JSON 完整备份</button></div>
        <h2 style="margin-top:22px">导入客户 Import (CSV / Excel)</h2><p class="muted small">支持本系统导出的文件、tools/prospect.py 生成的 crm_import.csv、以及任意表头（下一步手动对应字段）。导入前自动查重。</p>
        <input type="file" id="impf" accept=".csv,.xlsx,.xls"><div id="impbox"></div></section></div>`, 'admin');
    $$('[data-tog]').forEach(b => b.onclick = async () => { try { await DB.updateUser(b.dataset.tog, { active: b.dataset.a !== '1' }); await UI.refresh(); admin(); } catch (e) { UI.toast(e.message, 1); } });
    $$('[data-pw]').forEach(b => b.onclick = async () => { const pw = prompt('新密码（至少8位）New password (min 8)'); if (!pw) return; if (pw.length < 8) return UI.toast('至少8位', 1);
      try { await DB.updateUser(b.dataset.pw, { password: pw }); UI.toast('密码已重置'); } catch (e) { UI.toast(e.message, 1); } });
    $$('[data-free]').forEach(b => b.onclick = async () => { const ids = UI.CLIENTS.filter(c => c.owner_id === b.dataset.free).map(c => c.id); if (!confirm(`把 ${ids.length} 家客户放回公海？`)) return; await DB.bulkUpdate(ids, { owner_id: null }); await UI.refresh(); admin(); UI.toast('已放回公海'); });
    $('#nu').onsubmit = async e => { e.preventDefault(); const f = e.target; try { await DB.createUser({ username: f.username.value, full_name: f.full_name.value, password: f.password.value, role: f.role.value, email: f.email.value }); UI.toast('已创建'); await UI.refresh(); admin(); } catch (err) { UI.toast(err.message, 1); } };
    $('#bkj').onclick = async () => { const b = await DB.backup(); UI.download(`crm_backup_${UI.today()}.json`, new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' })); };
    $('#bkx').onclick = async () => { const b = await DB.backup(); try { await UI.loadXLSX(); } catch (e) { return UI.toast(e.message, 1); }
      const wb = XLSX.utils.book_new(), flat = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.join('; ') : (v && typeof v === 'object') ? JSON.stringify(v) : v]));
      ['clients', 'follow_ups', 'quotes', 'samples', 'audit_log', 'templates', 'users'].forEach(k => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((b[k] || []).map(flat)), k)); XLSX.writeFile(wb, `crm_backup_${UI.today()}.xlsx`); };
    $('#impf').onchange = async e => { const file = e.target.files[0]; if (!file) return; let rows;
      try { if (/\.xlsx?$/i.test(file.name)) { await UI.loadXLSX(); const wb = XLSX.read(await file.arrayBuffer()); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); } else rows = parseCSV(await file.text()); } catch (err) { return UI.toast('读取失败：' + err.message, 1); }
      if (rows.length < 2) return UI.toast('文件为空', 1);
      IMP = { name: file.name, head: rows[0].map(String), data: rows.slice(1), map: rows[0].map(h => guess(h)), owner: 'column', skip: true }; mapping(); };
  }
  function build() {
    const out = [], seenD = new Set(), seenN = new Set(), seenP = new Set(), byU = Object.fromEntries(UI.USERS.map(u => [u.username.toLowerCase(), u.id]));
    const exD = new Map(), exN = new Map(), exP = new Map(); UI.CLIENTS.forEach(c => { const d = U.domain(c.website), n = U.nameKey(c.company_name), p = U.phoneKey(c.company_phone); if (d) exD.set(d, c); if (n) exN.set(n, c); if (p) exP.set(p, c); });
    IMP.data.forEach((r, i) => { const o = {}; IMP.map.forEach((k, j) => { if (k && r[j] != null && String(r[j]).trim() !== '') o[k] = String(r[j]).trim(); });
      if (!o.company_name) return; const c = { ...o };
      c.products = (o.products || '').split(/[;,，、|]/).map(prodKey).filter(Boolean); c.tags = (o.tags || '').split(/[;,，、|]/).map(s => s.trim()).filter(Boolean);
      if (o.customer_type) c.customer_type = typeKey(o.customer_type); if (o.priority && !C.PRIORITIES.includes(o.priority)) c.priority = 'B';
      if (o.status && !C.STATUSES.some(s => s[0] === o.status)) c.status = '未联系';
      if (o.next_follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(o.next_follow_up)) delete c.next_follow_up;
      delete c.owner; c.owner_id = IMP.owner === 'column' ? (byU[(o.owner || '').toLowerCase()] || null) : IMP.owner === 'pool' ? null : IMP.owner;
      const d = U.domain(c.website), n = U.nameKey(c.company_name), p = U.phoneKey(c.company_phone);
      const ex = (d && exD.get(d)) || (n && exN.get(n)) || (p && exP.get(p)); const inFile = (d && seenD.has(d)) || (n && seenN.has(n)) || (p && seenP.has(p));
      if (d) seenD.add(d); if (n) seenN.add(n); if (p) seenP.add(p);
      out.push({ row: i + 2, c, dup: ex ? `已存在：${ex.company_name}（${UI.userName(ex.owner_id)}）` : inFile ? '文件内重复' : '' }); });
    return out;
  }
  function mapping() {
    const rows = build(), dups = rows.filter(r => r.dup).length, toImp = IMP.skip ? rows.length - dups : rows.length;
    $('#impbox').innerHTML = `<h3>字段对应 Column mapping — ${esc(IMP.name)}（${IMP.data.length} 行）</h3><div class="mapgrid">${IMP.head.map((h, j) => `<label><span>${esc(h || '(空)')}</span><select data-m="${j}">${opt('', '— 忽略 —', IMP.map[j])}${IMPORT_FIELDS.map(f => opt(f[0], f[1] + ' ' + f[2], IMP.map[j])).join('')}</select><em class="muted small">${esc(String((IMP.data[0] || [])[j] || '').slice(0, 30))}</em></label>`).join('')}</div>
      <div class="g2"><label>负责业务员 Owner<select id="imo">${opt('column', '按文件中“负责业务员”列（用户名）', IMP.owner)}${opt('pool', '全部放入公海（之后再分配）', IMP.owner)}${UI.USERS.filter(u => u.active).map(u => opt(u.id, '全部分给 ' + u.full_name, IMP.owner)).join('')}</select></label>
        <label class="inl"><input type="checkbox" id="imsk" ${IMP.skip ? 'checked' : ''}> 跳过重复客户 Skip duplicates</label></div>
      ${IMP.map.includes('company_name') ? '' : '<div class="warn">请指定“公司名称”列</div>'}
      <p><b>${rows.length}</b> 行有效 · <b class="${dups ? 'red' : ''}">${dups}</b> 行疑似重复 · 将导入 <b>${toImp}</b> 行</p>
      <div class="tblwrap prev"><table class="mini"><thead><tr><th>行</th><th>公司</th><th>国家</th><th>网站</th><th>电话</th><th>产品</th><th>负责人</th><th>查重</th></tr></thead><tbody>${rows.slice(0, 200).map(r => `<tr class="${r.dup ? 'duprow' : ''}"><td>${r.row}</td><td>${esc(r.c.company_name)}</td><td>${esc(r.c.country || '')}</td><td>${esc(U.domain(r.c.website))}</td><td>${esc(r.c.company_phone || '')}</td><td>${esc((r.c.products || []).join(','))}</td><td>${esc(UI.userName(r.c.owner_id))}</td><td>${r.dup ? '⚠️ ' + esc(r.dup) : '✅'}</td></tr>`).join('')}</tbody></table></div>
      <div class="right"><button class="ghost" id="imc">取消</button> <button class="primary" id="imgo" ${IMP.map.includes('company_name') && toImp ? '' : 'disabled'}>导入 ${toImp} 行</button></div>`;
    $$('[data-m]').forEach(s => s.onchange = () => { IMP.map[+s.dataset.m] = s.value; mapping(); });
    $('#imo').onchange = e => { IMP.owner = e.target.value; mapping(); }; $('#imsk').onchange = e => { IMP.skip = e.target.checked; mapping(); };
    $('#imc').onclick = () => { IMP = null; $('#impbox').innerHTML = ''; $('#impf').value = ''; };
    $('#imgo').onclick = async () => { const list = rows.filter(r => !(IMP.skip && r.dup)).map(r => r.c);
      try { const n = await DB.importClients(list); UI.toast(`已导入 ${n} 家`); IMP = null; await UI.refresh(); location.hash = '#/list'; } catch (e) { UI.toast(e.message, 1); } };
  }
  UI.views.templates = { render: templates };
  UI.views.me = { render: me };
  UI.views.admin = { render: admin, admin: true };
})();
