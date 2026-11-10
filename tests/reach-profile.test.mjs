import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { disclosedContacts } from '../supabase/functions/crm-mail/discovery-providers.mjs';

const root = new URL('../', import.meta.url);
const sandbox = {};
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(new URL('js/constants.js', root), 'utf8'), vm.createContext(sandbox));
vm.runInContext(fs.readFileSync(new URL('js/mail-observe.js', root), 'utf8'), vm.createContext(sandbox));
const { C, CRM_OBSERVE } = sandbox;

test('new Middle East or WhatsApp clients require reach fields; old records do not', () => {
  assert.equal(C.reachRequired(true, {}, { country: 'Saudi Arabia', reach_channel: '' }), true);
  assert.equal(C.reachRequired(true, {}, { country: 'Germany', reach_channel: 'whatsapp' }), true);
  assert.equal(C.reachRequired(true, {}, { country: 'Germany', reach_channel: 'email' }), false);
  assert.equal(C.reachRequired(false, { country: 'Saudi Arabia' }, { country: 'Saudi Arabia', reach_channel: '' }), false);
  assert.equal(C.reachRequired(false, { country: 'Germany', reach_channel: 'email' }, { country: 'Qatar', reach_channel: 'email' }), true);
  assert.equal(C.reachRequired(false, { country: 'Germany', reach_channel: 'email' }, { country: 'Germany', reach_channel: 'whatsapp' }), true);
  assert.equal(C.tzFor({ country: 'Saudi Arabia' }), 'Asia/Riyadh');
  assert.equal(C.tzFor({ country: 'Saudi Arabia', timezone: 'Asia/Riyadh' }), 'Asia/Riyadh');
  assert.equal(C.tzFor({ country: 'USA', state: 'CA' }), 'America/Los_Angeles');
  assert.equal(C.DIAL.Qatar, '974');
  assert.equal(C.whatsappDue({ whatsapp_next_on: '2026-11-01', status: '已联系' }, '2026-11-10'), true);
  assert.equal(C.whatsappDue({ whatsapp_next_on: '2026-11-20', status: '已联系' }, '2026-11-10'), false);
  assert.equal(C.whatsappNeedsPlan({ reach_channel: 'whatsapp', status: '未联系' }), true);
  assert.equal(C.whatsappNeedsPlan({ reach_channel: 'email', status: '未联系' }), false);
});

test('bounce summary uses the delivery report already stored by crm-mail', () => {
  const report = [
    'Final-Recipient: rfc822; buyer@example.test',
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550 5.1.1 User unknown'
  ].join('\n');
  const parsed = CRM_OBSERVE.bounceSummary(report);
  assert.equal(parsed.recipient, 'buyer@example.test');
  assert.match(parsed.reason, /failed/);
  assert.match(parsed.reason, /5\.1\.1/);
  assert.match(parsed.reason, /User unknown/);
  const empty = CRM_OBSERVE.bounceSummary('no report here');
  assert.equal(empty.recipient, '');
  assert.equal(empty.reason, '');
});

test('pace days count attempts without treating them as opens', () => {
  const now = new Date('2026-11-10T04:00:00Z');
  const rows = CRM_OBSERVE.paceDays([
    { attempted_at: '2026-11-10T01:00:00Z', status: 'sent' },
    { attempted_at: '2026-11-10T02:00:00Z', status: 'failed' },
    { attempted_at: '2026-11-09T02:00:00Z', status: 'bounced' }
  ], 3, now);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].date, '2026-11-10');
  assert.equal(rows[2].attempts, 2);
  assert.equal(rows[2].accepted, 1);
  assert.equal(rows[2].failed, 1);
  assert.equal(rows[1].accepted, 1);
});

test('labeled people keep only emails written on the same line', () => {
  const text = [
    '联系人: Ali Hassan, Purchasing Manager, ali@buyer.example',
    'Contact: Sara Nasser',
    'WhatsApp: +966 50 123 4567',
    'Email us at info@buyer.example',
    'Their buyer is probably firstname@buyer.example'
  ].join('\n');
  const found = disclosedContacts(text);
  assert.equal(found.people.length, 2);
  assert.deepEqual(found.people[0], {
    name: 'Ali Hassan', role: 'Purchasing Manager', email: 'ali@buyer.example', phone: '', whatsapp: '', excerpt: '联系人: Ali Hassan, Purchasing Manager, ali@buyer.example'
  });
  assert.equal(found.people[1].name, 'Sara Nasser');
  assert.equal(found.people[1].email, '');
  assert.equal(found.whatsapps[0].value.includes('966'), true);
  assert.equal(found.people.some(p => p.email === 'info@buyer.example' || p.email.includes('firstname')), false);
  assert.equal(found.people.some(p => /firstname@/.test(p.email)), false);
});
