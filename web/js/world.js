// The range: procedural concrete, sky, lights and shadows, distance markings,
// target boards and cover. Units are metres, the player stands at the origin
// looking down -Z.

import * as THREE from '../vendor/three.module.min.js';

export const THEMES = {
  gun: {
    label: 'Gündüz',
    skyTop: 0x6f97c4, skyHorizon: 0xd9dcd6, fog: 0xc9cbc4, fogNear: 50, fogFar: 140,
    wall: [178, 172, 160], floor: [152, 148, 140], board: '#2c2e31', paint: '#e8e2d0',
    hemi: [0xdfe8f5, 0x5a5348, 1.05], sun: [0xfff1dc, 2.8], exposure: 1.0, lamps: false,
  },
  gece: {
    label: 'Gece',
    skyTop: 0x05070c, skyHorizon: 0x1a2130, fog: 0x0d1118, fogNear: 30, fogFar: 110,
    wall: [92, 94, 98], floor: [70, 72, 75], board: '#232528', paint: '#c9c3b0',
    hemi: [0x6d80a6, 0x15161a, 0.7], sun: [0x9fb4d8, 0.5], exposure: 1.1, lamps: true,
  },
  beyaz: {
    label: 'Beyaz Oda',
    skyTop: 0xe9ecef, skyHorizon: 0xf4f5f6, fog: 0xeef0f2, fogNear: 60, fogFar: 160,
    wall: [222, 224, 226], floor: [196, 199, 203], board: '#2a2d31', paint: '#5b6470',
    hemi: [0xffffff, 0xb9bec6, 1.5], sun: [0xffffff, 1.2], exposure: 1.0, lamps: false, clean: true,
  },
};

const W = 40;      // range width
const Z0 = 5;      // back wall behind the player
const Z1 = -72;    // far wall
const H = 6.5;     // wall height

// ---------------------------------------------------------------- textures

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Cast-concrete look: blotchy tone, grain, a few stains; optionally formwork
 * seams and tie holes. Returns {map, bump} sharing one canvas size.
 */
