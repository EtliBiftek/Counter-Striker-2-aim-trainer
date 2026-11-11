// Targets: spheres, cubes and humanoid bots (1.83 m, CS-like proportions),
// with spawn, walk and death animations.

import * as THREE from '../vendor/three.module.min.js';

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
  return mats.get(key);
}

export function sphereMaterial(color) {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({ color: c, emissive: c.clone().multiplyScalar(0.22), roughness: 0.28, metalness: 0.05 });
}

const sphereGeo = new THREE.SphereGeometry(1, 32, 22);
const cubeGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);

export function makeSphere(r, material) {
  const m = new THREE.Mesh(sphereGeo, material);
  m.scale.setScalar(r);
  m.castShadow = true;
  return m;
}

export function makeCube(r, material) {
  const m = new THREE.Mesh(cubeGeo, material);
  m.scale.setScalar(r);
  m.rotation.set(0.6, 0.6, 0);
  m.castShadow = true;
  return m;
}

// Two outfits so the range does not look like clones.
const OUTFITS = [
  { shirt: '#5d5a45', vest: '#3f3d30', pants: '#4a4636', helmet: '#4d4b3a', skin: '#c79a78' },
  { shirt: '#3c4450', vest: '#262b33', pants: '#2f343c', helmet: '#2c3138', skin: '#a8785a' },
  { shirt: '#7a6a52', vest: '#4e4535', pants: '#5a4f3e', helmet: '#6b5d47', skin: '#e0b896' },
];

/**
 * Humanoid bot. Origin at the feet, faces +Z. Meshes carry
 * userData.part = 'head' | 'body' | 'leg' for damage.
 */
export function makeBot(outfit = OUTFITS[Math.floor(Math.random() * OUTFITS.length)]) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ'; // yaw to face the player, then fall in local space
  const shirt = mat(outfit.shirt);
  const vest = mat(outfit.vest, { roughness: 0.9 });
  const pants = mat(outfit.pants);
  const helmet = mat(outfit.helmet, { roughness: 0.6 });
  const skin = mat(outfit.skin, { roughness: 0.7 });
  const black = mat('#1b1c1e', { roughness: 0.6 });
  const part = (mesh, p, parent = g) => { mesh.userData.part = p; mesh.castShadow = true; parent.add(mesh); return mesh; };
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

  // Legs pivot at the hips.
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.1 * side, 0.93, 0);
    const thigh = part(new THREE.Mesh(capsule(0.085, 0.34), pants), 'leg', hip);
    thigh.position.y = -0.22;
    const shin = part(new THREE.Mesh(capsule(0.07, 0.34), pants), 'leg', hip);
    shin.position.y = -0.62;
    const boot = part(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.24), black), 'leg', hip);
    boot.position.set(0, -0.88, 0.04);
    g.add(hip);
    legs.push(hip);
  }

  const torso = part(new THREE.Mesh(capsule(0.17, 0.32), shirt), 'body');
  torso.position.y = 1.24;
  torso.scale.set(1.22, 1, 0.72);
  const plate = part(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.29), vest), 'body');
  plate.position.set(0, 1.24, 0);
  for (const x of [-0.11, 0, 0.11]) {
    const pouch = part(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.05), vest), 'body');
    pouch.position.set(x, 1.12, 0.165);
  }
  const belt = part(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.07, 0.25), black), 'body');
  belt.position.y = 0.97;

  // Arms forward, holding a rifle.
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(0.25 * side, 1.43, 0);
    const upper = part(new THREE.Mesh(capsule(0.06, 0.24), shirt), 'body', sh);
    upper.position.set(0, -0.16, 0.03);
    upper.rotation.x = 0.35;
    const fore = part(new THREE.Mesh(capsule(0.05, 0.24), shirt), 'body', sh);
    fore.position.set(-0.07 * side, -0.3, 0.2);
    fore.rotation.set(1.25, 0, 0.35 * side);
    g.add(sh);
    arms.push(sh);
  }
  const rifle = part(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.7), black), 'body');
  rifle.position.set(0.04, 1.14, 0.36);

  const neck = part(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 10), skin), 'head');
  neck.position.y = 1.52;
  const head = part(new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), skin), 'head');
  head.position.y = 1.635;
  head.scale.set(0.95, 1.08, 1);
  const hel = part(new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet), 'head');
  hel.position.y = 1.655;
  const goggles = part(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.05), black), 'head');
  goggles.position.set(0, 1.66, 0.085);

  g.userData.rig = { legs, arms, helmet: hel, head };
  return g;
}

