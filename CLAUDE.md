# foufoufou.xyz：给 Claude 的说明

这是一对情侣（Yize 和他女朋友）的私人网站「foufou and seeker's snuggery」，用来记录我们的回忆、一起看的剧、想对彼此说的话，还有我们的猫可莉姆（Cream）。网站是公开的，任何人都能浏览，但只有我们俩登录后可以添加和编辑内容。

和我们交流请用中文。我们不是前端工程师：解释时说清楚改了什么、在网站上会看到什么变化，不要堆术语。

## 架构
- **纯静态网页，没有构建步骤**：`index.html`、`styles.css`、`app.js`（ES module）、`config.js`、`seed.js`。不要引入 npm、打包工具或框架。
- **托管**：Cloudflare（Workers 静态资源），连接这个 GitHub 仓库。**推送到 `main` 后一两分钟内自动上线**，没有预览环境，所以推送前要在本地测好。
- **后端**：Supabase（项目 `pvkchonoeuceuyypoctg`）。`config.js` 里的 URL 和 `sb_publishable_...` key 是公开的，可以放在代码里。**永远不要**要求、保存或提交 `service_role` / `secret` key。
- **登录**：邮箱 magic link。名单在 `public.members` 表里，`public.is_member()` 判断当前登录的人在不在名单里。
- **权限（RLS）**：所有内容表都是任何人可读，只有 `is_member()` 为真时可以增、改、删。照片在公开的存储桶 `photos` 里，同样只有名单里的人能上传和删除。
- **防休眠**：`.github/workflows/keepalive.yml` 每天访问一次 Supabase，不要删。

## 数据
- `trips`：回忆。`kind = 'us'` 显示在「我们的回忆」，`kind = 'cat'` 显示在「可莉姆的家」。字段有 `month`（date，取每月 1 号）、`place`、`story`（正文）、`layout`（照片排版：`cover`、`cover-full`、`grid`、`natural`）。
- `shows`：看剧。字段有 `title`、`watched`、`where_watched`、`note`、`quote`。
- `notes`：想说。字段有 `author`、`body`。
- `photos`：照片。`trip_id` 和 `show_id` 两者恰好填一个。`sort` 决定顺序，`sort = 0` 是封面。`path` 以 `assets/` 开头的照片存在仓库里，其余的存在存储桶里。
- 照片在浏览器里压缩（长边 2000px，JPEG 0.85），重绘到 canvas 时会去掉 GPS 等信息。新上传照片的代码要保留这一步。

## 改数据库的规矩
Claude 连不上 Supabase，数据库改动要由我们手动运行：
1. 新建 `supabase/YYYY-MM-DD-简短描述.sql`，写成可以重复运行的形式（`if not exists`、`drop ... if exists`）。
2. 同步更新 `supabase/schema.sql`，让新项目从头建库时结构一致。
3. 新表必须开启 RLS，并照搬现有的「公开可读、名单内可写」策略。
4. 在回复里把要运行的 SQL 直接贴出来，告诉我们去 Supabase → SQL Editor → New query 粘贴运行。**先运行 SQL，再推代码**，否则网站会报错。

## 页面
- 顶部导航是四个标签：我们的回忆（`#trips`）、看剧（`#shows`）、想说（`#notes`）、可莉姆的家（`#cream`）。每个 `main > section.block` 是一个页面，由 `app.js` 里的 `PAGES` 和 `route()` 控制显示哪个。加新页面时要同时改 `index.html` 的导航、新的 `section` 和 `PAGES`。
- 编辑状态统一用 `draft` 对象（`kind` 是 `trip` 或 `show`）。照片排序和封面编辑共用 `photoEditor()`，保存时统一走 `.edit-form` 的 submit。
- 只有 `canEdit()` 为真时才显示添加、编辑、删除按钮。

## 设计
- 配色取自大足石刻照片里的石墙、青苔和锈铁。颜色只用 `styles.css` 里 `:root` 定义的变量，不要另加新颜色。锈红 `--iron` 只用来标日期和当前标签。
- 字体是霞鹜文楷（LXGW WenKai Screen）。标题「foufou / and seeker's / snuggery」分三行，一行比一行淡，最后一行只保留轮廓，这是网站的标志，不要改动。
- 每次改动都要在手机宽度（390px）下检查，整个页面不能出现横向滚动。
- 文案是中文，口吻温柔、简短，不用感叹号堆砌，也不加 emoji。

## 工作方式
- 本地预览：`python3 -m http.server`。`config.js` 留空时会显示 `seed.js` 里的示例内容，可以用来测试布局。
- 有浏览器工具时，推送前给电脑和手机宽度各截一张图看看。
- commit message 写清楚改了什么。改动需要先运行 SQL 的，要在 commit 里注明。
- 不要删除或批量修改已有内容（数据库里的回忆、照片），除非我们明确要求。
