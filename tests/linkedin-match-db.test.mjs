import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { PGlite } = await import(process.env.CRM_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const boss = '00000000-0000-0000-0000-000000000001';
const sales = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const mine = '10000000-0000-4000-8000-000000000001';
const secret = '10000000-0000-4000-8000-000000000002';
const pool = '10000000-0000-4000-8000-000000000003';

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
create table profiles(id uuid primary key, username text, role text, active boolean, full_name text);
create function is_active_user() returns boolean language sql stable security definer as $$select coalesce((select active from profiles where id=auth.uid()), false)$$;
create function is_admin() returns boolean language sql stable security definer as $$select coalesce((select role='admin' and active from profiles where id=auth.uid()), false)$$;
create function crm_effective_client(p_client uuid) returns uuid language sql stable as $$select p_client$$;
create function name_key(n text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(replace(lower(coalesce(n,'')), '&', ' and '),
    '\\m(inc|ltd|llc|corp|corporation|co|company|limited|group|the|gmbh|sa|sas|srl|bv|nv|sp z o o|ltee|ltée|plc|pty)\\M', ' ', 'g'), '[^a-z0-9一-龥]+', '', 'g'), '')$$;
create function norm_domain(u text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(trim(coalesce(u,''))), '^[a-z]+://', ''), '[/?#:].*$', ''), '^www\\.', ''), '')$$;
create function phone_key(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p,''), '\\D', '', 'g')) >= 7 then right(regexp_replace(p, '\\D', '', 'g'), 9) end$$;
create table clients(
  id uuid primary key, owner_id uuid, company_name text, company_email text, contact_name text,
  contact_linkedin text, website text, domain text, name_key text, phone_key text, phone_key2 text,
  updated_at timestamptz default now());
create function can_see_client(cid uuid) returns boolean language sql stable as $$
  select is_active_user() and exists(select 1 from clients c where c.id=cid and (is_admin() or c.owner_id is null or c.owner_id=auth.uid()))$$;
create table crm_records(id uuid primary key, client_id uuid, kind text, data jsonb, deleted_at timestamptz);
insert into profiles values('${boss}','boss','admin',true,'Boss'),('${sales}','sales1','sales',true,'Sales'),('${other}','sales2','sales',true,'Other');
insert into clients(id, owner_id, company_name, company_email, contact_linkedin, website, domain, name_key, phone_key, phone_key2) values
 ('${mine}','${sales}','Acme Flooring','', '', 'https://acme.example', 'acme.example', 'acmeflooring', null, null),
 ('${secret}','${other}','Secret Floors','secret@example.test','https://www.linkedin.com/in/Hidden-Person','', null, 'secretfloors', '555010099', null),
 ('${pool}',null,'Pool Floors','', '', '', null, 'poolfloors', null, null);
insert into crm_records(id, client_id, kind, data) values
 ('20000000-0000-4000-8000-000000000004','${secret}','contact','{"name":"Hidden Person","email":"hidden.person@example.test","linkedin":"https://linkedin.com/in/hidden-person"}');
`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111010000_linkedin_person_match.sql', import.meta.url), 'utf8'));

const login = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid', $1, false)", [id]); await db.exec('set role authenticated'); };
const rows = async (args) => (await db.query('select match, company_name, owner_name, client_id, mine, writable, pool from crm_match_linkedin_person($1,$2,$3,$4,$5)', args)).rows;

test('authenticated staff can match a visible company and a hidden LinkedIn or email without seeing the hidden record', async () => {
  await login(sales);
  const byName = await rows(['Acme Flooring Ltd', '', '', '', '']);
  assert.equal(byName.length, 1);
  assert.equal(byName[0].company_name, 'Acme Flooring');
  assert.equal(byName[0].client_id, mine);
  assert.equal(byName[0].writable, true);
  assert.match(byName[0].match, /名称 name/);

  const hidden = await rows(['', '', '', 'hidden.person@example.test', 'https://www.linkedin.com/in/hidden-person?trk=1']);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].company_name, null);
  assert.equal(hidden[0].client_id, null);
  assert.equal(hidden[0].owner_name, 'Other');
  assert.equal(hidden[0].writable, false);
  assert.match(hidden[0].match, /LinkedIn/);
  assert.match(hidden[0].match, /邮箱 email/);

  const sea = await rows(['Pool Floors', '', '', '', '']);
  assert.equal(sea[0].company_name, 'Pool Floors');
  assert.equal(sea[0].pool, true);
  assert.equal(sea[0].writable, false);
  assert.equal(sea[0].owner_name, '公海 Pool');
});

test('anon cannot execute the matcher and an empty lookup returns nothing', async () => {
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query("select crm_match_linkedin_person('Acme','','','','')"), /permission denied|42501/);
  await db.exec('reset role');
  const anon = await db.query("select has_function_privilege('anon','crm_match_linkedin_person(text,text,text,text,text)','execute') as ok");
  assert.equal(anon.rows[0].ok, false);
  await login(sales);
  assert.deepEqual(await rows(['', '', '', 'not-an-email', 'https://example.com']), []);
  await db.exec('reset role');
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111010000_linkedin_person_match.sql', import.meta.url), 'utf8'));
  await login(sales);
  const again = await rows(['', 'https://www.acme.example/path', '', '', '']);
  assert.equal(again[0].client_id, mine);
  assert.match(again[0].match, /网站 domain/);
});
