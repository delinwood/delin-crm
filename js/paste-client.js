/* Fill the new-client form from a pasted block. Heuristics only; nothing is saved here. */
(function (root) {
  const COUNTRY_ALIASES = [
    ['united arab emirates', 'United Arab Emirates'], ['u.a.e.', 'United Arab Emirates'], ['uae', 'United Arab Emirates'], ['阿联酋', 'United Arab Emirates'],
    ['saudi arabia', 'Saudi Arabia'], ['沙特阿拉伯', 'Saudi Arabia'], ['沙特', 'Saudi Arabia'], ['ksa', 'Saudi Arabia'],
    ['united states of america', 'USA'], ['united states', 'USA'], ['美国', 'USA'], ['u.s.a.', 'USA'], ['u.s.', 'USA'], ['usa', 'USA'],
    ['united kingdom', 'United Kingdom'], ['great britain', 'United Kingdom'], ['英国', 'United Kingdom'], ['u.k.', 'United Kingdom'], ['uk', 'United Kingdom'],
    ['canada', 'Canada'], ['加拿大', 'Canada'],
    ['australia', 'Australia'], ['澳大利亚', 'Australia'], ['澳洲', 'Australia'],
    ['germany', 'Germany'], ['德国', 'Germany'], ['deutschland', 'Germany'],
    ['france', 'France'], ['法国', 'France'],
    ['italy', 'Italy'], ['意大利', 'Italy'],
    ['netherlands', 'Netherlands'], ['holland', 'Netherlands'], ['荷兰', 'Netherlands'],
    ['poland', 'Poland'], ['波兰', 'Poland'],
    ['belgium', 'Belgium'], ['比利时', 'Belgium'],
    ['switzerland', 'Switzerland'], ['瑞士', 'Switzerland'],
    ['austria', 'Austria'], ['奥地利', 'Austria'],
    ['czechia', 'Czechia'], ['czech republic', 'Czechia'], ['捷克', 'Czechia'],
    ['romania', 'Romania'], ['罗马尼亚', 'Romania'],
    ['spain', 'Spain'], ['西班牙', 'Spain'],
    ['sweden', 'Sweden'], ['瑞典', 'Sweden'],
    ['türkiye', 'Türkiye'], ['turkey', 'Türkiye'], ['土耳其', 'Türkiye'],
    ['india', 'India'], ['印度', 'India'],
    ['japan', 'Japan'], ['日本', 'Japan'],
    ['norway', 'Norway'], ['挪威', 'Norway'],
    ['new zealand', 'New Zealand'], ['新西兰', 'New Zealand'],
    ['ireland', 'Ireland'], ['爱尔兰', 'Ireland'],
    ['mexico', 'Mexico'], ['墨西哥', 'Mexico'],
    ['qatar', 'Qatar'], ['卡塔尔', 'Qatar'],
    ['kuwait', 'Kuwait'], ['科威特', 'Kuwait'],
    ['bahrain', 'Bahrain'], ['巴林', 'Bahrain'],
    ['oman', 'Oman'], ['阿曼', 'Oman'],
    ['jordan', 'Jordan'], ['约旦', 'Jordan'],
    ['egypt', 'Egypt'], ['埃及', 'Egypt'],
    ['iraq', 'Iraq'], ['伊拉克', 'Iraq'],
    ['lebanon', 'Lebanon'], ['黎巴嫩', 'Lebanon'],
    ['yemen', 'Yemen'], ['也门', 'Yemen'],
    ['iran', 'Iran'], ['伊朗', 'Iran'],
    ['syria', 'Syria'], ['叙利亚', 'Syria'],
    ['palestine', 'Palestine'], ['巴勒斯坦', 'Palestine'],
    ['south africa', 'South Africa'], ['南非', 'South Africa'],
    ['brazil', 'Brazil'], ['巴西', 'Brazil'],
    ['chile', 'Chile'], ['智利', 'Chile'],
    ['israel', 'Israel'], ['以色列', 'Israel'],
    ['denmark', 'Denmark'], ['丹麦', 'Denmark'],
    ['finland', 'Finland'], ['芬兰', 'Finland'],
    ['malaysia', 'Malaysia'], ['马来西亚', 'Malaysia'],
    ['singapore', 'Singapore'], ['新加坡', 'Singapore'],
    ['indonesia', 'Indonesia'], ['印度尼西亚', 'Indonesia'], ['印尼', 'Indonesia'],
    ['vietnam', 'Vietnam'], ['越南', 'Vietnam'],
    ['thailand', 'Thailand'], ['泰国', 'Thailand'],
    ['philippines', 'Philippines'], ['菲律宾', 'Philippines'],
    ['south korea', 'South Korea'], ['korea', 'South Korea'], ['韩国', 'South Korea'],
    ['hong kong', 'Hong Kong'], ['香港', 'Hong Kong'],
    ['taiwan', 'Taiwan'], ['台湾', 'Taiwan'],
    ['china', 'China'], ['中国', 'China'],
    ['pakistan', 'Pakistan'], ['巴基斯坦', 'Pakistan'],
    ['morocco', 'Morocco'], ['摩洛哥', 'Morocco'],
    ['nigeria', 'Nigeria'], ['尼日利亚', 'Nigeria'],
    ['portugal', 'Portugal'], ['葡萄牙', 'Portugal'],
    ['greece', 'Greece'], ['希腊', 'Greece']
  ].sort((a, b) => b[0].length - a[0].length);

  const LABELS = [
    [/^(?:公司名称|公司名|公司|company(?:\s*name)?|organization|organisation)$/i, 'company_name'],
    [/^(?:客户类型|类型|customer\s*type|type)$/i, 'customer_type'],
    [/^(?:国家地区|国家|country|nation)$/i, 'country'],
    [/^(?:州\/省|州|省|state|province|region)$/i, 'state'],
    [/^(?:城市|city|town)$/i, 'city'],
    [/^(?:地址|address|addr\.?)$/i, 'address'],
    [/^(?:whats\s*app|whatsapp|wa)$/i, 'whatsapp'],
    [/^(?:公司电话|电话|手机|手机号|phone|tel(?:ephone)?|mobile|cell)$/i, 'company_phone'],
    [/^(?:电子邮箱|邮箱|电子邮件|e-mail|email|mail)$/i, 'company_email'],
    [/^(?:公司官网|官网|网站|网址|website|web\s*site|url|site)$/i, 'website'],
    [/^(?:采购联系人|联系人姓名|联系人|姓名|contact(?:\s*name)?|person|attn\.?)$/i, 'contact_name'],
    [/^(?:职位|职务|job\s*title|title|position)$/i, 'contact_title'],
    [/^linkedin(?:\s*url)?$/i, 'contact_linkedin']
  ];

  const PRODUCT_RULES = [
    ['spc', [/\bspc\b/i, /石塑/]],
    ['laminate', [/laminate/i, /强化复合/, /强化地板/]],
    ['engineered', [/engineered(?:\s*wood)?/i, /实木复合地板?/]],
    ['uv_panel', [/uv\s*(?:装饰|墙板|墙|panel|sheet)/i, /uv装饰/i]],
    ['pvc_fluted', [/fluted/i, /长城板/, /slat\s*wall/i]],
    ['pvc_grille', [/grille/i, /格栅/]],
    ['coex_panel', [/co-?extrusion/i, /共挤/]],
    ['wpc_panel', [/wpc\s*(?:wall|cladding|panel)/i, /外墙挂板/, /wpc墙/i]],
    ['pvc_marble', [/仿大理石/, /marble\s*(?:panel|sheet)/i]],
    ['acoustic', [/acoustic/i, /吸音/]],
    ['wpc_decking', [/decking/i, /户外地板/, /wpc\s*deck/i]]
  ];
  const TYPE_RULES = [
    ['importer', [/\bimporter\b/i, /进口商/, /importeur/i, /importatore/i, /importador/i, /ithalat/i]],
    ['distributor', [/\bdistributor\b/i, /分销商/, /distributeur/i, /distributore/i]],
    ['wholesaler', [/\bwholesaler\b/i, /\bwholesale\b/i, /批发/, /grossist/i, /mayorista/i, /großhandel/i, /groothandel/i]],
    ['brand', [/brand\s*owner/i, /品牌商/]]
  ];

  const clean = value => String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const digits = value => String(value || '').replace(/\D/g, '');
  const stripEdge = value => clean(value).replace(/^[\s,，;；|/]+|[\s,，;；|/]+$/g, '');
  const isEmail = value => /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$/i.test(clean(value));
  const isDomain = value => /^(?:https?:\/\/|www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(clean(value)) && !isEmail(value);
  const isUrl = value => /^(?:https?:\/\/|www\.)/i.test(clean(value)) || isDomain(value);

  function canonicalCountry(value) {
    const text = clean(value).replace(/[。．.]+$/g, '');
    if (!text) return '';
    const lower = text.toLowerCase();
    const exact = COUNTRY_ALIASES.find(([alias]) => alias === lower || alias === text);
    if (exact) return exact[1];
    if (/^us$/i.test(text)) return 'USA';
    return '';
  }

  function findCountry(text) {
    const source = String(text || '');
    const lower = source.toLowerCase();
    let best = null;
    for (const [alias, name] of COUNTRY_ALIASES) {
      const cjk = /[^\u0000-\u007f]/.test(alias);
      let from = 0;
      while (from < (cjk ? source.length : lower.length)) {
        const hay = cjk ? source : lower;
        const at = hay.indexOf(alias, from);
        if (at < 0) break;
        from = at + alias.length;
        if (!cjk) {
          const before = at === 0 ? '' : lower[at - 1];
          const after = lower[at + alias.length] || '';
          if (/[a-z0-9.]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
          if ((alias === 'us' || alias === 'u.s.' || alias === 'u.s.a.') && /\bcontact\s+$/i.test(lower.slice(Math.max(0, at - 12), at))) continue;
        }
        if (!best || at < best.at || (at === best.at && alias.length > best.len)) best = { name, at, len: alias.length };
        break;
      }
    }
    return best;
  }

  function labelKey(raw) {
    const text = clean(raw).replace(/[（(].*[)）]$/, '');
    for (const [re, key] of LABELS) if (re.test(text)) return key;
    return '';
  }
  function keysForLabel(raw) {
    const text = clean(raw).replace(/[（(].*[)）]$/, '');
    const direct = labelKey(text);
    if (direct) return [direct];
    const parts = text.split(/\s*(?:\/|＆|&|\+|和|与)\s*/).map(labelKey).filter(Boolean);
    return [...new Set(parts)];
  }
  function looksLikeName(line) {
    if (line.length < 2 || line.length > 160) return false;
    if (isEmail(line) || isUrl(line) || phonesIn(line).length || findCountry(line)) return false;
    if (unmatched(line).length < 4 && (TYPE_RULES.some(([, rules]) => rules.some(rule => rule.test(line))) || PRODUCT_RULES.some(([, rules]) => rules.some(rule => rule.test(line))))) return false;
    if (/^(?:please|hi|hello|dear|we|i|this|thanks|thank|regards|best|以下|请|他们|我们)\b/i.test(line)) return false;
    if (line.split(/\s+/).length > 8) return false;
    return true;
  }
  function unmatched(line) {
    let rest = ' ' + line + ' ';
    for (const [, rules] of [...PRODUCT_RULES, ...TYPE_RULES]) {
      for (const rule of rules) rest = rest.replace(new RegExp(rule.source, rule.flags.includes('i') ? 'ig' : 'g'), ' ');
    }
    rest = stripEdge(rest).replace(/^[\s:：,，/-]+|[\s:：,，/-]+$/g, '');
    if (!rest || /^(?:whats?\s*app|wa|电话|手机|phone|tel|e-?mail|邮箱|website|网站|网址|url)$/i.test(rest)) return '';
    return rest;
  }

  function phonesIn(line) {
    const found = [];
    const re = /(?:\+|00)\d[\d\s().-]{6,}\d|\b\d[\d\s().-]{7,}\d\b/g;
    let match;
    while ((match = re.exec(line))) {
      const raw = stripEdge(match[0]);
      const count = digits(raw).length;
      if (count < 8 || count > 15) continue;
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw)) continue;
      found.push(raw);
    }
    return found;
  }

  function take(text, re) {
    const match = re.exec(text);
    if (!match) return ['', text];
    return [stripEdge(match[0]), (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))];
  }

  function assign(fields, key, value, override) {
    value = stripEdge(value);
    if (!value || (fields[key] && !override)) return;
    if (key === 'country') {
      const named = canonicalCountry(value) || (findCountry(value) || {}).name || '';
      if (named) fields.country = named;
      return;
    }
    if (key === 'company_email') {
      const email = (value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+/i) || [])[0];
      if (email) fields.company_email = email;
      return;
    }
    if (key === 'website' || key === 'contact_linkedin') {
      const url = (value.match(/https?:\/\/[^\s<>，,；;)]+|www\.[^\s<>，,；;)]+/i) || [])[0] || value;
      if (/linkedin\.com\//i.test(url)) fields.contact_linkedin = url.replace(/[),.;]+$/, '');
      else if (key === 'website') fields.website = url.replace(/[),.;]+$/, '');
      return;
    }
    if (key === 'company_phone' || key === 'whatsapp') {
      const list = phonesIn(value);
      if (list.length) fields[key] = list[0];
      return;
    }
    if (key === 'state' && /^[A-Za-z]{2}$/.test(value)) value = value.toUpperCase();
    if (key === 'customer_type') {
      const hit = TYPE_RULES.find(([, rules]) => rules.some(rule => rule.test(value)));
      if (hit) fields.customer_type = hit[0];
      return;
    }
    fields[key] = value;
  }

  function parse(text) {
    const fields = {};
    const source = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
    const kept = [];
    const noteLines = [];
    for (const line of source.split('\n')) {
      const match = line.match(/^\s*([^:：]{1,40}?)\s*[:：]\s*(.*)$/);
      const label = match ? clean(match[1]) : '';
      if (!match) { kept.push(line); continue; }
      if (/^(?:备注|说明|notes?|comments?)$/i.test(label)) { if (stripEdge(match[2])) noteLines.push(stripEdge(match[2])); continue; }
      if (/^(?:产品|匹配产品|products?)$/i.test(label)) continue;
      const keys = keysForLabel(label);
      if (!keys.length) { kept.push(line); continue; }
      if (keys.length > 1 && keys.every(key => key === 'company_phone' || key === 'whatsapp')) {
        const nums = phonesIn(match[2]);
        if (nums.length <= 1) keys.forEach(key => assign(fields, key, nums[0] || match[2]));
        else keys.forEach((key, index) => assign(fields, key, nums[Math.min(index, nums.length - 1)]));
      } else keys.forEach(key => assign(fields, key, match[2], true));
    }
    let rest = kept.join('\n');

    if (!fields.company_email) {
      const [email, next] = take(rest, /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+/i);
      if (email) { fields.company_email = email; rest = next; }
    }
    if (!fields.contact_linkedin) {
      const [link, next] = take(rest, /(?:https?:\/\/)?(?:[\w.-]+\.)?linkedin\.com\/(?:in|company)\/[^\s<>，,；;)]+/i);
      if (link) { fields.contact_linkedin = link.replace(/[),.;]+$/, ''); rest = next; }
    }
    if (!fields.website) {
      const [site, next] = take(rest, /https?:\/\/[^\s<>，,；;)]+|www\.[^\s<>，,；;)]+/i);
      if (site && !/linkedin\.com\//i.test(site)) { fields.website = site.replace(/[),.;]+$/, ''); rest = next; }
    }
    if (!fields.website) {
      const domainLine = rest.split('\n').map(stripEdge).find(line => isDomain(line) && !/linkedin\.com/i.test(line));
      if (domainLine) { fields.website = domainLine.replace(/[),.;]+$/, ''); rest = rest.replace(domainLine, ' '); }
    }
    const waLine = rest.split('\n').find(line => /whats?\s*app|\bwa\b|微信/i.test(line) && phonesIn(line).length);
    if (waLine && !fields.whatsapp) {
      fields.whatsapp = phonesIn(waLine)[0];
      rest = rest.replace(waLine, waLine.replace(fields.whatsapp, ' '));
    }
    if (!fields.company_phone || !fields.whatsapp) {
      const pool = phonesIn(rest);
      const unused = pool.filter(phone => phone !== fields.whatsapp && phone !== fields.company_phone);
      if (!fields.company_phone && unused.length) fields.company_phone = unused.shift();
      rest = unused.concat(pool.filter(phone => phone === fields.company_phone || phone === fields.whatsapp)).reduce((text, phone) => text.replace(phone, ' '), rest);
      if (fields.company_phone) rest = rest.replace(fields.company_phone, ' ');
      if (fields.whatsapp) rest = rest.replace(fields.whatsapp, ' ');
    }

    if (!fields.country) {
      const found = findCountry(rest);
      if (found) {
        fields.country = found.name;
        const line = rest.split('\n').find(row => row.toLowerCase().includes(found.name.toLowerCase()) || findCountry(row)?.name === found.name);
        if (line) {
          const parts = line.split(/[,，]/).map(stripEdge).filter(Boolean);
          const countryPart = parts.find(part => canonicalCountry(part) === found.name || (findCountry(part) || {}).name === found.name);
          if (parts.length >= 2 && countryPart) {
            const idx = parts.indexOf(countryPart);
            if (!fields.city && idx > 0) fields.city = parts[idx - (parts.length >= 3 ? 2 : 1)];
            if (!fields.state && parts.length >= 3) fields.state = /^[A-Za-z]{2}$/.test(parts[idx - 1]) ? parts[idx - 1].toUpperCase() : parts[idx - 1];
          }
          rest = rest.replace(line, ' ');
        }
      }
    }

    const products = PRODUCT_RULES.filter(([, rules]) => rules.some(rule => rule.test(source))).map(([key]) => key);
    const typeHits = TYPE_RULES.filter(([, rules]) => rules.some(rule => rule.test(source)));
    if (!fields.customer_type && typeHits.length === 1) fields.customer_type = typeHits[0][0];

    const lines = rest.split('\n').map(line => stripEdge(line.replace(/[|]/g, ' '))).filter(Boolean);
    const leftover = [];
    for (const line of lines) {
      if (!fields.company_name && looksLikeName(line)) {
        fields.company_name = line;
        continue;
      }
      const remain = unmatched(line);
      if (remain && !/^(?:and|or|the|of|for|a|an|和|与|及)$/i.test(remain)) leftover.push(remain);
    }
    const notes = [...noteLines, ...leftover].join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { fields, products, notes };
  }

  root.PasteClient = { parse, canonicalCountry };
})(typeof window !== 'undefined' ? window : globalThis);
