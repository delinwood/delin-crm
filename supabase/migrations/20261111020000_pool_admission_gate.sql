-- Public-pool source notes, follow-up outcomes, and promotion to grade A.
-- 公海 may contain uncertain leads. Certainty is grade A after a buyer follow-up.
-- Review this file before applying it. Do not run it on production until the boss approves.
-- It does not scrape, send messages, unlock contacts, or call a paid API.
-- It does not update or delete existing clients.
-- Apply 20261111010000_linkedin_person_match.sql first. This file calls crm_linkedin_key.
-- Safe to re-run: new columns use IF NOT EXISTS, functions use CREATE OR REPLACE,
-- and the function patches stop once their marker is present.

begin;

alter table public.clients add column if not exists acquisition_outcome text;
alter table public.clients add column if not exists inquiry_url text;
alter table public.clients add column if not exists pool_admitted_at timestamptz;
alter table public.clients add column if not exists pool_gate_subject boolean;

alter table public.clients drop constraint if exists clients_acquisition_outcome_check;
alter table public.clients add constraint clients_acquisition_outcome_check
  check (acquisition_outcome is null or acquisition_outcome in ('unreachable','not_buyer','buyer_hold','quote_or_deal'));

comment on column public.clients.acquisition_outcome is
  'One salesperson result after a claimed client is worked: unreachable, not_buyer, buyer_hold, quote_or_deal.';
comment on column public.clients.pool_gate_subject is
  'True only for clients inserted after this change. Legacy rows stay null and are not backfilled.';
comment on column public.clients.pool_admitted_at is
  'Set when a new company is recorded as entering a public pool. It is not a certainty grade.';

create table if not exists public.crm_pool_admissions (
  client_id uuid primary key references public.clients(id) on delete cascade,
  source text not null,
  flags text[] not null default '{}',
  admitted_at timestamptz not null default now()
);
alter table public.crm_pool_admissions add column if not exists flags text[] default '{}';
comment on table public.crm_pool_admissions is
  'How a new company entered the public pool, plus soft flags. Not a pass/fail admission wall.';

alter table public.crm_pool_admissions enable row level security;
revoke all on public.crm_pool_admissions from public, anon, authenticated;
grant select on public.crm_pool_admissions to authenticated;
drop policy if exists pool_admission_admin_read on public.crm_pool_admissions;
create policy pool_admission_admin_read on public.crm_pool_admissions
  for select to authenticated
  using (public.is_active_user() and public.is_admin());

-- Keep the directory view and append only the columns it does not already expose.
do $view$
declare definition text; extra text := '';
begin
  if to_regclass('public.clients_view') is null then
    raise exception 'clients_view 不存在，已停止';
  end if;
  if not exists (select 1 from pg_attribute
      where attrelid='public.clients_view'::regclass and attname='acquisition_outcome' and not attisdropped) then
    extra := extra || ', c.acquisition_outcome';
  end if;
  if not exists (select 1 from pg_attribute
      where attrelid='public.clients_view'::regclass and attname='inquiry_url' and not attisdropped) then
    extra := extra || ', c.inquiry_url';
  end if;
  if not exists (select 1 from pg_attribute
      where attrelid='public.clients_view'::regclass and attname='pool_admitted_at' and not attisdropped) then
    extra := extra || ', c.pool_admitted_at';
  end if;
  if extra = '' then return; end if;
  select rtrim(pg_get_viewdef('public.clients_view'::regclass), E'; \n') into definition;
  execute 'create or replace view public.clients_view as select v.*' || extra
    || ' from (' || definition || ') v left join public.clients c on c.id=v.id';
end
$view$;

create or replace function public.crm_pool_norm(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '[''’.]', '', 'g'), '[^a-z0-9一-龥]+', ' ', 'g'), ' +', ' ', 'g'))
$$;

