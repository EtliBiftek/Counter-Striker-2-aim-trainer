// UI wiring: menu, settings, HUD, results, leaderboard.

import { Engine } from './engine.js';
import { MODES, CATEGORIES, byId } from './modes.js';
import * as settingsMod from './settings.js';
import * as audio from './audio.js';
import * as xhair from './crosshair.js';
import * as api from './api.js';
import * as stats from './stats.js';

const $ = id => document.getElementById(id);
let S = settingsMod.load();
audio.configure(S);

let engine;
try {
  engine = new Engine($('game'), S);
} catch (e) {
  $('loading').innerHTML = '<div class="panel small"><h2>WebGL başlatılamadı</h2><p class="muted">Tarayıcında donanım hızlandırmayı aç.</p></div>';
  throw e;
}
$('loading').classList.add('hidden');

let current = null; // current mode
document.body.classList.toggle('touch', engine.isTouch);
if (engine.isTouch) $('foot-hint').textContent = 'Dokun: ateş · ❚❚: duraklat · Kontrol şeklini Ayarlar → Dokunmatik bölümünden değiştir';
let lastResult = null;
let filter = 'Tümü';
const xcanvas = $('crosshair');

// ---------------- menu ----------------

function showMenu() {
  engine.stop();
  current = null;
  document.body.classList.remove('playing');
  for (const id of ['hud', 'pause', 'results']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  renderModes();
  updateSensChip();
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + b.dataset.tab));
  if (b.dataset.tab === 'stats') renderStats();
  if (b.dataset.tab === 'board') renderBoard();
  if (b.dataset.tab === 'settings') drawPreview();
}));

function renderModes() {
  $('mode-filters').innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.textContent = c;
    b.classList.toggle('on', c === filter);
    b.onclick = () => { filter = c; renderModes(); };
    $('mode-filters').append(b);
  }
  const grid = $('mode-grid');
  grid.innerHTML = '';
  for (const m of MODES.filter(m => filter === 'Tümü' || m.cat === filter)) {
    const pb = stats.best(m.id);
    const card = document.createElement('div');
    card.className = 'mode-card';
    card.innerHTML = `
      <div class="glyph">${m.glyph}</div>
      <div class="cat">${m.cat}</div>
      <h4>${m.name}</h4>
      <p>${m.desc}</p>
      <div class="meta"><span>${m.rounds ? m.rounds + ' tur' : (m.fixedDuration || S.duration) + ' sn'}${m.tracking ? ' · basılı tut' : ''}</span>
      <span>En iyi: <b>${pb ? pb.score.toLocaleString('tr-TR') : '—'}</b></span></div>`;
    card.onclick = () => play(m.id);
    grid.append(card);
  }
}

function updateSensChip() {
  const cm = settingsMod.cm360(S.sens, S.dpi);
  $('sens-chip').textContent = `Hass. ${S.sens} · ${S.dpi} DPI · ${cm.toFixed(1)} cm/360`;
}

// ---------------- play ----------------

async function play(id) {
  current = byId(id);
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('hud-extra').textContent = '';
  $('hud-fps').classList.toggle('hidden', !S.showFps);
  $('fire-btn').classList.toggle('hidden', !(engine.isTouch && S.touchMode === 'drag'));
  document.body.classList.add('playing');
  engine.start(current);
  const ok = await engine.lock();
  if (!ok || (!engine.isTouch && document.pointerLockElement !== engine.canvas)) engine.pause();
}

async function resume() {
  if (await engine.lock()) engine.resume();
}

engine.on('pause', () => {
  $('pause').classList.remove('hidden');
});
engine.on('resume', () => $('pause').classList.add('hidden'));
engine.on('message', text => {
  $('center-msg').innerHTML = text ? text : '';
});
engine.on('hud', text => { $('hud-extra').textContent = text; });
engine.on('popup', (text, cls) => {
  const d = document.createElement('div');
  d.className = 'popup ' + cls;
  d.textContent = text;
  d.style.left = (Math.random() * 40 - 20) + 'px';
  $('popups').append(d);
  setTimeout(() => d.remove(), 700);
});

