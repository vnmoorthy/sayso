import { useEffect, useRef, useState } from 'react';
import type { Latency } from '../lib/store';
import { cx } from '../lib/format';
import { INSTANT } from '../lib/flags';

function useTween(target: number | undefined, ms = 450): number | undefined {
  const [value, setValue] = useState<number | undefined>(target);
  const fromRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === undefined) {
      setValue(undefined);
      fromRef.current = undefined;
      return;
    }
    if (INSTANT) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current ?? 0;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}

function Chip({
  label,
  value,
  unit,
  accent,
}: {
  label?: string;
  value: number | undefined;
  unit: string;
  accent?: boolean;
}) {
  const v = useTween(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (value === undefined) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div
      className={cx(
        'flex h-8 items-baseline gap-1 rounded-lg border bg-surface-2 px-2 transition-colors duration-300',
        flash ? 'border-lime/40' : 'border-line',
      )}
      title={label ? `${label} latency` : 'LLM throughput'}
    >
      {label && <span className="self-center text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</span>}
      <span
        className={cx(
          'mono self-center text-xs tabular-nums',
          v === undefined ? 'text-dim' : accent ? 'text-lime' : 'text-text',
        )}
      >
        {v === undefined ? '—' : Math.round(v)}
      </span>
      <span className="self-center text-[10px] text-dim">{unit}</span>
    </div>
  );
}

export function LatencyHud({ latency, className }: { latency: Latency; className?: string }) {
  return (
    <div className={cx('flex items-center gap-1.5', className)} aria-label="Latency">
      <Chip label="STT" value={latency.stt} unit="ms" />
      <Chip label="LLM TTFT" value={latency.llmTtfb} unit="ms" accent />
      <Chip value={latency.tps} unit="tok/s" accent />
      <Chip label="TTS" value={latency.tts} unit="ms" />
    </div>
  );
}
