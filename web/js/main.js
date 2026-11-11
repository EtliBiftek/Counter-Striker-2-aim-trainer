// UI: menu (live preview behind it), programs, settings, HUD, results.

import { Engine, DIFFICULTY } from './engine.js';
import { MODES, CATEGORIES, PROGRAMS, byId } from './modes.js';
import * as settingsMod from './settings.js';
import * as audio from './audio.js';
import * as xhair from './crosshair.js';
import { decodeShareCode, CS_COLORS } from './crosshair.js';
import * as api from './api.js';
import * as stats from './stats.js';

const VERSION = '0.2.0';
const $ = id => document.getElementById(id);
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('tr-TR', { maximumFractionDigits: d, minimumFractionDigits: d }));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = settingsMod.load();
audio.configure(S);

// Canvas text in the range (floor numbers) needs the webfont loaded first.
await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);

let engine;
try {
  engine = new Engine($('game'), S);
} catch (e) {
  $('loading').textContent = 'WebGL başlatılamadı. Tarayıcıda donanım hızlandırmayı aç.';
  throw e;
}
$('loading').classList.add('hidden');
document.body.classList.toggle('touch', engine.isTouch);

const sel = { kind: 'mode', id: MODES[0].id };
let tab = 'modes';
let current = null;     // mode being played
let lastResult = null;
let program = null;     // { def, index, results: [] }

// ---------------------------------------------------------------- menu

function showMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  program = null;
  engine.stop();
  current = null;
  document.body.classList.remove('playing');
  for (const id of ['hud', 'pause', 'results']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  renderTab();
  previewSelection();
}

function previewSelection() {
  const mode = sel.kind === 'mode' ? byId(sel.id) : byId(PROGRAMS.find(p => p.id === sel.id).steps[0][0]);
  engine.preview(mode);
}

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.tab;
  if (tab === 'modes' && sel.kind !== 'mode') { sel.kind = 'mode'; sel.id = MODES[0].id; previewSelection(); }
  if (tab === 'programs' && sel.kind !== 'program') { sel.kind = 'program'; sel.id = PROGRAMS[0].id; previewSelection(); }
  renderTab();
});

function renderTab() {
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', p.id !== 'p-' + tab);
  const wide = ['records', 'board', 'settings'].includes(tab);
  $('side').classList.toggle('wide', wide);
  $('detail').classList.toggle('hidden', wide);
  if (tab === 'modes') renderModes();
  if (tab === 'programs') renderPrograms();
  if (tab === 'records') renderRecords();
  if (tab === 'board') renderBoard();
  if (tab === 'settings') drawPreview();
  if (!wide) renderDetail();
  footer();
}

function footer() {
  const cm = settingsMod.cm360(S.sens, S.dpi);
  $('sidefoot').innerHTML = `<span>${S.sens} · ${S.dpi} dpi · ${cm.toFixed(1)} cm/360</span><span>v${VERSION}</span>`;
}

function renderModes() {
  let n = 0;
  $('p-modes').innerHTML = CATEGORIES.map(cat => `
    <div class="group"><h6>${cat}</h6>${MODES.filter(m => m.cat === cat).map(m => {
      n++;
      const pb = stats.best(m.id, S.difficulty);
      return `<button class="row${sel.kind === 'mode' && sel.id === m.id ? ' on' : ''}" data-id="${m.id}">
        <span class="n">${String(n).padStart(2, '0')}</span><span>${m.name}</span><span class="pb">${pb ? fmt(pb.score) : ''}</span></button>`;
    }).join('')}</div>`).join('');
}

function renderPrograms() {
  $('p-programs').innerHTML = '<h6>Sırayla oynanan modlar</h6>' + PROGRAMS.map((p, i) => {
    const secs = p.steps.reduce((a, [, d]) => a + (d || 25), 0);
    return `<button class="row${sel.kind === 'program' && sel.id === p.id ? ' on' : ''}" data-id="${p.id}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span><span>${p.name}</span><span class="pb">${p.steps.length} mod · ${Math.round(secs / 60 * 10) / 10} dk</span></button>`;
  }).join('');
}

