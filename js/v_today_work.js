/* Daily tasks from existing records and planned replenishment dates. */
(function(){
  const {esc,$,$$}=UI, B=UI.BUSINESS;
  const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const path=id=>'#/client/'+encodeURIComponent(id);
  const reorderPath=id=>'#/reorder-plan/'+encodeURIComponent(id);
  const rpc=B.rpc;
  const active=c=>B.canEdit(c)&&!UI.isInvalid(c)&&!!c.owner_id;
  const table=async(name,cols,configure=q=>q)=>{
    const result=[];
    for(let from=0;;from+=500){
      const rows=DB.chk(await configure(DB.t(name).select(cols)).range(from,from+499));
      result.push(...rows);if(rows.length<500)return result;
    }
  };
  function finish(item,render){
    UI.modal(`<h2>记录待办处理结果</h2><p>${esc(item.title)} · ${esc(item.client.company_name)}</p>
    <form><label>处理结果<textarea name="outcome" rows="4" maxlength="2000" required></textarea></label>
    <label>下一步日期（可选）<input type="date" name="next" min="${today()}"></label>
    <p class="muted small">如果实际联系了客户，请在客户档案登记跟进，更新公海回收计时。</p>${B.footer}</form>`,(modal,close)=>{
      B.bindForm(modal.querySelector('form'),async form=>{
        const outcome=form.elements.outcome.value.trim();
        if(!outcome)throw Error('请填写实际处理结果');
        await rpc('crm_finish_work_item',{p_client:item.client.id,p_key:item.key,p_outcome:outcome,p_next:form.elements.next.value||null});
        close();UI.toast('处理结果已记录');await render();
      });
    });
  }
  async function tasks(){
    if(DB.mode==='demo')return UI.render('<section class="card pad"><h1>今日待办</h1><p>正式系统读取客户、询盘和商机记录。</p></section>','home');
    const current=UI.viewCurrent(), d=today(), d7=shift(d,7), d30=shift(d,-30);
    const [plans,outcomes,replies,quotes,samples,opps]=await Promise.all([
      table('crm_reorder_plans','*',q=>q.order('client_id')),
      table('crm_work_outcomes','*',q=>q.order('created_at',{ascending:false}).order('id')),
      table('crm_mail_inbound','id,client_id,subject,received_at',q=>q.eq('kind','reply').gte('received_at',d30+'T00:00:00+08:00').order('received_at',{ascending:false}).order('id')),
      DB.listQuotes(),DB.listSamples(),B.rows('opportunity')
    ]);
    if(!current())return;
    const clients=new Map(UI.CLIENTS.filter(active).map(c=>[c.id,c]));
    const done=new Map(), records=new Map();
    const add=(id,key,title,desc,due,href=path(id))=>{
      const client=clients.get(id);if(!client)return;
      records.set(id+':'+key,{key,title,desc,due,href,client});
    };
    for(const row of outcomes){
      const key=row.client_id+':'+row.task_key;
      if(!done.has(key))done.set(key,row);
    }
    for(const x of replies)add(x.client_id,'reply:'+x.id,'客户回复待处理',x.subject||'已同步的客户真实回复',x.received_at.slice(0,10),'#/inbound');
    for(const x of quotes)if(x.valid_until&&x.valid_until>=d30&&x.valid_until<=d7)
      add(x.client_id,'quote:'+x.id,'报价有效期跟进',x.spec||'核对客户是否已收到或需要更新报价',x.valid_until);
    for(const x of samples)if(x.status==='已签收')
      add(x.client_id,'sample:'+x.id,'已签收样品待反馈',x.items||'向客户核对样品反馈',x.sent_date||d);
    for(const x of opps)if(x.data.next_date&&x.data.next_date<=d&&!['输单','出货'].includes(x.data.stage))
      add(x.account_id,'deal:'+x.id+':'+x.data.next_date,'商机下一步',x.data.title+' · '+x.data.stage,x.data.next_date,'#/business/'+x.account_id);
    for(const c of clients.values())if(UI.emailDue(c))
      add(c.id,'chase:'+c.email_anchor_at,'7天追单提醒','登记实际联系后，系统会重新计时',d);
    for(const x of plans)if(clients.get(x.client_id)?.status==='成交'){
      const due=shift(x.next_purchase_on,-x.remind_days);
      if(due<=d)add(x.client_id,'reorder:'+x.next_purchase_on,'老客户补货确认',x.product+' · 预计补货 '+x.next_purchase_on,due,reorderPath(x.client_id));
    }
    for(const [key,x] of done){
      const item=records.get(key);
      if(item?.key.startsWith('chase:')&&!x.next_on)continue;
      records.delete(key);
      if(x.next_on&&x.next_on<=d)add(x.client_id,x.task_key,'下一步跟进',x.outcome,x.next_on,item?.href);
    }
    const items=[...records.values()].sort((a,b)=>a.due.localeCompare(b.due));
    UI.render(`<div class="pagehead"><h1>今日待办</h1><div class="actions"><a class="btn ghost" href="#/home">回工作台</a><a class="btn ghost" href="#/reorder-plan">管理补货计划</a><button id="workReload" class="ghost">刷新</button></div></div>
      <section class="card pad"><p>按北京时间。包含近30天已同步的客户回复、报价有效期、已签收样品、商机下一步、追单和补货提醒。</p>
      <p>当前 ${items.length} 项，${[...done.values()].filter(x=>x.next_on>d&&clients.has(x.client_id)).length} 项已有未来安排。</p>
      ${items.map((item,i)=>`<article class="card pad"><b>${esc(item.title)}</b> · <a href="${path(item.client.id)}">${esc(item.client.company_name)}</a> · ${esc(UI.userName(item.client.owner_id))}
        <p>${esc(item.desc)} · ${UI.dueBadge(item.due)}</p><div class="actions"><a class="btn ghost sm" href="${esc(item.href)}">打开处理</a><button class="ghost sm" data-work-finish="${i}">记录结果</button></div></article>`).join('')||'<p>暂无到期事项。</p>'}</section>`,'home');
    $('#workReload').onclick=()=>UI.route();
    $$('[data-work-finish]').forEach(b=>b.onclick=()=>finish(items[Number(b.dataset.workFinish)],()=>UI.route()));
  }
  async function reorder(id){
    if(DB.mode==='demo')return UI.render('<section class="card pad"><h1>补货计划</h1><p>请在正式系统使用。</p></section>','home');
    const current=UI.viewCurrent(), clients=UI.CLIENTS.filter(c=>active(c)&&c.status==='成交');
    const c=clients.find(c=>c.id===id);
    if(id&&!c)throw Error('没有可编辑的成交客户');
    const plans=id?DB.chk(await DB.t('crm_reorder_plans').select('*').eq('client_id',id)):await table('crm_reorder_plans','*',q=>q.order('client_id'));
    if(!current())return;
    if(!c){
      UI.render(`<div class="pagehead"><h1>老客户补货计划</h1><a href="#/today-work">回今日待办</a></div><section class="card pad"><label>成交客户<select id="chooseReorder"><option value="">请选择</option>${clients.map(c=>UI.opt(c.id,c.company_name,'')).join('')}</select></label>
      ${plans.map(p=>{const c=clients.find(c=>c.id===p.client_id);return c?`<p><a href="${reorderPath(c.id)}">${esc(c.company_name)}</a> · ${esc(p.product)} · 预计补货 ${esc(p.next_purchase_on)} · 提前 ${p.remind_days} 天</p>`:'';}).join('')||'<p>暂无补货计划。</p>'}</section>`,'home');
      $('#chooseReorder').onchange=e=>{if(e.target.value)location.hash=reorderPath(e.target.value);};
      return;
    }
    const p=plans[0]||{};
    UI.render(`<div class="pagehead"><h1>${esc(c.company_name)} · 补货计划</h1><a href="${path(id)}">回客户档案</a></div><section class="card pad"><form id="reorderForm"><div class="g2">
      ${B.input('product','采购产品',p.product,'text','required maxlength="300"')}${B.input('last','上次订单日期',p.last_order_on,'date')}
      ${B.input('next','预计补货日期',p.next_purchase_on,'date','required')}${B.input('days','提前提醒天数',p.remind_days??30,'number','required min="0" max="180" step="1"')}
      </div>${B.area('basis','补货日期的判断依据',p.basis,'required maxlength="2000" rows="4"')}${B.footer}</form></section>`,'home');
    B.bindForm($('#reorderForm'),async f=>{
      await rpc('crm_save_reorder_plan',{p_client:id,p_product:f.elements.product.value,p_last:f.elements.last.value||null,p_next:f.elements.next.value,p_days:Number(f.elements.days.value),p_basis:f.elements.basis.value});
      UI.toast('补货计划已保存');if(current())await UI.route();
    });
  }
  UI.views['today-work']={render:tasks};
  UI.views['reorder-plan']={render:reorder};
  const detail=UI.views.client.render;
  UI.views.client.render=async id=>{
    const current=UI.viewCurrent();await detail(id);if(!current())return;
    const c=UI.CLIENTS.find(c=>c.id===id);
    if(c&&active(c)&&c.status==='成交'){
      const holder=$('.hero .quick');
      if(holder){const link=document.createElement('a');link.className='btn ghost';link.href=reorderPath(id);link.textContent='补货计划';holder.append(link);}
    }
  };
})();