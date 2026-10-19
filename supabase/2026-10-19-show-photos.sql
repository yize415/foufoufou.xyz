-- 让「一起看的剧」也能放图片。在 Supabase SQL Editor 里运行一次即可。
alter table public.photos alter column trip_id drop not null;
alter table public.photos add column if not exists show_id uuid references public.shows(id) on delete cascade;
alter table public.photos drop constraint if exists photos_one_owner;
alter table public.photos add constraint photos_one_owner check (num_nonnulls(trip_id, show_id) = 1);
