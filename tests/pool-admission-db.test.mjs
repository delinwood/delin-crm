import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { PGlite } = await import(process.env.CRM_PGLITE_MODULE || '/tmp/pglite-run/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
const boss = '00000000-0000-0000-0000-000000000001';
const sales = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const legacy = '10000000-0000-4000-8000-000000000001';
const jakarta = '10000000-0000-4000-8000-000000000010';
const quoted = '10000000-0000-4000-8000-000000000011';
const held = '10000000-0000-4000-8000-000000000012';
const ownedSaudi = '10000000-0000-4000-8000-000000000013';
const oldLead = '20000000-0000-4000-8000-000000000001';
const goodLead = '20000000-0000-4000-8000-000000000002';

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
create table profiles(id uuid primary key, username text, role text, active boolean, full_name text);
create function is_active_user() returns boolean language sql stable security definer as $$select coalesce((select active from profiles where id=auth.uid()), false)$$;
create function is_admin() returns boolean language sql stable security definer as $$select coalesce((select role='admin' and active from profiles where id=auth.uid()), false)$$;
create function crm_is_archived(p_client uuid) returns boolean language sql stable as $$select false$$;
create function crm_effective_client(p_client uuid) returns uuid language sql stable as $$select p_client$$;
create function name_key(n text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(replace(lower(coalesce(n,'')), '&', ' and '),
    '\\m(inc|ltd|llc|corp|corporation|co|company|limited|group|the|gmbh|sa|sas|srl|bv|nv|sp z o o|ltee|ltée|plc|pty)\\M', ' ', 'g'), '[^a-z0-9一-龥]+', '', 'g'), '')$$;
create function norm_domain(u text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(trim(coalesce(u,''))), '^[a-z]+://', ''), '[/?#:].*$', ''), '^www\\.', ''), '')$$;
create function phone_key(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p,''), '\\D', '', 'g')) >= 7 then right(regexp_replace(p, '\\D', '', 'g'), 9) end$$;
create function crm_linkedin_key(u text) returns text language plpgsql immutable as $$
declare found text[];
begin
  found := regexp_match(lower(regexp_replace(trim(coalesce(u, '')), '[?#].*$', '')), 'linkedin\\.com/(in|company)/([^/?#]+)');
  if found is null or found[2] is null or found[2] = '' then return null; end if;
  return found[1] || '/' || lower(found[2]);
end $$;
create table clients(
  id uuid primary key default gen_random_uuid(), owner_id uuid, company_name text, customer_type text, country text,
  website text, domain text, company_email text, company_phone text, whatsapp text,
  contact_name text, contact_linkedin text, products text[], tags text[], status text,
  notes text, source_note text, name_key text, phone_key text, phone_key2 text, priority text,
  created_by uuid, created_at timestamptz default now());
create function fill_client_keys() returns trigger language plpgsql as $$
begin
  new.name_key := public.name_key(new.company_name);
  new.domain := public.norm_domain(new.website);
  new.phone_key := public.phone_key(new.company_phone);
  new.phone_key2 := public.phone_key(new.whatsapp);
  return new;
end $$;
create trigger fill_client_keys before insert or update on clients
for each row execute function fill_client_keys();
create view clients_view as select id, company_name, owner_id, country, customer_type, website, company_email, company_phone, whatsapp, contact_linkedin, status from clients;
create table crm_records(id uuid primary key, client_id uuid, kind text, data jsonb, deleted_at timestamptz);
create table crm_social_leads(
  id uuid primary key, data jsonb not null default '{}', version integer not null default 1,
  assignee_id uuid, client_id uuid, transferred_at timestamptz, trashed_at timestamptz);
create function release_client(p_client_id uuid, p_reason text) returns void language plpgsql as $$
begin
  update clients set owner_id=null where id=p_client_id;
