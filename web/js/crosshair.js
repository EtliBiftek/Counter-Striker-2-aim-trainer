// Crosshair drawn on a 2D canvas overlay. Sizes are pixels at 1080p and
// scale with the window height, like CS2.

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

  const k = (opts.scale ?? h / 1080) * dpr;
  const cx = Math.round(canvas.width / 2);
  const cy = Math.round(canvas.height / 2);
  const t = Math.max(1, Math.round(xh.thick * k));
  const len = Math.round(xh.len * k);
  const gap = Math.round(xh.gap * k);
  const ol = xh.outline ? Math.max(1, Math.round(k)) : 0;
  g.globalAlpha = xh.alpha;

  const rects = [];
  const half = Math.floor(t / 2);
  if (xh.style !== 'dot' && xh.style !== 'circle' && len > 0) {
    rects.push([cx + gap + half + 1, cy - half, len, t]);        // right
    rects.push([cx - gap - half - len, cy - half, len, t]);       // left
    rects.push([cx - half, cy + gap + half + 1, t, len]);         // bottom
    if (xh.style !== 't') rects.push([cx - half, cy - gap - half - len, t, len]); // top
  }
  if (xh.style === 'classic-dot' || xh.style === 'dot') rects.push([cx - half, cy - half, t, t]);

  if (ol) {
    g.fillStyle = '#000';
    for (const [x, y, rw, rh] of rects) g.fillRect(x - ol, y - ol, rw + 2 * ol, rh + 2 * ol);
  }
  g.fillStyle = xh.color;
  for (const [x, y, rw, rh] of rects) g.fillRect(x, y, rw, rh);

  if (xh.style === 'circle') {
    const r = Math.max(3 * k, (xh.gap + xh.len) * k);
    const ring = (color, width) => {
      g.strokeStyle = color; g.lineWidth = width;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    };
    if (ol) ring('#000', t + 2 * ol);
    ring(xh.color, t);
    if (ol) g.fillStyle = '#000', g.fillRect(cx - half - ol, cy - half - ol, t + 2 * ol, t + 2 * ol);
    g.fillStyle = xh.color; g.fillRect(cx - half, cy - half, t, t);
  }

  // Hit marker: four short diagonal strokes, fades out.
  if (opts.marker > 0) {
    g.globalAlpha = opts.marker;
    g.strokeStyle = opts.markerHead ? '#ffb020' : '#ffffff';
    g.lineWidth = Math.max(1.5, 1.5 * k);
    const a = 8 * k, b = 15 * k;
    g.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.moveTo(cx + sx * a, cy + sy * a);
      g.lineTo(cx + sx * b, cy + sy * b);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}