-- Null means not a listed market. SA and AE are recognized so the rejection can name them.
create or replace function public.crm_pool_market_code(p text)
returns text language sql stable as $$
  select code from (values
    ('ID','indonesia'),('ID','republic of indonesia'),('ID','id'),('ID','印度尼西亚'),('ID','印尼'),
    ('VN','vietnam'),('VN','viet nam'),('VN','vn'),('VN','越南'),
    ('TH','thailand'),('TH','th'),('TH','泰国'),
    ('MY','malaysia'),('MY','my'),('MY','马来西亚'),
    ('PH','philippines'),('PH','ph'),('PH','philippine'),('PH','菲律宾'),
    ('SG','singapore'),('SG','sg'),('SG','新加坡'),
    ('KH','cambodia'),('KH','kampuchea'),('KH','kh'),('KH','柬埔寨'),
    ('LA','laos'),('LA','lao'),('LA','lao pdr'),('LA','laos pdr'),('LA','lao peoples democratic republic'),('LA','老挝'),
    ('MM','myanmar'),('MM','burma'),('MM','myanmar burma'),('MM','mm'),('MM','缅甸'),
    ('BN','brunei'),('BN','brunei darussalam'),('BN','bn'),('BN','文莱'),
    ('TL','timor leste'),('TL','east timor'),('TL','tl'),('TL','东帝汶'),
    ('SEA','southeast asia'),('SEA','south east asia'),('SEA','sea'),('SEA','asean'),('SEA','东南亚'),
    ('SA','saudi arabia'),('SA','kingdom of saudi arabia'),('SA','ksa'),('SA','riyadh'),('SA','jeddah'),('SA','沙特'),('SA','沙特阿拉伯'),('SA','利雅得'),('SA','吉达'),
    ('AE','united arab emirates'),('AE','uae'),('AE','dubai'),('AE','abu dhabi'),('AE','阿联酋'),('AE','阿拉伯联合酋长国'),('AE','迪拜'),('AE','阿布扎比')
  ) as market(code, alias)
  where public.crm_pool_norm(alias) = public.crm_pool_norm(p)
  limit 1
$$;

create or replace function public.crm_pool_buyer_code(p text)
returns text language sql stable as $$
  select code from (values
    ('factory','factory'),('factory','factories'),('factory','manufacturer'),('factory','manufacturers'),('factory','mill'),
    ('factory','工厂'),('factory','制造商'),('factory','生产商'),('factory','厂家'),('factory','同行'),
    ('importer','importer'),('importer','importers'),('importer','进口商'),
    ('distributor','distributor'),('distributor','distributors'),('distributor','分销商'),('distributor','经销商'),
    ('wholesaler','wholesaler'),('wholesaler','wholesalers'),('wholesaler','wholesale'),('wholesaler','批发商'),('wholesaler','建材批发商'),
    ('brand','brand'),('brand','brand owner'),('brand','品牌商'),
    ('contractor','contractor'),('contractor','contractors'),('contractor','工程'),('contractor','装修'),('contractor','承包'),('contractor','工程采购'),('contractor','装修公司'),
    ('trade','trade'),('trade','trader'),('trade','trading'),('trade','贸易'),('trade','贸易商'),
    ('other','other'),('other','其他'),('other','其它')
  ) as buyer(code, alias)
  where public.crm_pool_norm(alias) = public.crm_pool_norm(p)
  order by case when code = 'factory' then 0 else 1 end
  limit 1
$$;

create or replace function public.crm_pool_product_hit(p_blob text, p_alias text)
returns boolean language sql immutable as $$
  select case
    when public.crm_pool_norm(p_alias) = '' or public.crm_pool_norm(p_blob) = '' then false
    when public.crm_pool_norm(p_blob) = public.crm_pool_norm(p_alias) then true
    when public.crm_pool_norm(p_alias) = any (regexp_split_to_array(public.crm_pool_norm(p_blob), ' ')) then true
    when public.crm_pool_norm(p_alias) ~ '[一-龥]' then position(replace(public.crm_pool_norm(p_alias), ' ', '') in replace(public.crm_pool_norm(p_blob), ' ', '')) > 0
    when length(public.crm_pool_norm(p_alias)) >= 3 then
      position(public.crm_pool_norm(p_alias) in public.crm_pool_norm(p_blob)) > 0
      or position(replace(public.crm_pool_norm(p_alias), ' ', '') in replace(public.crm_pool_norm(p_blob), ' ', '')) > 0
    else false
  end
