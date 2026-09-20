import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { ListTree, Mic, PanelsTopLeft } from 'lucide-react';
import { assistantText, initialState, reducer, type ToolStatus } from './lib/store';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { armCues, playCue, setCuesEnabled } from './lib/cues';
import { PipecatSession, type SaysoSession } from './lib/pipecat';
import { MockSession } from './lib/mock';
import { INSTANT, MOCK } from './lib/flags';
import { cx } from './lib/format';
import { TopBar } from './components/TopBar';
import { Landing } from './components/Landing';
import { MOOD_COLORS } from './components/Orb';
import { VoicePanel } from './components/VoicePanel';
import { Workbench } from './components/Workbench';
import { ActionsRail } from './components/ActionsRail';
import { SettingsPopover } from './components/SettingsPopover';
import { Toasts } from './components/Toasts';

type MobileView = 'voice' | 'work' | 'actions';

/** Prefer a natural-sounding local voice for the browser speech fallback. */
function pickBrowserVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const prefer = ['Google US English', 'Samantha', 'Ava', 'Zoe', 'Allison', 'Karen', 'Daniel', 'Moira'];
  for (const name of prefer) {
    const hit = en.find((v) => v.name.startsWith(name));
    if (hit) return hit;
  }
  return en.find((v) => /premium|enhanced|natural/i.test(v.name)) ?? en[0] ?? voices[0];
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('voice');
  const isMock = MOCK;
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionRef = useRef<SaysoSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = isMock ? new MockSession(dispatch, { instant: INSTANT }) : new PipecatSession(dispatch);
  }
  const session = sessionRef.current;

  // Keep latest values reachable from stable callbacks.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Mock sessions start themselves so ?mock=1 is alive on load.
  useEffect(() => {
    if (!isMock) return;
    dispatch({ type: 'set_mock', mock: true });
    void session.connect(settingsRef.current.serverUrl);
    return () => {
      void session.disconnect();
    };
  }, [isMock, session]);

  const connect = useCallback(() => {
    void session.connect(settingsRef.current.serverUrl);
  }, [session]);

  const disconnect = useCallback(() => {
    void session.disconnect();
  }, [session]);

  const toggleMic = useCallback(() => {
    session.enableMic(!stateRef.current.micEnabled);
  }, [session]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatch({ type: 'local_user_text', text: trimmed });
      void session.sendText(trimmed);
    },
    [session],
  );

  const confirm = useCallback(
    (id: string, approved: boolean) => session.sendClientMessage('confirm', { id, approved }),
    [session],
  );

  const stopAll = useCallback(() => session.sendClientMessage('stop_all', {}), [session]);

  const dismissToast = useCallback((id: string) => dispatch({ type: 'dismiss_toast', id }), []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        return next;
      });
      if (patch.model) session.sendClientMessage('set_model', { model: patch.model });
      if (patch.voice) session.sendClientMessage('set_voice', { voice: patch.voice });
    },
    [session],
  );

  // Push-to-talk only: keep the mic muted whenever we are connected; Space opens it.
  useEffect(() => {
    if (state.connection !== 'connected') return;
    session.enableMic(!settings.pushToTalk);
  }, [state.connection, settings.pushToTalk, session]);

  // "/" focuses the composer from anywhere. Holding Space while the mic is muted
  // is push-to-talk: the mic opens for as long as the key is held.
  const pttRef = useRef(false);
  useEffect(() => {
    const inField = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        if (inField(e)) return;
        e.preventDefault();
        setMobileView('voice');
        inputRef.current?.focus();
        return;
      }
      if (e.key === ' ' && !inField(e) && !e.repeat) {
        const st = stateRef.current;
        if (st.connection === 'connected' && !st.micEnabled && !pttRef.current) {
          e.preventDefault();
          pttRef.current = true;
          session.enableMic(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && pttRef.current) {
        pttRef.current = false;
        session.enableMic(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [session]);

  // Browser TTS fallback when the server has no voice.
  const spokenRef = useRef<Map<string, number>>(new Map());
  const browserTtsActive = settings.browserTts && state.status?.tts === 'browser' && typeof speechSynthesis !== 'undefined';
  useEffect(() => {
    if (!browserTtsActive) return;
    for (const t of state.turns) {
      if (t.role !== 'assistant' || t.streaming) continue;
      const text = assistantText(t);
      const spoken = spokenRef.current.get(t.id) ?? 0;
      if (text.length <= spoken) continue;
      spokenRef.current.set(t.id, text.length);
      const chunk = text.slice(spoken).trim();
      if (chunk) {
        const u = new SpeechSynthesisUtterance(chunk);
        const v = pickBrowserVoice();
        if (v) u.voice = v;
        u.rate = 1.05;
        speechSynthesis.speak(u);
      }
    }
  }, [state.turns, browserTtsActive]);
  useEffect(() => {
    if (state.userSpeaking && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, [state.userSpeaking]);

  // Surface the pane the mobile user needs when something important happens.
  const confirmCount = state.confirms.length;
  useEffect(() => {
    if (confirmCount > 0) setMobileView('work');
  }, [confirmCount]);

  // Sound cues (Web Audio, no assets). Unlocked by the first gesture; never in instant mode.
  useEffect(() => {
    armCues();
  }, []);
  useEffect(() => {
    setCuesEnabled(settings.soundCues);
  }, [settings.soundCues]);
  const prevConnRef = useRef(state.connection);
  useEffect(() => {
    if (state.connection === 'connected' && prevConnRef.current !== 'connected') playCue('connect');
    prevConnRef.current = state.connection;
  }, [state.connection]);
  const toolStatusRef = useRef<Map<string, ToolStatus>>(new Map());
  useEffect(() => {
    const seen = toolStatusRef.current;
    const tools = Object.values(state.tools);
    if (tools.length === 0) {
      seen.clear();
      return;
    }
    for (const t of tools) {
      const was = seen.get(t.id);
      if (was && was !== t.status) {
        if (t.status === 'ok') playCue('tick');
        else if (t.status === 'failed') playCue('thud');
      }
      seen.set(t.id, t.status);
    }
  }, [state.tools]);
  const confirmSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const c of state.confirms) {
      if (confirmSeenRef.current.has(c.id)) continue;
      confirmSeenRef.current.add(c.id);
      playCue('sayso');
    }
  }, [state.confirms]);

  // Mood-tinted aurora behind everything.
  const auroraMood = state.emotion?.mood ?? 'neutral';
  const [, auraA, auraB] = MOOD_COLORS[auroraMood] ?? MOOD_COLORS.neutral;
  const auroraStyle = { '--aura-a': auraA, '--aura-b': auraB } as CSSProperties;

  const showLanding = !state.mock && state.connection !== 'connected' && state.turns.length === 0;
  const runningActions = Object.values(state.tools).filter((t) => t.status === 'running').length;

  const nav: { id: MobileView; label: string; icon: typeof Mic; badge?: number; tone?: string }[] = [
    { id: 'voice', label: 'Voice', icon: Mic },
    { id: 'work', label: 'Workbench', icon: PanelsTopLeft, badge: confirmCount, tone: 'bg-amber text-black' },
    { id: 'actions', label: 'Actions', icon: ListTree, badge: runningActions, tone: 'bg-violet text-white' },
  ];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-transparent text-text">
      <div className="aurora" aria-hidden style={auroraStyle}>
        <span className="aurora-blob aurora-1" />
        <span className="aurora-blob aurora-2" />
        <span className="aurora-blob aurora-3" />
      </div>
      <TopBar
        state={state}
        settings={settings}
        settingsOpen={settingsOpen}
        onConnect={connect}
        onDisconnect={disconnect}
        onToggleMic={toggleMic}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[340px_minmax(0,1fr)_264px] lg:gap-3.5 lg:px-4 lg:pb-4 xl:grid-cols-[380px_minmax(0,1fr)_300px]">
        <section className={cx('min-h-0', mobileView !== 'voice' && 'hidden lg:block')} aria-label="Voice">
          {showLanding ? (
            <Landing connection={state.connection} mock={state.mock} onConnect={connect} />
          ) : (
            <VoicePanel state={state} inputRef={inputRef} onSend={send} />
          )}
        </section>
        <section className={cx('min-h-0 min-w-0', mobileView !== 'work' && 'hidden lg:block')} aria-label="Workbench">
          <Workbench state={state} dispatch={dispatch} onConfirm={confirm} onStopAll={stopAll} />
        </section>
        <section className={cx('min-h-0', mobileView !== 'actions' && 'hidden lg:block')} aria-label="Actions">
          <ActionsRail actions={state.actions} tools={state.tools} github={state.github} />
        </section>
      </main>

      <nav className="shrink-0 border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-3 gap-1 py-1.5">
          {nav.map((item) => {
            const active = mobileView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMobileView(item.id)}
                className={cx(
                  'relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors',
                  active ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
                )}
              >
                <item.icon className={cx('h-4 w-4', active && 'text-lime')} />
                {item.label}
                {item.badge ? (
                  <span
                    className={cx(
                      'absolute top-1 right-[calc(50%-1.6rem)] min-w-4 rounded-full px-1 text-[9px] leading-4 font-semibold',
                      item.tone,
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        status={state.status}
        connected={state.connection === 'connected'}
      />
      {/* Instant (screenshot) mode skips transient toasts so the captured frame is deterministic. */}
      <Toasts toasts={INSTANT ? [] : state.toasts} onDismiss={dismissToast} />
    </div>
  );
}
