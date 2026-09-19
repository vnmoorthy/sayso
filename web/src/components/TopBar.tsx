import { Mic, MicOff, PhoneOff, RotateCcw, Settings } from 'lucide-react';
import type { State } from '../lib/store';
import type { Settings as SettingsModel } from '../lib/settings';
import { cx, truncate } from '../lib/format';
import { LatencyHud } from './LatencyHud';
import { IconButton, Pill, Spinner } from './ui';

const DEMO_TIP = 'No API keys found — running the local demo brain and browser TTS';

function ConnectControls({
  state,
  onConnect,
  onDisconnect,
  onToggleMic,
}: {
  state: State;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMic: () => void;
}) {
  const c = state.connection;

  if (state.mock) {
    return (
      <>
        <button
          type="button"
          onClick={onConnect}
          title="Restart the scripted mock session"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-violet/40 bg-violet/10 px-3 text-sm font-medium text-violet transition hover:bg-violet/20"
        >
          {c === 'connecting' ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : c === 'connected' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-violet animate-pulse-dot" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Mock session
        </button>
        {c === 'connected' && (
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 text-sm font-medium text-danger transition hover:bg-danger/20"
          >
            <PhoneOff className="h-4 w-4" />
            <span className="hidden sm:inline">End</span>
          </button>
        )}
      </>
    );
  }

  if (c === 'connecting' || c === 'disconnecting') {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-2 bg-surface-2 px-4 text-sm font-medium text-muted"
      >
        <Spinner className="h-4 w-4" />
        {c === 'connecting' ? 'Connecting…' : 'Ending…'}
      </button>
    );
  }

  if (c === 'connected') {
    return (
      <>
        <IconButton
          label={state.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          tone={state.micEnabled ? 'lime' : 'danger'}
          onClick={onToggleMic}
        >
          {state.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </IconButton>
        <button
          type="button"
          onClick={onDisconnect}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 text-sm font-medium text-danger transition hover:bg-danger/20"
        >
          <PhoneOff className="h-4 w-4" />
          <span className="hidden sm:inline">End</span>
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      className="inline-flex h-9 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-black shadow-glow transition hover:brightness-105"
    >
      <Mic className="h-4 w-4" />
      Connect
    </button>
  );
}

export function TopBar({
  state,
  settings,
  settingsOpen,
  onConnect,
  onDisconnect,
  onToggleMic,
  onToggleSettings,
}: {
  state: State;
  settings: SettingsModel;
  settingsOpen: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMic: () => void;
  onToggleSettings: () => void;
}) {
  const status = state.status;
  const llmLabel = status ? `${status.llm.provider} · ${status.llm.model}` : 'SambaNova · Meta-Llama-3.3-70B';
  const ttsLabel = status
    ? status.tts === 'hume'
      ? 'Hume voice'
      : status.tts === 'browser'
        ? 'Browser voice'
        : status.tts === 'kokoro'
          ? 'Kokoro voice · local'
          : `${status.tts} voice`
    : 'Hume voice';
  const demo = status?.mode === 'demo';

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-3 lg:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <a href="/" className="flex items-center gap-1.5 text-[19px] leading-none font-semibold tracking-tight lowercase">
          <span>sayso</span>
          <span className="mb-px h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,61,0.9)]" />
        </a>
        <span className="hidden truncate text-xs text-dim xl:inline">Your terminal, on your say-so.</span>
      </div>

      <div className="mx-auto hidden min-w-0 items-center gap-1.5 md:flex">
        <Pill tone="lime" dot title={llmLabel}>
          {truncate(llmLabel, 42)}
        </Pill>
        <Pill tone="neutral" title="Text to speech">
          {ttsLabel}
        </Pill>
        <Pill tone="violet" title="Orchestration">
          Pipecat
        </Pill>
        {demo && (
          <Pill tone="amber" title={DEMO_TIP}>
            DEMO MODE
          </Pill>
        )}
      </div>
      {demo && (
        <Pill tone="amber" title={DEMO_TIP} className="md:hidden">
          DEMO
        </Pill>
      )}

      <div className={cx('flex items-center gap-2', 'ml-auto md:ml-0')}>
        {settings.showHud && <LatencyHud latency={state.latency} className="hidden lg:flex" />}
        <IconButton label="Settings" active={settingsOpen} onClick={onToggleSettings} aria-expanded={settingsOpen}>
          <Settings className="h-4 w-4" />
        </IconButton>
        <ConnectControls state={state} onConnect={onConnect} onDisconnect={onDisconnect} onToggleMic={onToggleMic} />
      </div>
    </header>
  );
}