$$;

create or replace function public.crm_pool_product_keys(p jsonb)
returns text[] language plpgsql immutable as $$
declare
  blob text := '';
  item text;
  found text[] := '{}';
  generic text[] := '{}';
  rec record;
begin
  if p is null or jsonb_typeof(p) = 'null' then return '{}'; end if;
  if jsonb_typeof(p) = 'array' then
    for item in select jsonb_array_elements_text(p) loop
      blob := blob || E'\n' || item;
    end loop;
  else
    blob := coalesce(p #>> '{}', '');
  end if;
  for rec in select * from (values
    ('laminate','laminate'),('laminate','laminate flooring'),('laminate','强化复合地板'),('laminate','强化地板'),('laminate','强化'),
    ('engineered','engineered'),('engineered','engineered wood'),('engineered','engineered wood flooring'),('engineered','实木复合地板'),('engineered','实木复合'),
    ('spc','spc'),('spc','spc flooring'),('spc','spc石塑地板'),('spc','石塑地板'),
    ('uv_panel','uv panel'),('uv_panel','uv wall panel'),('uv_panel','uv wall'),('uv_panel','uv装饰板'),('uv_panel','uv板'),
    ('pvc_fluted','fluted'),('pvc_fluted','slat wall'),('pvc_fluted','pvc fluted'),('pvc_fluted','长城板'),('pvc_fluted','条形墙板'),
    ('pvc_grille','grille'),('pvc_grille','pvc grille'),('pvc_grille','格栅'),
    ('coex_panel','co extrusion'),('coex_panel','coextrusion'),('coex_panel','共挤墙板'),('coex_panel','共挤'),
    ('wpc_panel','wpc wall'),('wpc_panel','wpc cladding'),('wpc_panel','wpc panel'),('wpc_panel','wpc墙板'),('wpc_panel','外墙挂板'),
    ('pvc_marble','pvc marble'),('pvc_marble','marble panel'),('pvc_marble','仿大理石'),
    ('acoustic','acoustic'),('acoustic','acoustic panel'),('acoustic','吸音板'),('acoustic','吸音'),
    ('wpc_decking','wpc deck'),('wpc_decking','decking'),('wpc_decking','composite decking'),('wpc_decking','户外地板')
  ) as product(key, alias) loop
    if (public.crm_pool_product_hit(blob, rec.alias) or public.crm_pool_norm(blob) = rec.key)
       and not found @> array[rec.key] then
      found := found || rec.key;
    end if;
  end loop;
  if cardinality(found) > 0 then return found; end if;
  for rec in select * from (values
    ('flooring','flooring'),('flooring','floor'),('flooring','地板'),
    ('wall','wall panel'),('wall','wall panels'),('wall','墙板')
  ) as product(key, alias) loop
    if public.crm_pool_product_hit(blob, rec.alias) and not generic @> array[rec.key] then
      generic := generic || rec.key;
    end if;
  end loop;
  return generic;
end
$$;

create or replace function public.crm_client_pool_payload(p public.clients)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'company_name', p.company_name,
    'country', p.country,
    'customer_type', p.customer_type,
    'products', case when p.products is null then '[]'::jsonb else to_jsonb(p.products) end,
    'website', p.website,
    'company_email', p.company_email,
    'company_phone', p.company_phone,
    'whatsapp', p.whatsapp,
    'contact_linkedin', p.contact_linkedin,
    'inquiry_url', p.inquiry_url
  )
