/* Public-company website research. Original evidence is read only; applying a choice is atomic on the server. */
(function () {
  const {esc,$,$$}=UI, B=UI.BUSINESS;
  const LABELS={company_email:'公司邮箱',company_phone:'公司电话',website:'公司官网',address:'地址',notes:'公司备注'};
  const STATUS={queued:'排队中',running:'读取中',completed:'已完成，待人工核实',failed:'未完成',cancelled:'已取消'};
  const stamp=v=>{const n=Date.parse(v);return Number.isFinite(n)?new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未提供';};
  const company=id=>UI.CLIENTS.find(c=>c.id===id);
  const blank=v=>v==null||String(v).trim()==='';
  function sourceLink(value,label='查看公开来源') {
    try {const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '<span>来源地址无效</span>';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;}catch{return '<span>来源地址无效</span>';}
  }
  function suggestionValid(s){return s&&Object.hasOwn(LABELS,s.field)&&typeof s.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)&&typeof s.value==='string'&&s.value.trim()&&typeof s.source_url==='string'&&Number.isFinite(Date.parse(s.checked_at));}
  async function recentJobs(id) {
    let q=DB.t('crm_research_jobs').select('*').order('created_at',{ascending:false}).limit(100);if(id)q=q.eq('client_id',id);return DB.chk(await q);
  }
  async function availability(){
    try{const r=await DB.init().functions.invoke('crm-mail',{body:{action:'status'}});if(r.error||r.data?.error)throw new Error('状态暂不可用');return {search:r.data?.research?.search===true};}
    catch{return {search:false,error:'搜索服务状态暂不可用，当前仅可使用已有官网补资料。'};}
  }
  function searchSection(data){
    if(!data.search)return '';
    const s=data.search,items=Array.isArray(s.results)?s.results:[];
    return `<section class="card pad"><h3>公司搜索结果 · 均待核实</h3><p>查询：${esc(s.query||'')}<br>${esc(stamp(s.checked_at))}</p><p class="muted small">${esc(s.notice||'搜索索引中的候选资料，可能同名或过时，不能直接当成客户官网。')}</p>${items.map(item=>`<article class="card pad"><b>${esc(item.title||'候选网站')}</b><p>${sourceLink(item.url,item.url)}</p><p>${esc(item.snippet||'搜索服务未提供摘要，请人工打开来源核对。')}</p><p class="muted small">公司名称词语在标题、摘要或域名中出现：${esc((item.name_matches||[]).join('、')||'未找到明确匹配')}；国家文字：${item.country_mentioned?'出现':'未明确出现'}。这只是文本核对依据，不能证明公司身份。</p><p>候选官网域名：${esc(item.candidate_website||'')} · 尚未确认</p></article>`).join('')||'<p>没有返回通过公开网址检查的候选结果；不能据此认定该公司不存在或没有官网。</p>'}<p class="warn">本次未读取搜索候选网站正文。先人工核对名称、国家、地址和联系方式，再选择是否将候选官网填入空字段；确认后可另建官网补资料任务。已有官网不会被搜索结果覆盖。</p></section>`;
  }
  async function page(id) {
    if(DB.mode==='demo')return UI.render('<section class="card pad"><h1>公开官网补资料</h1><p>自动网页读取、任务队列及审核应用请在正式系统使用。演示模式不会访问客户官网。</p><a class="btn ghost" href="#/business">返回业务工作台</a></section>','business');
    const target=id?company(id):null;
    if(id&&(!target||!B.canEdit(target)))throw new Error('只能补充自己负责的客户资料');
    const [jobs,allResults,service]=await Promise.all([recentJobs(id),B.rows('research'),availability()]);
    const results=allResults.filter(r=>(!id||r.account_id===id)&&B.canEdit(company(r.account_id))).slice(0,100),eligible=UI.CLIENTS.filter(c=>B.canEdit(c)&&(!id||c.id===id));
    UI.render(`<div class="pagehead"><h1>${target?esc(target.company_name)+' · ':''}公开官网补资料</h1><div class="actions"><a class="btn ghost" href="${id?'#/business/'+esc(id):'#/business'}">返回业务档案</a><button class="ghost" id="refreshResearch">刷新任务</button></div></div>
      <section class="card pad"><h2>自动读取公开公司官网</h2><p>读取已填写的官网首页及同一网站的联系/公司介绍页，每家公司最多3页。提取公开邮箱、电话、地址及产品、批发、仓储相关原文，附来源与读取日期。结果先供你审查，选定后仅补充空字段。</p><p class="muted small">网页出现“进口商”或“仓库”等词不等于已证明进口记录或采购能力。未公开的负责人、营业年限、采购量保持未知，不推测。没有海关数据库或社交平台采集。</p><p class="muted small">已有官网补资料使用免密钥的免费网页服务，不启用付费后备服务。公开网址会提交给 Jina Reader，域名会通过 Google 公共DNS核验；不发送CRM账号、邮箱授权令牌或客户私人备注。</p>
      <label class="inl"><input type="checkbox" id="researchIncludeSearch" ${service.search?'':'disabled'}>同时按公司名称和国家自动搜索候选官网及公开索引资料</label><p class="${service.search?'muted small':'warn'}">${service.search?'公司搜索已启用免费授权，每家公司最多5条结果，全系统每月最多100个搜索任务。候选网址和索引摘录均待人工核实；不会自动读取未确认的候选网站，也不会把搜索排名当作进口排名。':'公司搜索尚未启用；免费授权配置完成后可使用。现在不会调用搜索服务。没有官网的公司请先填写经核实的网址。'}${service.error?' '+esc(service.error):''}</p><p class="muted small">选择公司搜索时，仅把公司名称与国家提交给 Jina Search。仅使用核实过的免费额度且不启用自动充值；免费额度、授权或服务不可用时停止搜索，不会自动付费或重复尝试。</p>
      <label>筛选公司<input type="search" id="researchFilter" placeholder="公司 / 国家"></label><div class="actions"><button class="ghost sm" id="researchChooseTen">选择当前筛选前10家</button><button class="ghost sm" id="researchChooseNone">取消选择</button><b id="researchSelectedCount">已选0家</b></div><div class="tblwrap"><table class="mini"><thead><tr><th>选择</th><th>公司</th><th>国家</th><th>已登记官网</th></tr></thead><tbody id="researchChoices"></tbody></table></div><label class="inl"><input type="checkbox" id="researchPublicConsent">我已核对所选公司的名称、国家及已登记官网，同意按所选模式查询公开资料，并将在应用前审查公司身份和来源。</label><p><button class="primary" id="requestResearch">提交免费补资料任务</button></p><p role="status" id="researchRequestStatus"></p><p class="muted small">每批1–10家，每个账号24小时内最多20家。已有待处理任务不会重复入队；搜索每个任务仅尝试一次，网络结果不确定时也不会自动重试。任务在服务器排队处理，可关闭此页面，稍后刷新。</p></section>
      <section class="card pad"><h2>最近任务</h2><div class="tblwrap"><table class="mini"><thead><tr><th>公司</th><th>提交时间</th><th>状态</th><th>说明 / 操作</th></tr></thead><tbody>${jobs.map(j=>`<tr><td>${esc(company(j.client_id)?.company_name||'客户已转交或归档')}</td><td>${esc(stamp(j.created_at))}</td><td>${esc(STATUS[j.status]||j.status)}</td><td>${esc(j.error||'')}${j.result_id&&results.some(r=>r.id===j.result_id)?`<button class="ghost sm" data-open-research="${esc(j.result_id)}">审查结果</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">暂无任务</td></tr>'}</tbody></table></div></section>
      <section class="card pad"><h2>公开资料结果</h2><p class="muted small">原始来源和摘录始终保留。应用后可在结果内查看审查记录；已有内容不会被覆盖。</p>${results.map(r=>`<div class="inl"><a href="#/business/${esc(r.account_id)}">${esc(company(r.account_id)?.company_name||r.data.company_name||'公司')}</a><span>${esc(stamp(r.data.checked_at||r.created_at))} · ${(r.data.pages||[]).length}页 · ${(r.data.suggestions||[]).length}条建议</span><button class="ghost sm" data-open-research="${esc(r.id)}">查看来源 / 选择补充</button></div>`).join('')||'<p>暂无结果。提交任务后稍后刷新，若网页没有公开联系方式，也会如实显示未找到。</p>'}</section>`,'business');
    let selected=new Set();
    const includeSearch=()=>service.search&&$('#researchIncludeSearch').checked;
    const canChoose=c=>!!c.website||includeSearch();
    const filtered=()=>{const q=$('#researchFilter').value.toLowerCase().trim();return eligible.filter(c=>[c.company_name,c.country,c.website].join(' ').toLowerCase().includes(q));};
    const pending=new Set(jobs.filter(j=>['queued','running'].includes(j.status)).map(j=>j.client_id));
    const draw=()=>{$('#researchChoices').innerHTML=filtered().slice(0,100).map(c=>`<tr><td><input type="checkbox" data-research-client="${esc(c.id)}" ${selected.has(c.id)?'checked':''} ${!canChoose(c)||pending.has(c.id)?'disabled':''}></td><td><a href="#/business/${esc(c.id)}">${esc(c.company_name)}</a>${pending.has(c.id)?' <span class="muted small">已有待处理任务</span>':''}</td><td>${esc(c.country||'')}</td><td>${c.website?esc(c.website):includeSearch()?'<span class="muted small">搜索后人工核实候选官网</span>':'<span class="err">请先填写官网</span>'}</td></tr>`).join('')||'<tr><td colspan="4">没有可操作的客户。</td></tr>';$('#researchSelectedCount').textContent='已选'+selected.size+'家';$$('[data-research-client]').forEach(el=>el.onchange=()=>{if(el.checked&&selected.size>=10){el.checked=false;return UI.toast('每批最多10家公司',1);}el.checked?selected.add(el.dataset.researchClient):selected.delete(el.dataset.researchClient);$('#researchSelectedCount').textContent='已选'+selected.size+'家';});};
    $('#researchFilter').oninput=draw;$('#researchChooseTen').onclick=()=>{selected=new Set(filtered().filter(c=>canChoose(c)&&!pending.has(c.id)).slice(0,10).map(c=>c.id));draw();};$('#researchChooseNone').onclick=()=>{selected.clear();draw();};
    $('#researchIncludeSearch').onchange=()=>{selected=new Set([...selected].filter(id=>{const c=company(id);return c&&canChoose(c);}));draw();};
    if(target?.website&&!pending.has(target.id))selected.add(target.id);draw();
    $('#refreshResearch').onclick=()=>page(id).catch(e=>UI.toast(e.message,1));
    $('#requestResearch').onclick=async()=>{const b=$('#requestResearch'),status=$('#researchRequestStatus');if(!selected.size)return UI.toast('请选择1至10家公司；无官网时需启用公司搜索',1);if(!$('#researchPublicConsent').checked)return UI.toast('请先核对公司资料并勾选公开查询说明',1);b.disabled=true;try{const n=await B.rpc('crm_request_research',{p_ids:[...selected],p_search:includeSearch()});await page(id);UI.toast(n?'已提交'+n+'家公司，稍后刷新查看结果':'所选公司已有待处理任务');}catch(e){status.textContent=e.message;b.disabled=false;}};
    $$('[data-open-research]').forEach(el=>el.onclick=()=>review(results.find(r=>r.id===el.dataset.openResearch),id));
  }
  async function review(record,pageId) {
    if(!record)return UI.toast('资料结果暂不可见，请刷新后重试',1);
    const c=company(record.account_id);if(!c||!B.canEdit(c))return UI.toast('客户归属已变化，请刷新后重试',1);
    const data=record.data||{},suggestions=(Array.isArray(data.suggestions)?data.suggestions:[]).filter(suggestionValid),evidence=Array.isArray(data.evidence)?data.evidence:[];
    let history=[];try{history=DB.chk(await DB.t('crm_business_events').select('at,actor_id,detail').eq('record_id',record.id).eq('action','apply_research').order('at',{ascending:false}).limit(20));}catch{/* Evidence stays reviewable if audit retrieval is temporarily unavailable. */}
    UI.modal(`<h2>${esc(c.company_name)} · 公开资料审查</h2><p>${esc(data.notice||'以下为公开资料提取结果，应用前请人工核实。')}</p>${(data.warnings||[]).map(w=>`<p class="warn">${esc(w)}</p>`).join('')}${searchSection(data)}<h3>已登记官网实际读取的页面</h3><ul>${(data.pages||[]).map(p=>`<li>${sourceLink(p.url,p.title||p.url)} · ${esc(stamp(p.checked_at))}</li>`).join('')||'<li>本次未读取已登记官网正文。</li>'}</ul>
      <h3>可补充的联系方式</h3><form id="researchApply"><p class="muted small">同一字段最多选一项。已有内容仅供对照，不能在这里覆盖。未找到公开资料时不会生成推测值。</p><div class="tblwrap"><table class="mini"><thead><tr><th>选择</th><th>字段 / 当前值</th><th>公开建议</th><th>来源与摘录</th></tr></thead><tbody>${suggestions.map(s=>{const available=blank(c[s.field]);return `<tr><td><input type="radio" name="research_choice_${esc(s.field)}" value="${esc(s.id)}" ${available?'':'disabled'}></td><td>${esc(LABELS[s.field])}<p>${available?'目前为空':esc(c[s.field])+'（保留现有内容）'}</p></td><td style="overflow-wrap:anywhere">${esc(s.value)}</td><td>${sourceLink(s.source_url)}<p class="muted small">${esc(stamp(s.checked_at))}</p><p>${esc(s.excerpt||'')}</p></td></tr>`;}).join('')||'<tr><td colspan="4">所读公开页面未发现可提取的邮箱、电话或地址，不代表该公司没有联系方式。</td></tr>'}</tbody></table></div><button type="button" class="ghost sm" id="clearResearchChoices">取消选择</button><p><label class="inl"><input type="checkbox" name="reviewed">我已核对公司身份和上述来源，同意将所选建议填入空字段。</label></p><button type="submit" class="primary">应用已核实的所选建议</button><p role="status"></p></form>
      <h3>采购资格相关原文 · 均待核实</h3><p class="muted small">词语匹配仅用于帮助查阅，不会自动确认仓库、进口资格或采购量。请结合其他证据，在采购档案中逐项确认。</p>${evidence.map(e=>`<section class="card pad"><b>${esc(e.topic||'公开描述')}</b><p>${esc(e.excerpt||'')}</p>${sourceLink(e.source_url)} · ${esc(stamp(e.checked_at))}</section>`).join('')||'<p>未找到产品、批发、仓储、进口或工程相关的明确原文。</p>'}<p><a class="btn ghost" href="#/business/${esc(record.account_id)}">打开采购档案逐项核实</a></p>${history.length?`<h3>已应用记录</h3>${history.map(h=>`<p>${esc(stamp(h.at))} · ${esc(UI.userName(h.actor_id))} · ${esc((h.detail?.applied||h.detail?.fields||[]).map(k=>LABELS[k]||k).join('、')||'已审查')}</p>`).join('')}`:''}`,(m,close)=>{
      m.querySelector('.modal-box').style.maxWidth='1150px';const f=m.querySelector('form');
      m.querySelector('#clearResearchChoices').onclick=()=>f.querySelectorAll('input[type=radio]').forEach(r=>r.checked=false);
      m.querySelectorAll('a[href^="#/"]').forEach(a=>a.addEventListener('click',close));
      B.bindForm(f,async()=>{if(!f.elements.namedItem('reviewed').checked)throw new Error('请先核实来源并勾选确认');const choices=[...new FormData(f).entries()].filter(([key])=>key.startsWith('research_choice_')).map(([,value])=>suggestions.find(s=>s.id===value)).filter(Boolean).map(s=>({id:s.id,field:s.field,value:s.value}));if(!choices.length)throw new Error('请至少选择一条可补充的资料');const result=await B.rpc('crm_apply_research',{p_record:record.id,p_choices:choices});close();await UI.refresh();await page(pageId);UI.toast(`已补充${(result.applied||[]).length}个字段${result.skipped?.length?'；'+result.skipped.length+'项已有内容或发生变化，已跳过':''}`);});
    });
  }
  UI.views.research={render:page};
})();
