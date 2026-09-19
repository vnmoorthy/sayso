import { motion } from 'framer-motion';
import type { Mood } from '../lib/protocol';
import type { EmotionSnapshot } from '../lib/store';
import { cx, pct } from '../lib/format';

const MOOD_TEXT: Record<Mood, string> = {
  neutral: 'text-lime',
  excited: 'text-lime',
  happy: 'text-amber',
  frustrated: 'text-danger',
  stressed: 'text-[#ff7a45]',
  confused: 'text-violet',
  calm: 'text-ice',
  sad: 'text-ice',
};

const MOOD_BG: Record<Mood, string> = {
  neutral: 'bg-lime',
  excited: 'bg-lime',
  happy: 'bg-amber',
  frustrated: 'bg-danger',
  stressed: 'bg-[#ff7a45]',
  confused: 'bg-violet',
  calm: 'bg-ice',
  sad: 'bg-ice',
};

export function EmotionBadge({
  emotion,
  compact,
  className,
}: {
  emotion: EmotionSnapshot | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (!emotion) {
    if (compact) return null;
    return (
      <div className={cx('text-[11px] text-dim', className)}>
        Hume reads how you sound — your emotion shows up here once you speak.
      </div>
    );
  }
  const bg = MOOD_BG[emotion.mood] ?? MOOD_BG.neutral;
  const fg = MOOD_TEXT[emotion.mood] ?? MOOD_TEXT.neutral;

  if (compact) {
    return (
      <span
        className={cx(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted',
          className,
        )}
        title={`voice: ${emotion.voice_style}`}
      >
        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', bg)} />
        <span className="truncate">
          {emotion.top} {pct(emotion.score)}
        </span>
        {emotion.simulated && <span className="text-dim">· sim</span>}
      </span>
    );
  }

  const top3 = [...emotion.emotions].sort((x, y) => y.score - x.score).slice(0, 3);

  return (
    <div className={cx('w-full max-w-[272px] rounded-2xl border border-line bg-surface-2/70 p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', bg)} />
          <span className="truncate text-sm font-semibold">
            {emotion.top} <span className={fg}>{pct(emotion.score)}</span>
          </span>
        </div>
        {emotion.simulated && (
          <span className="rounded border border-line-2 px-1 py-0.5 text-[9px] uppercase tracking-wider text-dim">
            sim
          </span>
        )}
      </div>
      {top3.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {top3.map((e) => (
            <div key={e.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 truncate text-muted">{e.name}</span>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className={cx('h-full rounded-full', bg)}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round((e.score > 1 ? e.score : e.score * 100))}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                />
              </div>
              <span className="w-8 text-right tabular-nums text-dim">{pct(e.score)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2.5 truncate text-[11px] text-muted">
        voice: <span className="text-text/80">{emotion.voice_style}</span>
      </div>
    </div>
  );
}
