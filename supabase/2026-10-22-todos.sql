-- 「想做的事」页面：待办表、待办的图片、页面设置。在 Supabase SQL Editor 里运行一次即可，重复运行也没关系。

-- 1. 待办。done_at 为空时飘在天上，填了时间就收进「做过的事」
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2. 网站设置（气泡大小、粒子数量这些），来看的人看到的就是这里存的样子
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3. 照片也可以属于一件想做的事
alter table public.photos add column if not exists todo_id uuid references public.todos(id) on delete cascade;
alter table public.photos drop constraint if exists photos_one_owner;
alter table public.photos add constraint photos_one_owner check (num_nonnulls(trip_id, show_id, todo_id) = 1);

-- 4. 权限：公开可读，名单内可写
do $$
declare t text;
begin
  foreach t in array array['todos','site_settings'] loop
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

-- 5. 第一批想做的事（表里已经有内容时不会重复添加）
insert into public.todos (title, created_at)
select title, now() + n * interval '1 second'
from (values ('去日本', 1), ('玩 Slay the Spire', 2), ('恋爱小甜剧', 3), ('Puzzle Hunt', 4), ('语言学', 5)) as v(title, n)
where not exists (select 1 from public.todos);
