// Game modes. Ids must match `MODES` in core/src/lib.rs.
//
// A mode is an object with:
//   id, name, cat, desc, spec   menu data
//   tracking  hold fire, scored by time on target (engine samples at 20 Hz)
//   weapon    {mag, interval, reload, pattern, spread}: automatic fire with recoil
//   rounds    round based instead of timed
//   reaction / headshots  which extra stats are meaningful
//   setup(ctx)            props, before the countdown
//   init(ctx)             first targets, when the round starts
//   update(ctx, dt)       every frame
//   onHit(ctx, target, part, point)   a shot hit a target
//   onSurface(ctx, pick)  a shot hit a prop; return true if it counts as a hit
//   onClick(ctx)          return true to consume a click (no raycast)
//
// ctx.diff scales size/speed/time for the chosen difficulty; ctx.preview is
// true while the mode runs as the menu background.

import * as THREE from '../vendor/three.module.min.js';
import { EYE } from './engine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Random point on a target plane, away from existing targets. */
function freeSpot(ctx, { w, h, z, cy = EYE + 0.8, minDist = 1, near = null, nearR = 0 }) {
  let best = null;
  const lo = Math.max(cy - h / 2, 0.7), hi = cy + h / 2; // never below the floor
  for (let i = 0; i < 30; i++) {
    let p;
    if (near) {
      const a = Math.random() * Math.PI * 2;
      const d = ctx.rand(nearR * 0.35, nearR);
      p = V(clamp(near.x + Math.cos(a) * d, -w / 2, w / 2), clamp(near.y + Math.sin(a) * d, lo, hi), z);
    } else {
      p = V(ctx.rand(-w / 2, w / 2), ctx.rand(lo, hi), z);
    }
    const dmin = Math.min(Infinity, ...ctx.targets.map(t => t.obj.position.distanceTo(p)));
    if (dmin >= minDist) return p;
    if (!best || dmin > best.d) best = { p, d: dmin };
  }
  return best.p;
}

/** Points for a kill: base plus a bonus for speed. */
const speedPoints = (base, bonus, ms, fast = 250, slow = 1200) =>
  Math.round(base + bonus * clamp((slow - ms) / (slow - fast), 0, 1));

// CS-like strafing: accelerate towards a wanted velocity, change it at random
// times, sometimes stop dead (counter-strafe).
function strafe(ctx, t, dt, { min, max, speed = 5.2, accel = 38, stopChance = 0.3 }) {
  const d = t.data;
  speed *= ctx.diff.speed;
  d.next = (d.next ?? 0) - dt;
  const x = t.obj.position.x;
  if (d.next <= 0 || (x <= min && d.want < 0) || (x >= max && d.want > 0)) {
    d.next = ctx.rand(0.18, 0.85) / ctx.diff.speed;
    const dir = x <= min ? 1 : x >= max ? -1 : Math.random() < 0.5 ? -1 : 1;
    d.want = Math.random() < stopChance ? 0 : dir * speed * ctx.rand(0.75, 1);
  }
  const dv = (d.want ?? 0) - t.vx;
  t.vx += clamp(dv, -accel * dt, accel * dt);
  t.obj.position.x = clamp(x + t.vx * dt, min - 0.3, max + 0.3);
}

/** Damage for bot hits: head kills, body 55, legs 35 (100 hp). */
function botHit(ctx, t, part, { head, body = 70, reaction }) {
  if (part === 'head') {
    ctx.hit(t, head, { head: true, reaction, feed: `KAFA  +${head}` });
    return true;
  }
  t.hp -= part === 'leg' ? 35 : 55;
  if (t.hp <= 0) { ctx.hit(t, body, { reaction, feed: `+${body}` }); return true; }
  ctx.hit(t, 0, { kill: false, feed: part === 'leg' ? '-35' : '-55' });
  return false;
}

// Spray pattern, degrees (x = yaw, y = pitch) for shots 1..30: climbs for
// ten shots, then pulls left, swings right and settles.
const PATTERN = [
  [0, 0], [0.02, 0.3], [-0.05, 0.75], [0.05, 1.3], [0.1, 1.9], [0.05, 2.5], [-0.1, 3.0], [-0.35, 3.4],
  [-0.6, 3.7], [-0.85, 3.9], [-1.05, 4.05], [-1.2, 4.15], [-1.25, 4.2], [-1.15, 4.25], [-0.9, 4.25],
  [-0.5, 4.3], [-0.05, 4.3], [0.4, 4.35], [0.85, 4.35], [1.2, 4.4], [1.45, 4.4], [1.55, 4.45],
  [1.5, 4.45], [1.3, 4.5], [1.0, 4.5], [0.7, 4.5], [0.45, 4.55], [0.3, 4.55], [0.2, 4.55], [0.15, 4.6],
];

