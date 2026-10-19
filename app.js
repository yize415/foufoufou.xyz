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
let data = { trips: [], shows: [], notes: [] };

/* ---------------- data ---------------- */
function photoUrl(path) {
  if (/^(https?:|assets\/)/.test(path)) return path;
  return sb.storage.from(cfg.photoBucket).getPublicUrl(path).data.publicUrl;
}

async function load() {
  if (!sb) { data = structuredClone(window.SEED); return; }
  const [trips, photos, shows, notes] = await Promise.all([
    sb.from("trips").select("*").order("month", { ascending: false }),
    sb.from("photos").select("*").order("sort").order("created_at"),
    sb.from("shows").select("*").order("created_at", { ascending: false }),
    sb.from("notes").select("*").order("created_at", { ascending: false }),
  ]);
  const err = trips.error || photos.error || shows.error || notes.error;
  if (err) { console.error(err); data = structuredClone(window.SEED); return; }
  data = {
    trips: trips.data.map(t => ({ ...t, photos: photos.data.filter(p => p.trip_id === t.id) })),
    shows: shows.data,
    notes: notes.data,
  };
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

function editForm() {
  const d = draft;
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
  <form class="edit-trip" data-id="${esc(d.id)}">
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

    <div class="pe">
      <div class="pe-head">照片顺序<small>第一张是封面。用 ‹ › 调整顺序。</small></div>
      ${d.photos.length ? `<ol class="pe-list">${thumbs}</ol>` : `<p class="empty">还没有照片。</p>`}
      <label class="pe-add">添加照片<input type="file" accept="image/*" multiple data-add-photos></label>
    </div>

    <p class="status" role="status"></p>
    <div class="actions"><button type="button" class="link" data-cancel-edit>取消</button><button type="submit" class="primary">保存</button></div>
  </form>`;
}

function startEdit(id) {
  const t = data.trips.find(x => x.id === id);
  draft = { id, title: t.title, story: t.story || "", layout: t.layout || "cover", photos: t.photos.map(p => ({ ...p })), removed: [] };
  render();
  document.querySelector(".edit-trip textarea")?.focus();
}

function endEdit() {
  draft?.photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview));
  draft = null;
}

function render() {
  const tl = $("#trip-list");
  tl.innerHTML = data.trips.length ? data.trips.map(t => `
    <li class="trip">
      <div class="trip-date">${esc(fmtMonth(t.month))}<small>${esc(t.place || "")}</small></div>
      <div>
        ${draft?.id === t.id ? editForm() : `
          <h3>${esc(t.title)}</h3>
          ${t.story ? `<p class="story">${esc(t.story)}</p>`
            : canEdit() ? `<button class="write" data-edit="${esc(t.id)}">写点什么…</button>` : ""}
          ${photoGrid(t)}
          ${canEdit() ? `<div class="tools"><button class="del" data-edit="${esc(t.id)}">编辑</button>${delBtn("trips", t.id)}</div>` : ""}`}
      </div>
    </li>`).join("") : `<p class="empty">还没有回忆。登录后点「添加一段回忆」，放上第一段。</p>`;

  const sl = $("#show-list");
  sl.innerHTML = data.shows.length ? data.shows.map(s => `
    <li class="show">
      <div><h3>${esc(s.title)}</h3><div class="meta">${esc([s.watched, s.where_watched].filter(Boolean).join("，"))}</div></div>
      <div>${s.note ? `<p>${esc(s.note)}</p>` : ""}${s.quote ? `<q>${esc(s.quote)}</q>` : ""}${delBtn("shows", s.id)}</div>
    </li>`).join("") : `<p class="empty">还没有记下一起看的剧。看完一部，就来添上它。</p>`;

  const nl = $("#note-list");
  nl.innerHTML = data.notes.length ? data.notes.map(n => `
    <li class="note"><p>${esc(n.body)}</p><div class="by">${esc(n.author)}${n.created_at ? `，${new Date(n.created_at).toLocaleDateString("zh-CN")}` : ""}</div>${delBtn("notes", n.id)}</li>`).join("")
    : `<p class="empty">这里留给想对彼此说的话。</p>`;

  document.querySelectorAll(".add").forEach(b => (b.hidden = !(isMember && sb)));
}

/* ---------------- auth ---------------- */
async function refreshAuth() {
  const loginBtn = $("#login-btn"), logoutBtn = $("#logout-btn"), state = $("#auth-state");
  if (!sb) { loginBtn.hidden = true; state.textContent = "示例模式：接上数据库后就可以登录添加内容。"; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    isMember = false; loginBtn.hidden = false; logoutBtn.hidden = true;
    state.textContent = "只有我们俩可以往这里添加内容。";
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

async function uploadPhoto(tripId, file, sort) {
  const blob = await shrink(file);
  const path = `${tripId}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from(cfg.photoBucket).upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const ins = await sb.from("photos").insert({ trip_id: tripId, path, sort });
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
  const { data: trip, error } = await sb.from("trips").insert({
    title: fd.get("title"), month: fd.get("month") + "-01", place: fd.get("place"), story: fd.get("story"),
  }).select().single();
  if (error) throw error;
  const files = fd.getAll("photos").filter(f => f.size);
  for (let i = 0; i < files.length; i++) {
    status.textContent = `正在上传照片 ${i + 1}/${files.length}…`;
    await uploadPhoto(trip.id, files[i], i);
  }
});

