import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { JSDOM } = await import(process.env.CRM_JSDOM_MODULE || '/tmp/jsdom-run/node_modules/jsdom/lib/api.js');
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast"></div></body></html>', { url: 'http://crm.local/#/pool', runScripts: 'dangerously' });
const { window } = dom;
window.setInterval = () => 1;
window.clearInterval = () => {};
window.confirm = () => true;
window.scrollTo = () => {};
window.CRM_CONFIG = {
  MODE: 'supabase', COMPANY_NAME_EN: 'DELIN', COMPANY_NAME_CN: '德林', COMPANY_WEBSITE: 'https://example.com',
  LOGO_URL: '', SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'test', USERNAME_EMAIL_DOMAIN: 'example.com'
};
const sales = { id: 'sales-1', username: 'sales1', role: 'sales', active: true, full_name: '业务员甲' };
const boss = { id: 'boss-1', username: 'boss', role: 'admin', active: true, full_name: '老板' };
const openId = 'client-open';
const secondId = 'client-second';
const ownedId = 'client-owned';
const clients = [
  { id: openId, company_name: '未领取地板公司', country: 'Vietnam', status: '未联系', owner_id: null, products: [], pool_kind: 'initial' },
  { id: secondId, company_name: '第二公海公司', country: 'Thailand', status: '未联系', owner_id: null, products: [], pool_kind: 'secondary', return_reason: '之前退回' },
  { id: ownedId, company_name: '已分配公司', country: 'India', status: '未联系', owner_id: 'other-sales', products: [], pool_kind: 'initial' }
];
const calls = [];
window.DB = {
  mode: 'supabase',
  listClients: async () => clients,
  claimClient: async () => { throw new Error('领取应走单独断言'); },
  getClient: async id => clients.find(row => row.id === id),
  listAudit: async () => [],
  canDeleteClients: async () => false,
  me: () => window.UI?.ME,
  chk: result => { if (result.error) throw new Error(result.error.message); return result.data; },
  t: () => { throw new Error('table unused'); },
  init() {
    return { rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'crm_daily_claim_remaining') return { data: 299, error: null };
      if (name === 'crm_daily_claim_cap') return { data: 300, error: null };
      if (name === 'crm_pool_unclaimed_action') {
        const row = window.UI.CLIENTS.find(item => item.id === args.p_client_id);
        if (!row || row.owner_id) return { data: null, error: { message: '客户已被领取，请刷新公海' } };
        if (args.p_action === 'invalid') row.attention_level = '无效';
        if (args.p_action === 'secondary') row.pool_kind = 'secondary';
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unexpected ' + name } };
    } };
  }
};
window.U = { domain: () => '' };
const load = file => {
  const script = window.document.createElement('script');
  script.textContent = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  window.document.body.appendChild(script);
};
load('../js/constants.js');
load('../js/core.js');
window.UI.outboundBar = () => '';
load('../js/batch.js');
load('../js/followup.js');
load('../js/v_social_notices.js');
window.UI.views.client = { render: async () => { window.document.querySelector('main')?.insertAdjacentHTML('beforeend', '<div class="hero"><div class="quick"></div></div>'); } };
load('../js/v_pool.js');
window.UI.refresh = async () => {};
window.UI.route = async () => window.UI.views.pool.render();

const text = () => window.document.querySelector('main')?.textContent || '';
const buttons = label => [...window.document.querySelectorAll('main button, .hero button')].filter(button => button.textContent.includes(label));
const closeModals = () => window.document.querySelectorAll('.modal').forEach(node => node.remove());

test('pool screen shows the server cap and both unclaimed actions', async () => {
  closeModals();
  window.UI.ME = sales;
  window.UI.USERS = [sales, boss];
  window.UI.CLIENTS = clients;
  window.location.hash = '#/pool';
  await window.UI.views.pool.render();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(text(), /今日还可自领 299／300 家（北京时间，各公海合计）/);
  assert.match(text(), /未领取地板公司/);
  assert.equal(text().includes('已分配公司'), false);
  assert.equal(text().includes('第二公海公司'), false);
  assert.equal(buttons('标记为无效客户').length, 1);
  assert.equal(buttons('放入第二公海').length, 1);
  assert.equal(buttons('领取为我的客户').length, 1);

  buttons('放入第二公海')[0].click();
  const form = window.document.querySelector('.modal form');
  const reasonField = () => form.querySelector('[name=reason]');
  reasonField().value = '短';
  await form.onsubmit({ preventDefault() {} });
  assert.match(form.querySelector('[role=status]').textContent, /2至2000字/);
  assert.equal(calls.some(call => call.name === 'crm_pool_unclaimed_action'), false);

  reasonField().value = '联系不上，先放入第二公海';
  await form.onsubmit({ preventDefault() {} });
  const action = calls.find(call => call.name === 'crm_pool_unclaimed_action');
  assert.equal(action.args.p_client_id, openId);
  assert.equal(action.args.p_action, 'secondary');
  assert.equal(action.args.p_reason, '联系不上，先放入第二公海');
  assert.equal(clients.find(row => row.id === openId).owner_id, null);
  assert.equal(clients.find(row => row.id === openId).pool_kind, 'secondary');
  assert.equal(calls.some(call => call.name === 'claim_client'), false);
  assert.equal(text().includes('未领取地板公司'), false);
});

