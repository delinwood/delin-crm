/* Public-pool notes. 公海 can hold uncertain leads. Grade A is the certainty mark.
   Duplicate matches still follow the existing client check. This does not scrape
   or call a paid API. */
(function (root) {
  const MARKETS = [
    ['ID', ['indonesia', 'republic of indonesia', 'id', '印度尼西亚', '印尼']],
    ['VN', ['vietnam', 'viet nam', 'vn', '越南']],
    ['TH', ['thailand', 'th', '泰国']],
    ['MY', ['malaysia', 'my', '马来西亚']],
    ['PH', ['philippines', 'ph', 'philippine', '菲律宾']],
    ['SG', ['singapore', 'sg', '新加坡']],
    ['KH', ['cambodia', 'kampuchea', 'kh', '柬埔寨']],
    ['LA', ['laos', 'lao', 'lao pdr', 'laos pdr', 'lao peoples democratic republic', '老挝']],
    ['MM', ['myanmar', 'burma', 'myanmar burma', 'mm', '缅甸']],
    ['BN', ['brunei', 'brunei darussalam', 'bn', '文莱']],
    ['TL', ['timor leste', 'east timor', 'tl', '东帝汶']],
    ['SEA', ['southeast asia', 'south east asia', 'sea', 'asean', '东南亚']]
  ];
  const BLOCKED = [
    ['SA', ['saudi arabia', 'kingdom of saudi arabia', 'ksa', 'riyadh', 'jeddah', '沙特', '沙特阿拉伯', '利雅得', '吉达']],
    ['AE', ['united arab emirates', 'uae', 'dubai', 'abu dhabi', '阿联酋', '阿拉伯联合酋长国', '迪拜', '阿布扎比']]
  ];
  const BUYERS = [
    ['importer', ['importer', 'importers', '进口商']],
    ['distributor', ['distributor', 'distributors', '分销商', '经销商']],
    ['wholesaler', ['wholesaler', 'wholesalers', 'wholesale', '批发商', '建材批发商']],
    ['brand', ['brand', 'brand owner', '品牌商']],
    ['contractor', ['contractor', 'contractors', '工程', '装修', '承包', '工程采购', '装修公司']],
    ['trade', ['trade', 'trader', 'trading', '贸易', '贸易商']],
    ['other', ['other', '其他', '其它']]
  ];
  const FACTORIES = ['factory', 'factories', 'manufacturer', 'manufacturers', 'mill', '工厂', '制造商', '生产商', '厂家', '同行'];
  const PRODUCTS = [
    ['laminate', ['laminate', 'laminate flooring', '强化复合地板', '强化地板', '强化']],
    ['engineered', ['engineered', 'engineered wood', 'engineered wood flooring', '实木复合地板', '实木复合']],
    ['spc', ['spc', 'spc flooring', 'spc石塑地板', '石塑地板']],
    ['uv_panel', ['uv panel', 'uv wall panel', 'uv wall', 'uv装饰板', 'uv板']],
    ['pvc_fluted', ['fluted', 'slat wall', 'pvc fluted', '长城板', '条形墙板']],
    ['pvc_grille', ['grille', 'pvc grille', '格栅']],
    ['coex_panel', ['co extrusion', 'coextrusion', '共挤墙板', '共挤']],
    ['wpc_panel', ['wpc wall', 'wpc cladding', 'wpc panel', 'wpc墙板', '外墙挂板']],
    ['pvc_marble', ['pvc marble', 'marble panel', '仿大理石']],
    ['acoustic', ['acoustic', 'acoustic panel', '吸音板', '吸音']],
    ['wpc_decking', ['wpc deck', 'decking', 'composite decking', '户外地板']]
  ];
  const GENERIC = [
    ['flooring', ['flooring', 'floor', '地板']],
    ['wall', ['wall panel', 'wall panels', '墙板']]
  ];
  const RULES = ['sea_market', 'buyer_product', 'entity', 'contact_path', 'not_duplicate'];
  const OUTCOMES = [
    ['unreachable', '联系不上'],
    ['not_buyer', '能联系但不是买家'],
    ['buyer_hold', '是买家但暂不采购'],
    ['quote_or_deal', '已进入报价或成交']
  ];
  const LABELS = {
    'market:ID': '市场 · 印度尼西亚', 'market:VN': '市场 · 越南', 'market:TH': '市场 · 泰国',
    'market:MY': '市场 · 马来西亚', 'market:PH': '市场 · 菲律宾', 'market:SG': '市场 · 新加坡',
    'market:KH': '市场 · 柬埔寨', 'market:LA': '市场 · 老挝', 'market:MM': '市场 · 缅甸',
    'market:BN': '市场 · 文莱', 'market:TL': '市场 · 东帝汶', 'market:SEA': '市场 · 东南亚',
    'buyer:importer': '买家 · 进口商', 'buyer:distributor': '买家 · 分销商', 'buyer:wholesaler': '买家 · 批发商',
    'buyer:brand': '买家 · 品牌商', 'buyer:contractor': '买家 · 工程/装修采购', 'buyer:trade': '买家 · 贸易商',
    'buyer:other': '买家 · 其他',
    'product:laminate': '产品 · 强化复合地板', 'product:engineered': '产品 · 实木复合地板', 'product:spc': '产品 · SPC',
    'product:uv_panel': '产品 · UV装饰板', 'product:pvc_fluted': '产品 · 长城板', 'product:pvc_grille': '产品 · PVC格栅',
    'product:coex_panel': '产品 · 共挤墙板', 'product:wpc_panel': '产品 · WPC墙板', 'product:pvc_marble': '产品 · 仿大理石板',
    'product:acoustic': '产品 · 吸音板', 'product:wpc_decking': '产品 · 户外地板',
    'product:flooring': '产品 · 地板', 'product:wall': '产品 · 墙板',
    'entity:website': '主体 · 网站', 'entity:email': '主体 · 邮箱', 'entity:phone': '主体 · 电话', 'entity:linkedin': '主体 · LinkedIn',
    'contact:email': '联系 · 邮箱', 'contact:phone': '联系 · 电话', 'contact:whatsapp': '联系 · WhatsApp', 'contact:inquiry': '联系 · 网站询盘链接',
    'market:sea': '市场提示 · 东南亚', 'market:gulf': '市场提示 · 沙特/阿联酋',
    'market:other': '市场提示 · 其他地区', 'market:unknown': '市场提示 · 国家未填',
    'missing_contact': '资料不完整 · 缺少联系途径', 'missing_buyer': '资料不完整 · 买家未确认',
    'missing_product': '资料不完整 · 产品未确认', 'missing_entity': '资料不完整 · 主体信息较少',
    'certainty:unconfirmed': '确定性 · 进入公海时尚未确认',
    'source:client_insert': '来源 · 直接进入公海', 'source:discovery': '来源 · 自动获客',
    'source:client_release': '来源 · 退回公海', 'source:social_release': '来源 · 共享表转入',
    client_insert: '来源 · 直接进入公海', discovery: '来源 · 自动获客',
    client_release: '来源 · 退回公海', social_release: '来源 · 共享表转入'
  };

  function norm(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    return raw.toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function matchList(value, groups) {
    const n = norm(value);
    if (!n) return '';
    for (const [code, aliases] of groups) if (aliases.some(alias => norm(alias) === n)) return code;
    return '';
  }
  function marketOf(country) {
    return matchList(country, MARKETS) || matchList(country, BLOCKED);
  }
  function buyerOf(value) {
    const n = norm(value);
    if (!n) return '';
    if (FACTORIES.some(alias => norm(alias) === n)) return 'factory';
    return matchList(value, BUYERS);
  }
  function textsOf(products) {
    const out = [];
    const push = value => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) value.forEach(push);
      else out.push(String(value));
    };
    push(products);
    return out;
  }
  function containsAlias(text, alias) {
    const n = norm(text), a = norm(alias);
    if (!n || !a) return false;
    if (n === a || n.split(' ').includes(a)) return true;
    const compact = n.replace(/ /g, ''), compactAlias = a.replace(/ /g, '');
    if (/[一-龥]/.test(a)) return compact.includes(compactAlias);
    return a.length >= 3 && (n.includes(a) || compact.includes(compactAlias));
  }
  function productKeys(products) {
    const texts = textsOf(products);
    const found = [];
    const add = key => { if (key && !found.includes(key)) found.push(key); };
    texts.forEach(text => {
      PRODUCTS.forEach(([key, aliases]) => {
        if (norm(text) === key || aliases.some(alias => containsAlias(text, alias))) add(key);
      });
    });
    if (!found.length) texts.forEach(text => {
      GENERIC.forEach(([key, aliases]) => { if (aliases.some(alias => containsAlias(text, alias))) add(key); });
    });
    return found;
  }
  function nameKey(value) {
    return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|ltd|llc|corp|corporation|co|company|limited|group|the|gmbh|sa|sas|srl|bv|nv|pty|plc)\b/g, ' ').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
  }
  function domain(value) {
    let url = String(value || '').trim().toLowerCase();
    if (!url) return '';
    if (!/^[a-z]+:\/\//.test(url)) url = 'http://' + url;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function phoneKey(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 7 ? digits.slice(-9) : '';
  }
  function emailOf(value) {
    const email = String(value || '').trim().toLowerCase();
    return email.length <= 320 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(email) ? email : '';
  }
  function httpUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\/\S+$/i.test(raw) || raw.length > 2048) return '';
    try {
      const url = new URL(raw);
      if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) return '';
      return url.href;
    } catch (e) { return ''; }
  }
  function linkedinKey(value) {
    const found = String(value || '').trim().toLowerCase().replace(/[?#].*$/, '').match(/linkedin\.com\/(in|company)\/([^/?#]+)/);
    return found && found[2] ? found[1] + '/' + found[2] : '';
  }
  function websiteInquiry(website) {
    const href = httpUrl(/^https?:\/\//i.test(String(website || '').trim()) ? String(website).trim() : (String(website || '').trim() ? 'https://' + String(website).trim() : ''));
    if (!href) return false;
    try { return /\/(contact|inquiry|enquiry|quote|get-in-touch|contact-us)(\/|$)/i.test(new URL(href).pathname); }
    catch (e) { return false; }
  }
  function read(input) {
    input = input || {};
    return {
      id: input.id || null,
      company_name: String(input.company_name || '').trim(),
      country: input.country || '',
      customer_type: input.customer_type || '',
      products: input.products,
      website: input.website || '',
      email: input.company_email || input.email || '',
      phone: input.company_phone || input.phone || '',
      whatsapp: input.whatsapp || '',
      linkedin: input.contact_linkedin || input.linkedin || '',
      inquiry: input.inquiry_url || input.social_url || ''
    };
  }
  function duplicate(row, existing) {
    const site = domain(row.website), mail = emailOf(row.email), phone = phoneKey(row.phone), wa = phoneKey(row.whatsapp);
    const link = linkedinKey(row.linkedin), named = nameKey(row.company_name);
    return (existing || []).some(other => {
      if (!other || (row.id && other.id === row.id)) return false;
      const otherPhone = phoneKey(other.company_phone || other.phone), otherWa = phoneKey(other.whatsapp);
      const otherName = nameKey(other.company_name);
      return (site && domain(other.website) === site)
        || (mail && emailOf(other.company_email || other.email) === mail)
        || (phone && (phone === otherPhone || phone === otherWa))
        || (wa && (wa === otherPhone || wa === otherWa))
        || (link && linkedinKey(other.contact_linkedin || other.linkedin) === link)
        || (named.length > 3 && otherName.length > 3 && named === otherName);
    });
  }
  function evaluate(input, existing) {
    const row = read(input), flags = ['certainty:unconfirmed'];
    const market = marketOf(row.country);
    if (MARKETS.some(([code]) => code === market)) flags.push('market:sea');
    else if (market === 'SA' || market === 'AE') flags.push('market:gulf');
    else if (!norm(row.country)) flags.push('market:unknown');
    else flags.push('market:other');
    const buyer = buyerOf(row.customer_type), products = productKeys(row.products);
    if (!buyer || buyer === 'factory') flags.push('missing_buyer');
    if (!products.length) flags.push('missing_product');
    const site = domain(row.website), mail = emailOf(row.email), phone = phoneKey(row.phone), wa = phoneKey(row.whatsapp), link = linkedinKey(row.linkedin);
    const entity = site.includes('.') || mail || phone || wa || link;
    if (row.company_name.length < 2 || !entity) flags.push('missing_entity');
    const contact = mail || phone || wa || httpUrl(row.inquiry) || websiteInquiry(row.website);
    if (!contact) flags.push('missing_contact');
    const duplicated = duplicate(row, existing);
    return {
      ok: !duplicated,
      flags,
      message: duplicated ? '未写入公海：与已有客户重复（名称、网站、电话、邮箱或 LinkedIn）。' : ''
    };
  }
  function buyerOutcome(row) {
    const outcome = row.acquisition_outcome || row.outcome || '';
    return outcome === 'buyer_hold' || outcome === 'quote_or_deal';
  }
  function count(list) {
    const bucket = { total: list.length, decided: 0, pending: 0, promoted: 0, unreachable: 0, not_buyer: 0, buyer_hold: 0, quote_or_deal: 0 };
    list.forEach(row => {
      const outcome = row.acquisition_outcome || row.outcome || '';
      if (Object.prototype.hasOwnProperty.call(bucket, outcome) && !['total', 'decided', 'pending', 'promoted'].includes(outcome)) {
        bucket[outcome] += 1;
        bucket.decided += 1;
      } else bucket.pending += 1;
      if (buyerOutcome(row) && (row.priority === 'A' || row.priority === 'A+')) bucket.promoted += 1;
    });
    return bucket;
  }
  function summarize(clients) {
    const rows = (clients || []).filter(client => client && client.pool_admission);
    const groups = [];
    const add = (kind, pick) => {
      const map = new Map();
      rows.forEach(client => (pick(client) || []).forEach(code => {
        if (!map.has(code)) map.set(code, []);
        map.get(code).push(client);
      }));
      [...map.keys()].sort().forEach(code => groups.push({ kind, code, ...count(map.get(code)) }));
    };
    add('source', client => [client.pool_admission.source].filter(Boolean));
    add('flag', client => client.pool_admission.flags || []);
    const positive = group => group.buyer_hold + group.quote_or_deal;
    const negative = group => group.unreachable + group.not_buyer;
    const ranked = groups.filter(group => group.kind === 'flag' && group.decided > 0);
    const best = ranked.slice().sort((a, b) => b.promoted - a.promoted || positive(b) - positive(a) || a.code.localeCompare(b.code)).slice(0, 5)
      .map(group => ({ code: group.code, positive: positive(group), promoted: group.promoted, negative: negative(group) }));
    const miss = ranked.slice().sort((a, b) => negative(b) - negative(a) || a.code.localeCompare(b.code)).slice(0, 5)
      .map(group => ({ code: group.code, positive: positive(group), promoted: group.promoted, negative: negative(group) }));
    return { ...count(rows), groups, best, miss };
  }
  function hint(client) {
    const outcome = client && client.acquisition_outcome;
    const buyer = outcome === 'buyer_hold' || outcome === 'quote_or_deal';
    if (client && (client.priority === 'A' || client.priority === 'A+') && buyer) return { text: '分级 A · 优先开发：跟进结果说明是买家' };
    if (client && (client.priority === 'A' || client.priority === 'A+')) return { text: '分级 ' + client.priority + ' · 优先开发' };
    const notes = evaluate(client || {}, []).flags.filter(flag => flag.startsWith('market:') || flag.startsWith('missing_')).map(label);
    return { text: '公海线索，买家尚未确认' + (notes.length ? ' · ' + notes.join('、') : '') };
  }
  function label(code) { return LABELS[code] || code; }
  function outcomeLabel(code) {
    const found = OUTCOMES.find(item => item[0] === code);
    return found ? found[1] : '';
  }

  root.PoolAdmission = {
    MARKETS, BLOCKED, OUTCOMES, evaluate, summarize, hint, label, outcomeLabel, marketOf, buyerOf, productKeys
  };
})(typeof window !== 'undefined' ? window : globalThis);
