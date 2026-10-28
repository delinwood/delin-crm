/* Continuous AI chat. Credentials and tool execution stay on the server. */
(function(){
 const {esc,$,$$}=UI;
 const modes={chat:'通用智能助手',knowledge:'知识问答',reply:'邮件理解',research:'客户分析',training:'培训练习',daily:'今日工作',business:'经营分析'};
 const providerName=id=>({qwen:'通义千问',gemini:'Google Gemini'}[id]||id);
 const fmt=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未设置';
 let lastUser=null,sessions={};
 async function api(action,data={}){if(DB.mode==='demo')throw new Error('演示模式不调用AI');const r=await DB.init().functions.invoke('crm-agent',{body:{action,...data}});if(r.error){let msg='AI服务暂不可用';try{msg=(await r.error.context.json()).error||msg;}catch{}throw new Error(msg);}if(r.data?.error)throw new Error(r.data.error);return r.data;}
 function sourcesHTML(sources=[]){return sources.map(s=>`<li><b>${esc(s.id)} · ${esc(s.title)}</b>${s.date?' · '+esc(fmt(s.date)):''}<p>${esc(s.text||'')}</p>${s.url&&/^https?:\/\//i.test(s.url)?UI.link(s.url,'打开原始来源'):s.material_id?'<a href="#/learning">查看原资料</a>':''}</li>`).join('');}
 const toolNames={find_clients:'查找CRM客户',client_records:'读取客户档案',client_reply:'读取关联来信',company_knowledge:'检索公司知识',work_today:'查询今日工作',business_summary:'查询经营统计',start_discovery:'创建获客任务',discovery_status:'查询获客进度',create_reminder:'保存闹钟事项',draft_email:'准备邮件草稿'};
 function answerHTML(text){
  // Escape before minimal formatting. Never interpret AI HTML or arbitrary links.
  return String(text||'').split(/\n{2,}/).map(block=>{
   const safe=esc(block).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
   if(/^#{1,4} /.test(block))return '<h2>'+safe.replace(/^#{1,4} /,'')+'</h2>';
   return '<p>'+safe.replace(/\n/g,'<br>')+'</p>';
  }).join('');
 }
 function resultHTML(r){return `<div class="ai-answer">${answerHTML(r.answer)}</div>${r.coverage?'<p class="muted small">'+esc(r.coverage)+'</p>':''}${r.score?'<p class="small">采购档案证据完整度：'+r.score.score+'/100 · '+esc(r.score.notice)+'</p>':''}${r.subject?`<details><summary>邮件草稿</summary><label>主题<input data-draft-subject value="${esc(r.subject)}"></label><label>正文<textarea data-draft-body rows="8">${esc(r.body)}</textarea></label><button class="ghost" data-mail-preview>在邮件中心预览</button></details>`:''}${r.sources?.length?`<details><summary>引用资料 ${r.sources.length} 项</summary><ul class="ai-sources">${sourcesHTML(r.sources)}</ul></details>`:''}`;}
 function settingsForm(status){
  const s=status.settings||{},ps=status.providers||[];
  UI.modal(`<h2>AI免费额度与团队设置</h2><p>密钥只在Supabase服务器配置。这里不能购买或充值。供应商保护开关必须在官方后台核实；系统总安全额度填写“本CRM可使用的累计上限”，应低于当前剩余额度加已计使用量，并预留其他应用用量。</p><form id="aiSettings"><label class="inl"><input type="checkbox" name="enabled" ${s.enabled?'checked':''}>启用AI入口调用</label><label>全公司每天Token安全额度<input type="number" name="daily_tokens" min="1000" max="10000000" step="1" value="${s.daily_token_limit||50000}"></label><label>默认每人每天最多任务数（0为不限次数）<input type="number" name="daily" min="0" max="200" value="${s.daily_limit??0}"></label><label class="inl"><input type="checkbox" name="private" ${s.private_consent?'checked':''}>允许员工逐次确认后，把选定客户资料、关联回复、本人待办及老板经营汇总交给通义千问（阿里云百炼北京地域）。不会自动上传整个CRM。</label><p class="muted small">Gemini免费模型仅处理批准的非机密知识资料和虚构练习，不能用于真实邮件、客户分析、每日业务数据或经营统计。</p>${ps.map(p=>`<fieldset data-provider="${p.id}"><legend>${providerName(p.id)}</legend><p>服务器密钥：${p.credential_ready?'已配置':'尚未配置'} · 已计安全用量：${Number(p.used_tokens).toLocaleString()} tokens</p><label>模型代码<input name="model" value="${esc(p.model)}" required pattern="[A-Za-z0-9_.-]{1,100}"></label><label>累计安全额度（tokens）<input name="token_budget" type="number" min="${p.used_tokens}" max="100000000" step="1" value="${p.token_budget}"></label><label>免费额度截止时间（北京时间）<input name="expires_at" type="datetime-local" value="${p.expires_at?new Date(Date.parse(p.expires_at)+28800000).toISOString().slice(0,16):''}"></label><label>切换顺序（数字越小越优先）<input name="priority" type="number" value="${p.priority}"></label><label class="inl"><input name="verified" type="checkbox" ${p.free_only_verified?'checked':''}>已核实官方免费档位/免费用完即停已生效，且未启用付费后备</label>${p.id==='qwen'?`<label class="inl"><input name="private_allowed" type="checkbox" ${p.private_allowed?'checked':''}>允许千问处理上述经批准的业务资料</label>`:''}<label class="inl"><input name="on" type="checkbox" ${p.enabled?'checked':''}>启用这个免费模型</label></fieldset>`).join('')}<h3>员工每日任务数</h3><p class="muted small">0表示每日不限次数，仍受全公司每日Token额度限制；未单独设置时使用默认上限。</p>${UI.USERS.filter(u=>u.active).map(u=>`<label>${esc(u.full_name)}<input data-user-limit="${esc(u.id)}" type="number" min="0" max="200" placeholder="使用默认上限"></label>`).join('')}<p class="err" role="status"></p><div class="actions"><button type="button" class="ghost" data-close>取消</button><button class="primary">保存免费设置</button></div></form>`,(m,close)=>{
   m.querySelector('[data-close]').onclick=close;const f=m.querySelector('form');
   DB.t('crm_ai_user_limits').select('*').then(r=>{if(!r.error)for(const row of r.data){const el=[...m.querySelectorAll('[data-user-limit]')].find(x=>x.dataset.userLimit===row.user_id);if(el)el.value=row.daily_limit;}});
   f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button.primary');b.disabled=true;try{
    const providers=[...f.querySelectorAll('[data-provider]')].map(fs=>{const named=n=>fs.querySelector('[name="'+n+'"]');const expires=named('expires_at').value;
     if(named('on').checked&&!status.providers.find(p=>p.id===fs.dataset.provider)?.credential_ready)throw new Error('请先由管理员在Supabase服务器配置模型密钥');
     return{id:fs.dataset.provider,model:named('model').value,token_budget:Number(named('token_budget').value),expires_at:expires?new Date(expires+':00+08:00').toISOString():null,priority:Number(named('priority').value),free_only_verified:named('verified').checked,private_allowed:fs.dataset.provider==='qwen'&&named('private_allowed').checked,enabled:named('on').checked};});
    const limits=[...f.querySelectorAll('[data-user-limit]')].filter(x=>x.value!=='').map(x=>({user_id:x.dataset.userLimit,daily_limit:Number(x.value)}));
    await UI.BUSINESS.rpc('crm_ai_set_daily_tokens',{p_tokens:Number(f.elements.daily_tokens.value)});
    await UI.BUSINESS.rpc('crm_ai_save_settings',{p_enabled:f.elements.enabled.checked,p_private:f.elements.private.checked,p_daily:Number(f.elements.daily.value),p_providers:providers,p_limits:limits});
    close();UI.toast('AI设置已保存');await render('knowledge');
   }catch(e){f.querySelector('[role=status]').textContent=e.message;b.disabled=false;}};
  });
 }

 async function render(mode='chat'){
  if(!modes[mode])mode='chat';if(mode==='business'&&UI.ME.role!=='admin')mode='daily';
  if(lastUser!==UI.ME.id){lastUser=UI.ME.id;sessions={};}
  const userId=UI.ME.id,s=sessions[mode]||(sessions[mode]={messages:[],history:[],busy:false,consent:false});
  let status={settings:{enabled:false},providers:[],today_used:0,daily_limit:0},error='',inbound=[];
  if(DB.mode!=='demo')try{status=await api('status');}catch(e){error=e.message;}
  if(UI.ME?.id!==userId)return;
  if(mode==='reply'&&DB.mode!=='demo'){const r=await DB.t('crm_mail_inbound').select('id,client_id,subject,received_at').eq('kind','reply').order('received_at',{ascending:false}).limit(100);if(!r.error)inbound=r.data||[];}
  const privateMode=['chat','reply','research','daily','business'].includes(mode),clients=UI.CLIENTS.filter(c=>UI.ME.role==='admin'||c.owner_id===UI.ME.id);
  const available=status.providers.filter(p=>p.enabled&&p.credential_ready&&p.free_only_verified&&Date.parse(p.expires_at)>Date.now());
  const canUse=status.settings.enabled&&!error&&(!privateMode||(status.settings.private_consent&&available.some(p=>p.id==='qwen'&&p.private_allowed)));
  const placeholder={chat:'直接告诉我你想做什么，例如：找沙特SPC批发客户；明天下午3点提醒我装车。',knowledge:'问产品、外贸知识，或让我解释、翻译和写作。',reply:'选好客户和来信后，告诉我怎样分析或回复。',research:'选好客户后，告诉我希望核对哪些采购证据。',training:'描述练习场景，或继续回答采购商的问题。',daily:'例如：今天哪些客户应该优先跟进？',business:'例如：最近30天有哪些真实询价和订单？'}[mode];
  UI.render(`<section class="ai-chat-shell" aria-label="智能助手"><header class="ai-chat-header"><div class="ai-chat-heading"><div><h1>${modes[mode]}</h1><span class="muted small">通义千问 · 连续对话与任务处理</span></div><div class="actions"><button class="ghost sm" id="aiNewChat">新对话</button><button class="ghost sm" id="aiHistory">历史</button>${UI.ME.role==='admin'?'<button class="ghost sm" id="aiConfigure">设置</button>':''}</div></div><nav class="ai-chat-modes" aria-label="助手入口">${Object.entries(modes).filter(([k])=>k!=='business'||UI.ME.role==='admin').map(([k,n])=>`<a href="#/ai/${k}" class="${mode===k?'on':''}">${n}</a>`).join('')}</nav><div class="ai-chat-usage" id="aiUsage">全公司今日 ${Number(status.today_tokens||0).toLocaleString()} / ${Number(status.settings.daily_token_limit||50000).toLocaleString()} Token · 我今日 ${status.today_used} 次${status.daily_limit?' / 上限'+status.daily_limit+'次':' · 不限次数'}</div>${error?'<p class="warn">'+esc(error)+'</p>':''}${!canUse?'<p class="warn">'+esc(mode==='chat'&&status.chat_available===false?'服务升级中，请稍后刷新。':'当前模型或资料权限尚不可用，请检查免费额度与团队设置。')+'</p>':''}</header><div class="ai-chat-body"><div class="ai-transcript" id="aiTranscript" role="log" aria-label="对话记录" aria-live="polite" aria-relevant="additions text"></div><button type="button" class="ghost sm ai-latest" id="aiLatest" hidden>↓ 查看最新回答</button></div><form id="aiTaskForm" class="ai-composer"><details class="ai-context" ${['reply','research'].includes(mode)?'open':''}><summary>${['reply','research'].includes(mode)?'选择客户 / 任务资料':'资料范围与模型选项'}</summary><div class="ai-context-fields">${['chat','reply','research'].includes(mode)?`<label>搜索客户<input id="aiClientFilter" type="search" placeholder="公司或国家；不选则由助手按任务查询"></label><label>关联客户<select name="client_id" ${['reply','research'].includes(mode)?'required':''}></select></label>`:''}${mode==='reply'?'<label>关联回复<select name="inbound_id" required></select></label>':''}${mode==='training'?'<label>模式<select name="mode"><option value="roleplay">采购商对练</option><option value="coach">点评答复</option><option value="quiz">产品练习</option></select></label>':''}<label>模型<select name="provider"><option value="">自动选择已批准免费模型</option>${status.providers.filter(p=>!privateMode||(p.id==='qwen'&&p.private_allowed)).map(p=>UI.opt(p.id,providerName(p.id),null)).join('')}</select></label><label class="inl"><input name="fallback" type="checkbox" checked>不可用时切换已批准免费模型</label><p class="muted small">${privateMode?'问题及按任务查询的有权限业务资料交给千问（北京）；不自动上传整个CRM或收件箱。查询、提醒和获客任务可由助手处理，邮件草稿仍在邮件中心预览。':'使用批准的知识正文和本次输入；此入口仅提交非机密知识或虚构练习。'}问题、结果和操作记录保存在CRM，老板可以审查。免费额度用完即停。</p></div></details><label class="inl ai-consent" ${s.consent?'hidden':''}><input name="consent" type="checkbox" required ${s.consent?'checked':''}>同意按上述范围使用AI处理本次对话${!privateMode?'，确认输入仅含非机密资料或虚构练习':''}。</label><label class="ai-question-label" for="aiQuestion">消息</label><div class="ai-input-row"><textarea id="aiQuestion" name="question" rows="2" maxlength="2000" required placeholder="${esc(placeholder)}"></textarea><button class="primary" id="aiRun" ${!canUse||s.busy?'disabled':''}>${s.busy?'处理中…':'发送 ↑'}</button></div><div class="ai-composer-bottom"><span>Enter 发送 · Shift+Enter 换行 · AI回答请核实</span><span id="aiError" role="status" class="err"></span></div></form></section>`,'agent');
  document.querySelector('.app-content main')?.classList.add('ai-chat-main');
  const f=$('#aiTaskForm'),log=$('#aiTranscript'),latest=$('#aiLatest'),nodes=new Map();let pinned=true;
  const follow=(node=null)=>{if(!pinned||!log.isConnected)return;requestAnimationFrame(()=>{if(!log.isConnected)return;if(node)log.scrollTop=node.offsetTop-log.offsetTop-12;else log.scrollTop=log.scrollHeight;});};
  log.addEventListener('scroll',()=>{pinned=log.scrollHeight-log.clientHeight-log.scrollTop<90;latest.hidden=pinned;});
  latest.onclick=()=>{pinned=true;log.scrollTop=log.scrollHeight;latest.hidden=true;};
  function bindActions(node,msg){
   node.querySelector('[data-mail-preview]')?.addEventListener('click',()=>UI.mailCompose([msg.client_id],{subject:node.querySelector('[data-draft-subject]').value,body:node.querySelector('[data-draft-body]').value}));
   node.querySelector('[data-ai-copy]')?.addEventListener('click',()=>UI.copy(msg.result.answer));
   node.querySelector('[data-ai-download]')?.addEventListener('click',()=>UI.download('智能助手_'+UI.today()+'.md',new Blob([msg.result.answer],{type:'text/markdown;charset=utf-8'})));
   node.querySelectorAll('[data-ai-action]').forEach(b=>b.onclick=()=>{const a=msg.actions[Number(b.dataset.aiAction)];if(a.kind==='mail_draft')UI.mailCompose([a.client_id],{subject:a.subject,body:a.body});});
  }
  function drawMessage(msg){
   const node=document.createElement('article');node.className='ai-message '+(msg.role==='user'?'is-user':'is-assistant');
   node.innerHTML=msg.role==='user'?`<div class="ai-message-name">你</div><div class="ai-user-text">${esc(msg.text)}</div>`:`<div class="ai-message-name">智能助手${msg.pending?' · 正在处理':''}</div><div class="ai-message-content">${msg.result?resultHTML(msg.result):'<p class="ai-thinking">'+esc(msg.error||'正在理解任务，请稍候…')+'</p>'}</div>${msg.tools?.length?'<details class="ai-tool-trace"><summary>查看实际操作 '+msg.tools.length+' 项</summary>'+msg.tools.map(t=>'<p>'+esc(toolNames[t.name]||t.name)+' · '+(t.status==='completed'?'已完成':'未完成：'+esc(t.error||''))+'</p>').join('')+'</details>':''}${msg.actions?.map((a,i)=>a.kind==='mail_draft'?'<button class="ghost sm" data-ai-action="'+i+'">'+esc(a.label)+'</button>':a.kind==='link'&&/^#\/(?:discovery\/[0-9a-f-]+|reminders)$/.test(a.href)?'<a class="btn ghost sm" href="'+esc(a.href)+'">'+esc(a.label)+'</a>':'').join('')||''}${msg.result&&!msg.pending?'<div class="ai-answer-actions"><button class="ghost sm" data-ai-copy>复制</button><button class="ghost sm" data-ai-download>下载文字</button></div>':''}`;
   log.append(node);bindActions(node,msg);nodes.set(msg,node);return node;
  }
  if(!s.messages.length)log.innerHTML=`<div class="ai-chat-welcome"><span class="ai-welcome-mark">✦</span><h2>今天需要我帮你做什么？</h2><p>可以直接提问、继续追问，或描述一项工作。</p><div class="ai-suggestions">${['解释SPC与强化地板的区别','帮我整理今天的跟进事项','查找沙特SPC批发客户'].map(q=>'<button type="button" class="ghost" data-suggest="'+esc(q)+'">'+esc(q)+'</button>').join('')}</div></div>`;
  else s.messages.forEach(drawMessage);
  s.redraw=msg=>{if(!log.isConnected||UI.ME?.id!==userId)return;const node=nodes.get(msg),wasPinned=pinned,next=drawMessage(msg);if(node)node.replaceWith(next);pinned=wasPinned;follow(next);if(!pinned)latest.hidden=false;};
  s.idle=()=>{if(f.isConnected&&UI.ME?.id===userId){$('#aiRun').disabled=!canUse;$('#aiRun').textContent='发送 ↑';}};
  log.querySelectorAll('[data-suggest]').forEach(b=>b.onclick=()=>{f.elements.question.value=b.dataset.suggest;f.elements.question.focus();});
  follow();
  if(['chat','reply','research'].includes(mode)){
   const drawInbound=()=>{if(mode==='reply')f.elements.inbound_id.innerHTML='<option value="">请选择已同步来信</option>'+inbound.filter(r=>r.client_id===f.elements.client_id.value).map(r=>UI.opt(r.id,r.subject+' · '+fmt(r.received_at),null)).join('');};
   const drawClients=()=>{const q=$('#aiClientFilter').value.toLowerCase().trim();f.elements.client_id.innerHTML='<option value="">'+(mode==='chat'?'不附加客户；按任务查询':'请选择客户')+'</option>'+clients.filter(c=>[c.company_name,c.country].join(' ').toLowerCase().includes(q)).slice(0,100).map(c=>UI.opt(c.id,c.company_name+' · '+(c.country||''),null)).join('');drawInbound();};
   $('#aiClientFilter').oninput=drawClients;f.elements.client_id.onchange=drawInbound;drawClients();
  }
  $('#aiConfigure')?.addEventListener('click',()=>settingsForm(status));
  $('#aiNewChat').onclick=()=>{if(s.busy)return UI.toast('当前任务仍在处理，请等它结束');sessions[mode]=null;render(mode);};
  f.elements.question.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!s.busy&&canUse)f.requestSubmit();}};
  f.onsubmit=async e=>{
   e.preventDefault();if(s.busy||!canUse)return;const text=f.elements.question.value.trim();if(!text)return;
   if(mode==='chat'&&status.chat_available!==true){$('#aiError').textContent='通用助手服务还未升级，请稍后刷新；原专项入口仍可使用。';return;}
   const taskClient=f.elements.client_id?.value||null;if(['reply','research'].includes(mode)&&s.client!==taskClient){s.history=[];s.client=taskClient;}
   s.consent=f.elements.consent.checked;if(!s.consent)return;
   f.querySelector('.ai-consent').hidden=true;f.querySelector('.ai-context').open=false;
   s.busy=true;$('#aiError').textContent='';$('#aiRun').disabled=true;$('#aiRun').textContent='处理中…';f.elements.question.value='';
   log.querySelector('.ai-chat-welcome')?.remove();const user={role:'user',text};s.messages.push(user);drawMessage(user);
   const msg={role:'assistant',pending:true,tools:[],actions:[]};s.messages.push(msg);let node=drawMessage(msg);pinned=true;follow(node);
   const update=()=>s.redraw?.(msg);
   try{
    let result;const sources=[],turnId=crypto.randomUUID();
    for(let round=0;round<5;round++){
     const r=await api('run',{task:mode,request_id:crypto.randomUUID(),turn_id:turnId,question:round?'继续完成上述任务，根据工具真实结果给出答复；已经成功的操作不要重复执行。':text,client_id:taskClient,inbound_id:f.elements.inbound_id?.value||null,mode:f.elements.mode?.value,provider:f.elements.provider.value,fallback:f.elements.fallback.checked,consent:true,nonconfidential:!privateMode,history_ids:s.history.slice(-8),continue_tools:round<4});
     if(UI.ME?.id!==userId)return;
     s.history.push(r.id);result=r.result;msg.client_id=r.client_id;msg.tools.push(...(result.tools||[]));msg.actions.push(...(result.actions||[]));sources.push(...(result.sources||[]));
     msg.result={...result,sources:[...new Map(sources.map(x=>[x.id,x])).values()]};update();
     if(!result.needs_continue)break;
    }
    msg.pending=false;update();
    try{const fresh=await api('status');if(log.isConnected)$('#aiUsage').textContent='全公司今日 '+Number(fresh.today_tokens||0).toLocaleString()+' / '+Number(fresh.settings.daily_token_limit||50000).toLocaleString()+' Token · 我今日 '+fresh.today_used+' 次';}catch{}
   }catch(e){msg.pending=false;msg.error=e.message;if(msg.result)msg.result.answer+='\n\n后续处理暂停：'+e.message;update();if(f.isConnected){$('#aiError').textContent=e.message;if(!msg.result)f.elements.question.value=text;}}
   finally{s.busy=false;s.idle?.();}
  };
  $('#aiHistory').onclick=async()=>{try{
   const rows=DB.chk(await DB.t('crm_ai_requests').select('id,user_id,task,provider,status,charged_tokens,question,result,error,created_at').order('created_at',{ascending:false}).limit(30));
   UI.modal('<h2>最近调用记录</h2>'+rows.map(r=>`<details><summary>${esc(fmt(r.created_at))} · ${esc(UI.userName(r.user_id))} · ${esc(modes[r.task]||r.task)} · ${esc(r.status)}</summary><p>${esc(r.question)}</p><p class="small">已计 ${r.charged_tokens} tokens</p>${r.error?'<p class="warn">'+esc(r.error)+'</p>':''}${r.result?'<div class="ai-answer">'+answerHTML(r.result.answer)+'</div>':''}</details>`).join('')||'<p>暂无记录</p>');
  }catch(e){UI.toast(e.message,1);}};
 }
 UI.views.ai={render};UI.AI={api};
})();
