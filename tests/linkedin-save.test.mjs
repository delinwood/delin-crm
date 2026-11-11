import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sandbox = { URL, encodeURIComponent };
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(new URL('extension/lib/save.js', root), 'utf8'), vm.createContext(sandbox));
const { CRM_SAVE } = sandbox;
const sales = { id: 'sales-1', role: 'sales' };
const boss = { id: 'boss-1', role: 'admin' };

function node(text, extra = {}) {
  return {
    innerText: text,
    textContent: text,
    href: extra.href || '',
    closest() { return extra.card || null; },
    querySelector(selector) { return extra.children?.[selector] || null; }
  };
}

test('the page reader keeps only visible profile fields and never invents an email', () => {
  const companyLink = node('Acme Flooring · Full-time', { href: 'https://www.linkedin.com/company/acme-flooring' });
  const card = { querySelector(selector) { return selector.includes('/company/') ? companyLink : null; } };
  const doc = {
    querySelector(selector) {
      if (selector === 'main h1') return node('Ada Lovelace', { card });
      if (selector === '.text-body-medium.break-words') return node('Purchasing Manager');
      if (selector === '.text-body-small.inline.t-black--light.break-words') return node('Dallas, Texas, United States');
      return null;
    },
    querySelectorAll() { return [node('hidden@secret.example', { href: 'mailto:hidden@secret.example' })]; }
  };
  const person = CRM_SAVE.readPage(doc, 'https://www.linkedin.com/in/Ada-Lovelace?trk=public');
  assert.equal(person.name, 'Ada Lovelace');
  assert.equal(person.title, 'Purchasing Manager');
  assert.equal(person.companyName, 'Acme Flooring');
  assert.equal(person.location.city, 'Dallas');
  assert.equal(person.location.state, 'Texas');
  assert.equal(person.location.country, 'United States');
  assert.equal(person.linkedin, 'https://www.linkedin.com/in/ada-lovelace');
  assert.equal(person.email, '');
  assert.equal(person.phone, '');
  assert.equal(person.whatsapp, '');
});

test('a company page can keep a labeled website and ignores other links', () => {
  const doc = {
    querySelector(selector) { return selector === 'main h1' || selector === 'h1' ? node('Acme Flooring') : null; },
    querySelectorAll() {
      return [
        node('People', { href: 'https://www.linkedin.com/in/someone' }),
        node('Website', { href: 'https://acme.example/contact' })
      ];
    }
  };
  const person = CRM_SAVE.readPage(doc, 'https://www.linkedin.com/company/acme-flooring/');
  assert.equal(person.name, '');
  assert.equal(person.companyName, 'Acme Flooring');
  assert.equal(person.website, 'https://acme.example/contact');
  assert.equal(person.kind, 'company');
});

test('typed contact details are kept and invalid or off-site values are rejected', () => {
  const person = CRM_SAVE.visiblePerson({
    name: 'Ada',
    company: 'Acme Flooring Ltd',
    email: 'Ada@Buyer.Example',
    phone: '+1 (214) 555-0100',
    linkedin: 'https://evil.example/in/ada',
    website: 'javascript:alert(1)'
  });
  assert.equal(person.email, 'ada@buyer.example');
  assert.equal(person.linkedin, '');
  assert.throws(() => CRM_SAVE.clientRow(person, { role: 'sales', userId: sales.id, today: '2026-11-11' }), /网站格式不正确/);
  const bad = CRM_SAVE.visiblePerson({ name: 'Ada', company: 'Acme Flooring', email: 'not-an-email' });
  assert.equal(bad.email, '');
  assert.throws(() => CRM_SAVE.clientRow(bad, { role: 'sales', userId: sales.id }), /邮箱格式不正确/);
});

test('new clients follow the existing book versus public-sea rule', () => {
  const person = CRM_SAVE.visiblePerson({
    name: 'Ada Lovelace', title: 'Buyer', company: 'Acme Flooring',
    location: 'Dallas, Texas, United States', linkedin: 'https://www.linkedin.com/in/ada-lovelace',
    email: 'ada@acme.example', whatsapp: '+12145550100'
  });
  assert.throws(() => CRM_SAVE.clientRow(person, { role: 'sales', userId: sales.id, pool: true }), /不能放入公海/);
  const mine = CRM_SAVE.clientRow(person, { role: 'sales', userId: sales.id, today: '2026-11-11' });
  assert.equal(mine.owner_id, sales.id);
  assert.equal(mine.company_email, 'ada@acme.example');
  assert.equal(mine.contact_linkedin, 'https://www.linkedin.com/in/ada-lovelace');
  assert.equal(mine.reach_channel, 'whatsapp');
  assert.equal(mine.status, '未联系');
  assert.match(mine.notes, /没有检索或解锁隐藏联系方式/);
  const pool = CRM_SAVE.clientRow(person, { role: 'admin', userId: boss.id, pool: true, today: '2026-11-11' });
  assert.equal(pool.owner_id, null);
  const blank = CRM_SAVE.visiblePerson({ name: 'Ada', company: 'Acme Flooring', linkedin: 'https://www.linkedin.com/in/ada-lovelace' });
  const row = CRM_SAVE.clientRow(blank, { role: 'sales', userId: sales.id });
  assert.equal(row.company_email, null);
  assert.equal(row.company_phone, null);
  assert.equal(row.whatsapp, null);
  assert.equal(row.reach_channel, null);
});