test('second pool offers invalid only, and a lost claim refreshes', async () => {
  closeModals();
  clients.forEach(row => { if (row.id === openId) row.pool_kind = 'initial'; });
  window.UI.CLIENTS = clients;
  window.location.hash = '#/second-pool';
  await window.UI.views['second-pool'].render();
  assert.match(text(), /第二公海公司/);
  assert.equal(buttons('标记为无效客户').length, 1);
  assert.equal(buttons('放入第二公海').length, 0);

  window.location.hash = '#/pool';
  await window.UI.views.pool.render();
  const before = calls.length;
  buttons('标记为无效客户')[0].click();
  clients.find(row => row.id === openId).owner_id = 'other-sales';
  const form = window.document.querySelector('.modal form');
  form.querySelector('[name=reason]').value = '不是买家';
  await form.onsubmit({ preventDefault() {} });
  assert.match(window.document.querySelector('#toast').textContent, /已被领取/);
  const lost = calls.slice(before).find(call => call.name === 'crm_pool_unclaimed_action');
  assert.equal(lost.args.p_action, 'invalid');
  assert.equal(lost.args.p_client_id, openId);
  assert.equal(text().includes('未领取地板公司'), false);
  assert.ok(calls.length > before);
  clients.find(row => row.id === openId).owner_id = null;
});

test('boss pool keeps the existing controls', async () => {
  closeModals();
  window.UI.ME = boss;
  window.UI.CLIENTS = clients.map(row => ({ ...row, owner_id: row.id === ownedId ? 'other-sales' : null, pool_kind: row.id === secondId ? 'secondary' : 'initial', attention_level: '普通' }));
  window.location.hash = '#/pool';
  await window.UI.views.pool.render();
  assert.equal(buttons('标记为无效客户').length, 0);
  assert.equal(buttons('放入第二公海').length, 0);
  assert.equal(buttons('领取为我的客户').length, 0);
  assert.equal(window.document.querySelector('[data-daily-claim]'), null);
  assert.match(text(), /批量分配并移出公海/);
  window.location.hash = '#/client/' + openId;
  window.UI.CLIENTS = clients.map(row => ({ ...row, owner_id: null, attention_level: '普通', pool_kind: 'initial' }));
  await window.UI.views.client.render(openId);
  assert.equal(buttons('标记为无效客户').length, 0);
  assert.equal(buttons('退回第二公海').length, 0);
});

test('salesperson client page can mark an unclaimed lead without claiming it', async () => {
  closeModals();
  const row = { id: openId, company_name: '未领取地板公司', status: '未联系', owner_id: null, products: [], pool_kind: 'initial', attention_level: '普通' };
  window.UI.ME = sales;
  window.UI.CLIENTS = [row];
  window.location.hash = '#/client/' + openId;
  await window.UI.views.pool.render();
  await window.UI.views.client.render(openId);
  const detail = window.document.querySelector('.hero .quick');
  assert.equal([...detail.querySelectorAll('button')].filter(button => button.textContent.includes('标记为无效客户')).length, 1);
  assert.equal([...detail.querySelectorAll('button')].filter(button => button.textContent.includes('放入第二公海')).length, 1);
  [...detail.querySelectorAll('button')].find(button => button.textContent.includes('标记为无效客户')).click();
  const form = window.document.querySelector('.modal form');
  form.querySelector('[name=reason]').value = '   ';
  await form.onsubmit({ preventDefault() {} });
  assert.match(form.querySelector('[role=status]').textContent, /请填写无效原因/);
  form.querySelector('[name=reason]').value = '没有采购需求';
  await form.onsubmit({ preventDefault() {} });
  const action = calls.filter(call => call.name === 'crm_pool_unclaimed_action').at(-1);
  assert.equal(action.args.p_action, 'invalid');
  assert.equal(action.args.p_reason, '没有采购需求');
  assert.equal(row.owner_id, null);
  assert.equal(row.attention_level, '无效');
});
