/**
 * Áudio de terror 100% sintetizado via Web Audio API — nenhum arquivo de
 * áudio externo (sem asset pra hospedar, sem risco de direitos autorais).
 * Tudo começa mudo: só liga com um clique explícito do jogador (autoplay
 * policy do navegador + acessibilidade).
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let droneNodes: { osc: OscillatorNode; lfo: OscillatorInterval } | null = null;
let heartbeatId: number | null = null;

type OscillatorInterval = ReturnType<typeof setInterval> | null;

function ensureContext(): AudioContext {
  if (!ctx) {
    ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function burstNoise(
  context: AudioContext,
  opts: { duration: number; freq: number; q: number; gain: number; delay?: number },
) {
  const src = context.createBufferSource();
  src.buffer = noiseBuffer(context, opts.duration);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const gain = context.createGain();
  const t0 = context.currentTime + (opts.delay ?? 0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.gain, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t0);
  src.stop(t0 + opts.duration + 0.05);
}

function tone(
  context: AudioContext,
  opts: {
    freq: number;
    toFreq?: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    delay?: number;
  },
) {
  const osc = context.createOscillator();
  osc.type = opts.type ?? "sine";
  const t0 = context.currentTime + (opts.delay ?? 0);
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(opts.toFreq, t0 + opts.duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.gain, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
  osc.connect(gain).connect(master!);
  osc.start(t0);
  osc.stop(t0 + opts.duration + 0.05);
}

export function isAudioArmed() {
  return ctx !== null && ctx.state === "running";
}

/** Precisa ser chamado a partir de um gesto do usuário (clique). */
export async function armAudio() {
  const context = ensureContext();
  if (context.state === "suspended") await context.resume();
  if (!droneNodes) startDrone(context);
}

export async function muteAudio() {
  if (!ctx) return;
  await ctx.suspend();
}

function startDrone(context: AudioContext) {
  const osc = context.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 58;
  const droneGain = context.createGain();
  droneGain.gain.value = 0.05;
  osc.connect(droneGain).connect(master!);
  osc.start();

  const lfo = setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    const drift = 56 + Math.random() * 6;
    osc.frequency.linearRampToValueAtTime(drift, ctx.currentTime + 4);
  }, 4000);

  droneNodes = { osc, lfo };
}

export function playWhisper() {
  if (!ctx || ctx.state !== "running" || !master) return;
  burstNoise(ctx, { duration: 1.1, freq: 1800, q: 3.5, gain: 0.05 });
  tone(ctx, { freq: 340, toFreq: 180, duration: 1.0, gain: 0.02, type: "sine", delay: 0.05 });
}

export function playSteal() {
  if (!ctx || ctx.state !== "running" || !master) return;
  tone(ctx, { freq: 220, toFreq: 40, duration: 0.5, gain: 0.18, type: "sawtooth" });
  burstNoise(ctx, { duration: 0.3, freq: 400, q: 1.2, gain: 0.08, delay: 0.05 });
}

export function playGlide() {
  if (!ctx || ctx.state !== "running" || !master) return;
  burstNoise(ctx, { duration: 0.18, freq: 900, q: 4, gain: 0.03 });
  tone(ctx, { freq: 260, toFreq: 220, duration: 0.15, gain: 0.02, type: "triangle" });
}

export function playFakeWrite() {
  if (!ctx || ctx.state !== "running" || !master) return;
  burstNoise(ctx, { duration: 0.25, freq: 2600, q: 6, gain: 0.06 });
}

export function playJumpscare() {
  if (!ctx || ctx.state !== "running" || !master) return;
  tone(ctx, { freq: 55, duration: 0.9, gain: 0.35, type: "sine" });
  tone(ctx, { freq: 1400, toFreq: 90, duration: 0.55, gain: 0.22, type: "sawtooth" });
  burstNoise(ctx, { duration: 0.6, freq: 3200, q: 0.8, gain: 0.22 });
}

export function startHeartbeat() {
  if (heartbeatId !== null) return;
  heartbeatId = window.setInterval(() => {
    if (!ctx || ctx.state !== "running" || !master) return;
    tone(ctx, { freq: 62, duration: 0.18, gain: 0.14, type: "sine" });
    tone(ctx, { freq: 55, duration: 0.18, gain: 0.11, type: "sine", delay: 0.28 });
  }, 1100);
}

export function stopHeartbeat() {
  if (heartbeatId !== null) {
    window.clearInterval(heartbeatId);
    heartbeatId = null;
  }
}
