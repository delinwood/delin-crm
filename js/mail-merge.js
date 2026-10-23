/* Shared by the browser and mail server. Only structured customer facts enter copy. */
(function (root) {
  const products = {
    laminate: 'laminate flooring', engineered: 'engineered wood flooring', spc: 'SPC flooring',
    uv_panel: 'UV wall panels', pvc_fluted: 'PVC fluted wall panels', pvc_grille: 'PVC grilles',
    coex_panel: 'co-extruded wall panels', wpc_panel: 'WPC wall cladding', pvc_marble: 'PVC marble panels'
  };
  const clean = v => String(v || '').replace(/[\r\n]+/g, ' ').trim();
  const eligibleProducts = c => (c.products || []).filter(p => products[p] && !(c.country === 'USA' && ['laminate', 'engineered'].includes(p)));
  function fields(c, me, cfg) {
    const ps = eligibleProducts(c).map(p => products[p]);
    const type = { importer: 'import and distribution', distributor: 'distribution', wholesaler: 'wholesale', contractor: 'project procurement', retailer: 'your product range' }[c.customer_type] || 'your business';
    return { company: clean(c.company_name), contact_first: clean(c.contact_name).split(/\s+/)[0] || (clean(c.company_name) ? `${clean(c.company_name)} team` : 'there'),
      contact_name: clean(c.contact_name) || 'there', country: clean(c.country), city: clean(c.city),
      products: ps.join(' and ') || 'flooring and wall finishing materials', customer_type: type,
      my_name: clean(me.name_en || me.full_name), my_title: clean(me.title_en) || 'Sales Manager',
      my_company: clean(cfg.COMPANY_NAME_EN), my_email: clean(me.sender_email || me.work_email),
      my_whatsapp: clean(me.whatsapp), my_website: clean(cfg.COMPANY_WEBSITE), moq: clean(cfg.MOQ) || 'half a 20-foot container' };
  }
  function merge(text, c, me, cfg) {
    const f = fields(c, me, cfg);
    return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => Object.hasOwn(f, k) ? f[k] : m);
  }
  function draft(c, me, cfg, template) {
    const f = fields(c, me, cfg);
    if (template) return { subject: merge(template.subject, c, me, cfg), body: merge(template.body, c, me, cfg) };
    const context = f.city ? `${f.city}, ${f.country}` : f.country;
    const focus = eligibleProducts(c).length
      ? `Would ${f.products} be relevant to your next procurement cycle?`
      : 'Which flooring or wall-panel categories are you currently sourcing?';
    return {
      subject: `${f.company} — ${f.products} supply enquiry`,
      body: `Hi ${f.contact_first},\n\nI'm ${f.my_name} from ${f.my_company} in China. We supply flooring and wall finishing materials for B2B orders.\n\nI'm reaching out to ${f.company}${context ? ` in ${context}` : ''} regarding ${f.customer_type}. ${focus}\n\nWe can discuss mixed product requirements and orders starting from half a 20-foot container. If this fits your plans, may I send relevant specifications and a quotation?\n\nBest regards,\n${f.my_name}\n${f.my_title}\n${f.my_company}\n${f.my_email}${f.my_whatsapp ? `\nWhatsApp: ${f.my_whatsapp}` : ''}${f.my_website ? `\n${f.my_website}` : ''}`
    };
  }
  function followup(c, me, cfg, stage) {
    const f = fields(c, me, cfg);
    const focus = eligibleProducts(c).length ? f.products : 'your flooring or wall-panel requirements';
    const question = stage === 1
      ? `I'm following up on my earlier email to ${f.company}. Are you currently reviewing suppliers for ${focus}? If useful, please share the specifications and approximate order quantity you need so we can prepare relevant details.`
      : `Would it be useful for ${f.company} to receive information about ${focus} for a future purchase? If the timing is not right, please let me know when to contact you, or tell me if you prefer no further follow-up.`;
    return { subject: `${f.company} — ${stage === 1 ? 'sourcing follow-up' : 'procurement timing'}`, body: `Hi ${f.contact_first},\n\n${question}\n\nBest regards,\n${f.my_name}\n${f.my_title}\n${f.my_company}\n${f.my_email}${f.my_whatsapp ? `\nWhatsApp: ${f.my_whatsapp}` : ''}${f.my_website ? `\n${f.my_website}` : ''}` };
  }
  // Observable content checks, not an inbox-placement score or address verification.
  function deliveryReview(d) {
    const subject = String(d.subject || ''), body = String(d.body || ''), issues = [];
    const add = (level, text) => issues.push({ level, text });
    if (!subject.trim() || !body.trim()) add('block', '标题或正文为空');
    if (/[\r\n\x00-\x1f\x7f]/.test(subject) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) add('block', '包含非法控制字符，请重新编辑');
    if (/\{\{[^{}]+\}\}/.test(subject + body)) add('block', '存在未替换的模板字段');
    if (subject.length > 250 || body.length > 30000) add('block', '标题或正文超过系统长度限制');
    if (/^\s*(re|fw|fwd)\s*:/i.test(subject)) add('warn', '标题带有 Re/Fw；仅在真实回复或转发时使用，首次开发请去掉');
    if (subject.length > 100) add('warn', '标题较长，建议缩短并明确本次联系目的');
    const letters = subject.match(/[a-z]/ig) || [];
    if (letters.length >= 12 && letters.filter(c => c === c.toUpperCase()).length / letters.length > .8) add('warn', '标题大部分为大写，建议改用正常大小写');
    if (/[!！?？]{3,}/.test(subject)) add('warn', '标题标点连续重复，建议改成正常句式');
    if (/<\/?(?:html|body|a|img|div|p|br)\b/i.test(body)) add('warn', '系统发送纯文本，请移除 HTML 标签，避免收件人看到代码');
    if (body.length > 4000) add('warn', '正文较长，首次联系建议精简，先询问是否需要详细资料');
    const links = (body.match(/https?:\/\/[^\s<>"']+/gi) || []).map(x => x.replace(/[),.;!?]+$/, ''));
    const hosts = new Set(); let short = false, insecure = false, address = false;
    for (const raw of links) {
      try {
        const u = new URL(raw); hosts.add(u.hostname.toLowerCase());
        short ||= /(^|\.)(bit\.ly|tinyurl\.com|t\.co|shorturl\.at|cutt\.ly|rb\.gy)$/i.test(u.hostname);
        insecure ||= u.protocol === 'http:';
        address ||= !!u.username || !!u.password || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname);
      } catch { add('warn', '有无法解析的链接，请核对地址'); }
    }
    if (links.length > 3 || hosts.size > 2) add('warn', '链接较多或跳转多个域名，建议只保留必要的公司官网链接');
    if (short) add('warn', '包含短链接，建议换成可辨认的原始公司网页地址');
    if (insecure) add('warn', '包含 HTTP 链接；确认网站支持后改用 HTTPS');
    if (address) add('warn', '链接使用 IP 或嵌入登录信息，请检查地址真实性');
    return { issues, blocked: issues.some(x => x.level === 'block') };
  }
  function deliveryBatch(rows, schedule) {
    const customers = rows.map(m => ({ client_id: m.client_id, company_name: m.company_name,
      drafts: (m.drafts || [m]).map((d, i) => ({ round: i, ...deliveryReview(d) })) }));
    const notes = [], bodies = rows.map(m => String((m.drafts || [m])[0].body || '').trim());
    if (bodies.length > 1 && new Set(bodies).size < bodies.length) notes.push('多位客户的首封正文完全相同，请核实采购匹配度并补充真实的公司或产品信息。');
    if (schedule?.interval_days && (schedule.max_sends === 0 || schedule.max_sends > 3)) notes.push('持续或多轮联系未回复客户可能增加投诉，建议设置有限轮数，收到回复或拒绝后停止。');
    return { customers, notes, blocked: customers.filter(m => m.drafts.some(d => d.blocked)).length,
      warnings: customers.filter(m => m.drafts.some(d => d.issues.some(x => x.level === 'warn'))).length };
  }
  root.CRM_MAIL = { fields, merge, draft, followup, eligibleProducts, deliveryReview, deliveryBatch };
})(globalThis);