$$;

-- Internal. Not granted to anon or authenticated. Triggers and the recycle job call it,
-- including the cron path where there is no end-user JWT.
create or replace function public.crm_evaluate_pool_admission(p jsonb, p_exclude uuid default null)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
  market text;
  buyer text;
  keys text[];
  flags text[] := '{}';
  name text;
  site text;
  mail text;
  phone text;
  wa text;
  link text;
  inquiry text;
  website text;
  entity boolean := false;
  contact boolean := false;
  duplicate boolean := false;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then p := '{}'::jsonb; end if;
  flags := array_append(flags, 'certainty:unconfirmed');
  market := public.crm_pool_market_code(p->>'country');
  if market in ('ID','VN','TH','MY','PH','SG','KH','LA','MM','BN','TL','SEA') then
    flags := array_append(flags, 'market:sea');
  elsif market in ('SA','AE') then
    flags := array_append(flags, 'market:gulf');
  elsif coalesce(btrim(p->>'country'), '') = '' then
    flags := array_append(flags, 'market:unknown');
  else
    flags := array_append(flags, 'market:other');
  end if;
  buyer := public.crm_pool_buyer_code(p->>'customer_type');
  keys := public.crm_pool_product_keys(p->'products');
  if buyer is null or buyer = 'factory' then flags := array_append(flags, 'missing_buyer'); end if;
  if coalesce(cardinality(keys), 0) = 0 then flags := array_append(flags, 'missing_product'); end if;

  name := btrim(coalesce(p->>'company_name', ''));
  site := coalesce(public.norm_domain(p->>'website'), '');
  mail := lower(btrim(coalesce(p->>'company_email', p->>'email', '')));
  if mail !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(mail) > 320 then mail := ''; end if;
  phone := coalesce(public.phone_key(coalesce(p->>'company_phone', p->>'phone')), '');
  wa := coalesce(public.phone_key(p->>'whatsapp'), '');
  link := coalesce(public.crm_linkedin_key(coalesce(p->>'contact_linkedin', p->>'linkedin')), '');
  inquiry := btrim(coalesce(nullif(btrim(coalesce(p->>'inquiry_url', '')), ''), p->>'social_url', ''));
  if inquiry !~* '^https?://[^[:space:]]+$' or char_length(inquiry) > 2048 then inquiry := ''; end if;
  website := btrim(coalesce(p->>'website', ''));
  if site like '%.%' or mail <> '' or phone <> '' or wa <> '' or link <> '' then entity := true; end if;
  if char_length(name) < 2 or not entity then flags := array_append(flags, 'missing_entity'); end if;
  if mail <> '' or phone <> '' or wa <> '' or inquiry <> ''
     or (site like '%.%' and website ~* '(^|/)(contact|inquiry|enquiry|quote|get-in-touch|contact-us)(/|$)') then
    contact := true;
  end if;
  if not contact then flags := array_append(flags, 'missing_contact'); end if;

  duplicate := exists (
    select 1 from public.clients c
    where c.id is distinct from p_exclude
      and (
        (site like '%.%' and (c.domain = site or public.norm_domain(c.website) = site))
        or (mail <> '' and lower(btrim(coalesce(c.company_email, ''))) = mail)
        or (phone <> '' and phone in (c.phone_key, c.phone_key2, public.phone_key(c.company_phone), public.phone_key(c.whatsapp)))
        or (wa <> '' and wa in (c.phone_key, c.phone_key2, public.phone_key(c.company_phone), public.phone_key(c.whatsapp)))
        or (link <> '' and public.crm_linkedin_key(c.contact_linkedin) = link)
        or (char_length(public.name_key(name)) > 3 and c.name_key = public.name_key(name))
      )
  ) or exists (
    select 1 from public.crm_records r
    where r.kind = 'contact' and r.deleted_at is null
      and (p_exclude is null or public.crm_effective_client(r.client_id) is distinct from p_exclude)
      and (
        (mail <> '' and lower(btrim(coalesce(r.data->>'email', ''))) = mail)
        or (link <> '' and public.crm_linkedin_key(r.data->>'linkedin') = link)
        or (phone <> '' and public.phone_key(coalesce(nullif(r.data->>'whatsapp', ''), r.data->>'phone')) = phone)
        or (wa <> '' and public.phone_key(coalesce(nullif(r.data->>'whatsapp', ''), r.data->>'phone')) = wa)
      )
  );
  return jsonb_build_object(
    'ok', not duplicate,
    'flags', to_jsonb(flags),
    'message', case when duplicate then '未写入公海：与已有客户重复（名称、网站、电话、邮箱或 LinkedIn）。' else '' end
  );
