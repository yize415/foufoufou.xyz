// 「想做的事」页面的天空：浅蓝的天、飘着的云、装着待办的气泡。
// 这里只负责画和动，读写数据库在 app.js 里。

export const DEFAULTS = { bubbleSize: 143, speed: 1, particleSize: 1.4, particleCount: 400, particleOpacity: 0.6 };
// [字段, 名字, 最小, 最大, 步长]
export const PARAMS = [
  ["bubbleSize", "气泡大小", 50, 200, 1],
  ["speed", "流动速度", 0, 3, 0.05],
  ["particleSize", "粒子大小", 0.5, 4, 0.1],
  ["particleCount", "粒子数量", 40, 800, 10],
  ["particleOpacity", "粒子透明度", 0.05, 1, 0.05],
];

const TAU = Math.PI * 2;
const ZH = '"Ma Shan Zheng", "Kaiti SC", "STKaiti", serif';
const EN = '"Ms Madi", cursive';
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

export function loadFonts(text) {
  return Promise.all([
    document.fonts.load(`32px "Ma Shan Zheng"`, text),
    document.fonts.load(`32px "Ms Madi"`, text),
  ]).catch(() => {});
}

// 把待办的文字排进气泡：中文一个字一个字断行，英文单词不拆开，放不下就缩小字号
function layoutText(ctx, text, r) {
  const tokens = [];
  let space = false;
  for (const ch of text.trim()) {
    if (/\s/.test(ch)) { space = true; continue; }
    const zh = CJK.test(ch);
    const last = tokens[tokens.length - 1];
    if (!zh && last && !last.zh && !space) last.chars.push(ch);
    else tokens.push({ zh, chars: [ch], space });
    space = false;
  }
  const maxW = r * 1.3, maxH = r * 1.15;
  const attempt = (F, force) => {
    const lineH = F * 1.3, spaceW = F * 0.38;
    const lines = [];
    let line = null;
    for (const t of tokens) {
      const glyphs = t.chars.map(ch => {
        const font = t.zh ? `${F}px ${ZH}` : `${(F * 1.5).toFixed(1)}px ${EN}`;
        ctx.font = font;
        return { ch, font, w: ctx.measureText(ch).width + F * (t.zh ? 0.06 : 0.16) };
      });
      const w = glyphs.reduce((s, g) => s + g.w, 0);
      if (w > maxW && !force) return null;
      const gap = line && line.items.length && t.space ? spaceW : 0;
      if (!line || (line.items.length && line.w + gap + w > maxW)) {
        line = { items: [], w: 0 };
        lines.push(line);
      } else line.w += gap;
      for (const g of glyphs) { g.x = line.w + g.w / 2; line.w += g.w; line.items.push(g); }
    }
    if (lines.length * lineH > maxH && !force) return null;
    const out = [];
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * lineH;
      for (const g of l.items) out.push({ ch: g.ch, font: g.font, x: g.x - l.w / 2, y, ox: 0, oy: 0, vx: 0, vy: 0 });
    });
    return { glyphs: out, w: Math.max(0, ...lines.map(l => l.w)), h: lines.length * lineH };
  };
  for (let F = r * 0.32; F > 9; F *= 0.92) {
    const res = attempt(F);
    if (res) return res;
  }
  return attempt(9, true);
}

