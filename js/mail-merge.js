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
  root.CRM_MAIL = { fields, merge, draft, followup, eligibleProducts };
})(globalThis);