export const MODES = [
  // ------------------------------------------------------------------ CS
  {
    id: 'kafa', name: 'Kafa Avı', cat: 'CS',
    desc: 'Rakipler 10–32 m arasında belirir, bir kısmı strafe atar. Kafa tek mermi, gövde iki.',
    spec: '2 rakip · 10–32 m · 3 sn',
    headshots: true, reaction: true, fireInterval: 100,
    init() { this.timer = 0.3; },
    spawn(ctx) {
      for (let i = 0; i < 20; i++) {
        const pos = V(ctx.rand(-12, 12), 0, -ctx.rand(10, 32));
        if (ctx.targets.every(t => t.obj.position.distanceTo(pos) > 3)) {
          const t = ctx.bot({ pos });
          t.data.moving = Math.random() < 0.55;
          t.data.life = ctx.rand(2.2, 3.2) * ctx.diff.time;
          t.data.min = pos.x - 3; t.data.max = pos.x + 3;
          return;
        }
      }
    },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length < 2) { this.spawn(ctx); this.timer = ctx.rand(0.25, 0.7); }
      for (const t of [...ctx.targets]) {
        if (ctx.time - t.born > t.data.life) { ctx.escaped(t); ctx.feed('KAÇTI', 'bad'); continue; }
        if (t.data.moving) strafe(ctx, t, dt, { min: t.data.min, max: t.data.max, speed: 5, stopChance: 0.3 });
        else t.vx = 0;
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      botHit(ctx, t, part, { head: speedPoints(150, 60, ms, 350, 1800), reaction: ms });
    },
  },
  {
    id: 'kose', name: 'Köşe Tutma', cat: 'CS',
    desc: 'Beton blokların arkasından peek gelir: geniş swing ya da kısa jiggle. Açıyı tut.',
    spec: '5 köşe · 14–32 m · ayak sesi',
    headshots: true, reaction: true, fireInterval: 100,
    setup(ctx) {
      const W = (x, z, w = 3.2) => ({ x, z, w, box: ctx.cover({ x, z, w, h: 2.4 }) });
      this.walls = [W(-7, -14), W(6.5, -18), W(-1.5, -26, 4), W(10, -30), W(-11, -32)];
    },
    init() { this.timer = 0.8; },
    spawn(ctx) {
      const w = ctx.pick(this.walls);
      const side = Math.random() < 0.5 ? -1 : 1;
      const edge = w.x + side * (w.w / 2);
      const hidden = edge - side * 0.6;
      const t = ctx.bot({ pos: V(hidden, 0, w.z - 0.9) });
      const wide = Math.random() < 0.45;
      Object.assign(t.data, {
        side, hidden, phase: 'out', hold: ctx.rand(0.25, 0.8) * ctx.diff.time,
        out: edge + side * (wide ? ctx.rand(1.6, 3) : ctx.rand(0.5, 1)),
        speed: (wide ? 5.4 : 3.6) * ctx.diff.speed,
      });
    },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length === 0) this.spawn(ctx);
      for (const t of [...ctx.targets]) {
        const d = t.data, p = t.obj.position;
        if (d.phase === 'out') {
          t.vx = d.side * d.speed;
          p.x += t.vx * dt;
          if ((p.x - d.out) * d.side >= 0) { p.x = d.out; d.phase = 'hold'; }
        } else if (d.phase === 'hold') {
          t.vx = 0;
          d.hold -= dt;
          if (d.hold <= 0) d.phase = 'back';
        } else {
          t.vx = -d.side * d.speed;
          p.x += t.vx * dt;
          if ((p.x - d.hidden) * d.side <= 0) { ctx.escaped(t); ctx.feed('KAÇTI', 'bad'); this.timer = ctx.rand(0.5, 1.4); }
        }
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      if (botHit(ctx, t, part, { head: speedPoints(150, 80, ms, 300, 1300), reaction: ms })) this.timer = ctx.rand(0.5, 1.5);
    },
  },
  {
    id: 'gecis', name: 'Geçiş', cat: 'CS',
    desc: 'Rakipler duvardaki 3 metrelik boşluktan koşarak geçer. Görünür kalma süresi yarım saniye.',
    spec: 'boşluk 3 m · 18 m · koşu',
    headshots: true, reaction: true, fireInterval: 100,
    setup(ctx) {
      ctx.cover({ x: -7.5, z: -18, w: 12, h: 2.6 });
      ctx.cover({ x: 7.5, z: -18, w: 12, h: 2.6 });
    },
    init() { this.timer = 0.6; },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length === 0) {
        const from = Math.random() < 0.5 ? -1 : 1;
        const t = ctx.bot({ pos: V(from * ctx.rand(3.5, 6), 0, -19) });
        Object.assign(t.data, { dir: -from, speed: ctx.rand(4.8, 5.8) * ctx.diff.speed, stop: ctx.diff.speed > 1 && Math.random() < 0.3, seen: null });
      }
      for (const t of [...ctx.targets]) {
        const d = t.data, p = t.obj.position;
        if (d.seen === null && Math.abs(p.x) < 1.7) d.seen = ctx.time;
        // On hard, some stop in the gap for a moment.
        if (d.stop && Math.abs(p.x) < 0.3) { d.stop = false; d.pause = 0.28; }
        if (d.pause > 0) { d.pause -= dt; t.vx = 0; } else { t.vx = d.dir * d.speed; p.x += t.vx * dt; }
        if (p.x * d.dir > 7) { ctx.escaped(t); ctx.feed('KAÇTI', 'bad'); this.timer = ctx.rand(0.4, 1.2); }
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - (t.data.seen ?? t.born)) * 1000;
      if (botHit(ctx, t, part, { head: speedPoints(160, 80, ms, 150, 600), body: 90, reaction: ms })) this.timer = ctx.rand(0.4, 1.2);
    },
  },
  {
    id: 'uzak', name: 'Uzak Mesafe', cat: 'CS',
    desc: '35–58 m’de duran ya da yürüyen rakipler. Kafa birkaç piksel; acele etmeden tek mermi.',
    spec: '1 rakip · 35–58 m · 3.5 sn',
    headshots: true, reaction: true, fireInterval: 150,
    init() { this.timer = 0.4; },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length === 0) {
        const t = ctx.bot({ pos: V(ctx.rand(-11, 11), 0, -ctx.rand(35, 58)) });
        t.data.life = 3.5 * ctx.diff.time;
        t.data.walk = Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) * 1.4 * ctx.diff.speed : 0;
      }
      for (const t of [...ctx.targets]) {
        if (t.data.walk) { t.vx = t.data.walk; t.obj.position.x = clamp(t.obj.position.x + t.vx * dt, -16, 16); }
        if (ctx.time - t.born > t.data.life) { ctx.escaped(t); ctx.feed('KAÇTI', 'bad'); this.timer = 0.5; }
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      if (botHit(ctx, t, part, { head: speedPoints(200, 60, ms, 500, 2500), body: 60, reaction: ms })) this.timer = ctx.rand(0.3, 0.8);
    },
  },
  {
    id: 'temizle', name: 'Alan Temizle', cat: 'CS',
    desc: 'Her dalgada 3–5 rakip aynı anda çıkar. Hepsini düşürünce yeni dalga; hızlı temizlik bonus verir.',
    spec: 'dalga 3–5 · 12–30 m',
    headshots: true, reaction: true, fireInterval: 100,
    init(ctx) { this.wave = 0; this.timer = 0.2; ctx.stats.extra.waves = 0; },
    update(ctx, dt) {
      if (ctx.targets.length === 0) {
        this.timer -= dt;
        if (this.timer <= 0) {
          const n = 3 + Math.floor(Math.random() * 2) + (ctx.diff.speed > 1 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            let pos;
            for (let k = 0; k < 20; k++) {
              pos = V(ctx.rand(-14, 14), 0, -ctx.rand(12, 30));
              if (ctx.targets.every(t => t.obj.position.distanceTo(pos) > 2.5)) break;
            }
            const t = ctx.bot({ pos });
            t.data.moving = Math.random() < 0.5;
            t.data.min = pos.x - 2.5; t.data.max = pos.x + 2.5;
          }
          this.waveStart = ctx.time;
          this.wave++;
          ctx.hud(`DALGA ${this.wave}`);
        }
      }
      for (const t of ctx.targets) {
        if (t.data.moving) strafe(ctx, t, dt, { min: t.data.min, max: t.data.max, speed: 4.6, stopChance: 0.35 });
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      botHit(ctx, t, part, { head: 120, body: 70, reaction: ms });
      if (ctx.targets.length === 0) {
        const clear = (ctx.time - this.waveStart) * 1000;
        const bonus = Math.max(0, Math.round(600 - clear / 6));
        ctx.stats.score += bonus;
        ctx.stats.extra.waves = this.wave;
        ctx.feed(`DALGA ${(clear / 1000).toFixed(2)} sn  +${bonus}`, 'hs');
        this.timer = 0.7;
      }
    },
  },
  {
    id: 'sprey', name: 'Sprey Kontrol', cat: 'CS',
    desc: 'Otomatik tüfek, 30’luk şarjör. Mermiler yukarı tırmanıp sağa sola kayar; fareyi aşağı çekerek plakada tut.',
    spec: '10 m · 600 atış/dk · 30 mermi',
    weapon: { mag: 30, interval: 100, reload: 2.3, pattern: PATTERN, spread: 0.3 },
    setup(ctx) {
      const pl = ctx.plate({ z: -10, cy: 1.35 });
      this.plate = pl;
      ctx.hud('30 / 30');
    },
    init(ctx) { ctx.stats.extra.mags = 0; },
    onSurface(ctx, p) {
      const o = p.object;
      if (o !== this.plate.body && o !== this.plate.head && o !== this.plate.neck) return false;
      const head = o === this.plate.head;
      const s = ctx.stats;
      s.hits++;
      s.streak++;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      s.score += head ? 30 : 10;
      ctx.sound.steel(head);
      return true;
    },
    onEmpty(ctx) { ctx.stats.extra.mags++; ctx.hud('ŞARJÖR DEĞİŞİYOR'); },
    onReload(ctx) {
      // Fresh plate: clear the holes of the last magazine.
      const eng = ctx.engine;
      for (const d of eng.decals) eng.fx.remove(d);
      eng.decals = [];
      ctx.hud('30 / 30');
    },
    update(ctx) { if (ctx.engine.reloadT <= 0) ctx.hud(`${ctx.engine.ammo} / 30`); },
    onHit() {},
  },

  // ------------------------------------------------------------------ Flick
  {
    id: 'izgara', name: 'Izgara', cat: 'Flick',
    desc: '5×5 ızgarada aynı anda üç hedef. Vurduğun yerin yerine yenisi gelir.',
    spec: '3 hedef · 12 m',
    setup(ctx) { ctx.board({ z: -12.5, w: 8, h: 7, cy: 2.7 }); },
    init(ctx) {
      this.cells = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) this.cells.push(V(i * 1.15, 2.7 + j * 1.15, -12));
      this.lastCell = -1;
      for (let k = 0; k < 3; k++) this.spawn(ctx);
    },
    spawn(ctx) {
      const used = new Set(ctx.targets.map(t => t.data.cell));
      const free = this.cells.map((_, i) => i).filter(i => !used.has(i) && i !== this.lastCell);
      const cell = ctx.pick(free);
      const t = ctx.sphere({ pos: this.cells[cell], r: 0.42 });
      t.data.cell = cell;
    },
    onHit(ctx, t) {
      this.lastCell = t.data.cell;
      ctx.hit(t, 100);
      this.spawn(ctx);
    },
  },
  {
    id: 'merkez', name: 'Merkez Flick', cat: 'Flick',
    desc: 'Önce ortadaki hedef, sonra geniş alanda rastgele biri. Flick at, merkeze geri dön.',
    spec: '1 hedef · 12 m · 3 sn',
    reaction: true,
    setup(ctx) { ctx.board({ z: -12.5, w: 18, h: 7, cy: 2.9 }); },
    init(ctx) { this.center = true; this.spawn(ctx); },
    spawn(ctx) {
      const pos = this.center ? V(0, EYE + 0.4, -12) : freeSpot(ctx, { w: 16, h: 6, z: -12, cy: 2.9, minDist: 2.5 });
      ctx.sphere({ pos, r: 0.38 });
    },
    update(ctx) {
      for (const t of ctx.targets) {
        if (ctx.time - t.born > 3 * ctx.diff.time) { ctx.escaped(t); this.center = !this.center; this.spawn(ctx); break; }
      }
    },
    onHit(ctx, t) {
      const ms = (ctx.time - t.born) * 1000;
      ctx.hit(t, speedPoints(80, 70, ms), { reaction: this.center ? null : ms });
      this.center = !this.center;
      this.spawn(ctx);
    },
  },
  {
    id: 'hareketli', name: 'Hareketli Hedefler', cat: 'Flick',
    desc: 'Üç hedef farklı yön ve hızlarda kayar, kenarlardan seker.',
    spec: '3 hedef · 13 m · 1.6–4.2 m/sn',
    setup(ctx) { ctx.board({ z: -13.5, w: 16, h: 5.6, cy: 2.8 }); },
    init(ctx) { for (let k = 0; k < 3; k++) this.spawn(ctx); },
    spawn(ctx) {
      const t = ctx.sphere({ pos: freeSpot(ctx, { w: 13, h: 4, z: -13, cy: 2.8, minDist: 2 }), r: 0.4 });
      const a = Math.random() * Math.PI * 2;
      const sp = ctx.rand(1.6, 4.2) * ctx.diff.speed;
      t.data.v = V(Math.cos(a) * sp, Math.sin(a) * sp * 0.6, 0);
    },
    update(ctx, dt) {
      for (const t of ctx.targets) {
        const p = t.obj.position, v = t.data.v;
        p.addScaledVector(v, dt);
        if (p.x < -7 || p.x > 7) { v.x *= -1; p.x = clamp(p.x, -7, 7); }
        if (p.y < 0.9 || p.y > 4.7) { v.y *= -1; p.y = clamp(p.y, 0.9, 4.7); }
      }
    },
    onHit(ctx, t) { ctx.hit(t, 110); this.spawn(ctx); },
  },

  // ------------------------------------------------------------------ Precision
  {
    id: 'hassas', name: 'Hassas Altılı', cat: 'Hassasiyet',
    desc: 'Altı küçük hedef. Iskalamak skoru düşürür; hızdan önce temiz atış.',
    spec: '6 hedef · 14 m · r 22 cm',
    setup(ctx) { ctx.board({ z: -14.5, w: 12, h: 6, cy: 2.7 }); },
    init(ctx) { for (let k = 0; k < 6; k++) this.spawn(ctx); },
    spawn(ctx) { ctx.sphere({ pos: freeSpot(ctx, { w: 10, h: 4.6, z: -14, cy: 2.7, minDist: 1 }), r: 0.22 }); },
    onHit(ctx, t) { ctx.hit(t, 120); this.spawn(ctx); },
  },
  {
    id: 'mikro', name: 'Mikro Flick', cat: 'Hassasiyet',
    desc: 'Çok küçük hedefler bir öncekinin yakınında çıkar. Küçük düzeltmeler, tıklama zamanlaması.',
    spec: '1 hedef · 12 m · r 12 cm',
    reaction: true,
    setup(ctx) { ctx.board({ z: -12.5, w: 7, h: 4.4, cy: 2.3 }); },
    init(ctx) { this.last = V(0, 2.3, -12); this.spawn(ctx); },
    spawn(ctx) {
      ctx.sphere({ pos: freeSpot(ctx, { w: 5, h: 3, z: -12, cy: 2.3, near: this.last, nearR: 1.3, minDist: 0 }), r: 0.12 });
    },
    onHit(ctx, t) {
      const ms = (ctx.time - t.born) * 1000;
      this.last = t.obj.position.clone();
      ctx.hit(t, speedPoints(90, 60, ms, 200, 900), { reaction: ms });
      this.spawn(ctx);
    },
  },

  // ------------------------------------------------------------------ Tracking
  {
    id: 'takip', name: 'Pürüzsüz Takip', cat: 'Takip',
    desc: 'Sol tıkı basılı tut, yön değiştiren küreyi takip et. Hedefte kalınan süre puanlanır.',
    spec: 'r 45 cm · 10 m · 2–6.5 m/sn',
    tracking: true, tickScore: 50,
    setup(ctx) { ctx.board({ z: -10.6, w: 14, h: 5.6, cy: 2.8 }); },
    init(ctx) {
      this.t = ctx.sphere({ pos: V(0, 2.4, -10), r: 0.45 });
      this.v = V(3, 0, 0);
      this.want = V(3, 0, 0);
      this.next = 0;
    },
    update(ctx, dt) {
      const p = this.t.obj.position;
      this.next -= dt;
      if (this.next <= 0) {
        this.next = ctx.rand(0.35, 1.2) / ctx.diff.speed;
        const a = Math.random() * Math.PI * 2;
        const sp = ctx.rand(2, 6.5) * ctx.diff.speed;
        this.want.set(Math.cos(a) * sp, Math.sin(a) * sp * 0.55, 0);
      }
      if (p.x < -6 && this.want.x < 0) this.want.x *= -1;
      if (p.x > 6 && this.want.x > 0) this.want.x *= -1;
      if (p.y < 0.9 && this.want.y < 0) this.want.y *= -1;
      if (p.y > 4.7 && this.want.y > 0) this.want.y *= -1;
      this.v.lerp(this.want, 1 - Math.exp(-dt * 4));
      p.addScaledVector(this.v, dt);
    },
    onTrack(ctx, t) {
      const on = !!t && ctx.firing;
      this.t.obj.material = ctx.engine.material(on ? '#f4f1e8' : ctx.settings.targetColor);
    },
    onHit() {},
  },
  {
    id: 'strafe', name: 'Strafe Takip', cat: 'Takip',
    desc: 'ADAD strafe atan rakibi basılı tutarak takip et. Kafada kalmak 1.5 kat puan.',
    spec: '1 rakip · 11 m · 5.4 m/sn',
    tracking: true, tickScore: 45,
    init(ctx) { this.t = ctx.bot({ pos: V(0, 0, -11) }); },
    update(ctx, dt) {
      strafe(ctx, this.t, dt, { min: -5, max: 5, speed: 5.4, stopChance: 0.22 });
      ctx.face(this.t);
    },
    onHit() {},
  },

  // ------------------------------------------------------------------ Speed / decision
  {
    id: 'kuculen', name: 'Küçülen Hedefler', cat: 'Hız',
    desc: 'Hedefler küçülerek kaybolur, tempo giderek artar. Erken vurmak daha çok puan.',
    spec: 'en çok 6 hedef · 1.8 sn ömür',
    reaction: true,
    setup(ctx) { ctx.board({ z: -12.5, w: 14, h: 5.6, cy: 2.8 }); },
    init() { this.timer = 0; },
    update(ctx, dt) {
      const life = 1.8 * ctx.diff.time;
      const progress = ctx.time / Math.max(1, ctx.time + ctx.remaining);
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length < 6) {
        this.timer = (0.75 - 0.4 * progress) * ctx.diff.time;
        const t = ctx.sphere({ pos: freeSpot(ctx, { w: 12, h: 4.4, z: -12, cy: 2.8, minDist: 1.3 }), r: 0.55 });
        t.data.life = life;
      }
      for (const t of [...ctx.targets]) {
        const f = 1 - (ctx.time - t.born) / t.data.life;
        if (f <= 0.03) ctx.escaped(t);
        else t.k = f;
      }
    },
    onHit(ctx, t) {
      ctx.hit(t, Math.round(60 + 100 * t.k), { reaction: (ctx.time - t.born) * 1000 });
    },
  },
  {
    id: 'secim', name: 'Hedef Seçimi', cat: 'Hız',
    desc: 'Kırmızı küreler düşman, mavi küpler dost. Dosta ateş etmek 150 puan götürür.',
    spec: '4 hedef · %40 dost',
    reaction: true,
    setup(ctx) { ctx.board({ z: -13.5, w: 15, h: 6, cy: 2.8 }); },
    init(ctx) { for (let k = 0; k < 4; k++) this.spawn(ctx); },
    spawn(ctx) {
      const enemies = ctx.targets.filter(t => !t.data.friend).length;
      const friend = enemies > 0 && Math.random() < 0.42;
      const pos = freeSpot(ctx, { w: 13, h: 4.6, z: -13, cy: 2.8, minDist: 1.6 });
      const t = friend ? ctx.cube({ pos, r: 0.36, color: '#3b7dd8' }) : ctx.sphere({ pos, r: 0.38, color: '#d83b3b' });
      t.data.friend = friend;
    },
    update(ctx) {
      for (const t of [...ctx.targets]) {
        if (t.data.friend) t.obj.rotation.y += ctx.dt * 1.5;
        if (t.data.friend && ctx.time - t.born > 2.4 * ctx.diff.time) { ctx.remove(t); this.spawn(ctx); }
      }
    },
    onHit(ctx, t) {
      if (t.data.friend) {
        ctx.stats.misses++;
        ctx.penalty(150, 'DOST  -150');
        ctx.kill(t);
      } else {
        const ms = (ctx.time - t.born) * 1000;
        ctx.hit(t, speedPoints(90, 60, ms, 300, 1400), { reaction: ms });
      }
      this.spawn(ctx);
    },
  },

  // ------------------------------------------------------------------ Reaction
  {
    id: 'reaksiyon', name: 'Reaksiyon', cat: 'Reaksiyon',
    desc: 'On tur. Ekran yeşile döndüğü an tıkla; erken tıklamak turu yeniden başlatır.',
    spec: '10 tur · 1.2–3.6 sn bekleme',
    rounds: 10, reaction: true,
    setup(ctx) {
      this.mat = new THREE.MeshBasicMaterial({ color: 0x8f1f1a });
      this.panel = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), this.mat);
      this.panel.position.set(0, 0, -3);
      this.panel.userData.noHit = true;
      ctx.engine.camera.add(this.panel);
      this.round = 0;
      ctx.hud('TUR 0/10');
    },
    init(ctx) { this.next(ctx); },
    next(ctx) {
      this.state = 'wait';
      this.goAt = ctx.time + ctx.rand(1.2, 3.6);
      this.mat.color.set(0x8f1f1a);
      this.goReal = Infinity;
      ctx.message('BEKLE');
    },
    update(ctx) {
      if (this.state === 'wait' && ctx.time >= this.goAt) {
        this.state = 'go';
        this.mat.color.set(0x1d8a43);
        // Measured from the frame that shows green, with event-precise time.
        this.goReal = performance.now();
        ctx.message('ŞİMDİ');
      } else if (this.state === 'shown' && ctx.time >= this.goAt) {
        this.next(ctx);
      }
    },
    onClick(ctx) {
      const s = ctx.stats;
      if (this.state === 'wait') {
        s.shots++;
        ctx.miss();
        ctx.penalty(0, 'ERKEN');
        this.next(ctx);
      } else if (this.state === 'go') {
        const ms = performance.now() - this.goReal;
        s.shots++; s.hits++; s.kills++;
        s.reactions.push(ms);
        s.score += Math.max(0, 1000 - ms);
        s.streak++; s.maxStreak = Math.max(s.maxStreak, s.streak);
        ctx.sound.hit(true);
        this.round++;
        ctx.hud(`TUR ${this.round}/10`);
        this.mat.color.set(0x1d232b);
        ctx.message(`${Math.round(ms)} ms`);
        if (this.round >= this.rounds) { setTimeout(() => ctx.end(), 600); this.state = 'over'; return true; }
        this.state = 'shown';
        this.goAt = ctx.time + 0.9;
      }
      return true;
    },
    onHit() {},
    // Time spent paused must not count as reaction time.
    onResume(ctx, ms) { if (this.state === 'go') this.goReal += ms; },
    teardown(ctx) { ctx.engine.camera.remove(this.panel); ctx.message(''); },
  },
];

export const CATEGORIES = [...new Set(MODES.map(m => m.cat))];
export const byId = id => MODES.find(m => m.id === id);

/** Fixed routines: several modes back to back. */
export const PROGRAMS = [
  { id: 'isinma', name: 'Isınma', desc: 'Maç öncesi 2 dakika: flick, takip, kafa hizası.', steps: [['izgara', 30], ['takip', 30], ['mikro', 30], ['kafa', 30]] },
  { id: 'cs', name: 'CS Rutini', desc: 'Açı tutma, geçiş, sprey ve strafe; 45 saniyelik bloklar.', steps: [['kafa', 45], ['kose', 45], ['gecis', 45], ['sprey', 45], ['strafe', 45]] },
  { id: 'hassasiyet', name: 'Hassasiyet', desc: 'Küçük hedefler ve uzun mesafe.', steps: [['hassas', 45], ['mikro', 45], ['uzak', 45]] },
  { id: 'hiz', name: 'Hız', desc: 'Tempo ve karar: küçülen, hareketli, seçim, reaksiyon.', steps: [['kuculen', 30], ['hareketli', 30], ['secim', 30], ['reaksiyon', 0]] },
];
