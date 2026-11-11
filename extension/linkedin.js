/* One button on the LinkedIn profile the user is viewing. Reads that page only after the click. */
(function () {
  if (window.top !== window) return;
  const host = document.createElement('div');
  host.id = 'delin-crm-save';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}.wrap{position:fixed;z-index:2147483646;right:16px;bottom:16px;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1b2433}.launch{background:#0f9d8f;color:#fff;border:0;border-radius:999px;padding:10px 14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2)}.panel{width:min(380px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 96px));overflow:auto;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(20,40,75,.28);padding:14px;margin-bottom:8px}h2{font-size:16px;margin:0 0 6px}label{display:block;font-size:12px;color:#6b7686;margin-top:8px}input{width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid #e3e8ef;border-radius:8px;font:inherit}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;cursor:pointer}.primary{background:#0f9d8f;color:#fff;border:0;border-radius:8px;padding:8px 12px}.ghost{background:#fff;border:1px solid #e3e8ef;border-radius:8px;padding:8px 12px}.muted{color:#6b7686;font-size:12px;line-height:1.5}.err{color:#c2392b}.ok{color:#0c8578}.match{border:1px solid #e3e8ef;border-radius:8px;padding:8px;margin-top:8px}a{color:#1d3a6b}`;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.type = 'button';
  launch.textContent = '存入 CRM';
  wrap.append(panel, launch);
  shadow.append(style, wrap);
  document.documentElement.append(host);

  const call = message => chrome.runtime.sendMessage(message).then(response => {
    if (!response?.ok) throw new Error(response?.error || '扩展没有响应');
    return response.result;
  });
  const field = (name, label, value, type) => {
    const box = document.createElement('label');
    box.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.type = type || 'text';
    input.value = value || '';
    input.autocomplete = 'off';
    box.append(input);
    return box;
  };
  const button = (className, text) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = text;
    return el;
  };
  const status = document.createElement('p');
  status.className = 'muted';
  let draft = null;
  let found = null;

  function values() {
    const data = { ...draft };
    panel.querySelectorAll('input[name]').forEach(input => { data[input.name] = input.value; });
    data.url = data.linkedin;
    return CRM_SAVE.visiblePerson(data);
  }
  function showStatus(text, kind) {
    status.className = kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : 'muted';
    status.textContent = text;
  }
  function choiceLine(match) {
    const line = document.createElement('label');
    line.className = 'match';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'dest';
    const claim = match.pool && !match.writable;
    input.value = (claim ? 'claim:' : 'attach:') + match.client_id;
    line.append(input, document.createTextNode(' ' + (claim ? '领取公海客户并保存：' : '保存到已有客户：') + (match.company_name || '未显示公司名') + ' · ' + (match.owner_name || '') + ' · ' + (match.match || '')));
    return line;
  }
  function render(user) {
    panel.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = '存入 Delin CRM';
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = '只保存这一页上已经显示、或你在下面亲手填写的内容。不会搜索隐藏邮箱或电话，不会自动加好友，也不会发消息。';
    panel.append(title, hint);
    if (!user) {
      panel.append(field('username', 'CRM 用户名或邮箱', ''), field('password', '密码', '', 'password'));
      const row = document.createElement('div');
      row.className = 'row';
      const sync = button('ghost', '使用已打开的 CRM 登录');
      const sign = button('primary', '登录');
      row.append(sync, sign);
      panel.append(row, status);
      sync.onclick = async () => {
        showStatus('正在读取已打开的 CRM 页面…');
        try {
          const result = await call({ type: 'sync' });
          if (!result.user) return showStatus('没有找到已登录的 CRM 页面。请先在本浏览器打开并登录 CRM，或在这里输入账号。', 'err');
          render(result.user);
        } catch (error) { showStatus(error.message, 'err'); }
      };
      sign.onclick = async () => {
        const username = panel.querySelector('[name=username]').value;
        const password = panel.querySelector('[name=password]').value;
        showStatus('正在登录…');
        try { render(await call({ type: 'login', username, password })); }
        catch (error) { showStatus(error.message, 'err'); }
      };
      return;
    }
    const who = document.createElement('p');
    who.className = 'muted';
    who.textContent = '已登录：' + (user.full_name || user.username) + (user.role === 'admin' ? '（管理员，可新建到公海）' : '（新建进入我的客户）');
    panel.append(who,
      field('name', '姓名（页面上看到的）', draft.name),
      field('title', '职位 / 头衔', draft.title),
      field('company', '公司', draft.company),
      field('location', '地点', draft.location && typeof draft.location === 'object' ? draft.location.raw : (draft.location || '')),
      field('linkedin', 'LinkedIn 链接', draft.linkedin),
      field('website', '网站（选填，只填页面上看到的）', draft.website, 'url'),
      field('email', '邮箱（选填，不自动查找）', draft.email, 'email'),
      field('phone', '电话（选填）', draft.phone),
      field('whatsapp', 'WhatsApp（选填）', draft.whatsapp));
    const row = document.createElement('div');
    row.className = 'row';
    const check = button('primary', '查重');
    const out = button('ghost', '退出登录');
    row.append(check, out);
    const choices = document.createElement('div');
    panel.append(row, choices, status);
    out.onclick = async () => { await call({ type: 'logout' }); found = null; render(null); };
    check.onclick = async () => {
      showStatus('正在对照 CRM…');
      choices.replaceChildren();
      try {
        found = await call({ type: 'match', person: values() });
        draft = found.person;
        if (found.notice) {
          const note = document.createElement('p');
          note.className = 'muted';
          note.textContent = found.notice;
          choices.append(note);
        }
        found.plan.hidden.forEach(match => {
          const line = document.createElement('p');
          line.className = 'err';
          line.textContent = '已有相同客户，归属 ' + (match.owner_name || '其他负责人') + '（' + (match.match || '') + '）。不能查看详情，也不能重复新建。';
          choices.append(line);
        });
        found.plan.visible.forEach(match => choices.append(choiceLine(match)));
        if (found.plan.canCreate) {
          const mine = document.createElement('label');
          mine.className = 'match';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'dest';
          input.value = 'create';
          mine.append(input, document.createTextNode(' 新建到我的客户'));
          choices.append(mine);
          if (found.plan.createPool) {
            const pool = document.createElement('label');
            pool.className = 'match';
            const poolInput = document.createElement('input');
            poolInput.type = 'radio';
            poolInput.name = 'dest';
            poolInput.value = 'create-pool';
            pool.append(poolInput, document.createTextNode(' 新建到公海（仅管理员，与现有导入规则一致）'));
            choices.append(pool);
          }
        }
        if (choices.querySelector('input[name=dest]')) {
          const save = button('primary', '确认保存');
          save.style.marginTop = '8px';
          choices.append(save);
          save.onclick = () => confirmSave(save);
        }
        showStatus(found.plan.canCreate || found.plan.visible.length ? (found.matches.length ? '请选择要保存到的客户。' : '没有发现重复，可以新建。') : '已有相同客户，当前账号不能重复新建。');
      } catch (error) { showStatus(error.message, 'err'); }
    };
  }
  async function confirmSave(save) {
    const selected = panel.querySelector('input[name=dest]:checked');
    if (!selected) return showStatus('请先选择新建，或选择一家已有客户。', 'err');
    save.disabled = true;
    showStatus('正在保存…');
    try {
      const [action, clientId] = selected.value.split(':');
      const result = await call({
        type: 'save',
        person: values(),
        action: action === 'create-pool' ? 'create' : action,
        pool: action === 'create-pool',
        clientId: clientId || ''
      });
      const done = document.createElement('p');
      done.className = 'ok';
      done.textContent = result.duplicateContact ? '这位联系人已经在该客户下。' : result.created ? '已新建客户。' : '已保存到已有客户。';
      const link = document.createElement('a');
      link.href = result.client;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '打开 CRM 客户';
      const business = document.createElement('a');
      business.href = result.business;
      business.target = '_blank';
      business.rel = 'noopener noreferrer';
      business.textContent = '打开业务档案';
      const links = document.createElement('p');
      links.append(link, document.createTextNode(' · '), business);
      panel.append(done, links);
      showStatus('保存完成。', 'ok');
    } catch (error) { showStatus(error.message, 'err'); save.disabled = false; }
  }
  async function openPanel() {
    draft = CRM_SAVE.readPage(document, location.href);
    panel.hidden = false;
    showStatus(draft.linkedin ? '请核对页面上的内容，空着的电话和邮箱不会被自动补上。' : '没有识别到个人或公司主页链接。请确认这是一个 LinkedIn 主页。', draft.linkedin ? '' : 'err');
    try {
      const result = await call({ type: 'status' });
      render(result.user);
    } catch (error) { render(null); showStatus(error.message, 'err'); }
  }
  function place() {
    const on = /^\/(in|company)\/[^/]+/.test(location.pathname);
    wrap.hidden = !on;
    if (!on) panel.hidden = true;
  }
  launch.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (panel.hidden) openPanel();
    else panel.hidden = true;
  });
  place();
  setInterval(place, 1000);
})();
