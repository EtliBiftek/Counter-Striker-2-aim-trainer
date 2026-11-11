// Synthesised sounds (WebAudio): no audio files needed.

let ctx = null;
let master = null;
let noiseBuf = null;
const vol = { master: 0.6, shot: 0.35, hit: 'tink' };

export function configure(s) {
  vol.master = s.volume;
  vol.shot = s.shotVolume;
  vol.hit = s.hitSound;
  if (master) master.gain.value = vol.master;
}

/** Must be called from a user gesture (browsers block autoplay). */
export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = vol.master;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function env(g, t, a, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
}

function tone(type, freq, t, peak, decay, endFreq) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + decay);
  env(g, t, 0.002, peak, decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function noise(t, peak, decay, filterType, freq, q = 0.8) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.001, peak, decay);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + decay + 0.05);
}

/** Rifle-like shot: sharp crack, body and low thump. */
export function shot() {
  if (!ctx || vol.shot <= 0) return;
  const t = ctx.currentTime;
  const v = vol.shot;
  noise(t, 0.9 * v, 0.05, 'highpass', 2500);
  noise(t, 0.8 * v, 0.14, 'bandpass', 900, 0.6);
  tone('sine', 150, t, 0.7 * v, 0.12, 45);
}

/** Hit confirmation; `head` gives the bright metallic ring. */
export function hit(head = false) {
  if (!ctx || vol.hit === 'off') return;
  const t = ctx.currentTime;
  if (vol.hit === 'tink' || head) {
    tone('sine', head ? 3150 : 2350, t, 0.35, head ? 0.32 : 0.16);
    tone('sine', head ? 4720 : 3520, t, 0.14, head ? 0.22 : 0.1);
    if (head) tone('triangle', 6300, t, 0.05, 0.12);
    if (!head) noise(t, 0.15, 0.04, 'lowpass', 600);
  } else if (vol.hit === 'pop') {
    tone('sine', 900, t, 0.45, 0.09, 300);
  } else {
    noise(t, 0.4, 0.02, 'bandpass', 3000, 2);
  }
}

/** Short soft tick for tracking contact. */
export function tick() {
  if (!ctx || vol.hit === 'off') return;
  tone('sine', 1800, ctx.currentTime, 0.06, 0.04);
}

export function bad() {
  if (!ctx) return;
  tone('square', 180, ctx.currentTime, 0.12, 0.18, 110);
}

export function beep(high = false) {
  if (!ctx) return;
  tone('sine', high ? 1320 : 880, ctx.currentTime, 0.2, high ? 0.25 : 0.12);
}