/** Walk cycle while moving sideways (step) or forward (stride). */
export function animateBot(t, dt) {
  const rig = t.obj.userData.rig;
  if (!rig) return 0;
  const speed = Math.hypot(t.vx || 0, t.vz || 0);
  const amt = Math.min(1, speed / 4);
  t.phase = (t.phase || 0) + dt * (4 + speed * 1.6);
  const s = Math.sin(t.phase);
  const side = Math.abs(t.vx || 0) >= Math.abs(t.vz || 0);
  rig.legs[0].rotation.set(side ? 0 : s * 0.55 * amt, 0, side ? s * 0.22 * amt : 0);
  rig.legs[1].rotation.set(side ? 0 : -s * 0.55 * amt, 0, side ? -s * 0.22 * amt : 0);
  t.obj.position.y = Math.abs(Math.cos(t.phase)) * 0.025 * amt;
  // Returns a value crossing zero on each footfall, for step sounds.
  return amt > 0.4 ? s : 0;
}

/** Death animations, owned by the engine's fx list. */
export function dying(obj, kind, { head = false, away = 1 } = {}) {
  const d = { obj, kind, t: 0, done: false };
  if (kind === 'bot' && head) {
    const hel = obj.userData.rig?.helmet;
    if (hel) {
      // The helmet flies off.
      const wp = new THREE.Vector3();
      hel.getWorldPosition(wp);
      obj.remove(hel);
      hel.position.copy(wp);
      d.helmet = hel;
      d.hv = new THREE.Vector3((Math.random() - 0.5) * 1.5, 3 + Math.random(), -2.5 * away);
      d.hs = new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0);
    }
  }
  if (kind !== 'bot') {
    obj.material = obj.material.clone();
    obj.material.transparent = true;
    d.base = obj.scale.x;
  }
  d.fall = (Math.random() < 0.5 ? -1 : 1) * 0.25;
  return d;
}

/** Advances a death animation; returns false when finished. */
export function stepDying(d, dt, scene) {
  d.t += dt;
  if (d.kind === 'bot') {
    const k = Math.min(1, d.t / 0.42);
    const e = k * k; // accelerate like a fall
    d.obj.rotation.x = -e * Math.PI / 2 * 0.96;
    d.obj.rotation.z = e * d.fall;
    if (d.t > 0.9) d.obj.position.y -= dt * 0.8;
    if (d.helmet) {
      if (!d.helmet.parent) scene.add(d.helmet);
      d.hv.y -= 9.8 * dt;
      d.helmet.position.addScaledVector(d.hv, dt);
      d.helmet.rotation.x += d.hs.x * dt;
      d.helmet.rotation.y += d.hs.y * dt;
      if (d.helmet.position.y < 0.12) { d.helmet.position.y = 0.12; d.hv.multiplyScalar(0.4); d.hv.y = Math.abs(d.hv.y) * 0.3; }
    }
    if (d.t > 1.6) {
      d.obj.parent?.remove(d.obj);
      d.helmet?.parent?.remove(d.helmet);
      return false;
    }
    return true;
  }
  const k = Math.min(1, d.t / 0.13);
  d.obj.scale.setScalar(d.base * (1 + 0.45 * k));
  d.obj.material.opacity = 1 - k;
  if (k >= 1) { d.obj.parent?.remove(d.obj); return false; }
  return true;
}
