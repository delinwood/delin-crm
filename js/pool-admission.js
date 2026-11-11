/* Public-pool admission preview. The database trigger is authoritative.
   This mirror lets the pages explain a rejection before the request, and
   shows a read-only "would this pass today" hint. It does not scrape,
   send messages, or call a paid API. */
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
    sea_market: '规则 · 目标市场（东南亚）', buyer_product: '规则 · 地板/墙板买家',
    entity: '规则 · 可核对的公司主体', contact_path: '规则 · 可联系途径', not_duplicate: '规则 · 不是重复客户'
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
    const row = read(input), failures = [], codes = [], passed = [];
    const market = marketOf(row.country);
    if (MARKETS.some(([code]) => code === market)) {
      passed.push('sea_market');
      codes.push('market:' + market);
    } else if (market === 'SA' || market === 'AE') {
      failures.push({ code: 'sea_market', message: '不在当前目标市场。沙特和阿联酋的新公司不能进入公海，已有客户仍可在各自档案里跟进。' });
    } else {
      failures.push({ code: 'sea_market', message: '不在当前目标市场（东南亚）。当前允许：印度尼西亚、越南、泰国、马来西亚、菲律宾、新加坡、柬埔寨、老挝、缅甸、文莱、东帝汶。' });
    }
    const buyer = buyerOf(row.customer_type), products = productKeys(row.products);
    if (buyer && buyer !== 'factory' && products.length) {
      passed.push('buyer_product');
      codes.push('buyer:' + buyer);
      products.forEach(key => codes.push('product:' + key));
    } else if (buyer === 'factory') {
      failures.push({ code: 'buyer_product', message: '同行工厂不能进入公海。需要地板或墙板的贸易、工程或分销买家。' });
    } else if (!products.length && !(buyer && buyer !== 'factory')) {
      failures.push({ code: 'buyer_product', message: '需要地板或墙板产品，并且是贸易、工程或分销买家。同行工厂不能进入公海。' });
    } else if (!products.length) {
      failures.push({ code: 'buyer_product', message: '未看到地板或墙板相关产品，不能进入公海。' });
    } else {
      failures.push({ code: 'buyer_product', message: '不是地板/墙板的贸易、工程或分销买家。随机公司不能进入公海。' });
    }
    const site = domain(row.website), mail = emailOf(row.email), phone = phoneKey(row.phone), wa = phoneKey(row.whatsapp), link = linkedinKey(row.linkedin);
    const entity = [];
    if (site.includes('.')) entity.push('website');
    if (mail) entity.push('email');
    if (phone || wa) entity.push('phone');
    if (link) entity.push('linkedin');
    if (row.company_name.length >= 2 && row.company_name.length <= 200 && entity.length) {
      passed.push('entity');
      entity.forEach(bit => codes.push('entity:' + bit));
    } else failures.push({ code: 'entity', message: '缺少可核对的公司主体：需要公司名称，以及网站、邮箱、电话或 LinkedIn 其中一项。' });
    const contact = [];
    if (mail) contact.push('email');
    if (phone) contact.push('phone');
    if (wa) contact.push('whatsapp');
    if (httpUrl(row.inquiry) || websiteInquiry(row.website)) contact.push('inquiry');
    if (contact.length) {
      passed.push('contact_path');
      contact.forEach(bit => codes.push('contact:' + bit));
    } else failures.push({ code: 'contact_path', message: '缺少可联系途径：需要邮箱、网站询盘链接，或 WhatsApp/电话。仅有官网首页不够。' });
    if (duplicate(row, existing)) failures.push({ code: 'not_duplicate', message: '与已有客户重复（名称、网站、电话、邮箱或 LinkedIn），未写入公海。' });
    else passed.push('not_duplicate');
    const ok = !failures.length;
    return {
      ok,
      rules: RULES.filter(rule => passed.includes(rule)),
      reason_codes: ok ? codes : [],
      failures,
      message: ok ? '' : '未进入公海：' + failures.map(item => item.message).join('；')
    };
  }
  function count(list) {
    const bucket = { total: list.length, decided: 0, pending: 0, unreachable: 0, not_buyer: 0, buyer_hold: 0, quote_or_deal: 0 };
    list.forEach(row => {
      const outcome = row.acquisition_outcome || row.outcome || '';
      if (Object.prototype.hasOwnProperty.call(bucket, outcome) && outcome !== 'total' && outcome !== 'decided' && outcome !== 'pending') {
        bucket[outcome] += 1;
        bucket.decided += 1;
      } else bucket.pending += 1;
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
    add('reason', client => client.pool_admission.reason_codes || []);
    add('rule', client => client.pool_admission.rules || []);
    const positive = group => group.buyer_hold + group.quote_or_deal;
    const negative = group => group.unreachable + group.not_buyer;
    const ranked = groups.filter(group => group.kind === 'reason' && group.decided > 0);
    const best = ranked.slice().sort((a, b) => positive(b) - positive(a) || b.quote_or_deal - a.quote_or_deal || a.code.localeCompare(b.code)).slice(0, 5)
      .map(group => ({ code: group.code, positive: positive(group), negative: negative(group) }));
    const miss = ranked.slice().sort((a, b) => negative(b) - negative(a) || b.unreachable - a.unreachable || a.code.localeCompare(b.code)).slice(0, 5)
      .map(group => ({ code: group.code, positive: positive(group), negative: negative(group) }));
    return { ...count(rows), groups, best, miss };
  }
  function hint(client, existing) {
    if (client && client.pool_admitted_at) return { admitted: true, ok: true, text: '已按准入标准进入公海' };
    const result = evaluate(client, existing || []);
    return {
      admitted: false,
      ok: result.ok,
      text: result.ok ? '今日标准预览：可以通过。已在库的客户不会因此被移出。' : '今日标准预览：' + result.message + ' 已在库的客户不会因此被移出。'
    };
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
