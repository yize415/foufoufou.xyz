-- 在 Supabase 后台 SQL Editor 里整段粘贴运行一次即可。
-- 规则：任何人都能看；只有 members 表里的邮箱登录后能添加和删除。

-- 1. 名单 ---------------------------------------------------------
create table if not exists public.members (
  email text primary key
);
alter table public.members enable row level security;
-- 名单本身不对外公开（没有任何 select 策略）

-- ⚠️ 把下面两个邮箱改成你们自己的
insert into public.members (email) values
  ('yize415@gmail.com'),
  ('HER_EMAIL@example.com')
on conflict do nothing;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_member() to anon, authenticated;

-- 2. 内容表 -------------------------------------------------------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  month date not null,
  place text,
  story text,
  layout text not null default 'cover',
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  path text not null,
  caption text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  watched text,
  where_watched text,
  note text,
  quote text,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- 3. 权限：公开可读，名单内可写 -------------------------------------
do $$
declare t text;
begin
  foreach t in array array['trips','photos','shows','notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('drop policy if exists "members insert" on public.%I', t);
    execute format('drop policy if exists "members update" on public.%I', t);
    execute format('drop policy if exists "members delete" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
    execute format('create policy "members delete" on public.%I for delete to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- 4. 照片存储桶 ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "members upload photos" on storage.objects;
drop policy if exists "members delete photos" on storage.objects;
create policy "members upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "members delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_member());

-- 5. 第一段回忆（照片放在网站代码里的 assets 文件夹）--------------------
with t as (
  insert into public.trips (title, month, place)
  select '一起欣赏大足石刻', '2026-08-01', '重庆大足'
  where not exists (select 1 from public.trips where title = '一起欣赏大足石刻')
  returning id
)
insert into public.photos (trip_id, path, caption)
select id, 'assets/dazu-2026-08.jpg', '大足' from t;
