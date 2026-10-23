(function () {
  const { esc, $, $$ } = UI;
  const kinds = { reply: '客户回复', auto_reply: '自动回复（不计有效回复）', permanent_bounce: '疑似永久退信', temporary_bounce: '临时退信', review: '关联待核实', ignored: '已忽略' };
  const fmt = s => s ? new Date(s).toLocaleString() : '尚未同步';
  const api = async (action, data = {}) => {
    if (DB.mode === 'demo') throw new Error('演示模式不读取邮箱');
    const r = await DB.init().functions.invoke('crm-mail', { body: { action, ...data } });
    if (r.error) { let message = '邮件服务暂不可用'; try { message = (await r.error.context.json()).error || message; } catch {} throw new Error(message); }
    if (r.data?.error) throw new Error(r.data.error); return r.data;
  };
  async function connectRead(status) {
    if (!status.read_available) { UI.toast('尚未开启读取权限：需要先完成隐私说明及Google权限配置', 1); return; }
    UI.modal(`<h2>启用客户邮件同步</h2><p>Google 的“读取 Gmail”权限在技术上允许读取此邮箱的邮件。系统先检查邮件标头，核对 CRM 发信引用及客户权限后读取关联正文。对于标准投递状态报告，可能需要先读取报告内容才能查找原始发信标识；未匹配的报告内容不保存到客户档案。关联内容保存到 Supabase。</p><p>相关邮件可由当前客户负责人及老板审查。客户真实回复后停止该公司的自动跟进；自动回复不计有效回复；退信先暂停并等待核实。</p><p>此功能不修改或删除 Gmail 邮件，不向资料搜索服务发送邮箱内容。<a href="https://www.ddllwood.com/delin-crm-mail.html" target="_blank" rel="noopener noreferrer">查看公司隐私说明</a></p><form><label class="inl"><input name="readConsent" type="checkbox" required>我理解读取范围和保存方式，同意前往 Google 授权</label><label class="inl"><input name="seed" type="checkbox">同时查找最近7天与 CRM 发信关联的来信（不选则从本次授权后开始）</label><p class="muted small">Google 可能显示未经验证提示或要求审核；如必须付费，不会自动开通。</p><div class="actions"><button type="button" class="ghost" data-close>取消</button><button class="primary">前往 Google 授权</button></div></form>`, (modal, close) => {
      modal.querySelector('[data-close]').onclick = close;
      modal.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = e.currentTarget; if (!f.elements.readConsent.checked) return;
        const button = f.querySelector('button.primary'); button.disabled = true;
        try { const r = await api('connect', { enable_read: true, confirm_read: true, seed_days: f.elements.seed.checked ? 7 : 0 }); location.assign(r.url); }
        catch (error) { UI.toast(error.message, 1); button.disabled = false; }
      };
    });
  }
  async function review(row) {
    UI.modal(`<h2>审查关联来信</h2><p>${esc(kinds[row.kind] || row.kind)} · ${esc(row.from_email)} · ${esc(fmt(row.received_at))}</p><h3>${esc(row.subject)}</h3><pre style="white-space:pre-wrap;max-height:35vh;overflow:auto">${esc(row.body)}</pre><p class="muted small">只根据已核实内容选择。确认永久退信会禁止此地址的后续开发邮件；忽略不会恢复已经停止或暂停的计划。</p><form><label>处理方式<select name="decision"><option value="reply">确认是客户真实回复，并停止自动跟进</option><option value="permanent_bounce">确认永久退信，禁止再次联系此邮箱</option><option value="temporary_bounce">临时问题，暂停并人工跟进</option><option value="ignored">忽略此来信 / 解除本条退信待审限制</option></select></label><label>核实依据<textarea name="note" required minlength="2" maxlength="2000" rows="3"></textarea></label><div class="actions"><button type="button" class="ghost" data-close>取消</button><button class="primary">保存审查结果</button></div></form>`, (modal, close) => {
      modal.querySelector('[data-close]').onclick = close;
      modal.querySelector('form').elements.decision.value = ['reply','permanent_bounce','temporary_bounce','ignored'].includes(row.kind) ? row.kind : 'ignored';
      modal.querySelector('form').onsubmit = async e => { e.preventDefault(); const f=e.currentTarget, btn=f.querySelector('button.primary'); btn.disabled=true;
        try { await UI.BUSINESS.rpc('crm_review_inbound', { p_id: row.id, p_decision: f.elements.decision.value, p_note: f.elements.note.value.trim() }); close(); UI.toast('审查已保存；不会自动恢复旧计划'); await render(); }
        catch(error) { UI.toast(error.message,1); btn.disabled=false; }
      };
    });
  }
  async function render() {
    if (DB.mode === 'demo') { UI.render('<div class="pagehead"><h1>客户回复 / 退信</h1></div><section class="card pad">演示模式不访问真实邮箱。<a href="#/mail">返回邮件中心</a></section>','mail'); return; }
    let status={}, error='', rows=[];
    try { status=await api('status'); const r=await DB.init().from('crm_mail_inbound').select('*').order('received_at',{ascending:false}).limit(100);if(r.error)throw r.error;rows=r.data||[]; } catch(e) { error=e.message; }
    const a=status.account;
    UI.render(`<div class="pagehead"><h1>客户回复 / 退信同步</h1><a class="btn ghost" href="#/mail">邮件中心</a></div>${error?`<p class="warn">${esc(error)}</p>`:''}<section class="card pad"><h2>我的邮箱同步</h2><p>${esc(a?.email||'尚未连接Gmail')} · ${a?.read_enabled?'已开启关联来信同步':'未开启读取，不影响发信'}</p><p>上次同步：${esc(fmt(a?.read_last_sync_at))}${a?.read_since?` · 同步起点 ${esc(fmt(a.read_since))}`:''}</p>${a?.read_error?`<p class="warn">${esc(a.read_error)}</p>`:''}${a?.read_gap_at?`<p class="warn">${esc(fmt(a.read_gap_at))} 发生 Gmail 历史游标失效，已重新扫描最近7天可用范围；更早的遗漏请在Gmail人工核对。</p>`:''}<div class="actions">${a?.read_enabled?'<button class="primary" id="syncNow">立即同步</button><button class="ghost" id="syncRetry">重试失败项</button><button class="ghost" id="syncDisable">停止读取同步</button>':`<button class="primary" id="syncEnable" ${!status.read_available?'disabled':''}>启用并授权读取</button>`}</div>${!status.read_available?'<p class="warn">读取功能等待隐私说明和 Google 权限配置完成。现在没有读取你的邮箱。</p>':''}<p class="muted small">后台按分钟轮询，繁忙时分批同步，不能保证即时或完整识别所有回复。只关联本系统发送邮件的 Message-ID，不支持任意旧邮件自动归档；不显示打开率或垃圾箱判断。</p></section><section class="card pad"><h2>关联来信 ${rows.length}${rows.length===100?'（最新100条）':''}</h2><p class="muted small">按当前客户权限显示；老板可审查团队记录。自动回复不会算有效回复。退信自动暂停，确认永久退信后才加入禁止联系名单。</p><label>筛选<select id="inboundFilter"><option value="">全部</option><option value="review">待审查（含退信）</option><option value="reply">客户回复</option><option value="auto_reply">自动回复</option></select></label><div id="inboundRows"></div></section>`,'mail');
    const draw=()=> { const filter=$('#inboundFilter').value; const chosen=rows.filter(r=>filter==='review'?['review','permanent_bounce','temporary_bounce'].includes(r.kind)&&!r.reviewed_at:!filter||r.kind===filter);
      $('#inboundRows').innerHTML=chosen.map(r=>`<article class="card pad" style="margin:12px 0"><b>${esc(kinds[r.kind]||r.kind)}${r.reviewed_at?' · 已人工审查':''}</b><p><a href="#/business/${esc(r.client_id)}">${esc(UI.CLIENTS.find(c=>c.id===r.client_id)?.company_name||'客户业务档案')}</a> · ${esc(UI.userName(r.sender_id))} · ${esc(fmt(r.received_at))}</p><p>${esc(r.from_email)} · ${esc(r.subject)}</p><details><summary>查看内容</summary><pre style="white-space:pre-wrap">${esc(r.body)}</pre>${r.review_note?`<p>审查：${esc(r.review_note)}</p>`:''}</details><button class="ghost sm" data-inbound="${esc(r.id)}">核实 / 标记</button></article>`).join('')||'<p class="muted">暂无对应来信</p>';
      $$('[data-inbound]').forEach(btn=>btn.onclick=()=>review(rows.find(r=>r.id===btn.dataset.inbound)));
    }; $('#inboundFilter').onchange=draw;draw();
    if($('#syncEnable'))$('#syncEnable').onclick=()=>connectRead(status);
    if($('#syncNow'))$('#syncNow').onclick=async()=>{const btn=$('#syncNow');btn.disabled=true;try{await api('sync');await render();}catch(e){UI.toast(e.message,1);btn.disabled=false;}};
    if($('#syncRetry'))$('#syncRetry').onclick=async()=>{try{await api('sync-retry');UI.toast('失败项已重新排队，后台稍后处理');await render();}catch(e){UI.toast(e.message,1);}};
    if($('#syncDisable'))$('#syncDisable').onclick=async()=>{if(!confirm('停止系统后续读取（已发出的请求可能仍会完成），保留已关联记录？这不会撤销Google授权；如要彻底撤销，请在Google账号移除此应用后重新连接仅发信权限。'))return;try{await api('read-disable');await render();}catch(e){UI.toast(e.message,1);}};
  }
  UI.views.inbound={render};
})();
