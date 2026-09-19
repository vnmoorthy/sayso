import { useEffect, useState, type RefObject } from 'react';
import type { State } from '../lib/store';
import { voiceLabel, voicePhase } from '../lib/store';
import { cx } from '../lib/format';
import { Orb } from './Orb';
import { EmotionBadge } from './EmotionBadge';
import { Transcript } from './Transcript';
import { Composer } from './Composer';

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
  const hint =
    state.connection === 'connecting'
      ? 'Connecting…'
      : state.connection === 'error'
        ? state.connectionError ?? 'Connection failed — check the server URL in Settings.'
        : 'Connect to start typing or talking.';

  return (
    <div className={cx('panel flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div
        className={cx(
          'flex shrink-0 items-center gap-4 border-b border-line',
          compact ? 'flex-row px-4 py-3' : 'flex-col px-4 pt-6 pb-4',
        )}
      >
        <Orb mood={mood} phase={phase} size={compact ? 72 : 160} />
        <div className={cx('flex min-w-0 flex-col', compact ? 'items-start gap-1.5' : 'items-center gap-3')}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span
              className={cx(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                phase === 'speaking'
                  ? 'bg-lime animate-pulse-dot'
                  : phase === 'thinking'
                    ? 'bg-violet animate-pulse-dot'
                    : phase === 'listening'
                      ? state.userSpeaking
                        ? 'bg-lime'
                        : 'bg-lime/60'
                      : 'bg-dim',
              )}
            />
            <span className={phase === 'idle' ? 'text-muted' : 'text-text'}>{voiceLabel(state)}</span>
          </div>
          <EmotionBadge emotion={state.emotion} compact={compact} className={compact ? undefined : 'text-center'} />
        </div>
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
