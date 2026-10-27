begin;

create table if not exists public.crm_learning_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 180),
  description text not null default '' check (length(description) <= 4000),
  category text not null check (category in ('新员工入职','公司制度','产品知识','开发流程','其他资料')),
  required boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published')),
  sort_order integer not null default 0,
  external_url text check (external_url is null or external_url ~ '^https://'),
  file_path text,
  file_name text check (file_name is null or length(file_name) <= 180),
  file_size bigint check (file_size is null or file_size between 0 and 20971520),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (external_url is not null or file_path is not null or length(trim(description)) > 0)
);

create table if not exists public.crm_learning_progress (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.crm_learning_materials(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(material_id,user_id)
);

alter table public.crm_learning_materials enable row level security;
alter table public.crm_learning_progress enable row level security;

drop policy if exists crm_learning_material_read on public.crm_learning_materials;
create policy crm_learning_material_read on public.crm_learning_materials
  for select to authenticated using (public.is_active_user() and (status='published' or public.is_admin()));
drop policy if exists crm_learning_material_admin_write on public.crm_learning_materials;
create policy crm_learning_material_admin_write on public.crm_learning_materials
  for all to authenticated using (public.is_active_user() and public.is_admin())
  with check (public.is_active_user() and public.is_admin() and created_by is not null);

drop policy if exists crm_learning_progress_read on public.crm_learning_progress;
create policy crm_learning_progress_read on public.crm_learning_progress
  for select to authenticated using (public.is_active_user() and (user_id=auth.uid() or public.is_admin()));
drop policy if exists crm_learning_progress_insert on public.crm_learning_progress;
create policy crm_learning_progress_insert on public.crm_learning_progress
  for insert to authenticated with check (public.is_active_user() and user_id=auth.uid() and exists (
    select 1 from public.crm_learning_materials m where m.id=material_id and m.status='published'));
drop policy if exists crm_learning_progress_update on public.crm_learning_progress;
create policy crm_learning_progress_update on public.crm_learning_progress
  for update to authenticated using (public.is_active_user() and user_id=auth.uid())
  with check (public.is_active_user() and user_id=auth.uid() and exists (
    select 1 from public.crm_learning_materials m where m.id=material_id and m.status='published'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('crm-learning','crm-learning',false,20971520,
  array['application/pdf','text/plain','text/markdown','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
on conflict (id) do update set public=false,file_size_limit=20971520,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists crm_learning_file_read on storage.objects;
create policy crm_learning_file_read on storage.objects for select to authenticated using (
  bucket_id='crm-learning' and public.is_active_user() and (
    public.is_admin() or exists(select 1 from public.crm_learning_materials m
      where m.id::text=(storage.foldername(name))[1] and m.status='published')));
drop policy if exists crm_learning_file_admin_insert on storage.objects;
create policy crm_learning_file_admin_insert on storage.objects for insert to authenticated with check (
  bucket_id='crm-learning' and public.is_active_user() and public.is_admin());
drop policy if exists crm_learning_file_admin_update on storage.objects;
create policy crm_learning_file_admin_update on storage.objects for update to authenticated
  using (bucket_id='crm-learning' and public.is_active_user() and public.is_admin())
  with check (bucket_id='crm-learning' and public.is_active_user() and public.is_admin());
drop policy if exists crm_learning_file_admin_delete on storage.objects;
create policy crm_learning_file_admin_delete on storage.objects for delete to authenticated
  using (bucket_id='crm-learning' and public.is_active_user() and public.is_admin());

grant select,insert,update,delete on public.crm_learning_materials to authenticated;
grant select,insert,update on public.crm_learning_progress to authenticated;

commit;
