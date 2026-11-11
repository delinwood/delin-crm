/* Shared inquiry workflow, procurement evidence and order checkpoints. */
(function(){
  const {esc,$,$$}=UI, B=UI.BUSINESS;
  const channels={gmail:'Gmail 客户回复',alibaba:'阿里国际站',platform:'其他平台',email:'邮件',website:'官网',exhibition:'展会',social:'社媒',other:'其他'};
  const categories={website:'官网 / 产品目录',shipment:'海关 / 提单',customer:'客户确认',registry:'登记 / 行业名录',other:'其他'};
  const matches={match:'产品匹配',mismatch:'产品不匹配',pending:'待核实'};
  const steps={spec:'规格与单据确认',deposit:'定金',production:'排产',inspection:'验货',loading:'装柜',shipping:'出货',balance:'尾款'};
  const date=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const localNow=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const fmt=t=>t?new Date(t).toLocaleString('zh-CN'):'—';
  const dur=m=>m==null?'—':m<60?Math.floor(m)+'分钟':m<1440?Math.floor(m/60)+'小时 '+Math.floor(m%60)+'分钟':Math.floor(m/1440)+'天 '+Math.floor(m%1440/60)+'小时';
  const btn=(path,label)=>`<a class="btn ghost sm" href="#/${path}">${esc(label)}</a>`;
  const options=o=>Object.entries(o);
  const name=id=>UI.CLIENTS.find(c=>c.id===id)?.company_name||'客户档案';
  const read=async q=>DB.chk(await q);
  const confirmed=r=>r.data.order_confirmed===true&&['定金','出货'].includes(r.data.stage);
  const blank='<p class="muted">暂无符合条件的记录。</p>';
  function safeSource(s){
    try{const u=new URL(s);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)
      return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>`;}catch{}
    return esc(s);
  }
  function oldClients(company,website,email){
    const key=U.nameKey(company), site=U.domain(website), domain=U.domain((email||'').split('@')[1]||'');
    const businessDomain=domain&&!/^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|aol|qq|163|126|proton|protonmail|mail|yandex|gmx)\./.test(domain);
    return UI.CLIENTS.filter(c=>{
      if(!B.canEdit(c)||UI.isInvalid(c))return false;
      const existing=U.domain(c.website);
      return (key&&U.nameKey(c.company_name)===key)||(existing&&((site&&existing===site)||(businessDomain&&existing===domain)));
    });
  }
  function chooseExisting(f,company,website,email){
    const select=f.elements.linked;
    const prior=select.value;
    const owned=UI.CLIENTS.filter(c=>B.canEdit(c)&&!UI.isInvalid(c));
    const hits=oldClients(company,website,email), ids=new Set(hits.map(c=>c.id));
    select.innerHTML=UI.opt('','暂不关联','')+[
      ...hits,...owned.filter(c=>!ids.has(c.id)).sort((a,b)=>a.company_name.localeCompare(b.company_name,'zh'))
    ].map(c=>UI.opt(c.id,(ids.has(c.id)?'可能是同一公司 · ':'')+c.company_name,prior)).join('');
    const signature=JSON.stringify([company,website,email]);
    const hint=f.querySelector('[data-match-hint]');
    hint.textContent=hits.length?`找到 ${hits.length} 个可能是同一公司的档案，请核对后选择关联。`:'没有找到可直接关联的同名或同域名客户。';
    return {hits,signature,hint};
  }
  function inquiryModal(row, presetClient){
    const create=!row;
    const canLink=create||!row.client_id;
    const sourceFields=create?`<div class="formgrid">${B.select('channel','询盘来源',options(channels).filter(([k])=>k!=='gmail'),'alibaba')}
      ${B.input('company','公司名称','','text','required maxlength="250"')}${B.input('site','公司官网','','text','maxlength="500"')}
      ${B.input('email','来信邮箱（可选）','','email','maxlength="320"')}
      ${B.input('received','收到时间',localNow(),'datetime-local','required step="1"')}${B.input('subject','主题','','text','required maxlength="300"')}</div>
      ${B.area('original','原始询盘内容','','required maxlength="30000" rows="7"')}`:
      `<p>${esc(row.company)} · ${esc(row.subject)}</p>`;
    UI.modal(`<h2>${create?'录入询盘':'处理询盘'}</h2><form>${sourceFields}
      ${canLink?`<label>关联客户档案<select name="linked"></select></label><p data-match-hint class="muted small"></p>`:''}
      ${create?'':`${B.area('note','处理结果（仅关联档案时可留空）',row.note||'','maxlength="2000" rows="4"')}
      ${row.first_response_at?`<p>已登记首次回复 ${esc(fmt(row.first_response_at))}</p>`:
      B.input('response','实际首次回复时间（尚未回复请留空）','','datetime-local','step="1"')}`}${B.footer}</form>`,(modal,close)=>{
      const f=modal.querySelector('form'), val=k=>f.elements[k]?.value.trim()||'';
      let checked='';
      const values=()=>create?[val('company'),val('site'),val('email')]:[row.company,row.website,row.email];
      if(canLink)chooseExisting(f,...values());
      if(create&&presetClient&&f.elements.linked)f.elements.linked.value=presetClient;
      if(create)for(const k of ['company','site','email'])f.elements[k].onchange=()=>{chooseExisting(f,...values());if(presetClient&&!f.elements.linked.value)f.elements.linked.value=presetClient;};
      B.bindForm(f,async()=>{
        if(canLink){
          const {hits,signature,hint}=chooseExisting(f,...values());
          if(create&&signature!==checked){
            const [company,site]=values();
            const found=await DB.checkDuplicate({name:company,website:site,phone:''});
            checked=signature;
            if((hits.length||found.length)&&!val('linked')){
              hint.textContent=hits.length?'找到疑似同公司档案。请核对并选择，或再次保存为暂未关联。':
                '系统存在疑似重复客户。请与老板核对归属，或再次保存为暂未关联。';
              return;
            }
          }
        }
        if(create)await B.rpc('crm_inquiry_create',{p_channel:val('channel'),p_company:val('company'),p_website:val('site'),p_email:val('email'),
          p_subject:val('subject'),p_original:f.elements.original.value,p_received:new Date(val('received')).toISOString(),p_client:val('linked')||null});
        else await B.rpc('crm_inquiry_update',{p_source:row.source,p_id:row.id,p_client:val('linked')||null,p_note:val('note')||null,
          p_response:val('response')?new Date(val('response')).toISOString():null});
        close();UI.toast('询盘已保存');await UI.route();
      });
    });
  }
  async function inbox(){
    if(DB.mode==='demo')return demo('询盘待处理箱');
    const current=UI.viewCurrent(), since=new Date(Date.now()-30*86400000).toISOString();
    UI.render(`<div class="pagehead"><h1>询盘待处理箱</h1><button class="primary" id="addInquiry">录入询盘</button></div>
      <section class="card pad"><p>手工录入阿里国际站、其他平台、邮件、官网、展会或社媒来的询盘，并关联到客户档案。不调用平台接口。Gmail 只显示 CRM 已关联的客户真实回复。</p><p id="inqStats" class="muted">正在读取最近30天统计…</p>
      <div class="actions"><label>状态<select id="inqState"><option value="pending">待处理</option><option value="handled">已处理</option><option value="">全部</option></select></label>
      <label>来源<select id="inqChannel">${UI.opt('','全部','')}${options(channels).map(([k,v])=>UI.opt(k,v,'')).join('')}</select></label></div>
      <div id="inqRows"></div></section>`,'business');
    $('#addInquiry').onclick=()=>inquiryModal();
    let page=0, queryId=0;
    async function draw(){
      const token=++queryId,state=$('#inqState').value,channel=$('#inqChannel').value;
      const target=$('#inqRows');target.textContent='正在读取询盘…';
      try{
        let q=DB.t('crm_inquiry_inbox').select('id,source,channel,client_id,owner_id,company,website,email,subject,received_at,handled_at,first_response_at,note');
        if(state==='pending')q=q.is('handled_at',null);
        if(state==='handled')q=q.not('handled_at','is',null);
        if(channel)q=q.eq('channel',channel);
        const rows=await read(q.order('received_at',{ascending:false}).order('source').order('id').range(page*40,page*40+40));
        if(!current()||token!==queryId)return;
        target.innerHTML=rows.slice(0,40).map((r,i)=>`<article class="card pad"><strong>${esc(r.subject||'无主题')}</strong>
          <p>${esc(channels[r.channel])} · ${r.client_id?`<a href="#/business/${esc(r.client_id)}">${esc(r.company||name(r.client_id))}</a>`:esc(r.company)}
           · 负责人 ${esc(r.owner_id?UI.userName(r.owner_id):'未分配')} · ${esc(fmt(r.received_at))}</p>
          <p>${r.handled_at?'处理用时 ':'未处理已等 '}${esc(dur((new Date(r.handled_at||Date.now())-new Date(r.received_at))/60000))}
            · 首次回复 ${r.first_response_at?esc(dur((new Date(r.first_response_at)-new Date(r.received_at))/60000)):'未登记'}</p>
          ${UI.outboundBar({ company_name: r.company || name(r.client_id), website: r.website, company_email: r.email })}${r.note?`<p>${esc(r.note)}</p>`:''}${!r.client_id&&oldClients(r.company,r.website,r.email).length?'<p class="warn">发现疑似同公司旧档案，处理时可以关联。</p>':''}
          <details data-original="${i}"><summary>查看原始内容</summary><div style="white-space:pre-wrap;overflow-wrap:anywhere"></div></details>
          <button class="ghost sm" data-inquiry="${i}">处理 / 关联</button></article>`).join('')||blank;
        if(page||rows.length>40)target.insertAdjacentHTML('beforeend',`<div class="pager"><button class="ghost" id="inqPrev" ${!page?'disabled':''}>上一页</button><span>第 ${page+1} 页</span><button class="ghost" id="inqNext" ${rows.length<=40?'disabled':''}>下一页</button></div>`);
        $('#inqPrev')?.addEventListener('click',()=>{page--;draw();});
        $('#inqNext')?.addEventListener('click',()=>{page++;draw();});
        $$('[data-inquiry]').forEach(el=>el.onclick=()=>inquiryModal(rows[Number(el.dataset.inquiry)]));
        $$('[data-original]').forEach(el=>el.ontoggle=async()=>{
          if(!el.open||el.dataset.loaded)return;
          const r=rows[Number(el.dataset.original)], content=el.querySelector('div');
          el.dataset.loaded='1';content.textContent='正在读取原文…';
          try{
            const originals=await read(DB.t('crm_inquiry_inbox').select('original').eq('id',r.id).eq('source',r.source));
            content.textContent=originals[0]?.original||'暂无原文或当前已无权访问。';
          }catch(e){delete el.dataset.loaded;content.textContent=e.message;}
        });
      }catch(e){if(current()&&token===queryId)target.textContent=e.message;}
    }
    for(const el of [$('#inqState'),$('#inqChannel')])el.onchange=()=>{page=0;draw();};
    await Promise.all([draw(),B.rpc('crm_inquiry_stats',{p_since:since}).then(([s])=>{
      if(current())$('#inqStats').textContent=`近30天共 ${s.total} 条 · 待处理 ${s.pending} 条 · 已登记首次回复 ${s.responded} 条 · 首次回复中位时间 ${dur(s.median_minutes)}`;
    }).catch(e=>{if(current())$('#inqStats').textContent=e.message;})]);
  }
  function demo(title){UI.render(`<section class="card pad"><h1>${esc(title)}</h1><p>请在正式系统使用。</p></section>`,'business');}
  function selectClient(path,title,filter=B.canEdit){
    UI.render(`<div class="pagehead"><h1>${esc(title)}</h1>${btn('business','业务工作台')}</div><section class="card pad"><label>选择客户
      <select id="flowClient">${UI.opt('','请选择','')}${UI.CLIENTS.filter(filter).map(c=>UI.opt(c.id,c.company_name,'')).join('')}</select></label></section>`,'business');
    $('#flowClient').onchange=e=>{if(e.target.value)location.hash=`#/${path}/${e.target.value}`;};
  }
  async function evidence(id){
    if(DB.mode==='demo')return demo('采购证据时间线');
    if(!id)return selectClient('purchase-evidence','采购证据时间线');
    const current=UI.viewCurrent(), c=UI.CLIENTS.find(c=>c.id===id);
    if(!B.canEdit(c))throw Error('只能查看自己负责客户的采购证据');
    const rows=await read(DB.t('crm_purchase_evidence').select('*').eq('client_id',id)
      .order('evidence_on',{ascending:false}).order('created_at',{ascending:false}).order('id').limit(100));
    if(!current())return;
    UI.render(`<div class="pagehead"><h1>${esc(c.company_name)} · 采购证据时间线</h1>${btn('business/'+id,'采购资格档案')}</div>
      <section class="card pad"><p>逐条记录产品、证据日期和来源。官网上架能证明销售线索，进口情况应另附进口证据或客户确认。</p>
      <button class="primary" id="evidenceAdd">新增证据</button>
      ${rows.map(r=>`<article class="card pad"><strong>${esc(r.evidence_on)} · ${esc(r.product)} · ${esc(matches[r.match])}</strong>
        <p>${esc(categories[r.category])} · ${safeSource(r.source)} · ${esc(UI.userName(r.created_by))}</p>
        <p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.detail)}</p></article>`).join('')||blank}
      ${rows.length===100?'<p>显示最近100条证据。</p>':''}</section>`,'business');
    $('#evidenceAdd').onclick=()=>UI.modal(`<h2>添加采购证据</h2><form><div class="formgrid">
      ${B.select('category','证据类型',options(categories),'website')}${B.input('product','对应产品','','text','required maxlength="200"')}
      ${B.select('match','产品匹配',options(matches),'pending')}${B.input('evidence_on','证据日期',date(),'date','required')}</div>
      ${B.input('source','来源链接、文件编号或确认人','','text','required maxlength="1000"')}
      ${B.area('detail','证据内容（采购商、品名、数量及单位等，按实际填写）','','required maxlength="5000" rows="5"')}${B.footer}</form>`,(m,close)=>{
      B.bindForm(m.querySelector('form'),async f=>{
        const record={client_id:id};
        for(const key of ['category','product','match','evidence_on','source','detail'])record[key]=f.elements[key].value.trim();
        await read(DB.t('crm_purchase_evidence').insert(record));close();UI.toast('采购证据已保存');await UI.route();
      });
    });
  }
  const orderLabel=r=>`${r.data.order_no||'订单号待填'} · ${r.data.title}`;
  const docLabel=r=>`${r.data.number} · V${r.data.revision||1}`;
  async function orders(id){
    if(DB.mode==='demo')return demo('订单追踪');
    const current=UI.viewCurrent();
    let q=DB.t('crm_records_view').select('id,account_id,data').eq('kind','opportunity').eq('data->>order_confirmed','true');
    if(id)q=q.eq('id',id);
    const list=(await read(q.order('updated_at',{ascending:false}).limit(100))).filter(confirmed);
    if(!current())return;
    if(!id){
      UI.render(`<div class="pagehead"><h1>订单追踪</h1>${btn('opportunities','商机看板')}</div><section class="card pad">
        <p>列出已确认且处于定金或出货阶段的订单，最近更新优先，最多100笔。</p>
        ${list.map(r=>`<p><a href="#/order-tracking/${esc(r.id)}">${esc(orderLabel(r))}</a> · ${esc(name(r.account_id))} · ${esc(r.data.stage)}</p>`).join('')||blank}</section>`,'business');
      return;
    }
    const deal=list[0];if(!deal)throw Error('找不到有权限维护的确认订单');
    const cid=deal.account_id;
    const [milestones,bundle,samples]=await Promise.all([
      read(DB.t('crm_order_milestones').select('*').eq('opportunity_id',id)),B.bundle(cid),DB.listSamples(cid)
    ]);
    if(!current())return;
    const docs=bundle.records.filter(r=>r.kind==='document');
    const record=(step)=>milestones.find(x=>x.step===step);
    const doc=(key)=>docs.find(x=>x.id===key);
    const sample=(key)=>samples.find(x=>x.id===key);
    UI.render(`<div class="pagehead"><h1>${esc(orderLabel(deal))}</h1><div class="actions">${btn('order-tracking','订单列表')}${btn('business/'+cid,'客户业务档案')}</div></div>
      <section class="card pad"><p>${esc(name(cid))} · ${esc(deal.data.currency)} ${esc(deal.data.amount)} · 订单日期 ${esc(deal.data.order_date||'未填')}</p>
      <p class="muted">逐项登记计划与实际完成日期。规格节点可关联成交采用的报价、PI版本和寄样记录。</p>
      ${options(steps).map(([key,label])=>{
        const x=record(key)||{}, q=doc(x.quote_id), pi=doc(x.pi_id), s=sample(x.sample_id);
        return `<article class="card pad"><strong>${label}</strong> · ${x.done_on?'已完成':x.due_on&&x.due_on<date()?'已逾期':'待完成'}
        <p>计划 ${esc(x.due_on||'—')} · 实际 ${esc(x.done_on||'—')}${x.updated_at?' · '+esc(UI.userName(x.updated_by))+' 更新于 '+esc(fmt(x.updated_at)):''}</p>
        ${key==='spec'?`<p>报价 ${esc(q?docLabel(q):'—')} · PI ${esc(pi?docLabel(pi):'—')} · 寄样 ${esc(s?.items||'—')}</p>`:''}
        ${x.note?`<p style="white-space:pre-wrap">${esc(x.note)}</p>`:''}<button class="ghost sm" data-step="${key}">更新节点</button></article>`;
      }).join('')}</section>`,'business');
    const choose=(field,label,values,value)=>B.select(field,label,[['','请选择'],...values],value||'');
    $$('[data-step]').forEach(el=>el.onclick=()=>{
      const key=el.dataset.step,x=record(key)||{};
      UI.modal(`<h2>${esc(steps[key])}</h2><form><div class="formgrid">
        ${B.input('due','计划日期',x.due_on||'','date')}${B.input('done','实际完成日期',x.done_on||'','date')}
        ${key==='spec'?`${choose('quote','报价版本',docs.filter(r=>r.data.doc_type==='quote').map(r=>[r.id,docLabel(r)]),x.quote_id)}
        ${choose('pi','PI 版本',docs.filter(r=>r.data.doc_type==='pi').map(r=>[r.id,docLabel(r)]),x.pi_id)}
        ${choose('sample','寄样记录',samples.map(r=>[r.id,`${r.sent_date||''} · ${r.items||''}`]),x.sample_id)}`:''}</div>
        ${B.area('note',key==='spec'?'确认规格、花色、基材、包装和混柜方案':'节点备注',x.note||'','maxlength="4000" rows="5"')}${B.footer}</form>`,(m,close)=>{
        B.bindForm(m.querySelector('form'),async f=>{
          const get=k=>f.elements[k]?.value||null;
          await B.rpc('crm_order_save_step',{p_opportunity:id,p_step:key,p_due:get('due'),p_done:get('done'),p_note:get('note')||'',
            p_quote:get('quote'),p_pi:get('pi'),p_sample:get('sample'),p_previous:x.updated_at||null});
          close();UI.toast('订单节点已保存');await UI.route();
        });
      });
    });
  }
  UI.openInquiry=(clientId)=>inquiryModal(null, clientId||null);
  UI.views['inquiry-inbox']={render:inbox};
  UI.views['purchase-evidence']={render:evidence};
  UI.views['order-tracking']={render:orders};
})();
