/* Product/country discovery: candidates stay separate until human review. */
(function () {
  const {esc,opt,$,$$}=UI;
  const JOB={queued:'排队中',running:'搜索 / 读取中',completed:'处理完成',failed:'处理异常',paused:'已暂停',cancelled:'已取消'};
  const STATE={waiting:'等待读官网',reading:'正在读官网',review:'待审查',imported:'已导入',duplicate:'已有相同客户',rejected:'已淘汰'};
  const BUYERS=[['importer','进口商'],['distributor','分销商'],['wholesaler','建材批发商'],['contractor','工程 / 装修采购商']];
  const GROUPS=C.KW_GROUPS;
  const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未提供';
  const rpc=(name,args)=>UI.BUSINESS.rpc(name,args);
  const safeURL=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
  const link=(value,text)=>{const href=safeURL(value);return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text||value)} ↗</a>`:'<span>来源网址无效</span>';};
  const first=(c,field)=>(c.data?.suggestions||[]).find(s=>s.field===field)?.value||'';
  const note=(c,field)=>(c.data?.suggestions||[]).filter(s=>s.field===field).slice(0,3).map(s=>s.value).join(' / ');
  async function service(){
    try{const r=await DB.init().functions.invoke('crm-mail',{body:{action:'status'}});if(r.error||r.data?.error)throw new Error();return r.data?.discovery||{enabled:false};}
    catch{return {enabled:false,error:'服务器状态暂时不可用，请稍后刷新。'};}
  }
  async function render(id){
    if(DB.mode==='demo')return UI.render('<section class="card pad"><h1>自动获客</h1><p>搜索和网页读取在正式系统的服务器运行；演示模式不会调用外部搜索。</p><a class="btn ghost" href="#/prospect">返回找客户</a></section>','prospect');
    const [available,jobs]=await Promise.all([service(),DB.t('crm_discovery_jobs').select('*').order('created_at',{ascending:false}).limit(60).then(DB.chk)]);
    const job=jobs.find(j=>j.id===id)||(!id?jobs[0]:null);
    if(id&&!job)throw new Error('该搜索任务不存在、超过最近60个任务范围，或当前账号无权查看');
    let candidates=[],requests=[];
    if(job)[candidates,requests]=await Promise.all([DB.t('crm_discovery_candidates').select('*').eq('job_id',job.id).order('score',{ascending:false}).order('id').then(DB.chk),DB.t('crm_discovery_requests').select('*').eq('job_id',job.id).order('step').then(DB.chk)]);
    // Avoid replacing another page after a slow status/database request.
    if(!location.hash.startsWith('#/discovery'))return;
    const counts=Object.fromEntries(Object.keys(STATE).map(s=>[s,candidates.filter(c=>c.status===s).length]));
    UI.render(`<div class="pagehead"><h1>自动获客 <small>按产品和国家发现新客户</small></h1><div class="actions"><a class="btn ghost" href="#/prospect">人工搜索 / 快速录入</a><button class="ghost" id="discoveryRefresh">刷新进度</button></div></div>
      <section class="card pad"><h2>① 创建获客任务</h2><p>自动搜索公司网站 → 整理产品和B端业务原文 → 读取官网与联系页 → 提取公开联系方式 → 排序 → 审查、查重后导入客户。</p><p class="${available.enabled?'muted small':'warn'}">${available.enabled?'搜索服务已连接：Tavily Researcher 免费计划；每次搜索前核对免费计划及余额。':available.error||'自动搜索服务尚未完成配置。配置完成后才会提交搜索；现在不会调用外部服务。'}</p>
      <form id="discoveryForm"><div class="g3"><label>目标国家（建议英文）<input name="country" list="discoveryCountries" required minlength="2" maxlength="80" value="${esc(job?.criteria.country||'Saudi Arabia')}"><datalist id="discoveryCountries">${[...new Set(['Saudi Arabia','Philippines',...(window.MARKETS||[]).map(m=>m.country),...Object.keys(C.TZ)])].map(c=>`<option value="${esc(c)}"></option>`).join('')}</datalist></label><label>城市 / 地区（可选）<input name="city" maxlength="80" placeholder="例如 Riyadh / Jeddah" value="${esc(job?.criteria.city||'')}"></label><label>候选公司上限<select name="count">${[5,10,20,30,50].map(n=>opt(n,n+'家候选上限',20)).join('')}</select></label></div>
      <h3>目标产品（1至3类）</h3><div class="actions">${GROUPS.map(([k,l])=>`<label class="inl"><input type="checkbox" name="groups" value="${esc(k)}" ${(job?.criteria.groups||['spc','wall']).includes(k)?'checked':''}>${esc(l)}</label>`).join('')}</div>
      <h3>目标买家</h3><div class="actions">${BUYERS.map(([k,l])=>`<label class="inl"><input type="checkbox" name="types" value="${k}" ${(job?.criteria.types||['importer','distributor','wholesaler']).includes(k)?'checked':''}>${l}</label>`).join('')}</div>
      <p class="muted small">每任务最多6次基础搜索、50家公司，每公司最多读取2页；搜索和网页读取分批在服务器运行，可以关闭页面，稍后回来刷新。所填上限不是保证找到的客户数量，也不代表进口量排名。</p><p class="muted small">仅将产品、国家、城市及买家类型提交给Tavily；候选公开网址提交给Jina Reader，域名通过Google公共DNS检查。不会提交CRM客户内部备注或Gmail内容。免费额度用完、限流或无法核实免费计划时停止；不会自动充值或改用付费服务。</p><label class="inl"><input name="consent" type="checkbox" required>我同意按以上条件查询公开企业资料，并将在导入前核实公司身份、经营国家和B端采购匹配证据。</label><p><button class="primary" ${available.enabled?'':'disabled'}>开始自动获客</button></p><p role="status" id="discoveryStartStatus"></p></form></section>
      <section class="card pad"><h2>② 搜索任务</h2><div class="tblwrap"><table class="mini"><thead><tr><th>国家 / 产品</th><th>提交人 / 时间</th><th>状态</th><th>操作</th></tr></thead><tbody>${jobs.map(j=>`<tr><td><a href="#/discovery/${esc(j.id)}">${esc(j.criteria.country)} ${esc(j.criteria.city||'')}</a><br>${esc((j.criteria.groups||[]).map(g=>GROUPS.find(x=>x[0]===g)?.[1]||g).join(' / '))}</td><td>${esc(UI.userName(j.requested_by))}<br>${esc(time(j.created_at))}</td><td>${esc(JOB[j.status]||j.status)}<br>已保留 ${j.search_cursor}/${j.queries.length} 次搜索尝试${j.error?`<p class="warn">${esc(j.error)}</p>`:''}</td><td><a class="btn ghost sm" href="#/discovery/${esc(j.id)}">查看结果</a>${['queued','running'].includes(j.status)?`<button class="ghost sm" data-discovery-state="paused" data-job="${esc(j.id)}">暂停</button>`:''}${j.status==='paused'?`<button class="ghost sm" data-discovery-state="queued" data-job="${esc(j.id)}">继续</button>`:''}${!['completed','cancelled'].includes(j.status)?`<button class="ghost sm" data-discovery-state="cancelled" data-job="${esc(j.id)}">取消任务</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">尚无任务</td></tr>'}</tbody></table></div><p class="muted small">每账号24小时最多10个任务，最多3个未完成任务；本系统全体账号每月最多900次搜索尝试。超时或中断的搜索不自动重试，已保留的尝试不等于搜索服务确认扣除的积分。</p></section>
      ${job?`<section class="card pad"><h2>③ ${esc(job.criteria.country)} ${esc(job.criteria.city||'')} · 候选名单 ${candidates.length}/${job.target_count}</h2><div class="actions"><span>待审查 ${counts.review} · 读取中 / 等待 ${counts.reading+counts.waiting} · 已导入 ${counts.imported} · 重复 ${counts.duplicate} · 淘汰 ${counts.rejected}</span><button class="ghost sm" id="discoveryExport">导出候选CSV</button></div><p class="warn">匹配分数仅表示公开文字和联系方式的完整程度，不能证明公司是进口商、拥有仓库或具备整柜采购量。负责人、经营年限和采购量未公开时留空。导入不会自动发邮件。</p><div class="g3"><label>关键词筛选<input id="discoveryFilter" placeholder="公司、域名或原文"></label><label>结果范围<select id="discoveryScope">${[['all','全部'],['priority','优先核实：产品+B端+国家文字匹配'],['review','待审查'],['imported','已导入'],['rejected','已淘汰']].map(([k,l])=>opt(k,l,'all')).join('')}</select></label><label>公开联系方式<select id="discoveryContact">${[['all','不限'],['email','有公开邮箱'],['phone','有公开电话'],['any','至少一个联系方式']].map(([k,l])=>opt(k,l,'all')).join('')}</select></label></div><div id="discoveryResults"></div>
      <details><summary>查看实际搜索词和尝试记录</summary>${requests.map(r=>`<p><b>${esc(r.query)}</b><br>${esc(time(r.attempted_at))} · ${esc({started:'已保留尝试',completed:'结果已返回',failed:'未完成',unknown:'结果未确认，不重试'}[r.status]||r.status)}${r.error?' · '+esc(r.error):''}</p>`).join('')||'<p>尚未处理第一条搜索</p>'}</details></section>`:''}`,'prospect');
    let nonce=crypto.randomUUID();
    $('#discoveryForm').onsubmit=async e=>{
      e.preventDefault(); const f=e.target,fd=new FormData(f),groups=fd.getAll('groups'),types=fd.getAll('types'),button=f.querySelector('button');
      if(!available.enabled)return UI.toast('搜索服务尚未连接',1);
      if(groups.length<1||groups.length>3||!types.length)return UI.toast('请选择1至3类产品和至少一类买家',1);
      button.disabled=true;
      try{const newId=await rpc('crm_discovery_start',{p_nonce:nonce,p_country:fd.get('country').trim(),p_city:fd.get('city').trim(),p_groups:groups,p_types:types,p_count:Number(fd.get('count'))});UI.toast('已创建服务器任务，稍后刷新查看进度');if(location.hash==='#/discovery/'+newId)await render(newId);else location.hash='#/discovery/'+newId;}
      catch(err){$('#discoveryStartStatus').textContent=err.message;button.disabled=false;}
    };
    $('#discoveryRefresh').onclick=()=>render(job?.id).catch(e=>UI.toast(e.message,1));
    $$('[data-discovery-state]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rpc('crm_discovery_state',{p_job:b.dataset.job,p_state:b.dataset.discoveryState});await render(job?.id);}catch(e){b.disabled=false;UI.toast(e.message,1);}});
    if(!job)return;
    const filter=()=>{
      const q=$('#discoveryFilter').value.trim().toLowerCase(),scope=$('#discoveryScope').value,contact=$('#discoveryContact').value;
      return candidates.filter(c=>{const email=!!first(c,'company_email'),phone=!!first(c,'company_phone');return (!q||[c.title,c.domain,JSON.stringify(c.data.evidence||[]),JSON.stringify(c.sources)].join(' ').toLowerCase().includes(q))&&(scope==='all'||scope==='priority'&&c.data.suitability==='优先核实'||c.status===scope)&&(contact==='all'||contact==='email'&&email||contact==='phone'&&phone||contact==='any'&&(email||phone));});
    };
    const draw=()=>{
      $('#discoveryResults').innerHTML=filter().map(c=>`<article class="card pad"><div class="sec-h"><h3>${esc(c.title||c.domain)}</h3><b>${c.score}/100 · ${esc(STATE[c.status])}</b></div><p>${link(c.website,c.domain)} · ${esc(c.data.suitability||'待核实')}</p><p>匹配产品：${esc((c.data.product_matches||[]).map(C.productName).join('、')||'待确认')}<br>B端业务词语：${esc((c.data.buyer_matches||[]).map(k=>BUYERS.find(x=>x[0]===k)?.[1]||k).join('、')||'待确认')}<br>公开邮箱：${esc(note(c,'company_email')||'未发现')}<br>公开电话：${esc(note(c,'company_phone')||'未发现')}</p><p class="muted small">${esc((c.data.reasons||[]).join('；'))}</p>${c.error?`<p class="warn">${esc(c.error)}</p>`:''}<div class="actions"><button class="ghost sm" data-discovery-review="${esc(c.id)}">查看来源 / 审查</button>${c.status==='imported'&&c.client_id?`<a class="btn ghost sm" href="#/business/${esc(c.client_id)}">打开客户档案</a>`:''}</div></article>`).join('')||'<p>当前筛选下暂无候选结果。搜索未完成时稍后刷新；没有找到结果不能说明当地没有客户。</p>';
      $$('[data-discovery-review]').forEach(b=>b.onclick=()=>review(candidates.find(c=>c.id===b.dataset.discoveryReview),job));
    };
    ['#discoveryFilter','#discoveryScope','#discoveryContact'].forEach(s=>$(s).oninput=draw);draw();
    $('#discoveryExport').onclick=()=>{
      const headers=['候选标题（待核实）','官网（待确认所属）','目标国家（待核实）','公开邮箱','公开电话','产品文字匹配','B端文字匹配','匹配分数','状态','搜索来源','官网读取页面','读取日期'];
      const cell=v=>'"'+String(v??'').replace(/^(?=\s*[=+\-@]|[\t\r])/u,"'").replace(/"/g,'""')+'"';
      const rows=filter().map(c=>[c.title,c.website,job.criteria.country,note(c,'company_email'),note(c,'company_phone'),(c.data.product_matches||[]).map(C.productName).join(' / '),(c.data.buyer_matches||[]).join(' / '),c.score,STATE[c.status],c.sources.map(s=>s.url).join(' '),(c.data.pages||[]).map(p=>p.url).join(' '),c.checked_at||'']);
      UI.download('自动获客_候选待核实_'+UI.today()+'.csv',new Blob(['\ufeff'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    };
  }
  function review(c,job){
    if(!c)return;
    const data=c.data||{},ready=['review','duplicate'].includes(c.status),admin=UI.ME.role==='admin';
    const inputs=(field,label,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${field}" type="${type}" value="${esc(value)}" ${extra}></label>`;
    UI.modal(`<h2>核实候选公司</h2><p>${link(c.website,c.domain)} · ${esc(STATE[c.status])} · ${esc(time(c.checked_at))}</p><p class="warn">搜索标题只用于定位公司。请打开来源核对真实公司名称、所在国家、销售产品及B端业务；未找到采购证据的公司可以淘汰。未发现公开联系人时不要推测姓名或邮箱。</p>
      <h3>搜索索引来源</h3>${c.sources.map(s=>`<section class="card pad"><b>${link(s.url,s.title||s.url)}</b><p>${esc(s.excerpt||'未提供摘录')}</p><p class="muted small">${esc(time(s.checked_at))}</p></section>`).join('')}
      <h3>实际读取的网页</h3>${(data.pages||[]).map(p=>`<p>${link(p.url,p.title||p.url)} · ${esc(time(p.checked_at))}</p>`).join('')||'<p>没有成功读取官网正文，请人工打开搜索来源核实。</p>'}
      <h3>产品和B端业务原文 · 均待核实</h3>${(data.evidence||[]).map(e=>`<section class="card pad"><b>${esc(e.topic)}</b><p>${esc(e.excerpt)}</p>${link(e.source_url,'原始网页')} · ${esc(time(e.checked_at))}</section>`).join('')||'<p>尚未提取到明确的产品或B端业务原文。</p>'}
      <h3>公开联系方式及出处</h3>${(data.suggestions||[]).map(s=>`<p><b>${esc(s.label||s.field)}：${esc(s.value)}</b><br>${link(s.source_url,'联系方式出处')} · ${esc(time(s.checked_at))}<br>${esc(s.excerpt||'')}</p>`).join('')||'<p>没有提取到公开联系方式。不会根据域名拼造邮箱。</p>'}
      ${(data.warnings||[]).map(w=>`<p class="warn">${esc(w)}</p>`).join('')}${c.error?`<p class="warn">${esc(c.error)}</p>`:''}
      ${ready?`<h3>核实后导入</h3><p class="muted small">以下联系方式为网页候选，仍需逐项核对。员工导入到自己的客户；老板可选择导入公海。查重覆盖全公司，不会向员工显示他人客户的详细资料。</p><form id="discoveryImport"><div class="g2">${inputs('company_name','公司名称（填写真实公司名）','','text','required minlength="2" maxlength="200"')}${inputs('country','核实后的经营国家',job.criteria.country,'text','required minlength="2" maxlength="80"')}<label>核实后的客户类型<select name="customer_type"><option value="">请选择</option>${C.TYPES.map(t=>opt(t[0],t[1],'')).join('')}</select></label>${inputs('company_email','公开公司邮箱',first(c,'company_email'),'email','maxlength="254"')}${inputs('company_phone','公司电话（含国际区号）',first(c,'company_phone'),'text','maxlength="100"')}${inputs('address','核实后的地址',first(c,'address'),'text','maxlength="1000"')}</div><p class="muted small">工程采购商选择“其他”，并在下方记录具体工程采购证据。仅销售相应产品不代表有进口记录。</p><h3>实际销售 / 采购的产品</h3><div class="actions">${C.PRODUCTS.map(([k,l])=>`<label class="inl"><input name="products" type="checkbox" value="${k}">${esc(l)}</label>`).join('')}</div><label>B端采购匹配依据（附公开来源或核实方式）<textarea name="evidence" required minlength="8" maxlength="2000" placeholder="例如：官网分销介绍页列明经销网络，产品目录列有SPC；附网址。仓库和进口记录如未证实写待确认。"></textarea></label><label>补充备注<textarea name="notes" maxlength="3000"></textarea></label>${admin?'<label class="inl"><input name="pool" type="checkbox" checked>导入公海，交由业务员领取（取消勾选则归我负责）</label>':''}<p><label class="inl"><input name="reviewed" type="checkbox" required>我已核对公司身份、经营国家、产品及B端采购匹配依据，并审查所填联系方式；未证实的仓库、进口量和采购量保持待确认。</label></p><button class="primary">查重并导入客户</button><p role="status"></p></form><hr><form id="discoveryReject"><label>淘汰原因<input name="reason" minlength="2" maxlength="500" required placeholder="如：纯零售 / 产品不匹配 / 国家不符 / 无法核实身份"></label><button class="ghost">淘汰候选（保留记录）</button><p role="status"></p></form>`:'<p>资料读取完成后可以审查导入。已导入或淘汰的候选保留原始来源和记录。</p>'}`,(modal,close)=>{
      modal.querySelector('.modal-box').style.maxWidth='1050px';
      const form=modal.querySelector('#discoveryImport');
      if(form)UI.BUSINESS.bindForm(form,async f=>{const fd=new FormData(f),d=Object.fromEntries(fd);d.products=fd.getAll('products');d.reviewed=f.elements.namedItem('reviewed').checked;if(!d.products.length)throw new Error('请选择实际匹配的产品');const r=await rpc('crm_discovery_import',{p_candidate:c.id,p_data:d,p_pool:!!f.elements.namedItem('pool')?.checked});close();await UI.refresh();await render(job.id);UI.toast(r.status==='duplicate'?'已发现相同客户，阻止了重复导入':'已导入客户，来源和审查依据已保存',r.status==='duplicate'?1:0);});
      const reject=modal.querySelector('#discoveryReject');if(reject)UI.BUSINESS.bindForm(reject,async f=>{await rpc('crm_discovery_reject',{p_candidate:c.id,p_reason:f.elements.namedItem('reason').value.trim()});close();await render(job.id);UI.toast('已淘汰并保留记录');});
    });
  }
  UI.views.discovery={render};
})();
