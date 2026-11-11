(function () {
  const { esc, opt, $, $$ } = UI;
  const COUNTRIES = [...new Set((window.MARKETS || []).map(m => m.country).concat(['New Zealand', 'Ireland', 'Mexico', 'United Arab Emirates', 'Saudi Arabia', 'South Africa', 'Israel', 'Denmark', 'Finland', 'Chile']))];
  const P = JSON.parse(sessionStorage.getItem('fcrm_prospect') || '{"country":"Canada","group":"spc"}');
  const enc = encodeURIComponent, G = q => 'https://www.google.com/search?q=' + enc(q);
  const LOCAL_NAME = { Germany: 'Deutschland', France: 'France', Netherlands: 'Nederland', Poland: 'Polska', Italy: 'Italia', Spain: 'España', Czechia: 'Česko', Romania: 'România', Sweden: 'Sverige', Norway: 'Norge', 'Türkiye': 'Türkiye', Japan: '日本', Austria: 'Österreich', Switzerland: 'Schweiz', Belgium: 'Belgique' };

  function fairNames(s) {
    if (!s) return [];
    const useSemi = s.includes('；') || s.includes(';');
    const parts = [];
    let buf = '', depth = 0;
    for (const ch of s) {
      if (ch === '(' || ch === '（') depth++;
      else if ((ch === ')' || ch === '）') && depth) depth--;
      const sep = useSemi ? (ch === '；' || ch === ';') : ch === ',';
      if (sep && depth === 0) {
        if (buf.trim()) parts.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts;
  }

  function marketNote(m) {
    if (!m) return '';
    let stat = '中国份额 n/a';
    if (m.cn391810 && m.v391810) stat = `中国份额 ${Math.round(m.cn391810 / m.v391810 * 100)}%`;
    else if (m.q26 != null && window.MARKET_TEXT) stat = `2026年1–9月 ${window.MARKET_TEXT.wan(m.q26)} 万吨`;
    return `🌍 排名 #${m.rank} · ${stat} · 语言 ${esc(m.lang)}<br>适合：${esc(m.best)}`;
  }

  function links(country, group) {
    const lang = C.LANG[country] || 'en', kws = (C.KW[group][lang] || C.KW[group].en), en = C.KW[group].en, tw = C.TYPE_KW[lang] || C.TYPE_KW.en, place = LOCAL_NAME[country] || country;
    const out = { google: [], maps: [], linkedin: [], dirs: [], other: [] };
    kws.slice(0, 2).forEach(k => tw.forEach(t => out.google.push([`${k} ${t} ${place}`, G(`"${k}" ${t} ${place}`)])));
    if (lang !== 'en') en.slice(0, 1).forEach(k => out.google.push([`(EN) ${k} importer ${country}`, G(`"${k}" importer OR distributor ${country}`)]));
    out.google.push([`"dealers only / trade only" ${kws[0]}`, G(`"${kws[0]}" ("dealers only" OR "trade only" OR "wholesale only") ${place}`)]);
    out.google.push([`找品牌商 "find a dealer" ${kws[0]}`, G(`"${kws[0]}" "find a dealer" OR "where to buy" ${place}`)]);
    out.google.push([`(EN) 排除B2B平台: ${en[0]} importer ${country}`, G(`"${en[0]}" importer ${country} -alibaba -made-in-china -amazon`)]);
    kws.slice(0, 2).forEach(k => out.maps.push([`Google Maps: ${k} ${tw[1] || tw[0]}`, `https://www.google.com/maps/search/${enc(k + ' ' + (tw[1] || tw[0]) + ' ' + place)}`]));
    out.maps.push([`Google Maps: flooring wholesale ${country}`, `https://www.google.com/maps/search/${enc('flooring wholesale ' + country)}`]);
    out.linkedin.push([`LinkedIn 公司: ${en[0]} ${country}`, `https://www.linkedin.com/search/results/companies/?keywords=${enc(en[0] + ' ' + (lang === 'en' ? 'distributor' : tw[0]))}`]);
    out.linkedin.push([`LinkedIn 人: 采购经理 flooring ${country}`, `https://www.linkedin.com/search/results/people/?keywords=${enc('purchasing manager flooring ' + country)}`]);
    out.linkedin.push([`LinkedIn 人: buyer / category manager`, `https://www.linkedin.com/search/results/people/?keywords=${enc('buyer ' + en[0] + ' ' + country)}`]);
    out.linkedin.push([`Google 搜 LinkedIn 采购（免登录）`, G(`site:linkedin.com/in ("purchasing manager" OR buyer OR "procurement") (flooring OR "${en[0]}") ${country}`)]);
    out.other.push([`OpenCorporates: ${en[0]} ${country}`, `https://opencorporates.com/companies?q=${enc(en[0] + ' ' + country)}`]);
    if (country === 'United Kingdom') out.other.push([`英国 Companies House: ${en[0]}`, `https://find-and-update.company-information.service.gov.uk/search?q=${enc(en[0])}`]);
    if (country === 'United Arab Emirates') out.other.push(['阿联酋 CBLS 经济登记（需在官网查询）', 'https://cbls.economy.ae/']);
    if (country === 'Saudi Arabia') out.other.push(['沙特商业登记（需在官网填写公司名或 CR）', 'https://mc.gov.sa/en/pages/default.aspx']);
    out.other.push([`Apollo 公司搜索 (需登录; 免费版额度有限)`, `https://app.apollo.io/#/companies?qOrganizationKeywordTags[]=${enc(en[0])}&organizationLocations[]=${enc(country)}`]);
    out.other.push([`Apollo 人员: Purchasing / Buyer`, `https://app.apollo.io/#/people?personTitles[]=purchasing%20manager&personTitles[]=buyer&qOrganizationKeywordTags[]=${enc(en[0])}&organizationLocations[]=${enc(country)}`]);
    if (country === 'USA') { out.other.unshift([`ImportYeti 海关提单: ${en[0]}`, `https://www.importyeti.com/search?q=${enc(en[0])}`]); out.other.unshift([`ImportYeti: "vinyl flooring" (HS 3918)`, `https://www.importyeti.com/search?q=${enc('vinyl flooring')}`]); }
    else out.other.push([`海关数据 (仅美国免费: ImportYeti)；其他国家可用 Volza / Panjiva (付费)`, 'https://www.importyeti.com/']);
    [...(C.DIRECTORIES._all || []), ...(C.DIRECTORIES[country] || [])].forEach(d => out.dirs.push([`site:${d} ${kws[0]}`, G(`site:${d} ${kws[0]} ${tw[0]}`)]));
    const m = (window.MARKETS || []).find(x => x.country === country);
    if (m && m.fairs) fairNames(m.fairs).slice(0, 2).forEach(f => { const n = f.replace(/\s*[（(].*$/, '').split('/')[0].trim(); if (n) out.dirs.push([`展会参展商 Exhibitors: ${n}`, G(`"${n}" exhibitor list ${en[0]}`)]); });
    return out;
  }

  async function prospect() {
    const admin = UI.ME.role === 'admin', L = links(P.country, P.group), m = (window.MARKETS || []).find(x => x.country === P.country);
    const block = (title, arr) => `<div class="lgroup"><h3>${title}</h3>${arr.map(([t, u]) => `<a class="lbtn" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}</div>`;
    UI.render(`<div class="pagehead"><h1>找客户 <small>Prospecting</small></h1><div class="actions">${admin ? '<a class="btn ghost" href="#/pool">🌊 公海 Lead pool</a>' : ''}<a class="btn ghost" href="#/markets">🌍 目标市场</a></div></div>
      <section class="card pad"><h2>客户核实工具与免费额度</h2><p>查官网、域名、邮箱、采购负责人、地址、海关提单和企业信用。每个工具说明适用场景、额度和官网用法。</p><p class="muted small">公司名核实和海关核验都在客户核实工具里：搜索、地图、LinkedIn 公司和找人、企业登记会带上公司名。外链在新标签页打开，不嵌入、不调用接口。</p><a class="btn primary" href="#/lookup-tools">打开客户核实工具</a><p class="muted small">在 LinkedIn 个人主页点一下存进 CRM：到客户核实工具查看如何加载未打包的浏览器扩展。扩展不抓取搜索列表，也不解锁隐藏联系方式。</p></section>
      <section class="card pad"><h2>自动获客</h2><p>选择国家、城市和产品，让服务器搜索公开公司网站、读取产品及B端业务证据、整理联系方式。结果先进入候选名单，核实并查重后再导入客户；不会自动发送邮件。</p><a class="btn primary" href="#/discovery">进入自动获客工作台 →</a></section>
      <div class="grid2 wide-left"><section class="card pad">
        <h2>① 搜索启动器 <small>Search launcher — 自动生成当地语言关键词</small></h2>
        <div class="g3"><label>国家 Country<select id="pc">${COUNTRIES.map(c => opt(c, c, P.country)).join('')}</select></label>
          <label>产品 Product<select id="pg">${C.KW_GROUPS.map(g => opt(g[0], g[1], P.group)).join('')}</select></label>
          <div class="note">${marketNote(m)}${P.country === 'North Korea' ? '<div class="warn">⚠️ 朝鲜受制裁，不可作为开拓对象</div>' : ''}${P.country === 'USA' && ['laminate', 'engineered'].includes(P.group) ? '<div class="warn">⚠️ 美国不推强化/实木复合</div>' : ''}</div></div>
        <p class="muted small">关键词：${esc(((C.KW[P.group][C.LANG[P.country] || 'en']) || []).join(' / '))} + ${esc((C.TYPE_KW[C.LANG[P.country] || 'en'] || []).join(' / '))}。目标：进口商/分销商/建材批发商，跳过零售门店和安装公司（除非有进口/批发证据）。</p>
        ${block('Google', L.google)}${block('Google Maps（找仓库/批发市场）', L.maps)}${block('LinkedIn（找采购经理）', L.linkedin)}${block('行业目录 / 展会 Directories & fairs', L.dirs)}${block('ImportYeti / Apollo / 海关数据', L.other)}
      </section>
      <section class="card pad"><h2>② 快速录入 + 查重 <small>Quick add & duplicate check</small></h2>
        <p class="muted small">粘贴客户网址 → 自动抓取公司名/电话/邮箱/地址（部署后由服务器抓取；演示模式需运行 tools/dev_server.py）→ 全公司查重（即使客户属于别人也会提示“已存在，归属X”，但不泄露详情）。</p>
        <form id="qa"><label>网址 Website<input name="url" placeholder="https://www.example.com" required></label><div class="actions"><button class="primary">抓取 + 查重 Fetch & check</button></div></form>
        <div id="qares"></div>
        <h3>只查重 Duplicate check only</h3><form id="dq" class="g3"><input name="n" placeholder="公司名 Name"><input name="w" placeholder="网站 Website"><input name="p" placeholder="电话 Phone"><div class="span3 right"><button class="ghost sm">查重 Check</button></div></form><div id="dqres"></div>
      </section></div>
      <section class="card pad"><h2>怎样得到可靠客户</h2><p>自动获客用于发现和整理公开线索。业务员需核对公司身份、经营国家、销售产品和批发或工程采购依据；进口记录、仓库和采购量以独立证据为准。搜索排名不代表进口量排名。</p><p>也可以继续使用上面的Google、地图、行业目录和展会链接人工查找，再通过快速录入保存经核实的公司。</p></section>`, 'prospect');
    $('#pc').onchange = e => { P.country = e.target.value; save(); prospect(); }; $('#pg').onchange = e => { P.group = e.target.value; save(); prospect(); };
    $('#qa').onsubmit = async e => { e.preventDefault(); const url = e.target.url.value.trim(); $('#qares').innerHTML = '<p class="muted">抓取中… Fetching</p>';
      let info = {}; try { info = await DB.fetchSite(url); } catch (err) { info = { website: url, error: err.message }; }
      const site = info.website || url, d = U.domain(site);
      const guessName = info.company_name || (d ? d.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, x => x.toUpperCase()) : '');
      const tld = d.split('.').pop(), country = info.country || { ca: 'Canada', uk: 'United Kingdom', au: 'Australia', de: 'Germany', fr: 'France', nl: 'Netherlands', pl: 'Poland', it: 'Italy', es: 'Spain', be: 'Belgium', ch: 'Switzerland', at: 'Austria', se: 'Sweden', no: 'Norway', cz: 'Czechia', ro: 'Romania', jp: 'Japan', in: 'India', nz: 'New Zealand', ie: 'Ireland' }[tld] || (P.country || '');
      const dups = await DB.checkDuplicate({ name: guessName, website: site, phone: info.phone });
      const pre = { company_name: guessName, website: site.startsWith('http') ? site : 'https://' + d, company_phone: info.phone || '', company_email: info.email || '', address: info.address || '', country, state: info.state || '', products: info.products || [], customer_type: 'importer', priority: 'B', status: '未联系', owner_id: admin ? null : undefined, source_note: `Quick-add ${UI.today()} from ${site}${info.pages ? '; pages: ' + info.pages.join(', ') : ''}${info.offline ? ' (auto-fetch unavailable — fill manually)' : ''}`, tags: ['quick-add'] };
      $('#qares').innerHTML = (dups.length ? `<div class="warn"><b>⚠️ 已存在 Already in CRM</b>${dups.map(x => `<div>「${esc(x.company_name || '（他人客户 another rep’s client）')}」匹配 ${esc(x.match)} · 归属 <b>${esc(x.owner_name)}</b> ${x.client_id ? `<a href="#/client/${esc(x.client_id)}">打开</a>` : ''}</div>`).join('')}</div>` : '<div class="ok">✅ 未发现重复 No duplicate</div>')
        + `<div class="kvbox">${[['公司名(猜测)', pre.company_name], ['电话', pre.company_phone], ['邮箱', pre.company_email], ['地址', pre.address], ['国家', pre.country], ['产品证据', (pre.products || []).map(C.productName).join(', ')]].map(([k, v]) => `<div><span>${k}</span> ${esc(v || '—')}</div>`).join('')}${info.offline ? '<p class="muted small">演示模式下未连接抓取服务，只解析了域名；字段可在下一步手动补充。</p>' : ''}${info.error ? `<p class="muted small">抓取失败：${esc(info.error)}</p>` : ''}</div>
        ${!dups.length || admin ? `<button class="primary" id="qago">→ 打开新建表单（已预填）</button>` : ''}`;
      const go = $('#qago'); if (go) go.onclick = () => { UI._prefill = pre; location.hash = '#/new'; };
    };
    $('#dq').onsubmit = async e => { e.preventDefault(); const f = e.target; const d = await DB.checkDuplicate({ name: f.n.value, website: f.w.value, phone: f.p.value });
      $('#dqres').innerHTML = d.length ? `<div class="warn">${d.map(x => `<div>「${esc(x.company_name || '（他人客户 another rep’s client）')}」匹配 ${esc(x.match)} · 归属 <b>${esc(x.owner_name)}</b></div>`).join('')}</div>` : '<div class="ok">✅ 未发现重复</div>'; };
  }
  const save = () => sessionStorage.setItem('fcrm_prospect', JSON.stringify(P));

  // ---------------- MARKETS ----------------
  const MKT = { board: 'overall', q: '', open: null };
  const MKT_PRODUCTS = [['laminate', '强'], ['engineered', '实'], ['spc', 'SPC'], ['wall', '墙']];
  const sanctioned = row => row.country === 'North Korea' || row.cn === '朝鲜';
  const crmCount = country => (UI.CLIENTS || []).filter(x => x.country === country).length;
  const mktBoards = () => window.MARKET_BOARDS || [];
  const mktBoard = () => mktBoards().find(b => b.id === MKT.board) || mktBoards()[0] || { id: 'overall', label: '综合榜', metric: '综合出口', highlight: [], scope: '', rows: [] };
  const mktText = () => window.MARKET_TEXT || { wan: () => '—', ton: () => '—', growth: () => ({ text: '—', kind: 'flat' }) };

  function mktQuery(row, q) {
    if (!q) return true;
    const hay = [row.cn, row.country, row.best, row.lang, row.fairs, row.certs, row.intro].join('\n').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(part => hay.includes(part));
  }

  function mktRows() {
    const q = MKT.q.trim();
    return mktBoard().rows.filter(row => mktQuery(row, q));
  }

  function mktMix(row) {
    const hi = new Set(mktBoard().highlight || []);
    const text = mktText();
    return MKT_PRODUCTS.map(([key, label]) => {
      const item = row.products && row.products[key];
      return `<span class="${hi.has(key) ? 'on' : ''}">${label} ${item ? text.wan(item.q26) : '—'}</span>`;
    }).join('<i>·</i>');
  }

  function closeDrawer() {
    MKT.open = null;
    const drawer = $('#mktDrawer'), shade = $('#mktShade');
    if (drawer) drawer.hidden = true;
    if (shade) shade.hidden = true;
  }

  function openDrawer(country) {
    const board = mktBoard();
    const row = board.rows.find(x => x.country === country);
    const drawer = $('#mktDrawer'), shade = $('#mktShade');
    if (!row || !drawer) return closeDrawer();
    MKT.open = country;
    const text = mktText();
    const g = text.growth(row.growth, row.q26);
    const stop = sanctioned(row);
    const sources = (row.sources || []).filter(u => /^https?:\/\//i.test(u));
    const names = { laminate: '强化复合', engineered: '实木复合', spc: 'SPC地板', wall: '墙板' };
    const productRows = MKT_PRODUCTS.map(([key]) => {
      const item = row.products && row.products[key];
      if (!item) return '';
      const pg = text.growth(item.growth, item.q26);
      return `<tr><td>${esc(names[key])}</td><td title="${esc(item.q26)} 千克">${text.wan(item.q26)}</td><td class="growth-${pg.kind}">${esc(pg.text)}</td><td>${esc(text.ton(item.delta))}</td><td title="${esc(item.q25)} 千克">${text.wan(item.q25)}</td></tr>`;
    }).join('');
    drawer.innerHTML = `<button type="button" class="ghost sm mkt-drawer-x" id="mktClose">关闭</button>
      <p class="muted small">${esc(board.label)} 第 ${esc(row.rank)} 名 · ${esc(row.country)}</p>
      <h2 id="mktDrawerTitle">${esc(row.cn)}</h2>
      ${stop ? '<div class="mkt-stop">制裁市场：不可作为开拓对象。下面是海关资料原文，不是开发建议。</div>' : ''}
      <p class="mkt-kpis"><b>${esc(text.wan(row.q26))}</b> 万吨<small>${esc(board.metric)} · 2026年1–9月</small></p>
      <p>月均增速 <b class="growth-${g.kind}">${esc(g.text)}</b> · 月均增量 <b>${esc(text.ton(row.delta))}</b> 吨${row.q25 == null ? '' : ` · 2025年1–10月 ${esc(text.wan(row.q25))} 万吨`}</p>
      <p>🎯 ${esc(row.best)}</p>
      <p>🗣 ${esc(row.lang)}</p>
      <p>🎪 ${esc(row.fairs || '—')}</p>
      <h3>国家介绍</h3>
      <p class="mkt-intro" id="mktIntro">${esc(row.intro)}</p>
      <h3>认证要点</h3>
      <p class="mkt-intro">${esc(row.certs || '—')}</p>
      <h3>分产品（资料口径，万吨）</h3>
      <p class="muted small">${board.id === 'flooring' ? '上面的数字是强化、实木复合、SPC 三类合计，不含墙板。下表是该市场四个品类的分项。' : board.id === 'overall' ? '上面的数字是四个品类合计。下表是分项。' : '上面的数字只统计本榜产品。下表是同一市场四个品类的分项。'}</p>
      <div class="tblwrap"><table class="mini"><thead><tr><th>品类</th><th>2026年1–9月</th><th>月均增速</th><th>月均增量（吨）</th><th>2025年1–10月</th></tr></thead><tbody>${productRows}</tbody></table></div>
      ${sources.length ? `<h3>资料来源</h3><ul class="mkt-sources">${sources.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul>` : ''}
      <p class="muted small">CRM 客户 ${crmCount(row.country)} 家 · 英语国名 <b>${esc(row.country)}</b></p>
      ${stop ? '<p class="mkt-flag">不可开拓</p>' : `<a class="btn primary" href="#/prospect" data-c="${esc(row.country)}">🔎 去找客户</a>`}`;
    drawer.hidden = false;
    if (shade) shade.hidden = false;
    $('#mktClose').onclick = closeDrawer;
    const go = drawer.querySelector('[data-c]');
    if (go) go.onclick = () => { P.country = go.dataset.c; save(); };
    drawer.scrollTop = 0;
  }

  function fillMarkets() {
    const board = mktBoard();
    const text = mktText();
    const rows = mktRows();
    const body = $('#mktBody');
    if (!body) return;
    $('#mktScope').textContent = board.scope || '';
    $('#mktMetric').textContent = `2026年1–9月 ${board.metric}（万吨）`;
    $('#mktCount').textContent = `${board.label} · 显示 ${rows.length} / ${board.rows.length}`;
    $$('[data-board]').forEach(btn => {
      const on = btn.dataset.board === board.id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    body.innerHTML = rows.map(row => {
      const g = text.growth(row.growth, row.q26);
      const stop = sanctioned(row);
      return `<tr class="${stop ? 'mkt-sanction' : ''}" data-country="${esc(row.country)}">
        <td data-l="排名">${esc(row.rank)}</td>
        <td data-l="国家"><div><b>${esc(row.cn)}</b><div class="muted">${esc(row.country)}</div>${stop ? '<div class="mkt-flag">制裁 · 不可作为开拓对象</div>' : ''}</div></td>
        <td class="num" data-l="万吨" title="${esc(row.q26)} 千克"><b>${esc(text.wan(row.q26))}</b></td>
        <td class="num growth-${g.kind}" data-l="增速">${esc(g.text)}</td>
        <td class="num" data-l="增量">${esc(text.ton(row.delta))}</td>
        <td class="notes" data-l="资料"><div><div>🎯 ${esc(row.best)}</div><div class="mkt-mix">${mktMix(row)}</div><div>🗣 ${esc(row.lang)}</div><div class="mkt-fairs">🎪 ${esc(row.fairs || '—')}</div><div class="mkt-actions"><button type="button" class="ghost sm" data-intro="${esc(row.country)}">查看介绍</button>${stop ? '<span class="mkt-flag">不可开拓</span>' : `<a href="#/prospect" data-c="${esc(row.country)}">🔎 去找客户</a>`}</div></div></td>
        <td class="num" data-l="客户">${crmCount(row.country)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">没有匹配的市场</td></tr>';
    if (MKT.open) {
      if (board.rows.some(row => row.country === MKT.open)) openDrawer(MKT.open);
      else closeDrawer();
    }
  }

  function markets() {
    const boards = mktBoards();
    if (!boards.some(b => b.id === MKT.board)) MKT.board = 'overall';
    const board = mktBoard();
    UI.render(`<div class="pagehead"><div><h1>目标市场 <small>中国海关出口 · 2026年1–9月对比2025年1–10月</small></h1></div>
      <label class="mkt-search-label">搜索<input id="mktQ" class="mkt-search" placeholder="国家、英语名或产品，如 英国 / Philippines / SPC" value="${esc(MKT.q)}"></label></div>
      <div class="mkt-boards" role="tablist">${boards.map(b => `<button type="button" class="mkt-tab ${b.id === board.id ? 'on' : ''}" role="tab" data-board="${esc(b.id)}" aria-pressed="${b.id === board.id ? 'true' : 'false'}">${esc(b.label)} <small>${b.rows.length}</small></button>`).join('')}</div>
      <p class="info" id="mktScope">${esc(board.scope || '')}</p>
      <p class="muted small" id="mktCount"></p>
      <section class="card tbl"><table class="mkt"><thead><tr><th>#</th><th>国家 Country</th><th class="num" id="mktMetric">2026年1–9月 ${esc(board.metric)}（万吨）</th><th class="num" title="（2026年1–9月÷9）相对（2025年1–10月÷10）">月均增速</th><th class="num" title="月均增量，吨/月">月均增量（吨）</th><th>适合产品 / 分项万吨 / 语言 / 展会</th><th>CRM客户</th></tr></thead><tbody id="mktBody"></tbody></table></section>
      <p class="muted small">${esc(window.MARKETS_SOURCE || '')} 万吨 = 千克 ÷ 10,000,000；吨/月 = 月均增量 ÷ 1,000。增速保留 1 位小数。无 2025 年出口、2026 年有量时显示「新市场」；2026 年没有出口量时显示「2026年暂无」。</p>
      <div id="mktShade" class="mkt-shade" hidden></div><aside id="mktDrawer" class="mkt-drawer" role="dialog" aria-modal="true" aria-labelledby="mktDrawerTitle" hidden></aside>`, 'markets');
    const search = $('#mktQ');
    search.oninput = () => { MKT.q = search.value; fillMarkets(); };
    $$('[data-board]').forEach(btn => btn.onclick = () => { MKT.board = btn.dataset.board; fillMarkets(); });
    $('#mktBody').onclick = e => {
      const intro = e.target.closest('[data-intro]');
      if (intro) { openDrawer(intro.dataset.intro); return; }
      const go = e.target.closest('[data-c]');
      if (go) { P.country = go.dataset.c; save(); }
    };
    $('#mktShade').onclick = closeDrawer;
    document.removeEventListener('keydown', marketsKey);
    document.addEventListener('keydown', marketsKey);
    fillMarkets();
  }
  function marketsKey(e) {
    if (e.key === 'Escape' && $('#mktDrawer') && !$('#mktDrawer').hidden) closeDrawer();
  }

  // ---------------- POOL ----------------
  let PSEL = new Set();
  function pool() {
    const admin = UI.ME.role === 'admin';
    const list = UI.CLIENTS.filter(c => !c.owner_id && !UI.isInvalid(c)).sort((a, b) => ({ A: 0, B: 1, C: 2, D: 3 }[a.priority] ?? 9) - ({ A: 0, B: 1, C: 2, D: 3 }[b.priority] ?? 9));
    const sales = UI.USERS.filter(u => u.active && u.role === 'sales');
    UI.render(`<div class="pagehead"><h1>公海 / 线索池 <small>Lead pool — ${list.length} 家未分配</small></h1></div>
      ${admin ? `<section class="card pad bulkbar"><b id="pc">已选 ${PSEL.size}</b>
        <select id="po">${opt('', '分配给… Assign to', '')}${UI.USERS.filter(u => u.active).map(u => opt(u.id, u.full_name, '')).join('')}</select><button class="primary sm" id="pa">分配所选</button>
        <span class="sep"></span><button class="ghost sm" id="prr">⚖️ 平均分配所选给 ${sales.length} 位业务员（轮流）</button><button class="ghost sm" id="pall">全选</button></section>` : '<p class="muted small">选择一条未分配客户并领取后，该客户将归你负责。领取成功后其他员工将无法再领取。</p>'}
      <section class="card tbl"><table><thead><tr>${admin ? '<th class="ck"></th>' : ''}<th>公司</th><th>国家/州</th><th>产品</th><th>优先级</th><th>来源</th>${admin ? '' : '<th>操作</th>'}</tr></thead><tbody>
      ${list.map(c => `<tr>${admin ? `<td class="ck"><input type="checkbox" data-p="${esc(c.id)}" ${PSEL.has(c.id) ? 'checked' : ''}></td>` : ''}<td><a class="cname" href="#/client/${esc(c.id)}">${esc(c.company_name)}</a><span class="sub">${esc(U.domain(c.website))}</span></td><td>${esc([c.state, c.country].filter(Boolean).join(', '))}</td><td><div class="chips">${UI.chips(c.products)}</div></td><td>${UI.prBadge(c.priority)}</td><td class="muted small">${esc((c.source_note || '').slice(0, 80))}</td>${admin ? '' : `<td><button class="primary sm" data-claim="${esc(c.id)}">领取为我的</button></td>`}</tr>`).join('') || `<tr><td colspan="${admin ? 6 : 6}" class="empty">公海为空 Pool is empty</td></tr>`}</tbody></table></section>`, 'pool');
    $$('[data-claim]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try { await DB.claimClient(btn.dataset.claim); PSEL.clear(); await UI.refresh(); pool(); UI.toast('已领取，客户现归你负责'); }
      catch (err) { UI.toast(err.message || '领取失败，请刷新后重试', 1); await UI.refresh(); pool(); }
    });
    if (!admin) return;
    $$('[data-p]').forEach(cb => cb.onchange = () => { cb.checked ? PSEL.add(cb.dataset.p) : PSEL.delete(cb.dataset.p); $('#pc').textContent = '已选 ' + PSEL.size; });
    $('#pall').onclick = () => { list.forEach(c => PSEL.add(c.id)); pool(); };
    $('#pa').onclick = async () => { const o = $('#po').value; if (!o || !PSEL.size) return UI.toast('请选择客户和业务员', 1); await DB.bulkUpdate([...PSEL], { owner_id: o }); UI.toast(`已分配 ${PSEL.size} 家`); PSEL.clear(); await UI.refresh(); pool(); };
    $('#prr').onclick = async () => { if (!PSEL.size || !sales.length) return UI.toast('请先勾选客户', 1); const ids = [...PSEL];
      const load = Object.fromEntries(sales.map(u => [u.id, UI.CLIENTS.filter(c => c.owner_id === u.id).length]));
      for (const id of ids) { const u = sales.reduce((a, b) => load[a.id] <= load[b.id] ? a : b); await DB.updateClient(id, { owner_id: u.id }, 'assign'); load[u.id]++; }
      UI.toast(`已按工作量平均分配 ${ids.length} 家`); PSEL.clear(); await UI.refresh(); pool(); };
  }
  UI.views.prospect = { render: prospect };
  UI.views.markets = { render: markets };
  UI.views.pool = { render: pool };
})();