test('matches use company, domain, LinkedIn, email and phone without exposing a hidden record', () => {
  const person = CRM_SAVE.visiblePerson({
    name: 'Ada Lovelace', company: 'Acme Flooring', website: 'https://acme.example',
    email: 'ada@acme.example', phone: '+1 214 555 0100', linkedin: 'https://www.linkedin.com/in/ada-lovelace'
  });
  const matches = CRM_SAVE.matchLocal(person, [
    { id: 'mine', company_name: 'Acme Flooring', owner_id: sales.id, website: 'https://acme.example', contact_linkedin: '' }
  ], [
    { client_id: 'mine', data: { name: 'Old Buyer', email: '', linkedin: 'https://www.linkedin.com/in/ada-lovelace/' } }
  ], [
    { match: '邮箱 email', company_name: null, owner_name: '其他业务员', client_id: null, mine: false }
  ], sales);
  const mine = matches.find(row => row.client_id === 'mine');
  assert.match(mine.match, /名称 name/);
  assert.match(mine.match, /网站 domain/);
  assert.match(mine.match, /LinkedIn/);
  assert.equal(mine.writable, true);
  const hidden = matches.find(row => !row.client_id);
  assert.equal(hidden.company_name, null);
  assert.equal(hidden.owner_name, '其他业务员');
  const plan = CRM_SAVE.plan(person, matches, sales);
  assert.equal(plan.canCreate, false);
  assert.equal(CRM_SAVE.plan(person, [], sales).canCreate, true);
  assert.equal(CRM_SAVE.plan(person, matches, boss).canCreate, true);
  assert.equal(CRM_SAVE.plan(person, matches, boss).createPool, true);
});

test('attaching fills only empty client fields and recognises the same person', () => {
  const person = CRM_SAVE.visiblePerson({
    name: 'Ada Lovelace', title: 'Buyer', company: 'Acme Flooring',
    email: 'ada@acme.example', linkedin: 'https://www.linkedin.com/in/ada-lovelace', city: 'Dallas'
  });
  const patch = CRM_SAVE.blankPatch({ contact_name: 'Kept Name', company_email: '', contact_linkedin: 'https://www.linkedin.com/in/kept', city: 'Austin' }, person);
  assert.equal(patch.company_email, 'ada@acme.example');
  assert.equal(Object.keys(patch).join(','), 'company_email');
  assert.equal(patch.contact_name, undefined);
  assert.equal(CRM_SAVE.sameContact(person, { contact_name: '', contact_linkedin: '', company_email: '' }, [
    { data: { name: 'Someone Else', linkedin: 'https://www.linkedin.com/in/ada-lovelace' } }
  ]), true);
  const contact = CRM_SAVE.contactData(person, '2026-11-11');
  assert.equal(contact.verified, undefined);
  assert.equal(contact.email, 'ada@acme.example');
  assert.equal(CRM_SAVE.contactData(CRM_SAVE.visiblePerson({ company: 'Acme Flooring', linkedin: 'https://www.linkedin.com/company/acme' })), null);
});

test('the extension package has no service-role key and does not call LinkedIn', () => {
  const files = ['extension/manifest.json', 'extension/config.js', 'extension/background.js', 'extension/linkedin.js', 'extension/crm-bridge.js', 'extension/lib/save.js'];
  const source = files.map(file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')).join('\n');
  assert.equal(/service_role|serviceRole/i.test(source), false);
  assert.equal(/voyager|salesApi|linkedin\.com\/sales/i.test(source), false);
  assert.equal(fs.readFileSync(new URL('../extension/linkedin.js', import.meta.url), 'utf8').includes('fetch('), false);
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.match(manifest.content_scripts[0].matches.join(' '), /\/in\/\*/);
  assert.match(manifest.content_scripts[0].matches.join(' '), /\/company\/\*/);
});