end
$$;

create or replace function public.crm_save_pool_admission(p_client uuid, p_eval jsonb, p_source text)
returns void language plpgsql volatile security definer set search_path=public,pg_temp as $$
begin
  if coalesce(p_eval->>'ok', '') <> 'true' then
    raise exception '%', coalesce(p_eval->>'message', '未进入公海');
  end if;
  insert into public.crm_pool_admissions(client_id, source, flags)
  values (
    p_client,
    coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'pool'),
    coalesce(array(select jsonb_array_elements_text(p_eval->'flags')), '{}')
  )
  on conflict (client_id) do nothing;
  update public.clients set pool_admitted_at = coalesce(pool_admitted_at, now()) where id = p_client;
end
$$;

create or replace function public.crm_guard_pool_admission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if tg_op = 'INSERT' then
    new.pool_gate_subject := true;
    if new.owner_id is not null then return new; end if;
    result := public.crm_evaluate_pool_admission(public.crm_client_pool_payload(new), null);
    if coalesce(result->>'ok', '') <> 'true' then raise exception '%', result->>'message'; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.pool_gate_subject := old.pool_gate_subject;
  end if;
  return new;
end
$$;

create or replace function public.crm_record_pool_admission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if tg_op = 'INSERT' and new.owner_id is null then
    result := public.crm_evaluate_pool_admission(public.crm_client_pool_payload(new), new.id);
    perform public.crm_save_pool_admission(new.id, result, case when '自动获客' = any(coalesce(new.tags, '{}')) then 'discovery' else 'client_insert' end);
  elsif tg_op = 'UPDATE' and old.owner_id is not null and new.owner_id is null
        and new.pool_gate_subject is true
        and not exists (select 1 from public.crm_pool_admissions where client_id = new.id) then
    result := public.crm_evaluate_pool_admission(public.crm_client_pool_payload(new), new.id);
    if coalesce(result->>'ok', '') = 'true' then
      perform public.crm_save_pool_admission(new.id, result, 'client_release');
    end if;
  end if;
  return null;
end
$$;

drop trigger if exists crm_guard_pool_admission on public.clients;
create trigger crm_guard_pool_admission before insert or update on public.clients
for each row execute function public.crm_guard_pool_admission();
drop trigger if exists crm_record_pool_admission on public.clients;
create trigger crm_record_pool_admission after insert or update on public.clients
for each row execute function public.crm_record_pool_admission();

create or replace function public.crm_guard_social_pool_admission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if tg_op <> 'INSERT' then return new; end if;
  result := public.crm_evaluate_pool_admission(jsonb_build_object(
    'company_name', new.data->>'company_name',
    'country', new.data->>'country',
    'customer_type', new.data->>'customer_type',
    'products', coalesce(new.data->'products', 'null'::jsonb),
    'website', new.data->>'website',
    'company_email', coalesce(new.data->>'email', new.data->>'company_email'),
    'company_phone', coalesce(new.data->>'phone', new.data->>'company_phone'),
    'whatsapp', new.data->>'whatsapp',
    'contact_linkedin', coalesce(new.data->>'contact_linkedin', new.data->>'linkedin'),
    'inquiry_url', coalesce(nullif(new.data->>'inquiry_url', ''), new.data->>'social_url')
  ), null);
  if coalesce(result->>'ok', '') <> 'true' then raise exception '%', result->>'message'; end if;
  return new;
