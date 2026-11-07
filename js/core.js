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
  const localTimes = new Map();
  let localMinute = -1;
  UI.localTime = c => { const tz = C.tzFor(c); if (!tz) return null; const now = new Date();
    const minute = Math.floor(now.getTime() / 60000);
    if (minute !== localMinute) { localTimes.clear(); localMinute = minute; }
    if (localTimes.has(tz)) return localTimes.get(tz);
    const t = now.toLocaleTimeString('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const wd = now.toLocaleDateString('zh-CN', { timeZone: tz, weekday: 'short' }); const h = +now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }) % 24;
    const day = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }); const work = h >= 9 && h < 17 && !['Sat', 'Sun'].includes(day);
    const value = { text: wd + ' ' + t, work, tz };
    localTimes.set(tz, value);
    return value; };
  UI.ltBadge = c => { const l = UI.localTime(c); return l ? `<span class="lt ${l.work ? 'on' : ''}" title="${esc(l.tz)}">🕘 当地 ${esc(l.text)}${l.work ? ' · 工作时间' : ''}</span>` : ''; };
  UI.prBadge = p => p ? `<span class="pri pri-${esc(p.replace('+', 'p'))}" title="${esc(C.PRIORITY_DEFINITIONS?.[p] || '旧等级，等待按新定义重新核实')}">${esc(p)} ${esc(C.PRIORITY_NAMES?.[p] || '旧等级待复核')}</span>` : '<span class="muted">待分级</span>';
  UI.gradeGuide = () => `<section aria-label="优先级解释" style="padding:10px 14px;font-size:13px;line-height:1.65"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:5px 16px">${C.PRIORITIES.map(p=>`<div><b>${p} ${C.PRIORITY_NAMES[p]}</b>：${esc(C.PRIORITY_DEFINITIONS[p])}</div>`).join('')}</div><small class="muted">等级不代表成交、采购意向或官方进口认证；进口证据另行记录。美国排除所有地板（含SPC），仅开发墙板、格栅、木饰面与吸音板。</small></section>`;
  UI.stBadge = s => s ? `<span class="st st-${C.STATUSES.findIndex(x => x[0] === s)}">${esc(s)}<small>${esc(C.statusEN(s))}</small></span>` : '';
  UI.chips = arr => (arr || []).map(k => `<span class="chip" title="${esc(C.productEN(k))}">${esc(C.productName(k))}</span>`).join('');
  UI.tags = arr => (arr || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  UI.opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  UI.dueBadge = d => { if (!d) return ''; const t = UI.today(); return `<span class="due ${d < t ? 'over' : d === t ? 'today' : ''}">${d < t ? '逾期 ' : d === t ? '今天 ' : ''}${esc(d)}</span>`; };
  UI.link = (href, text, cls) => href ? `<a class="${cls || ''}" href="${esc(href)}" ${/^https?:/.test(href) ? 'target="_blank" rel="noopener"' : ''}>${esc(text)}</a>` : '';
  UI.canExport = () => !!UI.ME?.active && UI.ME.username === 'boss' && UI.ME.role === 'admin';
  UI.requireExport = async () => {
    try { if(!UI.canExport()) throw new Error('仅老板账号可以导出表格或备份');
      if(DB.mode!=='demo' && DB.chk(await DB.init().rpc('crm_can_export'))!==true) throw new Error('仅老板账号可以导出表格或备份');
      return true;
    } catch(e) { UI.toast(e.message,true);return false; }
  };
  UI.download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  UI.copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } UI.toast('已复制 Copied'); };
  UI.loadXLSX = () => window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Excel 库加载失败（需联网），请用 CSV')); document.head.appendChild(s); });
  UI.modal = (html, onMount) => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="modal-box card">${html}<button class="ghost sm mclose" aria-label="close">✕</button></div>`;
    document.body.appendChild(m); const close = () => m.remove(); m.querySelector('.mclose').onclick = close; m.onclick = e => { if (e.target === m) close(); }; if (onMount) onMount(m, close); return close; };
  UI.overdue = list => {
    const today = UI.today();
    return list.filter(c => c.next_follow_up && c.next_follow_up < today && !(UI.isInvalid ? UI.isInvalid(c) : c.status === '无效') && c.status !== '成交');
  };

  // ---------- shell ----------
  const NAV = [
    ['reminders','#/reminders','⏰','闹钟事项','My reminders','','个人安排'],
    ['home','#/home','🏠','工作台','Today','','概览'],
    ['list','#/list','📇','客户管理','Clients','','客户开发'],['pool','#/pool','🌊','谷歌客户公海','Google Lead Pool','','客户开发'],['invalid','#/invalid','📁','无效客户','Invalid','','客户开发'],
    ['prospect','#/prospect','🔎','找客户','Prospecting','','获客工具'],['lookup-tools','#/lookup-tools','🔍','客户核实工具','Verification','','获客工具'],['markets','#/markets','🌍','目标市场','Markets','','获客工具'],['agent','#/ai','🤖','智能助手','Assistant','','获客工具'],
    ['mail','#/mail','📨','邮件中心','Email','','沟通跟进'],['email-reminders','#/email-reminders','⏰','跟进提醒','Reminders','','沟通跟进'],['templates','#/templates','✉️','话术模板','Templates','','沟通跟进'],
    ['business','#/business','📈','业务工作台','Business','','业务与培训'],['learning','#/learning','📚','学习中心','Learning','','业务与培训'],
    ['dash','#/dashboard','📊','团队看板','Dashboard','admin','管理中心'],['admin','#/admin','⚙️','系统管理','Admin','admin','管理中心']
  ];
  UI.shell = (inner, active) => {
    const admin = UI.ME.role === 'admin', nav = NAV.filter(n => !n[5] || admin), od = UI.overdue(UI.CLIENTS.filter(c => c.owner_id === UI.ME.id)).length;
    const groups = [...new Set(nav.map(n => n[6]))];
    const links = groups.map(group => `<div class="side-group"><div class="side-label">${group}</div>${nav.filter(n => n[6] === group).map(n => `<a href="${n[1]}" class="side-link ${active === n[0] ? 'on' : ''}" ${active === n[0] ? 'aria-current="page"' : ''}><span class="side-icon">${n[2]}</span><span>${n[3]}</span>${n[0] === 'home' && od ? `<b class="dot">${od}</b>` : ''}</a>`).join('')}</div>`).join('');
    const mobile = ['home','list','prospect','learning','agent'].map(id => nav.find(n => n[0] === id)).filter(Boolean);
    return `<div class="app-layout"><aside class="app-sidebar"><a class="brand" href="#/home">${cfg.LOGO_URL ? `<img src="${esc(cfg.LOGO_URL)}" alt="">` : '<div class="logo">F</div>'}<div><div class="bn">${esc(cfg.COMPANY_NAME_CN)}</div><div class="bs">${esc(cfg.COMPANY_NAME_EN)} · CRM</div></div></a><div class="side-scroll">${links}</div><div class="side-account"><a href="#/me" class="account-link"><span class="avatar">${esc((UI.ME.full_name || '?').slice(0,1))}</span><span><b>${esc(UI.ME.full_name)}</b><small>${admin ? '管理员' : '业务员'}</small></span></a><button class="ghost sm" id="logout">退出</button></div></aside><button class="sidebar-shade" id="sidebarShade" aria-label="关闭导航"></button><section class="app-content"><header class="mobile-top"><button class="ghost sm mobile-menu" id="menuToggle" aria-expanded="false">☰ 导航</button><a class="brand" href="#/home"><div class="logo">F</div><div class="bn">${esc(cfg.COMPANY_NAME_CN)}</div></a><a href="#/me" class="mobile-user">${esc(UI.ME.full_name)}</a><button class="ghost sm mobile-logout" id="logoutMobile">退出</button></header>
      ${cfg.MODE === 'demo' ? '<div class="demo">演示模式 Demo — 数据仅保存在本浏览器 · <a href="#" id="resetDemo">重置演示数据</a></div>' : ''}<main>${inner}</main></section><nav class="tabbar">${mobile.map(n => `<a href="${n[1]}" class="${active === n[0] ? 'on' : ''}"><span>${n[2]}</span>${n[3]}</a>`).join('')}</nav></div>`;
  };
  UI.bindShell = () => {
    $('#logout').onclick = async () => { UI.REMINDERS?.clear(); await DB.logout(); UI.ME = null; UI.invalidateDirectory(); location.hash = '#/login'; route(); };
    const menu = $('#menuToggle'), layout = $('.app-layout'), shade = $('#sidebarShade');
    if (menu && layout) menu.onclick = () => { const open=layout.classList.toggle('menu-open'); menu.setAttribute('aria-expanded',String(open)); };
    if (shade && layout) shade.onclick = () => { layout.classList.remove('menu-open'); menu?.setAttribute('aria-expanded','false'); };
    const lm = $('#logoutMobile'); if (lm) lm.onclick = $('#logout').onclick;
    const r = $('#resetDemo'); if (r) r.onclick = e => { e.preventDefault(); if (confirm('重置所有演示数据？Reset demo data?')) { DB.reset(); route(); } };
  };
  let renderedHash, renderedUser;
  UI.render = (inner, active) => {
    const sameUser = renderedUser === UI.ME?.id;
    const sidebarTop = sameUser ? $('.side-scroll')?.scrollTop || 0 : 0;
    const pageTop = sameUser && renderedHash === location.hash ? window.scrollY : 0;
    renderedHash = location.hash;
    renderedUser = UI.ME?.id;
    $('#app').innerHTML = UI.shell(inner, active);
    UI.bindShell();
    const sidebar = $('.side-scroll');
    if (sidebar) sidebar.scrollTop = sidebarTop;
    window.scrollTo(0, pageTop);
  };

  // Cache read-only view data briefly; writes still use the server's checks.
  UI.viewRead = load => {
    let user, expires = 0, request;
    const read = () => {
      if (user === UI.ME && request && Date.now() < expires) return request;
      user = UI.ME;
      expires = Date.now() + 30000;
      const next = request = Promise.resolve().then(load);
      next.catch(() => { if (request === next) read.clear(); });
      return next;
    };
    read.clear = () => { request = null; expires = 0; };
    return read;
  };
  UI.archiveVisible = UI.viewRead(() => DB.canDeleteClients());

  // Request guards keep an earlier slow response from replacing a newer view.
  UI.viewCurrent = () => {
    const hash = location.hash, user = UI.ME, version = navigation;
    return () => hash === location.hash && user === UI.ME && version === navigation;
  };

  // ---------- login ----------
  function viewLogin() {
    renderedHash = renderedUser = undefined;
    $('#app').innerHTML = `<div class="login"><div class="card login-card">
      <div class="brand big">${cfg.LOGO_URL ? `<img src="${esc(cfg.LOGO_URL)}" alt="">` : '<div class="logo">F</div>'}<div><div class="bn">${esc(cfg.COMPANY_NAME_CN)}</div><div class="bs">${esc(cfg.COMPANY_NAME_EN)}</div></div></div>
      <h1>外贸客户管理系统 <span>Export CRM</span></h1>
      <form id="lf"><label>${cfg.MODE === 'supabase' ? '用户名或邮箱 Username or email' : '用户名 Username'}<input name="u" autocomplete="username" autocapitalize="off" required></label>
      <label>密码 Password<input name="p" type="password" autocomplete="current-password" required></label>
      <button class="primary wide">登录 Sign in</button><div class="err" id="lerr"></div></form>
      ${cfg.MODE === 'demo' ? '<p class="hint">演示账号 Demo: <b>admin / admin123</b>（老板）· <b>sales1 ~ sales4 / sales123</b>（业务员）</p>' : ''}</div></div>`;
    $('#lf').onsubmit = async e => { e.preventDefault(); const f = e.target;
      try { UI.ME = await DB.login(f.u.value, f.p.value); UI.invalidateDirectory(); location.hash = '#/home'; route(); } catch (err) { $('#lerr').textContent = err.message; } };
  }
  const DIRECTORY_TTL=30000; let directoryLoadedAt=0,directoryRequest=null,directoryEpoch=0; UI.invalidateDirectory=()=>{directoryLoadedAt=0;directoryEpoch++;directoryRequest=null;}; UI.refresh=async({force=true}={})=>{if(!force&&directoryLoadedAt&&Date.now()-directoryLoadedAt<DIRECTORY_TTL)return; if(directoryRequest)return directoryRequest; const epoch=directoryEpoch; directoryRequest=Promise.all([DB.listUsers(),DB.listClients()]).then(([users,clients])=>{if(epoch===directoryEpoch){UI.USERS=users;UI.CLIENTS=clients;directoryLoadedAt=Date.now();}}).finally(()=>{directoryRequest=null;}); return directoryRequest;};

  let navigation = 0;
  async function route() {
    const currentNavigation = ++navigation, hash = location.hash || '#/home';
    const main = $('.app-content main');
    const links = UI.$$('.app-sidebar a[href^="#/"], .tabbar a[href^="#/"]');
    const section = hash.split('/').slice(0, 2).join('/');
    const target = links.some(link => link.getAttribute('href') === section) ? section : null;
    if (target) for (const link of links) {
      const active = link.getAttribute('href') === target;
      link.classList.toggle('on', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    if (main) main.setAttribute('aria-busy', 'true');
    let pending;
    const loading = setTimeout(() => {
      if (currentNavigation === navigation && main?.isConnected) {
        const indicator = document.createElement('div');
        indicator.className = 'info';
        indicator.setAttribute('role', 'status');
        indicator.textContent = '正在加载页面…';
        main.prepend(indicator);
        pending = indicator;
      }
    }, 120);
    try {
      if (!UI.ME) UI.ME = await DB.currentUser();
      if (currentNavigation !== navigation) return;
      if (!UI.ME) return viewLogin();
      if(!directoryLoadedAt)await UI.refresh({force:false});else UI.refresh({force:false}).catch(e=>console.warn('Background directory refresh unavailable'));      if (currentNavigation !== navigation) return;
      const h = location.hash || '#/home', [, name, arg] = h.match(/^#\/([^/?]+)\/?([^?]*)/) || [, 'home'];
      const v = UI.views[name] || UI.views.home;
      if (v.admin && UI.ME.role !== 'admin') return UI.views.home.render();
      await v.render(decodeURIComponent(arg || ''));
    } catch (e) { if (currentNavigation !== navigation) return; console.error(e); $('#app').innerHTML = `<div class="card pad" style="margin:40px">出错了 Error: ${esc(e.message)} <p><a href="#/home" onclick="location.reload()">重新加载</a></p></div>`; }
    finally {
      clearTimeout(loading);
      pending?.remove();
      if (currentNavigation === navigation) main?.removeAttribute('aria-busy');
    }
  }
  UI.route = route;
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => { });

})();
