/* Personal reminders: database clock and atomic leases prevent duplicate cross-tab delivery. */
(function(){
 const {esc,$,$$}=UI, names={once:'仅一次',minutes:'分钟',hours:'小时',days:'天',weeks:'周',months:'月',years:'年'};
 const fmt=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const dateInput=v=>new Date(new Date(v).getTime()+8*3600000).toISOString().slice(0,16);
 let ticking=false,lastPoll=0,account=null;const panels=new Map();
 async function rpc(name,args={}){if(DB.mode==='demo')throw new Error('闹钟事项请在正式CRM使用');return DB.chk(await DB.init().rpc(name,args));}
 function clearPanels(){panels.forEach(p=>p.remove());panels.clear();}
 async function act(row,action,minutes=10){await rpc('crm_reminder_action',{p_id:row.id,p_version:row.version,p_action:action,p_minutes:minutes});panels.get(row.id)?.remove();panels.delete(row.id);}
 function popup(row){
  if(panels.has(row.id))return;
  let host=document.querySelector('#crmReminderPopups');if(!host){host=document.createElement('section');host.id='crmReminderPopups';host.className='reminder-popups';host.setAttribute('aria-label','到期闹钟事项');document.body.append(host);}
  const panel=document.createElement('article');panel.className='reminder-popup';panel.setAttribute('role','alertdialog');panel.setAttribute('aria-label','事项提醒：'+row.title);
  panel.innerHTML=`<span class="reminder-eyebrow">⏰ 到点提醒 · 北京时间</span><h2>${esc(row.title)}</h2><p>${esc(fmt(row.next_at))}${new Date(row.next_at)<new Date(Date.now()-60000)?' · 已到期':''}</p><pre>${esc(row.content)}</pre><div class="actions"><button class="primary sm" data-do="done">${row.frequency==='once'?'完成事项':'本次完成'}</button><button class="ghost sm" data-do="snooze">10分钟后再提醒</button><button class="ghost sm" data-do="pause">暂停</button></div><p class="err" role="status"></p><a href="#/reminders">管理我的闹钟事项 →</a>`;
  panel.dataset.version=String(row.version);panels.set(row.id,panel);host.append(panel);
  panel.querySelectorAll('[data-do]').forEach(b=>b.onclick=async()=>{panel.querySelectorAll('button').forEach(x=>x.disabled=true);try{await act(row,b.dataset.do);if(location.hash.startsWith('#/reminders'))await render();}catch(e){panel.querySelector('[role=status]').textContent=e.message;panel.querySelectorAll('button').forEach(x=>x.disabled=false);}});
  if(document.hidden&&'Notification'in window&&Notification.permission==='granted'){
   try{const n=new Notification('CRM事项提醒：'+row.title,{body:row.content||fmt(row.next_at),tag:'crm-reminder-'+row.id,requireInteraction:true});n.onclick=()=>{window.focus();location.hash='#/reminders';n.close();};}catch{/* in-app alert remains available */}
  }
 }
 async function tick(force=false){
  const me=UI.ME?.id;if(account!==me){account=me;lastPoll=0;clearPanels();}
  if(!me||DB.mode==='demo'||ticking||(!force&&Date.now()-lastPoll<25000))return;
  ticking=true;lastPoll=Date.now();
  try{
   if(panels.size){const live=DB.chk(await DB.t('crm_reminders').select('id,status,version').in('id',[...panels.keys()]));for(const[id,p]of panels){const row=live.find(x=>x.id===id);if(!row||row.status!=='active'||String(row.version)!==p.dataset.version){p.remove();panels.delete(id);}}}
   const rows=await rpc('crm_claim_reminders');if(UI.ME?.id!==me)return;for(const row of rows||[])popup(row);}
  catch(e){/* A network failure is retried by the next poll; never claim a successful reminder. */}
  finally{ticking=false;}
 }
 function editor(row={}){
  UI.modal(`<h2>${row.id?'编辑闹钟事项':'新建闹钟事项'}</h2><form id="reminderForm"><label>提醒事项<input name="title" required maxlength="160" value="${esc(row.title||'')}" placeholder="例如：下午三点装车"></label><label>详细内容<textarea name="content" rows="4" maxlength="3000" placeholder="客户、装车地点、需要准备的资料等">${esc(row.content||'')}</textarea></label><label>首次提醒日期和时间（北京时间）<input type="datetime-local" name="start_at" required value="${dateInput(row.start_at||new Date(Date.now()+3600000))}"></label><div class="g2"><label>重复频率<select name="frequency">${Object.entries(names).map(([v,label])=>UI.opt(v,v==='once'?label:'每隔 '+label,row.frequency||'once')).join('')}</select></label><label>间隔数量<input type="number" name="every_n" min="1" max="365" step="1" value="${Number(row.every_n||1)}"><small>例如每3天：选“天”，填3；每月27号：首次日期选27号，选“月”，填1。</small></label></div><p class="muted small">月末没有对应日期时在当月最后一天提醒，下个月仍按原始日期计算。离线错过的事项在重新打开CRM后补提醒；重复事项一次只补最近待处理的一次。</p><p role="status" class="err"></p><div class="actions"><button type="button" class="ghost" data-cancel>取消</button><button class="primary">保存提醒</button></div></form>`,(m,close)=>{
   m.querySelector('[data-cancel]').onclick=close;const f=m.querySelector('form');
   const sync=()=>{f.elements.every_n.disabled=f.elements.frequency.value==='once';};f.elements.frequency.onchange=sync;sync();
   f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('.primary');b.disabled=true;try{
    const start=new Date(f.elements.start_at.value+':00+08:00');if(!Number.isFinite(start.getTime()))throw new Error('请选择有效的日期和时间');
    await rpc('crm_save_reminder',{p_data:{title:f.elements.title.value.trim(),content:f.elements.content.value.trim(),start_at:start.toISOString(),frequency:f.elements.frequency.value,every_n:Number(f.elements.every_n.value)||1},p_id:row.id||null,p_version:row.version||null});
    panels.get(row.id)?.remove();panels.delete(row.id);close();UI.toast('闹钟事项已保存');await render();await tick(true);
   }catch(e){f.querySelector('[role=status]').textContent=e.message;b.disabled=false;}};
  });
 }
 async function render(){
  if(DB.mode==='demo')return UI.render('<section class="card pad"><h1>闹钟事项</h1><p>请在正式CRM设置个人提醒；演示模式不会创建真实闹钟。</p></section>','reminders');
  const rows=DB.chk(await DB.t('crm_reminders').select('*').neq('status','deleted').order('next_at').limit(200));
  const active=rows.filter(r=>r.status==='active'),due=active.filter(r=>Date.parse(r.next_at)<=Date.now());
  UI.render(`<div class="reminder-hero"><span class="reminder-eyebrow">MY REMINDERS</span><h1>闹钟事项</h1><p>装车、会议、报价、客户约定——按自己的时间安排工作。</p><div class="actions"><button class="primary" id="newReminder">＋ 新建提醒</button><button class="ghost" id="reminderNotify">启用浏览器通知</button><button class="ghost" id="reminderRefresh">刷新</button></div></div><div class="learn-summary"><div class="learn-summary-card"><span>待提醒</span><b>${active.length}</b></div><div class="learn-summary-card"><span>已到期</span><b>${due.length}</b></div><div class="learn-summary-card"><span>已完成</span><b>${rows.filter(r=>r.status==='completed').length}</b></div><div class="learn-summary-card"><span>已暂停</span><b>${rows.filter(r=>r.status==='paused').length}</b></div></div><section class="card pad"><p>提醒时间统一使用北京时间（UTC+8）。CRM打开且联网时约每30秒检查一次，后台标签页可能受到浏览器节能限制。</p><p class="muted small">关闭浏览器或电脑休眠时无法弹窗；重新打开会补提醒。允许浏览器通知后，切换到其他标签页也可收到通知，电脑系统通知权限仍需开启。每个人只查看和管理自己的事项。</p><p id="reminderPermission" role="status"></p><label>查看状态<select id="reminderFilter"><option value="active">待提醒</option><option value="">全部</option><option value="paused">已暂停</option><option value="completed">已完成</option></select></label><div id="reminderRows"></div></section>`,'reminders');
  function draw(){const status=$('#reminderFilter').value,chosen=rows.filter(r=>!status||r.status===status);
   $('#reminderRows').innerHTML=chosen.map(r=>`<article class="reminder-row ${r.status==='active'&&Date.parse(r.next_at)<=Date.now()?'is-due':''}"><div><h3>${esc(r.title)}</h3><p style="white-space:pre-wrap">${esc(r.content)}</p><p><b>${esc(fmt(r.next_at))}</b> · ${r.frequency==='once'?'仅一次':'每'+r.every_n+names[r.frequency]} · ${{active:'待提醒',paused:'已暂停',completed:'已完成'}[r.status]}</p></div><div class="actions"><button class="ghost sm" data-edit="${r.id}">编辑</button>${r.status==='active'?`<button class="ghost sm" data-action="done" data-id="${r.id}">${r.frequency==='once'?'完成':'完成本次'}</button><button class="ghost sm" data-action="pause" data-id="${r.id}">暂停</button>`:`<button class="ghost sm" data-action="resume" data-id="${r.id}">恢复提醒</button>`}<button class="ghost sm" data-action="delete" data-id="${r.id}">移除</button></div></article>`).join('')||'<p class="empty">暂无这类事项，点击“新建提醒”设置日期和时间。</p>';
   $$('[data-edit]').forEach(b=>b.onclick=()=>editor(rows.find(r=>r.id===b.dataset.edit)));
   $$('[data-action]').forEach(b=>b.onclick=async()=>{const row=rows.find(r=>r.id===b.dataset.id);if(b.dataset.action==='delete'&&!confirm('移除这条提醒？不会删除客户资料。'))return;b.disabled=true;try{await act(row,b.dataset.action);await render();}catch(e){UI.toast(e.message,1);b.disabled=false;}});
  }
  $('#reminderFilter').onchange=draw;draw();$('#newReminder').onclick=()=>editor();$('#reminderRefresh').onclick=()=>render().then(()=>tick(true)).catch(e=>UI.toast(e.message,1));
  $('#reminderNotify').onclick=async()=>{const status=$('#reminderPermission');if(!('Notification'in window))return status.textContent='当前浏览器不支持系统通知，仍可使用CRM内弹窗。';const p=await Notification.requestPermission();status.textContent=p==='granted'?'浏览器通知已允许，请同时确保电脑通知设置已开启。':p==='denied'?'浏览器通知被拒绝，可在网站权限中修改；CRM内弹窗仍可用。':'尚未允许浏览器通知；CRM内弹窗仍可用。';};
  tick();
 }
 UI.views.reminders={render};UI.REMINDERS={tick,clear:clearPanels};
 const bind=UI.bindShell;UI.bindShell=()=>{bind();tick();};
 window.addEventListener('focus',()=>tick());document.addEventListener('visibilitychange',()=>tick());
 setInterval(()=>tick(),30000);
})();
