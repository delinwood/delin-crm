(function () {
  const { esc, opt, $, $$ } = UI;
  const row = c => `<li><a href="#/client/${esc(c.id)}"><b>${esc(c.company_name)}</b></a> ${UI.attentionBadge(c)} ${UI.prBadge(c.priority)} ${UI.stBadge(c.status)}
    <div class="muted small">${esc([c.state, c.country].filter(Boolean).join(', '))} · ${UI.dueBadge(c.next_follow_up) || '未设跟进'} ${UI.ltBadge(c)} ${UI.ME.role === 'admin' ? '· ' + esc(UI.userName(c.owner_id)) : ''}</div>
    <div class="qa">${c.company_phone ? UI.link(UI.tel(c.company_phone, c), '📞', 'btn ghost sm') : ''}${c.company_email ? UI.link('mailto:' + c.company_email, '✉️', 'btn ghost sm') : ''}${UI.wa(c.whatsapp || c.company_phone, c) ? UI.link(UI.wa(c.whatsapp || c.company_phone, c), '💬', 'btn ghost sm') : ''}<a class="btn ghost sm" href="#/templates/${esc(c.id)}">✍️</a><a class="btn ghost sm" href="#/client/${esc(c.id)}">记录 ›</a></div></li>`;

  async function home() {
    const me = UI.ME, admin = me.role === 'admin', t = UI.today();
    const mine = UI.CLIENTS.filter(c => admin ? true : c.owner_id === me.id).filter(c => !UI.isInvalid(c));
    const emailDue = mine.filter(c => (admin || c.owner_id === me.id) && UI.emailDue(c))
      .sort((a, b) => ['紧急','重要','普通'].indexOf(UI.attention(a)) - ['紧急','重要','普通'].indexOf(UI.attention(b)));
    const scope = admin ? mine : mine;
    const over = scope.filter(c => c.next_follow_up && c.next_follow_up < t && c.status !== '成交').sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
    const today = scope.filter(c => c.next_follow_up === t);
    const week = scope.filter(c => c.next_follow_up > t && c.next_follow_up <= UI.today(7)).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
    const fresh = scope.filter(c => c.status === '未联系' && !c.next_follow_up).sort((a, b) => ({ 'A+': 0, A: 1, B: 2, C: 3 }[a.priority] ?? 9) - ({ 'A+': 0, A: 1, B: 2, C: 3 }[b.priority] ?? 9));
    const since = UI.today(-6), logs = (await DB.listAllLogs(since)).filter(l => admin || l.author_id === me.id);
    const samples = (await DB.listSamples()).filter(s => s.status === '已寄出' || s.status === '已签收');
    const quotes = (await DB.listQuotes()).filter(q => q.valid_until && q.valid_until >= t && q.valid_until <= UI.today(7));
    const hour = new Date().getHours();
    UI.render(`<div class="pagehead"><h1>${hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'}，${esc(me.full_name)} <small>${esc(t)} · ${admin ? '全团队视图 Team view' : '我的工作台 My day'}</small></h1>
      <div class="actions"><a class="btn ghost" href="#/prospect">🔎 找客户</a><a class="btn primary" href="#/new">+ 新建客户</a></div></div>
      <section class="kpis k5">
        <a class="kpi warn" href="#/list" data-due="overdue"><b>${over.length}</b><span>已逾期 Overdue</span></a>
        <a class="kpi" href="#/list" data-due="today"><b>${today.length}</b><span>今日待跟进 Today</span></a>
        <a class="kpi" href="#/list" data-due="week"><b>${week.length}</b><span>7天内 This week</span></a>
        <a class="kpi" href="#/list" data-st="未联系"><b>${scope.filter(c => c.status === '未联系').length}</b><span>未联系 New leads</span></a>
        <div class="kpi"><b>${logs.length}</b><span>本周跟进 Logged (7d)</span></div></section>
      <section class="card pad"><div class="sec-h"><h2>✉️ 每3天邮件跟进 <small>${emailDue.length} 家已到期</small></h2><a href="#/email-reminders">查看全部提醒 ›</a></div>
        <p class="muted small">领取或新建自己的客户后3天提醒；登记一条邮件跟进后重新计时。无效客户停止提醒。仅在系统内提醒。</p>
        <ul class="todo">${emailDue.slice(0, 15).map(row).join('') || '<li class="muted">暂无到期邮件跟进任务</li>'}</ul></section>
      <div class="grid3">
        <section class="card pad"><h2>🔴 逾期 + 今日 <small>Overdue & today</small></h2><ul class="todo">${[...over, ...today].slice(0, 30).map(row).join('') || '<li class="muted">🎉 没有逾期或今日任务</li>'}</ul></section>
        <section class="card pad"><h2>📅 未来7天 <small>Upcoming</small></h2><ul class="todo">${week.slice(0, 20).map(row).join('') || '<li class="muted">无</li>'}</ul>
          <h2 style="margin-top:18px">📦 样品在途/待反馈 <small>Samples</small></h2><ul class="todo">${samples.slice(0, 10).map(s => { const c = UI.CLIENTS.find(x => x.id === s.client_id) || {}; return `<li><a href="#/client/${esc(s.client_id)}"><b>${esc(c.company_name || '')}</b></a> <span class="tag">${esc(s.status)}</span><div class="muted small">${esc(s.items)} · ${esc(s.sent_date || '')} ${esc(s.courier || '')}</div></li>`; }).join('') || '<li class="muted">无</li>'}</ul>
          <h2 style="margin-top:18px">⏳ 7天内到期报价 <small>Quotes expiring</small></h2><ul class="todo">${quotes.map(q => { const c = UI.CLIENTS.find(x => x.id === q.client_id) || {}; return `<li><a href="#/client/${esc(q.client_id)}"><b>${esc(c.company_name || '')}</b></a> ${esc(q.currency)} ${esc(q.price)}/${esc(q.unit)} · 到期 ${esc(q.valid_until)}</li>`; }).join('') || '<li class="muted">无</li>'}</ul></section>
        <section class="card pad"><h2>🆕 新线索·还没联系 <small>Start here (by priority)</small></h2><ul class="todo">${fresh.slice(0, 15).map(row).join('') || '<li class="muted">无</li>'}</ul>${fresh.length > 15 ? `<a href="#/list" data-st="未联系">查看全部 ${fresh.length} ›</a>` : ''}</section>
      </div>`, 'home');
    $$('[data-due],[data-st]').forEach(a => a.onclick = () => { const F = {}; if (a.dataset.due) F.due = a.dataset.due; if (a.dataset.st) F.status = a.dataset.st; if (!admin) F.owner = ''; UI.setFilters(F); });
  }

  // ---------------- DASHBOARD (admin) ----------------
  let STALE = 14;
  async function dash() {
    const t = UI.today(), all = UI.CLIENTS, sales = UI.USERS.filter(u => u.active && (u.role === 'sales' || all.some(c => c.owner_id === u.id)));
    const [logs, quotes, samples, audit] = await Promise.all([DB.listAllLogs(UI.today(-29)), DB.listQuotes(), DB.listSamples(), DB.listAudit({ limit: 25 })]);
    const wk = UI.today(-6), lastAct = {}; logs.forEach(l => { if (!lastAct[l.client_id] || l.entry_date > lastAct[l.client_id]) lastAct[l.client_id] = l.entry_date; });
    const lastTouch = c => c.last_follow_up || (c.updated_at || '').slice(0, 10) || (c.created_at || '').slice(0, 10);
    const stale = all.filter(c => c.owner_id && !UI.isInvalid(c) && c.status !== '成交' && UI.daysAgo(lastTouch(c)) >= STALE).sort((a, b) => lastTouch(a).localeCompare(lastTouch(b)));
    const funnel = C.STATUSES.map(s => [s[0], s[1], all.filter(c => c.status === s[0]).length]), max = Math.max(1, ...funnel.map(f => f[2]));
    const days = [...Array(14)].map((_, i) => UI.today(i - 13)), perDay = days.map(d => logs.filter(l => l.entry_date === d).length), maxD = Math.max(1, ...perDay);
    const per = sales.map(u => { const cs = all.filter(c => c.owner_id === u.id);
      return { u, n: cs.length, st: Object.fromEntries(C.STATUSES.map(s => [s[0], cs.filter(c => c.status === s[0]).length])), over: UI.overdue(cs).length,
        wk: logs.filter(l => l.author_id === u.id && l.entry_date >= wk).length, q: quotes.filter(q => q.author_id === u.id && q.quote_date >= UI.today(-29)).length,
        s: samples.filter(s => s.author_id === u.id && (s.sent_date || '') >= UI.today(-29)).length, stale: stale.filter(c => c.owner_id === u.id).length }; });
    const pool = all.filter(c => !c.owner_id).length;
    const byCountry = Object.entries(all.reduce((m, c) => (m[c.country || '—'] = (m[c.country || '—'] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    UI.render(`<div class="pagehead"><h1>团队看板 <small>Team dashboard</small></h1><div class="actions"><a class="btn ghost" href="#/pool">🌊 公海 ${pool}</a><a class="btn ghost" href="#/admin">⚙️ 管理</a></div></div>
      <section class="kpis k5"><div class="kpi"><b>${all.length}</b><span>客户总数 Clients</span></div><div class="kpi"><b>${pool}</b><span>公海未分配 Pool</span></div>
        <div class="kpi"><b>${logs.filter(l => l.entry_date >= wk).length}</b><span>本周跟进 Activities 7d</span></div><div class="kpi"><b>${quotes.filter(q => q.quote_date >= UI.today(-29)).length}</b><span>30天报价 Quotes</span></div>
        <div class="kpi warn"><b>${UI.overdue(all).length}</b><span>全队逾期 Overdue</span></div></section>
            <section class="card pad full"><h2>业务员表现 <small>Per salesperson</small></h2><div class="tblwrap"><table class="mini"><thead><tr><th>业务员</th><th>客户</th><th>未联系</th><th>已联系</th><th>已回复</th><th>已报价</th><th>成交</th><th>逾期</th><th>本周跟进</th><th>30天报价</th><th>30天样品</th><th>${STALE}天未动</th></tr></thead><tbody>
          ${per.map(p => `<tr><td><b>${esc(p.u.full_name)}</b></td><td>${p.n}</td>${['未联系', '已联系', '已回复', '已报价', '成交'].map(s => `<td>${p.st[s]}</td>`).join('')}<td class="${p.over ? 'red' : ''}">${p.over}</td><td>${p.wk}</td><td>${p.q}</td><td>${p.s}</td><td class="${p.stale ? 'red' : ''}">${p.stale}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card pad"><div class="sec-h"><h2>客户标记审查</h2><a href="#/invalid">无效客户及原因 ›</a></div><div class="tblwrap"><table class="mini"><thead><tr><th>业务员</th><th>紧急</th><th>重要</th><th>普通</th><th>无效</th><th>邮件提醒已到期</th></tr></thead><tbody>
      ${sales.map(u => { const cs = all.filter(c => c.owner_id === u.id); return `<tr><td>${esc(u.full_name)}</td>${['紧急','重要','普通'].map(l => `<td>${cs.filter(c => UI.attention(c) === l).length}</td>`).join('')}<td><a href="#/invalid/${esc(u.id)}">${cs.filter(UI.isInvalid).length}</a></td><td><a href="#/email-reminders/${esc(u.id)}">${cs.filter(UI.emailDue).length}</a></td></tr>`; }).join('')}</tbody></table></div></section>
      <div class="grid2">
        <section class="card pad"><h2>状态漏斗 <small>Pipeline funnel</small></h2>${funnel.map((f, i) => `<div class="fbar"><span>${esc(f[0])} <small>${esc(f[1])}</small></span><div><i class="st-${i}" style="width:${Math.max(2, f[2] / max * 100)}%"></i></div><b>${f[2]}</b></div>`).join('')}
          <h2 style="margin-top:20px">近14天跟进量 <small>Activity per day</small></h2><div class="spark">${days.map((d, i) => `<div title="${d}: ${perDay[i]}"><i style="height:${perDay[i] / maxD * 100}%"></i><small>${d.slice(8)}</small></div>`).join('')}</div></section>
        <section class="card pad"><h2>客户国家分布 <small>By country</small></h2><div class="chips">${byCountry.map(([k, v]) => `<span class="chip">${esc(k)} ${v}</span>`).join('')}</div></section></div>
      <div class="grid2">
        <section class="card pad"><div class="sec-h"><h2>久未跟进客户 <small>Stale clients</small></h2><select id="stale">${[7, 14, 30, 60].map(d => opt(d, d + ' 天以上未动', STALE)).join('')}</select></div>
          <ul class="todo">${stale.slice(0, 25).map(c => `<li><a href="#/client/${esc(c.id)}"><b>${esc(c.company_name)}</b></a> ${UI.prBadge(c.priority)} ${UI.stBadge(c.status)}<div class="muted small">${esc(UI.userName(c.owner_id))} · 最后动态 ${esc(lastTouch(c))}（${UI.daysAgo(lastTouch(c))}天前）</div></li>`).join('') || '<li class="muted">无</li>'}</ul>${stale.length > 25 ? `<p class="muted">还有 ${stale.length - 25} 家…</p>` : ''}</section>
        <section class="card pad"><h2>最近动态 <small>Recent activity (audit)</small></h2><ul class="audit">${audit.map(a => `<li><span class="muted">${esc(a.at.slice(5, 16).replace('T', ' '))}</span> <b>${esc(a.actor_name)}</b> · ${a.client_id ? `<a href="#/client/${esc(a.client_id)}">${esc(a.company_name)}</a>` : ''} ${UI.auditText(a)}</li>`).join('') || '<li class="muted">暂无</li>'}</ul></section></div>`, 'dash');
    $('#stale').onchange = e => { STALE = +e.target.value; dash(); };
  }
  UI.views.home = { render: home };
  UI.views.dashboard = { render: dash, admin: true };
})();
