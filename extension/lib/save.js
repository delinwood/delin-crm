/* Pure rules for saving one visible LinkedIn person. No network and no invented contact details. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

  function linkedinKey(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    let url;
    try { url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); }
    catch (e) { return ''; }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || url.username || url.password) return '';
    const match = url.pathname.match(/^\/(in|company)\/([^/?#]+)/i);
    if (!match) return '';
    let slug = match[2];
    try { slug = decodeURIComponent(slug); } catch (e) { return ''; }
    slug = slug.toLowerCase().replace(/\/+$/, '');
    if (!/^[a-z0-9-]{2,120}$/.test(slug)) return '';
    return match[1].toLowerCase() + '/' + slug;
  }
  function canonicalLinkedIn(raw) {
    const key = linkedinKey(raw);
    return key ? 'https://www.linkedin.com/' + key : '';
  }
  function nameKey(value) {
    return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|ltd|llc|corp|corporation|co|company|limited|group|the|gmbh|sa|sas|srl|bv|nv|sp z o o|ltee|ltée|plc|pty)\b/g, ' ').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
  }
  function domain(value) {
    let text = String(value || '').trim().toLowerCase();
    if (!text || /\s/.test(text)) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = 'https://' + text;
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      return url.hostname.replace(/^www\./, '');
    } catch (e) { return ''; }
  }
  function phoneKey(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 7 ? digits.slice(-9) : '';
  }
  function email(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text) ? text : '';
  }
  function phoneOk(value) {
    if (!value) return true;
    const digits = String(value).replace(/\D/g, '');
    return /^[0-9+(). -]{7,32}$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }
  function parseLocation(raw) {
    const text = clip(raw, 200);
    if (!text) return { city: '', state: '', country: '', raw: '' };
    const parts = text.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3) return { city: clip(parts[0], 80), state: clip(parts[1], 80), country: clip(parts[parts.length - 1], 80), raw: text };
    if (parts.length === 2) return { city: clip(parts[0], 80), state: '', country: clip(parts[1], 80), raw: text };
    return { city: clip(text, 80), state: '', country: '', raw: text };
  }
  function visiblePerson(input) {
    const source = input || {};
    const linkedin = canonicalLinkedIn(source.linkedin || source.url || '');
    const kind = linkedinKey(linkedin).split('/')[0] || '';
    const emailRaw = clip(source.email, 320);
    const company = clip(source.company, 200) || (kind === 'company' ? clip(source.name, 200) : '');
    return {
      name: kind === 'company' ? '' : clip(source.name, 200),
      title: clip(source.title || source.headline, 200),
      company,
      companyName: company,
      location: parseLocation(source.location),
      linkedin,
      kind,
      email: email(emailRaw),
      emailRaw,
      phone: clip(source.phone, 32),
      whatsapp: clip(source.whatsapp, 32),
      website: clip(source.website, 300)
    };
  }
  function textOf(node) {
    if (!node) return '';
    return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function readPage(doc, href) {
    const page = doc || {};
    const query = selector => page.querySelector ? page.querySelector(selector) : null;
    const url = href || (page.location && page.location.href) || '';
    const key = linkedinKey(url);
    const companyPage = key.startsWith('company/');
    const heading = query('main h1') || query('h1');
    const name = textOf(heading);
    const headline = textOf(query('.text-body-medium.break-words'));
    const location = textOf(query('.text-body-small.inline.t-black--light.break-words') || query('.text-body-small.inline'));
    let company = '';
    if (companyPage) company = name;
    else {
      const card = heading && heading.closest ? heading.closest('section') : null;
      const top = card && card.querySelector ? card.querySelector('a[href*="/company/"]') : null;
      const experience = query('#experience');
      const section = experience && experience.closest ? experience.closest('section') : null;
      const past = section && section.querySelector ? section.querySelector('a[href*="/company/"]') : null;
      company = textOf(top || past).split('·')[0];
    }
    let website = '';
    if (companyPage && page.querySelectorAll) {
      const links = [...page.querySelectorAll('main a')].slice(0, 40);
      const site = links.find(link => /^(website|访问网站|官网)$/i.test(textOf(link)) && link.href && !/linkedin\.com/i.test(link.href));
      website = site ? site.href : '';
    }
    return visiblePerson({
      name: companyPage ? '' : name,
      company,
      title: headline,
      location,
      linkedin: url,
      website
    });
  }

  function reasonsForClient(person, client) {
    const reasons = [];
    const site = domain(person.website);
    const phone = phoneKey(person.phone || person.whatsapp);
    const named = nameKey(person.companyName);
    if (person.linkedin && linkedinKey(client.contact_linkedin) === linkedinKey(person.linkedin)) reasons.push('LinkedIn');
    if (person.email && email(client.company_email) === person.email) reasons.push('邮箱 email');
    if (site && domain(client.website) === site) reasons.push('网站 domain');
    if (phone && [phoneKey(client.company_phone), phoneKey(client.whatsapp)].includes(phone)) reasons.push('电话 phone');
    if (named.length > 3 && nameKey(client.company_name) === named) reasons.push('名称 name');
    return reasons;
  }
  function reasonsForContact(person, data) {
    const reasons = [];
    const phone = phoneKey(person.phone || person.whatsapp);
    if (person.linkedin && linkedinKey(data.linkedin) === linkedinKey(person.linkedin)) reasons.push('LinkedIn');
    if (person.email && email(data.email) === person.email) reasons.push('邮箱 email');
    if (phone && phoneKey(data.whatsapp || data.phone) === phone) reasons.push('电话 phone');
    return reasons;
  }
  function decorate(row, me) {
    const role = me && me.role;
    const mine = !!(row.mine || (row.owner_id && me && row.owner_id === me.id));
    const pool = row.pool === true || row.owner_name === '公海 Pool' || row.owner_id === null;
    return {
      match: row.match,
      company_name: row.client_id ? (row.company_name || null) : null,
      owner_name: row.owner_name || (pool ? '公海 Pool' : mine ? '我的客户' : '其他负责人'),
      client_id: row.client_id || null,
      mine,
      writable: role === 'admin' || mine || row.writable === true,
      pool: !!pool
    };
  }
  function matchLocal(person, clients, contacts, rpcRows, me) {
    const map = new Map();
    const put = row => {
      const next = decorate(row, me);
      const key = next.client_id || 'hidden:' + (next.owner_name || '') + ':' + next.match;
      const prev = map.get(key);
      if (!prev) { map.set(key, next); return; }
      const parts = new Set((prev.match + ' + ' + next.match).split(/\s+\+\s+/).map(part => part.trim()).filter(Boolean));
      prev.match = [...parts].join(' + ');
      prev.company_name = prev.company_name || next.company_name;
      prev.mine = prev.mine || next.mine;
      prev.writable = prev.writable || next.writable;
      prev.pool = prev.pool || next.pool;
    };
    (clients || []).forEach(client => {
      const reasons = reasonsForClient(person, client);
      if (!reasons.length) return;
      put({
        match: reasons.join(' + '),
        company_name: client.company_name,
        owner_id: client.owner_id,
        owner_name: client.owner_id ? (client.owner_id === me?.id ? '我的客户' : '其他负责人') : '公海 Pool',
        client_id: client.id,
        mine: !!(me && client.owner_id === me.id),
        pool: !client.owner_id
      });
    });
    (contacts || []).forEach(record => {
      const id = record.account_id || record.client_id;
      const reasons = reasonsForContact(person, record.data || {});
      if (!id || !reasons.length) return;
      put({ match: reasons.join(' + '), client_id: id, company_name: record.company_name || null, owner_id: record.owner_id, owner_name: record.owner_name || '' });
    });
    (rpcRows || []).forEach(row => {
      if (!row || !row.match) return;
      put({
        match: row.match,
        company_name: row.company_name,
        owner_name: row.owner_name,
        client_id: row.client_id,
        mine: row.mine,
        pool: row.owner_name === '公海 Pool'
      });
    });
    return [...map.values()].slice(0, 10);
  }
  function plan(person, matches, me) {
    const list = Array.isArray(matches) ? matches : [];
    const company = (person.companyName || '').trim();
    return {
      canCreate: (me?.role === 'admin' || list.length === 0) && company.length >= 2,
      createPool: me?.role === 'admin',
      hidden: list.filter(row => !row.client_id),
      visible: list.filter(row => row.client_id)
    };
  }
  function note(person, today) {
    const lines = ['来自 LinkedIn 当前页面上已显示的资料，没有检索或解锁隐藏联系方式。'];
    if (person.title) lines.push('职位：' + person.title);
    if (person.location.raw) lines.push('地点：' + person.location.raw);
    if (person.linkedin) lines.push(person.linkedin);
    return lines.join('\n');
  }
  function assertContact(person) {
    if (person.emailRaw && !person.email) throw new Error('邮箱格式不正确');
    if (!phoneOk(person.phone)) throw new Error('电话格式不正确');
    if (!phoneOk(person.whatsapp)) throw new Error('WhatsApp 号码格式不正确');
    if (person.website && !domain(person.website)) throw new Error('网站格式不正确');
  }
  function clientRow(person, options) {
    const role = options.role;
    const company = (person.companyName || '').trim();
    if (company.length < 2) throw new Error('请填写公司名称。只保存页面上看到的公司，没有公司名时请手工补上。');
    if (options.pool && role !== 'admin') throw new Error('业务员新建客户进入自己的客户，不能放入公海');
    assertContact(person);
    const today = options.today || '';
    return {
      company_name: company,
      customer_type: 'other',
      country: person.location.country || null,
      state: person.location.state || null,
      city: person.location.city || null,
      company_phone: person.phone || null,
      whatsapp: person.whatsapp || null,
      company_email: person.email || null,
      website: person.website || null,
      contact_name: person.name || null,
      contact_title: person.title || null,
      contact_linkedin: person.kind === 'in' ? person.linkedin : null,
      products: [],
      priority: 'C',
      owner_id: options.pool ? null : options.userId,
      status: '未联系',
      tags: ['LinkedIn'],
      notes: note(person, today),
      source_note: ('LinkedIn 可见资料 ' + today + ' ' + (person.linkedin || '')).trim(),
      reach_channel: person.whatsapp ? 'whatsapp' : (person.email ? 'email' : null)
    };
  }
  function contactData(person, today) {
    if (!(person.name || '').trim()) return null;
    assertContact(person);
    return {
      name: person.name,
      role: person.title,
      email: person.email,
      phone: person.phone,
      whatsapp: person.whatsapp,
      linkedin: person.kind === 'in' ? person.linkedin : '',
      source: person.linkedin || 'LinkedIn 当前页面',
      notes: note(person, today),
      checked_at: ''
    };
  }
  function blankPatch(client, person) {
    const patch = {};
    const empty = value => value == null || String(value).trim() === '';
    if (empty(client.contact_name)) {
      if (person.name) patch.contact_name = person.name;
      if (person.title) patch.contact_title = person.title;
      if (person.kind === 'in' && person.linkedin) patch.contact_linkedin = person.linkedin;
    }
    if (empty(client.company_email) && person.email) patch.company_email = person.email;
    if (empty(client.company_phone) && person.phone) patch.company_phone = person.phone;
    if (empty(client.whatsapp) && person.whatsapp) patch.whatsapp = person.whatsapp;
    if (empty(client.website) && person.website && domain(person.website)) patch.website = person.website;
    if (empty(client.city) && person.location.city) patch.city = person.location.city;
    if (empty(client.state) && person.location.state) patch.state = person.location.state;
    if (empty(client.country) && person.location.country) patch.country = person.location.country;
    return patch;
  }
  function sameContact(person, client, contacts) {
    const key = linkedinKey(person.linkedin);
    const named = (person.name || '').trim().toLowerCase();
    const rows = [{ linkedin: client.contact_linkedin, email: client.company_email, name: client.contact_name }]
      .concat((contacts || []).map(record => ({ linkedin: record.data?.linkedin, email: record.data?.email, name: record.data?.name })));
    return rows.some(row => {
      if (key && person.kind === 'in' && linkedinKey(row.linkedin) === key) return true;
      if (person.email && email(row.email) === person.email) return true;
      return !!(named && String(row.name || '').trim().toLowerCase() === named);
    });
  }

  root.CRM_SAVE = {
    linkedinKey, canonicalLinkedIn, nameKey, domain, phoneKey, email, phoneOk, parseLocation,
    visiblePerson, readPage, matchLocal, plan, clientRow, contactData, blankPatch, sameContact
  };
})();
