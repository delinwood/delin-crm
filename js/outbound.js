/* Clickable outbound links. Opens a public page in a new tab; it does not embed or call a paid API. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const clean = (value, max = 200) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const enc = encodeURIComponent;
  const GROUPS = {
    compact: ['website', 'mailto', 'whatsapp', 'tel', 'maps', 'linkedin-company', 'linkedin-people', 'linkedin-profile'],
    go: ['website', 'mailto', 'google', 'maps', 'linkedin-company', 'linkedin-people', 'linkedin-profile'],
    full: ['website', 'mailto', 'whatsapp', 'tel', 'google', 'maps', 'linkedin-company', 'linkedin-people', 'linkedin-profile', 'importyeti', 'portexaminer', 'cnudata', 'opencorporates', 'hunter', 'companies-house', 'apollo', 'cbls', 'saudi-cr']
  };

  function https(value) {
    const raw = clean(value, 2048);
    if (!raw || /^(?:javascript|data|mailto|tel):/i.test(raw)) return '';
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return '';
      return url.href;
    } catch (e) { return ''; }
  }
  function domain(value) {
    const url = https(value);
    if (!url) return '';
    try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; }
  }
  function emailOf(record) {
    const value = clean(record.company_email || record.email, 320);
    return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$/i.test(value) ? value : '';
  }
  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function waHref(record) {
    const raw = record.whatsapp || record.company_phone || record.phone || '';
    let href = '';
    const ui = root.UI;
    if (ui && typeof ui.wa === 'function') href = ui.wa(raw, record) || '';
    if (!href) {
      const n = digits(raw);
      if (n.length >= 8 && n.length <= 15) href = 'https://wa.me/' + n;
    }
    const n = (String(href).match(/wa\.me\/(\d+)/) || [])[1] || '';
    return n.length >= 8 && n.length <= 15 ? href : '';
  }
  function telHref(record) {
    const raw = record.company_phone || record.phone || '';
    const ui = root.UI;
    if (ui && typeof ui.tel === 'function' && String(raw).trim()) {
      const href = ui.tel(raw, record);
      const n = digits(href);
      if (n.length >= 8 && n.length <= 15) return href;
    }
    const n = digits(raw);
    return n.length >= 8 && n.length <= 15 ? 'tel:+' + n : '';
  }
  function countryKind(country) {
    const value = clean(country, 80).toLowerCase();
    if (['united kingdom', 'uk', '英国', 'gb'].includes(value)) return 'uk';
    if (['united arab emirates', 'uae', '阿联酋'].includes(value)) return 'uae';
    if (['saudi arabia', 'ksa', '沙特', '沙特阿拉伯'].includes(value)) return 'saudi';
    return '';
  }
  function peopleQuery(record) {
    return clean([record.contact_name || record.person, record.company_name || record.company].filter(Boolean).join(' '));
  }

  function build(record) {
    const row = record || {};
    const company = clean(row.company_name || row.company);
    const personQuery = peopleQuery(row);
    const email = emailOf(row);
    const site = https(row.website);
    const host = domain(row.website);
    const profile = https(row.contact_linkedin || row.linkedin);
    const linkedinProfile = /linkedin\.com\/(?:in|company)\//i.test(profile) ? profile : '';
    const place = countryKind(row.country);
    const items = [];
    const add = (id, label, href, note) => { if (href) items.push({ id, label, href, note: note || '' }); };
    add('website', '打开网站', site);
    add('mailto', '写邮件', email ? 'mailto:' + email : '');
    add('whatsapp', 'WhatsApp', waHref(row));
    add('tel', '拨打', telHref(row));
    add('google', 'Google 搜索', company ? 'https://www.google.com/search?q=' + enc(company) : '');
    add('maps', 'Google 地图', company ? 'https://www.google.com/maps/search/?api=1&query=' + enc(company) : '');
    add('linkedin-company', 'LinkedIn 公司', company ? 'https://www.linkedin.com/search/results/companies/?keywords=' + enc(company) : '');
    add('linkedin-people', 'LinkedIn 找人', personQuery ? 'https://www.linkedin.com/search/results/people/?keywords=' + enc(personQuery) : '');
    add('linkedin-profile', 'LinkedIn 此人', linkedinProfile);
    add('importyeti', 'ImportYeti', company ? 'https://www.importyeti.com/search?q=' + enc(company) : '');
    add('portexaminer', 'PortExaminer', company ? 'https://portexaminer.com/search.php?search-field-1=consignee&search-term-1=' + enc(company) : '');
    add('cnudata', 'CNUData', 'https://cnudata.com/', '打开首页');
    add('opencorporates', 'OpenCorporates', company ? 'https://opencorporates.com/companies?q=' + enc(company) : '');
    add('hunter', 'Hunter 邮箱', host ? 'https://hunter.io/search/' + enc(host) : '', '按域名，不调用接口');
    add('companies-house', '英国 Companies House', company ? 'https://find-and-update.company-information.service.gov.uk/search?q=' + enc(company) : '');
    add('apollo', 'Apollo 找人', company ? 'https://app.apollo.io/#/people?personTitles[]=purchasing%20manager&qOrganizationKeywordTags[]=' + enc(company) : 'https://app.apollo.io/', '需账号');
    if (place === 'uae') add('cbls', '阿联酋 CBLS', 'https://cbls.economy.ae/', '需在官网查询');
    if (place === 'saudi') add('saudi-cr', '沙特商业登记', 'https://mc.gov.sa/en/pages/default.aspx', '需在官网填写');
    return items;
  }

  function items(record, mode) {
    const allow = new Set(GROUPS[mode] || GROUPS.compact);
    return build(record).filter(item => allow.has(item.id));
  }
  function escAttr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function bar(record, mode) {
    const list = items(record, mode);
    if (!list.length) return '';
    const esc = root.UI && root.UI.esc ? root.UI.esc : escAttr;
    return `<div class="outbound">${list.map(item => {
      const external = /^https?:/i.test(item.href);
      const note = item.note ? ' · ' + esc(item.note) : '';
      return `<a class="btn ghost sm" data-outbound="${esc(item.id)}" href="${esc(item.href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(item.label)}${note}</a>`;
    }).join('')}</div>`;
  }

  const api = { items, bar, build, https, domain, waHref, peopleQuery, GROUPS };
  root.CRM_OUTBOUND = api;
  if (root.UI) root.UI.outboundBar = (record, mode) => bar(record, mode);
})();
