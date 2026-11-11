// 3D engine: scene, CS2-style mouse look, shooting, targets and the game loop.
// Units are metres; the eye is at CS2 standing eye height (64u ≈ 1.64 m).

import * as THREE from '../vendor/three.module.min.js';
import * as audio from './audio.js';
import { M_YAW, verticalFov } from './settings.js';

export const EYE = 1.64;
const DEG = Math.PI / 180;
const TRACK_HZ = 20; // tracking samples per second

const THEMES = {
  dust: { sky: 0xc9d6e3, fog: 0xc9c2b0, wall: '#c9b48a', wall2: '#b39c70', floor: '#9c8763', line: 'rgba(60,40,15,.35)', hemi: [0xfff1d6, 0x6b5a3e, 1.5], sun: 2.1, prop: '#8a6a3d' },
  night: { sky: 0x0b1020, fog: 0x0e1424, wall: '#27324a', wall2: '#1d2639', floor: '#1b2232', line: 'rgba(120,170,255,.18)', hemi: [0x8fb0ff, 0x101522, 1.0], sun: 1.0, prop: '#3a465e' },
  lab: { sky: 0xdfe6ee, fog: 0xdfe6ee, wall: '#e8ecf1', wall2: '#d5dbe3', floor: '#c4ccd6', line: 'rgba(40,90,160,.25)', hemi: [0xffffff, 0x9aa6b5, 1.6], sun: 1.6, prop: '#9aa6b5' },
};

