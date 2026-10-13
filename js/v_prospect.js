(function () {
  const { esc, opt, $, $$ } = UI;
  const COUNTRIES = (window.MARKETS || []).map(m => m.country).concat(['New Zealand', 'Ireland', 'Mexico', 'United Arab Emirates', 'Saudi Arabia', 'South Africa', 'Israel', 'Denmark', 'Finland', 'Chile']);
  const P = JSON.parse(sessionStorage.getItem('fcrm_prospect') || '{"country":"Canada","group":"spc"}');
  const enc = encodeURIComponent, G = q => 'https://www.google.com/search?q=' + enc(q);
  const LOCAL_NAME = { Germany: 'Deutschland', France: 'France', Netherlands: 'Nederland', Poland: 'Polska', Italy: 'Italia', Spain: 'España', Czechia: 'Česko', Romania: 'România', Sweden: 'Sverige', Norway: 'Norge', 'Türkiye': 'Türkiye', Japan: '日本', Austria: 'Österreich', Switzerland: 'Schweiz', Belgium: 'Belgique' };

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
    out.other.push([`Apollo 公司搜索 (需登录; 免费版额度有限)`, `https://app.apollo.io/#/companies?qOrganizationKeywordTags[]=${enc(en[0])}&organizationLocations[]=${enc(country)}`]);
    out.other.push([`Apollo 人员: Purchasing / Buyer`, `https://app.apollo.io/#/people?personTitles[]=purchasing%20manager&personTitles[]=buyer&qOrganizationKeywordTags[]=${enc(en[0])}&organizationLocations[]=${enc(country)}`]);
    if (country === 'USA') { out.other.unshift([`ImportYeti 海关提单: ${en[0]}`, `https://www.importyeti.com/search?q=${enc(en[0])}`]); out.other.unshift([`ImportYeti: "vinyl flooring" (HS 3918)`, `https://www.importyeti.com/search?q=${enc('vinyl flooring')}`]); }
    else out.other.push([`海关数据 (仅美国免费: ImportYeti)；其他国家可用 Volza / Panjiva (付费)`, 'https://www.importyeti.com/']);
    [...(C.DIRECTORIES._all || []), ...(C.DIRECTORIES[country] || [])].forEach(d => out.dirs.push([`site:${d} ${kws[0]}`, G(`site:${d} ${kws[0]} ${tw[0]}`)]));
    const m = (window.MARKETS || []).find(x => x.country === country);
    if (m && m.fairs) m.fairs.split(/,\s*(?![^()]*\))/).slice(0, 2).forEach(f => { const n = f.replace(/\s*\(.*$/, '').split('/')[0].trim(); if (n) out.dirs.push([`展会参展商 Exhibitors: ${n}`, G(`"${n}" exhibitor list ${en[0]}`)]); });
    return out;
  }

  async function prospect() {
    const admin = UI.ME.role === 'admin', L = links(P.country, P.group), m = (window.MARKETS || []).find(x => x.country === P.country);
    const block = (title, arr) => `<div class="lgroup"><h3>${title}</h3>${arr.map(([t, u]) => `<a class="lbtn" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}</div>`;
    UI.render(`<div class="pagehead"><h1>找客户 <small>Prospecting</small></h1><div class="actions">${admin ? '<a class="btn ghost" href="#/pool">🌊 公海 Lead pool</a>' : ''}<a class="btn ghost" href="#/markets">🌍 目标市场</a></div></div>
      <div class="grid2 wide-left"><section class="card pad">
        <h2>① 搜索启动器 <small>Search launcher — 自动生成当地语言关键词</small></h2>
        <div class="g3"><label>国家 Country<select id="pc">${COUNTRIES.map(c => opt(c, c, P.country)).join('')}</select></label>
          <label>产品 Product<select id="pg">${C.KW_GROUPS.map(g => opt(g[0], g[1], P.group)).join('')}</select></label>
          <div class="note">${m ? `🌍 排名 #${m.rank} · 中国份额 ${m.cn391810 && m.v391810 ? Math.round(m.cn391810 / m.v391810 * 100) + '%' : 'n/a'} · 语言 ${esc(m.lang)}<br>适合：${esc(m.best)}` : ''}${P.country === 'USA' && ['laminate', 'engineered'].includes(P.group) ? '<div class="warn">⚠️ 美国不推强化/实木复合</div>' : ''}</div></div>
        <p class="muted small">关键词：${esc(((C.KW[P.group][C.LANG[P.country] || 'en']) || []).join(' / '))} + ${esc((C.TYPE_KW[C.LANG[P.country] || 'en'] || []).join(' / '))}。目标：进口商/分销商/建材批发商，跳过零售门店和安装公司（除非有进口/批发证据）。</p>
        ${block('Google', L.google)}${block('Google Maps（找仓库/批发市场）', L.maps)}${block('LinkedIn（找采购经理）', L.linkedin)}${block('行业目录 / 展会 Directories & fairs', L.dirs)}${block('ImportYeti / Apollo / 海关数据', L.other)}
      </section>
      <section class="card pad"><h2>② 快速录入 + 查重 <small>Quick add & duplicate check</small></h2>
        <p class="muted small">粘贴客户网址 → 自动抓取公司名/电话/邮箱/地址（部署后由服务器抓取；演示模式需运行 tools/dev_server.py）→ 全公司查重（即使客户属于别人也会提示“已存在，归属X”，但不泄露详情）。</p>
        <form id="qa"><label>网址 Website<input name="url" placeholder="https://www.example.com" required></label><div class="actions"><button class="primary">抓取 + 查重 Fetch & check</button></div></form>
        <div id="qares"></div>
        <h3>只查重 Duplicate check only</h3><form id="dq" class="g3"><input name="n" placeholder="公司名 Name"><input name="w" placeholder="网站 Website"><input name="p" placeholder="电话 Phone"><div class="span3 right"><button class="ghost sm">查重 Check</button></div></form><div id="dqres"></div>
      </section></div>
      <section class="card pad"><h2>③ 批量找客户脚本 <small>Prospecting script (run on the box / any PC with Python 3)</small></h2>
        <p>自动：发现 → 打开官网核实（联系页/关于页）→ 提取电话、通用邮箱(info@/sales@)、地址、产品证据、是否批发/进口 → 打分 → 输出 CRM 导入 CSV。<b>不会编造联系人</b>；找不到的字段留空。</p>
<pre>cd /workspace/flooring_crm
# A) 用你自己的网址清单（来自 Google/ImportYeti/展会名单，每行一个）
python3 tools/prospect.py --country CA --product spc,wpc_decking --domains my_sites.txt --n 40
# B) 自动搜索（Brave Search API 免费额度，需 key）
BRAVE_API_KEY=xxxx python3 tools/prospect.py --country DE --product spc,wall_panels --provider brave --n 30 \\
      --existing clients_export.csv     # 跳过 CRM 已有客户（先在客户列表导出 CSV）
# C) 免 key：OpenStreetMap 地板店/建材批发（命中率低，服务器偶尔繁忙）
python3 tools/prospect.py --country AU --product spc --provider overpass --n 30</pre>
        <p class="muted small">输出：prospect_out/&lt;国家&gt;_&lt;日期&gt;/crm_import.csv（管理员 → 管理 → 导入）+ review.csv（全部候选及淘汰原因）。国家代码：US CA GB AU DE FR NL PL IT ES；产品：spc laminate engineered wall_panels acoustic wpc_decking。</p></section>`, 'prospect');
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
  function markets() {
    const M = window.MARKETS || [], f = v => v == null ? 'n/a' : (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const n = c => UI.CLIENTS.filter(x => x.country === c).length;
    UI.render(`<div class="pagehead"><h1>目标市场 Top 20 <small>Target markets (UN Comtrade 2023, USD million)</small></h1></div>
      <section class="card tbl"><table class="mkt"><thead><tr><th>#</th><th>国家 Country</th><th>核心合计*</th><th>3918.10 PVC地板/墙板</th><th>中国份额</th><th>4418.75 实木复合</th><th>3916.20 PVC型材</th><th>4411 MDF/HDF(强化代理)</th><th>2024 3918.10</th><th>最适合产品 / 语言 / 展会 / 备注</th><th>CRM客户</th></tr></thead><tbody>
      ${M.map(m => `<tr><td>${m.rank}</td><td><b>${esc(m.cn)}</b><div class="muted">${esc(m.country)}</div></td><td><b>${f(m.core)}</b></td><td>${f(m.v391810)}</td>
        <td>${m.cn391810 && m.v391810 ? `<div class="share"><i style="width:${m.cn391810 / m.v391810 * 100}%"></i></div>${Math.round(m.cn391810 / m.v391810 * 100)}%` : 'n/a'}</td><td>${f(m.v441875)}</td><td>${f(m.v391620)}</td><td>${f(m.v4411)}</td><td>${f(m.v391810_2024)}</td>
        <td class="notes"><div>🎯 ${esc(m.best)}</div><div>🗣 ${esc(m.lang)}</div><div>🎪 ${esc(m.fairs)}</div><div class="muted">${esc(m.note)}</div><a href="#/prospect" data-c="${esc(m.country)}">🔎 去找客户</a></td><td>${n(m.country)}</td></tr>`).join('')}</tbody></table></section>
      <p class="muted small">* 核心合计 = 3918.10 + 4418.75 + 3916.20。${esc(window.MARKETS_SOURCE || '')} 未向 Comtrade 申报 2023 数据的国家不在表内（未做镜像估算）。</p>`, 'markets');
    $$('[data-c]').forEach(a => a.onclick = () => { P.country = a.dataset.c; save(); });
  }

  // ---------------- POOL ----------------
  let PSEL = new Set();
  function pool() {
    const admin = UI.ME.role === 'admin';
    const list = UI.CLIENTS.filter(c => !c.owner_id).sort((a, b) => ({ 'A+': 0, A: 1, B: 2, C: 3 }[a.priority] ?? 9) - ({ 'A+': 0, A: 1, B: 2, C: 3 }[b.priority] ?? 9));
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
