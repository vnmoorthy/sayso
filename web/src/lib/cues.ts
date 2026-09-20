// Tiny Web Audio sound cues — no assets. A soft two-note chime on connect, a
// tick on tool success, a low thud on failure and a gentle rising tone when a
// say-so (confirmation) card appears.
//
// Rules: never in instant (screenshot) mode; only after a user gesture has
// unlocked the AudioContext (autoplay policy); silent if the setting is off.

import { INSTANT } from './flags';

export type CueName = 'connect' | 'tick' | 'thud' | 'sayso';

let enabled = true;
let ctx: AudioContext | null = null;
let lastPlayed: Record<string, number> = {};

export function setCuesEnabled(v: boolean): void {
  enabled = v;
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create/resume the context from inside a user gesture. Idempotent. */
function unlock(): void {
  const AC = audioContextCtor();
  if (!AC) return;
  try {
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Install one-time gesture listeners that unlock audio. Call once at startup. */
export function armCues(): void {
  if (INSTANT || typeof window === 'undefined') return;
  const onGesture = () => {
    unlock();
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
}

function ready(): AudioContext | null {
  if (!enabled || INSTANT || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

function tone(
  c: AudioContext,
  opts: {
    type?: OscillatorType;
    from: number;
    to?: number;
    at?: number;
    attack?: number;
    dur: number;
    peak: number;
    curve?: 'exp' | 'lin';
  },
): void {
  const t0 = c.currentTime + (opts.at ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.from, t0);
  if (opts.to !== undefined) {
    if (opts.curve === 'lin') osc.frequency.linearRampToValueAtTime(opts.to, t0 + opts.dur);
    else osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
  }
  const attack = opts.attack ?? 0.012;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(opts.peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.05);
}

export function playCue(name: CueName): void {
  const c = ready();
  if (!c) return;
  // Debounce bursts (e.g. several tools finishing in the same tick).
  const now = performance.now();
  const minGap = name === 'tick' ? 90 : 250;
  if (now - (lastPlayed[name] ?? -Infinity) < minGap) return;
  lastPlayed[name] = now;

  try {
    switch (name) {
      case 'connect':
        // Soft two-note chime: C5 → G5, with a quiet octave shimmer.
        tone(c, { from: 523.25, dur: 0.34, peak: 0.07, attack: 0.02 });
        tone(c, { from: 1046.5, dur: 0.3, peak: 0.012, attack: 0.02, type: 'triangle' });
        tone(c, { from: 783.99, dur: 0.55, peak: 0.075, attack: 0.02, at: 0.16 });
        tone(c, { from: 1567.98, dur: 0.5, peak: 0.012, attack: 0.02, at: 0.16, type: 'triangle' });
        break;
      case 'tick':
        // A tiny bright tick.
        tone(c, { from: 1760, to: 1320, dur: 0.055, peak: 0.05, attack: 0.004 });
        break;
      case 'thud':
        // Low, short, slightly pitched-down thud.
        tone(c, { from: 150, to: 52, dur: 0.24, peak: 0.16, attack: 0.008 });
        tone(c, { from: 300, to: 90, dur: 0.12, peak: 0.04, attack: 0.004, type: 'triangle' });
        break;
      case 'sayso':
        // Gentle rising tone — "I need your say-so".
        tone(c, { from: 392, to: 659.25, dur: 0.42, peak: 0.06, attack: 0.05 });
        tone(c, { from: 784, to: 1318.5, dur: 0.42, peak: 0.014, attack: 0.05, type: 'triangle' });
        break;
    }
  } catch {
    // Audio is best-effort — never let a cue break the UI.
  }
}

/** Test hook: forget debounce state. */
export function resetCues(): void {
  lastPlayed = {};
}
