import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Play } from 'lucide-react';
import type { AssistantTurn, ToolRecord, Turn, UserTurn } from '../lib/store';
import { cx, fmtMs, summarizeArgs, truncate } from '../lib/format';
import { EmotionBadge } from './EmotionBadge';
import { StatusDot } from './ui';

export function ToolChip({ tool, id }: { tool: ToolRecord | undefined; id: string }) {
  if (!tool) {
    return (
      <div className="mono inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-dim">
        tool {id}
      </div>
    );
  }
  const summary = truncate(summarizeArgs(tool.name, tool.args), 64);
  return (
    <div
      className={cx(
        'mono inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
        tool.status === 'failed'
          ? 'border-danger/30 bg-danger/5 text-danger'
          : tool.status === 'ok'
            ? 'border-line bg-surface-2 text-muted'
            : 'border-violet/30 bg-violet/5 text-violet',
      )}
      title={`${tool.name} ${summary}`}
    >
      <Play className="h-3 w-3 shrink-0 fill-current" />
      <span className="shrink-0 font-semibold text-text/90">{tool.name}</span>
      {summary && (
        <>
          <span className="shrink-0 text-dim">·</span>
          <span className="truncate">{summary}</span>
        </>
      )}
      {tool.duration_ms !== undefined && (
        <>
          <span className="shrink-0 text-dim">·</span>
          <span className="shrink-0 tabular-nums">{fmtMs(tool.duration_ms)}</span>
        </>
      )}
      <StatusDot status={tool.status} className="ml-0.5" />
    </div>
  );
}

function AssistantBubble({ turn, tools }: { turn: AssistantTurn; tools: Record<string, ToolRecord> }) {
  const segments = turn.segments;
  let lastTextIdx = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].kind === 'text') {
      lastTextIdx = i;
      break;
    }
  }
  const last = segments[segments.length - 1];
  const showThinking = turn.streaming && (!last || last.kind === 'tool');

  return (
    <div className="flex max-w-[92%] flex-col items-start gap-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-dim uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-lime" />
        sayso
      </div>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <div
            key={`t${i}`}
            className="rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-text"
          >
            <span className={cx(turn.streaming && i === lastTextIdx && i === segments.length - 1 && 'caret')}>
              {seg.text}
            </span>
          </div>
        ) : (
          <ToolChip key={seg.id} tool={tools[seg.id]} id={seg.id} />
        ),
      )}
      {showThinking && (
        <div className="rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
          <span className="caret">Thinking</span>
        </div>
      )}
    </div>
  );
}

function UserBubble({ turn }: { turn: UserTurn }) {
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      <div
        className={cx(
          'rounded-2xl rounded-br-md border px-3.5 py-2.5 text-sm leading-relaxed break-words',
          turn.final ? 'border-lime/15 bg-lime/8 text-text' : 'border-line-2 bg-surface-3 text-muted italic',
        )}
      >
        {turn.text}
        {!turn.final && <span className="caret" />}
      </div>
      {turn.emotion && <EmotionBadge emotion={turn.emotion} compact />}
    </div>
  );
}

export function Transcript({ turns, tools }: { turns: Turn[]; tools: Record<string, ToolRecord> }) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, tools]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottomRef.current = true;
    setShowJump(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="m-auto max-w-[240px] text-center text-xs leading-relaxed text-dim">
            Your conversation shows up here. Just talk — or type below.
          </div>
        )}
        {turns.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={cx('flex w-full', t.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {t.role === 'user' ? <UserBubble turn={t} /> : <AssistantBubble turn={t} tools={tools} />}
          </motion.div>
        ))}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-2 bg-surface-3/95 px-3 py-1 text-[11px] text-muted shadow-soft backdrop-blur hover:text-text"
        >
          <ArrowDown className="h-3 w-3" /> Latest
        </button>
      )}
    </div>
  );
}
