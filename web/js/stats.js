// Local run history and personal bests.

const KEY = 'tetik.history.v1';
const MAX_PER_MODE = 100;

function all() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function record(run) {
  const h = all();
  const list = h[run.mode] || [];
  list.push(run);
  h[run.mode] = list.slice(-MAX_PER_MODE);
  localStorage.setItem(KEY, JSON.stringify(h));
}

export function history(mode) {
  return all()[mode] || [];
}

export function best(mode) {
  return history(mode).reduce((b, r) => (b && b.score >= r.score ? b : r), null);
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

/** Small line chart of the last scores, best marked. */
export function drawChart(canvas, runs, color = '#ffb020') {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const pts = runs.slice(-20);
  g.font = '12px system-ui';
  if (pts.length < 2) {
    g.fillStyle = '#8794a8';
    g.fillText('Grafik için en az 2 oyun gerekli.', 14, h / 2);
    return;
  }
  const pad = 26;
  const max = Math.max(...pts.map(p => p.score)) * 1.08 || 1;
  const min = Math.min(...pts.map(p => p.score)) * 0.9;
  const x = i => pad + (i * (w - 2 * pad)) / (pts.length - 1);
  const y = v => h - pad - ((v - min) * (h - 2 * pad)) / (max - min || 1);
  g.strokeStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i <= 3; i++) {
    const yy = pad + (i * (h - 2 * pad)) / 3;
    g.beginPath(); g.moveTo(pad, yy); g.lineTo(w - pad, yy); g.stroke();
  }
  const grad = g.createLinearGradient(0, pad, 0, h - pad);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '00');
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.score)) : g.moveTo(x(i), y(p.score))));
  g.lineTo(x(pts.length - 1), h - pad); g.lineTo(x(0), h - pad); g.closePath();
  g.fillStyle = grad; g.fill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.score)) : g.moveTo(x(i), y(p.score))));
  g.strokeStyle = color; g.lineWidth = 2; g.stroke();
  pts.forEach((p, i) => {
    g.beginPath(); g.arc(x(i), y(p.score), i === pts.length - 1 ? 4.5 : 2.5, 0, Math.PI * 2);
    g.fillStyle = i === pts.length - 1 ? '#fff' : color; g.fill();
  });
  g.fillStyle = '#8794a8';
  g.fillText(String(Math.round(max)), 4, pad - 8);
}