function concrete(rgb, { size = 512, seed = 1, formwork = false, slabs = 0, clean = false } = {}) {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const [R, G, B] = rgb;
  g.fillStyle = `rgb(${R},${G},${B})`;
  g.fillRect(0, 0, size, size);
  if (!clean) {
    // Large soft blotches.
    for (let i = 0; i < 70; i++) {
      const x = r() * size, y = r() * size, rad = 20 + r() * 90;
      const d = (r() - 0.5) * 22;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${R + d | 0},${G + d | 0},${B + d | 0},0.35)`);
      grad.addColorStop(1, `rgba(${R + d | 0},${G + d | 0},${B + d | 0},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Pores and grain.
    const img = g.getImageData(0, 0, size, size);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const n = (r() - 0.5) * 14 + (r() < 0.004 ? -40 : 0);
      px[i] += n; px[i + 1] += n; px[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    // Water stains running down (walls only).
    for (let i = 0; formwork && i < 6; i++) {
      const x = r() * size, w = 6 + r() * 30;
      const grad = g.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, 'rgba(40,36,30,0.10)');
      grad.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, w, size * (0.3 + r() * 0.6));
    }
  }
  if (formwork) {
    // Panels 2 wide x 2 high per texture, seams and tie holes.
    g.strokeStyle = clean ? 'rgba(0,0,0,0.10)' : 'rgba(30,28,24,0.35)';
    g.lineWidth = clean ? 2 : 3;
    const s = size / 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke();
    }
    if (!clean) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const x = (i + fx) * s, y = (j + fy) * s;
          g.fillStyle = 'rgba(25,23,20,0.55)';
          g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.beginPath(); g.arc(x - 1, y - 1, 2, 0, Math.PI * 2); g.fill();
        }
      }
    }
  }
  if (slabs) {
    g.strokeStyle = clean ? 'rgba(0,0,0,0.12)' : 'rgba(20,18,15,0.45)';
    g.lineWidth = 2;
    const s = size / slabs;
    for (let i = 0; i <= slabs; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

function textTexture(text, { font = '700 180px "Barlow Condensed", sans-serif', color = '#fff', w = 256, h = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boardTexture(base) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 1024, 512);
  // Felt-like noise.
  const img = g.getImageData(0, 0, 1024, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 6;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.moveTo(512, 236); g.lineTo(512, 276); g.moveTo(492, 256); g.lineTo(532, 256); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- world

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sun = null;
  }

  build(themeId, quality) {
    const th = THEMES[themeId] || THEMES.gun;
    this.theme = th;
    this.group.clear();
    const shadows = quality !== 'low';
    const r = this.renderer;
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = th.exposure;

    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.scene.background = new THREE.Color(th.skyHorizon);
    this.group.add(this.sky(th));

    this.group.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
    const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
    sun.position.set(-16, 26, 12);
    sun.target.position.set(0, 0, -24);
    sun.castShadow = shadows && !th.lamps;
    if (sun.castShadow) {
      const sz = quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.set(sz, sz);
      Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 44, bottom: -44, near: 5, far: 90 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
      sun.shadow.radius = 3;
    }
    this.group.add(sun, sun.target);
    this.sun = sun;

    // Floor: slabs with expansion joints, one texture per 8 m.
    const fl = concrete(th.floor, { seed: 7, slabs: 2, clean: th.clean });
    fl.map.repeat.set(W / 8, (Z0 - Z1) / 8);
    fl.bump.repeat.copy(fl.map.repeat);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, Z0 - Z1),
      new THREE.MeshStandardMaterial({ map: fl.map, bumpMap: fl.bump, bumpScale: 0.6, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (Z0 + Z1) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Walls: cast concrete, 4 m per texture.
    const wl = concrete(th.wall, { seed: 3, formwork: true, clean: th.clean });
    const wallMat = (w) => {
      const map = wl.map.clone(); const bump = wl.bump.clone();
      map.needsUpdate = bump.needsUpdate = true;
      map.repeat.set(w / 4, H / 4); bump.repeat.copy(map.repeat);
      return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.8, roughness: 0.95 });
    };
    const wall = (w, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.4), wallMat(w));
      m.position.set(x, H / 2, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      m.castShadow = true;
      this.group.add(m);
    };
    wall(W + 0.8, 0, Z1 - 0.2, 0);
    wall(W + 0.8, 0, Z0 + 0.2, 0);
    wall(Z0 - Z1, -W / 2 - 0.2, (Z0 + Z1) / 2, Math.PI / 2);
    wall(Z0 - Z1, W / 2 + 0.2, (Z0 + Z1) / 2, Math.PI / 2);

    // Painted base band along the side walls.
    const band = new THREE.MeshStandardMaterial({ color: new THREE.Color(`rgb(${th.wall.map(v => Math.round(v * 0.62)).join(',')})`), roughness: 0.85 });
    for (const x of [-W / 2 + 0.01, W / 2 - 0.01]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(Z0 - Z1, 0.6), band);
      b.position.set(x, 0.3, (Z0 + Z1) / 2);
      b.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(b);
    }

    // Distance lines and numbers on the floor, every 10 m.
    const paint = new THREE.MeshBasicMaterial({ color: th.paint, transparent: true, opacity: th.clean ? 0.5 : 0.55 });
    for (let d = 10; d <= 60; d += 10) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, 0.08), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, -d);
      this.group.add(line);
      for (const x of [-W / 2 + 2.2, W / 2 - 2.2]) {
        const n = new THREE.Mesh(
          new THREE.PlaneGeometry(1.6, 1.6),
          new THREE.MeshBasicMaterial({ map: textTexture(String(d), { color: th.paint }), transparent: true, opacity: 0.6, depthWrite: false }),
        );
        n.rotation.x = -Math.PI / 2;
        n.position.set(x, 0.005, -d + 0.95);
        this.group.add(n);
      }
    }
    // Firing line.
    const fline = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, 0.12), new THREE.MeshBasicMaterial({ color: 0xd9a400, transparent: true, opacity: 0.7 }));
    fline.rotation.x = -Math.PI / 2;
    fline.position.set(0, 0.004, -0.8);
    this.group.add(fline);

    // Overhead baffles: concrete beams across the range (classic outdoor range).
    const beamMat = wallMat(W);
    for (const z of [-6, -26, -46]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 1.1, 0.6), beamMat);
      beam.position.set(0, H + 0.6, z);
      beam.castShadow = true;
      this.group.add(beam);
    }

    if (th.lamps) this.floodlights(shadows, quality);
  }

  sky(th) {
    const geo = new THREE.SphereGeometry(180, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(th.skyTop) }, horizon: { value: new THREE.Color(th.skyHorizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    return m;
  }

  floodlights(shadows, quality) {
    const pole = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.6, metalness: 0.5 });
    const head = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff3d6, emissiveIntensity: 2.2 });
    const spots = [[-W / 2 + 1.2, -4, -30], [W / 2 - 1.2, -4, -30], [-W / 2 + 1.2, -38, -60], [W / 2 - 1.2, -38, -60]];
    spots.forEach(([x, z, tz], i) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), pole);
      p.position.set(x, 4.5, z);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.4), head);
      h.position.set(x - Math.sign(x) * 0.3, 9, z);
      const s = new THREE.SpotLight(0xffeccc, 3200, 90, 0.75, 0.6, 1.6);
      s.position.set(x - Math.sign(x) * 0.4, 8.8, z);
      s.target.position.set(-x * 0.2, 0, tz);
      s.castShadow = shadows && (quality === 'high' ? i < 4 : i < 2);
      if (s.castShadow) { s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0005; }
      this.group.add(p, h, s, s.target);
    });
    // Behind the firing line, lighting what faces the player.
    const front = new THREE.SpotLight(0xfff4e0, 1600, 120, 0.42, 0.8, 1.5);
    front.position.set(0, 8, Z0 - 0.5);
    front.target.position.set(0, 0, -30);
    front.castShadow = shadows;
    if (front.castShadow) { front.shadow.mapSize.set(1024, 1024); front.shadow.bias = -0.0005; }
    this.group.add(front, front.target);
  }
}