for (const pane of ['p-modes', 'p-programs']) {
  $(pane).addEventListener('click', e => {
    const b = e.target.closest('.row');
    if (!b) return;
    audio.unlock();
    const kind = pane === 'p-modes' ? 'mode' : 'program';
    if (sel.kind === kind && sel.id === b.dataset.id && engine.isTouch) { startSelection(); return; }
    select(kind, b.dataset.id);
  });
  $(pane).addEventListener('dblclick', e => { if (e.target.closest('.row')) startSelection(); });
}

function select(kind, id) {
  if (sel.kind === kind && sel.id === id) return;
  sel.kind = kind; sel.id = id;
  audio.ui();
  for (const b of document.querySelectorAll('.pane .row')) b.classList.toggle('on', b.dataset.id === id);
  renderDetail();
  previewSelection();
}

function renderDetail() {
  const spark = $('d-spark');
  if (sel.kind === 'mode') {
    const m = byId(sel.id);
    const idx = MODES.indexOf(m) + 1;
    const runs = stats.history(m.id, S.difficulty);
    const pb = stats.best(m.id, S.difficulty);
    const last10 = runs.slice(-10);
    const avg = last10.length ? last10.reduce((a, r) => a + r.score, 0) / last10.length : null;
    $('d-cat').textContent = `${m.cat} / ${String(idx).padStart(2, '0')}`;
    $('d-name').textContent = m.name;
    $('d-desc').textContent = m.desc;
    $('d-spec').innerHTML = [
      ['Süre', m.rounds ? `${m.rounds} tur` : `${S.duration} sn`],
      ['Kurulum', m.spec + (m.tracking ? ' · basılı tut' : '')],
      ['Rekor', pb ? fmt(pb.score) : '—'],
      ['Son 10 ortalama', avg != null ? fmt(avg) : '—'],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    spark.classList.remove('hidden');
    stats.drawChart(spark, runs, { compact: true });
    $('d-diff').classList.remove('hidden');
  } else {
    const p = PROGRAMS.find(x => x.id === sel.id);
    $('d-cat').textContent = `Program / ${String(PROGRAMS.indexOf(p) + 1).padStart(2, '0')}`;
    $('d-name').textContent = p.name;
    $('d-desc').textContent = p.desc;
    $('d-spec').innerHTML = p.steps.map(([id, d], i) =>
      `<tr><td>${i + 1}. ${byId(id).name}</td><td>${d ? d + ' sn' : byId(id).rounds + ' tur'}</td></tr>`).join('');
    spark.classList.add('hidden');
    $('d-diff').classList.remove('hidden');
  }
  $('d-diff').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) =>
    `<button data-d="${k}" class="${S.difficulty === k ? 'on' : ''}">${d.label}</button>`).join('');
}

$('d-diff').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  setDifficulty(b.dataset.d);
});

function setDifficulty(d) {
  S.difficulty = d;
  settingsMod.save(S);
  audio.ui();
  if (tab === 'modes') renderModes();
  renderDetail();
}

$('d-start').onclick = () => startSelection();

function startSelection() {
  if (sel.kind === 'mode') play(sel.id);
  else startProgram(PROGRAMS.find(p => p.id === sel.id));
}

// ---------------------------------------------------------------- play

async function play(id, duration = null) {
  current = byId(id);
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('h-extra').textContent = '';
  $('feed').innerHTML = '';
  $('h-fps').classList.toggle('hidden', !S.showFps);
  $('h-hits-label').textContent = current.tracking ? 'Hedefte' : 'Öldürme';
  $('fire-btn').classList.toggle('hidden', !(engine.isTouch && S.touchMode === 'drag'));
  document.body.classList.add('playing');
  engine.start(current, { duration, difficulty: S.difficulty });
  const ok = await engine.lock();
  if (!ok || (!engine.isTouch && document.pointerLockElement !== engine.canvas)) engine.pause();
}

function startProgram(def) {
  program = { def, index: 0, results: [] };
  playStep();
}

function playStep() {
  const [id, d] = program.def.steps[program.index];
  play(id, d || null);
}