function panelTexture(base, base2, line, size = 512, tiles = 4) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      g.fillStyle = (i + j) % 2 ? base : base2;
      g.fillRect(i * s, j * s, s, s);
      // subtle grain
      for (let k = 0; k < 60; k++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
        g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2 + Math.random() * 4, 2 + Math.random() * 4);
      }
    }
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function crateTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 14; g.strokeRect(7, 7, 242, 242);
  g.lineWidth = 10;
  g.beginPath(); g.moveTo(14, 14); g.lineTo(242, 242); g.moveTo(242, 14); g.lineTo(14, 242); g.stroke();
  for (let y = 0; y < 256; y += 32) { g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Engine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.s = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE, 0);
    this.scene.add(this.camera);
    this.yaw = 0;
    this.pitch = 0;

    this.room = new THREE.Group();
    this.props = new THREE.Group();
    this.targets = new THREE.Group();
    this.fx = new THREE.Group();
    this.scene.add(this.room, this.props, this.targets, this.fx);
    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.materials = new Map();
    this.particles = [];
    this.decals = [];
    this.decalGeo = new THREE.CircleGeometry(0.035, 10);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.flash = new THREE.PointLight(0xffc070, 0, 6);
    this.flash.position.set(0.25, -0.2, -0.6);
    this.camera.add(this.flash);

    this.state = 'idle'; // idle | countdown | play | paused | done
    this.mode = null;
    this.firing = false;
    this.lastShot = 0;
    this.marker = 0;
    this.markerHead = false;
    this.listeners = {};
    this.buildRoom();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.frames = 0;
    this.fpsT = 0;
    this.fps = 0;
    this.prev = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  on(ev, fn) { this.listeners[ev] = fn; }
  emit(ev, ...a) { this.listeners[ev]?.(...a); }

  // ---------- scene ----------

  buildRoom() {
    this.room.clear();
    const th = THEMES[this.s.theme] || THEMES.dust;
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.fog, 45, 120);
    const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]);
    const sun = new THREE.DirectionalLight(0xffffff, th.sun);
    sun.position.set(-8, 20, 6);
    this.room.add(hemi, sun);

    const W = 50, D = 70, H = 9, Z0 = 6;
    const floorTex = panelTexture(th.floor, shade(th.floor, -4), th.line);
    floorTex.repeat.set(W / 4, D / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, Z0 - D / 2);
    this.room.add(floor);

    const wallTex = panelTexture(th.wall, shade(th.wall, -5), th.line, 512, 2);
    const wall = (w, h, x, y, z, ry) => {
      const t = wallTex.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 4, h / 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.room.add(m);
    };
    wall(W, H, 0, H / 2, Z0 - D, 0);
    wall(W, H, 0, H / 2, Z0, Math.PI);
    wall(D, H, -W / 2, H / 2, Z0 - D / 2, Math.PI / 2);
    wall(D, H, W / 2, H / 2, Z0 - D / 2, -Math.PI / 2);
    // Darker base trim and top ledge along the walls.
    const trim = new THREE.MeshStandardMaterial({ color: shade(th.wall2, -30), roughness: 0.8 });
    for (const [w, x, z, ry] of [[W, 0, Z0 - D, 0], [D, -W / 2, Z0 - D / 2, Math.PI / 2], [D, W / 2, Z0 - D / 2, -Math.PI / 2], [W, 0, Z0, Math.PI]]) {
      for (const [y, h] of [[0.35, 0.7], [H - 0.2, 0.4]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), trim);
        b.position.set(x, y, z);
        b.rotation.y = ry;
        this.room.add(b);
      }
    }

    // Some crates along the sides, away from the target areas.
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(th.prop), roughness: 0.85 });
    const crates = [[-21, -8, 1.3], [-21, -9.4, 1.3], [-21, -8.6, 1.3, 1.3], [21, -20, 1.6], [19.2, -21, 1.3], [-20, -44, 2], [20, -50, 1.6], [20, -51.8, 1.6]];
    for (const [x, z, s, y = 0] of crates) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(x, y + s / 2, z);
      c.rotation.y = (x * z) % 0.4;
      this.room.add(c);
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.s.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.s, w / h);
    this.camera.updateProjectionMatrix();
    this.emit('resize');
  }

  applySettings(s) {
    const themeChanged = s.theme !== this.s.theme;
    this.s = s;
    this.materials.clear();
    if (themeChanged) this.buildRoom();
    this.resize();
  }

  material(color, emissive = 0.3) {
    const key = color + emissive;
    if (!this.materials.has(key)) {
      const c = new THREE.Color(color);
      this.materials.set(key, new THREE.MeshStandardMaterial({ color: c, emissive: c.clone().multiplyScalar(emissive), roughness: 0.35, metalness: 0.05 }));
    }
    return this.materials.get(key);
  }

  // ---------- input ----------

  bindInput() {
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.canvas || (this.state !== 'play' && this.state !== 'countdown')) return;
      const k = this.s.sens * M_YAW * DEG; // CS2: m_yaw = m_pitch = 0.022
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k;
      this.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.pitch));
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    });
    document.addEventListener('mousedown', e => {
      if (e.button !== 0 || document.pointerLockElement !== this.canvas) return;
      this.firing = true;
      if (this.state === 'play') this.shoot();
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.firing = false; });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) {
        this.firing = false;
        if (this.state === 'play' || this.state === 'countdown') this.pause();
      }
    });
  }

  async lock() {
    audio.unlock();
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: this.s.raw });
    } catch {
      try { await this.canvas.requestPointerLock(); } catch { return false; }
    }
    return true;
  }

  // ---------- game flow ----------

  start(mode) {
    this.clearRound();
    this.mode = mode;
    this.yaw = 0; this.pitch = 0;
    this.camera.rotation.set(0, 0, 0);
    const timed = !mode.rounds;
    this.duration = timed ? (mode.fixedDuration || this.s.duration) : Infinity;
    this.stats = {
      score: 0, shots: 0, hits: 0, kills: 0, misses: 0, streak: 0, maxStreak: 0,
      reactions: [], headshots: 0, headTicks: 0, escaped: 0, penalties: 0, ticks: 0, trackHits: 0,
    };
    this.elapsed = 0;
    this.trackAcc = 0;
    this.shotAcc = 0;
    this.ctx = this.makeCtx();
    mode.setup?.(this.ctx);
    this.state = 'countdown';
    this.countdown = this.s.countdown ? 3 : 0.001;
    this.lastCount = null;
    this.emit('start', mode);
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'countdown') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.emit('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.prev = performance.now();
    this.emit('resume');
  }

  stop() {
    this.clearRound();
    this.state = 'idle';
    this.mode = null;
  }

  finish() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.firing = false;
    const res = this.results();
    this.mode.teardown?.(this.ctx);
    if (document.pointerLockElement) document.exitPointerLock();
    this.emit('end', res);
  }

  clearRound() {
    for (const c of [...this.targets.children]) this.targets.remove(c);
    for (const c of [...this.props.children]) this.props.remove(c);
    for (const p of this.particles) this.fx.remove(p.obj);
    this.particles = [];
    for (const d of this.decals) this.fx.remove(d);
    this.decals = [];
    this.list = [];
    this.emit('message', '');
  }

  liveScore() {
    const st = this.stats;
    if (!st) return 0;
    if (this.mode.tracking || this.mode.rounds) return Math.max(0, Math.round(st.score));
    // Click modes: accuracy factor discourages spraying (100% → ×1, 50% → ×0.75).
    return Math.max(0, Math.round(st.score * (0.5 + 0.5 * this.accuracy() / 100)));
  }

  accuracy() {
    const st = this.stats;
    if (this.mode.tracking) return st.ticks ? (100 * st.trackHits) / st.ticks : 0;
    return st.shots ? (100 * st.hits) / st.shots : 100;
  }

  results() {
    const st = this.stats;
    const dur = Math.max(this.elapsed, 0.001);
    const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const tracking = !!this.mode.tracking;
    return {
      mode: this.mode.id,
      score: this.liveScore(),
      accuracy: this.accuracy(),
      hits: tracking ? st.trackHits : st.hits,
      shots: tracking ? st.ticks : st.shots,
      kills: st.kills,
      duration: dur,
      kps: st.kills / dur,
      maxStreak: st.maxStreak,
      avgReaction: this.mode.reaction ? avg(st.reactions) : null,
      bestReaction: st.reactions.length ? Math.min(...st.reactions) : null,
      headshotPct: this.mode.headshots ? (st.kills ? (100 * st.headshots) / st.kills : 0) : null,
      headTrackPct: this.mode.id === 'strafe' && st.trackHits ? (100 * st.headTicks) / st.trackHits : null,
      escaped: st.escaped,
      penalties: st.penalties,
      at: Math.floor(Date.now() / 1000),
    };
  }

  // ---------- per-frame ----------

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.prev) / 1000);
    this.prev = now;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; audio.beep(false); this.emit('message', String(n)); }
      if (this.countdown <= 0) {
        this.state = 'play';
        audio.beep(true);
        this.emit('message', '');
        this.mode.init(this.ctx);
      }
    } else if (this.state === 'play') {
      this.elapsed += dt;
      this.ctx.dt = dt;
      this.ctx.time = this.elapsed;
      this.mode.update?.(this.ctx, dt);
      if (this.mode.tracking) this.track(dt);
      else if (this.mode.auto && this.firing) this.shoot();
      if (this.elapsed >= this.duration) this.finish();
    }
    this.updateFx(dt);
    this.renderer.render(this.scene, this.camera);
    this.emit('frame', dt);
  }

  updateFx(dt) {
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 120);
    this.marker = Math.max(0, this.marker - dt * 5);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.fx.remove(p.obj); this.particles.splice(i, 1); continue; }
      const pos = p.obj.geometry.attributes.position;
      for (let j = 0; j < p.vel.length; j++) {
        const v = p.vel[j];
        v.y -= 9 * dt;
        pos.setXYZ(j, pos.getX(j) + v.x * dt, pos.getY(j) + v.y * dt, pos.getZ(j) + v.z * dt);
      }
      pos.needsUpdate = true;
      p.obj.material.opacity = p.life / p.max;
    }
  }

  /** What is under the crosshair: {target, part, point, normal, object} or null. */
  pick() {
    // Mouse moves and targets spawn between frames: raycast against the
    // current transforms, not the last render's.
    this.scene.updateMatrixWorld();
    this.raycaster.setFromCamera(this.center, this.camera);
    const hits = this.raycaster.intersectObjects([this.targets, this.props, this.room], true);
    for (const h of hits) {
      let o = h.object;
      if (o.userData.noHit) continue;
      let part = o.userData.part;
      while (o && !o.userData.target) o = o.parent;
      if (o?.userData.target) return { target: o.userData.target, part: part || 'body', point: h.point, face: h.face, object: h.object };
      return { target: null, point: h.point, face: h.face, object: h.object };
    }
    return null;
  }

  shoot() {
    const now = performance.now();
    if (now - this.lastShot < (this.mode.fireInterval || 0)) return;
    this.lastShot = now;
    if (this.mode.onClick?.(this.ctx)) return;
    this.stats.shots++;
    audio.shot();
    this.flash.intensity = 4;
    const p = this.pick();
    if (p?.target && p.target.alive) {
      this.mode.onHit(this.ctx, p.target, p.part, p.point);
    } else {
      this.ctx.miss();
      if (p && !p.target) this.decal(p);
    }
  }

  track(dt) {
    this.trackAcc += dt;
    this.shotAcc += dt;
    if (this.firing && this.shotAcc >= 0.1) { this.shotAcc = 0; audio.shot(); this.flash.intensity = 3; }
    const step = 1 / TRACK_HZ;
    while (this.trackAcc >= step) {
      this.trackAcc -= step;
      this.stats.ticks++;
      const p = this.pick();
      const on = p?.target && p.target.alive;
      this.mode.onTrack?.(this.ctx, on ? p.target : null, on ? p.part : null);
      for (const t of this.list) t.onCrosshair?.(on && p.target === t);
      if (on && this.firing) {
        this.stats.trackHits++;
        const head = p.part === 'head';
        if (head) this.stats.headTicks++;
        this.stats.score += (this.mode.tickScore || 50) * (head ? 1.5 : 1);
        if (this.stats.trackHits % 4 === 0) audio.tick();
      }
    }
  }

  decal(p) {
    if (!p.face) return;
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    const n = p.face.normal.clone().transformDirection(p.object.matrixWorld);
    d.position.copy(p.point).addScaledVector(n, 0.005);
    d.lookAt(p.point.clone().add(n));
    d.userData.noHit = true;
    this.fx.add(d);
    this.decals.push(d);
    if (this.decals.length > 60) this.fx.remove(this.decals.shift());
  }

  burst(pos, color, n = 16) {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      arr.set([pos.x, pos.y, pos.z], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.2) * 5));
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.PointsMaterial({ color, size: 0.07, transparent: true, depthWrite: false });
    const obj = new THREE.Points(g, m);
    obj.userData.noHit = true;
    this.fx.add(obj);
    this.particles.push({ obj, vel, life: 0.45, max: 0.45 });
  }

  // ---------- context handed to modes ----------

  makeCtx() {
    const eng = this;
    const st = () => eng.stats;
    const ctx = {
      THREE,
      EYE,
      engine: eng,
      time: 0,
      dt: 0,
      get stats() { return eng.stats; },
      get settings() { return eng.s; },
      get firing() { return eng.firing; },
      get targets() { return eng.list; },
      get remaining() { return eng.duration - eng.elapsed; },
      rand: (a, b) => a + Math.random() * (b - a),
      pick: arr => arr[Math.floor(Math.random() * arr.length)],

      sphere({ pos, r, color }) {
        const rr = r * eng.s.targetSize;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(rr, 28, 20), eng.material(color || eng.s.targetColor));
        mesh.position.copy(pos);
        const t = { obj: mesh, r: rr, born: eng.elapsed, alive: true, hp: 1, data: {}, color: color || eng.s.targetColor };
        mesh.userData.target = t;
        eng.targets.add(mesh);
        eng.list.push(t);
        return t;
      },

      cube({ pos, r, color }) {
        const rr = r * eng.s.targetSize;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(rr * 1.6, rr * 1.6, rr * 1.6), eng.material(color));
        mesh.position.copy(pos);
        mesh.rotation.set(0.6, 0.6, 0);
        const t = { obj: mesh, r: rr, born: eng.elapsed, alive: true, hp: 1, data: {}, color };
        mesh.userData.target = t;
        eng.targets.add(mesh);
        eng.list.push(t);
        return t;
      },

      /** A humanoid bot (1.83 m) standing at pos, facing the player. */
      bot({ pos, color = '#6f6250', head = '#d9b58c' }) {
        const g = new THREE.Group();
        const body = eng.material(color, 0.08);
        const skin = eng.material(head, 0.12);
        const dark = eng.material(shade(color, -25), 0.05);
        const add = (geo, mat, x, y, z, part = 'body') => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          m.userData.part = part;
          g.add(m);
          return m;
        };
        add(new THREE.BoxGeometry(0.17, 0.86, 0.2), dark, -0.11, 0.43, 0);
        add(new THREE.BoxGeometry(0.17, 0.86, 0.2), dark, 0.11, 0.43, 0);
        add(new THREE.BoxGeometry(0.46, 0.62, 0.27), body, 0, 1.17, 0);
        add(new THREE.BoxGeometry(0.12, 0.58, 0.14), body, -0.3, 1.16, 0.02);
        add(new THREE.BoxGeometry(0.12, 0.58, 0.14), body, 0.3, 1.16, 0.02);
        add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), skin, 0, 1.52, 0);
        add(new THREE.SphereGeometry(0.125, 20, 14), skin, 0, 1.64, 0, 'head');
        add(new THREE.BoxGeometry(0.2, 0.06, 0.04), dark, 0, 1.67, 0.1, 'head'); // visor
        g.position.copy(pos);
        const t = { obj: g, r: 0.3, born: eng.elapsed, alive: true, hp: 100, data: {}, bot: true, vx: 0 };
        g.userData.target = t;
        eng.targets.add(g);
        eng.list.push(t);
        ctx.face(t);
        return t;
      },

      face(t) {
        const p = t.obj.position;
        t.obj.rotation.y = Math.atan2(eng.camera.position.x - p.x, eng.camera.position.z - p.z);
      },

      /** A static cover box; blocks shots. */
      box({ pos, size, color }) {
        const th = THEMES[eng.s.theme] || THEMES.dust;
        const tex = panelTexture(color || th.prop, shade(color || th.prop, -10), 'rgba(0,0,0,.3)', 256, 2);
        tex.repeat.set(size.x / 1.5, size.y / 1.5);
        const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
        m.position.copy(pos);
        eng.props.add(m);
        return m;
      },

      remove(t, effect = false) {
        if (!t.alive) return;
        t.alive = false;
        if (effect) {
          const p = new THREE.Vector3();
          (t.bot ? t.obj.children[6] : t.obj).getWorldPosition(p);
          eng.burst(p, t.bot ? 0xb03020 : t.color);
        }
        eng.targets.remove(t.obj);
        eng.list = eng.list.filter(x => x !== t);
      },

      /** A successful hit worth `points`. kill: target dies. */
      hit(t, points, { kill = true, head = false, reaction = null, popup = null } = {}) {
        const s = st();
        s.hits++;
        s.streak++;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        s.score += points;
        if (kill) {
          s.kills++;
          if (head) s.headshots++;
          if (reaction != null) s.reactions.push(reaction);
          ctx.remove(t, true);
        }
        audio.hit(head);
        eng.marker = 1;
        eng.markerHead = head;
        if (popup !== false) eng.emit('popup', popup || `+${Math.round(points)}`, head ? 'hs' : '');
      },

      miss() {
        const s = st();
        s.misses++;
        s.streak = 0;
      },

      penalty(points, text) {
        const s = st();
        s.score -= points;
        s.penalties++;
        s.streak = 0;
        audio.bad();
        eng.emit('popup', text || `-${points}`, 'bad');
      },

      escaped(t) {
        st().escaped++;
        st().streak = 0;
        ctx.remove(t, false);
      },

      popup(text, cls = '') { eng.emit('popup', text, cls); },
      message(text) { eng.emit('message', text); },
      hud(text) { eng.emit('hud', text); },
      end() { eng.finish(); },
      sound: audio,
    };
    return ctx;
  }
}

/** Lightens/darkens a #rrggbb colour by `pct` percent. */
export function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c * (1 + pct / 100))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
