// Leaderboard backend: the Tauri app's Rust commands, the Rust web server's
// HTTP API, or (static hosting / offline) a local leaderboard in localStorage.

const tauri = window.__TAURI__?.core;
const LOCAL_KEY = 'tetik.localboard.v1';
let serverOk = null; // null = unknown

export async function backend() {
  if (tauri) return 'desktop';
  // Static hosting (GitHub Pages) has no score server: skip the probe.
  if (serverOk === null && /\.github\.io$/.test(location.hostname)) serverOk = false;
  if (serverOk === null) {
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      serverOk = r.ok && (await r.text()) === 'ok';
    } catch {
      serverOk = false;
    }
  }
  return serverOk ? 'server' : 'local';
}

export const BACKEND_LABEL = {
  desktop: 'bu cihaz',
  server: 'sunucu',
  local: 'bu tarayıcı',
};

export async function submit(entry) {
  const b = await backend();
  if (b === 'desktop') return tauri.invoke('submit_score', { entry });
  if (b === 'server') {
    const r = await fetch('api/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  return localSubmit(entry);
}

const key = (mode, difficulty) => (difficulty && difficulty !== 'normal' ? `${mode}@${difficulty}` : mode);

export async function top(mode, difficulty = 'normal', limit = 20) {
  const b = await backend();
  if (b === 'desktop') return tauri.invoke('leaderboard', { mode, difficulty, limit });
  if (b === 'server') {
    const r = await fetch(`api/leaderboard?mode=${encodeURIComponent(mode)}&difficulty=${difficulty}&limit=${limit}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  return (localBoard()[key(mode, difficulty)] || []).slice(0, limit);
}

function localBoard() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}

function localSubmit(e) {
  const name = String(e.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 20) throw new Error('Geçersiz isim (1-20 karakter)');
  const board = localBoard();
  const k = key(e.mode, e.difficulty);
  const list = board[k] || [];
  const entry = { ...e, name, at: Math.floor(Date.now() / 1000) };
  let pos = list.findIndex(x => x.score < e.score);
  if (pos < 0) pos = list.length;
  list.splice(pos, 0, entry);
  board[k] = list.slice(0, 200);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(board));
  return { rank: pos < 200 ? pos + 1 : null, total: board[k].length, best: board[k][0].score };
}