let hudT = 0;
engine.on('frame', dt => {
  const playing = ['play', 'countdown', 'paused'].includes(engine.state);
  xhair.draw(xcanvas, S.xh, { hidden: !playing || current?.rounds || (engine.isTouch && S.touchMode === 'tap'), marker: S.xh.hitmarker ? engine.marker : 0, markerHead: engine.markerHead });
  hudT += dt;
  if (!playing || hudT < 0.08) return;
  hudT = 0;
  const st = engine.stats;
  $('hud-score').textContent = engine.liveScore().toLocaleString('tr-TR');
  $('hud-acc').textContent = engine.accuracy().toFixed(1) + '%';
  $('hud-streak').textContent = st.streak;
  $('hud-hits').textContent = current.tracking ? st.trackHits : st.kills;
  $('hud-time').textContent = current.rounds ? '∞' : Math.max(0, engine.duration - engine.elapsed).toFixed(1);
  if (S.showFps) $('hud-fps').textContent = Math.round(engine.fps) + ' FPS';
});

engine.on('end', res => {
  $('hud').classList.add('hidden');
  document.body.classList.remove('playing');
  showResults(res);
});

$('btn-resume').onclick = resume;
$('pause-btn').onclick = () => engine.pause();
const fire = $('fire-btn');
fire.addEventListener('touchstart', e => { e.preventDefault(); fire.classList.add('down'); engine.fireButton(true); }, { passive: false });
for (const ev of ['touchend', 'touchcancel']) fire.addEventListener(ev, e => { e.preventDefault(); fire.classList.remove('down'); engine.fireButton(false); });
$('pause').addEventListener('click', e => { if (e.target === $('pause')) resume(); });
$('btn-restart').onclick = () => play(current.id);
$('btn-end').onclick = () => engine.finish();
$('btn-quit').onclick = showMenu;
$('res-again').onclick = () => play(current.id);
$('res-menu').onclick = showMenu;

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'KeyR' && current && engine.state !== 'idle') { e.preventDefault(); play(current.id); }
  if (e.code === 'Escape' && !$('results').classList.contains('hidden')) showMenu();
  if (e.code === 'F11' && window.__TAURI__?.window) {
    e.preventDefault();
    const w = window.__TAURI__.window.getCurrentWindow();
    w.isFullscreen().then(f => w.setFullscreen(!f));
  }
});

// ---------------- results ----------------

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('tr-TR', { maximumFractionDigits: d, minimumFractionDigits: d }));

function showResults(res) {
  lastResult = res;
  const prev = stats.best(res.mode);
  stats.record(res);
  const m = byId(res.mode);
  $('results').classList.remove('hidden');
  $('res-mode').textContent = `${m.cat.toUpperCase()} · ${m.name}`;
  $('res-score').textContent = fmt(res.score);
  const pb = $('res-pb');
  if (!prev || res.score > prev.score) {
    pb.textContent = prev ? `Yeni rekor! (+${fmt(res.score - prev.score)})` : 'İlk rekor!';
    pb.className = 'pb new';
  } else {
    pb.textContent = `Rekor: ${fmt(prev.score)} (${fmt(res.score - prev.score)})`;
    pb.className = 'pb muted';
  }

  const cells = [
    [m.tracking ? 'Hedefte kalma' : 'İsabet', fmt(res.accuracy, 1) + '%'],
    m.tracking ? ['Hedefte (sn)', fmt(res.hits / 20, 1)] : ['Vuruş / Atış', `${res.hits} / ${res.shots}`],
  ];
  if (!m.tracking && !m.rounds) cells.push(['Öldürme / sn', fmt(res.kps, 2)]);
  if (!m.tracking) cells.push(['En uzun seri', res.maxStreak]);
  if (res.avgReaction != null) cells.push([m.rounds ? 'Ort. reaksiyon' : 'Ort. öldürme süresi', fmt(res.avgReaction) + ' ms']);
  if (res.bestReaction != null && m.reaction) cells.push(['En hızlı', fmt(res.bestReaction) + ' ms']);
  if (res.headshotPct != null) cells.push(['Kafa oranı', fmt(res.headshotPct, 1) + '%']);
  if (res.headTrackPct != null) cells.push(['Kafada takip', fmt(res.headTrackPct, 1) + '%']);
  if (res.escaped) cells.push(['Kaçırılan', res.escaped]);
  if (res.penalties && m.id === 'secim') cells.push(['Dost ateşi', res.penalties]);
  if (m.id === 'reaksiyon' && res.penalties) cells.push(['Erken tıklama', res.penalties]);
  $('res-stats').innerHTML = cells.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  stats.drawChart($('res-chart'), stats.history(res.mode));
  $('res-tip').textContent = tip(res, m);
  $('res-name').value = S.name;
  $('res-submit').disabled = res.score <= 0;
  $('res-submit-msg').textContent = '';
  loadBoard(res.mode, $('res-lb'), $('res-backend'), 10);
}