// ---------------------------------------------------------------- props

/** Charcoal target board on steel legs. Returns the board mesh (blocks shots). */
export function addBoard(parent, theme, { z, w = 16, h = 7, cy = 3 }) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.12),
    new THREE.MeshStandardMaterial({ map: boardTexture(theme.board), roughness: 0.97 }),
  );
  board.position.set(0, cy, z);
  // No shadows on the board: the beam shadow read as a black bar.
  board.receiveShadow = false;
  g.add(board);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.5, metalness: 0.6 });
  const frame = (fw, fh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.16), steel);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  frame(w + 0.2, 0.1, 0, cy + h / 2 + 0.05);
  frame(w + 0.2, 0.1, 0, cy - h / 2 - 0.05);
  frame(0.1, h, -w / 2 - 0.05, cy);
  frame(0.1, h, w / 2 + 0.05, cy);
  const bottom = cy - h / 2 - 0.1;
  if (bottom > 0) {
    for (const x of [-w / 2 + 0.6, w / 2 - 0.6]) frame(0.12, bottom, x, bottom / 2);
  }
  parent.add(g);
  return g;
}

/** Concrete cover block with a painted edge stripe. */
export function addCover(parent, theme, { x, z, w = 3, h = 2.4, d = 0.7 }) {
  const tex = concrete(theme.wall.map(v => v - 14), { size: 256, seed: Math.floor(Math.abs(x * 13 + z * 7)) + 11, clean: theme.clean });
  tex.map.repeat.set(w / 2, h / 2);
  tex.bump.repeat.copy(tex.map.repeat);
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: 0.7, roughness: 0.95 }),
  );
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.12, d + 0.01), new THREE.MeshStandardMaterial({ color: 0xc99a1a, roughness: 0.7 }));
  stripe.position.set(x, h - 0.25, z);
  parent.add(stripe);
  return m;
}

/** Steel plate target on a post (spray mode). Returns {plate, head}. */
export function addPlate(parent, { z, cy = 1.3 }) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.55, metalness: 0.35 });
  const post = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.03), steel);
  body.position.set(0, cy, z);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.03), steel);
  head.position.set(0, cy + 0.5, z);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), steel);
  neck.position.set(0, cy + 0.37, z);
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, cy - 0.35, 0.06), post);
  p.position.set(0, (cy - 0.35) / 2, z - 0.05);
  for (const m of [body, head, neck, p]) { m.castShadow = true; g.add(m); }
  parent.add(g);
  return { group: g, body, head, neck };
}
