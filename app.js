import { Sky, DEFAULTS, PARAMS, imageCloud } from "./sky.js";

const cfg = window.SITE_CONFIG || {};
const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

let sb = null;
if (hasDb) {
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (err) {
    console.error("Supabase failed to load, showing local content", err);
  }
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let isMember = false;
let draft = null; // 正在编辑的回忆：{ id, title, story, layout, photos: [...], removed: [] }

const LAYOUTS = [
  ["cover", "大图在前", "第一张裁成横幅，其余是小方块"],
  ["cover-full", "大图完整", "第一张保持原来的比例，不裁切"],
  ["grid", "方格平铺", "所有照片一样大的方块"],
  ["natural", "原比例拼贴", "每张都保持原比例，两列错落排开"],
];
let data = { trips: [], shows: [], notes: [], todos: [], settings: {} };

/* ---------------- data ---------------- */
function photoUrl(path) {
  if (/^(https?:|assets\/)/.test(path)) return path;
  return sb.storage.from(cfg.photoBucket).getPublicUrl(path).data.publicUrl;
}

async function load() {
  await fetchData();
  // 设置面板里正在调的数值，不被重新读取的数据盖掉
  if (!settingsTouched) sky.setConfig(data.settings.todo_canvas || {});
}

async function fetchData() {
  if (!sb) { data = structuredClone(window.SEED); return; }
  const [trips, photos, shows, notes, todos, settings] = await Promise.all([
    sb.from("trips").select("*").order("month", { ascending: false }).order("created_at", { ascending: false }),
    sb.from("photos").select("*").order("sort").order("created_at"),
    sb.from("shows").select("*").order("created_at", { ascending: false }),
    sb.from("notes").select("*").order("created_at", { ascending: false }),
    sb.from("todos").select("*").order("created_at"),
    sb.from("site_settings").select("*"),
  ]);
  const err = trips.error || photos.error || shows.error || notes.error;
  if (err) { console.error(err); data = structuredClone(window.SEED); return; }
  data = {
    trips: trips.data.map(t => ({ ...t, photos: photos.data.filter(p => p.trip_id === t.id) })),
    shows: shows.data.map(x => ({ ...x, photos: photos.data.filter(p => p.show_id === x.id) })),
    notes: notes.data,
    // 「想做的事」的表还没建好时，不影响其它页面
    todos: todos.error ? [] : todos.data.map(x => ({ ...x, photos: photos.data.filter(p => p.todo_id === x.id) })),
    settings: Object.fromEntries((settings.data || []).map(x => [x.key, x.value])),
  };
  if (todos.error) console.warn("todos", todos.error);
}

/* ---------------- render ---------------- */
function fmtMonth(m) {
  if (!m) return "";
  const [y, mo] = m.slice(0, 7).split("-");
  return `${y}年${Number(mo)}月`;
}
const canEdit = () => isMember && Boolean(sb);
const delBtn = (table, id) => isMember && sb ? `<button class="del" data-del="${table}" data-id="${esc(id)}">删除</button>` : "";

function photoGrid(t) {
  if (!t.photos?.length) return "";
  const layout = LAYOUTS.some(([v]) => v === t.layout) ? t.layout : "cover";
  return `<div class="photos layout-${esc(layout)}">${t.photos.map(p => `
    <button data-view="${esc(photoUrl(p.path))}" aria-label="查看大图">
      <img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption || t.title)}" loading="lazy">
    </button>`).join("")}</div>`;
}

function photoEditor(d) {
  const thumbs = d.photos.map((p, i) => `
    <li class="pe-item">
      <img src="${esc(p.preview || photoUrl(p.path))}" alt="">
      ${i === 0 ? `<span class="pe-cover">封面</span>` : ""}
      <div class="pe-tools">
        <button type="button" data-move="-1" data-idx="${i}" ${i === 0 ? "disabled" : ""} aria-label="往前移">‹</button>
        <button type="button" data-move="1" data-idx="${i}" ${i === d.photos.length - 1 ? "disabled" : ""} aria-label="往后移">›</button>
        ${i === 0 ? "" : `<button type="button" data-cover="${i}">设为封面</button>`}
        <button type="button" data-remove="${i}" aria-label="移除这张">×</button>
      </div>
    </li>`).join("");
  return `
    <div class="pe">
      <div class="pe-head">照片顺序<small>第一张是封面。用 ‹ › 调整顺序。</small></div>
      ${d.photos.length ? `<ol class="pe-list">${thumbs}</ol>` : `<p class="empty">还没有照片。</p>`}
      <label class="pe-add">添加照片<input type="file" accept="image/*" multiple data-add-photos></label>
    </div>`;
}

