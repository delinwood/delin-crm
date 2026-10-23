/* Two lead pools. Ownership transitions are authorized atomically by PostgreSQL. */
(function () {
  const { esc, opt, $, $$ } = UI;
  const originalList = DB.listClients.bind(DB), originalClaim = DB.claimClient.bind(DB);
  let metadata = new Map(), filter = '', page = 0, selected = new Set();
  const all = async table => {
    const rows = [];
    for (let from=0;;from+=1000) {
      const part = DB.chk(await DB.t(table).select('*').order('client_id').range(from,from+999));
      rows.push(...part); if (part.length<1000) return rows;
    }
  };
  DB.listClients = async () => {
    const clients = await originalList();
    const rows = DB.mode === 'demo' ? Object.values(DB.load().pool_metadata || {}) : await all('crm_pool_metadata');
    metadata = new Map(rows.map(x => [x.client_id,x]));
    return clients.map(c => ({...c,...(metadata.get(c.id)||{}),id:c.id}));
  };
  DB.releaseClient = async (id, reason) => {
    if (DB.mode !== 'demo') return DB.chk(await DB.init().rpc('release_client',{p_client_id:id,p_reason:reason}));
    const c=await DB.getClient(id), me=DB.me();
    if (!me?.active || !c.owner_id || (me.role!=='admin' && c.owner_id!==me.id)) throw new Error('只能退回自己负责的客户');
    if (UI.isInvalid(c)) throw new Error('无效客户请保留在无效客户组，由老板审查');
    if (reason.trim().length<2 || reason.length>2000) throw new Error('请填写2至2000字的退回原因');
    const db=DB.load(); db.pool_metadata ||= {}; db.pool_events ||= [];
    db.pool_metadata[id]={client_id:id,pool_kind:'secondary',return_reason:reason.trim(),previous_owner:c.owner_id,returned_at:new Date().toISOString()};
    db.pool_events.push({client_id:id,company_name:c.company_name,action:'release',actor_id:me.id,previous_owner:c.owner_id,reason:reason.trim(),at:new Date().toISOString()});
    Object.assign(db.clients.find(x=>x.id===id),{owner_id:null,next_follow_up:null,updated_at:new Date().toISOString()}); DB.save();
  };
  DB.claimClient = async id => {
    const r=await originalClaim(id);
    if (DB.mode==='demo') { const db=DB.load(); db.pool_events ||= []; db.pool_events.push({client_id:id,company_name:r.company_name,action:'claim',actor_id:DB.me().id,at:new Date().toISOString()}); DB.save(); }
    return r;
  };
  async function history(id) {
    try {
      const rows=DB.mode==='demo' ? (DB.load().pool_events||[]).filter(x=>x.client_id===id).reverse() : DB.chk(await DB.t('crm_pool_events').select('*').eq('client_id',id).order('at',{ascending:false}).limit(100));
      UI.modal(`<h2>领取 / 退回记录</h2><ul class="timeline">${rows.map(x=>`<li>${esc(new Date(x.at).toLocaleString('zh-CN'))} · ${esc(UI.userName(x.actor_id))} · ${x.action==='claim'?'领取':'退回第二公海'}<p>${esc(x.reason||'')}</p></li>`).join('')||'<li>暂无记录</li>'}</ul>`);
    } catch(e) { UI.toast(e.message,1); }
  }
  async function release(c) {
    UI.modal(`<h2>退回第二公海</h2><p>${esc(c.company_name)}。原有资料和跟进历史会保留，原自动邮件停止；已提交给Gmail的邮件无法撤回。</p><form id="releaseLead"><label>退回原因<textarea name="reason" minlength="2" maxlength="2000" required placeholder="说明为何不再跟进，供其他业务员和老板审查"></textarea></label><button class="primary">确认退回</button><p role="status"></p></form>`,(modal,close)=>{
      const form=modal.querySelector('form'); form.onsubmit=async e=>{e.preventDefault(); const b=form.querySelector('button'); b.disabled=true;
        try { await DB.releaseClient(c.id,form.reason.value); close(); await UI.refresh(); location.hash='#/second-pool'; await UI.route(); UI.toast('已退回第二公海，原自动计划已停止'); }
        catch(e) {form.querySelector('[role=status]').textContent=e.message; b.disabled=false;}
      };
    });
  }
  async function pool(kind='initial') {
    const admin=UI.ME.role==='admin', secondary=kind==='secondary';
    const available=UI.CLIENTS.filter(c=>!c.owner_id&&!UI.isInvalid(c));
    const base=available.filter(c=>(c.pool_kind||'initial')===kind);
    const list=base.filter(c=>[c.company_name,c.country,c.city,...(c.products||[]),c.return_reason].join(' ').toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>(b.returned_at||b.created_at||'').localeCompare(a.returned_at||a.created_at||''));
    page=Math.min(page,Math.max(0,Math.ceil(list.length/50)-1));
    selected=new Set([...selected].filter(id=>list.some(c=>c.id===id)));
    UI.render(`<div class="pagehead"><h1>${secondary?'第二公海 · 退回客户':'公海 · 新线索'} <small>${list.length} 家</small></h1><div class="actions"><a class="btn ${secondary?'ghost':'primary'}" href="#/pool">公海 ${available.filter(c=>(c.pool_kind||'initial')==='initial').length}</a><a class="btn ${secondary?'primary':'ghost'}" href="#/second-pool">第二公海 ${available.filter(c=>c.pool_kind==='secondary').length}</a><button class="ghost" id="poolRefresh">刷新</button></div></div>
      <section class="card pad"><p>${secondary?'这里是业务员主动退回的客户，可查看原因后重新领取。':'这里是尚未分配的客户，可领取后开始跟进。'} 无效客户留在无效客户组。领取采用服务器锁定，先领取成功者获得归属。</p><label>搜索公司、国家、产品或退回原因<input id="poolSearch" value="${esc(filter)}"></label>
      ${admin?`<div class="inl"><b>已选 ${selected.size}</b><button class="ghost sm" id="poolAll">选择当前筛选全部</button><select id="poolOwner">${opt('','分配给…','')}${UI.USERS.filter(u=>u.active).map(u=>opt(u.id,u.full_name,'')).join('')}</select><button class="primary sm" id="poolAssign">分配所选</button></div>`:''}</section>
      <section class="card tbl"><table><thead><tr>${admin?'<th>选择</th>':''}<th>公司</th><th>国家 / 城市</th><th>产品</th>${secondary?'<th>退回说明</th>':''}<th>操作</th></tr></thead><tbody>${list.slice(page*50,page*50+50).map(c=>`<tr>${admin?`<td><input type="checkbox" data-pool-select="${esc(c.id)}" ${selected.has(c.id)?'checked':''}></td>`:''}<td><a href="#/client/${esc(c.id)}">${esc(c.company_name)}</a><p class="muted small">${esc(U.domain(c.website))}</p></td><td>${esc([c.country,c.city].filter(Boolean).join(' / '))}</td><td>${UI.chips(c.products)}</td>${secondary?`<td>${esc(c.return_reason)}<p class="muted small">${esc(UI.userName(c.previous_owner))} · ${esc((c.returned_at||'').slice(0,10))}</p></td>`:''}<td>${!admin?`<button class="primary sm" data-pool-claim="${esc(c.id)}">领取为我的客户</button>`:''}<button class="ghost sm" data-pool-history="${esc(c.id)}">流转记录</button></td></tr>`).join('')||'<tr><td colspan="6">暂无符合条件的客户</td></tr>'}</tbody></table></section>
      <div class="actions"><button class="ghost" id="poolPrev" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${Math.max(1,Math.ceil(list.length/50))}</span><button class="ghost" id="poolNext" ${(page+1)*50>=list.length?'disabled':''}>下一页</button></div>`,secondary?'second-pool':'pool');
    $('#poolSearch').onchange=e=>{filter=e.target.value;page=0;pool(kind);};
    $('#poolRefresh').onclick=async()=>{await UI.refresh();pool(kind);};
    $('#poolPrev').onclick=()=>{page--;pool(kind);}; $('#poolNext').onclick=()=>{page++;pool(kind);};
    $$('[data-pool-history]').forEach(b=>b.onclick=()=>history(b.dataset.poolHistory));
    $$('[data-pool-claim]').forEach(b=>b.onclick=async()=>{b.disabled=true;try {await DB.claimClient(b.dataset.poolClaim);await UI.refresh();await pool(kind);UI.toast('领取成功，可在客户列表查看');}catch(e){UI.toast(e.message,1);await UI.refresh();await pool(kind);}});
    if(admin){
      $$('[data-pool-select]').forEach(b=>b.onchange=()=>{b.checked?selected.add(b.dataset.poolSelect):selected.delete(b.dataset.poolSelect);});
      $('#poolAll').onclick=()=>{list.forEach(c=>selected.add(c.id));pool(kind);};
      $('#poolAssign').onclick=async()=>{const owner=$('#poolOwner').value;if(!owner||!selected.size)return UI.toast('请选择客户和负责人',1);try{await DB.bulkUpdate([...selected],{owner_id:owner});selected.clear();await UI.refresh();pool(kind);UI.toast('已分配');}catch(e){UI.toast(e.message,1);}};
    }
  }
  UI.views.pool={render:()=>pool('initial')}; UI.views['second-pool']={render:()=>pool('secondary')};
  const shell=UI.shell;
  UI.shell=(inner,active)=>shell(inner,active).replace(/(<a href="#\/pool"[^>]*>[\s\S]*?<\/a>)/,`$1<a href="#/second-pool" class="${active==='second-pool'?'on':''}">第二公海 <small>Returned</small></a>`);
  const detail=UI.views.client.render;
  UI.views.client.render=async id=>{await detail(id);const c=UI.CLIENTS.find(x=>x.id===id),target=document.querySelector('.hero .quick');if(!c||!target)return;
    if(c.owner_id&&(UI.ME.role==='admin'||c.owner_id===UI.ME.id)&&!UI.isInvalid(c)){const b=document.createElement('button');b.className='btn ghost';b.textContent='退回第二公海';b.onclick=()=>release(c);target.append(b);}
    const b=document.createElement('button');b.className='btn ghost';b.textContent='领取 / 退回记录';b.onclick=()=>history(id);target.append(b);
  };
})();