// After Esc the browser refuses a new pointer lock for about a second:
// retry once instead of silently doing nothing.
async function resume() {
  const note = $('pause-note');
  if (await engine.lock() && (engine.isTouch || document.pointerLockElement === engine.canvas)) {
    note.textContent = '';
    engine.resume();
    return;
  }
  note.textContent = 'Tarayıcı fareyi bir saniye bekletiyor…';
  setTimeout(async () => {
    if (engine.state !== 'paused') return;
    if (await engine.lock() && document.pointerLockElement === engine.canvas) { note.textContent = ''; engine.resume(); }
    else note.textContent = 'Devam için tekrar tıkla.';
  }, 1100);
}

engine.on('pause', () => $('pause').classList.remove('hidden'));
engine.on('resume', () => $('pause').classList.add('hidden'));
engine.on('message', text => { $('center-msg').textContent = text; });
engine.on('hud', text => { $('h-extra').textContent = text; });
engine.on('ammo', (n, mag) => { $('h-extra').textContent = `${n} / ${mag}`; });
engine.on('feed', (text, cls) => {
  const f = $('feed');
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  f.prepend(d);
  while (f.children.length > 6) f.lastChild.remove();
  setTimeout(() => d.remove(), 1800);
});

let hudT = 0;
const xcanvas = $('crosshair');
engine.on('frame', dt => {
  const playing = ['play', 'countdown', 'paused'].includes(engine.state);
  xhair.draw(xcanvas, S.xh, {
    hidden: !playing || current?.rounds || (engine.isTouch && S.touchMode === 'tap'),
    marker: S.xh.hitmarker ? engine.marker : 0, markerHead: engine.markerHead,
  });
  hudT += dt;
  if (!playing || hudT < 0.08) return;
  hudT = 0;
  const st = engine.stats;
  $('h-score').textContent = fmt(engine.liveScore());
  $('h-acc').textContent = (current.tracking || st.shots) ? engine.accuracy().toFixed(1) + '%' : '—';
  $('h-streak').textContent = st.streak;
  $('h-hits').textContent = current.tracking ? (st.trackHits / 20).toFixed(1) : st.kills;
  $('h-time').textContent = current.rounds ? '' : Math.max(0, engine.duration - engine.elapsed).toFixed(1);
  if (S.showFps) $('h-fps').textContent = Math.round(engine.fps) + ' fps';
  // Tracking scores only while firing: say so until the first contact.
  if (current.tracking && engine.state === 'play') {
    $('h-extra').textContent = st.trackHits ? '' : (engine.isTouch && S.touchMode === 'tap' ? 'Parmağını hedefte tut' : 'Sol tıkı basılı tut');
  }
});

engine.on('end', res => {
  $('hud').classList.add('hidden');
  document.body.classList.remove('playing');
  showResults(res);
});

$('btn-resume').onclick = resume;
$('pause').addEventListener('click', e => { if (e.target === $('pause')) resume(); });
$('btn-restart').onclick = () => play(current.id, program ? program.def.steps[program.index][1] || null : null);
$('btn-end').onclick = () => engine.finish();
$('btn-quit').onclick = showMenu;
$('r-again').onclick = () => (program ? playStep() : play(current.id));
$('r-menu').onclick = showMenu;
$('r-next').onclick = () => nextStep();

$('pause-btn').onclick = () => engine.pause();
const fire = $('fire-btn');
fire.addEventListener('touchstart', e => { e.preventDefault(); fire.classList.add('down'); engine.fireButton(true); }, { passive: false });
for (const ev of ['touchend', 'touchcancel']) fire.addEventListener(ev, e => { e.preventDefault(); fire.classList.remove('down'); engine.fireButton(false); });

