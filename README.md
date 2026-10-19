# foufoufou.xyz

一起走过的地方，一起看过的剧，想对彼此说的话。

- 纯静态网页（index.html / styles.css / app.js），由 Cloudflare Pages 托管，无需构建
- 数据、照片、登录：Supabase（`supabase/schema.sql`）
- `config.js` 填 Supabase 地址和 anon key；留空时显示 `seed.js` 的示例内容
- 任何人可浏览；只有 `members` 表里的邮箱登录后可添加/删除
- `.github/workflows/keepalive.yml` 每天访问一次 Supabase，防止免费项目休眠

本地预览：`python3 -m http.server` 然后打开 http://localhost:8000