end
$$;
drop trigger if exists crm_guard_social_pool_admission on public.crm_social_leads;
create trigger crm_guard_social_pool_admission before insert on public.crm_social_leads
for each row execute function public.crm_guard_social_pool_admission();

create or replace function public.crm_preview_pool_admission(p jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.is_active_user() is not true then
    raise exception '请登录启用的账号' using errcode = '42501';
  end if;
  return public.crm_evaluate_pool_admission(p, null);
end
$$;

create or replace function public.crm_set_acquisition_outcome(p_client uuid, p_outcome text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients;
begin
  if public.is_active_user() is not true then
    raise exception '请登录启用的账号' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('unreachable','not_buyer','buyer_hold','quote_or_deal') then
    raise exception '请选择一项获客结果';
  end if;
  select * into customer from public.clients where id = p_client for update;
  if not found then raise exception '客户不存在'; end if;
  if customer.owner_id is null then raise exception '请先领取或分配客户后再记录获客结果'; end if;
  if public.is_admin() is not true and customer.owner_id is distinct from auth.uid() then
    raise exception '只能记录自己负责客户的获客结果' using errcode = '42501';
  end if;
  if public.crm_is_archived(p_client) then raise exception '归档客户不能修改获客结果'; end if;
  update public.clients set
    acquisition_outcome = p_outcome,
    priority = case
      when p_outcome in ('buyer_hold','quote_or_deal') and coalesce(priority, 'C') not in ('A','A+') then 'A'
      else priority
    end
  where id = p_client;
end
$$;

create or replace function public.crm_pool_admission_stats()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_total integer; v_decided integer; v_pending integer; v_promoted integer;
  v_unreachable integer; v_not_buyer integer; v_buyer_hold integer; v_quote integer;
  groups jsonb; best jsonb; miss jsonb;
begin
  if public.is_active_user() is not true or public.is_admin() is not true then
    raise exception '仅管理员可查看公海分级反馈' using errcode = '42501';
  end if;
  select count(*)::integer,
    count(*) filter (where c.acquisition_outcome is not null)::integer,
    count(*) filter (where c.acquisition_outcome is null)::integer,
    count(*) filter (where c.priority in ('A','A+') and c.acquisition_outcome in ('buyer_hold','quote_or_deal'))::integer,
    count(*) filter (where c.acquisition_outcome = 'unreachable')::integer,
    count(*) filter (where c.acquisition_outcome = 'not_buyer')::integer,
    count(*) filter (where c.acquisition_outcome = 'buyer_hold')::integer,
    count(*) filter (where c.acquisition_outcome = 'quote_or_deal')::integer
  into v_total, v_decided, v_pending, v_promoted, v_unreachable, v_not_buyer, v_buyer_hold, v_quote
  from public.crm_pool_admissions a
  join public.clients c on c.id = a.client_id;

  with base as (
    select a.source, a.flags, c.acquisition_outcome as outcome,
      (c.priority in ('A','A+') and c.acquisition_outcome in ('buyer_hold','quote_or_deal')) as promoted
    from public.crm_pool_admissions a
    join public.clients c on c.id = a.client_id
  ), grouped as (
    select 'source'::text as kind, source as code,
      count(*)::integer as total,
      count(*) filter (where outcome is not null)::integer as decided,
      count(*) filter (where outcome is null)::integer as pending,
      count(*) filter (where promoted)::integer as promoted,
      count(*) filter (where outcome = 'unreachable')::integer as unreachable,
      count(*) filter (where outcome = 'not_buyer')::integer as not_buyer,
      count(*) filter (where outcome = 'buyer_hold')::integer as buyer_hold,
      count(*) filter (where outcome = 'quote_or_deal')::integer as quote_or_deal
    from base group by source
    union all
    select 'flag'::text, code,
      count(*)::integer,
      count(*) filter (where outcome is not null)::integer,
      count(*) filter (where outcome is null)::integer,
      count(*) filter (where promoted)::integer,
      count(*) filter (where outcome = 'unreachable')::integer,
      count(*) filter (where outcome = 'not_buyer')::integer,
      count(*) filter (where outcome = 'buyer_hold')::integer,
      count(*) filter (where outcome = 'quote_or_deal')::integer
    from base cross join lateral unnest(flags) as code
    group by code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind, 'code', code, 'total', total, 'decided', decided, 'pending', pending, 'promoted', promoted,
    'unreachable', unreachable, 'not_buyer', not_buyer, 'buyer_hold', buyer_hold, 'quote_or_deal', quote_or_deal
  ) order by kind, code), '[]'::jsonb) into groups from grouped;

  with reason as (
    select code,
      (count(*) filter (where c.acquisition_outcome in ('buyer_hold','quote_or_deal')))::integer as positive,
      (count(*) filter (where c.priority in ('A','A+') and c.acquisition_outcome in ('buyer_hold','quote_or_deal')))::integer as promoted,
      (count(*) filter (where c.acquisition_outcome in ('unreachable','not_buyer')))::integer as negative
    from public.crm_pool_admissions a
    join public.clients c on c.id = a.client_id
    cross join lateral unnest(a.flags) as code
    where c.acquisition_outcome is not null
    group by code
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('code', code, 'positive', positive, 'promoted', promoted, 'negative', negative) order by promoted desc, positive desc, code)
      from (select * from reason order by promoted desc, positive desc, code limit 5) s), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('code', code, 'positive', positive, 'promoted', promoted, 'negative', negative) order by negative desc, code)
      from (select * from reason order by negative desc, code limit 5) s), '[]'::jsonb)
  into best, miss;

  return jsonb_build_object(
    'total', v_total, 'decided', v_decided, 'pending', v_pending, 'promoted', v_promoted,
    'unreachable', v_unreachable, 'not_buyer', v_not_buyer, 'buyer_hold', v_buyer_hold, 'quote_or_deal', v_quote,
    'groups', groups, 'best', best, 'miss', miss
  );
