// Local run history and personal bests.

const KEY = 'tetik.history.v1';
const MAX_PER_MODE = 100;

function all() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export const runKey = (mode, difficulty) => (difficulty && difficulty !== 'normal' ? `${mode}@${difficulty}` : mode);

export function record(run) {
  const h = all();
  const k = runKey(run.mode, run.difficulty);
  const list = h[k] || [];
  list.push(run);
  h[k] = list.slice(-MAX_PER_MODE);
  localStorage.setItem(KEY, JSON.stringify(h));
}

export function history(mode, difficulty = 'normal') {
  return all()[runKey(mode, difficulty)] || [];
}

export function best(mode, difficulty = 'normal') {
  return history(mode, difficulty).reduce((b, r) => (b && b.score >= r.score ? b : r), null);
}

export function summary() {
  const h = all();
  return Object.entries(h).map(([mode, runs]) => {
    const scores = runs.map(r => r.score);
    const last10 = runs.slice(-10);
    return {
      mode,
      runs: runs.length,
      best: Math.max(...scores),
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      avgAcc: last10.reduce((a, r) => a + r.accuracy, 0) / last10.length,
      seconds: runs.reduce((a, r) => a + r.duration, 0),
      last: runs[runs.length - 1].at,
    };
  });
}

export function wipe() {
  localStorage.removeItem(KEY);
}

/**
 * Score history as a thin line with the personal best dashed. `compact`
 * draws a bare sparkline (menu); otherwise axes labels are added.
 */
export function drawChart(canvas, runs, { compact = false, accent = '#f5c400' } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const pts = runs.slice(-20);
  g.font = '500 12px "Barlow Condensed", sans-serif';
  if (pts.length < 2) {
    g.fillStyle = '#6f6c66';
    g.fillText(pts.length ? 'TEK KAYIT' : 'KAYIT YOK', 0, h / 2 + 4);
    return;
  }
  const padL = compact ? 2 : 44, padR = 4, padY = compact ? 3 : 10;
  const scores = pts.map(p => p.score);
  const max = Math.max(...scores), min = Math.min(...scores);
  const span = max - min || 1;
  const x = i => padL + (i * (w - padL - padR)) / (pts.length - 1);
  const y = v => h - padY - ((v - min) * (h - 2 * padY)) / span;
  if (!compact) {
    g.fillStyle = '#6f6c66';
    g.textAlign = 'right';
    g.fillText(Math.round(max).toLocaleString('tr-TR'), padL - 8, padY + 4);
    g.fillText(Math.round(min).toLocaleString('tr-TR'), padL - 8, h - padY + 4);
    g.textAlign = 'left';
    g.strokeStyle = '#2a2b2d';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, h - padY + 0.5); g.lineTo(w - padR, h - padY + 0.5); g.stroke();
  }
  // Best so far, dashed.
  g.setLineDash([3, 3]);
  g.strokeStyle = '#4a4844';
  g.beginPath(); g.moveTo(padL, y(max) + 0.5); g.lineTo(w - padR, y(max) + 0.5); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = '#bdb8ad';
  g.lineWidth = 1.25;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.score)) : g.moveTo(x(i), y(p.score))));
  g.stroke();
  const last = pts.length - 1;
  g.fillStyle = accent;
  g.fillRect(x(last) - 2.5, y(scores[last]) - 2.5, 5, 5);
}