function tip(r, m) {
  if (m.id === 'reaksiyon') {
    if (r.avgReaction == null) return '';
    return r.avgReaction < 200 ? 'Çok iyi reaksiyon. Ortalama oyuncu 230-280 ms civarındadır.'
      : 'Ortalama 250 ms civarı normaldir. Dinlenmiş ve odaklı olmak birkaç ms kazandırır.';
  }
  if (m.tracking) {
    return r.accuracy < 45 ? 'Takipte fareyi sıkma: bileği gevşek tut, hedefin önüne değil merkezine odaklan.'
      : r.accuracy < 70 ? 'İyi gidiyor. Yön değişimlerinde gecikmeyi azaltmaya çalış; tepki ver, tahmin etme.'
      : 'Çok iyi takip. Daha zor bir hassasiyet testi için hedef boyutunu küçült.';
  }
  if (r.headshotPct != null && r.headshotPct < 50) return 'Nişangahı kafa hizasında tut (crosshair placement); aşağıdan yukarı flick yerine yatay düzeltme yap.';
  if (r.accuracy < 75) return 'İsabet düşük: önce doğruluk, sonra hız. Hedefin üzerinde olduğundan emin olunca ateş et.';
  if (r.accuracy > 95) return 'İsabet çok yüksek, biraz daha hızlı oynayıp risk alabilirsin.';
  return 'Dengeli bir oyun. Rekor için tempoyu yavaşça artır.';
}

