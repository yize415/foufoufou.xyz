-- 给「可莉姆」页面用：回忆分成「我们的回忆」(us) 和「可莉姆」(cat)。在 SQL Editor 里运行一次即可。
alter table public.trips add column if not exists kind text not null default 'us';
