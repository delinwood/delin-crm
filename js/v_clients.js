(function () {
  const { esc, opt, $, $$ } = UI;
  const F = JSON.parse(sessionStorage.getItem('fcrm_filters') || '{}');
  let SORT = JSON.parse(sessionStorage.getItem('fcrm_sort') || '{"k":"updated_at","d":-1}'), PAGE = 1, SEL = new Set();
  const PER = 50, uniq = a => [...new Set(a.filter(Boolean))].sort();
  const PRI = { 'A+': 0, A: 1, B: 2, C: 3 };

  function filtered(list) {
    const q = (F.q || '').toLowerCase().trim(), t = UI.today();
    return list.filter(c => (UI.ME.role === 'admin' || c.owner_id === UI.ME.id)
      && (F.group === 'invalid' || F.status === '无效' || F.attention === '无效' ? UI.isInvalid(c) : !UI.isInvalid(c))
      && (!F.attention || UI.attention(c) === F.attention) && (!F.email_due || UI.emailDue(c))
      && (!q || [c.company_name, c.city, c.website, c.company_email, c.contact_name, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
      && (!F.country || c.country === F.country) && (!F.state || c.state === F.state)
      && (!F.product || (c.products || []).includes(F.product)) && (!F.priority || c.priority === F.priority)
      && (!F.type || c.customer_type === F.type) && (UI.ME.role !== 'admin' || !F.owner || (F.owner === '_none' ? !c.owner_id : c.owner_id === F.owner))
      && (!F.status || (F.status === '无效' ? UI.isInvalid(c) : c.status === F.status)) && (!F.tag || (c.tags || []).includes(F.tag))
      && (!F.due || (F.due === 'overdue' ? (c.next_follow_up && c.next_follow_up < t) : F.due === 'today' ? c.next_follow_up === t : F.due === 'week' ? (c.next_follow_up && c.next_follow_up <= UI.today(7)) : !c.next_follow_up)));
  }
  function sorted(list) {
    const k = SORT.k, d = SORT.d;
    return [...list].sort((a, b) => { let x = a[k], y = b[k];
      if (k === 'priority') { x = PRI[x] ?? 9; y = PRI[y] ?? 9; } if (k === 'owner_id') { x = UI.userName(x); y = UI.userName(y); }
      if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * d; });
  }
  UI.filtered = () => sorted(filtered(UI.CLIENTS));
  UI.setFilters = o => { Object.keys(F).forEach(k => delete F[k]); Object.assign(F, o); PAGE = 1; sessionStorage.setItem('fcrm_filters', JSON.stringify(F)); };

  // ---------------- LIST ----------------
  async function list() {
    const admin = UI.ME.role === 'admin', C2 = UI.CLIENTS.filter(c => admin || c.owner_id === UI.ME.id), saved = await DB.listSavedFilters();
    const canDelete = await deleteAllowed();
    const states = uniq(C2.filter(c => !F.country || c.country === F.country).map(c => c.state)), tags = uniq(C2.flatMap(c => c.tags || []));
    const th = (k, l) => `<th class="sortable ${SORT.k === k ? 'on' : ''}" data-k="${k}">${l}${SORT.k === k ? (SORT.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    UI.render(`
      <div class="pagehead"><h1>${F.group === 'invalid' ? '无效客户' : F.email_due ? '邮件跟进提醒' : '客户列表'} <small>Clients</small></h1><div class="actions"><a class="btn ghost" href="#/invalid">无效客户</a><a class="btn ghost" href="#/email-reminders">邮件提醒</a><a class="btn primary" href="#/new">+ 新建客户</a></div></div>
      <section class="kpis">${[['全部 All', C2.length, '']].concat(C.STATUSES.map(s => [s[0], C2.filter(c => c.status === s[0]).length, s[0]])).map(k => `<button class="kpi ${(F.status || '') === k[2] ? 'on' : ''}" data-st="${esc(k[2])}"><b>${k[1]}</b><span>${esc(k[0])}</span></button>`).join('')}</section>
      <section class="card filters${UI._fopen ? ' open' : ''}"><button type="button" class="ghost ftoggle" id="ftog">筛选 Filters ${Object.keys(F).filter(k => F[k] && k !== 'q').length ? '(' + Object.keys(F).filter(k => F[k] && k !== 'q').length + ')' : ''} ▾</button>
        <input id="fq" type="search" placeholder="搜索 公司/城市/网站/邮箱/标签  Search…" value="${esc(F.q || '')}">
        <select id="fcountry"><option value="">国家 Country</option>${uniq(C2.map(c => c.country)).map(v => opt(v, v, F.country)).join('')}</select>
        <select id="fstate"><option value="">州/省 State</option>${states.map(v => opt(v, v, F.state)).join('')}</select>
        <select id="fproduct"><option value="">产品 Product</option>${C.PRODUCTS.map(p => opt(p[0], p[1] + ' ' + p[2], F.product)).join('')}</select>
        <select id="fattention"><option value="">客户标记</option>${['紧急', '重要', '普通', '无效'].map(v => opt(v, v, F.attention)).join('')}</select>
        <select id="fpriority"><option value="">优先级 Priority</option>${C.PRIORITIES.map(v => opt(v, v, F.priority)).join('')}</select>
        <select id="ftype"><option value="">类型 Type</option>${C.TYPES.map(t => opt(t[0], t[1] + ' ' + t[2], F.type)).join('')}</select>
        ${admin ? `<select id="fowner"><option value="">业务员 Owner</option>${opt('_none', '公海 Pool (未分配)', F.owner)}${UI.USERS.map(u => opt(u.id, u.full_name, F.owner)).join('')}</select>` : ''}
        <select id="fstatus"><option value="">状态 Status</option>${C.STATUSES.map(s => opt(s[0], s[0] + ' ' + s[1], F.status)).join('')}</select>
        <select id="fdue"><option value="">下次跟进 Next</option>${opt('overdue', '已逾期 Overdue', F.due)}${opt('today', '今天 Today', F.due)}${opt('week', '7天内 This week', F.due)}${opt('none', '未设置 Not set', F.due)}</select>
        <select id="ftag"><option value="">标签 Tag</option>${tags.map(t => opt(t, '#' + t, F.tag)).join('')}</select>
        <button class="ghost" id="fclear">清除</button>
      </section>
      <div class="saved">${saved.map(s => `<span class="sf"><a href="#" data-sf="${esc(s.id)}">★ ${esc(s.name)}</a><button class="x" data-sfdel="${esc(s.id)}" title="删除">×</button></span>`).join('')}<button class="ghost sm" id="savef">☆ 保存当前筛选 Save filter</button></div>
      <div class="bar"><div id="cnt"></div><div class="actions">${canDelete ? '<button class="ghost sm" id="selectFiltered">全选筛选结果</button>' : ''}<button class="ghost sm" id="xcsv">导出 CSV</button><button class="ghost sm" id="xxlsx">导出 Excel</button></div></div>
      <div class="bulk card" id="bulk" hidden><b id="selc"></b>
        ${admin ? `<select id="b_owner"><option value="">分配给… Assign to</option>${opt('_none', '放回公海 Back to pool', '')}${UI.USERS.filter(u => u.active).map(u => opt(u.id, u.full_name, '')).join('')}</select>
        <select id="b_pri"><option value="">优先级…</option>${C.PRIORITIES.map(v => opt(v, v, '')).join('')}</select>` : ''}
        <select id="b_status"><option value="">状态…</option>${C.STATUSES.filter(s => admin || s[0] !== '无效').map(s => opt(s[0], s[0], '')).join('')}</select>
        <input id="b_tag" placeholder="+ 标签 tag" style="width:110px"><input id="b_next" type="date" title="下次跟进">
        <button class="primary sm" id="b_apply">应用 Apply</button><button class="primary sm" id="b_mail">批量发送邮件</button><button class="ghost sm" id="b_export">导出所选</button>${canDelete ? '<button class="ghost sm danger" id="b_delete">批量删除所选客户</button>' : ''}<button class="ghost sm" id="b_clear">取消选择</button></div>
      <section class="card tbl"><table><thead><tr><th class="ck"><input type="checkbox" id="selall"></th>${th('company_name', '公司 Company')}<th>类型</th>${th('country', '地区 Location')}<th>产品 Products</th><th>客户标记</th>${th('priority', '优先级')}${th('status', '状态')}${admin ? th('owner_id', '业务员') : ''}${th('next_follow_up', '下次跟进')}${th('last_follow_up', '最近跟进')}<th>当地时间</th></tr></thead><tbody id="rows"></tbody></table></section>
      <div class="pager" id="pager"></div>`, 'list');
    draw();
    const bind = (id, k) => { const el = $('#' + id); if (el) el[el.tagName === 'INPUT' ? 'oninput' : 'onchange'] = () => { F[k] = el.value; PAGE = 1; if (k === 'country') { F.state = ''; list(); } else draw(); }; };
    [['fq', 'q'], ['fcountry', 'country'], ['fstate', 'state'], ['fproduct', 'product'], ['fattention', 'attention'], ['fpriority', 'priority'], ['ftype', 'type'], ['fowner', 'owner'], ['fstatus', 'status'], ['fdue', 'due'], ['ftag', 'tag']].forEach(a => bind(...a));
    $('#fclear').onclick = () => { Object.keys(F).forEach(k => delete F[k]); PAGE = 1; list(); };
    $$('.kpi').forEach(b => b.onclick = () => { F.status = b.dataset.st; PAGE = 1; list(); });
    $$('th.sortable').forEach(t => t.onclick = () => { SORT = { k: t.dataset.k, d: SORT.k === t.dataset.k ? -SORT.d : 1 }; sessionStorage.setItem('fcrm_sort', JSON.stringify(SORT)); list(); });
    $('#savef').onclick = async () => { const n = prompt('筛选名称 Name this filter（如：美国A+未联系）'); if (n) { await DB.saveFilter(n, { ...F }); UI.toast('已保存'); list(); } };
    $$('[data-sf]').forEach(a => a.onclick = e => { e.preventDefault(); const s = saved.find(x => x.id === a.dataset.sf); Object.keys(F).forEach(k => delete F[k]); Object.assign(F, s.filters); PAGE = 1; list(); });
    $$('[data-sfdel]').forEach(b => b.onclick = async () => { await DB.deleteFilter(b.dataset.sfdel); list(); });
    $('#xcsv').onclick = () => UI.exportRows(UI.filtered(), 'csv'); $('#xxlsx').onclick = () => UI.exportRows(UI.filtered(), 'xlsx');
    $('#selall').onchange = e => { const rows = pageRows(); rows.forEach(c => e.target.checked ? SEL.add(c.id) : SEL.delete(c.id)); draw(); };
    if ($('#selectFiltered')) $('#selectFiltered').onclick = () => { SEL = new Set(UI.filtered().map(c => c.id)); draw(); };
    if ($('#b_delete')) $('#b_delete').onclick = () => removeClients(UI.CLIENTS.filter(c => SEL.has(c.id)));
    $('#b_clear').onclick = () => { SEL.clear(); draw(); };
    $('#b_export').onclick = () => UI.exportRows(UI.CLIENTS.filter(c => SEL.has(c.id)), 'xlsx');
    $('#b_mail').onclick = () => UI.mailCompose([...SEL]);
    $('#b_apply').onclick = async () => {
      const patch = {}, o = $('#b_owner'), p = $('#b_pri');
      if (o && o.value) patch.owner_id = o.value === '_none' ? null : o.value; if (p && p.value) patch.priority = p.value;
      if ($('#b_status').value) patch.status = $('#b_status').value; if ($('#b_next').value) patch.next_follow_up = $('#b_next').value;
      const tag = $('#b_tag').value.trim().replace(/^#/, '');
      if (!Object.keys(patch).length && !tag) return UI.toast('请选择要修改的内容', 1);
      try {
        const ids = [...SEL];
        if (tag) for (const id of ids) { const c = UI.CLIENTS.find(x => x.id === id); await DB.updateClient(id, { tags: [...new Set([...(c.tags || []), tag])] }); }
        if (Object.keys(patch).length) await DB.bulkUpdate(ids, patch);
        UI.toast(`已更新 ${ids.length} 家 Updated`); SEL.clear(); await UI.refresh(); list();
      } catch (e) { UI.toast(e.message, 1); }
    };
  }
  // Fail closed when the owner-only database permission has not been deployed.
  async function deleteAllowed() {
    try { return await DB.canDeleteClients(); } catch (e) { console.warn('删除权限暂不可用', e.message); return false; }
  }
  async function removeClients(clients, detailButton) {
    if (!clients.length) return UI.toast('请先勾选要删除的客户', 1);
    if (!await deleteAllowed()) return UI.toast('仅老板账号可以删除客户', 1);
    const snapshot = clients.map(c => ({ id: c.id, company_name: c.company_name, country: c.country }));
    const names = snapshot.slice(0, 15).map(c => `${c.company_name} (${c.country || '未填写国家'})`).join('\n');
    if (!confirm(`确认永久删除所选 ${snapshot.length} 家客户？\n\n${names}${snapshot.length > 15 ? '\n……其余 ' + (snapshot.length - 15) + ' 家' : ''}\n\n相关跟进、报价和样品记录也可能随客户一并删除。`)) return;
    const button = detailButton || $('#b_delete');
    if (button) { button.disabled = true; button.textContent = '正在删除…'; }
    try {
      const deleted = await DB.bulkDeleteClients(snapshot.map(c => c.id));
      if (!Array.isArray(deleted) || deleted.length !== snapshot.length) throw new Error('删除结果不完整，请刷新核对');
      deleted.forEach(id => SEL.delete(id));
      await UI.refresh(); PAGE = 1;
      UI.toast(`已删除 ${deleted.length} 家客户`);
      if (detailButton) location.hash = '#/list'; else await list();
    } catch (e) { UI.toast(e.message, 1); }
    finally { if (button && button.isConnected) { button.disabled = false; button.textContent = detailButton ? '删除' : '批量删除所选客户'; } }
  }
  const pageRows = () => UI.filtered().slice((PAGE - 1) * PER, PAGE * PER);
  function draw() {
    sessionStorage.setItem('fcrm_filters', JSON.stringify(F));
    const all = UI.filtered(), rows = pageRows(), admin = UI.ME.role === 'admin', pages = Math.max(1, Math.ceil(all.length / PER));
    $('#cnt').innerHTML = `共 <b>${all.length}</b> 家客户 <small>${all.length} clients</small>`;
    $('#rows').innerHTML = rows.map(c => { const lt = UI.localTime(c); return `<tr data-id="${esc(c.id)}" class="${SEL.has(c.id) ? 'sel' : ''}">
      <td class="ck" data-l=""><input type="checkbox" data-sel="${esc(c.id)}" ${SEL.has(c.id) ? 'checked' : ''}></td>
      <td data-l="公司"><a class="cname" href="#/client/${esc(c.id)}">${esc(c.company_name)}</a>${c.website ? `<a class="sub" href="${esc(UI.url(c.website))}" target="_blank" rel="noopener">${esc(U.domain(c.website))}</a>` : ''}<div>${UI.tags(c.tags)}</div></td>
      <td data-l="类型">${esc(C.typeCN(c.customer_type))}</td>
      <td data-l="地区">${esc([c.city, c.state, c.country].filter(Boolean).join(', '))}</td>
      <td data-l="产品"><div class="chips">${UI.chips(c.products)}</div></td>
      <td data-l="客户标记">${UI.attentionControl(c)}${UI.isInvalid(c) ? `<div class="muted small">${esc(c.invalid_reason || '历史无效客户')}${c.marked_by ? '<br>' + esc(UI.userName(c.marked_by)) + ' · ' + esc((c.marked_at || '').slice(0, 16).replace('T', ' ')) : ''}</div>` : UI.emailDue(c) ? '<div class="red small">邮件跟进已到期</div>' : ''}</td>
      <td data-l="优先级">${UI.prBadge(c.priority)}</td><td data-l="状态">${UI.stBadge(c.status)}</td>
      ${admin ? `<td data-l="业务员">${c.owner_id ? esc(UI.userName(c.owner_id)) : '<span class="pool">公海</span>'}</td>` : ''}
      <td data-l="下次跟进">${UI.dueBadge(c.next_follow_up) || '<span class="muted">—</span>'}</td>
      <td data-l="最近跟进">${esc(c.last_follow_up || '—')}</td>
      <td data-l="当地时间">${lt ? `<span class="lt ${lt.work ? 'on' : ''}">${esc(lt.text)}</span>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="11" class="empty">没有符合条件的客户 No clients match</td></tr>`;
    UI.bindAttention();
    $$('#rows tr[data-id]').forEach(tr => tr.onclick = e => { if (e.target.closest('a,input,select,button')) return; location.hash = '#/client/' + tr.dataset.id; });
    $$('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? SEL.add(cb.dataset.sel) : SEL.delete(cb.dataset.sel); draw(); });
    const ft = $('#ftog'); if (ft) ft.onclick = () => { UI._fopen = !UI._fopen; ft.parentElement.classList.toggle('open', UI._fopen); };
    $('#bulk').hidden = !SEL.size; $('#selc').textContent = `已选 ${SEL.size} 家`; $('#selall').checked = rows.length && rows.every(c => SEL.has(c.id));
    $('#pager').innerHTML = pages > 1 ? `<button class="ghost sm" ${PAGE <= 1 ? 'disabled' : ''} id="pprev">‹ 上一页</button> 第 ${PAGE}/${pages} 页 <button class="ghost sm" ${PAGE >= pages ? 'disabled' : ''} id="pnext">下一页 ›</button>` : '';
    if ($('#pprev')) { $('#pprev').onclick = () => { PAGE--; draw(); }; $('#pnext').onclick = () => { PAGE++; draw(); }; }
  }

  // ---------------- EXPORT ----------------
  UI.exportRows = async (list, fmt) => {
    const rows = list.map(c => { const o = {}; C.FIELDS.forEach(([k, cn, en]) => { let v = c[k];
      if (k === 'products') v = (c.products || []).map(p => C.productName(p) + ' ' + C.productEN(p)).join('; ');
      if (k === 'tags') v = (c.tags || []).join('; '); if (k === 'customer_type') v = C.typeName(c.customer_type); if (k === 'owner') v = c.owner_id ? (UI.USERS.find(u => u.id === c.owner_id) || {}).username || '' : '';
      o[cn + ' ' + en] = v == null ? '' : v; }); o['最近跟进 Last follow-up'] = c.last_follow_up || '';
      o['客户标记'] = UI.attention(c); o['无效原因'] = c.invalid_reason || ''; o['标记人'] = c.marked_by ? UI.userName(c.marked_by) : '';
      o['标记时间'] = c.marked_at || ''; o['邮件提醒'] = UI.isInvalid(c) ? '已停止提醒' : UI.emailDueDate(c); return o; });
    const stamp = UI.today();
    if (fmt === 'csv') { const h = Object.keys(rows[0] || { '公司名称 Company Name': '' }), q = v => '"' + String(v).replace(/"/g, '""') + '"';
      return UI.download(`clients_${stamp}.csv`, new Blob(['\ufeff' + [h.map(q).join(',')].concat(rows.map(r => h.map(k => q(r[k])).join(','))).join('\r\n')], { type: 'text/csv;charset=utf-8' })); }
    try { await UI.loadXLSX(); } catch (e) { return UI.toast(e.message, 1); }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Clients'); XLSX.writeFile(wb, `clients_${stamp}.xlsx`);
  };

  // ---------------- DETAIL ----------------
  const kv = (label, val) => `<div class="kv"><span>${label}</span><div>${val || '<em class="muted">—</em>'}</div></div>`;
  let TAB = 'log';
  async function detail(id) {
    let c; try { c = await DB.getClient(id); } catch (e) { return UI.render(`<div class="card pad">${esc(e.message)} <a href="#/list">返回</a></div>`, 'list'); }
    const admin = UI.ME.role === 'admin', [logs, quotes, samples, audit] = await Promise.all([DB.listLogs(id), DB.listQuotes(id), DB.listSamples(id), DB.listAudit({ client_id: id, limit: 100 })]);
    const canDelete = await deleteAllowed();
    const usWarn = c.country === 'USA' && (c.products || []).some(p => C.US_EXCLUDED.includes(p)), lt = UI.localTime(c);
    const ids = UI.filtered().map(x => x.id), i = ids.indexOf(id), prev = ids[i - 1], next = ids[i + 1];
    const wa = UI.wa(c.whatsapp || c.company_phone, c);
    UI.render(`<div class="crumbs"><a href="#/list">← 客户列表</a><span>${i >= 0 ? `${i + 1}/${ids.length}` : ''} ${prev ? `<a href="#/client/${esc(prev)}">‹ 上一个</a>` : ''} ${next ? `<a href="#/client/${esc(next)}">下一个 ›</a>` : ''}</span></div>
      <section class="card hero"><div class="hl"><h1>${esc(c.company_name)}</h1>
        <div class="meta">${esc(C.typeName(c.customer_type))} · ${esc([c.city, c.state, c.country].filter(Boolean).join(', '))} ${UI.ltBadge(c)}</div>
        <div class="badges">${UI.prBadge(c.priority)} ${UI.stBadge(c.status)} ${c.next_follow_up ? '下次跟进 ' + UI.dueBadge(c.next_follow_up) : '<span class="due none">未设下次跟进</span>'} <span class="owner">负责人 <b>${esc(UI.userName(c.owner_id))}</b></span> ${UI.tags(c.tags)}</div></div>
        <div class="quick">${c.company_phone ? UI.link(UI.tel(c.company_phone, c), '📞 拨打', 'btn ghost') : ''}${wa ? UI.link(wa, '💬 WhatsApp', 'btn ghost') : ''}${c.company_email ? UI.link('mailto:' + c.company_email, '✉️ 邮件', 'btn ghost') : ''}${c.website ? UI.link(UI.url(c.website), '🌐 网站', 'btn ghost') : ''}${c.contact_linkedin ? UI.link(UI.url(c.contact_linkedin), 'in LinkedIn', 'btn ghost') : ''}<a class="btn primary" href="#/templates/${esc(c.id)}">✍️ 写开发信</a></div></section>
      ${usWarn ? '<div class="warn">⚠️ 美国市场不推强化/实木复合地板 (No laminate/engineered for USA)</div>' : ''}
      ${lt && !lt.work ? `<div class="info">🌙 客户当地现在是 ${esc(lt.text)}，非工作时间——建议邮件或定时发送，电话/WhatsApp 等对方上班再联系。</div>` : ''}
      <div class="grid2 dgrid"><div class="dprof">
        <section class="card pad"><div class="sec-h"><h2>客户资料 <small>Profile</small></h2><div><button class="ghost sm" id="edit">编辑 Edit</button>${canDelete ? ` <button class="ghost sm danger" id="del">删除</button>` : ''}</div></div>
          <h3>公司信息 Company</h3>${kv('地址 Address', esc(c.address))}${kv('公司电话 Phone', c.company_phone ? UI.link(UI.tel(c.company_phone, c), c.company_phone) : '')}${kv('WhatsApp', wa ? UI.link(wa, c.whatsapp || c.company_phone + '（同公司电话，未核实是否开通）') : '')}
          ${kv('公司邮箱 Email', c.company_email ? UI.link('mailto:' + c.company_email, c.company_email) : '')}${kv('网站 Website', c.website ? UI.link(UI.url(c.website), c.website) : '')}
          <h3>采购联系人 Purchasing contact</h3>${kv('姓名 Name', esc(c.contact_name))}${kv('职位 Title', esc(c.contact_title))}${kv('LinkedIn', c.contact_linkedin ? UI.link(UI.url(c.contact_linkedin), c.contact_linkedin) : '')}
          <h3>业务 Business</h3>${kv('客户标记', UI.attentionControl(c))}${kv('无效原因', esc(c.invalid_reason || ''))}${kv('邮件提醒', UI.isInvalid(c) ? '已停止提醒' : esc(UI.emailDueDate(c)))}${kv('匹配产品 Products', `<div class="chips">${UI.chips(c.products)}</div>`)}${kv('标签 Tags', UI.tags(c.tags))}${kv('Apollo 搜索条件', esc(c.apollo_criteria))}
          ${kv('备注 Notes', esc(c.notes).replace(/\n/g, '<br>'))}${kv('来源/核实 Source', esc(c.source_note).replace(/(https?:\/\/[^\s;,)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'))}
          ${kv('创建 Created', esc((c.created_at || '').slice(0, 10)) + ' · ' + esc(UI.userName(c.created_by)))}
        </section></div>
        <div><section class="card pad">
          <div class="tabs">${[['log', `跟进 Log (${logs.length})`], ['quote', `报价 Quotes (${quotes.length})`], ['sample', `样品 Samples (${samples.length})`], ['audit', `变更 History`]].map(t => `<button class="tab ${TAB === t[0] ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
          <div class="tabp" data-p="log" ${TAB !== 'log' ? 'hidden' : ''}>
            <form id="logf" class="logf"><div class="row3"><label>日期<input type="date" name="d" value="${UI.today()}" required></label><label>方式<select name="ch">${C.CHANNELS.map(x => opt(x[0], x[1], 'email')).join('')}</select></label>
            <label>状态<select name="st"><option value="">${c.status === '未联系' ? '自动→已联系' : '不变 Keep'}</option>${C.STATUSES.filter(s => admin || s[0] !== '无效').map(s => opt(s[0], s[0] + ' ' + s[1], '')).join('')}</select></label></div>
            <textarea name="t" rows="3" placeholder="沟通内容：发了什么、对方怎么回、下一步… What happened / next step" required></textarea>
            <div class="row3"><label>下次跟进 Next follow-up<input type="date" name="nx" value="${UI.today(3)}"></label><div class="qd">${[[1, '明天'], [3, '3天'], [7, '1周'], [14, '2周'], [30, '1月']].map(d => `<button type="button" class="ghost sm" data-nx="${d[0]}">${d[1]}</button>`).join('')}<button type="button" class="ghost sm" data-nx="">不设</button></div><button class="primary">添加记录</button></div></form>
            <ul class="timeline">${logs.map(l => `<li><div class="dt">${esc(l.entry_date)} <span class="chn">${esc(C.channelName(l.channel))}</span> <span>${esc(l.author_name)}</span>${l.next_follow_up ? ` <span class="muted">→ 下次 ${esc(l.next_follow_up)}</span>` : ''}</div><div>${esc(l.content).replace(/\n/g, '<br>')}</div></li>`).join('') || '<li class="muted">暂无记录 No entries yet</li>'}</ul></div>
          <div class="tabp" data-p="quote" ${TAB !== 'quote' ? 'hidden' : ''}>
            <form id="qf" class="g3 small"><label>产品<select name="product">${C.PRODUCTS.map(p => opt(p[0], p[1], (c.products || [])[0])).join('')}</select></label><label>规格 Spec<input name="spec" placeholder="e.g. 5mm+1.5mm IXPE, 0.3mm wear"></label>
              <label>单价 Price<div class="inl"><select name="currency">${['USD', 'EUR', 'CAD', 'GBP', 'AUD', 'CNY'].map(x => opt(x, x, 'USD')).join('')}</select><input name="price" type="number" step="0.01" required></div></label>
              <label>单位<select name="unit">${C.UNITS.map(x => opt(x, x, 'm²')).join('')}</select></label><label>数量 Qty<input name="qty" type="number" step="1" placeholder="300"></label><label>贸易术语<select name="incoterm">${C.INCOTERMS.map(x => opt(x, x, 'FOB')).join('')}</select></label>
              <label>报价日期<input type="date" name="quote_date" value="${UI.today()}"></label><label>有效期至<input type="date" name="valid_until" value="${UI.today(30)}"></label><label>备注<input name="notes"></label>
              <div class="span3 right"><button class="primary sm">+ 添加报价 Add quote</button></div></form>
            <table class="mini"><thead><tr><th>日期</th><th>产品/规格</th><th>价格</th><th>数量</th><th>术语</th><th>有效期</th><th>人</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
            ${quotes.map(q => `<tr><td>${esc(q.quote_date)}</td><td>${esc(C.productName(q.product))}<div class="muted">${esc(q.spec || '')}</div></td><td><b>${esc(q.currency)} ${esc(q.price)}</b>/${esc(q.unit)}</td><td>${esc(q.qty || '')}</td><td>${esc(q.incoterm || '')}</td><td>${esc(q.valid_until || '')}${q.valid_until && q.valid_until < UI.today() ? ' <span class="due over">过期</span>' : ''}</td><td>${esc(q.author_name)}</td>${admin ? `<td><button class="x" data-qdel="${esc(q.id)}">×</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="muted">暂无报价</td></tr>'}</tbody></table></div>
          <div class="tabp" data-p="sample" ${TAB !== 'sample' ? 'hidden' : ''}>
            <form id="sf" class="g3 small"><label class="span2">样品内容 Items<input name="items" required placeholder="e.g. SPC 3 colours A4 + catalogue"></label><label>状态<select name="status">${C.SAMPLE_STATUS.map(s => opt(s[0], s[0] + ' ' + s[1], '已寄出')).join('')}</select></label>
              <label>寄出日期<input type="date" name="sent_date" value="${UI.today()}"></label><label>快递 Courier<input name="courier" placeholder="DHL / FedEx / UPS"></label><label>单号 Tracking<input name="tracking_no"></label>
              <div class="span3 right"><button class="primary sm">+ 登记样品 Add sample</button></div></form>
            <table class="mini"><thead><tr><th>寄出</th><th>内容</th><th>快递/单号</th><th>状态</th><th>反馈</th></tr></thead><tbody>
            ${samples.map(s => `<tr><td>${esc(s.sent_date || '')}</td><td>${esc(s.items)}<div class="muted">${esc(s.author_name)}</div></td><td>${esc(s.courier || '')} ${s.tracking_no ? `<a href="https://www.google.com/search?q=${encodeURIComponent((s.courier || '') + ' ' + s.tracking_no)}" target="_blank" rel="noopener">${esc(s.tracking_no)}</a>` : ''}</td>
              <td><select data-sst="${esc(s.id)}">${C.SAMPLE_STATUS.map(x => opt(x[0], x[0], s.status)).join('')}</select></td><td><input data-sfb="${esc(s.id)}" value="${esc(s.feedback || '')}" placeholder="客户反馈…"></td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无样品记录</td></tr>'}</tbody></table></div>
          <div class="tabp" data-p="audit" ${TAB !== 'audit' ? 'hidden' : ''}><ul class="audit">${audit.map(a => `<li><span class="muted">${esc(a.at.slice(0, 16).replace('T', ' '))}</span> <b>${esc(a.actor_name)}</b> ${UI.auditText(a)}</li>`).join('') || '<li class="muted">暂无</li>'}</ul></div>
        </section></div></div>`, 'list');
    UI.bindAttention();
    const mailQuick = document.querySelector('.hero .quick');
    if (mailQuick && c.company_email && (admin || c.owner_id === UI.ME.id) && !UI.isInvalid(c)) {
      const send = document.createElement('button'); send.className = 'btn primary'; send.textContent = '📨 系统发送邮件';
      send.onclick = () => UI.mailCompose([c.id]); mailQuick.prepend(send);
    }
    $$('.tab').forEach(b => b.onclick = () => { TAB = b.dataset.tab; $$('.tab').forEach(x => x.classList.toggle('on', x === b)); $$('.tabp').forEach(p => p.hidden = p.dataset.p !== TAB); });
    $$('[data-nx]').forEach(b => b.onclick = () => { $('#logf').nx.value = b.dataset.nx ? UI.today(+b.dataset.nx) : ''; });
    $('#logf').onsubmit = async e => { e.preventDefault(); const f = e.target;
      try { await DB.addLog(id, { entry_date: f.d.value, channel: f.ch.value, content: f.t.value.trim(), next_follow_up: f.nx.value, status: f.st.value }); UI.toast('已保存 Saved'); await UI.refresh(); detail(id); } catch (err) { UI.toast(err.message, 1); } };
    $('#qf').onsubmit = async e => { e.preventDefault(); const f = e.target, q = {}; ['product', 'spec', 'currency', 'price', 'unit', 'qty', 'incoterm', 'quote_date', 'valid_until', 'notes'].forEach(k => q[k] = f[k].value || null);
      q.price = +q.price; q.qty = q.qty ? +q.qty : null; try { await DB.addQuote(id, q); TAB = 'quote'; UI.toast('报价已记录'); await UI.refresh(); detail(id); } catch (err) { UI.toast(err.message, 1); } };
    $('#sf').onsubmit = async e => { e.preventDefault(); const f = e.target, s = {}; ['items', 'status', 'sent_date', 'courier', 'tracking_no'].forEach(k => s[k] = f[k].value || null);
      try { await DB.addSample(id, s); TAB = 'sample'; UI.toast('样品已登记'); detail(id); } catch (err) { UI.toast(err.message, 1); } };
    $$('[data-sst]').forEach(el => el.onchange = async () => { await DB.updateSample(el.dataset.sst, { status: el.value }); UI.toast('已更新'); });
    $$('[data-sfb]').forEach(el => el.onchange = async () => { await DB.updateSample(el.dataset.sfb, { feedback: el.value }); UI.toast('已更新'); });
    $$('[data-qdel]').forEach(b => b.onclick = async () => { if (confirm('删除该报价？')) { await DB.deleteQuote(b.dataset.qdel); detail(id); } });
    $('#edit').onclick = () => form(c);
    const d = $('#del'); if (d) d.onclick = () => removeClients([c], d);
  }
  const FN = Object.fromEntries(C.FIELDS.map(f => [f[0], f[1]])); FN.owner_id = '负责人';
  UI.auditText = a => {
    const d = a.detail || {};
    if (a.action === 'create') return '创建客户 created';
    if (a.action === 'delete') return `删除客户 deleted ${esc(d.company_name || '')}`;
    if (a.action === 'attention') return `客户标记：${esc((d.attention_level || [])[0] || '普通')} → ${esc((d.attention_level || [])[1] || '')}${d.invalid_reason ? '；原因：' + esc(d.invalid_reason) : ''}`;
    if (a.action === 'import') return `导入 imported ${esc(d.count)} 家`;
    if (a.action === 'log') return `添加跟进 (${esc(C.channelName(d.channel))})`;
    if (a.action === 'quote') return `添加报价 ${esc(d.currency || '')} ${esc(d.price || '')}`;
    if (a.action === 'sample') return `样品 ${esc(d.items || '')} ${d.status ? esc(Array.isArray(d.status) ? d.status.join(' → ') : d.status) : ''}`;
    return Object.entries(d).map(([k, v]) => { const f = x => k === 'owner_id' ? UI.userName(x) : Array.isArray(x) ? x.join(',') : x; return `修改<b>${esc(FN[k] || k)}</b>: <s>${esc(f(v[0]) || '空')}</s> → ${esc(f(v[1]) || '空')}`; }).join('；');
  };

  // ---------------- FORM ----------------
  function form(c, prefill) {
    const isNew = !c; c = c || { status: '未联系', priority: 'B', country: '', products: [], tags: [], ...(prefill || {}) }; const admin = UI.ME.role === 'admin';
    const inp = (k, label, type, extra) => `<label>${label}<input name="${k}" type="${type || 'text'}" value="${esc(c[k] || '')}" ${extra || ''}></label>`;
    const lockNote = !admin && !isNew ? '<p class="muted small">🔒 初始资料（名称/国家/网站/电话/邮箱/地址）可修改但不可清空；负责人由管理员分配。</p>' : '';
    UI.render(`<div class="crumbs"><a href="${isNew ? '#/list' : '#/client/' + esc(c.id)}">← 返回 Back</a></div>
      <form class="card pad form" id="cf"><h2>${isNew ? '新建客户 New client' : '编辑客户 Edit client'}</h2>${lockNote}<div id="dupbox"></div>
      <h3>公司信息 Company</h3><div class="g3">${inp('company_name', '公司名称 Company name *', 'text', 'required')}
        <label>客户类型 Type<select name="customer_type">${C.TYPES.map(t => opt(t[0], t[1] + ' ' + t[2], c.customer_type || 'importer')).join('')}</select></label>
        <label>国家 Country<input name="country" list="countries" value="${esc(c.country || '')}"></label>${inp('state', '州/省 State/Region (缩写如 CA, ON)')}${inp('city', '城市 City')}${inp('address', '地址 Address')}
        ${inp('company_phone', '公司电话 Phone', 'tel')}${inp('whatsapp', 'WhatsApp（含国家码）', 'tel')}${inp('company_email', '公司邮箱 Email', 'email')}${inp('website', '网站 Website')}</div>
      <datalist id="countries">${Object.keys(C.TZ).map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <h3>采购联系人 Purchasing contact <small>只填已核实的信息</small></h3><div class="g3">${inp('contact_name', '姓名 Name')}${inp('contact_title', '职位 Title')}${inp('contact_linkedin', 'LinkedIn URL')}</div>
      <h3>业务 Business</h3><div class="prods">${C.PRODUCTS.map(p => `<label class="ck"><input type="checkbox" name="products" value="${p[0]}" ${(c.products || []).includes(p[0]) ? 'checked' : ''}> ${p[1]} <small>${p[2]}</small></label>`).join('')}</div>
      <div class="g3"><label>优先级 Priority<select name="priority">${C.PRIORITIES.map(v => opt(v, v, c.priority)).join('')}</select></label>
        <label>跟进状态 Status<select name="status">${C.STATUSES.filter(s => admin || s[0] !== '无效' || c.status === '无效').map(s => opt(s[0], s[0] + ' ' + s[1], c.status)).join('')}</select></label>
        ${admin ? `<label>负责业务员 Owner<select name="owner_id">${opt('', '公海 Pool（未分配）', c.owner_id || '')}${UI.USERS.filter(u => u.active).map(u => opt(u.id, u.full_name + ' (' + u.username + ')', isNew && !prefill ? UI.ME.id : c.owner_id)).join('')}</select></label>` : `<label>负责业务员 Owner<input disabled value="${esc(isNew ? UI.ME.full_name : UI.userName(c.owner_id))}"></label>`}
        ${inp('next_follow_up', '下次跟进 Next follow-up', 'date')}<label>标签 Tags（逗号分隔）<input name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="展会2026, 私标, 大客户"></label></div>
      <label>Apollo 搜索条件 Apollo search criteria<textarea name="apollo_criteria" rows="2">${esc(c.apollo_criteria || '')}</textarea></label>
      <label>备注 Notes<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
      <label>来源/核实说明 Source / verification<textarea name="source_note" rows="2">${esc(c.source_note || '')}</textarea></label>
      <div class="warn" id="uswarn" hidden>⚠️ 美国市场不推强化/实木复合地板 (USA: no laminate / engineered)</div>
      <div class="actions"><button class="primary">保存 Save</button></div></form>`, isNew ? 'list' : 'list');
    const f = $('#cf'), chk = () => { $('#uswarn').hidden = !(/^(usa|us|united states)$/i.test(f.country.value.trim()) && [...f.querySelectorAll('[name=products]:checked')].some(x => C.US_EXCLUDED.includes(x.value))); };
    f.oninput = chk; chk();
    let dupOk = false;
    const dupCheck = async () => { if (!isNew) return []; const d = await DB.checkDuplicate({ name: f.company_name.value, website: f.website.value, phone: f.company_phone.value });
      $('#dupbox').innerHTML = d.length ? `<div class="warn">⚠️ 可能重复 Possible duplicate：${d.map(x => `<div>「${esc(x.company_name || '（他人客户 another rep’s client）')}」 匹配 ${esc(x.match)} · 归属 <b>${esc(x.owner_name)}</b> ${x.client_id ? `<a href="#/client/${esc(x.client_id)}">查看</a>` : ''}</div>`).join('')}</div>` : ''; return d; };
    if (isNew) ['company_name', 'website', 'company_phone'].forEach(k => f[k].addEventListener('change', dupCheck));
    f.onsubmit = async e => { e.preventDefault(); const d = {};
      ['company_name', 'customer_type', 'country', 'state', 'city', 'address', 'company_phone', 'whatsapp', 'company_email', 'website', 'contact_name', 'contact_title', 'contact_linkedin', 'priority', 'status', 'apollo_criteria', 'notes', 'source_note'].forEach(k => d[k] = f[k].value.trim());
      d.state = d.state.toUpperCase().length <= 3 ? d.state.toUpperCase() : d.state; d.next_follow_up = f.next_follow_up.value || null;
      d.tags = f.tags.value.split(/[,，;；]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      d.products = [...f.querySelectorAll('[name=products]:checked')].map(x => x.value); if (admin) d.owner_id = f.owner_id.value || null;
      try {
        if (isNew && !dupOk) { const dups = await dupCheck(); if (dups.length) { if (!admin) return UI.toast('该客户已存在，不能重复创建；请联系管理员', 1); if (!confirm('发现可能重复，仍然保存？')) return; dupOk = true; } }
        const r = isNew ? await DB.createClient(d, { allowDuplicate: dupOk }) : await DB.updateClient(c.id, d); UI.toast('已保存 Saved'); location.hash = '#/client/' + r.id;
      } catch (err) { UI.toast(err.message, 1); } };
  }
  UI.form = form;
  UI.views.list = { render: () => { delete F.group; delete F.email_due; return list(); } };
  UI.views.invalid = { render: owner => { UI.setFilters({ group: 'invalid', ...(owner ? { owner } : {}) }); return list(); } };
  UI.views['email-reminders'] = { render: owner => { UI.setFilters({ email_due: true, ...(owner ? { owner } : {}) }); return list(); } };
  UI.views.client = { render: detail };
  UI.views.new = { render: () => form(null, UI._prefill ? (() => { const p = UI._prefill; UI._prefill = null; return p; })() : null) };
})();
