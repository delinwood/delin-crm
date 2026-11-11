import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const context = { URL };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../js/pool-admission.js', import.meta.url), 'utf8'), context);
const gate = context.PoolAdmission;

const sea = {
  company_name: 'Jakarta Floors',
  country: 'Indonesia',
  customer_type: 'importer',
  products: ['spc'],
  website: 'https://jakarta.example',
  company_email: 'buy@jakarta.example'
};

test('Southeast Asia flooring importer with email enters, and Saudi, UAE, Dubai and a missing contact do not', () => {
  const accepted = gate.evaluate(sea, []);
  assert.equal(accepted.ok, true);
  assert.deepEqual([...accepted.rules], ['sea_market', 'buyer_product', 'entity', 'contact_path', 'not_duplicate']);
  assert.ok(accepted.reason_codes.includes('market:ID'));
  assert.ok(accepted.reason_codes.includes('buyer:importer'));
  assert.ok(accepted.reason_codes.includes('product:spc'));
  assert.ok(accepted.reason_codes.includes('contact:email'));

  for (const country of ['Vietnam', 'Viet Nam', '泰国', 'Philippines', 'Timor-Leste', '东南亚']) {
    assert.equal(gate.evaluate({ ...sea, country, company_name: country + ' Floors', website: 'https://' + country.length + '.example', company_email: country.length + '@example.test' }, []).ok, true, country);
  }

  for (const country of ['Saudi Arabia', 'KSA', '沙特', 'UAE', 'United Arab Emirates', '阿联酋', 'Dubai', '迪拜']) {
    const rejected = gate.evaluate({ ...sea, country }, []);
    assert.equal(rejected.ok, false, country);
    assert.match(rejected.message, /未进入公海/);
    assert.match(rejected.message, /沙特和阿联酋/);
    assert.equal(rejected.reason_codes.length, 0);
  }

  const southAfrica = gate.evaluate({ ...sea, country: 'South Africa' }, []);
  assert.equal(southAfrica.ok, false);
  assert.match(southAfrica.message, /东南亚/);
  assert.doesNotMatch(southAfrica.message, /沙特和阿联酋/);

  const noContact = gate.evaluate({ ...sea, company_email: '', company_phone: '', whatsapp: '', inquiry_url: '' }, []);
  assert.equal(noContact.ok, false);
  assert.match(noContact.message, /缺少可联系途径/);

  const phoneOnly = gate.evaluate({ ...sea, company_email: '', website: '', company_phone: '+62 21 5550 1234' }, []);
  assert.equal(phoneOnly.ok, true);
  assert.ok(phoneOnly.reason_codes.includes('contact:phone'));
  assert.ok(phoneOnly.reason_codes.includes('entity:phone'));

  const inquiry = gate.evaluate({ ...sea, company_email: '', inquiry_url: 'https://jakarta.example/contact' }, []);
  assert.equal(inquiry.ok, true);
  assert.ok(inquiry.reason_codes.includes('contact:inquiry'));
});

test('a factory, a company without flooring products, and a duplicate are rejected', () => {
  const factory = gate.evaluate({ ...sea, customer_type: '工厂' }, []);
  assert.equal(factory.ok, false);
  assert.match(factory.message, /同行工厂/);

  const shoes = gate.evaluate({ ...sea, products: ['shoes'] }, []);
  assert.equal(shoes.ok, false);
  assert.match(shoes.message, /地板或墙板/);

  const contractor = gate.evaluate({ ...sea, customer_type: 'contractor', products: 'PVC格栅' }, []);
  assert.equal(contractor.ok, true);
  assert.ok(contractor.reason_codes.includes('buyer:contractor'));
  assert.ok(contractor.reason_codes.includes('product:pvc_grille'));

  const duplicate = gate.evaluate(sea, [{ company_name: 'Jakarta Floors Ltd', website: 'https://other.example' }]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /重复/);

  const sameSite = gate.evaluate({ ...sea, company_name: 'Another Name' }, [{ company_name: 'Kept', website: 'https://www.jakarta.example/about' }]);
  assert.equal(sameSite.ok, false);
});

test('outcome rates group by admission reason and ignore companies that were not admitted', () => {
  const admitted = (country, type, product, outcome, name) => {
    const result = gate.evaluate({
      ...sea, company_name: name, country, customer_type: type, products: [product],
      website: 'https://' + name.toLowerCase() + '.example', company_email: name.toLowerCase() + '@example.test'
    }, []);
    assert.equal(result.ok, true, name);
    return { company_name: name, acquisition_outcome: outcome, pool_admission: { rules: [...result.rules], reason_codes: [...result.reason_codes] } };
  };
  const indonesiaQuote = admitted('Indonesia', 'importer', 'spc', 'quote_or_deal', 'QuoteCo');
  const indonesiaMiss = admitted('Indonesia', 'importer', 'spc', 'unreachable', 'MissCo');
  const vietnamHold = admitted('Vietnam', 'wholesaler', 'laminate', 'buyer_hold', 'HoldCo');
  const pending = admitted('Thailand', 'distributor', 'acoustic', '', 'PendingCo');
  assert.ok(indonesiaQuote.pool_admission);
  const stats = gate.summarize([
    indonesiaQuote, indonesiaMiss, vietnamHold, pending,
    { company_name: 'Legacy', country: 'Saudi Arabia', acquisition_outcome: 'quote_or_deal' }
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.decided, 3);
  assert.equal(stats.pending, 1);
  assert.equal(stats.quote_or_deal, 1);
  assert.equal(stats.unreachable, 1);
  assert.equal(stats.buyer_hold, 1);
  const importers = stats.groups.find(group => group.kind === 'reason' && group.code === 'buyer:importer');
  assert.equal(importers.decided, 2);
  assert.equal(importers.quote_or_deal, 1);
  assert.equal(importers.unreachable, 1);
  const wholesalers = stats.groups.find(group => group.code === 'buyer:wholesaler');
  assert.equal(wholesalers.buyer_hold, 1);
  assert.equal(wholesalers.unreachable, 0);
  assert.ok(stats.best[0].positive >= 1);
  assert.equal(stats.miss[0].code, 'buyer:importer');
  assert.equal(stats.miss[0].negative, 1);
  assert.equal(stats.groups.find(group => group.code === 'buyer:wholesaler').buyer_hold, 1);
  assert.equal(stats.groups.find(group => group.code === 'buyer:wholesaler').unreachable, 0);
  assert.equal(gate.hint({ pool_admitted_at: '2026-11-11' }, []).admitted, true);
  assert.match(gate.hint({ ...sea, country: 'Saudi Arabia' }, []).text, /不会因此被移出/);
  assert.equal(gate.outcomeLabel('quote_or_deal'), '已进入报价或成交');
  assert.equal(gate.outcomeLabel('unreachable'), '联系不上');
});
