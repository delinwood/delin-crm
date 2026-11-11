import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const context = { URL };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../js/pool-admission.js', import.meta.url), 'utf8'), context);
const gate = context.PoolAdmission;

test('an uncertain or incomplete lead can enter the pool, and a duplicate still cannot', () => {
  const thin = gate.evaluate({ company_name: 'Uncertain Riyadh', country: 'Saudi Arabia' }, []);
  assert.equal(thin.ok, true);
  assert.ok(thin.flags.includes('market:gulf'));
  assert.ok(thin.flags.includes('missing_contact'));
  assert.ok(thin.flags.includes('missing_buyer'));
  assert.ok(thin.flags.includes('certainty:unconfirmed'));
  assert.equal(thin.message, '');

  for (const country of ['UAE', '迪拜', '沙特', 'Indonesia', 'Vietnam', '']) {
    assert.equal(gate.evaluate({ company_name: 'Lead ' + country, country }, []).ok, true, country);
  }
  assert.ok(gate.evaluate({ company_name: 'Manila', country: 'Philippines', customer_type: 'importer', products: ['spc'], company_email: 'a@manila.example', website: 'https://manila.example' }, []).flags.includes('market:sea'));

  const duplicate = gate.evaluate(
    { company_name: 'Jakarta Floors Ltd', country: 'Indonesia' },
    [{ company_name: 'Jakarta Floors', website: 'https://other.example' }]
  );
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /重复/);
});

test('buyer-positive follow-up promotes to A and stats group by source and soft flags', () => {
  const row = (name, country, outcome, priority, source) => {
    const evaluated = gate.evaluate({ company_name: name, country, company_email: name.toLowerCase() + '@example.test', website: 'https://' + name.toLowerCase() + '.example' }, []);
    assert.equal(evaluated.ok, true);
    return {
      company_name: name, country, acquisition_outcome: outcome, priority,
      pool_admission: { source, flags: evaluated.flags }
    };
  };
  const stats = gate.summarize([
    row('QuoteCo', 'Indonesia', 'quote_or_deal', 'A', 'discovery'),
    row('HoldCo', 'Vietnam', 'buyer_hold', 'A', 'client_insert'),
    row('MissCo', 'Indonesia', 'unreachable', 'C', 'client_insert'),
    row('GulfCo', 'Saudi Arabia', '', 'C', 'social_release'),
    { company_name: 'Legacy', country: 'Saudi Arabia', acquisition_outcome: 'quote_or_deal', priority: 'A' }
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.promoted, 2);
  assert.equal(stats.pending, 1);
  assert.equal(stats.unreachable, 1);
  const discovery = stats.groups.find(group => group.kind === 'source' && group.code === 'discovery');
  assert.equal(discovery.promoted, 1);
  const gulf = stats.groups.find(group => group.kind === 'flag' && group.code === 'market:gulf');
  assert.equal(gulf.total, 1);
  assert.equal(gulf.promoted, 0);
  const sea = stats.groups.find(group => group.kind === 'flag' && group.code === 'market:sea');
  assert.equal(sea.promoted, 2);
  assert.match(gate.hint({ priority: 'A', acquisition_outcome: 'buyer_hold' }).text, /分级 A/);
  assert.match(gate.hint({ company_name: 'X', country: 'UAE', priority: 'C' }).text, /尚未确认/);
  assert.match(gate.hint({ company_name: 'X', country: 'UAE', priority: 'C' }).text, /沙特/);
  assert.equal(gate.outcomeLabel('quote_or_deal'), '已进入报价或成交');
});