end
$$;

revoke all on function public.crm_pool_norm(text) from public, anon, authenticated;
revoke all on function public.crm_pool_market_code(text) from public, anon, authenticated;
revoke all on function public.crm_pool_buyer_code(text) from public, anon, authenticated;
revoke all on function public.crm_pool_product_hit(text, text) from public, anon, authenticated;
revoke all on function public.crm_pool_product_keys(jsonb) from public, anon, authenticated;
revoke all on function public.crm_client_pool_payload(public.clients) from public, anon, authenticated;
revoke all on function public.crm_evaluate_pool_admission(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.crm_save_pool_admission(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_guard_pool_admission() from public, anon, authenticated;
revoke all on function public.crm_record_pool_admission() from public, anon, authenticated;
revoke all on function public.crm_guard_social_pool_admission() from public, anon, authenticated;
revoke all on function public.crm_preview_pool_admission(jsonb) from public, anon;
revoke all on function public.crm_set_acquisition_outcome(uuid, text) from public, anon;
revoke all on function public.crm_pool_admission_stats() from public, anon;
grant execute on function public.crm_preview_pool_admission(jsonb) to authenticated;
grant execute on function public.crm_set_acquisition_outcome(uuid, text) to authenticated;
grant execute on function public.crm_pool_admission_stats() to authenticated;

-- Keep buyer type and inquiry URL on new shared-pool leads. Edits of old leads are unchanged.
do $save$
declare src text;
begin
  src := pg_get_functiondef('public.crm_social_save(uuid,integer,jsonb)'::regprocedure);
  if position('customer_type' in src) = 0 then
    src := replace(src, '''next_date'',''lead_channel''', '''next_date'',''lead_channel'',''customer_type'',''inquiry_url''');
  end if;
  if position('customer_type' in src) = 0 then
    raise exception '社媒保存字段白名单已变化，已停止';
  end if;
  execute src;
end
$save$;

-- A shared lead becomes a new public-pool client here. Reject it before that insert.
do $release$
declare src text; prelude text; before_release text;
begin
  src := pg_get_functiondef('public.crm_social_release(uuid,integer,text)'::regprocedure);
  if position('crm_save_pool_admission' in src) > 0 then return; end if;
  if position('declare r public.crm_social_leads; cid uuid;' in src) = 0
     or position('insert into clients(company_name,country,website,company_email,company_phone,contact_name,products,tags,status,owner_id,created_by,notes,source_note)' in src) = 0
     or position('perform public.release_client(cid,p_reason);' in src) = 0 then
    raise exception '公海转入函数已变化，已停止';
  end if;
  src := replace(src, 'declare r public.crm_social_leads; cid uuid;',
    'declare r public.crm_social_leads; cid uuid; admission jsonb; specific text[]; inquiry text; mapped text;');
  prelude := $body$
admission := public.crm_evaluate_pool_admission(jsonb_build_object(
  'company_name', r.data->>'company_name',
  'country', r.data->>'country',
  'customer_type', r.data->>'customer_type',
  'products', coalesce(r.data->'products', 'null'::jsonb),
  'website', r.data->>'website',
  'company_email', coalesce(r.data->>'email', r.data->>'company_email'),
  'company_phone', coalesce(r.data->>'phone', r.data->>'company_phone'),
  'whatsapp', r.data->>'whatsapp',
  'contact_linkedin', coalesce(r.data->>'contact_linkedin', r.data->>'linkedin'),
  'inquiry_url', coalesce(nullif(r.data->>'inquiry_url',''), r.data->>'social_url')), null);
if coalesce(admission->>'ok','') <> 'true' then
  raise exception '%', admission->>'message';
end if;
$body$;
  src := replace(src,
    'insert into clients(company_name,country,website,company_email,company_phone,contact_name,products,tags,status,owner_id,created_by,notes,source_note)',
    prelude || 'insert into clients(company_name,country,website,company_email,company_phone,contact_name,products,tags,status,owner_id,created_by,notes,source_note)');
  before_release := $body$
perform public.crm_save_pool_admission(cid, admission, 'social_release');
mapped := case lower(btrim(coalesce(r.data->>'customer_type','')))
  when 'importer' then 'importer' when 'distributor' then 'distributor'
  when 'wholesaler' then 'wholesaler' when 'brand' then 'brand'
  when 'other' then 'other' when 'contractor' then 'other' when 'trade' then 'wholesaler'
  else null end;
specific := array(select x from unnest(public.crm_pool_product_keys(coalesce(r.data->'products','null'::jsonb))) x
  where x in ('laminate','engineered','spc','uv_panel','pvc_fluted','pvc_grille','coex_panel','wpc_panel','pvc_marble','acoustic','wpc_decking'));
inquiry := btrim(coalesce(nullif(btrim(coalesce(r.data->>'inquiry_url','')), ''), nullif(btrim(coalesce(r.data->>'social_url','')), ''), ''));
update public.clients set
  customer_type = coalesce(mapped, customer_type),
  products = case when coalesce(cardinality(specific), 0) > 0 then specific else products end,
  inquiry_url = case when inquiry ~* '^https?://[^[:space:]]+$' and char_length(inquiry) <= 2048 then inquiry else inquiry_url end
where id = cid;
$body$;
  src := replace(src, 'perform public.release_client(cid,p_reason);', before_release || 'perform public.release_client(cid,p_reason);');
  execute src;
end
$release$;

notify pgrst, 'reload schema';

commit;
