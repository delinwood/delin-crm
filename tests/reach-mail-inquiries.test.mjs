const { PGlite } = await import(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const boss = '00000000-0000-0000-0000-000000000001';
const sales = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const client = '10000000-0000-4000-8000-000000000001';
const secretClient = '10000000-0000-4000-8000-000000000002';
const research = '20000000-0000-4000-8000-000000000003';
const person = '20000000-0000-4000-8000-000000000004';

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
create table profiles(id uuid primary key, username text, role text, active boolean, full_name text);
create function is_active_user() returns boolean language sql stable security definer as $$select coalesce((select active from profiles where id=auth.uid()), false)$$;
create function is_admin() returns boolean language sql stable security definer as $$select coalesce((select role='admin' and active from profiles where id=auth.uid()), false)$$;
create function crm_social_is_operator() returns boolean language sql stable as $$select false$$;
create table clients(id uuid primary key, owner_id uuid, company_name text, company_email text, whatsapp text, contact_name text, contact_title text, contact_linkedin text, status text, notes text, next_follow_up date, updated_at timestamptz default now());
create function crm_is_archived(p_client uuid) returns boolean language sql stable as $$select false$$;
create function crm_effective_client(p_client uuid) returns uuid language sql stable as $$select p_client$$;
create function crm_client_access(p_client uuid, p_write boolean) returns boolean language sql stable as $$
  select is_active_user() and exists(select 1 from clients c where c.id=p_client and (is_admin() or c.owner_id=auth.uid()))$$;
create view clients_view as select id, company_name, company_email, whatsapp, contact_name, status, notes, owner_id from clients;
create table crm_records(id uuid primary key, client_id uuid, kind text, data jsonb, version int, deleted_at timestamptz, created_by uuid, updated_by uuid);
create table crm_business_events(id uuid primary key default gen_random_uuid(), client_id uuid, record_id uuid, actor_id uuid, action text, detail jsonb, at timestamptz default now());
create table crm_inquiries(id uuid primary key default gen_random_uuid(), owner_id uuid, client_id uuid, channel text not null check (channel in ('alibaba','exhibition','social','website','other')), company text not null, website text not null, email text not null, subject text not null, original text not null, received_at timestamptz not null);
create table mail_suppressions(email text primary key, reason text not null, created_at timestamptz not null default now());
create table mail_messages(id uuid primary key, sender_id uuid, recipient text, status text);
create table client_tracking(client_id uuid primary key, reminder_owner_id uuid, attention_level text default '普通', email_anchor_at timestamptz);
create table follow_ups(id uuid primary key default gen_random_uuid(), client_id uuid, entry_date date, channel text, content text);
create function add_follow_up(p_client uuid, p_date date, p_channel text, p_content text, p_next date, p_status text) returns void language plpgsql as $$
begin
  insert into follow_ups(client_id, entry_date, channel, content) values (p_client, p_date, p_channel, p_content);
  update clients set status=coalesce(p_status, status), next_follow_up=coalesce(p_next, next_follow_up) where id=p_client;
end $$;
insert into profiles values('${boss}','boss','admin',true,'Boss'),('${sales}','sales1','sales',true,'Sales'),('${other}','sales2','sales',true,'Other');
insert into clients(id, owner_id, company_name, company_email, status, notes) values
 ('${client}','${sales}','Riyadh Buyer','buyer@example.test','未联系','旧备注'),
 ('${secretClient}','${other}','Secret Co','secret@example.test','未联系','');
insert into client_tracking(client_id, reminder_owner_id) values('${client}','${sales}');
insert into mail_suppressions(email, reason) values('buyer@example.test','收件人退订'),('secret@example.test','客户要求不再联系');
insert into mail_messages(id, sender_id, recipient, status) values('30000000-0000-4000-8000-000000000005','${sales}','buyer@example.test','sent');
`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261110010000_reach_mail_inquiries.sql', import.meta.url), 'utf8'));

const login = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid', $1, false)", [id]); await db.exec('set role authenticated'); };
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];

await db.exec('reset role');
await db.query("update clients set notes='仍然可以改备注' where id=$1", [client]);
assert.equal(await scalar('select notes from clients where id=$1', [client]), '仍然可以改备注');
assert.equal(await scalar('select timezone from clients_view where id=$1', [client]), null);
await assert.rejects(db.query("update clients set timezone='Not/AZone' where id=$1", [client]), /有效时区/);
await db.query("update clients set timezone='Asia/Riyadh', reach_channel='whatsapp' where id=$1", [client]);
await assert.rejects(db.query("update clients set reach_channel='sms' where id=$1", [client]), /联系渠道/);
await db.query("insert into crm_inquiries(channel, company, website, email, subject, original, received_at) values('email','Buyer','','buyer@example.test','地板询盘','需要报价', now())");
await db.query("insert into crm_inquiries(channel, company, website, email, subject, original, received_at) values('platform','Buyer','','','阿里以外的平台','平台留言', now())");
await assert.rejects(db.query("insert into crm_inquiries(channel, company, website, email, subject, original, received_at) values('paid-api','Buyer','','','x','x', now())"), /check|violates/);

await db.exec('reset role');
await db.query(`insert into crm_records(id, client_id, kind, data, version) values($1,$2,'research',$3,1)`, [research, client, JSON.stringify({ suggestions: [
  { id: 's1', field: 'whatsapp', value: '+966 50 123 4567', source_url: 'https://buyer.example/contact', checked_at: '2026-11-10T00:00:00Z' },
  { id: 's2', field: 'person', value: 'Ali Hassan', email: 'ali@buyer.example', source_url: 'https://buyer.example/contact', checked_at: '2026-11-10T00:00:00Z' }
] })]);
await db.query("update clients set whatsapp=null where id=$1", [client]);
await login(sales);
const applied = await db.query('select crm_apply_research($1, $2::jsonb)', [research, JSON.stringify([{ id: 's1', field: 'whatsapp', value: '+966 50 123 4567' }])]);
assert.match(JSON.stringify(applied.rows[0]), /whatsapp/);
await db.exec('reset role');
assert.equal(await scalar('select whatsapp from clients where id=$1', [client]), '+966 50 123 4567');
await login(sales);
const skipped = await db.query('select crm_apply_research($1, $2::jsonb)', [research, JSON.stringify([{ id: 's1', field: 'whatsapp', value: '+966 50 123 4567' }])]);
assert.match(JSON.stringify(skipped.rows[0]), /skipped/);
await assert.rejects(db.query('select crm_apply_research($1, $2::jsonb)', [research, JSON.stringify([{ id: 's2', field: 'person', value: 'Ali Hassan' }])]), /只能采纳/);

await db.exec('reset role');
await db.query(`insert into crm_records(id, client_id, kind, data, version) values($1,$2,'contact',$3,1)`, [person, client, JSON.stringify({ name: 'Sara Nasser', role: 'Buyer', whatsapp: '+966501112233', email: '' })]);
await login(sales);
await db.query('select crm_set_whatsapp_contact($1,$2,1)', [client, person]);
await db.exec('reset role');
assert.equal(await scalar('select contact_name from clients where id=$1', [client]), 'Sara Nasser');
assert.equal(await scalar('select company_email from clients where id=$1', [client]), 'buyer@example.test');
assert.equal(await scalar('select reach_channel from clients where id=$1', [client]), 'whatsapp');

const next = await scalar("select ((now() at time zone 'Asia/Shanghai')::date + 2)::text");
await login(sales);
await db.query('select crm_log_whatsapp_touch($1,$2,$3::date,true)', [client, '已发规格表', next]);
await db.exec('reset role');
assert.match(await scalar('select content from follow_ups where client_id=$1', [client]), /WhatsApp：已发规格表/);
assert.equal(await scalar('select whatsapp_next_on::text from client_tracking where client_id=$1', [client]), next);
assert.equal(await scalar('select next_follow_up::text from clients where id=$1', [client]), next);
const seen = (await db.query('select email from crm_mail_unsubscribes()')).rows.map(r => r.email);
assert.deepEqual(seen, ['buyer@example.test']);
await login(other);
const otherSeen = (await db.query('select email from crm_mail_unsubscribes()')).rows.map(r => r.email);
assert.deepEqual(otherSeen, ['secret@example.test']);
await login(boss);
const all = (await db.query('select email from crm_mail_unsubscribes() order by email')).rows.map(r => r.email);
assert.deepEqual(all, ['buyer@example.test', 'secret@example.test']);
await db.exec('reset role');
const anon = await db.query("select has_function_privilege('anon','crm_mail_unsubscribes()','execute') as ok");
assert.equal(anon.rows[0].ok, false);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261110010000_reach_mail_inquiries.sql', import.meta.url), 'utf8'));
assert.equal(await scalar('select reach_channel from clients where id=$1', [client]), 'whatsapp');
assert.equal(await scalar("select count(*) from pg_attribute where attrelid='public.clients_view'::regclass and attname='timezone' and not attisdropped"), 1);
