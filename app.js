const cfg = window.SITE_CONFIG || {};
const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

let sb = null;
if (hasDb) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let isMember = false;
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
const delBtn = (table, id) => isMember && sb ? `<button class="del" data-del="${table}" data-id="${esc(id)}">删除</button>` : "";

function render() {
  const tl = $("#trip-list");
  tl.innerHTML = data.trips.length ? data.trips.map(t => `
    <li class="trip">
      <div class="trip-date">${esc(fmtMonth(t.month))}<small>${esc(t.place || "")}</small></div>
      <div>
        <h3>${esc(t.title)}</h3>
        ${t.story ? `<p class="story">${esc(t.story)}</p>` : ""}
        ${t.photos?.length ? `<div class="photos">${t.photos.map(p => `
          <button data-view="${esc(photoUrl(p.path))}" aria-label="查看大图">
            <img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption || t.title)}" loading="lazy">
          </button>`).join("")}</div>` : ""}
        ${delBtn("trips", t.id)}
      </div>
    </li>`).join("") : `<p class="empty">还没有旅行。登录后点「添加一次旅行」，放上第一段回忆。</p>`;

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
    const blob = await shrink(files[i]);
    const path = `${trip.id}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from(cfg.photoBucket).upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const ins = await sb.from("photos").insert({ trip_id: trip.id, path, sort: i });
    if (ins.error) throw ins.error;
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
$("#photo-viewer").addEventListener("click", e => { if (e.target.id === "photo-viewer") e.target.close(); });
$("#logout-btn").addEventListener("click", async () => { await sb.auth.signOut(); refreshAuth(); });
sb?.auth.onAuthStateChange(() => refreshAuth());

await load();
render();
refreshAuth();