const editActions = `
    <p class="status" role="status"></p>
    <div class="actions"><button type="button" class="link" data-cancel-edit>取消</button><button type="submit" class="primary">保存</button></div>`;

function tripEditForm() {
  const d = draft;
  return `
  <form class="edit-form">
    <input name="title" value="${esc(d.title)}" required aria-label="标题" class="edit-title">
    <textarea name="story" rows="8" aria-label="正文" placeholder="写下这段回忆…">${esc(d.story)}</textarea>
    <fieldset class="layout-pick">
      <legend>照片排版</legend>
      ${LAYOUTS.map(([v, name, desc]) => `
        <label class="lp-opt">
          <input type="radio" name="layout" value="${v}" ${d.layout === v ? "checked" : ""}>
          <span class="lp-icon lp-${v}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span><b>${name}</b><small>${desc}</small></span>
        </label>`).join("")}
    </fieldset>
    ${photoEditor(d)}
    ${editActions}
  </form>`;
}

function showEditForm() {
  const d = draft;
  return `
  <form class="edit-form edit-show">
    <label>剧名<input name="title" value="${esc(d.title)}" required class="edit-title"></label>
    <div class="row">
      <label>什么时候看的<input name="watched" value="${esc(d.watched)}" placeholder="比如：2026年秋天"></label>
      <label>在哪看的<input name="where_watched" value="${esc(d.where_watched)}" placeholder="沙发上 / 视频连线"></label>
    </div>
    <label>我们怎么评价<textarea name="note" rows="4">${esc(d.note)}</textarea></label>
    <label>一句台词或梗<input name="quote" value="${esc(d.quote)}"></label>
    ${photoEditor(d)}
    ${editActions}
  </form>`;
}

const DRAFT_FIELDS = { trip: ["title", "story", "layout"], show: ["title", "watched", "where_watched", "note", "quote"] };

function startEdit(kind, id) {
  const src = (kind === "trip" ? data.trips : data.shows).find(x => x.id === id);
  draft = { kind, id, photos: src.photos.map(p => ({ ...p })), removed: [] };
  for (const f of DRAFT_FIELDS[kind]) draft[f] = src[f] || "";
  if (kind === "trip") draft.layout ||= "cover";
  render();
  document.querySelector(".edit-form textarea")?.focus();
}

function endEdit() {
  draft?.photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview));
  draft = null;
}

const editing = (kind, id) => draft?.kind === kind && draft.id === id;
const editBtn = (kind, id) => `<button class="del" data-edit="${kind}:${esc(id)}">编辑</button>`;

function showItem(x) {
  if (editing("show", x.id)) return `<li class="show show-editing">${showEditForm()}</li>`;
  const [cover, ...rest] = x.photos || [];
  const img = p => `<button data-view="${esc(photoUrl(p.path))}" aria-label="查看大图"><img src="${esc(photoUrl(p.path))}" alt="${esc(x.title)}" loading="lazy"></button>`;
  return `
    <li class="show">
      <div class="show-side">
        ${cover ? `<div class="show-cover">${img(cover)}</div>` : ""}
        <h3>${esc(x.title)}</h3>
        <div class="meta">${esc([x.watched, x.where_watched].filter(Boolean).join("，"))}</div>
      </div>
      <div>
        ${x.note ? `<p>${esc(x.note)}</p>` : ""}${x.quote ? `<q>${esc(x.quote)}</q>` : ""}
        ${rest.length ? `<div class="show-thumbs">${rest.map(img).join("")}</div>` : ""}
        ${canEdit() ? `<div class="tools">${editBtn("show", x.id)}${delBtn("shows", x.id)}</div>` : ""}
      </div>
    </li>`;
}

