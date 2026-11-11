// Synthesised sound (WebAudio), no audio files. Every gunshot is layered
// and slightly detuned so rapid fire does not sound like one sample looped.

let ctx = null;
let master = null;
let dry = null;
let wet = null;
let noiseBuf = null;
let curve = null;
const vol = { master: 0.6, shot: 0.45, hit: 'tink', steps: true };

export function configure(s) {
  vol.master = s.volume;
  vol.shot = s.shotVolume;
  vol.hit = s.hitSound;
  vol.steps = s.footsteps !== false;
  if (master) master.gain.value = vol.master;
}

/** Must be called from a user gesture (autoplay policy). */
export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = vol.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(master);
    // Short outdoor-range reverb: stereo noise with an exponential tail.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const early = t > 0.03 && t < 0.035 ? 0.6 : 0; // slap off the side wall
        d[i] = ((Math.random() * 2 - 1) * Math.exp(-t * 4.2) + early * (Math.random() - 0.5));
      }
    }
    conv.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.28;
    wet.connect(conv).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function out(reverb, pan = 0) {
  let node = ctx.createGain();
  const first = node;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    node = p;
  }
  node.connect(dry);
  if (reverb) {
    const send = ctx.createGain();
    send.gain.value = reverb;
    node.connect(send).connect(wet);
  }
  return first;
}

function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(dest, type, freq, t, peak, decay, endFreq) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + decay);
  env(g, t, 0.001, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function noise(dest, t, peak, decay, type, freq, q = 0.7, freqEnd = 0) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.0008, peak, decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + decay + 0.05);
}

/** Rifle shot: transient, crack, body, sub thump, bolt. */
export function shot() {
  if (!ctx || vol.shot <= 0) return;
  const t = ctx.currentTime;
  const v = vol.shot;
  const p = 0.96 + Math.random() * 0.08; // detune per shot
  const o = out(0.55);
  const sat = ctx.createWaveShaper();
  sat.curve = curve;
  const body = ctx.createGain();
  body.gain.value = 0.9;
  sat.connect(body).connect(o);
  noise(o, t, 1.0 * v, 0.012, 'highpass', 4200 * p);
  noise(o, t, 0.9 * v, 0.07, 'bandpass', 1900 * p, 0.9);
  noise(sat, t, 0.8 * v, 0.2, 'lowpass', 3200 * p, 0.5, 380);
  tone(sat, 'sine', 120 * p, t, 0.9 * v, 0.14, 38);
  tone(o, 'triangle', 2900 * p, t + 0.032, 0.05 * v, 0.025); // bolt
}

/** Hit confirmation. Head: bright inharmonic helmet ring. */
export function hit(head = false) {
  if (!ctx || vol.hit === 'off') return;
  const t = ctx.currentTime;
  const o = out(0.2);
  if (head) {
    for (const [f, a, d] of [[2630, 0.32, 0.38], [4190, 0.18, 0.26], [5370, 0.1, 0.2], [7010, 0.05, 0.12]]) tone(o, 'sine', f, t, a, d);
    noise(o, t, 0.25, 0.03, 'bandpass', 3000, 3);
    return;
  }
  if (vol.hit === 'tink') {
    tone(o, 'sine', 1760, t, 0.22, 0.09);
    tone(o, 'sine', 2640, t, 0.08, 0.06);
  } else if (vol.hit === 'pop') {
    tone(o, 'sine', 820, t, 0.42, 0.08, 280);
  } else {
    noise(o, t, 0.45, 0.02, 'bandpass', 2800, 2);
  }
}

/** Bullet into a body: dull, low. */
export function flesh() {
  if (!ctx || vol.hit === 'off') return;
  const t = ctx.currentTime;
  const o = out(0.1);
  noise(o, t, 0.5, 0.06, 'lowpass', 600);
  tone(o, 'sine', 160, t, 0.35, 0.08, 70);
}

/** Bullet on steel (spray plate). */
export function steel(head = false) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = out(0.35);
  const f = head ? 1.35 : 1;
  for (const [hz, a, d] of [[1180, 0.22, 0.3], [1870, 0.12, 0.22], [2950, 0.06, 0.15]]) tone(o, 'sine', hz * f, t, a, d);
}

/** Soft tick for tracking contact. */
export function tick() {
  if (!ctx || vol.hit === 'off') return;
  tone(out(0), 'sine', 1800, ctx.currentTime, 0.05, 0.035);
}

export function bad() {
  if (!ctx) return;
  tone(out(0), 'square', 170, ctx.currentTime, 0.1, 0.16, 110);
}

export function beep(high = false) {
  if (!ctx) return;
  tone(out(0.1), 'sine', high ? 1320 : 880, ctx.currentTime, 0.18, high ? 0.22 : 0.1);
}

/** Footstep, panned and attenuated by the bot's position. */
export function step(pan, gain) {
  if (!ctx || !vol.steps || gain <= 0.02) return;
  const t = ctx.currentTime;
  const o = out(0.25, pan);
  noise(o, t, 0.35 * gain, 0.05, 'bandpass', 700 + Math.random() * 300, 1.2);
  noise(o, t + 0.012, 0.25 * gain, 0.03, 'highpass', 3000);
}

export function reload() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = out(0.15);
  noise(o, t, 0.3, 0.04, 'bandpass', 1500, 2);
  noise(o, t + 0.5, 0.35, 0.05, 'bandpass', 1100, 2);
  tone(o, 'triangle', 2200, t + 0.52, 0.06, 0.04);
  noise(o, t + 1.2, 0.4, 0.06, 'bandpass', 900, 1.5);
  tone(o, 'triangle', 1700, t + 1.25, 0.08, 0.05);
}

/** Tiny UI click for menu navigation. */
export function ui() {
  if (!ctx) return;
  tone(out(0), 'sine', 2400, ctx.currentTime, 0.035, 0.02);
}
