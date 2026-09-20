import { useEffect, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AssistantTurn, State, ToolRecord, VoicePhase } from '../lib/store';
import { assistantText, voiceLabel, voicePhase } from '../lib/store';
import { INSTANT } from '../lib/flags';
import { cx, pct } from '../lib/format';
import { Orb, REDUCED_MOTION } from './Orb';
import { MOOD_BG } from './EmotionBadge';
import { Transcript, ToolChip } from './Transcript';
import { Composer } from './Composer';
import { Kbd } from './ui';

/** Rotating invitation prompts shown while connected and idle. */
const PROMPTS: { text: string; note?: string }[] = [
  { text: 'Create a web app called pulse and run it on port 8000' },
  { text: 'File a GitHub issue to add dark mode' },
  { text: 'Delete the build folder', note: 'I’ll ask first' },
];

const CAPTION_MAX = 150;
const LINGER_MS = 3200;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** The sentence currently being spoken/streamed: the last sentence of the turn so far. */
function currentSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = t.match(/[^.!?]+[.!?]*["”')\]]*\s*/g);
  let last = parts && parts.length ? parts[parts.length - 1].trim() : t;
  // A sentence just ended and the next one is only a word or two in: keep the finished one readable.
  if (parts && parts.length > 1 && last.length < 3) last = parts[parts.length - 2].trim();
  if (!last) last = t;
  if (last.length > CAPTION_MAX) last = `…${last.slice(last.length - CAPTION_MAX + 1)}`;
  return last;
}

/** Keeps the last non-null value around for `ms` after it goes null (so a finished line lingers). */
function useLinger(value: string | null, ms: number): string | null {
  const [held, setHeld] = useState<string | null>(value);
  useEffect(() => {
    if (value !== null) {
      setHeld(value);
      return;
    }
    if (ms <= 0) {
      setHeld(null);
      return;
    }
    const t = window.setTimeout(() => setHeld(null), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return value ?? held;
}

/** Typewriter over PROMPTS. Instant mode renders the first prompt fully (deterministic). */
function useTypewriter(active: boolean): { text: string; note?: string; typing: boolean } {
  const [idx, setIdx] = useState(0);
  const [n, setN] = useState<number>(INSTANT || REDUCED_MOTION ? Number.POSITIVE_INFINITY : 0);

  useEffect(() => {
    if (!active || INSTANT) return;
    if (REDUCED_MOTION) {
      const t = window.setInterval(() => setIdx((i) => (i + 1) % PROMPTS.length), 4500);
      return () => window.clearInterval(t);
    }
    let alive = true;
    let k = 0;
    let timer = 0;
    const full = PROMPTS[idx].text.length;
    const type = () => {
      if (!alive) return;
      k += 1;
      setN(k);
      if (k < full) timer = window.setTimeout(type, 22 + Math.random() * 34);
      else
        timer = window.setTimeout(() => {
          if (alive) setIdx((i) => (i + 1) % PROMPTS.length);
        }, 3000);
    };
    setN(0);
    timer = window.setTimeout(type, 420);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active, idx]);

  const p = PROMPTS[idx];
  const shown = p.text.slice(0, n);
  return { text: shown, note: shown.length >= p.text.length ? p.note : undefined, typing: shown.length < p.text.length };
}

function Caption({ text, live, tone, keyBase }: { text: string; live: boolean; tone: 'bot' | 'user'; keyBase: string }) {
  const words = text.split(' ').filter(Boolean);
  return (
    <p
      className={cx(
        'caption mx-auto max-w-[34ch] break-words',
        tone === 'bot' ? 'text-text' : 'text-muted italic',
      )}
    >
      {words.map((w, i) => (
        <span key={`${keyBase}:${i}`} className="caption-word">
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
      {live && !INSTANT && <span className="caret" />}
    </p>
  );
}

function Invitation() {
  const tw = useTypewriter(true);
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="mx-auto max-w-[34ch] text-[15px] leading-snug text-muted">
        <span className="text-dim">Try: </span>
        <span className="text-text/90">“{tw.text}</span>
        {!tw.typing && <span className="text-text/90">”</span>}
        {tw.typing && !INSTANT && <span className="caret" />}
        {tw.note && <span className="text-dim"> — {tw.note}</span>}
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] text-dim">
        <span>just talk</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          hold <Kbd>Space</Kbd> to talk when muted
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd> to type
        </span>
      </p>
    </div>
  );
}

function StageChips({ ids, tools }: { ids: string[]; tools: Record<string, ToolRecord> }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-2.5 flex max-w-full flex-wrap items-center justify-center gap-1.5">
      <AnimatePresence initial={false}>
        {ids.map((id) => (
          <motion.div
            key={id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="max-w-full"
          >
            <ToolChip tool={tools[id]} id={id} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * What sits under the orb: the live caption (yours while you speak, Sayso's while
 * it speaks), the tools it is running, or — when idle — an invitation to speak.
 */
function Stage({ state, phase, compact }: { state: State; phase: VoicePhase; compact: boolean }) {
  let lastAssistant: AssistantTurn | undefined;
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t.role === 'assistant') {
      lastAssistant = t;
      break;
    }
  }
  const pendingUser = state.pendingUserId ? state.turns.find((t) => t.id === state.pendingUserId) : undefined;
  const userLive = state.userSpeaking || !!pendingUser;
  const userText = pendingUser && pendingUser.role === 'user' ? pendingUser.text : '';

  const botActive = !userLive && (phase === 'speaking' || phase === 'thinking' || (lastAssistant?.streaming ?? false));
  const botSentence = botActive && lastAssistant ? currentSentence(assistantText(lastAssistant)) : '';
  const botText = useLinger(botSentence || null, userLive || INSTANT ? 0 : LINGER_MS);

  const toolIds = lastAssistant
    ? lastAssistant.segments
        .filter((s): s is { kind: 'tool'; id: string } => s.kind === 'tool')
        .map((s) => s.id)
        .slice(-3)
    : [];
  const showChips = botActive || (botText !== null && !userLive);

  let key: string;
  let content: React.ReactNode;
  if (userLive) {
    key = `user:${pendingUser?.id ?? 'live'}`;
    content = userText ? (
      <Caption text={userText} live tone="user" keyBase={key} />
    ) : (
      <p className="text-sm text-muted italic">Listening to you…</p>
    );
  } else if (botText) {
    key = `bot:${lastAssistant?.id ?? 'x'}`;
    const live = (lastAssistant?.streaming ?? false) || phase === 'speaking';
    content = (
      <>
        <Caption text={botText} live={live} tone="bot" keyBase={`${key}:${botText.slice(0, 12)}`} />
        {showChips && <StageChips ids={toolIds} tools={state.tools} />}
      </>
    );
  } else if (phase === 'thinking') {
    key = 'thinking';
    content = (
      <>
        <p className="caption shimmer">Thinking…</p>
        <StageChips ids={toolIds} tools={state.tools} />
      </>
    );
  } else if (phase === 'listening') {
    key = 'invite';
    content = <Invitation />;
  } else {
    key = 'none';
    content = null;
  }

  return (
    <div
      className={cx(
        'flex w-full flex-col items-center justify-center text-center',
        compact ? 'min-h-[52px] px-4 pb-3' : 'min-h-[92px] px-5 pt-1 pb-4',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="w-full"
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function VoicePanel({
  state,
  inputRef,
  onSend,
  className,
}: {
  state: State;
  inputRef: RefObject<HTMLInputElement | null>;
  onSend: (text: string) => void;
  className?: string;
}) {
  const compact = useMediaQuery('(max-width: 1023px)');
  const phase = voicePhase(state);
  const mood = state.emotion?.mood ?? 'neutral';
  const connected = state.connection === 'connected';
  const emotion = state.emotion;
  const hint =
    state.connection === 'connecting'
      ? 'Connecting…'
      : state.connection === 'error'
        ? state.connectionError ?? 'Connection failed — check the server URL in Settings.'
        : 'Connect to start typing or talking.';

  const statusDot = (
    <span
      className={cx(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        phase === 'speaking'
          ? 'bg-lime animate-pulse-dot'
          : phase === 'thinking'
            ? 'bg-violet animate-pulse-dot'
            : phase === 'listening'
              ? state.userSpeaking
                ? 'bg-lime shadow-[0_0_8px_rgba(200,255,61,0.9)]'
                : 'bg-lime/60'
              : 'bg-dim',
      )}
    />
  );

  const emotionRow = emotion ? (
    <div
      className={cx('flex max-w-full items-center gap-1.5 text-[11px] text-muted', !compact && 'justify-center')}
      title={`voice: ${emotion.voice_style}`}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', MOOD_BG[emotion.mood] ?? MOOD_BG.neutral)} />
      <span className="truncate">
        <span className="text-text/90">{emotion.top}</span> {pct(emotion.score)}
      </span>
      <span className="text-dim" aria-hidden>
        ·
      </span>
      <span className="truncate">
        voice <span className="text-text/80">{emotion.voice_style}</span>
      </span>
      {emotion.simulated && <span className="shrink-0 text-dim">· sim</span>}
    </div>
  ) : compact ? null : (
    <div className="text-[11px] text-dim">Hume reads how you sound — your emotion shows up here once you speak.</div>
  );

  return (
    <div className={cx('panel flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="flex shrink-0 flex-col border-b border-line">
        {compact ? (
          <div className="flex items-center gap-4 px-4 pt-3 pb-2">
            <Orb mood={mood} phase={phase} userSpeaking={state.userSpeaking} size={84} className="my-1 ml-1" />
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                {statusDot}
                <span className={phase === 'idle' ? 'text-muted' : 'text-text'}>{voiceLabel(state)}</span>
              </div>
              {emotionRow}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center px-4 pt-14 pb-1">
            <Orb mood={mood} phase={phase} userSpeaking={state.userSpeaking} size={200} className="mb-9" />
            <div className="flex items-center gap-2 text-sm font-medium">
              {statusDot}
              <span className={phase === 'idle' ? 'text-muted' : 'text-text'}>{voiceLabel(state)}</span>
            </div>
            <div className="mt-1.5 mb-1 flex w-full justify-center px-2">{emotionRow}</div>
          </div>
        )}
        <Stage state={state} phase={phase} compact={compact} />
      </div>
      <Transcript turns={state.turns} tools={state.tools} />
      <Composer
        inputRef={inputRef}
        disabled={!connected}
        hint={hint}
        onSend={onSend}
        showSuggestions={state.turns.length === 0}
      />
    </div>
  );
}