function render() {
  const memory = t => `
    <li class="trip">
      <div class="trip-date">${esc(fmtMonth(t.month))}<small>${esc(t.place || "")}</small></div>
      <div>
        ${editing("trip", t.id) ? tripEditForm() : `
          <h3>${esc(t.title)}</h3>
          ${t.story ? `<p class="story">${esc(t.story)}</p>`
            : canEdit() ? `<button class="write" data-edit="trip:${esc(t.id)}">写点什么…</button>` : ""}
          ${photoGrid(t)}
          ${canEdit() ? `<div class="tools">${editBtn("trip", t.id)}${delBtn("trips", t.id)}</div>` : ""}`}
      </div>
    </li>`;
  const ours = data.trips.filter(t => (t.kind || "us") === "us");
  const cream = data.trips.filter(t => t.kind === "cat");
  $("#trip-list").innerHTML = ours.length ? ours.map(memory).join("")
    : `<p class="empty">还没有回忆。登录后点「添加一段回忆」，放上第一段。</p>`;
  $("#cream-list").innerHTML = cream.length ? cream.map(memory).join("")
    : `<p class="empty">还没有可莉姆的记录。登录后点「添加一条记录」，放上它的第一张照片。</p>`;

  const sl = $("#show-list");
  sl.innerHTML = data.shows.length ? data.shows.map(showItem).join("")
    : `<p class="empty">还没有记下一起看的剧。看完一部，就来添上它。</p>`;

  const nl = $("#note-list");
  nl.innerHTML = data.notes.length ? data.notes.map(n => `
    <li class="note"><p>${esc(n.body)}</p><div class="by">${esc(n.author)}${n.created_at ? `，${new Date(n.created_at).toLocaleDateString("zh-CN")}` : ""}</div>${delBtn("notes", n.id)}</li>`).join("")
    : `<p class="empty">这里留给想对彼此说的话。</p>`;

  document.querySelectorAll(".add").forEach(b => (b.hidden = !(isMember && sb)));
  renderTodos();
}

/* ---------------- auth ---------------- */
async function refreshAuth() {
  const loginBtn = $("#login-btn"), logoutBtn = $("#logout-btn"), state = $("#auth-state");
  if (!sb) { loginBtn.hidden = true; state.textContent = "示例模式：接上数据库后就可以登录添加内容。"; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    isMember = false; loginBtn.hidden = false; logoutBtn.hidden = true;
    state.textContent = "会魔法的巫师请书写我们的篇章";
  } else {
    const { data: ok } = await sb.rpc("is_member");
    isMember = Boolean(ok);
    loginBtn.hidden = true; logoutBtn.hidden = false;
    state.textContent = isMember ? `已登录：${session.user.email}` : `${session.user.email} 不在名单里，只能浏览。`;
  }
  render();
}

/* ---------------- photos ---------------- */
async function shrink(file, max = 2000, quality = 0.85) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  // 重新绘制到 canvas 会丢掉原图的 GPS 等信息
  return new Promise(r => c.toBlob(r, "image/jpeg", quality));
}

// owner 是 { trip_id }、{ show_id } 或 { todo_id }
async function uploadPhoto(owner, file, sort) {
  const blob = await shrink(file);
  const folder = owner.show_id ? `shows/${owner.show_id}` : owner.todo_id ? `todos/${owner.todo_id}` : owner.trip_id;
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from(cfg.photoBucket).upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const ins = await sb.from("photos").insert({ ...owner, path, sort });
  if (ins.error) throw ins.error;
}
const isLocalAsset = path => /^(https?:|assets\/)/.test(path);

/* ---------------- forms ---------------- */
function wire(formId, handler) {
  const form = $(formId);
  form.addEventListener("submit", async e => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    const btn = form.querySelector(".primary"), status = form.querySelector(".status");
    btn.disabled = true; status.textContent = "";
    try {
      const done = await handler(new FormData(form), status);
      if (done !== false) { form.reset(); form.closest("dialog").close(); await load(); render(); }
    } catch (err) {
      console.error(err);
      status.textContent = `没有保存成功：${err.message || err}。请稍后再试。`;
    } finally { btn.disabled = false; }
  });
}