async function loadBoard(mode, table, label, limit) {
  const b = await api.backend();
  label.textContent = '· ' + api.BACKEND_LABEL[b];
  table.innerHTML = '<tr><td class="muted">Yükleniyor…</td></tr>';
  try {
    const rows = await api.top(mode, limit);
    const m = byId(mode);
    table.innerHTML = `<tr><th>#</th><th>İsim</th><th>Skor</th><th>${m.tracking ? 'Takip' : 'İsabet'}</th>${m.headshots ? '<th>Kafa</th>' : ''}${m.reaction ? '<th>Süre</th>' : ''}<th>Tarih</th></tr>` +
      (rows.length ? rows.map((r, i) => `<tr class="${r.name === S.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmt(r.score)}</td><td>${fmt(r.accuracy, 1)}%</td>${m.headshots ? `<td>${fmt(r.headshot_pct, 0)}%</td>` : ''}${m.reaction ? `<td>${fmt(r.avg_reaction_ms)} ms</td>` : ''}<td class="muted">${new Date(r.at * 1000).toLocaleDateString('tr-TR')}</td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">Henüz skor yok. İlk sen ol!</td></tr>');
  } catch (e) {
    table.innerHTML = `<tr><td class="muted">Liderlik tablosu alınamadı: ${esc(e.message)}</td></tr>`;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('res-submit').onclick = async () => {
  const name = $('res-name').value.trim();
  if (!name) { $('res-submit-msg').textContent = 'Önce bir takma ad yaz.'; return; }
  S.name = name; settingsMod.save(S);
  const r = lastResult;
  $('res-submit').disabled = true;
  try {
    const out = await api.submit({
      name, mode: r.mode, score: r.score, hits: r.hits, shots: r.shots,
      duration: r.duration, accuracy: r.accuracy,
      avg_reaction_ms: r.avgReaction, headshot_pct: r.headshotPct,
    });
    $('res-submit-msg').textContent = out.rank ? `Gönderildi: ${out.rank}. sıradasın (${out.total} skor).` : 'Gönderildi, ama ilk 200\'e giremedi.';
    loadBoard(r.mode, $('res-lb'), $('res-backend'), 10);
  } catch (e) {
    $('res-submit').disabled = false;
    $('res-submit-msg').textContent = 'Gönderilemedi: ' + (typeof e === 'string' ? e : e.message);
  }
};

// ---------------- stats & board pages ----------------

function renderStats() {
  const rows = stats.summary();
  const total = rows.reduce((a, r) => a + r.runs, 0);
  const secs = rows.reduce((a, r) => a + r.seconds, 0);
  $('stats-summary').innerHTML = [
    ['Toplam oyun', total],
    ['Antrenman süresi', `${Math.floor(secs / 60)} dk`],
    ['Oynanan mod', `${rows.length} / ${MODES.length}`],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('stats-table').innerHTML = '<tr><th>Mod</th><th>Oyun</th><th>Rekor</th><th>Ortalama</th><th>İsabet (son 10)</th><th>Son oyun</th></tr>' +
    (rows.length ? MODES.map(m => rows.find(r => r.mode === m.id)).filter(Boolean).map(r =>
      `<tr><td>${byId(r.mode).name}</td><td>${r.runs}</td><td>${fmt(r.best)}</td><td>${fmt(r.avg)}</td><td>${fmt(r.avgAcc, 1)}%</td><td class="muted">${new Date(r.last * 1000).toLocaleString('tr-TR')}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Henüz oyun yok.</td></tr>');
}

const boardSel = $('board-mode');
boardSel.innerHTML = MODES.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
boardSel.onchange = renderBoard;
function renderBoard() { loadBoard(boardSel.value, $('board-table'), $('board-backend'), 50); }

// ---------------- settings ----------------

const refreshers = [];
let bound = false;

function bind(id, get, set, label) {
  const el = $(id);
  const isCheck = el.type === 'checkbox';
  const show = () => { if (label) $(label).textContent = el.value; };
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
  $('s-sens-info').textContent = `eDPI ${Math.round(S.sens * S.dpi)} · ${cm.toFixed(1)} cm/360°`;
  updateSensChip();
  drawPreview();
}

function bindAll() {
  bind('s-sens', () => S.sens, v => { S.sens = settingsMod.clamp(v, 0.01, 20); });
  bind('s-dpi', () => S.dpi, v => { S.dpi = settingsMod.clamp(v, 100, 32000); });
  bind('s-raw', () => S.raw, v => { S.raw = v; });
  bind('s-fovmode', () => S.fovMode, v => { S.fovMode = v; });
  bind('s-fov', () => S.fov, v => { S.fov = v; }, 's-fov-v');
  bind('s-duration', () => S.duration, v => { S.duration = parseInt(v, 10); renderModes(); });
  bind('s-tcolor', () => S.targetColor, v => { S.targetColor = v; });
  bind('s-tsize', () => S.targetSize, v => { S.targetSize = v; }, 's-tsize-v');
  bind('s-theme', () => S.theme, v => { S.theme = v; });
  bind('s-countdown', () => S.countdown, v => { S.countdown = v; });
  bind('s-fps', () => S.showFps, v => { S.showFps = v; });
  bind('s-scale', () => S.renderScale, v => { S.renderScale = v; }, 's-scale-v');
  bind('x-style', () => S.xh.style, v => { S.xh.style = v; });
  bind('x-color', () => S.xh.color, v => { S.xh.color = v; });
  bind('x-len', () => S.xh.len, v => { S.xh.len = v; }, 'x-len-v');
  bind('x-thick', () => S.xh.thick, v => { S.xh.thick = v; }, 'x-thick-v');
  bind('x-gap', () => S.xh.gap, v => { S.xh.gap = v; }, 'x-gap-v');
  bind('x-alpha', () => S.xh.alpha, v => { S.xh.alpha = v; }, 'x-alpha-v');
  bind('x-outline', () => S.xh.outline, v => { S.xh.outline = v; });
  bind('x-hitmarker', () => S.xh.hitmarker, v => { S.xh.hitmarker = v; });
  bind('a-master', () => S.volume, v => { S.volume = v; }, 'a-master-v');
  bind('a-shot', () => S.shotVolume, v => { S.shotVolume = v; }, 'a-shot-v');
  bind('a-hit', () => S.hitSound, v => { S.hitSound = v; });
  bind('t-mode', () => S.touchMode, v => { S.touchMode = v; });
  bind('t-sens', () => S.touchSens, v => { S.touchSens = v; }, 't-sens-v');
  bound = true;
  applySettings();
}

function drawPreview() {
  const c = $('xh-preview');
  const w = c.clientWidth || 220, h = c.clientHeight || 140;
  xhair.draw(c, S.xh, { width: w, height: h, scale: 1.4 });
}

$('a-test').onclick = () => { audio.unlock(); audio.shot(); setTimeout(() => audio.hit(true), 120); };
$('s-reset').onclick = () => { if (confirm('Tüm ayarlar varsayılana dönsün mü?')) { S = settingsMod.reset(); bindAll(); } };
$('s-wipe').onclick = () => { if (confirm('Yerel oyun geçmişi ve rekorlar silinsin mi?')) { stats.wipe(); renderModes(); } };
$('x-import-btn').onclick = () => {
  const applied = settingsMod.importCs2($('x-import').value, S);
  $('x-import-msg').textContent = applied.length ? `${applied.length} ayar aktarıldı.` : 'Tanınan komut bulunamadı.';
  bindAll();
};

bindAll();
showMenu();

// Handle for automated tests and the browser console.
window.__tetik = { engine, play, showMenu };
