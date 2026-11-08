/* Public business verification tools and CRM quota display. */
(function () {
  const {esc,$} = UI;
  const directTools = [
    { name: 'Hunter · 邮箱查找与验证', mode: '官网使用', use: '查公司公开邮箱，或验证已经找到的邮箱。填写上方网站或域名后，打开 Hunter 会进入该公司的域名搜索；未填则打开首页。', quota: '免费版每月 50 积分；验证一次 0.5 积分，查找与验证共用。只做验证约 100 个／月。CRM 不调用接口、不保存密钥。', links: [
      { id: 'hunter', label: '打开 Hunter', href: 'https://hunter.io/' },
      { label: '打开邮箱验证', href: 'https://hunter.io/email-verifier' },
      { label: '官方说明', href: 'https://help.hunter.io/en/articles/1970956-hunter-api' }
    ]},
    { name: 'Google 地图 · 核对地址', mode: '官网使用', use: '用公司名找门店、办公室或仓库，再和官网或企业登记对照。填写上方公司名后按该公司搜索；未填则打开地图首页。', quota: '打开普通地图不扣 CRM 积分。', links: [
      { id: 'maps', label: '打开 Google 地图', href: 'https://www.google.com/maps' },
      { label: '官方说明', href: 'https://developers.google.com/maps/documentation/urls/get-started' }
    ]},
    { name: 'OKKI · 采购记录', mode: '官网首页', use: '在 OKKI 官网核对采购线索。这里只打开首页，请在站内继续查询。', quota: '可查范围以账号为准。CRM 不调用 OKKI 接口。', links: [
      { label: '打开 OKKI', href: 'https://www.okki.com/' }
    ]}
  ];
  const accountTools = [
    { name: 'Apollo · 找采购负责人', mode: '需账号', use: '按公司、职位找采购经理、品类经理和业务联系人。', quota: '查找和解锁资料的额度以登录账号为准。部分免费接口功能要求公司工作邮箱。按钮只打开官网，CRM 不代查。', links: [
      { label: '打开 Apollo', href: 'https://app.apollo.io/' },
      { label: '官方说明', href: 'https://docs.apollo.io/docs/developer-faqs' }
    ]},
    { name: 'Volza · 采购记录', mode: '需账号', use: '按公司核对采购产品、日期和供应商。各市场覆盖范围有差异。', quota: '可查范围以账号或套餐为准。CRM 未启用付费接口。', links: [
      { label: '打开 Volza', href: 'https://www.volza.com/' },
      { label: '官方说明', href: 'https://www.volza.com/trade-intelligence-apis/' }
    ]},
    { name: 'D&B · 企业主体与信用', mode: '需账号', use: '用法定名称或 D-U-N-S 编号核对企业主体。完整信用报告用于进一步审核。', quota: '主体查询与信用报告分开；完整报告权限和费用以官网为准。', links: [
      { label: '打开 D&B 企业查询', href: 'https://my.dnb.com/lookup' },
      { label: '官方说明', href: 'https://www.dnb.com/content/dam/english/dnb-solutions/DNB_Using_DirectPlus_APIs.pdf' }
    ]},
    { name: 'ZoomInfo · 企业及决策人', mode: '需账号', use: '按公司或职位补充负责人资料。', quota: '接口权限随订阅，未核实可长期使用的免费接口。按钮只打开官网，CRM 不代查。', links: [
      { label: '打开 ZoomInfo', href: 'https://www.zoominfo.com/' },
      { label: '官方说明', href: 'https://docs.gtm.ai/docs/overview' }
    ]}
  ];
  const external = (url, label, id) => `<a class="btn ghost" href="${esc(url)}"${id ? ` data-tool-link="${esc(id)}"` : ''} target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  const toolCard = tool => `<article class="card pad"><h3>${esc(tool.name)} <small>${esc(tool.mode)}</small></h3><p>${esc(tool.use)}</p><p><b>额度</b> · ${esc(tool.quota)}</p><div class="actions">${tool.links.map(link => external(link.href, link.label, link.id)).join('')}</div></article>`;
  const companyQuery = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const mapsHome = 'https://www.google.com/maps';
  const mapsSearch = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const stackLinks = (sites, hrefFor, attr, showUrl) => `<div class="customs-links">${sites.map(site => {
    const href = hrefFor(site);
    return `<a class="btn ghost" ${attr}="${esc(site.id)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><b>${esc(site.name)}</b><small>${esc(site.note)}</small>${showUrl ? `<small>${esc(href)}</small>` : ''}</a>`;
  }).join('')}</div>`;
  const customsSites = [
    { id: 'importyeti', name: 'ImportYeti', note: '美国海运提单，免费公司级', home: 'https://www.importyeti.com/', search: q => 'https://www.importyeti.com/search?q=' + encodeURIComponent(q) },
    { id: 'portexaminer', name: 'PortExaminer', note: '美国提单明细，免登录（数据偏旧）', home: 'https://portexaminer.com/', search: q => 'https://portexaminer.com/search.php?search-field-1=consignee&search-term-1=' + encodeURIComponent(q) },
    { id: 'cnudata', name: 'CNUData', note: '中东等免卡限次试查（沙特/阿联酋）', home: 'https://cnudata.com/' }
  ];
  const verifyCompanySites = [
    { id: 'google', name: 'Google 搜索', note: '按公司名搜索公开网页', home: 'https://www.google.com/', search: q => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
    { id: 'maps', name: 'Google 地图', note: '按公司名找门店、办公室或仓库', home: mapsHome, search: mapsSearch },
    { id: 'linkedin', name: 'LinkedIn 公司', note: '按公司名搜索公司页', home: 'https://www.linkedin.com/', search: q => 'https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(q) },
    { id: 'opencorporates', name: 'OpenCorporates', note: '全球企业登记检索', home: 'https://opencorporates.com/', search: q => 'https://opencorporates.com/companies?q=' + encodeURIComponent(q) },
    { id: 'companies-house', name: '英国 Companies House', note: '英国公司注册处，按名称搜索', home: 'https://find-and-update.company-information.service.gov.uk/', search: q => 'https://find-and-update.company-information.service.gov.uk/search?q=' + encodeURIComponent(q) }
  ];
  const mideastSites = [
    { id: 'cbls', name: '阿联酋 CBLS 经济登记', note: '官网首页，请在站内查询', home: 'https://cbls.economy.ae/' },
    { id: 'saudi-cr', name: '沙特商业登记查询', note: '官网入口，请填写公司名或 CR', home: 'https://mc.gov.sa/en/pages/default.aspx' }
  ];
  function countryHint(country) {
    const value = String(country || '').trim().toLowerCase();
    if (value === 'united kingdom' || value === 'uk' || value === '英国' || value === 'gb') return '<p class="muted small">客户国家是英国，可优先打开 Companies House。</p>';
    if (value === 'united arab emirates' || value === 'uae' || value === '阿联酋') return '<p class="muted small">客户国家是阿联酋，经济登记请用下方 CBLS 官网自行查询。</p>';
    if (value === 'saudi arabia' || value === 'ksa' || value === '沙特' || value === '沙特阿拉伯') return '<p class="muted small">客户国家是沙特，请在下方商务部页面填写公司名或商业登记号 CR。</p>';
    return '';
  }
  UI.customsLinks = company => {
    const q = companyQuery(company);
    return stackLinks(customsSites, site => (q && site.search ? site.search(q) : site.home), 'data-customs', false);
  };
  UI.mapsLink = company => {
    const q = companyQuery(company);
    return q ? mapsSearch(q) : mapsHome;
  };
  UI.verifyLinks = (company, options = {}) => {
    const q = companyQuery(company);
    const domain = websiteDomain(options.website);
    const hunter = domain ? stackLinks([{ id: 'hunter', name: 'Hunter 邮箱', note: '按域名查找公开邮箱，不调用接口' }], () => UI.hunterLink(domain), 'data-verify', true) : '';
    return `${stackLinks(verifyCompanySites, site => (q && site.search ? site.search(q) : site.home), 'data-verify', true)}${hunter}${countryHint(options.country)}<h3>中东登记入口</h3><p class="muted small">没有公开的公司名搜索参数，按钮只打开官网。请在官方页面填写公司名或商业登记号 CR。</p>${stackLinks(mideastSites, site => site.home, 'data-verify', true)}`;
  };
  const limits = {
    discovery: '自动获客按 Tavily Free → Firecrawl Free → SerpAPI Free → Brave Search 使用免费额度。一个来源用完就换下一个，不会自动付费。地板、墙板关键词和进口、分销、批发、工程采购筛选保持不变。',
    research: '已有官网用 Jina Reader 读取，不扣搜索积分，每家公司最多读 3 页。每批最多 10 家，每人每 24 小时最多 20 家；另选 Jina 公司搜索时，每家公司最多 1 次，全团队每月最多 100 个搜索任务。'
  };
  function discoveryLines(quota, status) {
    const head = '免费源用完自动切换；不会自动付费。';
    const rows = Array.isArray(quota?.discovery_providers) ? quota.discovery_providers.filter(item => item && item.in_failover !== false) : [];
    const live = new Map((status?.providers || []).filter(item => item && item.id).map(item => [item.id, item]));
    if (!rows.length) {
      const left = quota?.discovery_remaining, cap = quota?.discovery_cap;
      if (!Number.isSafeInteger(left) || left < 0 || (cap != null && (!Number.isSafeInteger(cap) || cap < left))) throw Error('额度格式不可用');
      return [head, `Tavily Free：剩余 ${left}${Number.isSafeInteger(cap) ? '／' + cap : ''} 次`];
    }
    const lines = [head, ...rows.map(item => {
      const remote = live.get(item.id);
      const name = String(item.name || item.id);
      if (remote?.configured === false) return name + '：未配置';
      let remaining = Number.isSafeInteger(item.remaining) ? item.remaining : null;
      const limit = Number.isSafeInteger(item.limit) ? item.limit : null;
      if (remote && Number.isSafeInteger(remote.remaining)) remaining = remaining == null ? remote.remaining : Math.min(remaining, remote.remaining);
      if (item.exhausted === true || remote?.state === 'exhausted' || remaining === 0) return name + '：已用尽';
      if (!Number.isSafeInteger(remaining) || remaining < 0 || (limit != null && remaining > limit)) return remote?.configured ? name + '：已连接，剩余次数待核对' : name + '：未配置';
      const brave = item.id === 'brave' && remote?.persistsResults === false ? '（摘录不入库，仅当次排序）' : '';
      return `${name}：剩余 ${remaining}${limit != null ? '／' + limit : ''} ${item.unit === '积分' ? '积分' : '次'}${brave}`;
    })];
    if (!status) lines.push('供应商是否已配置暂时读不到；没有密钥的来源不会被调用。');
    return lines;
  }
  UI.discoveryQuotaLines = discoveryLines;
  UI.lookupQuota = kind => `<section class="card pad"><h3>本次使用的额度</h3><p>${limits[kind]}</p>
    <p data-lookup-quota="${kind}" role="status">正在读取 CRM 剩余次数…</p>
    <p class="muted small">CRM 次数和供应商账号积分分别计算。供应商余额请在对应官网账号查看，官网和接口使用同一账号时可能共用额度。</p>
    <div class="actions"><a href="#/lookup-tools">客户核实工具与额度说明</a>
    ${kind==='discovery'?external('https://app.tavily.com/','打开 Tavily 查余额'):external('https://jina.ai/reader/','打开 Jina Reader 官网')}</div></section>`;
  UI.loadLookupQuota = async (knownStatus) => {
    const nodes = [...document.querySelectorAll('[data-lookup-quota]')];
    if (!nodes.length) return;
    const wantsDiscovery = nodes.some(el => el.dataset.lookupQuota === 'discovery');
    try {
      let status = knownStatus?.providers ? knownStatus : null;
      if (wantsDiscovery && !status) {
        try {
          const response = await DB.init().functions.invoke('crm-mail', { body: { action: 'status' } });
          status = response.error || response.data?.error ? null : response.data?.discovery || null;
        } catch { status = null; }
      }
      const quota = DB.chk(await DB.init().rpc('crm_lookup_quota'));
      for (const el of nodes) if (el.isConnected) {
        const discovery = el.dataset.lookupQuota==='discovery';
        if (!discovery) {
          const counts = [quota.research_daily_remaining, quota.research_search_remaining];
          if (!counts.every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('额度格式不可用');
          el.textContent = `本人近 24 小时可再提交 ${counts[0]}／20 家；团队本月剩余 ${counts[1]}／100 个公司搜索任务。`;
          continue;
        }
        const lines = discoveryLines(quota, status);
        el.replaceChildren();
        lines.forEach((line, index) => {
          if (index) el.append(document.createElement('br'));
          el.append(document.createTextNode(line));
        });
      }
    } catch {
      for (const el of nodes) if (el.isConnected) el.textContent='暂时读不到 CRM 剩余次数，请刷新后查看。';
    }
  };

  let bootstrap;
  const read = async url => {
    const response = await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(6500)});
    if (!response.ok) throw Error('该注册局暂未返回可查询信息');
    return response.json();
  };
  const hostPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
  function domainOf(raw) {
    const value = raw.trim();
    if (!value || /\s|@|\\/.test(value)) throw Error('请输入公开公司域名，例如 example.com');
    const url = new URL(/^https?:\/\//i.test(value)?value:'https://'+value);
    const domain = url.hostname.replace(/^www\./,'').replace(/\.$/,'');
    if (url.port || !hostPattern.test(domain) || /\.(?:local|test|internal|localhost|invalid|example)$/.test(domain)) {
      throw Error('请输入可公开查询的注册域名');
    }
    return domain;
  }
  function websiteDomain(raw) {
    try { return domainOf(String(raw || '')); }
    catch { return ''; }
  }
  UI.hunterLink = website => {
    const domain = websiteDomain(website);
    return domain ? 'https://hunter.io/search/' + encodeURIComponent(domain) : 'https://hunter.io/';
  };
  async function lookup(domain) {
    const data = await (bootstrap ||= read('https://data.iana.org/rdap/dns.json').catch(e=>{bootstrap=null;throw e;}));
    const tld = domain.split('.').pop();
    const service = data.services?.find(item=>Array.isArray(item[0])&&item[0].includes(tld))?.[1];
    const base = service?.find(url=>typeof url==='string'&&url.startsWith('https://'));
    if (!base) throw Error('该后缀未列出可用的 RDAP 服务');
    const source = new URL('domain/'+encodeURIComponent(domain),base.endsWith('/')?base:base+'/');
    if (source.protocol!=='https:'||source.username||source.password) throw Error('注册局网址不可用');
    const result = await read(source.href);
    if ((result.ldhName||'').toLowerCase()!==domain) throw Error('返回记录与查询域名不一致');
    return {source:source.href, result};
  }
  function render() {
    UI.render(`<div class="pagehead"><h1>客户核实工具</h1><a class="btn ghost" href="#/prospect">返回找客户</a></div>
      <section class="card pad"><h2>先选你要核实的内容</h2><p>找新公司用自动获客；已经有公司名称或网址，用官网补资料。域名、邮箱、地址、采购和信用分开核对。</p>
      <p>CRM 额度用完后，可以直接打开外部工具，使用你已有权限的免费功能。同一个账号的网页版和接口可能共用额度，具体余额以官网为准。</p>
      <div class="actions"><a class="btn primary" href="#/discovery">按产品找新客户</a><a class="btn ghost" href="#/research">补充已有客户资料</a></div></section>
      <section class="card pad" id="customsCheck"><h2>海关核验</h2>
      <p>在新标签页打开免费海关网站。只是外链：不嵌入页面，不调用接口，不抓取数据。</p>
      <label>公司名称（可选）<input id="customsCompany" maxlength="200" autocomplete="off" placeholder="留空则打开首页"></label>
      <div id="customsLinks">${UI.customsLinks('')}</div>
      <p class="muted small">有公司名时，ImportYeti 按公司名搜索，PortExaminer 按进口商名称搜索。CNUData 始终打开首页，请在站内选择沙特或阿联酋后查询。同一公司名也会更新下方的公司核实和 Google 地图。提单线索需人工核对，不能代替客户确认。查完后可把进口证据摘要、证据 URL、核实日记在客户的来源/核实说明里。</p></section>
      <section class="card pad" id="companyVerify"><h2>公司核实</h2>
      <p>使用上面的公司名称。有名称时，搜索链接会带上公司名；留空则打开各站首页。只在新标签页打开，不嵌入页面，不调用接口。</p>
      <label>网站或域名（可选，只用于 Hunter）<input id="verifyWebsite" maxlength="253" autocomplete="off" placeholder="例如 acmeflooring.com"></label>
      <div id="verifyLinks">${UI.verifyLinks('', {})}</div></section>
      ${UI.lookupQuota('discovery')}${UI.lookupQuota('research')}
      <section class="card pad"><h2>RDAP · 域名注册核对 <small>免费公开查询</small></h2>
      <p>输入公开公司域名，查注册日期、到期日和状态。不扣 CRM 搜索积分。部分注册局限流或限制浏览器访问时，请用 ICANN 官网手动查。</p>
      <form id="rdapForm"><label>公司域名<input name="domain" required maxlength="253" placeholder="例如 example.com"></label><div class="actions"><button class="primary">查询域名注册资料</button>${external('https://lookup.icann.org/','打开 ICANN Lookup')}</div></form><p id="rdapStatus" role="status"></p>
      <div id="rdapResult"></div><p class="muted small">域名注册日期不等于企业成立日期。登记信息可能被隐藏；结果只作为主体核实的辅助证据。</p></section>
      <section class="card pad" id="externalTools"><h2>外部查询工具</h2>
      <p>Hunter 使用上方网站或域名，Google 地图使用上方公司名。没有填写时打开首页。需账号的网站只打开官网。</p>
      <h3>可带公司或域名</h3><div class="grid2">${directTools.map(toolCard).join('')}</div>
      <h3>需账号工具</h3><p class="muted small">需要自有账号或套餐权限。按钮只打开官网，不会代查，也不调用接口。</p>
      <div class="grid2">${accountTools.map(toolCard).join('')}</div></section>`,'lookup-tools');
    if(DB.mode==='demo') for(const el of document.querySelectorAll('[data-lookup-quota]')) el.textContent='演示环境没有正式 CRM 余额。';
    else UI.loadLookupQuota();
    const customsCompany = $('#customsCompany'), customsLinks = $('#customsLinks');
    const verifyWebsite = $('#verifyWebsite'), verifyLinks = $('#verifyLinks');
    const syncOutbound = () => {
      const company = customsCompany ? customsCompany.value : '';
      const website = verifyWebsite ? verifyWebsite.value : '';
      if (customsLinks) customsLinks.innerHTML = UI.customsLinks(company);
      if (verifyLinks) verifyLinks.innerHTML = UI.verifyLinks(company, { website });
      const maps = document.querySelector('[data-tool-link="maps"]');
      if (maps) maps.href = UI.mapsLink(company);
      const hunter = document.querySelector('[data-tool-link="hunter"]');
      if (hunter) hunter.href = UI.hunterLink(website);
    };
    if (customsCompany) customsCompany.oninput = syncOutbound;
    if (verifyWebsite) verifyWebsite.oninput = syncOutbound;
    const form=$('#rdapForm'), status=$('#rdapStatus'), output=$('#rdapResult'), button=form.querySelector('button');
    form.onsubmit=async event=>{
      event.preventDefault();
      output.replaceChildren();
      button.disabled=true;
      status.textContent='正在向域名注册局查询…';
      try {
        const {source,result}=await lookup(domainOf(form.elements.domain.value));
        if(!form.isConnected)return;
        const events=Array.isArray(result.events)?result.events:[];
        const eventDate=name=>events.find(e=>e.eventAction===name)?.eventDate||'未公开';
        const states=Array.isArray(result.status)?result.status.join('、'):'未公开';
        status.textContent='查询完成。';
        output.innerHTML=`<p><b>${esc(result.ldhName)}</b> · 注册日期 ${esc(eventDate('registration'))} · 到期日 ${esc(eventDate('expiration'))}</p><p>域名状态 ${esc(states)}</p><p>${external(source,'查看注册局公开来源')}</p>`;
      } catch {
        if(form.isConnected)status.textContent='未能取得域名资料。请核对注册域名，或打开 ICANN Lookup 手动查。';
      } finally { button.disabled=false; }
    };
  }
  UI.views['lookup-tools'] = {render};
})();