wire("#login-form", async (fd, status) => {
  const { error } = await sb.auth.signInWithOtp({ email: fd.get("email"), options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  status.textContent = "登录链接已发送，去邮箱点开它就好。";
  return false;
});

wire("#trip-form", async (fd, status) => {
  const row = { title: fd.get("title"), month: fd.get("month") + "-01", place: fd.get("place"), story: fd.get("story") };
  if (fd.get("kind") === "cat") row.kind = "cat"; // 「我们的回忆」不写 kind，用数据库默认值
  const { data: trip, error } = await sb.from("trips").insert(row).select().single();
  if (error) throw error;
  const files = fd.getAll("photos").filter(f => f.size);
  for (let i = 0; i < files.length; i++) {
    status.textContent = `正在上传照片 ${i + 1}/${files.length}…`;
    await uploadPhoto({ trip_id: trip.id }, files[i], i);
  }
});

wire("#show-form", async (fd, status) => {
  const { data: show, error } = await sb.from("shows")
    .insert(Object.fromEntries(DRAFT_FIELDS.show.map(k => [k, fd.get(k)]))).select().single();
  if (error) throw error;
  const files = fd.getAll("photos").filter(f => f.size);
  for (let i = 0; i < files.length; i++) {
    status.textContent = `正在上传图片 ${i + 1}/${files.length}…`;
    await uploadPhoto({ show_id: show.id }, files[i], i);
  }
});

wire("#note-form", async fd => {
  const { error } = await sb.from("notes").insert({ author: fd.get("author"), body: fd.get("body") });
  if (error) throw error;
});

/* ---------------- clicks ---------------- */
document.addEventListener("click", async e => {
  if (todoClick(e)) return;
  const open = e.target.closest("[data-open]");
  if (open) {
    if (open.dataset.kind) {
      const cat = open.dataset.kind === "cat";
      $("#trip-form [name=kind]").value = open.dataset.kind;
      $("#trip-dialog-title").textContent = cat ? "添加可莉姆的记录" : "添加一段回忆";
      $("#trip-form [name=title]").placeholder = cat ? "比如：第一次见到可莉姆" : "比如：一起欣赏大足石刻";
    }
    $("#" + open.dataset.open).showModal(); return;
  }

  const edit = e.target.closest("[data-edit]");
  if (edit) { const [kind, id] = edit.dataset.edit.split(":"); endEdit(); startEdit(kind, id); return; }
  if (e.target.closest("[data-cancel-edit]")) { endEdit(); render(); return; }

  if (draft) {
    const ph = draft.photos;
    const mv = e.target.closest("[data-move]");
    if (mv) { const i = +mv.dataset.idx, j = i + +mv.dataset.move; [ph[i], ph[j]] = [ph[j], ph[i]]; render(); return; }
    const cv = e.target.closest("[data-cover]");
    if (cv) { ph.unshift(...ph.splice(+cv.dataset.cover, 1)); render(); return; }
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      const [p] = ph.splice(+rm.dataset.remove, 1);
      if (p.id) draft.removed.push(p); else if (p.preview) URL.revokeObjectURL(p.preview);
      render(); return;
    }
  }

  const view = e.target.closest("[data-view]");
  if (view) { const d = $("#photo-viewer"); $("img", d).src = view.dataset.view; d.showModal(); return; }

  const del = e.target.closest("[data-del]");
  if (del && confirm("确定删除吗？删除后找不回来。")) {
    const table = del.dataset.del, id = del.dataset.id;
    if (table === "trips" || table === "shows" || table === "todos") {
      const item = data[table].find(x => x.id === id);
      const paths = (item?.photos || []).map(p => p.path).filter(p => !isLocalAsset(p));
      if (paths.length) await sb.storage.from(cfg.photoBucket).remove(paths);
    }
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) alert("删除失败：" + error.message);
    else if (table === "todos" && id === openId) closeTodo();
    await load(); render();
  }
});
// 编辑时把输入的文字和排版存进 draft，这样调整照片顺序时不会丢掉正在写的内容
document.addEventListener("input", e => {
  if (!draft || !e.target.closest(".edit-form")) return;
  const { name, value } = e.target;
  if (DRAFT_FIELDS[draft.kind].includes(name) && name !== "layout") draft[name] = value;
});
document.addEventListener("change", e => {
  if (!draft) return;
  if (e.target.name === "layout" && e.target.closest(".edit-form")) draft.layout = e.target.value;
  if (e.target.matches("[data-add-photos]")) {
    for (const file of e.target.files) draft.photos.push({ file, preview: URL.createObjectURL(file) });
    render();
  }
});

