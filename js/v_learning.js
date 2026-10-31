/* Internal staff learning center. Company materials stay in CRM private storage. */
(function () {
  const { $, $$ } = UI;
  const CATS = ['新员工入职','公司制度','产品知识','开发流程','其他资料'];
  const ext = name => String(name || '').split('.').pop().toUpperCase();
  const asDate = value => value ? new Date(value).toLocaleDateString('zh-CN') : '—';
  const isAdmin = () => UI.ME.role === 'admin';

  function editor(item = {}) {
    const row = { category:'新员工入职', status:'draft', required:false, ...item };
    UI.modal(`<div class="learn-editor"><div class="pagehead"><div><h1>${row.id ? '编辑学习资料' : '添加学习资料'}</h1><p class="muted">资料仅在公司 CRM 登录后访问，最多20MB。</p></div></div>
      <form id="learningForm" class="learn-form"><label>资料名称<input name="title" maxlength="180" required value="${UI.esc(row.title || '')}" placeholder="例如：公司介绍与产品线"></label>
      <div class="learn-form-grid"><label>资料分类<select name="category">${CATS.map(c=>`<option ${c===row.category?'selected':''}>${c}</option>`).join('')}</select></label><label>显示顺序<input name="sort_order" type="number" value="${Number(row.sort_order || 0)}"></label></div>
      <label>学习说明<textarea name="description" rows="4" maxlength="4000" placeholder="学习目标、重点内容或完成要求">${UI.esc(row.description || '')}</textarea></label>
      <label>附件（PDF、Word、PPT、Excel、图片，最大20MB）<input name="file" type="file" accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png" ${CRM_CONFIG.MODE==='demo'?'disabled':''}><small>${CRM_CONFIG.MODE==='demo'?'演示模式不能上传私有附件。':UI.esc(row.file_name ? `当前附件：${row.file_name}（选新文件会替换）` : '不上传文件时，可填写资料链接或在说明中添加内容')}</small></label>
      <details class="learning-ai-fields"><summary>AI知识正文与使用范围</summary><p class="muted small">仅此处正文会用于AI问答，不自动读取附件或外部链接。可粘贴已审核内容，TXT/MD可一键读入。</p><label>供AI检索的知识正文<textarea name="ai_text" rows="8" maxlength="20000" placeholder="粘贴已审核的公司知识正文">${UI.esc(row.ai_text||'')}</textarea></label><button type="button" class="ghost sm" id="importKnowledgeText">从本次选择的TXT/MD附件读入</button><label class="inl"><input type="checkbox" name="ai_allowed" ${row.ai_allowed?'checked':''}>公司已审核上述正文，允许提交给启用的外部AI（可能包括免费模型）；正文不含个人信息、客户机密、内部报价、密码或授权令牌。仅已发布资料参与问答。</label></details><label>资料链接（可选，必须是 https://）<input name="external_url" type="url" value="${UI.esc(row.external_url || '')}" placeholder="https://..."></label>
      <div class="learn-options"><label class="inl"><input name="required" type="checkbox" ${row.required?'checked':''}> 新员工必学</label><label class="inl">发布状态<select name="status"><option value="draft" ${row.status==='draft'?'selected':''}>草稿（员工不可见）</option><option value="published" ${row.status==='published'?'selected':''}>已发布（员工可见）</option></select></label></div>
      <div class="actions"><button type="button" class="ghost" id="cancelLearning">取消</button><button class="primary" id="saveLearning">保存资料</button></div><div class="err" id="learningError"></div></form></div>`, modal => {
      modal.querySelector('#importKnowledgeText').onclick=async()=>{const f=modal.querySelector('form'),file=f.elements.file.files[0];if(!file||! /\.(txt|md)$/i.test(file.name))return UI.toast('请先在附件中选择TXT或MD文件；其他格式请粘贴已审核正文',1);if(file.size>80000)return UI.toast('知识正文文件较大，请只粘贴需要的段落（最多2万字）',1);try{f.elements.ai_text.value=(await file.text()).replace(/^\uFEFF/,'').slice(0,20000);UI.toast('正文已读入，请审核后勾选AI使用范围');}catch(e){UI.toast(e.message,1);}};
      modal.querySelector('#cancelLearning').onclick = () => modal.remove();
      modal.querySelector('#learningForm').onsubmit = async e => {
        e.preventDefault(); const f=e.currentTarget, btn=modal.querySelector('#saveLearning'), err=modal.querySelector('#learningError'); btn.disabled=true; btn.textContent='正在保存…'; err.textContent='';
        try {
          const data=new FormData(f), file=f.elements.file.files[0], external=String(data.get("external_url")||"").trim();
          if(external && !external.toLowerCase().startsWith("https://")) throw new Error("资料链接必须以 https:// 开头");
          await DB.saveLearningMaterial({id:row.id,title:String(data.get('title')).trim(),category:data.get('category'),ai_text:String(data.get('ai_text')||'').trim(),ai_allowed:f.elements.ai_allowed.checked,description:String(data.get('description')||'').trim(),sort_order:data.get('sort_order'),required:f.elements.required.checked,status:data.get('status'),external_url:String(data.get('external_url')||'').trim()||null,file_name:row.file_name,file_path:row.file_path,file_size:row.file_size,file});
          modal.remove(); UI.toast('学习资料已保存'); await render();
        } catch(ex) { err.textContent=ex.message; btn.disabled=false; btn.textContent='保存资料'; }
      };
    });
  }

  async function render() {
    const admin=isAdmin();
    const [materials, progress] = await Promise.all([DB.listLearningMaterials(),DB.listLearningProgress()]);
    const meProgress=progress.filter(p=>p.user_id===UI.ME.id), done=new Set(meProgress.map(p=>p.material_id));
    const required=materials.filter(m=>m.required&&m.status==='published'), completedRequired=required.filter(m=>done.has(m.id)).length;
    const pct=required.length?Math.round(completedRequired*100/required.length):0;
    const tabs=CATS.map(c=>`<button class="learn-filter ${c==='全部资料'?'on':''}" data-category="${c}">${c}</button>`).join('');
    const groups=CATS.map(cat=>{const list=materials.filter(m=>m.category===cat);if(!list.length)return '';return `<section class="learn-section" data-section="${cat}"><div class="learn-section-title"><div><h2>${cat}</h2><p>${cat==='新员工入职'?'新员工从这里开始，按顺序完成入职学习':'公司内部学习资料'}</p></div><span class="learn-count">${list.length} 份</span></div><div class="learn-grid">${list.map(m=>{
      const finished=done.has(m.id); const badges=`${m.required?'<span class="learn-badge required">新员工必学</span>':''}${m.status==='draft'?'<span class="learn-badge draft">草稿</span>':''}`;
      const file=m.file_name?`<span class="learn-file-icon">${ext(m.file_name)==='PDF'?'PDF':'文档'}</span><span class="learn-file-name">${UI.esc(m.file_name)}</span>`:'';
      return `<article class="learn-card ${finished?'is-done':''}"><div class="learn-card-top"><span class="learn-icon">${cat==='新员工入职'?'🌱':cat==='公司制度'?'📋':cat==='产品知识'?'🧱':cat==='开发流程'?'🧭':'📎'}</span><div class="learn-badges">${badges}</div>${admin?`<div class="learn-actions"><button class="learn-more" title="编辑资料" data-edit="${UI.esc(m.id)}">编辑</button><button class="learn-delete" title="删除资料" data-delete="${UI.esc(m.id)}">删除</button></div>`:''}</div><h3>${UI.esc(m.title)}</h3><p class="learn-description">${UI.esc(m.description||'打开资料开始学习。')}</p>${m.file_path||m.file_name?`<div class="learn-attachment">${file}<button class="learn-open" data-file="${UI.esc(m.id)}">打开资料 ↗</button></div>`:''}${m.external_url?`<a class="learn-open external" href="${UI.esc(m.external_url)}" target="_blank" rel="noopener">打开学习链接 ↗</a>`:''}<div class="learn-card-footer"><span>${finished?`<span class="learn-complete">✓ 已完成</span>`:'<span class="muted">尚未完成</span>'}${finished?` · ${asDate(meProgress.find(p=>p.material_id===m.id)?.completed_at)}`:''}</span>${!admin&&!finished?`<button class="primary sm" data-complete="${UI.esc(m.id)}">标记完成</button>`:admin?`<span class="muted">${m.status==='published'?'员工可见':'仅管理员可见'}</span>`:''}</div></article>`;
    }).join('')}</div></section>`;}).join('');
    const adminProgress=admin?`<section class="card pad learn-admin-progress"><div class="learn-section-title"><div><h2>员工学习进度</h2><p>按员工查看必学资料完成情况</p></div><span class="learn-count">${UI.USERS.filter(u=>u.active).length} 位员工</span></div><div class="tblwrap"><table class="mini"><thead><tr><th>员工</th><th>已完成资料</th><th>必学完成</th><th>最近完成时间</th></tr></thead><tbody>${UI.USERS.filter(u=>u.active&&u.role!=='admin').map(u=>{const ps=progress.filter(p=>p.user_id===u.id), reqDone=required.filter(m=>ps.some(p=>p.material_id===m.id)).length, last=ps.map(p=>p.completed_at).sort().pop();return `<tr><td>${UI.esc(u.full_name||u.username)}</td><td>${ps.length} / ${materials.filter(m=>m.status==='published').length}</td><td><span class="learn-progress-pill">${required.length?`${reqDone}/${required.length}`:'未设置必学资料'}</span></td><td>${asDate(last)}</td></tr>`;}).join('')||'<tr><td colspan="4">暂时没有员工学习记录</td></tr>'}</tbody></table></div></section>`:'';
    UI.render(`<div class="learn-page"><div class="learn-hero"><div class="learn-hero-copy"><span class="learn-eyebrow">TEAM LEARNING · DELIN CRM</span><h1>学习中心</h1><p>${admin?'管理公司制度、产品知识与新人培训资料，随时查看团队完成情况。':'集中学习公司制度、产品资料和工作流程；新员工请先完成入职必学内容。'}</p><div class="learn-hero-actions">${admin?'<button class="primary" id="addLearning">＋ 添加学习资料</button>':''}<a class="btn learn-help" href="#/business">查看业务工作台　→</a></div></div><div class="learn-progress-card"><div class="learn-progress-head"><span>我的入职学习</span><b>${pct}%</b></div><div class="learn-progress-track"><i style="width:${pct}%"></i></div><p>${required.length?`已完成 ${completedRequired} / ${required.length} 项必学资料`:'老板尚未设置必学资料'}</p></div></div>
      <div class="learn-summary"><div class="learn-summary-card"><span>已发布资料</span><b>${materials.filter(m=>m.status==='published').length}</b><small>公司学习内容</small></div><div class="learn-summary-card"><span>我的已完成</span><b>${done.size}</b><small>完成时间自动记录</small></div><div class="learn-summary-card"><span>新员工必学</span><b>${required.length}</b><small>入职培训路径</small></div><div class="learn-summary-card ${admin?'admin':''}"><span>${admin?'草稿资料':'待完成必学'}</span><b>${admin?materials.filter(m=>m.status==='draft').length:Math.max(required.length-completedRequired,0)}</b><small>${admin?'员工暂不可见':'完成后系统记录进度'}</small></div></div>
      <div class="learn-toolbar"><div><h2>公司资料库</h2><p>按主题分类浏览，资料只对登录的公司成员开放。</p></div><div class="learn-filters"><button class="learn-filter on" data-category="全部资料">全部资料</button>${tabs}</div></div>
      <div class="learn-sections">${groups||'<section class="card empty learn-empty">目前还没有发布资料。'+(admin?'点击“添加学习资料”开始创建入职培训内容。':'请联系老板添加培训资料。')+'</section>'}</div>${adminProgress}</div>`,'learning');
    $('#addLearning')?.addEventListener('click',()=>editor());
    $$('[data-edit]').forEach(b=>b.onclick=()=>editor(materials.find(m=>m.id===b.dataset.edit)));
    $$('[data-delete]').forEach(b=>b.onclick=async()=>{const row=materials.find(m=>m.id===b.dataset.delete);if(!confirm(`确定删除“${row.title}”？员工进度记录也会一起删除。`))return;b.disabled=true;try{await DB.deleteLearningMaterial(row.id);UI.toast('资料已删除');await render();}catch(ex){UI.toast(ex.message,true);b.disabled=false;}});
    $$('[data-complete]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await DB.markLearningComplete(b.dataset.complete);UI.toast('已记录学习完成');await render();}catch(e){UI.toast(e.message,true);b.disabled=false;}});
    $$('[data-file]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const row=materials.find(m=>m.id===b.dataset.file);const url=await DB.learningFileUrl(row.file_path);window.open(url,'_blank','noopener');}catch(e){UI.toast(e.message,true);}finally{b.disabled=false;}});
    $$('[data-category]').forEach(b=>b.onclick=()=>{const cat=b.dataset.category;$$('.learn-filter').forEach(x=>x.classList.toggle('on',x===b));$$('.learn-section').forEach(s=>s.hidden=cat!=='全部资料'&&s.dataset.section!==cat);});
  }
  UI.views.learning={render};
  // Durable per-account acknowledgements; being notified does not mark learning complete.
  let notificationBusy=false, notificationUser=null, unread=[],lastNoticeAt=0;
  async function checkUpdates(){
    if(notificationBusy||!UI.ME||DB.mode==='demo'||document.hidden)return;
    notificationBusy=true;const uid=UI.ME.id;
    try{
      let result=unread;if(notificationUser!==uid||Date.now()-lastNoticeAt>=60000){result=DB.chk(await DB.init().rpc('crm_learning_unread'))||[];lastNoticeAt=Date.now();}
      if(UI.ME?.id!==uid)return;notificationUser=uid;unread=result;
      document.getElementById('learningUpdateNotice')?.remove();
      const main=document.querySelector('main');if(!main||!unread.length)return;
      const box=document.createElement('section');box.id='learningUpdateNotice';box.setAttribute('role','status');
      box.style.cssText='padding:16px 20px;border:1px solid #9ac6e6;border-radius:12px;background:#edf7ff;margin:0 0 18px;color:#173c5b';
      box.innerHTML=`<b>📚 学习资料有更新 · ${unread.length} 条未确认</b><p style="margin:8px 0">${unread.slice(0,3).map(n=>UI.esc(n.title)).join('；')}${unread.length>3?'…':''}</p><div class="actions"><button class="primary sm" data-learning-updates>查看更新</button><a class="btn ghost sm" href="#/learning">进入学习中心</a><button class="ghost sm" data-learning-ack>以上更新已知晓</button></div><small>已知晓仅关闭本人的提醒，不代表已完成学习。离线期间的更新会在下次登录时提示。</small>`;
      if(main.classList.contains('ai-chat-main'))box.style.cssText+=';position:fixed;top:12px;right:24px;max-width:420px;z-index:1500';main.prepend(box);const snapshot=unread.map(n=>n.id);
      box.querySelector('[data-learning-ack]').onclick=async e=>{e.target.disabled=true;try{if(UI.ME?.id!==uid)return;DB.chk(await DB.init().rpc('crm_learning_ack',{p_ids:snapshot}));await checkAfterAck();}catch(ex){UI.toast(ex.message,true);e.target.disabled=false;}};
      box.querySelector('[data-learning-updates]').onclick=()=>UI.modal(`<h2>学习资料更新</h2><p>请阅读新版资料；已完成的旧学习记录会保留。</p><ul class="timeline">${unread.map(n=>`<li><b>${UI.esc(n.title)}</b><p>${n.kind==='published'?'新发布':'内容已更新'} · ${UI.esc(new Date(n.created_at).toLocaleString('zh-CN'))}</p></li>`).join('')}</ul><a class="btn primary" href="#/learning" id="openUpdatedLearning">去学习中心</a>`,(m,close)=>m.querySelector('#openUpdatedLearning').onclick=close);
    }catch(ex){console.warn('Learning update check unavailable');}finally{notificationBusy=false;}
  }
  async function checkAfterAck(){lastNoticeAt=0;document.getElementById('learningUpdateNotice')?.remove();notificationBusy=false;await checkUpdates();}
  const bind=UI.bindShell;UI.bindShell=()=>{bind();if(notificationUser!==UI.ME?.id){unread=[];notificationUser=null;}checkUpdates();};
  setInterval(checkUpdates,60000);window.addEventListener('focus',checkUpdates);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdates();});
})();