function nextStep() {
  if (!program) return;
  program.index++;
  if (program.index < program.def.steps.length) playStep();
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  const inMenu = !$('menu').classList.contains('hidden');
  const inResults = !$('results').classList.contains('hidden');
  if (e.code === 'KeyR' && current && engine.state !== 'idle' && engine.state !== 'preview') {
    e.preventDefault();
    if (program) playStep(); else play(current.id);
  } else if (e.code === 'Escape' && inResults) {
    showMenu();
  } else if (e.code === 'Enter' && inResults && program && !$('r-next').classList.contains('hidden')) {
    nextStep();
  } else if (inMenu && (tab === 'modes' || tab === 'programs')) {
    const ids = tab === 'modes' ? MODES.map(m => m.id) : PROGRAMS.map(p => p.id);
    const kind = tab === 'modes' ? 'mode' : 'program';
    const i = ids.indexOf(sel.id);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      audio.unlock();
      const j = (i + (e.code === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
      select(kind, ids[j]);
      document.querySelector('.pane:not(.hidden) .row.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const ks = Object.keys(DIFFICULTY);
      const j = Math.max(0, Math.min(ks.length - 1, ks.indexOf(S.difficulty) + (e.code === 'ArrowRight' ? 1 : -1)));
      setDifficulty(ks[j]);
    } else if (e.code === 'Enter') {
      e.preventDefault();
      startSelection();
    }
  }
  if (e.code === 'F11' && window.__TAURI__?.window) {
    e.preventDefault();
    const w = window.__TAURI__.window.getCurrentWindow();
    w.isFullscreen().then(f => w.setFullscreen(!f));
  }
});

// ---------------------------------------------------------------- results

function showResults(res) {
  lastResult = res;
  const m = byId(res.mode);
  const prevRuns = stats.history(res.mode, res.difficulty);
  const prev = stats.best(res.mode, res.difficulty);
  stats.record(res);
  $('results').classList.remove('hidden');
  $('r-mode').textContent = `${m.cat} · ${m.name} · ${DIFFICULTY[res.difficulty].label}`;
  $('r-score').textContent = fmt(res.score);
  const delta = $('r-delta');
  if (!prev) {
    delta.textContent = 'İlk kayıt';
    delta.className = 'delta';
  } else if (res.score > prev.score) {
    delta.textContent = `Yeni rekor · +${fmt(res.score - prev.score)}`;
    delta.className = 'delta up';
  } else {
    delta.textContent = `Rekor ${fmt(prev.score)} · ${fmt(res.score - prev.score)}`;
    delta.className = 'delta down';
  }

  const rows = [];
  if (m.tracking) {
    rows.push(['Hedefte kalma', fmt(res.accuracy, 1) + '%'], ['Hedefte süre', fmt(res.hits / 20, 1) + ' sn']);
  } else {
    rows.push(['İsabet', fmt(res.accuracy, 1) + '%'], ['Vuruş / atış', `${res.hits} / ${res.shots}`]);
  }
  if (!m.tracking && !m.rounds && !m.weapon) rows.push(['Öldürme / sn', fmt(res.kps, 2)]);
  if (!m.tracking) rows.push(['En uzun seri', res.maxStreak]);
  if (res.avgReaction != null) rows.push([m.rounds ? 'Ortalama reaksiyon' : 'Ortalama öldürme süresi', fmt(res.avgReaction) + ' ms']);
  if (res.bestReaction != null && m.reaction) rows.push(['En hızlı', fmt(res.bestReaction) + ' ms']);
  if (res.headshotPct != null) rows.push(['Kafa oranı', fmt(res.headshotPct, 1) + '%']);
  if (res.headTrackPct != null) rows.push(['Kafada takip', fmt(res.headTrackPct, 1) + '%']);
  if (res.extra.waves != null) rows.push(['Temizlenen dalga', res.extra.waves]);
  if (res.extra.mags != null) rows.push(['Biten şarjör', res.extra.mags]);
  if (res.escaped) rows.push(['Kaçırılan', res.escaped]);
  if (res.penalties && m.id === 'secim') rows.push(['Dost ateşi', res.penalties]);
  if (res.penalties && m.id === 'reaksiyon') rows.push(['Erken tıklama', res.penalties]);
  $('r-stats').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  stats.drawChart($('r-chart'), stats.history(res.mode, res.difficulty));
  const last10 = prevRuns.slice(-10);
  if (last10.length >= 3) {
    const avg = last10.reduce((a, r) => a + r.score, 0) / last10.length;
    const pct = avg > 0 ? ((res.score - avg) / avg) * 100 : 0;
    $('r-note').textContent = `Son ${last10.length} oyunun ortalaması ${fmt(avg)}. Bu oyun ${pct >= 0 ? '+' : ''}${fmt(pct, 1)}%.`;
  } else {
    $('r-note').textContent = '';
  }

  // Programs: next step / summary.
  const next = $('r-next');
  const progBox = $('r-program');
  if (program) {
    program.results[program.index] = res;
    const last = program.index >= program.def.steps.length - 1;
    next.classList.toggle('hidden', last);
    if (!last) {
      const [nid] = program.def.steps[program.index + 1];
      next.innerHTML = `Sonraki: ${byId(nid).name} (${program.index + 2}/${program.def.steps.length}) <kbd>Enter</kbd>`;
    }
    progBox.classList.remove('hidden');
    progBox.innerHTML = `<h6>${program.def.name} · ${program.index + 1}/${program.def.steps.length}</h6><table class="lb"><tr><th>Mod</th><th class="n">Skor</th><th class="n">İsabet</th></tr>${
      program.def.steps.map(([id], i) => {
        const r = program.results[i];
        return `<tr${i === program.index ? ' class="me"' : ''}><td>${byId(id).name}</td><td class="n">${r ? fmt(r.score) : '<span class="muted">—</span>'}</td><td class="n">${r ? fmt(r.accuracy, 1) + '%' : ''}</td></tr>`;
      }).join('')}</table>`;
  } else {
    next.classList.add('hidden');
    progBox.classList.add('hidden');
  }

  $('r-name').value = S.name;
  $('r-submit').disabled = res.score <= 0;
  $('r-submit-msg').textContent = '';
  loadBoard(res.mode, res.difficulty, $('r-lb'), $('r-backend'), 10);
}

async function loadBoard(mode, difficulty, table, label, limit) {
  const b = await api.backend();
  label.textContent = '· ' + api.BACKEND_LABEL[b];
  table.innerHTML = '';
  try {
    const rows = await api.top(mode, difficulty, limit);
    const m = byId(mode);
    table.innerHTML = `<tr><th>#</th><th>İsim</th><th class="n">Skor</th><th class="n">${m.tracking ? 'Takip' : 'İsabet'}</th>${m.headshots ? '<th class="n">Kafa</th>' : ''}${m.reaction ? '<th class="n">Süre</th>' : ''}<th class="n">Tarih</th></tr>` +
      (rows.length ? rows.map((r, i) => `<tr class="${r.name === S.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="n">${fmt(r.score)}</td><td class="n">${fmt(r.accuracy, 1)}%</td>${m.headshots ? `<td class="n">${fmt(r.headshot_pct, 0)}%</td>` : ''}${m.reaction ? `<td class="n">${fmt(r.avg_reaction_ms)} ms</td>` : ''}<td class="n muted">${new Date(r.at * 1000).toLocaleDateString('tr-TR')}</td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">Kayıt yok.</td></tr>');
  } catch (e) {
    table.innerHTML = `<tr><td class="muted">Alınamadı: ${esc(e.message || e)}</td></tr>`;
  }
}

$('r-submit').onclick = async () => {
  const name = $('r-name').value.trim();
  if (!name) { $('r-submit-msg').textContent = 'Takma ad gerekli.'; return; }
  S.name = name; settingsMod.save(S);
  const r = lastResult;
  $('r-submit').disabled = true;
  try {
    const out = await api.submit({
      name, mode: r.mode, difficulty: r.difficulty, score: r.score, hits: r.hits, shots: r.shots,
      duration: r.duration, accuracy: r.accuracy,
      avg_reaction_ms: r.avgReaction, headshot_pct: r.headshotPct,
    });
    $('r-submit-msg').textContent = out.rank ? `${out.rank}. sıra (${out.total} kayıt)` : 'İlk 200 dışında kaldı.';
    loadBoard(r.mode, r.difficulty, $('r-lb'), $('r-backend'), 10);
  } catch (e) {
    $('r-submit').disabled = false;
    $('r-submit-msg').textContent = 'Gönderilemedi: ' + (typeof e === 'string' ? e : e.message);
  }
};

// ---------------------------------------------------------------- records & board

function renderRecords() {
  const rows = stats.summary();
  const total = rows.reduce((a, r) => a + r.runs, 0);
  const secs = rows.reduce((a, r) => a + r.seconds, 0);
  const played = new Set(rows.map(r => r.mode.split('@')[0])).size;
  $('rec-figures').innerHTML = [
    [total, 'oyun'], [`${Math.floor(secs / 60)} dk`, 'antrenman'], [`${played}/${MODES.length}`, 'mod'],
  ].map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const order = id => MODES.findIndex(m => m.id === id.split('@')[0]);
  rows.sort((a, b) => order(a.mode) - order(b.mode) || a.mode.localeCompare(b.mode));
  $('rec-table').innerHTML = '<tr><th>Mod</th><th>Zorluk</th><th class="n">Oyun</th><th class="n">Rekor</th><th class="n">Ort.</th><th class="n">İsabet (10)</th><th class="n">Son</th></tr>' +
    (rows.length ? rows.map(r => {
      const [id, d = 'normal'] = r.mode.split('@');
      const m = byId(id);
      if (!m) return '';
      return `<tr><td>${m.name}</td><td class="muted">${DIFFICULTY[d]?.label || d}</td><td class="n">${r.runs}</td><td class="n">${fmt(r.best)}</td><td class="n">${fmt(r.avg)}</td><td class="n">${fmt(r.avgAcc, 1)}%</td><td class="n muted">${new Date(r.last * 1000).toLocaleDateString('tr-TR')}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">Henüz oyun yok.</td></tr>');
}

let boardDiff = 'normal';
$('b-mode').innerHTML = MODES.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
$('b-mode').onchange = renderBoard;
$('b-diff').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  boardDiff = b.dataset.d;
  renderBoard();
});
function renderBoard() {
  $('b-diff').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button data-d="${k}" class="${boardDiff === k ? 'on' : ''}">${d.label}</button>`).join('');
  loadBoard($('b-mode').value, boardDiff, $('b-table'), $('b-backend'), 50);
}

// ---------------------------------------------------------------- settings

const refreshers = [];
let bound = false;

function bind(id, get, set, out) {
  const el = $(id);
  const isCheck = el.type === 'checkbox';
  const show = () => { if (out) $(out).textContent = el.value; };
  const refresh = () => { if (isCheck) el.checked = get(); else el.value = get(); show(); };
  refresh();
  if (bound) return;
  refreshers.push(refresh);
  el.addEventListener(el.tagName === 'SELECT' || isCheck ? 'change' : 'input', () => {
    const v = isCheck ? el.checked : el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value;
    if (typeof v === 'number' && !Number.isFinite(v)) return;
    set(v);
    show();
    applySettings();
  });
}

function applySettings() {
  settingsMod.save(S);
  audio.configure(S);
  engine.applySettings(S);
  $('s-fov-wrap').classList.toggle('hidden', S.fovMode !== 'custom');
  const cm = settingsMod.cm360(S.sens, S.dpi);
  $('s-sens-info').textContent = `eDPI ${Math.round(S.sens * S.dpi)} · 360° için ${cm.toFixed(1)} cm`;
  footer();
  drawPreview();
  $('x-presets').innerHTML = CS_COLORS.map((c, i) =>
    `<button data-c="${c}" title="cl_crosshaircolor ${i}" style="background:${c}" class="${S.xh.color.toLowerCase() === c ? 'on' : ''}"></button>`).join('');
}

function bindAll() {
  bind('s-sens', () => S.sens, v => { S.sens = settingsMod.clamp(v, 0.01, 20); });
  bind('s-dpi', () => S.dpi, v => { S.dpi = settingsMod.clamp(v, 100, 32000); });
  bind('s-raw', () => S.raw, v => { S.raw = v; });
  bind('s-fovmode', () => S.fovMode, v => { S.fovMode = v; });
  bind('s-fov', () => S.fov, v => { S.fov = v; }, 's-fov-v');
  bind('s-duration', () => S.duration, v => { S.duration = parseInt(v, 10); });
  bind('s-tcolor', () => S.targetColor, v => { S.targetColor = v; });
  bind('s-tsize', () => S.targetSize, v => { S.targetSize = v; }, 's-tsize-v');
  bind('s-theme', () => S.theme, v => { S.theme = v; });
  bind('s-quality', () => S.quality, v => { S.quality = v; });
  bind('s-viewmodel', () => S.viewmodel, v => { S.viewmodel = v; });
  bind('s-countdown', () => S.countdown, v => { S.countdown = v; });
  bind('s-fps', () => S.showFps, v => { S.showFps = v; });
  bind('s-scale', () => S.renderScale, v => { S.renderScale = v; }, 's-scale-v');
  bind('x-color', () => S.xh.color, v => { S.xh.color = v; });
  bind('x-size', () => S.xh.size, v => { S.xh.size = v; }, 'x-size-v');
  bind('x-thick', () => S.xh.thickness, v => { S.xh.thickness = v; }, 'x-thick-v');
  bind('x-gap', () => S.xh.gap, v => { S.xh.gap = v; }, 'x-gap-v');
  bind('x-olt', () => S.xh.outlineThickness, v => { S.xh.outlineThickness = v; }, 'x-olt-v');
  bind('x-alpha', () => S.xh.alpha, v => { S.xh.alpha = v; }, 'x-alpha-v');
  bind('x-outline', () => S.xh.outline, v => { S.xh.outline = v; });
  bind('x-dot', () => S.xh.dot, v => { S.xh.dot = v; });
  bind('x-t', () => S.xh.t, v => { S.xh.t = v; });
  bind('x-hitmarker', () => S.xh.hitmarker, v => { S.xh.hitmarker = v; });
  bind('a-master', () => S.volume, v => { S.volume = v; }, 'a-master-v');
  bind('a-shot', () => S.shotVolume, v => { S.shotVolume = v; }, 'a-shot-v');
  bind('a-hit', () => S.hitSound, v => { S.hitSound = v; });
  bind('a-steps', () => S.footsteps, v => { S.footsteps = v; });
  bind('t-mode', () => S.touchMode, v => { S.touchMode = v; });
  bind('t-sens', () => S.touchSens, v => { S.touchSens = v; }, 't-sens-v');
  bound = true;
  applySettings();
}

function drawPreview() {
  const c = $('xh-preview');
  if (!c.clientWidth) return;
  // Drawn at the size it has on a 1080p screen.
  xhair.draw(c, S.xh, { width: c.clientWidth, height: c.clientHeight, refHeight: 1080 });
}

$('a-test').onclick = () => { audio.unlock(); audio.shot(); setTimeout(() => audio.hit(true), 140); };
$('s-reset').onclick = () => { if (confirm('Ayarlar varsayılana dönsün mü?')) { S = settingsMod.reset(); bindAll(); } };
$('s-wipe').onclick = () => { if (confirm('Yerel oyun geçmişi ve rekorlar silinsin mi?')) { stats.wipe(); renderTab(); } };
$('cs-import-btn').onclick = () => {
  const text = $('cs-import').value;
  const applied = settingsMod.importCs2(text, S, decodeShareCode);
  const badCode = /CSGO-/.test(text) && !applied.includes('nişangah kodu');
  $('cs-import-msg').textContent = applied.length
    ? `Aktarıldı: ${applied.join(', ')}.` + (badCode ? ' Nişangah kodu geçersiz.' : '')
    : (badCode ? 'Nişangah kodu geçersiz.' : 'Tanınan bir şey yok.');
  bindAll();
};
$('x-presets').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  S.xh.color = b.dataset.c;
  bindAll();
});

bindAll();
showMenu();

// Handle for automated tests and the browser console.
window.__tetik = { engine, play, showMenu, startProgram: id => startProgram(PROGRAMS.find(p => p.id === id)) };
