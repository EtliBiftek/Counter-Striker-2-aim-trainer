// Crosshair on a 2D canvas overlay. Values use CS2's units (cl_crosshairsize,
// cl_crosshairthickness, cl_crosshairgap) and scale with the window height
// like CS2 does; the pixel mapping is approximate.

export function draw(canvas, xh, opts = {}) {
  const dpr = opts.dpr ?? (window.devicePixelRatio || 1);
  const w = opts.width ?? window.innerWidth;
  const h = opts.height ?? window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (opts.hidden) return;

  // CS2 draws in units of screen height / 480.
  const unit = ((opts.refHeight ?? h) / 480) * dpr;
  const cx = Math.round(canvas.width / 2);
  const cy = Math.round(canvas.height / 2);
  const t = Math.max(1, Math.round(xh.thickness * unit));
  const len = Math.round(xh.size * unit);
  const gap = Math.round(((xh.gap + 4) * unit) / 2.25);
  const ol = xh.outline ? Math.max(1, Math.round(xh.outlineThickness * dpr)) : 0;
  const a = Math.floor(t / 2);
  g.globalAlpha = xh.alpha;

  const rects = [];
  if (len > 0) {
    rects.push([cx + gap + a + (t % 2), cy - a, len, t]);  // right
    rects.push([cx - gap - a - len, cy - a, len, t]);      // left
    rects.push([cx - a, cy + gap + a + (t % 2), t, len]);  // bottom
    if (!xh.t) rects.push([cx - a, cy - gap - a - len, t, len]); // top
  }
  if (xh.dot) rects.push([cx - a, cy - a, t, t]);

  if (ol) {
    g.fillStyle = '#000';
    for (const [x, y, rw, rh] of rects) g.fillRect(x - ol, y - ol, rw + 2 * ol, rh + 2 * ol);
  }
  g.fillStyle = xh.color;
  for (const [x, y, rw, rh] of rects) g.fillRect(x, y, rw, rh);

  // Hit marker: four short diagonal strokes, fades out.
  if (opts.marker > 0) {
    g.globalAlpha = opts.marker;
    g.strokeStyle = opts.markerHead ? '#f5c400' : '#ffffff';
    g.lineWidth = Math.max(1.5, unit * 0.7);
    const p = (gap + len + 4 * dpr) * 0.7, q = p + 5 * dpr;
    g.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.moveTo(cx + sx * p, cy + sy * p);
      g.lineTo(cx + sx * q, cy + sy * q);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- share codes

const ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
export const CS_COLORS = ['#ff0000', '#00ff00', '#ffff00', '#0000ff', '#00ffff'];

/**
 * Decodes a CS2 crosshair share code (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx)
 * into our crosshair fields, or returns null if it is not a valid code.
 * The code is 18 bytes in base 57 (characters least significant first);
 * byte 0 is a checksum of the others.
 */
export function decodeShareCode(code) {
  const s = String(code).trim();
  if (!/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(s)) return null;
  const chars = s.slice(5).replace(/-/g, '');
  let n = 0n;
  for (let i = chars.length - 1; i >= 0; i--) {
    const v = ALPHABET.indexOf(chars[i]);
    if (v < 0) return null;
    n = n * 57n + BigInt(v);
  }
  const b = [];
  for (let i = 0; i < 18; i++) { b.unshift(Number(n & 0xffn)); n >>= 8n; }
  if (n !== 0n) return null;
  const sum = b.slice(1).reduce((x, y) => x + y, 0) % 256;
  if (b[0] !== sum) return null;
  const i8 = v => (v << 24) >> 24;
  const color = b[10] & 7;
  const hex = x => x.toString(16).padStart(2, '0');
  return {
    gap: i8(b[2]) / 10,
    outlineThickness: b[3] / 2,
    color: color === 5 ? `#${hex(b[4])}${hex(b[5])}${hex(b[6])}` : CS_COLORS[color] ?? '#00ff00',
    alpha: ((b[13] >> 4) & 4) ? b[7] / 255 : 1,
    outline: (b[10] & 8) === 8,
    thickness: b[12] / 10,
    dot: ((b[13] >> 4) & 1) === 1,
    t: ((b[13] >> 4) & 8) === 8,
    size: b[14] / 10,
  };
}
