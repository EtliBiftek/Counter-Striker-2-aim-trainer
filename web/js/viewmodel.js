// First-person rifle, rendered in its own scene on top of the world so it
// never clips into walls and keeps its own field of view. Purely visual:
// recoil here never moves the aim.

import * as THREE from '../vendor/three.module.min.js';

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(-9, 0); g.lineTo(0, -62 + Math.random() * 18); g.lineTo(9, 0);
    g.fill();
  }
  g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xdfe8f5, 0x3a3630, 1.4);
    this.key = new THREE.DirectionalLight(0xfff1dc, 1.8);
    this.key.position.set(-1, 2, 1.5);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.2, 2);
    this.scene.add(this.hemi, this.key, this.muzzleLight);

    this.root = new THREE.Group(); // sway/recoil pivot
    this.scene.add(this.root);
    this.gun = this.buildGun();
    this.root.add(this.gun);
    this.base = new THREE.Vector3(0.2, -0.19, -0.52);
    this.root.position.copy(this.base);

    const fm = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flash = new THREE.Sprite(fm);
    this.flash.position.set(0, 0.005, -0.62);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.muzzleLight.position.set(0.15, -0.15, -0.9);

    // Springs: kick back (z), muzzle up (rx), roll (rz); sway from look speed.
    this.k = { z: 0, vz: 0, rx: 0, vrx: 0, rz: 0, vrz: 0 };
    this.sway = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.flashT = 0;
    this.time = 0;
    this.visible = true;
  }

  buildGun() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.42, metalness: 0.65 });
    const poly = new THREE.MeshStandardMaterial({ color: 0x4f4a3e, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.7 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.9 });
    const box = (w, h, d, m, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      g.add(mesh);
      return mesh;
    };
    const cyl = (r, len, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), m);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    box(0.046, 0.06, 0.28, metal, 0, 0, 0);                // receiver
    box(0.02, 0.01, 0.26, dark, 0, 0.035, -0.02);          // top rail
    box(0.05, 0.054, 0.22, poly, 0, -0.002, -0.25);        // handguard
    cyl(0.008, 0.15, metal, 0, 0.004, -0.43);              // barrel
    cyl(0.013, 0.05, dark, 0, 0.004, -0.52);               // muzzle device
    box(0.005, 0.03, 0.006, dark, 0, 0.05, -0.34);         // front sight
    box(0.016, 0.02, 0.018, dark, 0, 0.05, 0.09);          // rear sight
    box(0.032, 0.14, 0.06, dark, 0, -0.095, -0.07, 0.28);  // magazine
    box(0.028, 0.09, 0.04, poly, 0, -0.068, 0.08, -0.38);  // grip
    box(0.038, 0.058, 0.17, poly, 0, -0.012, 0.22);        // stock
    box(0.042, 0.075, 0.02, dark, 0, -0.018, 0.31);        // butt pad

    // Gloved hands on the grip and under the handguard.
    box(0.046, 0.055, 0.075, glove, 0.006, -0.068, 0.085, -0.3);
    box(0.056, 0.045, 0.09, glove, -0.006, -0.042, -0.26, 0.1);
    g.rotation.y = -0.035;
    return g;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Mouse delta in pixels this frame, for weapon sway. */
  addLook(dx, dy) {
    this.look.x += dx;
    this.look.y += dy;
  }

  kick(strength = 1) {
    const k = this.k;
    k.vz += 2.2 * strength;
    k.vrx += 11 * strength * (0.85 + Math.random() * 0.3);
    k.vrz += (Math.random() - 0.5) * 6 * strength;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.12 + Math.random() * 0.06);
  }

  update(dt) {
    this.time += dt;
    const k = this.k;
    const spring = (x, v, stiff, damp) => {
      const a = -stiff * x - damp * v;
      v += a * dt;
      return [x + v * dt, v];
    };
    [k.z, k.vz] = spring(k.z, k.vz, 260, 22);
    [k.rx, k.vrx] = spring(k.rx, k.vrx, 300, 24);
    [k.rz, k.vrz] = spring(k.rz, k.vrz, 200, 20);

    // Sway lags behind the view, eases back.
    const lag = 1 - Math.exp(-dt * 12);
    this.sway.x += (Math.max(-60, Math.min(60, this.look.x)) * 0.0004 - this.sway.x) * lag;
    this.sway.y += (Math.max(-60, Math.min(60, this.look.y)) * 0.0004 - this.sway.y) * lag;
    this.look.set(0, 0);

    const breathe = Math.sin(this.time * 1.6) * 0.0016;
    this.root.position.set(
      this.base.x - this.sway.x,
      this.base.y + this.sway.y + breathe,
      this.base.z + k.z * 0.03,
    );
    this.root.rotation.set(k.rx * 0.02 + this.sway.y * 1.5, this.sway.x * 1.5, k.rz * 0.01 - this.sway.x * 2);

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.muzzleLight.intensity = this.flashT > 0 ? 3 : 0;
  }

  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
