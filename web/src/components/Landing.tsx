import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import type { ConnectionState } from '../lib/store';
import { cx } from '../lib/format';
import { Orb } from './Orb';
import { Spinner } from './ui';

const EXAMPLES: { text: string; note?: string }[] = [
  { text: 'Create a web app called pulse and run it on port 8000' },
  { text: 'File a GitHub issue to add dark mode' },
  { text: 'Delete the build folder', note: 'I’ll ask first' },
];

const ease = [0.2, 0.7, 0.2, 1] as const;

export function Landing({
  connection,
  mock,
  onConnect,
  className,
}: {
  connection: ConnectionState;
  mock: boolean;
  onConnect: () => void;
  className?: string;
}) {
  const connecting = connection === 'connecting';
  return (
    <div
      className={cx(
        'panel flex h-full min-h-0 flex-col items-center overflow-x-hidden overflow-y-auto px-6 pt-10 pb-6 text-center',
        className,
      )}
    >
      <div className="my-auto flex w-full flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease }}
        >
          <Orb mood="neutral" phase="idle" size={208} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease }}
          className="mt-11 text-[36px] leading-[1.02] font-semibold tracking-tight text-text"
        >
          Say it. <span className="text-lime">It’s done.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease }}
          className="mt-3.5 max-w-[310px] text-sm leading-relaxed text-muted"
        >
          Sayso runs your terminal, browser and GitHub by voice — at SambaNova speed, in a Hume voice that listens to
          how you feel.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease }}
          className="relative mt-7"
        >
          <span aria-hidden className="connect-pulse" />
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="relative inline-flex h-12 items-center gap-2 rounded-[0.875rem] bg-lime px-7 text-[15px] font-semibold text-black shadow-glow transition hover:brightness-105 active:scale-[0.98] disabled:opacity-70"
          >
            {connecting ? (
              <>
                <Spinner className="h-4 w-4" />
                Connecting…
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                {mock ? 'Start mock session' : 'Connect'}
              </>
            )}
          </button>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-3 text-[11px] text-dim"
        >
          {mock ? 'Scripted session — no server or mic needed' : 'Needs microphone access · best in Chrome'}
        </motion.div>

        <ul className="mt-9 flex w-full max-w-[340px] flex-col items-center gap-2.5">
          {EXAMPLES.map((ex, i) => (
            <motion.li
              key={ex.text}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.55 + i * 0.12, ease }}
              className="text-[13px] leading-snug text-muted"
            >
              <span className="text-text/85">“{ex.text}”</span>
              {ex.note && <span className="text-dim"> — {ex.note}</span>}
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] text-dim">
        <span>SambaNova</span>
        <span aria-hidden>·</span>
        <span>Hume</span>
        <span aria-hidden>·</span>
        <span>Pipecat</span>
        {!mock && (
          <>
            <span aria-hidden>·</span>
            <a
              href="?mock=1"
              className="text-muted underline decoration-line-2 underline-offset-2 transition hover:text-lime"
            >
              Try the mock
            </a>
          </>
        )}
      </div>
    </div>
  );
}
