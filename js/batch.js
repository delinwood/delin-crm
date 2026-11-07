/* Shared selection and confirmation for customer lists. Each item uses its existing server permission check. */
(function () {
  const { esc, $, $$ } = UI;

  UI.batchTools = actions => `<div class="actions" data-batch-tools>
    <b data-batch-count>已选 0 条</b>
    <button type="button" class="ghost sm" data-batch-pick="page">选本页</button>
    <button type="button" class="ghost sm" data-batch-pick="all">全选筛选结果</button>
    <button type="button" class="ghost sm" data-batch-pick="clear">取消选择</button>
    ${actions}
  </div>`;

  UI.batchCheckbox = (id, label) => `<input type="checkbox" data-batch-select="${esc(id)}" aria-label="选择 ${esc(label)}">`;

  UI.bindBatch = ({ selected, ids, pageIds }) => {
    const valid = new Set(ids);
    for (const id of selected) if (!valid.has(id)) selected.delete(id);
    const sync = () => {
      $('[data-batch-count]').textContent = `已选 ${selected.size} 条`;
      $$('[data-batch-select]').forEach(input => { input.checked = selected.has(input.dataset.batchSelect); });
      $$('[data-batch-action]').forEach(button => { button.disabled = !selected.size; });
    };
    $$('[data-batch-select]').forEach(input => input.onchange = () => {
      if (input.checked) selected.add(input.dataset.batchSelect);
      else selected.delete(input.dataset.batchSelect);
      sync();
    });
    $$('[data-batch-pick]').forEach(button => button.onclick = () => {
      const scope = button.dataset.batchPick;
      if (scope === 'clear') selected.clear();
      else for (const id of scope === 'page' ? pageIds : ids) selected.add(id);
      sync();
    });
    sync();
  };

  let running = false;
  UI.batchAction = ({ title, items, fields = '', description = '', permanent = false, apply, complete }) => {
    if (running || !items.length) return UI.toast('请先勾选记录，或等待当前批量操作完成', 1);
    const preview = items.slice(0, 8).map(item => `<li>${esc(item.label)}</li>`).join('');
    UI.modal(`<h2>${esc(title)}</h2><p>将处理所选 ${items.length} 条记录。</p>
      ${description ? `<p>${esc(description)}</p>` : ''}<ul>${preview}</ul>
      ${items.length > 8 ? `<p>另有 ${items.length - 8} 条。</p>` : ''}
      <form>${fields}
        ${permanent ? '<label>此操作不可恢复。请输入「永久删除」确认<input name="confirm_delete" required pattern="永久删除" autocomplete="off"></label>' : ''}
        <p role="status" aria-live="polite"></p>
        <button type="submit" class="${permanent ? 'danger' : 'primary'}">确认${esc(title)}</button>
      </form>`, (modal, close) => {
      const form = modal.querySelector('form');
      const status = form.querySelector('[role=status]');
      form.onsubmit = async event => {
        event.preventDefault();
        if (running) return;
        const values = Object.fromEntries(new FormData(form));
        if (permanent && values.confirm_delete !== '永久删除') return;
        if ('reason' in values && values.reason.trim().length < 2) {
          status.textContent = '请填写至少 2 字的原因';
          return;
        }
        running = true;
        for (const el of form.elements) el.disabled = true;
        modal.querySelector('.mclose').disabled = true;
        modal.onclick = null;
        const done = [], failed = [];
        try {
          // Keep a bounded number of requests in flight and report partial results.
          for (let start = 0; start < items.length; start += 4) {
            const slice = items.slice(start, start + 4);
            const results = await Promise.allSettled(slice.map(async item => apply(item, values)));
            results.forEach((result, index) => {
              const item = slice[index];
              if (result.status === 'fulfilled') done.push(item);
              else failed.push({ item, message: result.reason?.message || String(result.reason) });
            });
            status.textContent = `已处理 ${done.length + failed.length} / ${items.length}`;
          }
          close();
          try { await complete(done); } catch (error) { UI.toast('刷新失败：' + error.message, 1); }
          const summary = `${title}完成，成功 ${done.length} 条，失败 ${failed.length} 条`;
          if (!failed.length) UI.toast(summary);
          else UI.modal(`<h2>${esc(summary)}</h2><p>失败项可在刷新核对后重试。</p>
            <div style="max-height:45vh;overflow:auto"><ul>${failed.map(row => `<li>${esc(row.item.label)} · ${esc(row.message)}</li>`).join('')}</ul></div>`);
        } finally {
          running = false;
        }
      };
    });
  };

  UI.batchReason = '<label>统一原因<textarea name="reason" minlength="2" maxlength="2000" required></textarea></label>';
})();