end $$;
create function crm_social_release(p_id uuid, p_version integer, p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; cid uuid;
begin
  select * into r from crm_social_leads where id=p_id;
  if not found then raise exception 'missing'; end if;
  insert into clients(company_name,country,website,company_email,company_phone,contact_name,products,tags,status,owner_id,created_by,notes,source_note)
  values(r.data->>'company_name',coalesce(r.data->>'country',''),coalesce(r.data->>'website',''),coalesce(r.data->>'email',''),coalesce(r.data->>'phone',''),coalesce(r.data->>'contact_name',''),'{}',array['社媒客户'],'未联系',auth.uid(),auth.uid(),r.data::text,'客户共享公海 · '||coalesce(r.data->>'social_url','')) returning id into cid;
  perform public.release_client(cid,p_reason);
  return cid;
end $$;
create function crm_social_save(p_id uuid, p_version integer, p_data jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare clean jsonb; new_id uuid;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean from jsonb_each(p_data)
    where key = any(array['company_name','country','contact_name','phone','email','website','platform','social_url','products','tags','notes','progress','precision','evidence','next_date','lead_channel']);
  if p_id is null then
    insert into crm_social_leads(id, data) values (coalesce(p_id, gen_random_uuid()), clean) returning id into new_id;
  end if;
  return new_id;
end $$;
create function crm_recycle_overdue_chase() returns integer language plpgsql as $$
declare c public.clients; candidate record; moved integer := 0;
begin
  for candidate in select id as client_id, owner_id from clients where owner_id is not null loop
    select * into c from clients where id=candidate.client_id;
    if not found or c.owner_id is distinct from candidate.owner_id then continue; end if;
    update clients set owner_id=null where id=c.id;
    moved := moved + 1;
  end loop;
  return moved;
end $$;
insert into profiles values('${boss}','boss','admin',true,'Boss'),('${sales}','sales1','sales',true,'Sales'),('${other}','sales2','sales',true,'Other');
insert into clients(id, owner_id, company_name, country, customer_type, products, website, company_email, status)
values('${legacy}','${sales}','Legacy Riyadh Buyer','Saudi Arabia','importer',array['spc'],'https://legacy.example','legacy@example.test','未联系');
insert into crm_social_leads(id, data) values('${oldLead}','{"company_name":"Old Saudi Panels","country":"Saudi Arabia","customer_type":"importer","products":"SPC","email":"old@saudi.example","website":"https://old-saudi.example"}');
`);

await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111020000_pool_admission_gate.sql', import.meta.url), 'utf8'));

const login = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid', $1, false)", [id]); await db.exec('set role authenticated'); };
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
const asOwner = async () => { await db.exec('reset role'); };

test('an uncertain lead can enter the pool and a duplicate still cannot', async () => {
  await asOwner();
  await db.exec(`insert into clients(id, owner_id, company_name, country, customer_type, products, website, company_email, status)
    values('${jakarta}', null, 'Jakarta Floors', 'Indonesia', 'importer', array['spc'], 'https://jakarta.example', 'buy@jakarta.example', '未联系')`);
  const admitted = await db.query('select flags, source from crm_pool_admissions where client_id=$1', [jakarta]);
  assert.equal(admitted.rows[0].source, 'client_insert');
  assert.ok(admitted.rows[0].flags.includes('market:sea'));
  assert.ok(admitted.rows[0].flags.includes('certainty:unconfirmed'));
  assert.equal(await scalar('select priority from clients where id=$1', [jakarta]), null);

  await db.exec(`insert into clients(id, owner_id, company_name, country, status)
    values('10000000-0000-4000-8000-000000000021', null, 'Uncertain Riyadh', 'Saudi Arabia', '未联系')`);
  const gulf = await scalar('select flags from crm_pool_admissions where client_id=$1', ['10000000-0000-4000-8000-000000000021']);
  assert.ok(gulf.includes('market:gulf'));
  assert.ok(gulf.includes('missing_contact'));
  assert.ok(gulf.includes('missing_buyer'));

  await db.exec(`insert into clients(id, owner_id, company_name, country, customer_type, products, company_phone, status)
    values('${held}', null, 'Hanoi Panels', 'Vietnam', 'wholesaler', array['laminate'], '+84 24 1234 5678', '未联系')`);
  assert.ok((await scalar('select flags from crm_pool_admissions where client_id=$1', [held])).includes('market:sea'));

  await assert.rejects(db.exec(`insert into clients(id, company_name, country, customer_type, products, website, company_email, status)
    values('10000000-0000-4000-8000-000000000024', 'Jakarta Floors Ltd', 'Indonesia', 'importer', array['spc'], 'https://other-jakarta.example', 'other@jakarta.example', '未联系')`), /重复/);
  assert.equal(Number(await scalar("select count(*) from clients where company_name='Jakarta Floors Ltd'")), 0);

  await db.exec(`insert into clients(id, owner_id, company_name, country, status)
    values('${ownedSaudi}', '${sales}', 'New Saudi Owned', 'UAE', '未联系')`);
  await db.query('update clients set owner_id=null where id=$1', [ownedSaudi]);
  assert.equal(await scalar('select owner_id from clients where id=$1', [ownedSaudi]), null);
  assert.equal(await scalar('select source from crm_pool_admissions where client_id=$1', [ownedSaudi]), 'client_release');
  assert.ok((await scalar('select flags from crm_pool_admissions where client_id=$1', [ownedSaudi])).includes('market:gulf'));

  const moved = await scalar('select crm_recycle_overdue_chase()');
  assert.equal(Number(moved), 1);
  assert.equal(await scalar('select owner_id from clients where id=$1', [legacy]), null);
  assert.equal(Number(await scalar('select count(*) from crm_pool_admissions where client_id=$1', [legacy])), 0);
  assert.equal(await scalar('select owner_id from clients where id=$1', [ownedSaudi]), null);
});

test('salesperson records one outcome and only an admin sees rates by admission reason', async () => {
  await asOwner();
  await db.exec(`insert into clients(id, owner_id, company_name, country, customer_type, products, website, company_email, status)
    values('${quoted}', null, 'Quote Floors', 'Indonesia', 'importer', array['spc'], 'https://quote.example', 'quote@example.test', '未联系')`);
  await db.query('update clients set owner_id=$2 where id in ($1, $3)', [jakarta, sales, held]);
  await db.query('update clients set owner_id=$2 where id=$1', [quoted, sales]);
  await login(sales);
  await assert.rejects(db.query("select crm_set_acquisition_outcome($1, 'quote_or_deal')", [legacy]), /请先领取|获客结果/);
  await db.query("select crm_set_acquisition_outcome($1, 'unreachable')", [jakarta]);
  await db.query("select crm_set_acquisition_outcome($1, 'quote_or_deal')", [quoted]);
  await db.query("select crm_set_acquisition_outcome($1, 'buyer_hold')", [held]);
  await asOwner();
  assert.equal(await scalar('select priority from clients where id=$1', [jakarta]), null);
  assert.equal(await scalar('select priority from clients where id=$1', [quoted]), 'A');
  assert.equal(await scalar('select priority from clients where id=$1', [held]), 'A');
  await login(sales);
  await assert.rejects(db.query("select crm_set_acquisition_outcome($1, 'maybe')", [jakarta]), /获客结果/);
  await assert.rejects(db.query('select crm_pool_admission_stats()'), /仅管理员/);
  await login(other);
  await assert.rejects(db.query("select crm_set_acquisition_outcome($1, 'not_buyer')", [jakarta]), /只能记录自己负责/);
  await login(boss);
  const stats = (await db.query('select crm_pool_admission_stats() as stats')).rows[0].stats;
  assert.equal(stats.unreachable, 1);
  assert.equal(stats.quote_or_deal, 1);
  assert.equal(stats.buyer_hold, 1);
  assert.equal(stats.promoted, 2);
  const sea = stats.groups.find(group => group.kind === 'flag' && group.code === 'market:sea');
  const gulf = stats.groups.find(group => group.kind === 'flag' && group.code === 'market:gulf');
  assert.ok(sea.total >= 2);
  assert.equal(sea.promoted, 2);
  assert.ok(gulf.total >= 1);
  assert.equal(gulf.promoted, 0);
  const inserted = stats.groups.find(group => group.kind === 'source' && group.code === 'client_insert');
  assert.ok(inserted.total >= 3);
  assert.equal(inserted.promoted, 2);
});

test('shared-pool leads and transfers cannot bypass the gate, and helpers stay internal', async () => {
  await asOwner();
  await db.query("select set_config('test.uid', $1, false)", [boss]);
  const saudiLead = await scalar('select crm_social_save(null, 0, $1::jsonb)', [JSON.stringify({
    company_name: 'New Saudi Social', country: 'Saudi Arabia', products: '', lead_channel: 'social'
  })]);
  assert.ok(saudiLead);
  const saved = await scalar('select crm_social_save(null, 0, $1::jsonb)', [JSON.stringify({
    company_name: 'Saigon Panels', country: 'Vietnam', customer_type: 'distributor', products: 'SPC地板',
    email: 'buy@saigon.example', website: 'https://saigon.example', social_url: 'https://saigon.example/contact',
    lead_channel: 'social', progress: '未分配', precision: '待核实'
  })]);
  assert.equal(await scalar('select data->>\'customer_type\' from crm_social_leads where id=$1', [saved]), 'distributor');
  const oldClient = await scalar('select crm_social_release($1, 1, $2)', [oldLead, '转入公海']);
  assert.equal(await scalar('select owner_id is null from clients where id=$1', [oldClient]), true);
  assert.ok((await scalar('select flags from crm_pool_admissions where client_id=$1', [oldClient])).includes('market:gulf'));
  const clientId = await scalar('select crm_social_release($1, 1, $2)', [saved, '转入公海']);
  assert.equal(await scalar('select owner_id is null from clients where id=$1', [clientId]), true);
  assert.equal(await scalar('select source from crm_pool_admissions where client_id=$1', [clientId]), 'social_release');
  assert.ok((await scalar('select flags from crm_pool_admissions where client_id=$1', [clientId])).includes('market:sea'));
  assert.equal(await scalar('select customer_type from clients where id=$1', [clientId]), 'distributor');
  assert.ok((await scalar('select products from clients where id=$1', [clientId])).includes('spc'));
  await assert.rejects(db.query('select crm_social_save(null, 0, $1::jsonb)', [JSON.stringify({
    company_name: 'Jakarta Floors Ltd', country: 'Indonesia', email: 'dup@example.test', lead_channel: 'social'
  })]), /重复/);

  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query("select crm_preview_pool_admission('{}'::jsonb)"), /permission denied|42501/);
  await db.exec('reset role');
  assert.equal(await scalar("select has_function_privilege('anon','crm_evaluate_pool_admission(jsonb,uuid)','execute')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','crm_evaluate_pool_admission(jsonb,uuid)','execute')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','crm_pool_norm(text)','execute')"), false);
  assert.equal(await scalar("select has_function_privilege('anon','crm_set_acquisition_outcome(uuid,text)','execute')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','crm_pool_admission_stats()','execute')"), true);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111020000_pool_admission_gate.sql', import.meta.url), 'utf8'));
  await login(sales);
  const preview = (await db.query("select crm_preview_pool_admission($1::jsonb) as result", [JSON.stringify({
    company_name: 'Manila Floors', country: 'Philippines', customer_type: 'importer', products: ['spc'],
    website: 'https://manila.example', company_email: 'buy@manila.example'
  })])).rows[0].result;
  assert.equal(preview.ok, true);
  assert.ok(preview.flags.includes('market:sea'));
  const thin = (await db.query("select crm_preview_pool_admission($1::jsonb) as result", [JSON.stringify({
    company_name: 'Thin Lead', country: 'UAE'
  })])).rows[0].result;
  assert.equal(thin.ok, true);
  assert.ok(thin.flags.includes('market:gulf'));
  assert.ok(thin.flags.includes('missing_contact'));
});
