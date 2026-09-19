import { useEffect, useRef, type CSSProperties } from 'react';
import type { Mood } from '../lib/protocol';
import type { VoicePhase } from '../lib/store';
import { levels } from '../lib/levels';
import { cx } from '../lib/format';

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

export function Orb({
  mood,
  phase,
  size = 160,
  className,
}: {
  mood: Mood;
  phase: VoicePhase;
  size?: number;
  className?: string;
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<VoicePhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let raf = 0;
    let smoothLocal = 0;
    let smoothRemote = 0;
    const tick = () => {
      const p = phaseRef.current;
      const targetLocal = p === 'idle' ? 0 : Math.min(1, levels.local * 1.8);
      const targetRemote = p === 'idle' ? 0 : Math.min(1, levels.remote * 1.8);
      smoothLocal += (targetLocal - smoothLocal) * (targetLocal > smoothLocal ? 0.42 : 0.1);
      smoothRemote += (targetRemote - smoothRemote) * (targetRemote > smoothRemote ? 0.42 : 0.1);

      const core = coreRef.current;
      const glow = glowRef.current;
      const ring = ringRef.current;
      if (core) {
        core.style.transform =
          p === 'idle' ? '' : `scale(${(1 + smoothLocal * 0.2 + smoothRemote * 0.1).toFixed(3)})`;
      }
      if (glow) {
        glow.style.opacity = (0.3 + smoothRemote * 0.7 + smoothLocal * 0.2).toFixed(3);
        glow.style.transform = `scale(${(1 + smoothRemote * 0.35 + smoothLocal * 0.1).toFixed(3)})`;
      }
      if (ring) {
        ring.style.opacity = (smoothLocal * 0.9).toFixed(3);
        ring.style.transform = `scale(${(1 + smoothLocal * 0.3).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [a, b, c] = MOOD_COLORS[mood] ?? MOOD_COLORS.neutral;
  const style = { width: size, height: size, '--orb-a': a, '--orb-b': b, '--orb-c': c } as CSSProperties;

  return (
    <div className={cx('orb', phase === 'idle' && 'orb-idle', className)} style={style} aria-hidden>
      <div ref={glowRef} className="orb-glow" />
      <div ref={ringRef} className="orb-ring" />
      {phase === 'thinking' && <div className="orb-thinking" />}
      <div ref={coreRef} className="orb-core">
        <div className="orb-blob orb-blob-a" />
        <div className="orb-blob orb-blob-b" />
        <div className="orb-blob orb-blob-c" />
        <div className="orb-sheen" />
      </div>
    </div>
  );
}
