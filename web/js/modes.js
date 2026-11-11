// Game modes. Ids must match `MODES` in core/src/lib.rs.
//
// A mode is an object with:
//   id, name, cat, desc, glyph       menu data
//   tracking  hold fire, scored by time on target (engine samples at 20 Hz)
//   auto      holding fire keeps shooting (fireInterval ms between shots)
//   rounds    round based instead of timed
//   reaction / headshots  which extra stats are meaningful
//   setup(ctx)            before the countdown (props)
//   init(ctx)             when the round starts
//   update(ctx, dt)       every frame
//   onHit(ctx, target, part, point)   a shot hit a target
//   onClick(ctx)          return true to consume a click (no raycast)

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

/** Points for a click kill: base plus a bonus for speed. */
const speedPoints = (base, bonus, ms, fast = 250, slow = 1200) =>
  Math.round(base + bonus * clamp((slow - ms) / (slow - fast), 0, 1));

// CS-like strafing: accelerate towards a wanted velocity, change it at random
// times, sometimes stop dead (counter-strafe).
function strafe(ctx, t, dt, { min, max, speed = 5.2, accel = 38, stopChance = 0.3 }) {
  const d = t.data;
  d.next = (d.next ?? 0) - dt;
  const x = t.obj.position.x;
  if (d.next <= 0 || (x <= min && d.want < 0) || (x >= max && d.want > 0)) {
    d.next = ctx.rand(0.18, 0.85);
    const dir = x <= min ? 1 : x >= max ? -1 : Math.random() < 0.5 ? -1 : 1;
    d.want = Math.random() < stopChance ? 0 : dir * speed * ctx.rand(0.75, 1);
  }
  const dv = (d.want ?? 0) - t.vx;
  t.vx += clamp(dv, -accel * dt, accel * dt);
  t.obj.position.x = clamp(x + t.vx * dt, min - 0.3, max + 0.3);
}