function cloudSprite(w) {
  const h = Math.round(w * 0.5);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const n = 7;
  for (let i = 0; i < n; i++) {
    const k = Math.sin(Math.PI * i / (n - 1));
    const cx = w * (0.16 + 0.68 * i / (n - 1)) + rand(-0.03, 0.03) * w;
    const cy = h * (0.64 - k * 0.2) + rand(-0.04, 0.04) * h;
    const rr = w * rand(0.12, 0.17) * (0.65 + 0.6 * k);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    grad.addColorStop(0, "rgba(255,255,255,.9)");
    grad.addColorStop(0.55, "rgba(255,255,255,.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  return c;
}

class Bubble {
  constructor(sky, todo) {
    this.sky = sky;
    this.id = todo.id;
    this.title = null;
    this.imageUrl = null;
    this.imgData = null;
    const a = rand(0, TAU);
    this.dx = Math.cos(a); this.dy = Math.sin(a);
    this.base = rand(0.22, 0.4);
    this.alpha = 0; this.grow = 1; this.leaving = false;
    this.particles = []; this.glyphs = []; this.cloud = [];
    this.tw = 0; this.th = 0; this.layoutR = 0; this.particleR = 0;
  }

  setTitle(title) {
    this.title = title;
    this.relayout();
  }

  relayout() {
    const r = this.sky.r;
    const t = layoutText(this.sky.ctx, this.title || "", r);
    this.glyphs = t.glyphs; this.tw = t.w; this.th = t.h; this.layoutR = r;
  }

  syncParticles() {
    const r = this.sky.r, want = Math.round(this.sky.cfg.particleCount);
    if (this.particleR && this.particleR !== r) {
      const k = r / this.particleR;
      for (const p of this.particles) { p.x *= k; p.y *= k; }
    }
    this.particleR = r;
    while (this.particles.length > want) this.particles.pop();
    while (this.particles.length < want) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * r;
      const v = rand(0, TAU);
      this.particles.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, vx: Math.cos(v) * 0.3, vy: Math.sin(v) * 0.3, s: rand(0.6, 1.4) });
    }
    if (this.imgData) this.sampleImage();
  }

  setImage(url) {
    this.imageUrl = url;
    this.imgData = null; this.cloud = [];
    if (!url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.imageUrl !== url) return;
      const S = 160, c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d");
      const k = Math.max(S / img.width, S / img.height);
      g.drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
      try { this.imgData = g.getImageData(0, 0, S, S); } catch { return; } // 图片不允许读取像素时，就不做点云
      this.sampleImage();
    };
    img.src = url;
  }

  // 按高斯分布从图片里取点：中间密，四周稀
  sampleImage() {
    const { data, width: S } = this.imgData;
    const want = Math.round(this.sky.cfg.particleCount * 1.5);
    const pts = [];
    for (let tries = 0; pts.length < want && tries < want * 4; tries++) {
      const nx = gauss() * 0.36, ny = gauss() * 0.36;
      if (nx * nx + ny * ny > 0.9) continue;
      const px = Math.floor((nx + 1) / 2 * S), py = Math.floor((ny + 1) / 2 * S);
      const i = (py * S + px) * 4;
      if (data[i + 3] < 40) continue;
      pts.push({ nx, ny, ox: 0, oy: 0, vx: 0, vy: 0, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
    this.cloud = pts;
  }

  update(dt, mouse) {
    const sky = this.sky, r = sky.r, cfg = sky.cfg, speed = cfg.speed * (reduced.matches ? 0.3 : 1);
    if (this.layoutR !== r) this.relayout();
    if (this.particleR !== r || this.particles.length !== Math.round(cfg.particleCount)) this.syncParticles();

    // 气泡本身：匀速漂，碰墙只换方向
    const step = this.base * speed * dt;
    this.x += this.dx * step; this.y += this.dy * step;
    const m = r * 0.85;
    if (this.x < m) { this.x = m; this.dx = Math.abs(this.dx); }
    if (this.x > sky.W - m) { this.x = sky.W - m; this.dx = -Math.abs(this.dx); }
    if (this.y < m) { this.y = m; this.dy = Math.abs(this.dy); }
    if (this.y > sky.H - sky.inset - m) { this.y = Math.max(m, sky.H - sky.inset - m); this.dy = -Math.abs(this.dy); }

    const mx = mouse ? mouse.x - this.x : 0, my = mouse ? mouse.y - this.y : 0;
    const R = 70 * sky.scale, wander = 0.3 * speed + 0.03, damp = Math.pow(0.94, dt);
    const ax = this.tw * 0.55 + 8, ay = this.th * 0.6 + 8;
    for (const p of this.particles) {
      p.vx += (Math.random() - 0.5) * 0.08 * dt;
      p.vy += (Math.random() - 0.5) * 0.08 * dt;
      // 文字周围少放一些粒子，字才看得清
      const ex = p.x / ax, ey = p.y / ay, e2 = ex * ex + ey * ey;
      if (e2 < 1) {
        const d = Math.hypot(p.x, p.y) || 1, f = (1 - e2) * 0.07 * dt;
        p.vx += p.x / d * f; p.vy += p.y / d * f;
      }
      if (mouse) {
        const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
        if (d < R && d > 0.01) { const f = (1 - d / R) * 1.6 * dt; p.vx += dx / d * f; p.vy += dy / d * f; }
      }
      if (Math.hypot(p.vx, p.vy) > wander) { p.vx *= damp; p.vy *= damp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = Math.hypot(p.x, p.y);
      if (d > r) {
        const nx = p.x / d, ny = p.y / d, vr = p.vx * nx + p.vy * ny;
        p.x = nx * r; p.y = ny * r;
        if (vr > 0) { p.vx -= 2 * vr * nx; p.vy -= 2 * vr * ny; }
      }
    }

    // 每个字自己躲开鼠标，再弹回原位
    const R2 = 48 * sky.scale, gd = Math.pow(0.86, dt);
    for (const g of this.glyphs) {
      if (mouse) {
        const dx = g.x + g.ox - mx, dy = g.y + g.oy - my, d = Math.hypot(dx, dy);
        if (d < R2 && d > 0.01) { const f = (1 - d / R2) * 2.2 * dt; g.vx += dx / d * f; g.vy += dy / d * f; }
      }
      g.vx += -g.ox * 0.05 * dt; g.vy += -g.oy * 0.05 * dt;
      g.vx *= gd; g.vy *= gd;
      g.ox += g.vx * dt; g.oy += g.vy * dt;
    }

    // 图片点云：围着自己的采样点轻轻晃，被鼠标推开后回来
    const cd = Math.pow(0.88, dt);
    for (const p of this.cloud) {
      p.vx += (Math.random() - 0.5) * 0.06 * dt - p.ox * 0.03 * dt;
      p.vy += (Math.random() - 0.5) * 0.06 * dt - p.oy * 0.03 * dt;
      if (mouse) {
        const dx = p.nx * r + p.ox - mx, dy = p.ny * r + p.oy - my, d = Math.hypot(dx, dy);
        if (d < R && d > 0.01) { const f = (1 - d / R) * 1.4 * dt; p.vx += dx / d * f; p.vy += dy / d * f; }
      }
      p.vx *= cd; p.vy *= cd;
      p.ox += p.vx * dt; p.oy += p.vy * dt;
    }

    if (this.leaving) { this.alpha -= 0.03 * dt; this.grow += 0.012 * dt; return this.alpha > 0; }
    this.alpha = Math.min(1, this.alpha + 0.025 * dt);
    return true;
  }

  draw(ctx) {
    const sky = this.sky, r = sky.r, cfg = sky.cfg;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.grow, this.grow);

    ctx.globalAlpha = this.alpha;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
    halo.addColorStop(0, "rgba(255,255,255,.55)");
    halo.addColorStop(0.55, "rgba(255,255,255,.2)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, TAU); ctx.fill();

    const s = cfg.particleSize * Math.sqrt(sky.scale);
    ctx.globalAlpha = cfg.particleOpacity * this.alpha;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (const p of this.particles) { const ps = s * p.s; ctx.moveTo(p.x + ps, p.y); ctx.arc(p.x, p.y, ps, 0, TAU); }
    ctx.fill();

    if (this.cloud.length) {
      ctx.globalAlpha = Math.min(1, cfg.particleOpacity + 0.3) * this.alpha;
      const cs = s * 1.5;
      for (const p of this.cloud) { ctx.fillStyle = p.c; ctx.fillRect(p.nx * r + p.ox - cs / 2, p.ny * r + p.oy - cs / 2, cs, cs); }
    }

    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = sky.ink;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // 有图片点云时给字描一圈白边，免得被彩色的点盖住
    const outline = this.cloud.length > 0;
    if (outline) { ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 4 * sky.scale; ctx.lineJoin = "round"; }
    let font = "";
    for (const g of this.glyphs) {
      if (g.font !== font) { ctx.font = g.font; font = g.font; }
      if (outline) ctx.strokeText(g.ch, g.x + g.ox, g.y + g.oy);
      ctx.fillText(g.ch, g.x + g.ox, g.y + g.oy);
    }
    ctx.restore();
  }
}

export class Sky {
  constructor(panel, canvas, { onOpen }) {
    this.panel = panel; this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.onOpen = onOpen;
    this.cfg = { ...DEFAULTS };
    this.bubbles = new Map();
    this.sparks = []; this.clouds = [];
    this.hue = this.targetHue = 205;
    this.mouse = null; this.active = false; this.raf = 0; this.last = 0;
    this.W = 0; this.H = 0; this.scale = 1; this.inset = 0;
    this.frame = this.frame.bind(this);

    new ResizeObserver(() => this.resize()).observe(panel);
    const move = e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (this.mouse && Math.hypot(x - this.mouse.x, y - this.mouse.y) > 2) this.spark(x, y);
      this.mouse = { x, y };
      canvas.style.cursor = this.hit(x, y) ? "pointer" : "";
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", move);
    const leave = e => { if (e.type === "pointerleave" || e.pointerType !== "mouse") this.mouse = null; };
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerup", leave);
    canvas.addEventListener("pointercancel", leave);
    canvas.addEventListener("click", e => {
      const rect = canvas.getBoundingClientRect();
      const b = this.hit(e.clientX - rect.left, e.clientY - rect.top);
      if (b) this.onOpen(b.id, { x: rect.left + b.x, y: rect.top + b.y });
      else this.shiftHue();
    });
    document.addEventListener("visibilitychange", () => this.run());
    document.fonts?.addEventListener?.("loadingdone", () => this.bubbles.forEach(b => b.relayout()));
  }

  get r() { return this.cfg.bubbleSize * 0.6 * this.scale; }
  get ink() { return `hsl(${this.hue + 8}, 55%, 27%)`; }

  setConfig(cfg) { this.cfg = { ...DEFAULTS, ...cfg }; this.resize(); }

  setInset(px) { this.inset = px; }

  setActive(on) { this.active = on; this.resize(); this.run(); }

  run() {
    const go = this.active && !document.hidden;
    if (go && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
    if (!go && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  resize() {
    const W = this.panel.clientWidth;
    if (!W) return;
    this.scale = clamp(W / 820, 0.6, 1);
    const n = [...this.bubbles.values()].filter(b => !b.leaving).length;
    const base = clamp(innerHeight * 0.72, 440, 700);
    const need = n * (2 * this.r) ** 2 * 1.7 / W + this.inset;
    const H = Math.round(Math.max(base, Math.min(need, 1800)));
    if (Math.abs(this.panel.clientHeight - H) > 1) this.panel.style.height = H + "px";
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (this.W !== W || this.H !== H || this.dpr !== dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
      this.makeClouds();
    }
    // 页面隐藏时加进来的气泡还没有位置，等有了宽度再放
    for (const b of this.bubbles.values()) if (b.x == null) this.place(b);
  }

  makeClouds() {
    const n = clamp(Math.round(this.W / 220), 3, 6);
    if (this.clouds.length === n) return;
    this.clouds = Array.from({ length: n }, (_, i) => {
      const w = Math.round(rand(200, 340) * this.scale);
      return {
        img: cloudSprite(w), w, h: w * 0.5,
        x: rand(-w, this.W), y: (i + rand(0.1, 0.8)) / n * this.H - w * 0.25,
        vx: rand(0.05, 0.16), a: rand(0.55, 0.9),
      };
    });
  }

  // list: [{ id, title, image }]
  setTodos(list) {
    const ids = new Set(list.map(t => t.id));
    for (const b of this.bubbles.values()) if (!ids.has(b.id)) b.leaving = true;
    for (const t of list) {
      let b = this.bubbles.get(t.id);
      if (b && b.leaving) { b.leaving = false; b.grow = 1; }
      if (!b) {
        b = new Bubble(this, t);
        this.bubbles.set(t.id, b);
        this.resize();
      }
      if (b.title !== t.title) b.setTitle(t.title);
      if (b.imageUrl !== (t.image || null)) b.setImage(t.image || null);
    }
    loadFonts(list.map(t => t.title).join("")).then(() => this.bubbles.forEach(b => b.relayout()));
    this.resize();
  }

  // 找一个离其它气泡最远的位置放新气泡
  place(b) {
    if (!this.W) return;
    const r = this.r, others = [...this.bubbles.values()].filter(o => o !== b && o.x != null);
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const x = rand(r, Math.max(r + 1, this.W - r)), y = rand(r, Math.max(r + 1, this.H - this.inset - r));
      const d = Math.min(Infinity, ...others.map(o => Math.hypot(o.x - x, o.y - y)));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    b.x = best.x; b.y = best.y;
  }

  hit(x, y) {
    const r = this.r * 0.85;
    const list = [...this.bubbles.values()].reverse();
    return list.find(b => !b.leaving && Math.hypot(b.x - x, b.y - y) < r);
  }

  // 点背景换一种天色，只在浅蓝里变
  shiftHue() {
    let h;
    do h = rand(192, 216); while (Math.abs(h - this.targetHue) < 6);
    this.targetHue = h;
  }

  spark(x, y) {
    for (let i = 0; i < 2; i++) {
      this.sparks.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-0.3, 0.3), vy: rand(-0.45, 0.1), life: 1, s: rand(0.8, 2.4), h: this.hue + rand(-9, 9) });
    }
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
  }

  collide(dt) {
    const list = [...this.bubbles.values()].filter(b => !b.leaving && b.x != null);
    const min = this.r * 1.7;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.01) { dx = 1; dy = 0; d = 1; }
      const nx = dx / d, ny = dy / d;
      // 重叠的部分慢慢推开
      const push = (min - d) * 0.5 * Math.min(1, 0.06 * dt);
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      // 交换法线方向的速度，再把各自的速度大小还原：只改方向，不加速
      const vax = a.dx * a.base, vay = a.dy * a.base, vbx = b.dx * b.base, vby = b.dy * b.base;
      const vn = (vax - vbx) * nx + (vay - vby) * ny;
      if (vn <= 0) continue;
      const turn = (o, vx, vy) => {
        const s = Math.hypot(vx, vy);
        if (s < 1e-4) { [o.dx, o.dy] = [-o.dy, o.dx]; return; }
        o.dx = vx / s; o.dy = vy / s;
      };
      turn(a, vax - vn * nx, vay - vn * ny);
      turn(b, vbx + vn * nx, vby + vn * ny);
    }
  }

  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(3, (now - this.last) / 16.67);
    this.last = now;
    const { ctx, W, H } = this;
    if (!W) return;
    this.hue += (this.targetHue - this.hue) * Math.min(1, 0.03 * dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `hsl(${this.hue}, 74%, 68%)`);
    bg.addColorStop(1, `hsl(${this.hue - 4}, 80%, 88%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const drift = (reduced.matches ? 0.3 : 1) * (0.3 + this.cfg.speed * 0.7);
    for (const c of this.clouds) {
      c.x += c.vx * drift * dt;
      if (c.x > W) c.x = -c.w;
      ctx.globalAlpha = c.a;
      ctx.drawImage(c.img, c.x, c.y, c.w, c.h);
    }

    for (const [id, b] of this.bubbles) if (b.x != null && !b.update(dt, this.mouse)) this.bubbles.delete(id);
    this.collide(dt);
    for (const b of this.bubbles.values()) if (b.x != null) b.draw(ctx);

    this.sparks = this.sparks.filter(s => (s.life -= 0.022 * dt) > 0);
    for (const s of this.sparks) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      ctx.globalAlpha = s.life * 0.9;
      ctx.fillStyle = `hsl(${s.h}, 90%, 96%)`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill();
    }
  }
}

// 弹窗里的图片点云：和图片一样大，中间密四周稀，有一个自己绕圈的力场轻轻拨动它
export function imageCloud(canvas, img) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, pts = [], raf = 0, t = 0, mouse = null, last = performance.now();
  function setup() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const off = document.createElement("canvas");
    off.width = Math.round(W); off.height = Math.round(H);
    const g = off.getContext("2d");
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    g.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    let data;
    try { data = g.getImageData(0, 0, off.width, off.height).data; } catch { pts = []; return; }
    const want = clamp(Math.round(W * H / 80), 600, 2800);
    pts = [];
    for (let tries = 0; pts.length < want && tries < want * 3; tries++) {
      const x = W / 2 + gauss() * W * 0.22, y = H / 2 + gauss() * H * 0.22;
      if (x < 0 || y < 0 || x >= off.width || y >= off.height) continue;
      const i = (Math.floor(y) * off.width + Math.floor(x)) * 4;
      pts.push({ ax: x, ay: y, x, y, vx: 0, vy: 0, s: rand(0.8, 1.9), c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(3, (now - last) / 16.67);
    last = now; t += dt;
    ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.18;
    const fields = [{ x: W / 2 + Math.cos(t * 0.012) * W * 0.32, y: H / 2 + Math.sin(t * 0.017) * H * 0.3 }];
    if (mouse) fields.push(mouse);
    const damp = Math.pow(0.88, dt);
    for (const p of pts) {
      for (const f of fields) {
        const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy);
        if (d < R && d > 0.01) { const k = (1 - d / R) * 1.2 * dt; p.vx += dx / d * k; p.vy += dy / d * k; }
      }
      p.vx += (p.ax - p.x) * 0.03 * dt; p.vy += (p.ay - p.y) * 0.03 * dt;
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
  }
  const move = e => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const leave = () => { mouse = null; };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  const go = () => { setup(); if (!raf) raf = requestAnimationFrame(frame); };
  if (img.complete && img.naturalWidth) go(); else img.addEventListener("load", go, { once: true });
  return {
    stop() {
      cancelAnimationFrame(raf); raf = 0;
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      img.removeEventListener("load", go);
    },
  };
}
