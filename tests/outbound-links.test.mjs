import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sandbox = { URL, encodeURIComponent };
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(new URL('js/outbound.js', root), 'utf8'), vm.createContext(sandbox));
const { CRM_OUTBOUND } = sandbox;

const buyer = {
  company_name: 'Riyadh Floors',
  contact_name: 'Sara Nasser',
  company_email: 'buyer@example.test',
  company_phone: '+966501112233',
  whatsapp: '+966501112233',
  website: 'https://www.riyadhfloors.example/about',
  contact_linkedin: 'https://www.linkedin.com/in/sara-nasser',
  country: 'Saudi Arabia'
};

test('outbound buttons are real URLs prefilled with the company or person', () => {
  const full = CRM_OUTBOUND.items(buyer, 'full');
  const href = id => full.find(item => item.id === id);
  assert.equal(href('website').href, 'https://www.riyadhfloors.example/about');
  assert.equal(href('mailto').href, 'mailto:buyer@example.test');
  assert.equal(href('whatsapp').href, 'https://wa.me/966501112233');
  assert.match(href('tel').href, /^tel:/);
  assert.equal(href('google').href, 'https://www.google.com/search?q=Riyadh%20Floors');
  assert.match(href('maps').href, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Riyadh%20Floors$/);
  assert.match(href('linkedin-company').href, /\/search\/results\/companies\/\?keywords=Riyadh%20Floors$/);
  assert.match(href('linkedin-people').href, /\/search\/results\/people\/\?keywords=Sara%20Nasser%20Riyadh%20Floors$/);
  assert.equal(href('linkedin-profile').href, 'https://www.linkedin.com/in/sara-nasser');
  assert.match(href('importyeti').href, /importyeti\.com\/search\?q=Riyadh%20Floors/);
  assert.match(href('portexaminer').href, /search-term-1=Riyadh%20Floors/);
  assert.equal(href('cnudata').href, 'https://cnudata.com/');
  assert.match(href('opencorporates').href, /opencorporates\.com\/companies\?q=Riyadh%20Floors/);
  assert.equal(href('hunter').href, 'https://hunter.io/search/riyadhfloors.example');
  assert.match(href('companies-house').href, /company-information\.service\.gov\.uk\/search\?q=Riyadh%20Floors/);
  assert.match(href('apollo').href, /^https:\/\/app\.apollo\.io\//);
  assert.equal(href('apollo').note, '需账号');
  assert.equal(href('saudi-cr').href, 'https://mc.gov.sa/en/pages/default.aspx');
  assert.equal(href('saudi-cr').note, '需在官网填写');
  assert.equal(full.some(item => !item.href || /^(?:javascript|data):/i.test(item.href)), false);
  assert.equal(full.some(item => item.id === 'cbls'), false);
});

test('Hunter and people search stay clickable without inventing a missing domain or name', () => {
  const links = CRM_OUTBOUND.items({ company_name: 'Acme Floors' }, 'full');
  assert.equal(links.some(item => item.id === 'hunter'), false);
  assert.match(links.find(item => item.id === 'linkedin-people').href, /keywords=Acme%20Floors$/);
  assert.equal(links.find(item => item.id === 'linkedin-profile'), undefined);
  const html = CRM_OUTBOUND.bar({ company_name: 'Acme Floors', company_email: 'sales@acme.example' }, 'compact');
  assert.equal(html.includes('<iframe'), false);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="mailto:sales@acme\.example"/);
  assert.match(html, /data-outbound="linkedin-people"/);
});
