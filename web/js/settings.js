// Persistent settings (localStorage) and CS2 config import.

const KEY = 'tetik.settings.v1';

export const DEFAULTS = {
  sens: 1.0,          // CS2 "sensitivity"
  dpi: 800,
  raw: true,
  fovMode: 'cs2',     // 'cs2' = 90° horizontal at 4:3 (Hor+), or 'custom'
  fov: 103,           // custom horizontal FOV at the window's aspect ratio
  duration: 60,
  targetColor: '#ff3b3b',
  targetSize: 1.0,
  theme: 'gun',
  quality: 'high',    // low | medium | high
  viewmodel: true,    // show the rifle
  footsteps: true,
  difficulty: 'normal',
  countdown: true,
  showFps: false,
  renderScale: 1.0,
  volume: 0.6,
  shotVolume: 0.45,
  hitSound: 'tink',
  name: '',
  touchMode: 'tap',   // 'tap' = shoot where you touch, 'drag' = drag to aim + fire button
  touchSens: 0.2,     // degrees per pixel of finger movement (drag mode)
  // Crosshair in CS2 units (cl_crosshairsize, _thickness, _gap ...).
  xh: {
    size: 2,
    thickness: 0.6,
    gap: -2,
    outline: true,
    outlineThickness: 1,
    color: '#00ff00',
    alpha: 1,
    dot: false,
    t: false,
    hitmarker: false,
  },
};

export const M_YAW = 0.022; // CS2 degrees per mouse count at sensitivity 1

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = JSON.parse(raw || '{}');
    // Phones: lower render resolution and no shadows by default.
    if (!raw && matchMedia('(pointer: coarse)').matches) { s.renderScale = 0.75; s.quality = 'low'; }
    // Theme ids from 0.1.
    s.theme = { dust: 'gun', night: 'gece', lab: 'beyaz' }[s.theme] || s.theme;
    // 0.1 stored the crosshair in pixels; start over with CS2 defaults.
    if (s.xh && !('size' in s.xh)) delete s.xh;
    return { ...structuredClone(DEFAULTS), ...s, xh: { ...DEFAULTS.xh, ...(s.xh || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function reset() {
  localStorage.removeItem(KEY);
  return structuredClone(DEFAULTS);
}

/** Centimetres of mouse travel for a full 360° turn. */
export function cm360(sens, dpi) {
  return (360 / (sens * M_YAW * dpi)) * 2.54;
}

/** Vertical FOV (degrees) for the camera at the given aspect ratio. */
export function verticalFov(s, aspect) {
  const h = s.fovMode === 'cs2'
    // CS2 keeps 90° horizontal at 4:3 and widens for wider screens (Hor+).
    ? 2 * Math.atan(Math.tan((90 * Math.PI) / 360) * (aspect / (4 / 3))) * 180 / Math.PI
    : s.fov;
  return 2 * Math.atan(Math.tan((h * Math.PI) / 360) / aspect) * 180 / Math.PI;
}

/**
 * Imports from CS2: a crosshair share code (CSGO-xxxxx-...) and/or console
 * commands / config.cfg lines (`sensitivity 1.2; cl_crosshairsize "2"`).
 * Returns human-readable names of what was applied.
 */
export function importCs2(text, s, decodeShareCode) {
  const applied = [];
  const code = text.match(/CSGO(-[A-Za-z0-9]{5}){5}/);
  if (code) {
    const xh = decodeShareCode(code[0]);
    if (xh) {
      Object.assign(s.xh, xh);
      applied.push('nişangah kodu');
    }
  }
  const vals = {};
  for (const part of text.split(/[;\n]/)) {
    const m = part.trim().match(/^([a-z_0-9]+)\s+"?(-?[\d.]+)"?/i);
    if (m) vals[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  const set = (k, label, fn) => {
    if (k in vals && Number.isFinite(vals[k])) { fn(vals[k]); if (!applied.includes(label)) applied.push(label); }
  };
  set('sensitivity', 'hassasiyet', v => { s.sens = clamp(v, 0.01, 20); });
  set('cl_crosshairsize', 'boyut', v => { s.xh.size = clamp(v, 0, 20); });
  set('cl_crosshairthickness', 'kalınlık', v => { s.xh.thickness = clamp(v, 0, 6); });
  set('cl_crosshairgap', 'boşluk', v => { s.xh.gap = clamp(v, -10, 10); });
  set('cl_crosshair_drawoutline', 'dış çizgi', v => { s.xh.outline = v !== 0; });
  set('cl_crosshair_outlinethickness', 'dış çizgi', v => { s.xh.outlineThickness = clamp(v, 0, 3); });
  set('cl_crosshairdot', 'nokta', v => { s.xh.dot = v !== 0; });
  set('cl_crosshair_t', 'T şekli', v => { s.xh.t = v !== 0; });
  set('cl_crosshairalpha', 'saydamlık', v => { s.xh.alpha = clamp(v / 255, 0.1, 1); });
  set('cl_crosshairusealpha', 'saydamlık', v => { if (!v) s.xh.alpha = 1; });
  const presets = ['#ff0000', '#00ff00', '#ffff00', '#0000ff', '#00ffff'];
  set('cl_crosshaircolor', 'renk', v => { if (v >= 0 && v < 5) s.xh.color = presets[v]; });
  if (vals.cl_crosshaircolor === 5 && ['cl_crosshaircolor_r', 'cl_crosshaircolor_g', 'cl_crosshaircolor_b'].every(k => k in vals)) {
    const hex = k => clamp(Math.round(vals[k]), 0, 255).toString(16).padStart(2, '0');
    s.xh.color = '#' + hex('cl_crosshaircolor_r') + hex('cl_crosshaircolor_g') + hex('cl_crosshaircolor_b');
  }
  return applied;
}

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