wire("#show-form", async fd => {
  const { error } = await sb.from("shows").insert(Object.fromEntries(["title", "watched", "where_watched", "note", "quote"].map(k => [k, fd.get(k)])));
  if (error) throw error;
});

wire("#note-form", async fd => {
  const { error } = await sb.from("notes").insert({ author: fd.get("author"), body: fd.get("body") });
  if (error) throw error;
});

/* ---------------- clicks ---------------- */
document.addEventListener("click", async e => {
  const open = e.target.closest("[data-open]");
  if (open) { $("#" + open.dataset.open).showModal(); return; }

  const edit = e.target.closest("[data-edit]");
  if (edit) { endEdit(); startEdit(edit.dataset.edit); return; }
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
    if (table === "trips") {
      const t = data.trips.find(x => x.id === id);
      const paths = (t?.photos || []).map(p => p.path).filter(p => !/^(https?:|assets\/)/.test(p));
      if (paths.length) await sb.storage.from(cfg.photoBucket).remove(paths);
    }
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) alert("删除失败：" + error.message);
    await load(); render();
  }
});
// 编辑时把输入的文字和排版存进 draft，这样调整照片顺序时不会丢掉正在写的内容
document.addEventListener("input", e => {
  if (!draft || !e.target.closest(".edit-trip")) return;
  const { name, value } = e.target;
  if (name === "title" || name === "story") draft[name] = value;
});
document.addEventListener("change", e => {
  if (!draft) return;
  if (e.target.name === "layout" && e.target.closest(".edit-trip")) draft.layout = e.target.value;
  if (e.target.matches("[data-add-photos]")) {
    for (const file of e.target.files) draft.photos.push({ file, preview: URL.createObjectURL(file) });
    render();
  }
});

document.addEventListener("submit", async e => {
  const form = e.target.closest(".edit-trip");
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector(".primary"), status = form.querySelector(".status");
  btn.disabled = true;
  try {
    const d = draft;
    const up = await sb.from("trips").update({ title: d.title, story: d.story, layout: d.layout }).eq("id", d.id);
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
        await uploadPhoto(d.id, p.file, i);
      } else if (p.sort !== i) {
        const r = await sb.from("photos").update({ sort: i }).eq("id", p.id);
        if (r.error) throw r.error;
      }
    }
    endEdit(); await load(); render();
  } catch (err) {
    console.error(err);
    const hint = /layout/.test(err.message || "") ? "（数据库还没有排版这一项，请先运行更新用的 SQL）" : "";
    status.textContent = `没有保存成功：${err.message || err}${hint}。`;
    btn.disabled = false;
  }
});
$("#photo-viewer").addEventListener("click", e => { if (e.target.id === "photo-viewer") e.target.close(); });
$("#logout-btn").addEventListener("click", async () => { await sb.auth.signOut(); refreshAuth(); });
sb?.auth.onAuthStateChange(() => refreshAuth());

await load();
render();
refreshAuth();
