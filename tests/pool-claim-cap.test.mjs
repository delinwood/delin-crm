import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrationPath = new URL('supabase/migrations/20261120010000_daily_claim_cap_300_unclaimed_pool.sql', root);
const migration = fs.readFileSync(migrationPath, 'utf8');
const notices = fs.readFileSync(new URL('js/v_social_notices.js', root), 'utf8');
const poolJs = fs.readFileSync(new URL('js/v_pool.js', root), 'utf8');
const socialJs = fs.readFileSync(new URL('js/v_social.js', root), 'utf8');
const previous = fs.readFileSync(new URL('supabase/migrations/20261107050000_social_scope_claim_notices.sql', root), 'utf8');

test('cap change keeps the shared counter and does not touch other quotas', () => {
  const sqlCap = Number(migration.match(/function public\.crm_daily_claim_cap\(\)[\s\S]*?select\s+(\d+)/)[1]);
  const jsCap = Number(notices.match(/UI\.dailyClaimCap\s*=\s*(\d+)/)[1]);
  assert.equal(sqlCap, 300);
  assert.equal(jsCap, sqlCap);
  assert.match(migration, /Asia\/Shanghai/);
  assert.match(migration, /where q\.claimed<cap/);
  assert.match(migration, /check \(claimed between 1 and 300\)/);
  assert.doesNotMatch(migration, /update\s+public\.crm_daily_claims|delete\s+from\s+public\.crm_daily_claims/i);
  assert.doesNotMatch(migration, /create or replace function public\.(claim_client|release_client|set_client_attention|crm_claim_shared_lead)\b/);
  assert.doesNotMatch(migration, /980|tavily|cnudata|crm-mail/i);
  assert.match(previous, /perform public\.crm_consume_daily_claim\(\)/);
  assert.match(poolJs, /crm_pool_unclaimed_action/);
  assert.match(poolJs, /标记为无效客户/);
  assert.match(poolJs, /放入第二公海/);
  assert.match(poolJs, /UI\.dailyClaimCap/);
  assert.match(socialJs, /UI\.dailyClaimCap/);
  assert.doesNotMatch(poolJs + socialJs + notices, /自领30家|／30/);
});

