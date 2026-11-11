/* Middle East / WhatsApp reach checklist. Opens wa.me only; it does not call WhatsApp Business API. */
(function () {
  const { esc, $, $$ } = UI;
  const missing = c => [!c.whatsapp && 'WhatsApp 号码', !c.timezone && (C.middleEast(c.country) || c.reach_channel === 'whatsapp') && '时区', !c.contact_name && '默认联系人'].filter(Boolean);
  const canLog = c => !!(c && UI.ME && UI.ME.role === 'sales' && c.owner_id === UI.ME.id && !UI.isInvalid(c) && c.status !== '无效');
  const relevant = c => !!(c && !UI.isInvalid(c) && c.owner_id && (c.reach_channel === 'whatsapp' || C.middleEast(c.country) || c.whatsapp || c.whatsapp_next_on));
  async function save(c, note, next, sync) {
    if (DB.mode === 'demo') {
      if (note) await DB.addLog(c.id, { entry_date: UI.today(), channel: 'whatsapp', content: 'WhatsApp：' + note, next_follow_up: sync && next ? next : c.next_follow_up, status: c.status === '未联系' ? '已联系' : undefined });
      else if (sync && next) await DB.updateClient(c.id, { next_follow_up: next });
      const db = DB.load(); db.client_tracking = db.client_tracking || {};
      const row = db.client_tracking[c.id] || { client_id: c.id, reminder_owner_id: c.owner_id };
      if (note) row.whatsapp_touch_at = new Date().toISOString();
      if (next) row.whatsapp_next_on = next;
      db.client_tracking[c.id] = row; DB.save();
      return;
    }
    DB.chk(await DB.init().rpc('crm_log_whatsapp_touch', { p_client: c.id, p_note: note, p_next: next, p_sync: !!sync }));
  }
  function dialog(c, planOnly) {
    const local = UI.localTime(c);
    UI.modal(`<h2>${planOnly ? '安排下次 WhatsApp' : '登记本次 WhatsApp'}</h2><p>${esc(c.company_name)} · ${esc(c.contact_name || '未填默认联系人')} · ${local ? '当地 ' + esc(local.text) + (local.work ? '（工作时间）' : '（非工作时间）') : '时区未设置'}</p>
      <p class="muted small">只登记已经发生的沟通，或一个你自己要记得跟进的日期。CRM 不会替你发 WhatsApp。</p>
      <form>${planOnly ? '' : '<label>本次实际沟通<textarea name="note" required maxlength="2000" placeholder="发给谁、说了什么、对方怎么回"></textarea></label>'}
      <label>${planOnly ? '下次联系日期' : '下次 WhatsApp（可留空）'}<input type="date" name="next" ${planOnly ? 'required' : ''} min="${UI.today()}" value="${esc(c.whatsapp_next_on || '')}"></label>
      <label class="inl"><input type="checkbox" name="sync" ${c.next_follow_up ? '' : 'checked'}>同时写入客户的下次跟进</label>
      <p role="status" class="err"></p><button class="primary">保存</button></form>`, (modal, close) => {
      const form = modal.querySelector('form');
      form.onsubmit = async event => {
        event.preventDefault();
        const note = planOnly ? null : form.elements.note.value.trim();
        const next = form.elements.next.value || null;
        if (!planOnly && !note) return;
        if (planOnly && !next) return;
        const button = form.querySelector('button'); button.disabled = true;
        try { await save(c, note, next, form.elements.sync.checked); }
        catch (error) { form.querySelector('[role=status]').textContent = error.message; button.disabled = false; return; }
        close(); UI.toast(planOnly ? '已安排下次 WhatsApp' : '已登记 WhatsApp');
        try { await UI.refresh(); await UI.route(); } catch (error) { UI.toast(error.message, 1); }
      };
    });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-wa-log],[data-wa-plan],[data-wa-edit]');
    if (!button) return;
    if (button.dataset.waEdit) {
      if (location.hash === '#/client/' + button.dataset.waEdit && $('#edit')) $('#edit').click();
      else location.hash = '#/client/' + button.dataset.waEdit;
      return;
    }
    const c = UI.CLIENTS.find(row => row.id === (button.dataset.waLog || button.dataset.waPlan));
    if (!c || !canLog(c)) return;
    dialog(c, !!button.dataset.waPlan);
  });
  UI.whatsappCard = c => {
    const gaps = missing(c), local = UI.localTime(c), wa = UI.wa(c.whatsapp, c);
    if (!(C.middleEast(c.country) || c.reach_channel === 'whatsapp' || c.whatsapp)) return '';
    return `<section class="card pad"><div class="sec-h"><h2>WhatsApp 触达</h2><a href="#/whatsapp">全部待联系</a></div>
      <p>先确认号码、时区和默认联系人，在对方当地工作时间打开 WhatsApp，发完后登记本次沟通和下次跟进。不连接 WhatsApp 接口，也不会自动发消息。</p>
      ${gaps.length ? `<p class="warn">建议补齐：${esc(gaps.join('、'))}。已有客户缺少这些资料时，仍可保存其他修改。</p>` : '<p>号码、时区和默认联系人已填写。</p>'}
      <p>默认联系人 <b>${esc(c.contact_name || '未填写')}</b>${c.contact_title ? ' · ' + esc(c.contact_title) : ''} · ${esc(c.whatsapp || '未填 WhatsApp')} · ${esc(c.timezone || (local ? local.tz + '（按国家推断）' : '时区未设置'))}</p>
      <p>上次 WhatsApp：${esc(c.whatsapp_touch_at ? new Date(c.whatsapp_touch_at).toLocaleString('zh-CN') : '尚未登记')} · 下次：${c.whatsapp_next_on ? UI.dueBadge(c.whatsapp_next_on) : '<span class="muted">未安排</span>'}</p>
      <div class="actions">${wa ? UI.link(wa, '💬 打开 WhatsApp', 'btn primary') : ''}<button class="ghost" type="button" data-wa-edit="${esc(c.id)}">编辑资料</button><a class="btn ghost" href="#/business/${esc(c.id)}">多位联系人</a></div>${UI.outboundBar(c, 'go')}<div class="actions">
      ${canLog(c) ? `<button class="ghost" type="button" data-wa-log="${esc(c.id)}">登记本次 WhatsApp</button><button class="ghost" type="button" data-wa-plan="${esc(c.id)}">安排下次</button>` : ''}</div></section>`;
  };
  async function page() {
    const today = UI.today();
    const mine = UI.CLIENTS.filter(c => (UI.ME.role === 'admin' || c.owner_id === UI.ME.id) && relevant(c));
    const due = mine.filter(c => C.whatsappDue(c, today));
    const needs = mine.filter(c => C.whatsappNeedsPlan(c));
    const gaps = mine.filter(c => missing(c).length && (C.middleEast(c.country) || c.reach_channel === 'whatsapp'));
    const row = c => `<article class="card pad"><b><a href="#/client/${esc(c.id)}">${esc(c.company_name)}</a></b> ${UI.ltBadge(c)} ${UI.ME.role === 'admin' ? '· ' + esc(UI.userName(c.owner_id)) : ''}
      <p>${esc(c.contact_name || '未填默认联系人')} · ${esc(c.whatsapp || '未填号码')} · ${esc([c.city, c.country].filter(Boolean).join(', '))}</p>
      <p>上次 ${esc(c.whatsapp_touch_at ? new Date(c.whatsapp_touch_at).toLocaleString('zh-CN') : '尚未登记')} · 下次 ${c.whatsapp_next_on ? UI.dueBadge(c.whatsapp_next_on) : '未安排'}${missing(c).length ? ' · 待补 ' + esc(missing(c).join('、')) : ''}</p>
      ${UI.outboundBar(c)}<div class="actions">${UI.wa(c.whatsapp, c) ? UI.link(UI.wa(c.whatsapp, c), '打开 WhatsApp', 'btn ghost sm') : ''}${canLog(c) ? `<button class="ghost sm" type="button" data-wa-log="${esc(c.id)}">登记本次</button><button class="ghost sm" type="button" data-wa-plan="${esc(c.id)}">安排下次</button>` : ''}</div></article>`;
    UI.render(`<div class="pagehead"><h1>WhatsApp 触达</h1><a class="btn ghost" href="#/home">工作台</a></div>
      <section class="card pad"><p>中东客户和首选 WhatsApp 的客户走同一条人工流程：补齐号码、时区、默认联系人，对方上班时再打开聊天，然后把本次沟通和下次日期记在 CRM。现有“打开 WhatsApp”仍然只跳到 wa.me。</p>
      <p class="muted small">到期 ${due.length} 家 · 已选 WhatsApp 但还没安排 ${needs.length} 家 · 资料未齐 ${gaps.length} 家。</p></section>
      <section class="card pad"><h2>到了该联系的日期</h2>${due.map(row).join('') || '<p class="muted">没有到期的 WhatsApp 跟进。</p>'}</section>
      <section class="card pad"><h2>已选 WhatsApp，还没登记</h2>${needs.map(row).join('') || '<p class="muted">没有待安排的客户。把客户的首选联系改成 WhatsApp 后，会出现在这里。</p>'}</section>
      <section class="card pad"><h2>中东或 WhatsApp 客户 · 资料提醒</h2><p class="muted small">旧客户可以继续使用。新建中东客户，或把首选联系改成 WhatsApp 时，客户表单会要求填写这三项。</p>${gaps.map(row).join('') || '<p class="muted">这些客户的号码、时区和默认联系人都已填写。</p>'}</section>`, 'mail');
  }
  UI.views.whatsapp = { render: page };
})();