document.addEventListener("submit", async e => {
  const form = e.target.closest(".edit-form");
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector(".primary"), status = form.querySelector(".status");
  btn.disabled = true;
  try {
    const d = draft;
    const table = d.kind === "trip" ? "trips" : "shows";
    const owner = d.kind === "trip" ? { trip_id: d.id } : { show_id: d.id };
    const up = await sb.from(table).update(Object.fromEntries(DRAFT_FIELDS[d.kind].map(f => [f, d[f]]))).eq("id", d.id);
    if (up.error) throw up.error;

    for (const p of d.removed) {
      const r = await sb.from("photos").delete().eq("id", p.id);
      if (r.error) throw r.error;
      if (!isLocalAsset(p.path)) await sb.storage.from(cfg.photoBucket).remove([p.path]);
    }

    const newCount = d.photos.filter(p => p.file).length;
    let uploaded = 0;
    for (let i = 0; i < d.photos.length; i++) {
      const p = d.photos[i];
      if (p.file) {
        status.textContent = `正在上传照片 ${++uploaded}/${newCount}…`;
        await uploadPhoto(owner, p.file, i);
      } else if (p.sort !== i) {
        const r = await sb.from("photos").update({ sort: i }).eq("id", p.id);
        if (r.error) throw r.error;
      }
    }
    endEdit(); await load(); render();
  } catch (err) {
    console.error(err);
    const hint = /layout|show_id|kind/.test(err.message || "") ? "（数据库还缺新字段，请先运行更新用的 SQL）" : "";
    status.textContent = `没有保存成功：${err.message || err}${hint}。`;
    btn.disabled = false;
  }
});
$("#photo-viewer").addEventListener("click", e => { if (e.target.id === "photo-viewer") e.target.close(); });
$("#logout-btn").addEventListener("click", async () => { await sb.auth.signOut(); refreshAuth(); });
sb?.auth.onAuthStateChange(() => refreshAuth());

/* ---------------- 想做的事 ---------------- */
const sky = new Sky($("#sky"), $("#sky-canvas"), { onOpen: (id, at) => openTodo(id, at) });
const motionOK = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
let openId = null, cloudFx = null, settingsTouched = false;
const todoImage = t => t.photos?.[0] ? photoUrl(t.photos[0].path) : null;
const fmtDay = ts => new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

