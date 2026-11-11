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
  theme: 'dust',
  countdown: true,
  showFps: false,
  renderScale: 1.0,
  volume: 0.6,
  shotVolume: 0.35,
  hitSound: 'tink',
  name: '',
  xh: {
    style: 'classic',
    color: '#4dff6a',
    len: 5,
    thick: 1.5,
    gap: 2,
    alpha: 1,
    outline: true,
    hitmarker: false,
  },
};

export const M_YAW = 0.022; // CS2 degrees per mouse count at sensitivity 1

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
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
 * Parses CS2 console commands (`sensitivity 1.2; cl_crosshairsize "2"` …)
 * into settings. Crosshair units are converted approximately to pixels at
 * 1080p. Returns the list of applied keys.
 */
export function importCs2(text, s) {
  const vals = {};
  for (const part of text.split(/[;\n]/)) {
    const m = part.trim().match(/^([a-z_0-9]+)\s+"?(-?[\d.]+)"?/i);
    if (m) vals[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  const applied = [];
  const set = (k, fn) => { if (k in vals && Number.isFinite(vals[k])) { fn(vals[k]); applied.push(k); } };
  set('sensitivity', v => { s.sens = clamp(v, 0.01, 20); });
  set('cl_crosshairsize', v => { s.xh.len = clamp(v * 2, 0, 20); });
  set('cl_crosshairthickness', v => { s.xh.thick = clamp(Math.max(0.5, v * 2), 0.5, 6); });
  set('cl_crosshairgap', v => { s.xh.gap = clamp(v + 4, -4, 12); });
  set('cl_crosshair_drawoutline', v => { s.xh.outline = v !== 0; });
  set('cl_crosshairalpha', v => { s.xh.alpha = clamp(v / 255, 0.2, 1); });
  set('cl_crosshairusealpha', v => { if (!v) s.xh.alpha = 1; });
  set('cl_crosshairdot', v => {
    if (v && s.xh.style === 'classic') s.xh.style = 'classic-dot';
    if (!v && s.xh.style === 'classic-dot') s.xh.style = 'classic';
  });
  set('cl_crosshair_t', v => { if (v) s.xh.style = 't'; });
  const presets = ['#ff3b3b', '#4dff6a', '#fff04d', '#3b6bff', '#4dfff6'];
  set('cl_crosshaircolor', v => { if (v >= 0 && v < 5) s.xh.color = presets[v]; });
  if (vals.cl_crosshaircolor === 5 && ['cl_crosshaircolor_r', 'cl_crosshaircolor_g', 'cl_crosshaircolor_b'].every(k => k in vals)) {
    const hex = k => clamp(Math.round(vals[k]), 0, 255).toString(16).padStart(2, '0');
    s.xh.color = '#' + hex('cl_crosshaircolor_r') + hex('cl_crosshaircolor_g') + hex('cl_crosshaircolor_b');
    applied.push('cl_crosshaircolor_rgb');
  }
  return applied;
}

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
