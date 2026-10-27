/* CRM assistant: transparent, local rule-based help; no autonomous writes or sends. */
(function () {
  const { $, esc } = UI;
  const countryAliases = {
    '沙特': 'Saudi Arabia', '沙特阿拉伯': 'Saudi Arabia', '菲律宾': 'Philippines', '美国': 'USA', '加拿大': 'Canada',
    '英国': 'United Kingdom', '澳大利亚': 'Australia', '阿联酋': 'United Arab Emirates', '德国': 'Germany', '日本': 'Japan',
    '印度': 'India', '墨西哥': 'Mexico', '法国': 'France', '意大利': 'Italy', '西班牙': 'Spain', '波兰': 'Poland', '土耳其': 'Türkiye'
  };
  const productAliases = [
    [['强化复合地板','强化地板','laminate'], 'laminate'], [['橡木复合地板','实木复合地板','engineered'], 'engineered'],
    [['spc','石塑地板'], 'spc'], [['uv墙板','uv装饰板'], 'uv_panel'], [['pvc格栅','格栅'], 'pvc_grille'],
    [['pvc墙板','长城板','条形墙板'], 'pvc_fluted'], [['共挤墙板','co-extrusion'], 'coex_panel'], [['wpc墙板','外墙挂板'], 'wpc_panel']
  ];
  const visibleClients = () => UI.CLIENTS.filter(c => UI.ME.role === 'admin' || c.owner_id === UI.ME.id);
  const productsOf = c => (c.products || []).map(C.productName).join('、') || '尚未登记';
  const contactOf = c => c.contact_name || c.company_name || '采购团队';
  const statusLabel = c => UI.isInvalid?.(c) || c.status === '无效' ? '无效，停止常规跟进' : (c.status || '未联系');
  const getQualification = async () => {
    try { return await UI.BUSINESS.rows('qualification'); } catch (_) { return []; }
  };
  const isPending = f => !f || f.state === 'pending' || !f.source || !f.date || (!f.value && f.state !== 'no');
  const facts = [['sells_products','产品匹配'],['wholesale','批发业务'],['warehouse','仓库'],['import_evidence','进口依据'],['annual_volume','预计采购量']];

  function parseQuery(query, clients, qualifications) {
    const q = query.trim().toLowerCase();
    const country = Object.entries(countryAliases).find(([alias]) => q.includes(alias))?.[1]
      || clients.find(c => c.country && q.includes(c.country.toLowerCase()))?.country;
    const product = productAliases.find(([aliases]) => aliases.some(alias => q.includes(alias.toLowerCase())))?.[1];
    const wholesale = /批发|wholesale|bulk/i.test(q), warehouse = /仓库|warehouse|stockist/i.test(q);
    const status = /未联系|未开发|not contacted/i.test(q) ? '未联系'
      : /已回复|replied/i.test(q) ? '已回复' : /已联系|contacted/i.test(q) ? '已联系' : '';
    const byClient = new Map(qualifications.map(r => [r.client_id, r.data || {}]));
    const affirmative = value => { const v=String(value||'').trim(); return !!v && !/没有|无仓库|不做|非批发|\bno\b|\bnot\b/i.test(v) && /^(有|是|yes|true|仓库|批发)/i.test(v); };
    return clients.filter(c => (!country || c.country === country)
      && (!product || (c.products || []).includes(product))
      && (!status || c.status === status)
      && (!wholesale || /wholesaler|批发商/i.test(C.typeName(c.customer_type)) || (byClient.get(c.id)?.wholesale?.state==='confirmed' && affirmative(byClient.get(c.id)?.wholesale?.value)))
      && (!warehouse || (byClient.get(c.id)?.warehouse?.state === 'confirmed' && affirmative(byClient.get(c.id)?.warehouse?.value))));
  }

  function customerSummary(c, qualification, logs) {
    const q = qualification?.data || {}, pending = facts.filter(([k]) => isPending(q[k])).map(([,label]) => label);
    const latest = logs?.[0];
    return `<section class="card pad"><div class="pagehead"><h2>${esc(c.company_name)}</h2><div class="actions"><a class="btn ghost" href="#/business/${esc(c.id)}">采购档案</a><a class="btn ghost" href="#/client/${esc(c.id)}">客户详情</a></div></div>
      <p>${esc(c.country || '国家待确认')}${c.city ? ' · '+esc(c.city) : ''} · ${esc(C.typeName(c.customer_type) || '客户类型待确认')} · ${esc(statusLabel(c))}</p>
      <p>产品：${esc(productsOf(c))} · 优先级：${esc(c.priority || '未设置')} · 负责人：${esc(UI.userName(c.owner_id))}</p>
      <p>联系人：${esc(contactOf(c))}${c.contact_title ? ' · '+esc(c.contact_title) : ''} · ${esc(c.company_email || '邮箱待确认')}</p>
      <p>${c.website ? UI.link(UI.url(c.website), c.website) : '官网待确认'}${c.company_phone ? ' · '+esc(c.company_phone) : ''}</p>
      <p class="muted small">采购资格：${facts.map(([k,label])=>`${label}：${isPending(q[k])?'待核实':q[k].state==='no'?'已确认没有':esc(q[k].value||'已确认')}`).join('；')}</p>
      ${pending.length ? `<p class="warn">建议核实：${pending.map(esc).join('、')}。记录确认结论时请填写来源和日期。</p>` : '<p class="muted small">核心采购资格均已登记依据；联系前仍请检查资料时效。</p>'}
      <p>${latest ? `最近跟进：${esc(latest.entry_date || '')} · ${esc(C.channelName(latest.channel))} · ${esc(latest.content || '')}` : '暂无跟进记录'}</p>
      <p>下一步建议：${UI.isInvalid?.(c) || c.status==='无效' ? '已标记无效，不安排常规联系。' : c.status==='已回复' ? '先阅读客户回复并记录需求，再决定是否提供规格或报价。' : c.next_follow_up && c.next_follow_up <= UI.today() ? '跟进日期已到；先核对最近邮件和联系人，再发送个性化内容。' : c.status==='已报价' ? '确认报价是否收到，并按客户反馈更新商机阶段。' : '核实采购匹配和联系方式后，准备一封针对其产品的开发邮件。'}</p>
      ${!UI.isInvalid?.(c) && c.status!=='无效' ? `<button class="primary sm" data-agent-draft="${esc(c.id)}">生成邮件草稿</button>` : ''}
      </section>`;
  }

  function draft(c) {
    const products = (c.products || []).map(C.productEN).filter(Boolean);
    const greeting = c.contact_name ? `Dear ${c.contact_name.trim().split(/\s+/)[0]},` : 'Dear Purchasing Team,';
    const subject = `Flooring and wall panel supply for ${c.company_name}`;
    const productText = products.length ? products.join(', ') : 'flooring and wall panel products';
    const body = `${greeting}\n\nI’m reaching out from ${CRM_CONFIG.COMPANY_NAME_EN}, a flooring and wall panel manufacturer in China. I noticed ${c.company_name} is listed in our CRM as a potential ${C.typeCN(c.customer_type) || 'building-material'} partner in ${c.country || 'your market'}.\n\nWe supply ${productText}. If these products are relevant to your current sourcing, I can share specifications, packaging details and a quotation based on your requirements.\n\nWould you be the right person to discuss this, or could you point me to your purchasing contact?\n\nBest regards,\n${UI.ME.full_name}\n${CRM_CONFIG.COMPANY_NAME_EN}`;
    UI.modal(`<h2>个性化邮件草稿 · ${esc(c.company_name)}</h2><p class="muted small">根据 CRM 现有公司、联系人和产品字段生成的草稿；不是外部 AI 调研结果。请人工核对身份、称呼和产品。发送前仍需在邮件中心预览并确认。</p><label>主题<input id="agentSubject" value="${esc(subject)}" maxlength="250"></label><label>正文<textarea id="agentBody" rows="14">${esc(body)}</textarea></label><div class="actions"><button class="primary" id="agentCopy">复制草稿</button><button class="ghost" id="agentOpenMail">带入 CRM 邮件中心预览</button></div>`, m => {
      m.querySelector('#agentCopy').onclick = () => UI.copy(`Subject: ${m.querySelector('#agentSubject').value}\n\n${m.querySelector('#agentBody').value}`);
      m.querySelector('#agentOpenMail').onclick = () => { if (typeof UI.mailCompose === 'function') UI.mailCompose([c.id], {subject:m.querySelector('#agentSubject').value,body:m.querySelector('#agentBody').value}); else { UI.copy(`Subject: ${m.querySelector('#agentSubject').value}\n\n${m.querySelector('#agentBody').value}`); location.hash='#/mail'; UI.toast('草稿已复制；请在邮件中心核对并发送'); } };
    });
  }

  async function render() {
    const clients = visibleClients(), qRows = await getQualification(), qMap = new Map(qRows.map(r=>[r.client_id,r]));
    UI.render(`<div class="pagehead"><h1>CRM 规则助手 <small>Assistant</small></h1><a class="btn primary" href="#/ai">进入AI工作台</a><span class="muted small">第一版 · 基于 CRM 资料的规则助手</span></div>
      <section class="card pad"><h2>用自然语言找客户</h2><form id="agentSearch"><label>描述目标客户<input name="query" type="search" placeholder="例如：找沙特做 SPC 地板批发、有仓库、未联系的客户"></label><button class="primary">搜索 CRM 客户</button></form><p class="muted small">只检索你有权限查看的 CRM 客户；当前支持国家、产品、批发/仓库字段和跟进状态组合。仓库条件仅匹配已标记确认的采购档案，不会把未知资料当事实。</p><div id="agentResults"></div></section>
      <section class="card pad"><div class="pagehead"><h2>待核实客户清单</h2><span class="muted small">按当前可见客户和已填写的采购档案生成</span></div><div id="agentReviewQueue"></div></section>
      <section class="card pad"><h2>使用说明</h2><p>助手当前不调用外部 AI 或搜索服务，不额外产生模型/API费用。搜索和建议来自 CRM 已有资料；公开资料补充请使用“找客户 / 自动补资料”，结果仍需业务员核实。邮件只生成草稿；客户资料变更、发送邮件和商机推进都由你确认。</p></section>`,'agent');
    const queue = clients.filter(c => !UI.isInvalid?.(c) && c.status!=='无效').map(c => ({c, pending: facts.filter(([k])=>isPending(qMap.get(c.id)?.data?.[k])).map(([,label])=>label)})).filter(x=>x.pending.length || !cHasContact(x.c));
    $('#agentReviewQueue').innerHTML = queue.slice(0,30).map(({c,pending})=>`<p><a href="#/business/${esc(c.id)}"><b>${esc(c.company_name)}</b></a> · ${esc(c.country||'国家待确认')} · ${pending.length?`待核实：${pending.map(esc).join('、')}`:'待核实联系人/邮箱'}</p>`).join('') || '<p class="muted">当前没有明显缺项。建议定期复核来源和联系方式。</p>';
    if(queue.length>30)$('#agentReviewQueue').insertAdjacentHTML('beforeend',`<p class="muted small">仅显示前30家，共 ${queue.length} 家；可按客户负责人处理。</p>`);
    $('#agentSearch').onsubmit = e => { e.preventDefault(); const results=parseQuery(e.target.query.value,clients,qRows); $('#agentResults').innerHTML=`<h3>找到 ${results.length} 家</h3>`+(results.slice(0,30).map(c=>`<p><a href="#/client/${esc(c.id)}"><b>${esc(c.company_name)}</b></a> · ${esc(c.country||'')} · ${esc(C.typeCN(c.customer_type))} · ${esc(productsOf(c))} · ${esc(statusLabel(c))} <button class="ghost sm" data-agent-summary="${esc(c.id)}">摘要</button></p>`).join('') || '<p class="muted">没有匹配客户。可放宽产品或采购资格条件后重试。</p>')+(results.length>30?'<p class="muted small">仅显示前30项，请增加条件缩小结果。</p>':'');
      $('#agentResults').querySelectorAll('[data-agent-summary]').forEach(b=>b.onclick=async()=>{const c=clients.find(x=>x.id===b.dataset.agentSummary);if(!c)return;const logs=await DB.listLogs(c.id);const wrap=document.createElement('div');wrap.innerHTML=customerSummary(c,qMap.get(c.id),logs);UI.modal(wrap.innerHTML,m=>m.querySelector('[data-agent-draft]')?.addEventListener('click',()=>draft(c)));});
    };
  }
  function cHasContact(c){return !!(c.contact_name && (c.company_email || c.company_phone));}
  UI.views.agent={render};
})();
