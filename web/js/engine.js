// Game engine: renderer, CS2-style mouse look, shooting, the game loop and
// the context object handed to modes. Units are metres; the eye is at CS2
// standing eye height (64 u ≈ 1.64 m).

import * as THREE from '../vendor/three.module.min.js';
import * as audio from './audio.js';
import { M_YAW, verticalFov } from './settings.js';
import { World, THEMES, addBoard, addCover, addPlate } from './world.js';
import { makeSphere, makeCube, makeBot, sphereMaterial, animateBot, dying, stepDying } from './actors.js';
import { ViewModel } from './viewmodel.js';

export const EYE = 1.64;
const DEG = Math.PI / 180;
const TRACK_HZ = 20; // tracking samples per second

export const DIFFICULTY = {
  kolay: { label: 'Kolay', size: 1.3, speed: 0.75, time: 1.35 },
  normal: { label: 'Normal', size: 1, speed: 1, time: 1 },
  zor: { label: 'Zor', size: 0.78, speed: 1.3, time: 0.75 },
};

export class Engine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.s = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE, 0);
    this.scene.add(this.camera);
    this.yaw = 0;
    this.pitch = 0;
    this.punch = new THREE.Vector2(); // visual view punch (spray)

    this.world = new World(this.scene, this.renderer);
    this.props = new THREE.Group();
    this.targets = new THREE.Group();
    this.fx = new THREE.Group();
    this.scene.add(this.props, this.targets, this.fx);
    this.vm = new ViewModel();

    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.trackPoint = new THREE.Vector2(0, 0); // tap mode: finger position (NDC)
    this.isTouch = isTouchDevice();
    this.materials = new Map();
    this.particles = [];
    this.dyingList = [];
    this.puffs = [];
    this.decals = [];
    this.decalGeo = new THREE.CircleGeometry(0.03, 10);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.shardGeo = new THREE.TetrahedronGeometry(0.035);
    this.puffMap = puffTexture();

    this.state = 'idle'; // idle | preview | countdown | play | paused | done
    this.mode = null;
    this.list = [];
    this.firing = false;
    this.lastShot = 0;
    this.marker = 0;
    this.markerHead = false;
    this.listeners = {};
    this.world.build(this.s.theme, this.s.quality);
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

  get theme() { return THEMES[this.s.theme] || THEMES.gun; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const cap = this.s.quality === 'low' ? 1 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap) * this.s.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.s, w / h);
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
    this.emit('resize');
  }

  applySettings(s) {
    const rebuild = s.theme !== this.s.theme || s.quality !== this.s.quality;
    this.s = s;
    this.materials.clear();
    if (rebuild) {
      this.world.build(s.theme, s.quality);
      if (this.state === 'preview' || this.state === 'idle') this.preview(this.previewMode);
    }
    this.resize();
  }

  material(color) {
    if (!this.materials.has(color)) this.materials.set(color, sphereMaterial(color));
    return this.materials.get(color);
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.canvas || !this.live()) return;
      const k = this.s.sens * M_YAW * DEG; // CS2: m_yaw = m_pitch = 0.022
      this.look(-e.movementX * k, -e.movementY * k);
      this.vm.addLook(e.movementX, e.movementY);
    });
    document.addEventListener('mousedown', e => {
      if (e.button !== 0 || document.pointerLockElement !== this.canvas) return;
      this.firing = true;
      if (this.state === 'play') this.shoot();
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.firing = false; });
    document.addEventListener('pointerlockchange', () => {
      if (this.isTouch) return;
      if (document.pointerLockElement !== this.canvas) {
        this.firing = false;
        if (this.live()) this.pause();
      }
    });
    this.bindTouch();
  }

  live() { return this.state === 'play' || this.state === 'countdown'; }

  look(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.pitch + dpitch));
    this.applyView();
  }

  applyView() {
    this.camera.rotation.set(this.pitch + this.punch.y, this.yaw + this.punch.x, 0);
  }

  /** Touch controls.
   *  tap:  touching the screen shoots exactly where the finger is (hold a
   *        finger on the target in tracking modes).
   *  drag: drag anywhere to aim like a mobile shooter, fire with the button. */
  bindTouch() {
    const ndc = t => new THREE.Vector2((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
    this.lookTouch = null;
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      audio.unlock();
      if (!this.live()) return;
      for (const t of e.changedTouches) {
        if (this.s.touchMode === 'tap') {
          this.trackPoint.copy(ndc(t));
          this.tapId = t.identifier;
          this.firing = true;
          if (this.state === 'play' && !this.mode.tracking) this.shoot(ndc(t));
        } else if (this.lookTouch === null) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });
    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.s.touchMode === 'tap' && t.identifier === this.tapId) this.trackPoint.copy(ndc(t));
        if (this.lookTouch && t.identifier === this.lookTouch.id && this.live()) {
          const k = this.s.touchSens * DEG;
          const dx = t.clientX - this.lookTouch.x, dy = t.clientY - this.lookTouch.y;
          this.look(-dx * k, -dy * k);
          this.vm.addLook(dx, dy);
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
        if (t.identifier === this.tapId) { this.tapId = null; if (this.s.touchMode === 'tap') this.firing = false; }
      }
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);
  }

  /** Fire button (drag mode). */
  fireButton(down) {
    this.firing = down;
    if (down && this.state === 'play' && !this.mode.tracking) this.shoot();
  }

  async lock() {
    audio.unlock();
    if (this.isTouch) {
      // No pointer lock on touch screens: go fullscreen and landscape instead.
      try {
        if (!document.fullscreenElement && !window.__TAURI__) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation?.lock?.('landscape');
      } catch { /* not supported: the portrait overlay asks to rotate */ }
      return true;
    }
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: this.s.raw });
    } catch {
      try { await this.canvas.requestPointerLock(); } catch { return false; }
    }
    return true;
  }

  // ---------------------------------------------------------------- flow

  /** Menu background: the selected mode running on its own, no scoring. */
  preview(mode) {
    this.clearRound();
    this.previewMode = mode;
    this.mode = mode;
    this.state = 'preview';
    this.yaw = 0; this.pitch = -0.03; this.punch.set(0, 0);
    this.applyView();
    this.duration = 60;
    this.elapsed = 0;
    this.diff = DIFFICULTY.normal;
    this.stats = newStats();
    this.ctx = this.makeCtx(true);
    if (!mode || mode.rounds) { this.mode = null; return; }
    mode.setup?.(this.ctx);
    mode.init(this.ctx);
  }

  start(mode, { duration = null, difficulty = 'normal' } = {}) {
    this.clearRound();
    this.mode = mode;
    this.yaw = 0; this.pitch = 0; this.punch.set(0, 0);
    this.applyView();
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.duration = mode.rounds ? Infinity : (duration || mode.fixedDuration || this.s.duration);
    this.stats = newStats();
    this.elapsed = 0;
    this.trackAcc = 0;
    this.shotAcc = 0;
    this.burst = 0;
    this.ammo = mode.weapon?.mag ?? null;
    this.reloadT = 0;
    this.ctx = this.makeCtx(false);
    mode.setup?.(this.ctx);
    this.state = 'countdown';
    this.countdown = this.s.countdown ? 3 : 0.001;
    this.lastCount = null;
    this.vm.visible = this.s.viewmodel && !mode.rounds && !(this.isTouch && this.s.touchMode === 'tap');
    this.emit('start', mode);
  }

  pause() {
    if (!this.live()) return;
    this.pausedFrom = this.state;
    this.pausedAt = performance.now();
    this.state = 'paused';
    this.emit('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.prev = performance.now();
    this.mode.onResume?.(this.ctx, this.prev - this.pausedAt);
    this.emit('resume');
  }

  stop() {
    this.mode?.teardown?.(this.ctx);
    this.clearRound();
    this.state = 'idle';
    this.mode = null;
  }

  finish() {
    if (this.state !== 'play' && this.state !== 'paused' && this.state !== 'countdown') return;
    this.state = 'done';
    this.firing = false;
    const res = this.results();
    this.mode.teardown?.(this.ctx);
    if (document.pointerLockElement) document.exitPointerLock();
    this.emit('end', res);
  }

  clearRound() {
    this.targets.clear();
    this.props.clear();
    this.fx.clear();
    this.particles = [];
    this.dyingList = [];
    this.puffs = [];
    this.decals = [];
    this.list = [];
    this.emit('message', '');
  }

  liveScore() {
    const st = this.stats;
    if (!st || !this.mode) return 0;
    if (this.mode.tracking || this.mode.rounds || this.mode.weapon) return Math.max(0, Math.round(st.score));
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
      difficulty: this.difficulty,
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
      extra: { ...st.extra },
      at: Math.floor(Date.now() / 1000),
    };
  }

  // ---------------------------------------------------------------- frame

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.prev) / 1000);
    this.prev = now;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }

    if (this.state === 'preview') {
      this.elapsed += dt;
      this.ctx.time = this.elapsed; this.ctx.dt = dt;
      if (this.mode) this.mode.update?.(this.ctx, dt);
      if (this.elapsed > 50) this.elapsed = 10;
      // Slow idle drift of the view.
      this.yaw = Math.sin(now / 5200) * 0.07;
      this.pitch = -0.02 + Math.sin(now / 3900) * 0.015;
      this.applyView();
      this.updateActors(dt, false);
    } else if (this.state === 'countdown') {
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
      this.updateActors(dt, true);
      this.updateWeapon(dt);
      if (this.mode.tracking) this.track(dt);
      else if ((this.mode.auto || this.mode.weapon) && this.firing) this.shoot();
      if (this.elapsed >= this.duration) this.finish();
    }
    this.updateFx(dt);
    this.vm.update(dt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.live() || this.state === 'paused') this.vm.render(this.renderer);
    this.emit('frame', dt);
  }

  /** Spawn pop-in for spheres/cubes, walk cycle and footsteps for bots. */
  updateActors(dt, sounds) {
    const cam = this.camera.position;
    for (const t of this.list) {
      if (t.bot) {
        const s = animateBot(t, dt);
        if (sounds && s * (t.lastStep || 0) < 0) {
          const p = t.obj.position;
          const rel = p.clone().sub(cam).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
          const dist = rel.length();
          audio.step(rel.x / Math.max(1, dist) * 1.4, Math.max(0, 1 - dist / 45));
        }
        t.lastStep = s;
      } else {
        t.spawn = Math.min(1, (t.spawn ?? 0) + dt / 0.09);
        const e = 1 - (1 - t.spawn) ** 3;
        t.obj.scale.setScalar(t.r * (t.k ?? 1) * (0.55 + 0.45 * e));
      }
    }
  }

  updateWeapon(dt) {
    const w = this.mode.weapon;
    // View punch recovers towards zero.
    const rec = 1 - Math.exp(-dt * (this.firing && w ? 2 : 9));
    this.punch.multiplyScalar(1 - rec);
    if (!this.firing && performance.now() - this.lastShot > 350) this.burst = 0;
    if (!w) { this.applyView(); return; }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.ammo = w.mag; this.emit('ammo', this.ammo, w.mag); this.mode.onReload?.(this.ctx); }
    }
    this.applyView();
  }

  updateFx(dt) {
    this.marker = Math.max(0, this.marker - dt * 5);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.fx.remove(p.mesh); this.particles.splice(i, 1); continue; }
      const m = new THREE.Matrix4();
      for (let j = 0; j < p.n; j++) {
        p.vel[j].y -= 9.8 * dt;
        p.pos[j].addScaledVector(p.vel[j], dt);
        if (p.pos[j].y < 0.02) { p.pos[j].y = 0.02; p.vel[j].multiplyScalar(0.5); p.vel[j].y *= -0.4; }
        p.rot[j] += dt * 12;
        const sc = p.life / p.max;
        m.makeRotationAxis(p.axis[j], p.rot[j]).scale(new THREE.Vector3(sc, sc, sc)).setPosition(p.pos[j]);
        p.mesh.setMatrixAt(j, m);
      }
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) { this.fx.remove(p.sprite); this.puffs.splice(i, 1); continue; }
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(p.size * (0.4 + k * 1.2));
      p.sprite.material.opacity = 0.55 * (1 - k);
      p.sprite.position.addScaledVector(p.vel, dt);
    }
    this.dyingList = this.dyingList.filter(d => stepDying(d, dt, this.fx));
  }

  /** What is under the aim: {target, part, point, face, object} or null. */
  pick(point = this.center, dir = null) {
    // Mouse moves and targets spawn between frames: raycast against the
    // current transforms, not the last render's.
    this.scene.updateMatrixWorld();
    if (dir) this.raycaster.set(this.camera.position, dir);
    else this.raycaster.setFromCamera(point, this.camera);
    const hits = this.raycaster.intersectObjects([this.targets, this.props, this.world.group], true);
    for (const h of hits) {
      let o = h.object;
      if (o.userData.noHit || o.isSprite || o.isLight) continue;
      if (h.object.material?.side === THREE.BackSide) continue; // sky
      const part = o.userData.part;
      while (o && !o.userData.target) o = o.parent;
      if (o?.userData.target) return { target: o.userData.target, part: part || 'body', point: h.point, face: h.face, object: h.object };
      return { target: null, point: h.point, face: h.face, object: h.object };
    }
    return null;
  }

  shoot(point) {
    const now = performance.now();
    const w = this.mode.weapon;
    const interval = w?.interval ?? this.mode.fireInterval ?? 0;
    if (now - this.lastShot < interval) return;
    if (w && (this.reloadT > 0 || this.ammo <= 0)) return;
    if (this.mode.onClick?.(this.ctx)) return;
    if (this.burst === 0 || now - this.lastShot > 350) this.burst = 0;
    this.lastShot = now;
    this.stats.shots++;
    audio.shot();
    this.vm.kick(w ? 0.8 : 1);

    let dir = null;
    if (w) {
      // Spray: the bullet leaves at aim + pattern offset; the view shows half of it.
      const [px, py] = w.pattern[Math.min(this.burst, w.pattern.length - 1)];
      const jitter = (w.spread || 0) * DEG;
      const ox = px * DEG + (Math.random() - 0.5) * jitter, oy = py * DEG + (Math.random() - 0.5) * jitter;
      dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch + oy, this.yaw + ox, 0, 'YXZ'));
      this.punch.set(ox * 0.5, oy * 0.5);
      this.applyView();
      this.burst++;
      this.ammo--;
      this.emit('ammo', this.ammo, w.mag);
      if (this.ammo <= 0) { this.reloadT = w.reload; audio.reload(); this.mode.onEmpty?.(this.ctx); }
    }

    const p = this.pick(point, dir);
    if (p?.target && p.target.alive) {
      this.mode.onHit(this.ctx, p.target, p.part, p.point);
    } else {
      const handled = p && this.mode.onSurface?.(this.ctx, p);
      if (!handled) this.ctx.miss();
      if (p && !p.target) this.impact(p);
    }
  }

  track(dt) {
    this.trackAcc += dt;
    this.shotAcc += dt;
    if (this.firing && this.shotAcc >= 0.1) { this.shotAcc = 0; audio.shot(); this.vm.kick(0.5); }
    const step = 1 / TRACK_HZ;
    while (this.trackAcc >= step) {
      this.trackAcc -= step;
      this.stats.ticks++;
      const p = this.pick(this.isTouch && this.s.touchMode === 'tap' ? this.trackPoint : this.center);
      const on = p?.target && p.target.alive;
      this.mode.onTrack?.(this.ctx, on ? p.target : null, on ? p.part : null);
      if (on && this.firing) {
        this.stats.trackHits++;
        const head = p.part === 'head';
        if (head) this.stats.headTicks++;
        this.stats.score += (this.mode.tickScore || 50) * (head ? 1.5 : 1);
        if (this.stats.trackHits % 4 === 0) audio.tick();
      }
    }
  }

  /** Bullet hole + dust puff on a surface. */
  impact(p) {
    if (!p.face) return;
    const n = p.face.normal.clone().transformDirection(p.object.matrixWorld);
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.position.copy(p.point).addScaledVector(n, 0.004);
    d.lookAt(p.point.clone().add(n));
    d.rotation.z = Math.random() * Math.PI;
    d.scale.setScalar(0.8 + Math.random() * 0.5);
    d.userData.noHit = true;
    this.fx.add(d);
    this.decals.push(d);
    if (this.decals.length > 80) this.fx.remove(this.decals.shift());
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffMap, color: 0xb8b2a6, transparent: true, depthWrite: false }));
    sprite.position.copy(p.point).addScaledVector(n, 0.05);
    this.fx.add(sprite);
    this.puffs.push({ sprite, vel: n.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.3, 0)), life: 0.45, max: 0.45, size: 0.35 });
  }

  /** Shards flying from a kill. */
  shards(pos, color, n = 14) {
    const mesh = new THREE.InstancedMesh(this.shardGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }), n);
    mesh.castShadow = false;
    const p = { mesh, n, pos: [], vel: [], rot: [], axis: [], life: 0.6, max: 0.6 };
    for (let i = 0; i < n; i++) {
      p.pos.push(pos.clone());
      p.vel.push(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 0.5, (Math.random() - 0.3) * 4));
      p.rot.push(Math.random() * 6);
      p.axis.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize());
    }
    this.fx.add(mesh);
    this.particles.push(p);
  }

  // ---------------------------------------------------------------- context

  makeCtx(preview) {
    const eng = this;
    const st = () => eng.stats;
    const register = (t, obj) => {
      obj.userData.target = t;
      eng.targets.add(obj);
      eng.list.push(t);
      return t;
    };
    const ctx = {
      THREE,
      EYE,
      preview,
      engine: eng,
      time: 0,
      dt: 0,
      get diff() { return eng.diff; },
      get stats() { return eng.stats; },
      get settings() { return eng.s; },
      get firing() { return eng.firing; },
      get targets() { return eng.list; },
      get remaining() { return eng.duration - eng.elapsed; },
      get theme() { return eng.theme; },
      rand: (a, b) => a + Math.random() * (b - a),
      pick: arr => arr[Math.floor(Math.random() * arr.length)],

      sphere({ pos, r, color }) {
        const rr = r * eng.s.targetSize * eng.diff.size;
        const c = color || eng.s.targetColor;
        const mesh = makeSphere(rr, eng.material(c));
        mesh.position.copy(pos);
        return register({ obj: mesh, r: rr, k: 1, born: eng.elapsed, alive: true, hp: 1, data: {}, color: c }, mesh);
      },

      cube({ pos, r, color }) {
        const rr = r * eng.s.targetSize * eng.diff.size;
        const mesh = makeCube(rr, eng.material(color));
        mesh.position.copy(pos);
        return register({ obj: mesh, r: rr, k: 1, born: eng.elapsed, alive: true, hp: 1, data: {}, color }, mesh);
      },

      /** Humanoid bot standing at pos, facing the player. */
      bot({ pos }) {
        const g = makeBot();
        g.position.copy(pos);
        const t = register({ obj: g, r: 0.3, born: eng.elapsed, alive: true, hp: 100, data: {}, bot: true, vx: 0, vz: 0 }, g);
        ctx.face(t);
        return t;
      },

      face(t) {
        const p = t.obj.position;
        t.obj.rotation.y = Math.atan2(eng.camera.position.x - p.x, eng.camera.position.z - p.z);
      },

      board(opts) { return addBoard(eng.props, eng.theme, opts); },
      cover(opts) { return addCover(eng.props, eng.theme, opts); },
      plate(opts) { return addPlate(eng.props, opts); },

      remove(t) {
        if (!t.alive) return;
        t.alive = false;
        eng.targets.remove(t.obj);
        eng.list = eng.list.filter(x => x !== t);
      },

      /** Removes a target with its death animation. */
      kill(t, { head = false } = {}) {
        if (!t.alive) return;
        ctx.remove(t);
        eng.fx.add(t.obj);
        const p = new THREE.Vector3();
        if (t.bot) {
          (t.obj.userData.rig.head).getWorldPosition(p);
          if (head) eng.shards(p, 0x7a1d14, 10);
          eng.dyingList.push(dying(t.obj, 'bot', { head }));
        } else {
          p.copy(t.obj.position);
          eng.shards(p, t.color, 12);
          eng.dyingList.push(dying(t.obj, 'sphere'));
        }
      },

      /** A successful hit worth `points`. kill: target dies. */
      hit(t, points, { kill = true, head = false, reaction = null, feed = null, sound = true } = {}) {
        if (preview) return;
        const s = st();
        s.hits++;
        s.streak++;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        s.score += points;
        if (kill) {
          s.kills++;
          if (head) s.headshots++;
          if (reaction != null) s.reactions.push(reaction);
          ctx.kill(t, { head });
        }
        if (sound) {
          if (t.bot && !head) audio.flesh();
          audio.hit(head);
        }
        eng.marker = 1;
        eng.markerHead = head;
        if (feed !== false) eng.emit('feed', feed || `+${Math.round(points)}`, head ? 'hs' : '');
      },

      miss() {
        if (preview) return;
        const s = st();
        s.misses++;
        s.streak = 0;
      },

      penalty(points, text) {
        if (preview) return;
        const s = st();
        s.score -= points;
        s.penalties++;
        s.streak = 0;
        audio.bad();
        eng.emit('feed', text || `-${points}`, 'bad');
      },

      escaped(t) {
        if (!preview) {
          st().escaped++;
          st().streak = 0;
        }
        ctx.remove(t);
      },

      feed(text, cls = '') { if (!preview) eng.emit('feed', text, cls); },
      message(text) { if (!preview) eng.emit('message', text); },
      hud(text) { if (!preview) eng.emit('hud', text); },
      end() { if (!preview) eng.finish(); },
      decal(p) { eng.impact(p); },
      sound: audio,
    };
    return ctx;
  }
}

function newStats() {
  return {
    score: 0, shots: 0, hits: 0, kills: 0, misses: 0, streak: 0, maxStreak: 0,
    reactions: [], headshots: 0, headTicks: 0, escaped: 0, penalties: 0, ticks: 0, trackHits: 0, extra: {},
  };
}

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}