const { PGlite } = await import(process.env.CRM_PGLITE_MODULE || '/tmp/pglite-run/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
const boss = '00000000-0000-0000-0000-000000000001';
const sales = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const kept = '10000000-0000-4000-8000-000000000001';
const fresh = '10000000-0000-4000-8000-000000000002';
const owned = '10000000-0000-4000-8000-000000000003';
const archived = '10000000-0000-4000-8000-000000000004';
const won = '10000000-0000-4000-8000-000000000005';
const invalidStatus = '10000000-0000-4000-8000-000000000006';
const second = '10000000-0000-4000-8000-000000000007';
const lead = '20000000-0000-4000-8000-000000000001';
const batchIds = Array.from({ length: 5 }, (_, i) => `30000000-0000-4000-8000-00000000000${i + 1}`);

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
create table profiles(id uuid primary key, username text, role text, active boolean, full_name text);
create function is_active_user() returns boolean language sql stable as $$select coalesce((select active from profiles where id=auth.uid()), false)$$;
create function is_admin() returns boolean language sql stable as $$select coalesce((select role='admin' and active from profiles where id=auth.uid()), false)$$;
create function crm_social_is_operator() returns boolean language sql stable as $$select coalesce(current_setting('test.operator', true), '')='1'$$;
create table crm_client_state(client_id uuid primary key);
create function crm_is_archived(p_client uuid) returns boolean language sql stable as $$select exists(select 1 from crm_client_state where client_id=p_client)$$;
create table clients(id uuid primary key, owner_id uuid, company_name text not null, status text, updated_at timestamptz default now());
create table client_tracking(client_id uuid primary key references clients(id), attention_level text not null default '普通', invalid_reason text not null default '', marked_by uuid, marked_at timestamptz, reminder_owner_id uuid, email_anchor_at timestamptz);
create table client_attention_events(id uuid primary key default gen_random_uuid(), client_id uuid, company_name text not null, actor_id uuid, old_level text not null, new_level text not null, reason text not null default '', at timestamptz not null default now());
create table crm_pool_metadata(client_id uuid primary key references clients(id), pool_kind text not null check (pool_kind in ('initial','secondary')), return_reason text not null default '', previous_owner uuid, returned_at timestamptz);
create table crm_pool_events(id uuid primary key default gen_random_uuid(), client_id uuid, company_name text not null, action text not null check (action in ('claim','release')), actor_id uuid, previous_owner uuid, new_owner uuid, pool_kind text not null, reason text not null default '', at timestamptz not null default now());
create table crm_daily_claims(user_id uuid not null, claim_date date not null, claimed integer not null check (claimed between 1 and 30), primary key(user_id, claim_date));
create table crm_social_leads(id uuid primary key, data jsonb not null default '{}', version integer not null default 1, assignee_id uuid, transferred_at timestamptz, trashed_at timestamptz);
create table mail_plans(id uuid primary key default gen_random_uuid(), client_id uuid, status text, last_error text);
create table mail_messages(id uuid primary key default gen_random_uuid(), client_id uuid, status text, error text);
insert into profiles values('${boss}','boss','admin',true,'Boss'),('${sales}','sales1','sales',true,'Sales'),('${other}','sales2','sales',true,'Other');
insert into clients(id, owner_id, company_name, status) values
 ('${kept}',null,'Kept Count Co','未联系'),
 ('${fresh}',null,'Fresh Pool Co','未联系'),
 ('${owned}','${other}','Owned Co','未联系'),
 ('${archived}',null,'Archived Co','未联系'),
 ('${won}',null,'Won Co','成交'),
 ('${invalidStatus}',null,'Status Invalid Co','无效'),
 ('${second}',null,'Already Second Co','未联系');
insert into client_tracking(client_id, attention_level) select id, '普通' from clients where status<>'无效';
insert into client_tracking(client_id, attention_level, invalid_reason) values('${invalidStatus}','无效','历史无效');
insert into crm_pool_metadata(client_id, pool_kind) values('${second}','secondary');
insert into crm_client_state values('${archived}');
insert into crm_social_leads(id, data) values('${lead}','{"company_name":"Shared Lead"}');
insert into mail_plans(client_id, status) values('${fresh}','running'),('${kept}','running');
insert into mail_messages(client_id, status) values('${fresh}','queued');
insert into crm_daily_claims(user_id, claim_date, claimed)
values('${sales}', (now() at time zone 'Asia/Shanghai')::date, 12);
`);

await db.exec(`
create function public.claim_client(p_client_id uuid) returns public.clients language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients; kind text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales') then
    raise exception '只有启用的业务员可以领取客户' using errcode='42501';
  end if;
  select * into customer from public.clients where id=p_client_id for update;
  if not found or customer.owner_id is not null then raise exception '客户已被领取，请刷新公海'; end if;
  if public.crm_is_archived(p_client_id) or customer.status='无效' or exists(select 1 from public.client_tracking where client_id=p_client_id and attention_level='无效') then
    raise exception '无效客户不可领取，请联系老板审查';
  end if;
  if customer.status='成交' then raise exception '已成交客户不可从公海领取'; end if;
  perform public.crm_consume_daily_claim();
  select pool_kind into kind from public.crm_pool_metadata where client_id=p_client_id;
  update public.clients set owner_id=auth.uid(), updated_at=now() where id=p_client_id;
  insert into public.crm_pool_events(client_id,company_name,action,actor_id,new_owner,pool_kind)
    values(p_client_id,customer.company_name,'claim',auth.uid(),auth.uid(),coalesce(kind,'initial'));
  select * into customer from public.clients where id=p_client_id;
  return customer;
end $$;
create function public.crm_claim_shared_lead(p_id uuid, p_version integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads;
begin
  select * into r from public.crm_social_leads where id=p_id for update;
  if not found or r.version<>p_version or r.assignee_id is not null or r.transferred_at is not null or r.trashed_at is not null then
    raise exception '客户已被领取或不在可领取范围，请刷新';
  end if;
  perform public.crm_consume_daily_claim();
  update public.crm_social_leads set assignee_id=auth.uid(), version=version+1 where id=p_id;
end $$;
create function public.set_client_attention(p_client_id uuid, p_level text, p_reason text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients; previous text; previous_reason text;
begin
  if not public.is_active_user() then raise exception '账号已停用或未登录' using errcode='42501'; end if;
  if p_level is null or p_level not in ('紧急','重要','普通','无效') then raise exception '请选择有效的客户标记'; end if;
  if p_level='无效' and length(trim(coalesce(p_reason,'')))=0 then raise exception '请填写无效原因'; end if;
  select * into customer from public.clients where id=p_client_id for update;
  if not found or public.crm_is_archived(p_client_id) or not (public.is_admin() or coalesce(customer.owner_id=auth.uid(), false)) then
    raise exception '只能标记自己负责的客户' using errcode='42501';
  end if;
  if customer.status='无效' and p_level<>'无效' then raise exception '此客户已被管理员设为无效，请联系老板恢复'; end if;
  select attention_level, invalid_reason into previous, previous_reason from public.client_tracking where client_id=p_client_id for update;
  if previous=p_level and previous_reason=(case when p_level='无效' then trim(p_reason) else '' end) then return; end if;
  update public.client_tracking set attention_level=p_level,
    invalid_reason=case when p_level='无效' then trim(p_reason) else '' end,
    marked_by=auth.uid(), marked_at=now()
  where client_id=p_client_id;
  insert into public.client_attention_events(client_id,company_name,actor_id,old_level,new_level,reason)
  values(p_client_id,customer.company_name,auth.uid(),coalesce(previous,'普通'),p_level,case when p_level='无效' then trim(p_reason) else '' end);
end $$;
create function public.release_client(p_client_id uuid, p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients;
begin
  if not public.is_active_user() then raise exception '账号已停用或未登录' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<2 or length(p_reason)>2000 then raise exception '请填写2至2000字的退回原因'; end if;
  perform id from public.mail_plans where client_id=p_client_id order by id for update;
  select * into customer from public.clients where id=p_client_id for update;
  if not found or customer.owner_id is null or not (public.is_admin() or customer.owner_id=auth.uid()) then
    raise exception '只能退回自己负责的客户' using errcode='42501';
  end if;
  if public.crm_is_archived(p_client_id) or customer.status='无效' or exists(select 1 from public.client_tracking where client_id=p_client_id and attention_level='无效') then
    raise exception '无效客户请保留在无效客户组，由老板审查';
  end if;
  update public.mail_plans set status='stopped', last_error='客户已退回第二公海，原计划停止' where client_id=p_client_id and status in ('running','paused');
  update public.clients set owner_id=null where id=p_client_id;
  insert into public.crm_pool_metadata(client_id,pool_kind,return_reason,previous_owner,returned_at)
  values(p_client_id,'secondary',trim(p_reason),customer.owner_id,now())
  on conflict(client_id) do update set pool_kind='secondary', return_reason=excluded.return_reason, previous_owner=excluded.previous_owner, returned_at=excluded.returned_at;
  insert into public.crm_pool_events(client_id,company_name,action,actor_id,previous_owner,pool_kind,reason)
  values(p_client_id,customer.company_name,'release',auth.uid(),customer.owner_id,'secondary',trim(p_reason));
end $$;
revoke all on function public.claim_client(uuid), public.crm_claim_shared_lead(uuid,integer), public.set_client_attention(uuid,text,text), public.release_client(uuid,text) from public, anon;
grant execute on function public.claim_client(uuid), public.crm_claim_shared_lead(uuid,integer), public.set_client_attention(uuid,text,text), public.release_client(uuid,text) to authenticated;
revoke all on table public.clients, public.client_tracking, public.crm_pool_metadata, public.crm_daily_claims, public.crm_pool_events, public.client_attention_events from public, anon, authenticated;
grant select on public.clients, public.client_tracking, public.crm_pool_metadata, public.crm_pool_events, public.client_attention_events to authenticated;
grant usage on schema public, auth to anon, authenticated, service_role;
`);

await db.exec(migration);

const quietRollback = () => db.exec('rollback').catch(() => {});
const login = async id => {
  await quietRollback();
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false), set_config('test.operator', '0', false)", [id]);
  await db.exec('set role authenticated');
};
const asOwner = async () => { await quietRollback(); await db.exec('reset role'); };
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
const fails = async (fn, pattern) => {
  await assert.rejects(fn, pattern);
  await db.exec('rollback').catch(() => {});
};
const shanghaiToday = async () => scalar("select (now() at time zone 'Asia/Shanghai')::date");
const claimedOn = async (user, day) => scalar('select claimed from crm_daily_claims where user_id=$1 and claim_date=$2', [user, day]);

test('existing daily count survives the cap migration', async () => {
  await asOwner();
  const today = await shanghaiToday();
  assert.equal(Number(await claimedOn(sales, today)), 12);
  assert.equal(Number(await scalar('select crm_daily_claim_cap()')), 300);
  const def = await scalar("select pg_get_constraintdef(oid) from pg_constraint where conname='crm_daily_claims_claimed_check'");
  assert.match(def, /\b300\b/);
  await assert.rejects(db.query('update crm_daily_claims set claimed=301 where user_id=$1 and claim_date=$2', [sales, today]));
  assert.equal(Number(await claimedOn(sales, today)), 12);
  const body = await scalar("select pg_get_functiondef('public.crm_pool_unclaimed_action(uuid,text,text)'::regprocedure)");
  assert.match(body, /for update/);
  assert.doesNotMatch(body, /crm_consume_daily_claim|update public\.clients|set owner_id/i);
  const consume = await scalar("select pg_get_functiondef('public.crm_consume_daily_claim()'::regprocedure)");
  assert.match(consume, /Asia\/Shanghai/);
  assert.match(consume, /where q\.claimed<cap/);
});

test('299 can take one, 300 is rejected, and batches cannot pass the cap', async () => {
  await asOwner();
  const today = await shanghaiToday();
  await db.query('update crm_daily_claims set claimed=299 where user_id=$1 and claim_date=$2', [sales, today]);
  await login(sales);
  assert.equal(Number(await scalar('select crm_daily_claim_remaining()')), 1);
  const edge = '10000000-0000-4000-8000-000000000020';
  await asOwner();
  await db.query("insert into clients(id, company_name, status) values($1,'Edge Co','未联系')", [edge]);
  await db.query("insert into client_tracking(client_id) values($1)", [edge]);
  await login(sales);
  const claimed = await db.query('select owner_id from claim_client($1)', [edge]);
  assert.equal(claimed.rows[0].owner_id, sales);
  assert.equal(Number(await scalar('select crm_daily_claim_remaining()')), 0);
  await asOwner();
  const blocked = '10000000-0000-4000-8000-000000000021';
  await db.query("insert into clients(id, company_name, status) values($1,'Blocked Co','未联系')", [blocked]);
  await db.query("insert into client_tracking(client_id) values($1)", [blocked]);
  await login(sales);
  await fails(() => db.query('select claim_client($1)', [blocked]), /今天已领取300家/);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [blocked]), null);
  assert.equal(Number(await claimedOn(sales, today)), 300);

  await db.query('update crm_daily_claims set claimed=298 where user_id=$1 and claim_date=$2', [sales, today]);
  for (const id of batchIds) {
    await db.query("insert into clients(id, company_name, status) values($1,$2,'未联系')", [id, 'Batch ' + id.slice(-1)]);
    await db.query('insert into client_tracking(client_id) values($1)', [id]);
  }
  await db.query("select set_config('test.uid', $1, false)", [sales]);
  const list = batchIds.map(id => `'${id}'`).join(',');
  await db.exec(`do $batch$
    declare id uuid; ok integer := 0; bad integer := 0;
    begin
      foreach id in array array[${list}]::uuid[] loop
        begin
          perform public.claim_client(id);
          ok := ok + 1;
        exception when others then
          bad := bad + 1;
        end;
      end loop;
      if ok <> 2 or bad <> 3 then raise exception 'batch crossed the cap: % succeeded, % failed', ok, bad; end if;
    end $batch$;`);
  assert.equal(Number(await claimedOn(sales, today)), 300);
  assert.equal(Number(await scalar('select count(*) from clients where id = any($1::uuid[]) and owner_id=$2', [batchIds, sales])), 2);
  assert.equal(Number(await scalar('select count(*) from clients where id = any($1::uuid[]) and owner_id is null', [batchIds])), 3);

  const race = '10000000-0000-4000-8000-000000000022';
  await db.query('update crm_daily_claims set claimed=20 where user_id=$1 and claim_date=$2', [sales, today]);
  await db.query("insert into clients(id, company_name, status) values($1,'Race Co','未联系')", [race]);
  await db.query('insert into client_tracking(client_id, attention_level) values($1,\'普通\')', [race]);
  await db.query("select set_config('test.uid', $1, false)", [sales]);
  await db.query('select claim_client($1)', [race]);
  await fails(() => db.query('select claim_client($1)', [race]), /已被领取/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','晚到的无效标记')", [race]), /已被领取/);
  assert.equal(await scalar('select owner_id from clients where id=$1', [race]), sales);
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [race]), '普通');
  assert.equal(Number(await claimedOn(sales, today)), 21);
  await login(other);
  await fails(() => db.query('select claim_client($1)', [race]), /已被领取/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','别人已经领走')", [race]), /已被领取/);
  assert.equal(Number(await scalar('select crm_daily_claim_remaining()')), 300);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [race]), sales);
  assert.equal(Number(await claimedOn(sales, today)), 21);
  assert.equal(await claimedOn(other, today), undefined);
});

test('one counter covers both pools and resets on the Beijing date', async () => {
  await asOwner();
  const today = await shanghaiToday();
  await db.query('delete from crm_daily_claims where user_id=$1', [sales]);
  await db.query('insert into crm_daily_claims(user_id, claim_date, claimed) values($1, $2::date - 1, 300)', [sales, today]);
  await login(sales);
  assert.equal(Number(await scalar('select crm_daily_claim_remaining()')), 300);
  const cross = '10000000-0000-4000-8000-000000000030';
  await asOwner();
  await db.query("insert into clients(id, company_name, status) values($1,'Cross Pool Co','未联系')", [cross]);
  await db.query('insert into crm_pool_metadata(client_id, pool_kind) values($1,\'secondary\')', [cross]);
  await db.query('insert into client_tracking(client_id) values($1)', [cross]);
  await db.query('update crm_social_leads set assignee_id=null, version=1 where id=$1', [lead]);
  await login(sales);
  await db.query('select claim_client($1)', [cross]);
  await db.query('select crm_claim_shared_lead($1,1)', [lead]);
  await asOwner();
  assert.equal(Number(await claimedOn(sales, today)), 2);
  assert.equal(Number(await claimedOn(sales, await scalar('select $1::date - 1', [today]))), 300);
  assert.equal(await scalar('select pool_kind from crm_pool_events where client_id=$1 and action=\'claim\'', [cross]), 'secondary');
  assert.equal(await scalar('select assignee_id from crm_social_leads where id=$1', [lead]), sales);
  const consume = await scalar("select pg_get_functiondef('public.crm_consume_daily_claim()'::regprocedure)");
  assert.match(consume, /now\(\) at time zone 'Asia\/Shanghai'/);
  assert.doesNotMatch(consume, /time zone 'UTC'/);
});

test('unclaimed pool actions move the existing records and do not claim or spend quota', async () => {
  await asOwner();
  const today = await shanghaiToday();
  await db.query('delete from crm_daily_claims where user_id=$1 and claim_date=$2', [sales, today]);
  await db.query('insert into crm_daily_claims(user_id, claim_date, claimed) values($1,$2,7)', [sales, today]);
  await login(sales);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'ordinary','no')", [fresh]), /只能标记为无效客户或放入第二公海/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','   ')", [fresh]), /请填写无效原因/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','短')", [fresh]), /2至2000字/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary',$2)", [owned, '这是别人的客户']), /已被领取/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','重复')", [owned]), /已被领取/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','回收站客户')", [archived]), /回收站/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','成交客户')", [won]), /已成交/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','已无效')", [invalidStatus]), /无效客户/);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','已在第二公海')", [second]), /已在第二公海/);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [owned]), other);
  assert.equal(await scalar('select pool_kind from crm_pool_metadata where client_id=$1', [second]), 'secondary');
  assert.equal(Number(await claimedOn(sales, today)), 7);

  await login(sales);
  await db.query("select crm_pool_unclaimed_action($1,'secondary','  联系不上，放入第二公海  ')", [fresh]);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [fresh]), null);
  assert.equal(await scalar('select status from clients where id=$1', [fresh]), '未联系');
  assert.equal(await scalar('select pool_kind from crm_pool_metadata where client_id=$1', [fresh]), 'secondary');
  assert.equal(await scalar('select return_reason from crm_pool_metadata where client_id=$1', [fresh]), '联系不上，放入第二公海');
  assert.equal(await scalar('select previous_owner from crm_pool_metadata where client_id=$1', [fresh]), null);
  const event = (await db.query("select action, actor_id, previous_owner, pool_kind, reason from crm_pool_events where client_id=$1 and action='release'", [fresh])).rows[0];
  assert.equal(event.actor_id, sales);
  assert.equal(event.previous_owner, null);
  assert.equal(event.pool_kind, 'secondary');
  assert.equal(event.reason, '联系不上，放入第二公海');
  assert.equal(await scalar('select status from mail_plans where client_id=$1', [fresh]), 'stopped');
  assert.equal(await scalar("select status from mail_messages where client_id=$1", [fresh]), 'cancelled');
  assert.equal(Number(await claimedOn(sales, today)), 7);
  await login(sales);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','再放一次')", [fresh]), /已在第二公海/);

  await db.query("select crm_pool_unclaimed_action($1,'invalid','  不是目标买家  ')", [kept]);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [kept]), null);
  assert.equal(await scalar('select status from clients where id=$1', [kept]), '未联系');
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [kept]), '无效');
  assert.equal(await scalar('select invalid_reason from client_tracking where client_id=$1', [kept]), '不是目标买家');
  assert.equal(await scalar('select marked_by from client_tracking where client_id=$1', [kept]), sales);
  const attention = (await db.query('select actor_id, old_level, new_level, reason from client_attention_events where client_id=$1', [kept])).rows[0];
  assert.equal(attention.actor_id, sales);
  assert.equal(attention.old_level, '普通');
  assert.equal(attention.new_level, '无效');
  assert.equal(attention.reason, '不是目标买家');
  assert.equal(await scalar('select status from mail_plans where client_id=$1', [kept]), 'running');
  assert.equal(Number(await scalar('select count(*) from crm_pool_metadata where client_id=$1', [kept])), 0);
  assert.equal(Number(await claimedOn(sales, today)), 7);
  await login(sales);
  await fails(() => db.query('select claim_client($1)', [kept]), /无效客户不可领取/);
  await asOwner();
  assert.equal(Number(await claimedOn(sales, today)), 7);
  assert.equal(await scalar('select owner_id from clients where id=$1', [kept]), null);
});

test('assigned, inactive, operator, and boss calls stay inside the existing permissions', async () => {
  await asOwner();
  await db.query('update profiles set active=false where id=$1', [sales]);
  await login(sales);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','停用账号')", [second]), /只有启用的业务员/);
  await asOwner();
  await db.query('update profiles set active=true where id=$1', [sales]);
  await db.query("select set_config('test.operator','1',false)");
  await login(sales);
  await db.query("select set_config('test.operator','1',false)");
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'invalid','运营不能处理')", [second]), /只有启用的业务员/);
  await asOwner();
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [second]), '普通');

  await login(boss);
  await fails(() => db.query("select crm_pool_unclaimed_action($1,'secondary','老板不走这条新入口')", [second]), /只有启用的业务员/);
  const mine = '10000000-0000-4000-8000-000000000040';
  const assigned = '10000000-0000-4000-8000-000000000042';
  await asOwner();
  await db.query("insert into clients(id, owner_id, company_name, status) values($1,$2,'Sales Owned','未联系'),($3,$2,'Assigned Release','未联系')", [mine, sales, assigned]);
  await db.query('insert into client_tracking(client_id) values($1),($2)', [mine, assigned]);
  await login(sales);
  await fails(() => db.query("select set_client_attention($1,'无效','公海客户不能改用原标记')", [second]), /只能标记自己负责的客户/);
  await db.query("select set_client_attention($1,'无效','我负责的客户')", [mine]);
  await login(boss);
  const unclaimed = '10000000-0000-4000-8000-000000000041';
  await asOwner();
  await db.query("insert into clients(id, company_name, status) values($1,'Boss Can Flag','未联系')", [unclaimed]);
  await db.query('insert into client_tracking(client_id) values($1)', [unclaimed]);
  await login(boss);
  await db.query("select set_client_attention($1,'无效','老板原权限')", [unclaimed]);
  await fails(() => db.query("select release_client($1,'老板不能退回已无效客户')", [mine]), /无效客户/);
  await db.query("select release_client($1,'老板退回已分配客户')", [assigned]);
  await asOwner();
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [unclaimed]), '无效');
  assert.equal(await scalar('select owner_id from clients where id=$1', [assigned]), null);
  assert.equal(await scalar('select pool_kind from crm_pool_metadata where client_id=$1', [assigned]), 'secondary');
  assert.equal(await scalar('select owner_id from clients where id=$1', [mine]), sales);
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [mine]), '无效');
  await login(sales);
  await fails(() => db.query('update clients set owner_id=$1 where id=$2', [sales, second]), /permission denied/);
  await fails(() => db.query("update client_tracking set attention_level='无效' where client_id=$1", [second]), /permission denied/);
  await fails(() => db.query('select crm_consume_daily_claim()'), /permission denied/);
  await asOwner();
  assert.equal(await scalar('select owner_id from clients where id=$1', [second]), null);
  assert.equal(await scalar('select attention_level from client_tracking where client_id=$1', [second]), '普通');
});

test.after(async () => { await db.close(); });