export const MODES = [
  {
    id: 'izgara', name: 'Izgara', cat: 'Flick', glyph: '▦',
    desc: '5×5 ızgarada aynı anda 3 hedef. Hızlı ve temiz flick, hedef geçişi.',
    reaction: false,
    init(ctx) {
      const cells = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) cells.push(V(i * 1.15, 2.7 + j * 1.15, -12));
      this.cells = cells;
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
    id: 'hassas', name: 'Hassas Altılı', cat: 'Hassasiyet', glyph: '⁘',
    desc: '6 küçük hedef rastgele yerlerde. Acele etme, her mermi sayılır.',
    init(ctx) { for (let k = 0; k < 6; k++) this.spawn(ctx); },
    spawn(ctx) { ctx.sphere({ pos: freeSpot(ctx, { w: 10, h: 4.6, z: -14, minDist: 1 }), r: 0.22 }); },
    onHit(ctx, t) { ctx.hit(t, 120); this.spawn(ctx); },
  },
  {
    id: 'merkez', name: 'Merkez Flick', cat: 'Flick', glyph: '✣',
    desc: 'Önce merkezdeki hedef, sonra geniş alanda rastgele bir hedef. Flick + geri dönüş.',
    reaction: true,
    init(ctx) { this.center = true; this.spawn(ctx); },
    spawn(ctx) {
      const pos = this.center ? V(0, EYE, -12) : freeSpot(ctx, { w: 16, h: 6, z: -12, cy: EYE + 1.2, minDist: 2.5 });
      ctx.sphere({ pos, r: 0.38 });
    },
    update(ctx) {
      for (const t of ctx.targets) if (ctx.time - t.born > 3) { ctx.escaped(t); this.center = !this.center; this.spawn(ctx); }
    },
    onHit(ctx, t) {
      const ms = (ctx.time - t.born) * 1000;
      ctx.hit(t, speedPoints(80, 70, ms), { reaction: this.center ? null : ms });
      this.center = !this.center;
      this.spawn(ctx);
    },
  },
  {
    id: 'mikro', name: 'Mikro Flick', cat: 'Hassasiyet', glyph: '·',
    desc: 'Çok küçük hedefler birbirine yakın çıkar. Mikro düzeltme ve tıklama zamanlaması.',
    reaction: true,
    init(ctx) { this.last = V(0, EYE, -12); this.spawn(ctx); },
    spawn(ctx) {
      const pos = freeSpot(ctx, { w: 5, h: 3, z: -12, cy: EYE, near: this.last, nearR: 1.3, minDist: 0 });
      ctx.sphere({ pos, r: 0.12 });
    },
    onHit(ctx, t) {
      const ms = (ctx.time - t.born) * 1000;
      this.last = t.obj.position.clone();
      ctx.hit(t, speedPoints(90, 60, ms, 200, 900), { reaction: ms });
      this.spawn(ctx);
    },
  },
  {
    id: 'hareketli', name: 'Hareketli Hedefler', cat: 'Flick', glyph: '⇄',
    desc: 'Aynı anda 3 hedef farklı yön ve hızlarda kayar. Hareketli hedefe flick.',
    init(ctx) { for (let k = 0; k < 3; k++) this.spawn(ctx); },
    spawn(ctx) {
      const t = ctx.sphere({ pos: freeSpot(ctx, { w: 13, h: 4, z: -13, minDist: 2 }), r: 0.4 });
      const a = Math.random() * Math.PI * 2;
      const sp = ctx.rand(1.6, 4.2);
      t.data.v = V(Math.cos(a) * sp, Math.sin(a) * sp * 0.6, 0);
    },
    update(ctx, dt) {
      for (const t of ctx.targets) {
        const p = t.obj.position, v = t.data.v;
        p.addScaledVector(v, dt);
        if (p.x < -7 || p.x > 7) { v.x *= -1; p.x = clamp(p.x, -7, 7); }
        if (p.y < 0.7 || p.y > 4.8) { v.y *= -1; p.y = clamp(p.y, 0.7, 4.8); }
      }
    },
    onHit(ctx, t) { ctx.hit(t, 110); this.spawn(ctx); },
  },
  {
    id: 'kuculen', name: 'Küçülen Hedefler', cat: 'Hız', glyph: '◌',
    desc: 'Hedefler küçülerek kaybolur, tempo giderek artar. Erken vur, daha çok puan al.',
    reaction: true,
    init(ctx) { this.timer = 0; },
    update(ctx, dt) {
      const life = 1.8;
      const progress = ctx.time / Math.max(1, ctx.time + ctx.remaining);
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length < 6) {
        this.timer = 0.75 - 0.4 * progress;
        const t = ctx.sphere({ pos: freeSpot(ctx, { w: 12, h: 4.4, z: -12, minDist: 1.3 }), r: 0.55 });
        t.data.life = life;
      }
      for (const t of [...ctx.targets]) {
        const f = 1 - (ctx.time - t.born) / t.data.life;
        if (f <= 0.03) ctx.escaped(t);
        else t.obj.scale.setScalar(f);
      }
    },
    onHit(ctx, t) {
      const f = t.obj.scale.x;
      ctx.hit(t, Math.round(60 + 100 * f), { reaction: (ctx.time - t.born) * 1000 });
    },
  },
  {
    id: 'secim', name: 'Hedef Seçimi', cat: 'Karar', glyph: '◐',
    desc: 'Kırmızı küreler düşman, mavi küpler dost. Dosta ateş etme: -150 puan.',
    reaction: true,
    init(ctx) { for (let k = 0; k < 4; k++) this.spawn(ctx); },
    spawn(ctx) {
      const enemies = ctx.targets.filter(t => !t.data.friend).length;
      const friend = enemies > 0 && Math.random() < 0.42;
      const pos = freeSpot(ctx, { w: 13, h: 4.6, z: -13, minDist: 1.6 });
      const t = friend ? ctx.cube({ pos, r: 0.36, color: '#3b8bff' }) : ctx.sphere({ pos, r: 0.38, color: '#ff3b3b' });
      t.data.friend = friend;
    },
    update(ctx) {
      for (const t of [...ctx.targets]) {
        if (t.data.friend) t.obj.rotation.y += ctx.dt * 1.5;
        if (t.data.friend && ctx.time - t.born > 2.4) { ctx.remove(t); this.spawn(ctx); }
      }
    },
    onHit(ctx, t) {
      if (t.data.friend) {
        ctx.stats.misses++;
        ctx.penalty(150, 'DOST! -150');
        ctx.remove(t, true);
      } else {
        const ms = (ctx.time - t.born) * 1000;
        ctx.hit(t, speedPoints(90, 60, ms, 300, 1400), { reaction: ms });
      }
      this.spawn(ctx);
    },
  },
  {
    id: 'takip', name: 'Pürüzsüz Takip', cat: 'Takip', glyph: '∿',
    desc: 'Sol tıkı basılı tut ve yön değiştiren küreyi takip et. Hedefte kalınan süre puanlanır.',
    tracking: true,
    tickScore: 50,
    init(ctx) {
      this.t = ctx.sphere({ pos: V(0, EYE + 0.4, -10), r: 0.45 });
      this.v = V(3, 0, 0);
      this.want = V(3, 0, 0);
      this.next = 0;
    },
    update(ctx, dt) {
      const p = this.t.obj.position;
      this.next -= dt;
      if (this.next <= 0) {
        this.next = ctx.rand(0.35, 1.2);
        const a = Math.random() * Math.PI * 2;
        const sp = ctx.rand(2, 6.5);
        this.want.set(Math.cos(a) * sp, Math.sin(a) * sp * 0.55, 0);
      }
      if (p.x < -6 && this.want.x < 0) this.want.x *= -1;
      if (p.x > 6 && this.want.x > 0) this.want.x *= -1;
      if (p.y < 0.8 && this.want.y < 0) this.want.y *= -1;
      if (p.y > 4.5 && this.want.y > 0) this.want.y *= -1;
      this.v.lerp(this.want, 1 - Math.exp(-dt * 4));
      p.addScaledVector(this.v, dt);
    },
    onTrack(ctx, t) {
      const on = !!t && ctx.firing;
      this.t.obj.material = ctx.engine.material(on ? '#ffffff' : ctx.settings.targetColor, on ? 0.5 : 0.3);
    },
    onHit() {},
  },
  {
    id: 'strafe', name: 'Strafe Takip', cat: 'Takip', glyph: '⟷',
    desc: 'ADAD strafe atan rakibi basılı tutarak takip et. Kafada kalmak 1.5× puan.',
    tracking: true,
    headshots: false,
    tickScore: 45,
    init(ctx) { this.t = ctx.bot({ pos: V(0, 0, -11) }); },
    update(ctx, dt) {
      strafe(ctx, this.t, dt, { min: -5, max: 5, speed: 5.4, stopChance: 0.22 });
      ctx.face(this.t);
    },
    onHit() {},
  },
  {
    id: 'kafa', name: 'Kafa Avı', cat: 'CS', glyph: '⌖',
    desc: 'Farklı mesafelerde beliren rakipler. Kafa tek mermi, gövde iki. Gerçek CS ölçekleri.',
    headshots: true, reaction: true, fireInterval: 100, auto: false,
    init(ctx) { this.timer = 0.3; },
    spawn(ctx) {
      for (let i = 0; i < 20; i++) {
        const pos = V(ctx.rand(-12, 12), 0, -ctx.rand(10, 32));
        if (ctx.targets.every(t => t.obj.position.distanceTo(pos) > 3)) {
          const t = ctx.bot({ pos });
          t.data.moving = Math.random() < 0.55;
          t.data.life = ctx.rand(2.2, 3.2);
          t.data.min = pos.x - 3; t.data.max = pos.x + 3;
          return;
        }
      }
    },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length < 2) { this.spawn(ctx); this.timer = ctx.rand(0.25, 0.7); }
      for (const t of [...ctx.targets]) {
        if (ctx.time - t.born > t.data.life) { ctx.escaped(t); ctx.popup('KAÇTI', 'bad'); continue; }
        if (t.data.moving) strafe(ctx, t, dt, { min: t.data.min, max: t.data.max, speed: 5, stopChance: 0.3 });
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      if (part === 'head') {
        ctx.hit(t, speedPoints(150, 60, ms, 350, 1800), { head: true, reaction: ms, popup: `KAFA +${speedPoints(150, 60, ms, 350, 1800)}` });
      } else {
        t.hp -= 55;
        if (t.hp <= 0) ctx.hit(t, 70, { reaction: ms });
        else ctx.hit(t, 0, { kill: false, popup: '-55 HP' });
      }
    },
  },
  {
    id: 'kose', name: 'Köşe Tutma', cat: 'CS', glyph: '⌐',
    desc: 'Duvar arkalarından peek atan rakipler. Açıyı tut, çıktığı an kafadan vur.',
    headshots: true, reaction: true, fireInterval: 100,
    setup(ctx) {
      const W = (x, z, w = 3.2, h = 2.6) => ({ x, z, w, h, box: ctx.box({ pos: V(x, h / 2, z), size: V(w, h, 0.7) }) });
      this.walls = [W(-7, -14), W(6.5, -18), W(-1.5, -26, 4), W(10, -30), W(-11, -32)];
    },
    init(ctx) { this.timer = 0.8; },
    spawn(ctx) {
      const w = ctx.pick(this.walls);
      const side = Math.random() < 0.5 ? -1 : 1;
      const edge = w.x + side * (w.w / 2);
      const hidden = edge - side * 0.55;
      const t = ctx.bot({ pos: V(hidden, 0, w.z - 0.9) });
      const wide = Math.random() < 0.45;
      Object.assign(t.data, {
        side, hidden, phase: 'out', hold: ctx.rand(0.25, 0.8),
        out: edge + side * (wide ? ctx.rand(1.6, 3) : ctx.rand(0.5, 1)),
        speed: wide ? 5.4 : 3.6,
      });
    },
    update(ctx, dt) {
      this.timer -= dt;
      if (this.timer <= 0 && ctx.targets.length === 0) this.spawn(ctx);
      for (const t of [...ctx.targets]) {
        const d = t.data, p = t.obj.position;
        if (d.phase === 'out') {
          p.x += d.side * d.speed * dt;
          if ((p.x - d.out) * d.side >= 0) { p.x = d.out; d.phase = 'hold'; }
        } else if (d.phase === 'hold') {
          d.hold -= dt;
          if (d.hold <= 0) d.phase = 'back';
        } else {
          p.x -= d.side * d.speed * dt;
          if ((p.x - d.hidden) * d.side <= 0) { ctx.escaped(t); ctx.popup('KAÇTI', 'bad'); this.timer = ctx.rand(0.5, 1.4); }
        }
        ctx.face(t);
      }
    },
    onHit(ctx, t, part) {
      const ms = (ctx.time - t.born) * 1000;
      const done = () => { this.timer = ctx.rand(0.5, 1.5); };
      if (part === 'head') {
        const pts = speedPoints(150, 80, ms, 300, 1300);
        ctx.hit(t, pts, { head: true, reaction: ms, popup: `KAFA +${pts}` });
        done();
      } else {
        t.hp -= 55;
        if (t.hp <= 0) { ctx.hit(t, 70, { reaction: ms }); done(); } else ctx.hit(t, 0, { kill: false, popup: '-55 HP' });
      }
    },
  },
  {
    id: 'reaksiyon', name: 'Reaksiyon', cat: 'Reaksiyon', glyph: '⚡',
    desc: '10 tur. Ekran yeşile döndüğü an tıkla. Erken tıklamak turu bozar.',
    rounds: 10, reaction: true,
    setup(ctx) {
      const geo = new THREE.PlaneGeometry(40, 24);
      this.mat = new THREE.MeshBasicMaterial({ color: 0xb3261e });
      this.panel = new THREE.Mesh(geo, this.mat);
      this.panel.position.set(0, 0, -3);
      this.panel.userData.noHit = true;
      ctx.engine.camera.add(this.panel);
      this.round = 0;
      ctx.hud('Tur 0/10');
    },
    init(ctx) { this.next(ctx); },
    next(ctx) {
      this.state = 'wait';
      this.goAt = ctx.time + ctx.rand(1.2, 3.6);
      this.mat.color.set(0xb3261e);
      this.goReal = Infinity;
      ctx.message('BEKLE…');
    },
    update(ctx) {
      if (this.state === 'wait' && ctx.time >= this.goAt) {
        this.state = 'go';
        this.mat.color.set(0x1fae4b);
        // Measured from the frame that shows green, with event-precise time.
        this.goReal = performance.now();
        ctx.message('TIKLA!');
      } else if (this.state === 'shown' && ctx.time >= this.goAt) {
        this.next(ctx);
      }
    },
    onClick(ctx) {
      const s = ctx.stats;
      if (this.state === 'wait') {
        s.shots++;
        ctx.miss();
        ctx.penalty(0, 'ERKEN!');
        this.next(ctx);
      } else if (this.state === 'go') {
        const ms = performance.now() - this.goReal;
        s.shots++; s.hits++; s.kills++;
        s.reactions.push(ms);
        s.score += Math.max(0, 1000 - ms);
        s.streak++; s.maxStreak = Math.max(s.maxStreak, s.streak);
        ctx.sound.hit(true);
        this.round++;
        ctx.hud(`Tur ${this.round}/10`);
        this.mat.color.set(0x23324a);
        ctx.message(`${Math.round(ms)} ms`);
        if (this.round >= this.rounds) { setTimeout(() => ctx.end(), 600); this.state = 'over'; return true; }
        this.state = 'shown';
        this.goAt = ctx.time + 0.9;
      }
      return true;
    },
    onHit() {},
    teardown(ctx) { ctx.engine.camera.remove(this.panel); ctx.message(''); },
  },
];

export const CATEGORIES = ['Tümü', ...new Set(MODES.map(m => m.cat))];
export const byId = id => MODES.find(m => m.id === id);