function renderTodos() {
  const active = data.todos.filter(t => !t.done_at);
  const done = data.todos.filter(t => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
  sky.setInset(canEdit() ? 72 : 0);
  sky.setTodos(active.map(t => ({ id: t.id, title: t.title, image: todoImage(t) })));
  $("#sky-empty").hidden = active.length > 0;
  // 给读屏软件和键盘用的清单，画布本身读不出来
  $("#todo-sr").innerHTML = active.map(t => `<li><button data-todo-open="${esc(t.id)}">${esc(t.title)}</button></li>`).join("");
  $("#done").hidden = !done.length;
  $("#done-list").innerHTML = done.map(t => {
    const img = todoImage(t);
    return `
    <li class="done-item">
      ${img ? `<button class="done-thumb" data-view="${esc(img)}" aria-label="查看图片"><img src="${esc(img)}" alt="" loading="lazy"></button>` : ""}
      <div class="done-text"><span class="done-title">${esc(t.title)}</span><small>${esc(fmtDay(t.done_at))}做完</small></div>
      ${canEdit() ? `<div class="tools"><button class="del" data-todo-undo="${esc(t.id)}">放回天上</button>${delBtn("todos", t.id)}</div>` : ""}
    </li>`;
  }).join("");
  $("#sky-add").hidden = $("#sky-more").hidden = !canEdit();
  if (!canEdit()) toggleSettings(false);
}

function renderWindow() {
  const dlg = $("#todo-window"), t = data.todos.find(x => x.id === openId);
  cloudFx?.stop(); cloudFx = null;
  if (!t) { closeTodo(); return; }
  const img = todoImage(t);
  dlg.innerHTML = `
    <div class="tw">
      <button class="tw-close" data-todo-close aria-label="关闭">×</button>
      ${canEdit() ? `<input class="tw-title" value="${esc(t.title)}" maxlength="40" aria-label="想做的事，点这里可以改" data-todo-title>`
        : `<h3 class="tw-title">${esc(t.title)}</h3>`}
      ${img ? `<div class="tw-img"><img src="${esc(img)}" alt="" crossorigin="anonymous"><canvas aria-hidden="true"></canvas></div>` : ""}
      ${canEdit() ? `
        <label class="tw-upload">${img ? "换一张图片" : "上传图片"}<input type="file" accept="image/*" data-todo-photo></label>
        <div class="tw-actions">${delBtn("todos", t.id)}<button class="primary" data-todo-done>做完了</button></div>` : ""}
      <p class="status" role="status"></p>
    </div>`;
  const im = $(".tw-img img", dlg);
  im?.addEventListener("load", () => {
    $(".tw-img", dlg).style.aspectRatio = `${im.naturalWidth} / ${im.naturalHeight}`;
    cloudFx?.stop();
    cloudFx = imageCloud($(".tw-img canvas", dlg), im);
  }, { once: true });
}

// 点开气泡：窗口从气泡的位置放大出来
function openTodo(id, at) {
  const dlg = $("#todo-window");
  openId = id;
  renderWindow();
  if (!dlg.open) dlg.showModal();
  if (at && motionOK()) {
    const r = dlg.getBoundingClientRect();
    dlg.style.transformOrigin = `${at.x - r.left}px ${at.y - r.top}px`;
    dlg.animate([{ transform: "scale(.12)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

function closeTodo() {
  const dlg = $("#todo-window");
  if (!dlg.open) return;
  if (!motionOK()) { dlg.close(); return; }
  dlg.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.7)" }], { duration: 220, easing: "ease-in" })
    .onfinish = () => dlg.close();
}
$("#todo-window").addEventListener("close", () => { cloudFx?.stop(); cloudFx = null; openId = null; });
$("#todo-window").addEventListener("click", e => { if (e.target.id === "todo-window") closeTodo(); });

function windowStatus(text) { const st = $("#todo-window .status"); if (st) st.textContent = text; }
const sqlHint = err => /todo|site_settings/.test(err.message || "") ? "（数据库还没建好「想做的事」的表，请先运行更新用的 SQL）" : "";

async function saveTodoTitle(input) {
  const t = data.todos.find(x => x.id === openId), title = input.value.trim();
  if (!t) return;
  if (!title || title === t.title) { input.value = t.title; return; }
  const { error } = await sb.from("todos").update({ title }).eq("id", t.id);
  if (error) { windowStatus(`没有改成功：${error.message}${sqlHint(error)}。`); return; }
  t.title = title;
  renderTodos();
  windowStatus("改好了。");
}

async function setTodoDone(id, done) {
  const { error } = await sb.from("todos").update({ done_at: done ? new Date().toISOString() : null }).eq("id", id);
  if (error) {
    if (done) windowStatus(`没有保存成功：${error.message}${sqlHint(error)}。`); else alert("没有保存成功：" + error.message);
    return;
  }
  if (done) closeTodo();
  await load(); render();
}

async function uploadTodoPhoto(file) {
  const t = data.todos.find(x => x.id === openId);
  if (!t) return;
  windowStatus("正在上传图片…");
  try {
    const old = t.photos || [];
    await uploadPhoto({ todo_id: t.id }, file, 0);
    for (const p of old) {
      const r = await sb.from("photos").delete().eq("id", p.id);
      if (r.error) throw r.error;
      if (!isLocalAsset(p.path)) await sb.storage.from(cfg.photoBucket).remove([p.path]);
    }
    await load(); render(); renderWindow();
  } catch (err) {
    console.error(err);
    windowStatus(`没有上传成功：${err.message || err}${sqlHint(err)}。`);
  }
}

function todoClick(e) {
  const t = e.target;
  const open = t.closest("[data-todo-open]");
  if (open) { openTodo(open.dataset.todoOpen); return true; }
  if (t.closest("[data-todo-close]")) { closeTodo(); return true; }
  if (t.closest("[data-todo-done]")) { t.closest("button").disabled = true; setTodoDone(openId, true); return true; }
  const undo = t.closest("[data-todo-undo]");
  if (undo) { setTodoDone(undo.dataset.todoUndo, false); return true; }
  if (t.closest("#sky-more")) { toggleSettings(); return true; }
  if (t.closest("[data-sky-reset]")) { settingsTouched = true; sky.setConfig(DEFAULTS); renderSettings(); saveSettings(); return true; }
  if (!$("#sky-settings").hidden && !t.closest("#sky-settings")) toggleSettings(false);
  return false;
}

document.addEventListener("change", e => {
  if (e.target.matches("[data-todo-title]")) saveTodoTitle(e.target);
  if (e.target.matches("[data-todo-photo]") && e.target.files[0]) uploadTodoPhoto(e.target.files[0]);
  if (e.target.matches("[data-sky]")) saveSettings();
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches("[data-todo-title]")) e.target.blur();
});

$("#sky-add").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, input = form.elements.title, btn = form.querySelector("button");
  const title = input.value.trim();
  if (!title) return;
  btn.disabled = true;
  const { error } = await sb.from("todos").insert({ title });
  btn.disabled = false;
  if (error) { alert(`没有放上去：${error.message}${sqlHint(error)}。`); return; }
  input.value = "";
  await load(); render();
});

/* 右上角三个点：调气泡和粒子。调好的样子存进数据库，来看的人看到的也是这样 */
const fmtParam = (k, v) => k === "particleOpacity" ? `${Math.round(v * 100)}%` : String(+(+v).toFixed(2));
function renderSettings() {
  const c = sky.cfg;
  $("#sky-settings").innerHTML = `
    <h4>设置</h4>
    ${PARAMS.map(([k, name, min, max, step]) => `
      <label>${name}
        <span class="sky-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${c[k]}" data-sky="${k}"><output>${fmtParam(k, c[k])}</output></span>
      </label>`).join("")}
    <div class="sky-set-foot"><button type="button" class="link" data-sky-reset>恢复默认</button><small class="status" role="status"></small></div>`;
}
function toggleSettings(show) {
  const panel = $("#sky-settings"), btn = $("#sky-more");
  show ??= panel.hidden;
  if (show) renderSettings();
  panel.hidden = !show;
  btn.setAttribute("aria-expanded", String(show));
}
document.addEventListener("input", e => {
  if (!e.target.matches("[data-sky]")) return;
  settingsTouched = true;
  const k = e.target.dataset.sky;
  sky.setConfig({ ...sky.cfg, [k]: +e.target.value });
  e.target.nextElementSibling.textContent = fmtParam(k, e.target.value);
});
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const st = $("#sky-settings .status");
    const value = { ...sky.cfg };
    const { error } = await sb.from("site_settings").upsert({ key: "todo_canvas", value, updated_at: new Date().toISOString() });
    if (!st) return;
    st.textContent = error ? `没有保存：${error.message}${sqlHint(error)}` : "已保存";
    if (!error) data.settings.todo_canvas = value;
  }, 500);
}

/* ---------------- pages ---------------- */
const PAGES = ["trips", "shows", "notes", "todos", "cream"];
function route() {
  if (location.hash === "#klim") history.replaceState(null, "", "#cream"); // 旧链接
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "trips";
  document.querySelectorAll("main > .block").forEach(sec => (sec.hidden = sec.id !== page));
  sky.setActive(page === "todos");
  document.querySelectorAll(".tabs a").forEach(a => {
    if (a.getAttribute("href") === "#" + page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", () => {
  route();
  // 切换页面时停在导航栏下面，而不是跳回页面最顶上
  const nav = $(".tabs");
  if (nav.getBoundingClientRect().top < 0 || window.scrollY > nav.offsetTop) window.scrollTo({ top: nav.offsetTop });
});
route();

await load();
render();
refreshAuth();
