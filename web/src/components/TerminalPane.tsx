import { useEffect, useRef } from 'react';
import { CircleStop, Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import type { ProcessInfo, TerminalBlock } from '../lib/store';
import { cx, fmtMs } from '../lib/format';
import { EmptyState, StatusDot, useStatusFlash } from './ui';

function Block({ block }: { block: TerminalBlock }) {
  const flash = useStatusFlash(block.status);
  const exit =
    block.status === 'running'
      ? 'running'
      : block.status === 'ok'
        ? `exit ${block.exitCode ?? 0}`
        : `exit ${block.exitCode ?? 1}`;
  return (
    <div
      className={cx(
        'term-block mb-3.5 last:mb-0',
        block.status === 'running' && 'is-running',
        flash === 'ok' && 'flash-ok',
        flash === 'failed' && 'flash-fail',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-semibold text-lime">$</span>
        <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-text">{block.command || block.name}</span>
        <span className="flex shrink-0 items-center gap-2 pt-px text-[11px] text-dim">
          {block.name === 'start_background' && <span className="text-violet">bg</span>}
          <span className={cx(block.status === 'failed' && 'text-danger', block.status === 'ok' && 'text-muted')}>{exit}</span>
          {block.duration_ms !== undefined && <span className="tabular-nums">{fmtMs(block.duration_ms)}</span>}
          <StatusDot status={block.status} />
        </span>
      </div>
      {block.lines.length > 0 && (
        <div className="mt-1.5 ml-[3px] border-l border-line pl-3">
          {block.lines.map((l, i) => (
            <div
              key={i}
              className={cx('term-line break-words whitespace-pre-wrap', l.stream === 'stderr' ? 'text-amber' : 'text-muted')}
            >
              {l.text || ' '}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TerminalPane({
  blocks,
  processes,
  onClear,
  onStopAll,
}: {
  blocks: TerminalBlock[];
  processes: ProcessInfo[];
  onClear: () => void;
  onStopAll: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div className="terminal-surface flex h-full min-h-0 flex-col">
      {processes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <span className="eyebrow">running</span>
          {processes.map((p) => (
            <span
              key={p.name}
              title={p.command}
              className="mono inline-flex items-center gap-1.5 rounded-lg border border-lime/25 bg-lime/5 px-2 py-1 text-[11px] text-text"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-lime animate-pulse-dot" />
              {p.name}
              {p.port !== undefined && <span className="text-muted">:{p.port}</span>}
              {p.pid !== undefined && <span className="text-dim">pid {p.pid}</span>}
            </span>
          ))}
          <button
            type="button"
            onClick={onStopAll}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 text-[11px] font-medium text-danger transition hover:bg-danger/20"
          >
            <CircleStop className="h-3.5 w-3.5" />
            Stop all
          </button>
        </div>
      )}
      <div
        ref={ref}
        onScroll={onScroll}
        className="mono min-h-0 flex-1 overflow-auto p-3 text-[12.5px] leading-[1.55]"
      >
        {blocks.length === 0 ? (
          <EmptyState
            icon={<TerminalIcon />}
            title="Nothing has run yet"
            body="Ask Sayso to run something — commands and their output stream here live."
          />
        ) : (
          blocks.map((b) => <Block key={b.id} block={b} />)
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-dim">
        <span>
          {blocks.length} command{blocks.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={blocks.length === 0}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-text disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}
