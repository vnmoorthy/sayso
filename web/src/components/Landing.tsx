import { Mic } from 'lucide-react';
import type { ConnectionState } from '../lib/store';
import { cx } from '../lib/format';
import { Orb } from './Orb';
import { Spinner } from './ui';

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
        'panel flex h-full min-h-0 flex-col items-center overflow-y-auto px-6 pt-10 pb-6 text-center',
        className,
      )}
    >
      <div className="my-auto flex flex-col items-center">
        <Orb mood="neutral" phase="idle" size={176} />
        <h1 className="mt-9 text-[34px] leading-[1.02] font-semibold tracking-tight text-text">
          Say it. <span className="text-lime">It’s done.</span>
        </h1>
        <p className="mt-3.5 max-w-[310px] text-sm leading-relaxed text-muted">
          Sayso runs your terminal, browser and GitHub by voice — at SambaNova speed, in a Hume voice that listens to
          how you feel.
        </p>
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-lime px-6 text-sm font-semibold text-black shadow-glow transition hover:brightness-105 disabled:opacity-70"
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
        <div className="mt-3 text-[11px] text-dim">
          {mock ? 'Scripted session — no server or mic needed' : 'Needs microphone access · best in Chrome'}
        </div>
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
