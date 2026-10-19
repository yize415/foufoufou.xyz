-- 给每段回忆加一个「照片排版」设置。在 Supabase SQL Editor 里运行一次即可。
alter table public.trips add column if not exists layout text not null default 'cover';
