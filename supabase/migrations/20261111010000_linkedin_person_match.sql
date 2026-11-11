-- Match one visible LinkedIn person against companies and contacts.
-- Review this file before applying it. Do not run it on production until the boss approves.
-- Safe to re-run. It does not scrape, send messages, or call a paid API.
begin;

create or replace function public.crm_linkedin_key(u text)
returns text
language plpgsql
immutable
as $$
declare found text[];
begin
  found := regexp_match(
    lower(regexp_replace(trim(coalesce(u, '')), '[?#].*$', '')),
    'linkedin\.com/(in|company)/([^/?#]+)');
  if found is null or found[1] is null or found[2] is null or found[2] = '' then
    return null;
  end if;
  return found[1] || '/' || lower(found[2]);
end
$$;

-- One lookup for the person currently on screen. Returns at most 10 rows and hides
-- company names the caller cannot already open. It does not create or message anyone.
create or replace function public.crm_match_linkedin_person(
  p_company text,
  p_website text,
  p_phone text,
  p_email text,
  p_linkedin text
)
returns table (
  match text,
  company_name text,
  owner_name text,
  client_id uuid,
  mine boolean,
  writable boolean,
  pool boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := public.name_key(p_company);
  v_domain text := public.norm_domain(p_website);
  v_phone text := public.phone_key(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_linkedin text := public.crm_linkedin_key(p_linkedin);
begin
  if public.is_active_user() is not true then
    raise exception '请先登录有效账号' using errcode = '42501';
  end if;
  if v_email is not null and v_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$' then
    v_email := null;
  end if;
  if v_domain is null and v_phone is null and coalesce(length(v_name), 0) <= 3
     and v_email is null and v_linkedin is null then
    return;
  end if;
  return query
  with hit as (
    select c.id as cid,
      (v_domain is not null and c.domain = v_domain) as by_domain,
      (v_phone is not null and v_phone in (c.phone_key, c.phone_key2)) as by_phone,
      (length(coalesce(v_name, '')) > 3 and c.name_key = v_name) as by_name,
      (v_email is not null and lower(btrim(coalesce(c.company_email, ''))) = v_email) as by_email,
      (v_linkedin is not null and public.crm_linkedin_key(c.contact_linkedin) = v_linkedin) as by_linkedin
    from public.clients c
    where (v_domain is not null and c.domain = v_domain)
       or (v_phone is not null and v_phone in (c.phone_key, c.phone_key2))
       or (length(coalesce(v_name, '')) > 3 and c.name_key = v_name)
       or (v_email is not null and lower(btrim(coalesce(c.company_email, ''))) = v_email)
       or (v_linkedin is not null and public.crm_linkedin_key(c.contact_linkedin) = v_linkedin)
    union all
    select public.crm_effective_client(r.client_id),
      false,
      (v_phone is not null and public.phone_key(coalesce(nullif(r.data->>'whatsapp', ''), r.data->>'phone')) = v_phone),
      false,
      (v_email is not null and lower(btrim(coalesce(r.data->>'email', ''))) = v_email),
      (v_linkedin is not null and public.crm_linkedin_key(r.data->>'linkedin') = v_linkedin)
    from public.crm_records r
    where r.kind = 'contact' and r.deleted_at is null
      and (
        (v_email is not null and lower(btrim(coalesce(r.data->>'email', ''))) = v_email)
        or (v_linkedin is not null and public.crm_linkedin_key(r.data->>'linkedin') = v_linkedin)
        or (v_phone is not null and public.phone_key(coalesce(nullif(r.data->>'whatsapp', ''), r.data->>'phone')) = v_phone)
      )
  ),
  grouped as (
    select hit.cid,
      bool_or(hit.by_domain) as by_domain,
      bool_or(hit.by_phone) as by_phone,
      bool_or(hit.by_name) as by_name,
      bool_or(hit.by_email) as by_email,
      bool_or(hit.by_linkedin) as by_linkedin
    from hit
    where hit.cid is not null
    group by hit.cid
  )
  select concat_ws(' + ',
      case when g.by_linkedin then 'LinkedIn' end,
      case when g.by_email then '邮箱 email' end,
      case when g.by_domain then '网站 domain' end,
      case when g.by_phone then '电话 phone' end,
      case when g.by_name then '名称 name' end),
    case when public.can_see_client(c.id) then c.company_name end,
    coalesce(p.full_name, '公海 Pool'),
    case when public.can_see_client(c.id) then c.id end,
    coalesce(c.owner_id = auth.uid(), false),
    public.is_admin() or coalesce(c.owner_id = auth.uid(), false),
    c.owner_id is null
  from grouped g
  join public.clients c on c.id = g.cid
  left join public.profiles p on p.id = c.owner_id
  where g.by_domain or g.by_phone or g.by_name or g.by_email or g.by_linkedin
  order by (public.is_admin() or c.owner_id = auth.uid()) desc, (c.owner_id = auth.uid()) desc, c.updated_at desc nulls last
  limit 10;
end
$$;

revoke all on function public.crm_linkedin_key(text) from public, anon, authenticated;
revoke all on function public.crm_match_linkedin_person(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.crm_match_linkedin_person(text, text, text, text, text) to authenticated;

commit;
