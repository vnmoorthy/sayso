import { useEffect, useRef, type CSSProperties } from 'react';
import type { Mood } from '../lib/protocol';
import type { VoicePhase } from '../lib/store';
import { levels } from '../lib/levels';
import { cx } from '../lib/format';
import { INSTANT } from '../lib/flags';

/** [highlight, mid, deep] per mood */
export const MOOD_COLORS: Record<Mood, [string, string, string]> = {
  neutral: ['#f4f4f5', '#c8ff3d', '#3f4a2a'],
  excited: ['#f7ffb3', '#c8ff3d', '#ffb020'],
  happy: ['#fff2b8', '#d9ff5c', '#ffb020'],
  frustrated: ['#ffc2b8', '#ff5c5c', '#ff7a1a'],
  stressed: ['#ffd0b8', '#ff7a45', '#ff5c5c'],
  confused: ['#e0daff', '#8b7cff', '#5b48d6'],
  calm: ['#d6ecff', '#5eb0ff', '#2d5fa6'],
  sad: ['#c4d5ee', '#4f7bc8', '#2a3f6e'],
};

/** Read once — heavy motion is disabled for users who asked for less. */
export const REDUCED_MOTION: boolean =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Traces an organic, audio-reactive ring: a sum of sines around a circle. */
function tracePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  base: number,
  amp: number,
  t: number,
  f1: number,
  f2: number,
  dir: number,
): void {
  const N = 128;
  ctx.beginPath();
  for (let i = 0; i <= N; i += 1) {
    const th = (i / N) * Math.PI * 2;
    const w =
      Math.sin(th * f1 + t * 3.1 * dir) * 0.55 +
      Math.sin(th * f2 - t * 4.7 * dir) * 0.32 +
      Math.sin(th * 3 + t * 1.3) * 0.13;
    const r = base + w * amp;
    const x = cx + Math.cos(th) * r;
    const y = cy + Math.sin(th) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

interface Ripple {
  born: number;
}

/**
 * The listening field. Everything that moves per-frame is driven from a single
 * requestAnimationFrame loop that reads `levels` directly — no React state.
 *
 *  - user speaking  → the core blooms and a live waveform ring wraps it
 *  - bot speaking   → outward ripples pulse from the edge
 *  - thinking       → a slow, rotating iridescent sheen
 *  - always         → three breathing halos + a volumetric glow, hued by mood
 */
export function Orb({
  mood,
  phase,
  userSpeaking = false,
  size = 200,
  className,
}: {
  mood: Mood;
  phase: VoicePhase;
  userSpeaking?: boolean;
  size?: number;
  className?: string;
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const phaseRef = useRef<VoicePhase>(phase);
  phaseRef.current = phase;
  const speakingRef = useRef(userSpeaking);
  speakingRef.current = userSpeaking;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const colorRef = useRef<[string, string, string]>(MOOD_COLORS[mood] ?? MOOD_COLORS.neutral);
  colorRef.current = MOOD_COLORS[mood] ?? MOOD_COLORS.neutral;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || INSTANT || REDUCED_MOTION) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let smoothLocal = 0;
    let smoothRemote = 0;
    let bloom = 0;
    let lastRipple = 0;
    // True while the DOM holds non-rest values; the first quiet frame writes the
    // rest state once, after which the loop is a near no-op until levels move.
    let domDirty = false;
    const ripples: Ripple[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    let canvasClear = true;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Nothing to do while the tab is hidden.
      if (document.visibilityState !== 'visible') return;
      const p = phaseRef.current;
      const speaking = speakingRef.current;
      const S = sizeRef.current;

      // Keep the canvas sized to the orb (it changes between compact/desktop layouts).
      const cw = Math.ceil(S * 2.3);
      const px = Math.round(cw * dpr);
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${cw}px`;
      }

      const rawLocal = p === 'idle' ? 0 : Math.min(1, levels.local * 1.8);
      const rawRemote = p === 'idle' ? 0 : Math.min(1, levels.remote * 1.8);
      const targetLocal = speaking ? Math.max(rawLocal, 0.2) : rawLocal;
      smoothLocal += (targetLocal - smoothLocal) * (targetLocal > smoothLocal ? 0.4 : 0.09);
      smoothRemote += (rawRemote - smoothRemote) * (rawRemote > smoothRemote ? 0.4 : 0.09);
      const targetBloom = speaking || rawLocal > 0.08 ? 1 : 0;
      bloom += (targetBloom - bloom) * (targetBloom > bloom ? 0.12 : 0.045);
      // Snap tiny tails to zero so the idle loop settles into a no-op.
      if (smoothLocal < 0.004) smoothLocal = 0;
      if (smoothRemote < 0.004) smoothRemote = 0;
      if (bloom < 0.004) bloom = 0;
      const quiet = smoothLocal === 0 && smoothRemote === 0 && bloom === 0 && ripples.length === 0;
      if (quiet && canvasClear && !domDirty) return; // at rest: nothing to draw

      // --- DOM (transforms/opacity only) -------------------------------------
      const core = coreRef.current;
      const glow = glowRef.current;
      const aura = auraRef.current;
      if (core) {
        core.style.transform =
          p === 'idle'
            ? ''
            : `scale(${(1 + bloom * 0.06 + smoothLocal * 0.14 + smoothRemote * 0.08).toFixed(4)})`;
      }
      if (glow) {
        glow.style.opacity = (0.34 + bloom * 0.28 + smoothRemote * 0.5 + smoothLocal * 0.25).toFixed(3);
        glow.style.transform = `scale(${(1 + bloom * 0.12 + smoothRemote * 0.32 + smoothLocal * 0.16).toFixed(4)})`;
      }
      if (aura) {
        aura.style.opacity = (0.16 + smoothRemote * 0.42 + bloom * 0.1).toFixed(3);
        aura.style.transform = `scale(${(1 + smoothRemote * 0.22).toFixed(4)})`;
      }

      domDirty = !quiet;

      // --- Canvas -------------------------------------------------------------
      if (quiet) {
        if (!canvasClear) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, cw, cw);
          canvasClear = true;
        }
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, cw);
      canvasClear = false;
      const cxp = cw / 2;
      const cyp = cw / 2;
      const R = S / 2;
      const [hi, mid] = colorRef.current;
      const cMid = rgb(mid);
      const cHi = rgb(hi);
      const t = now / 1000;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1) Live waveform ring while the user speaks.
      const strength = Math.max(smoothLocal, bloom * 0.14);
      if (strength > 0.012) {
        const amp = R * (0.035 + strength * 0.2);
        const base = R * 1.14 + strength * R * 0.05;
        tracePath(ctx, cxp, cyp, base, amp, t, 7, 13, 1);
        ctx.lineWidth = 8;
        ctx.strokeStyle = rgba(cMid, 0.04 + strength * 0.16);
        ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(cMid, 0.28 + strength * 0.62);
        ctx.stroke();
        tracePath(ctx, cxp, cyp, base * 0.955, amp * 0.6, t + 1.7, 5, 11, -1);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(cHi, 0.12 + strength * 0.42);
        ctx.stroke();
      }

      // 2) Outward ripples while the bot speaks.
      if (smoothRemote > 0.05 && now - lastRipple > 470 - smoothRemote * 220) {
        ripples.push({ born: now });
        lastRipple = now;
      }
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const age = (now - ripples[i].born) / 1500;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const e = 1 - (1 - age) * (1 - age);
        const r = R * (1.04 + e * 1.02);
        const alpha = Math.pow(1 - age, 1.7) * (0.26 + smoothRemote * 0.5);
        ctx.beginPath();
        ctx.arc(cxp, cyp, r, 0, Math.PI * 2);
        ctx.lineWidth = 2.4 * (1 - age) + 0.5;
        ctx.strokeStyle = rgba(cMid, alpha);
        ctx.stroke();
      }
      if (smoothRemote > 0.02) {
        ctx.beginPath();
        ctx.arc(cxp, cyp, R * 1.06 + smoothRemote * R * 0.06, 0, Math.PI * 2);
        ctx.lineWidth = 1.2 + smoothRemote * 2;
        ctx.strokeStyle = rgba(cHi, 0.08 + smoothRemote * 0.45);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [a, b, c] = MOOD_COLORS[mood] ?? MOOD_COLORS.neutral;
  const style = { width: size, height: size, '--orb-a': a, '--orb-b': b, '--orb-c': c } as CSSProperties;

  return (
    <div
      className={cx('orb', phase === 'idle' && 'orb-idle', userSpeaking && 'orb-hearing', className)}
      style={style}
      aria-hidden
    >
      <div ref={auraRef} className="orb-aura" />
      <div ref={glowRef} className="orb-glow" />
      <div className="orb-halo orb-halo-1" />
      <div className="orb-halo orb-halo-2" />
      <div className="orb-halo orb-halo-3" />
      <canvas ref={canvasRef} className="orb-canvas" />
      <div className={cx('orb-think', phase === 'thinking' && 'is-on')} />
      <div ref={coreRef} className="orb-core">
        <div className="orb-blob orb-blob-a" />
        <div className="orb-blob orb-blob-b" />
        <div className="orb-blob orb-blob-c" />
        <div className="orb-sheen" />
      </div>
    </div>
  );
}
