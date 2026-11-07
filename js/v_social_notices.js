/* Internal notes and reminders for assigned social leads. */
(function(){
  const {esc}=UI;
  const rpc=async(name,args)=>DB.chk(await DB.init().rpc(name,args));
  const date=at=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  let pollUser, checkedAt=0, pending=false, unread=0;
  const badge=()=>document.querySelector('#socialUnread');
  function paintBadge(){
    const button=badge();
    if(button)button.remove();
    if(!unread||!UI.ME)return;
    const main=document.querySelector('.app-content main');
    if(!main)return;
    const next=document.createElement('button');
    next.id='socialUnread';next.className='warn';
    next.textContent='社媒客户 · '+unread+' 条未读备注／提醒';
    next.onclick=()=>UI.openSocialInbox();
    main.prepend(next);
  }
  async function poll(force=false){
    const user=UI.ME;
    if(!user||DB.mode==='demo')return;
    if(pollUser!==user){pollUser=user;checkedAt=0;unread=0;pending=false;}
    if(pending||(!force&&Date.now()-checkedAt<60000)){paintBadge();return;}
    pending=true;checkedAt=Date.now();
    try{
      const result=await DB.t('crm_social_notices').select('id',{count:'exact',head:true})
        .eq('recipient_id',user.id).is('read_at',null).is('cancelled_at',null);
      if(user!==UI.ME)return;
      unread=result.error?0:result.count||0;
      paintBadge();
    }finally{if(pollUser===user)pending=false;}
  }
  UI.showDailyClaims=async()=>{
    const nodes=[...document.querySelectorAll('[data-daily-claim]')];
    if(!nodes.length||DB.mode==='demo')return;
    try{
      const remaining=await rpc('crm_daily_claim_remaining');
      if(!Number.isInteger(remaining))return;
      for(const node of nodes)if(node.isConnected)
        node.textContent='今日还可自领 '+remaining+'／30 家（北京时间，各公海合计）。';
    }catch{/* The displayed policy remains visible. */}
  };
  UI.sendSocialNotice=lead=>{
    if(!lead?.assignee_id)return UI.toast('请先分配这家社媒客户',true);
    const nonce=crypto.randomUUID();
    UI.modal(`<h2>发送社媒客户备注／提醒</h2><p><b>${esc(lead.data.company_name)}</b> · 收件人 ${esc(UI.userName(lead.assignee_id))}</p>
    <form><label>跟进备注<textarea name="body" maxlength="2000" required rows="5" placeholder="例如：客户想先看两款格栅色卡，请核对工程数量后再报价"></textarea></label>
    <label>提醒时间（北京时间，留空立即送达）<input name="at" type="datetime-local"></label>
    <p class="muted small">通过 CRM 站内发送。预约提醒到点后出现在业务员的未读提醒中。</p><button class="primary">发送站内备注／提醒</button><p role="status"></p></form>`,(modal,close)=>{
      const form=modal.querySelector('form'), button=form.querySelector('button');
      form.onsubmit=async e=>{
        e.preventDefault();button.disabled=true;
        const body=form.elements.body.value.trim(), at=form.elements.at.value;
        try{
          await rpc('crm_social_send_notice',{p_lead:lead.id,p_version:lead.version,p_body:body,p_remind_at:at?at+':00+08:00':null,p_nonce:nonce});
          close();UI.toast(at?'站内提醒已安排':'站内备注已发送');
        }catch(err){form.querySelector('[role=status]').textContent=err.message;button.disabled=false;}
      };
    });
  };
  UI.openSocialInbox=async()=>{
    const user=UI.ME;
    if(DB.mode==='demo')return UI.toast('演示环境没有正式提醒');
    try{
      let query=DB.t('crm_social_notices').select('id,lead_id,company_name,sender_id,recipient_id,body,remind_at,read_at,cancelled_at')
        .order('remind_at',{ascending:false}).limit(50);
      if(UI.isSocialOperator)query=query.eq('sender_id',user.id);
      else if(user.username!=='boss')query=query.eq('recipient_id',user.id);
      const items=DB.chk(await query);
      if(user!==UI.ME)return;
      UI.modal(`<h2>社媒客户备注与提醒</h2><p>${UI.isSocialOperator?'我的发送记录':'站内备注、到期提醒和阅读状态'}</p>${items.map(item=>`<article class="card pad"><b>${esc(item.company_name)}</b>
      <p>${esc(UI.userName(item.sender_id))} → ${esc(UI.userName(item.recipient_id))} · ${esc(date(item.remind_at))} · ${item.cancelled_at?'已取消':item.read_at?'已读':Date.parse(item.remind_at)>Date.now()?'待提醒':'未读'}</p>
      <p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(item.body)}</p><div class="actions">
      ${item.lead_id?`<button type="button" class="ghost sm" data-social-open="${esc(item.lead_id)}">打开客户</button>`:''}
      ${item.recipient_id===user.id&&!item.read_at?`<button type="button" class="primary sm" data-social-ack="${esc(item.id)}">标记已读</button>`:''}
      </div></article>`).join('')||'<p>暂无站内备注或提醒。</p>'}`,(modal,close)=>{
        modal.querySelectorAll('[data-social-open]').forEach(button=>button.onclick=()=>{
          const id=button.dataset.socialOpen, route='#/social/'+id;
          close();
          if(location.hash===route)UI.openSocialLeadFromNotice?.(id);else location.hash=route;
        });
        modal.querySelectorAll('[data-social-ack]').forEach(button=>button.onclick=async()=>{
          button.disabled=true;
          try{await rpc('crm_social_ack_notice',{p_id:button.dataset.socialAck});close();poll(true).catch(()=>{});await UI.openSocialInbox();}
          catch(e){UI.toast(e.message,true);button.disabled=false;}
        });
      });
    }catch(e){UI.toast(e.message,true);}
  };
  const bind=UI.bindShell;
  UI.bindShell=()=>{bind();poll().catch(()=>{});};
  setInterval(()=>{if(!document.hidden)poll().catch(()=>{});},60000);
})();