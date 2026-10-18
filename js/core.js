/* Core: helpers, app shell, router. Views register in UI.views */
(function () {
  const cfg = window.CRM_CONFIG;
  const UI = window.UI = { views: {}, ME: null, USERS: [], CLIENTS: [] };
  const $ = UI.$ = s => document.querySelector(s); UI.$$ = s => [...document.querySelectorAll(s)];
  UI.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = UI.esc;
  UI.today = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toLocaleDateString('sv-SE'); };  // local YYYY-MM-DD
  UI.daysAgo = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null;
  UI.userName = id => { const u = UI.USERS.find(x => x.id === id); return u ? u.full_name : (id ? '—' : '公海 Pool'); };
  UI.toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', 3000); };
  UI.url = u => !u ? '' : (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  UI.dial = c => C.DIAL[c && c.country] || '';
  UI.e164 = (p, c) => { let d = String(p || '').replace(/[^\d+]/g, ''); if (!d) return ''; if (d.startsWith('+')) return d; if (d.startsWith('00')) return '+' + d.slice(2);
    const cc = UI.dial(c); if (!cc) return d; if (cc === '1') return d.length === 11 && d[0] === '1' ? '+' + d : '+1' + d; return '+' + cc + d.replace(/^0/, ''); };
  UI.tel = (p, c) => 'tel:' + UI.e164(p, c);
  UI.wa = (p, c, text) => { const n = UI.e164(p, c).replace(/\D/g, ''); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : ''; };
  UI.localTime = c => { const tz = C.tzFor(c); if (!tz) return null; const now = new Date();
    const t = now.toLocaleTimeString('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const wd = now.toLocaleDateString('zh-CN', { timeZone: tz, weekday: 'short' }); const h = +now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }) % 24;
    const day = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }); const work = h >= 9 && h < 17 && !['Sat', 'Sun'].includes(day);
    return { text: `${wd} ${t}`, work, tz }; };
  UI.ltBadge = c => { const l = UI.localTime(c); return l ? `<span class="lt ${l.work ? 'on' : ''}" title="${esc(l.tz)}">🕘 当地 ${esc(l.text)}${l.work ? ' · 工作时间' : ''}</span>` : ''; };
  UI.prBadge = p => p ? `<span class="pri pri-${p.replace('+', 'p')}">${esc(p)}</span>` : '';
  UI.stBadge = s => s ? `<span class="st st-${C.STATUSES.findIndex(x => x[0] === s)}">${esc(s)}<small>${esc(C.statusEN(s))}</small></span>` : '';
  UI.chips = arr => (arr || []).map(k => `<span class="chip" title="${esc(C.productEN(k))}">${esc(C.productName(k))}</span>`).join('');
  UI.tags = arr => (arr || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  UI.opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  UI.dueBadge = d => { if (!d) return ''; const t = UI.today(); return `<span class="due ${d < t ? 'over' : d === t ? 'today' : ''}">${d < t ? '逾期 ' : d === t ? '今天 ' : ''}${esc(d)}</span>`; };
  UI.link = (href, text, cls) => href ? `<a class="${cls || ''}" href="${esc(href)}" ${/^https?:/.test(href) ? 'target="_blank" rel="noopener"' : ''}>${esc(text)}</a>` : '';
  UI.download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  UI.copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } UI.toast('已复制 Copied'); };
  UI.loadXLSX = () => window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Excel 库加载失败（需联网），请用 CSV')); document.head.appendChild(s); });
  UI.modal = (html, onMount) => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="modal-box card">${html}<button class="ghost sm mclose" aria-label="close">✕</button></div>`;
    document.body.appendChild(m); const close = () => m.remove(); m.querySelector('.mclose').onclick = close; m.onclick = e => { if (e.target === m) close(); }; if (onMount) onMount(m, close); return close; };
  UI.overdue = list => list.filter(c => c.next_follow_up && c.next_follow_up < UI.today() && !(UI.isInvalid ? UI.isInvalid(c) : c.status === '无效') && c.status !== '成交');

  // ---------- shell ----------
  const NAV = [
    ['home', '#/home', '🏠', '工作台', 'Today'], ['list', '#/list', '📇', '客户', 'Clients'], ['prospect', '#/prospect', '🔎', '找客户', 'Prospecting'],
    ['templates', '#/templates', '✉️', '话术模板', 'Templates'], ['markets', '#/markets', '🌍', '目标市场', 'Markets'],
    ['pool', '#/pool', '🌊', '公海', 'Pool'], ['dash', '#/dashboard', '📊', '团队看板', 'Dashboard', 'admin'], ['admin', '#/admin', '⚙️', '管理', 'Admin', 'admin'],
    ['invalid', '#/invalid', '📁', '无效客户', 'Invalid'], ['email-reminders', '#/email-reminders', '✉️', '邮件提醒', 'Reminders']
  ];
  UI.shell = (inner, active) => {
    const admin = UI.ME.role === 'admin', nav = NAV.filter(n => !n[5] || admin), od = UI.overdue(UI.CLIENTS.filter(c => c.owner_id === UI.ME.id)).length;
    return `<header class="top"><a class="brand" href="#/home">${cfg.LOGO_URL ? `<img src="${esc(cfg.LOGO_URL)}" alt="">` : '<div class="logo">F</div>'}
      <div><div class="bn">${esc(cfg.COMPANY_NAME_CN)}</div><div class="bs">${esc(cfg.COMPANY_NAME_EN)} · CRM</div></div></a>
      <nav>${nav.map(n => `<a href="${n[1]}" class="${active === n[0] ? 'on' : ''}">${n[3]}${n[0] === 'home' && od ? `<b class="dot">${od}</b>` : ''} <small>${n[4]}</small></a>`).join('')}</nav>
      <div class="me"><a href="#/me" class="mename">${esc(UI.ME.full_name)} <em>${admin ? '管理员 Admin' : '业务员 Sales'}</em></a><button class="ghost sm" id="logout">退出</button></div></header>
      ${cfg.MODE === 'demo' ? '<div class="demo">演示模式 Demo — 数据仅保存在本浏览器 · <a href="#" id="resetDemo">重置演示数据</a></div>' : ''}
      <main>${inner}</main>
      <nav class="tabbar">${[nav[0], nav[1], nav[2], nav[3], admin ? NAV[6] : NAV[4]].map(n => `<a href="${n[1]}" class="${active === n[0] ? 'on' : ''}"><span>${n[2]}</span>${n[3]}${n[0] === 'home' && od ? `<b class="dot">${od}</b>` : ''}</a>`).join('')}</nav>`;
  };
  UI.bindShell = () => {
    $('#logout').onclick = async () => { await DB.logout(); UI.ME = null; location.hash = '#/login'; route(); };
    const r = $('#resetDemo'); if (r) r.onclick = e => { e.preventDefault(); if (confirm('重置所有演示数据？Reset demo data?')) { DB.reset(); route(); } };
  };
  UI.render = (inner, active) => { $('#app').innerHTML = UI.shell(inner, active); UI.bindShell(); window.scrollTo(0, 0); };

  // ---------- login ----------
  function viewLogin() {
    $('#app').innerHTML = `<div class="login"><div class="card login-card">
      <div class="brand big">${cfg.LOGO_URL ? `<img src="${esc(cfg.LOGO_URL)}" alt="">` : '<div class="logo">F</div>'}<div><div class="bn">${esc(cfg.COMPANY_NAME_CN)}</div><div class="bs">${esc(cfg.COMPANY_NAME_EN)}</div></div></div>
      <h1>外贸客户管理系统 <span>Export CRM</span></h1>
      <form id="lf"><label>${cfg.MODE === 'supabase' ? '用户名或邮箱 Username or email' : '用户名 Username'}<input name="u" autocomplete="username" autocapitalize="off" required></label>
      <label>密码 Password<input name="p" type="password" autocomplete="current-password" required></label>
      <button class="primary wide">登录 Sign in</button><div class="err" id="lerr"></div></form>
      ${cfg.MODE === 'demo' ? '<p class="hint">演示账号 Demo: <b>admin / admin123</b>（老板）· <b>sales1 ~ sales4 / sales123</b>（业务员）</p>' : ''}</div></div>`;
    $('#lf').onsubmit = async e => { e.preventDefault(); const f = e.target;
      try { UI.ME = await DB.login(f.u.value, f.p.value); location.hash = '#/home'; route(); } catch (err) { $('#lerr').textContent = err.message; } };
  }
  UI.refresh = async () => { [UI.USERS, UI.CLIENTS] = await Promise.all([DB.listUsers(), DB.listClients()]); };

  async function route() {
    try {
      if (!UI.ME) UI.ME = await DB.currentUser();
      if (!UI.ME) return viewLogin();
      await UI.refresh();
      const h = location.hash || '#/home', [, name, arg] = h.match(/^#\/([^/?]+)\/?([^?]*)/) || [, 'home'];
      const v = UI.views[name] || UI.views.home;
      if (v.admin && UI.ME.role !== 'admin') return UI.views.home.render();
      await v.render(decodeURIComponent(arg || ''));
    } catch (e) { console.error(e); $('#app').innerHTML = `<div class="card pad" style="margin:40px">出错了 Error: ${esc(e.message)} <p><a href="#/home" onclick="location.reload()">重新加载</a></p></div>`; }
  }
  UI.route = route;
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => { });

})();
