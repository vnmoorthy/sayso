// Single source of truth for the UI. Both the real Pipecat bridge and the mock
// session dispatch the same typed actions into this reducer.

import type { LlmStatsMessage, Mood, ServerMessage, StatusMessage } from './protocol';
import { applyCarriageReturns, stripAnsi } from './ansi';

// ---------------------------------------------------------------- types

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';
export type WorkbenchTab = 'terminal' | 'browser' | 'files';
export type ToastLevel = 'info' | 'warn' | 'error' | 'success';
export type ToolStatus = 'running' | 'ok' | 'failed';
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface EmotionSnapshot {
  top: string;
  score: number;
  mood: Mood;
  emotions: { name: string; score: number }[];
  voice_style: string;
  simulated?: boolean;
  ts: number;
}

export interface ToolRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  ts: number;
  status: ToolStatus;
  summary?: string;
  result?: unknown;
  duration_ms?: number;
}

export interface TerminalLine {
  stream: 'stdout' | 'stderr';
  text: string;
  done: boolean;
}

export interface TerminalBlock {
  id: string;
  name: string;
  command: string;
  status: ToolStatus;
  exitCode?: number;
  duration_ms?: number;
  lines: TerminalLine[];
  startedAt: number;
}

export type TurnSegment = { kind: 'text'; text: string } | { kind: 'tool'; id: string };

export interface UserTurn {
  id: string;
  role: 'user';
  text: string;
  final: boolean;
  ts: number;
  source: 'voice' | 'text';
  emotion?: EmotionSnapshot;
}

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  segments: TurnSegment[];
  streaming: boolean;
  ts: number;
}

export type Turn = UserTurn | AssistantTurn;

export interface ProcessInfo {
  name: string;
  pid?: number;
  state: 'started' | 'exited' | 'stopped';
  command: string;
  port?: number;
  ts: number;
}

export interface FileRecord {
  path: string;
  content: string;
  language: string;
  action: 'write' | 'read';
  ts: number;
}

export interface Toast {
  id: string;
  level: ToastLevel;
  text: string;
  ts: number;
}

export interface ConfirmRequest {
  id: string;
  command: string;
  reason: string;
  ts: number;
}

export interface GithubEvent {
  id: string;
  kind: 'issue' | 'pr' | 'repo';
  url: string;
  number?: number;
  title: string;
  ts: number;
}

export type ActionEntry = { kind: 'tool'; id: string } | { kind: 'github'; id: string };

export interface Latency {
  stt?: number;
  llmTtfb?: number;
  tts?: number;
  tps?: number;
}

export interface MetricEntry {
  processor: string;
  value: number;
}

export interface State {
  mock: boolean;
  connection: ConnectionState;
  connectionError?: string;
  transportState: string;
  botReady: boolean;
  micEnabled: boolean;
  userSpeaking: boolean;
  botSpeaking: boolean;
  llmBusy: boolean;
  status: StatusMessage | null;
  emotion: EmotionSnapshot | null;
  latency: Latency;
  llmStats: LlmStatsMessage | null;
  turns: Turn[];
  currentAssistantId: string | null;
  pendingUserId: string | null;
  tools: Record<string, ToolRecord>;
  actions: ActionEntry[];
  github: Record<string, GithubEvent>;
  terminal: TerminalBlock[];
  processes: Record<string, ProcessInfo>;
  files: Record<string, FileRecord>;
  fileOrder: string[];
  workspaceTree: string[];
  selectedFile: string | null;
  browserUrl: string | null;
  browserTitle?: string;
  browserNonce: number;
  /** Latest screenshot from the agent's own Chrome (null → the iframe shows browserUrl). */
  browserShot: { image: string; url: string; title?: string; action?: string; ts: number } | null;
  tab: WorkbenchTab;
  tabPinnedAt: number;
  confirms: ConfirmRequest[];
  toasts: Toast[];
}

export type Action =
  | { type: 'server'; msg: ServerMessage }
  | { type: 'connection'; state: ConnectionState; error?: string }
  | { type: 'transport_state'; state: string }
  | { type: 'bot_ready' }
  | { type: 'mic'; enabled: boolean }
  | { type: 'user_transcript'; text: string; final: boolean }
  | { type: 'user_speaking'; speaking: boolean }
  | { type: 'bot_speaking'; speaking: boolean }
  | { type: 'llm_started' }
  | { type: 'llm_text'; text: string }
  | { type: 'llm_stopped' }
  | { type: 'metrics'; ttfb?: MetricEntry[]; processing?: MetricEntry[] }
  | { type: 'toast'; level: ToastLevel; text: string }
  | { type: 'dismiss_toast'; id: string }
  | { type: 'set_tab'; tab: WorkbenchTab; manual?: boolean }
  | { type: 'select_file'; path: string }
  | { type: 'browser_navigate'; url: string }
  | { type: 'browser_refresh' }
  | { type: 'clear_terminal' }
  | { type: 'local_user_text'; text: string }
  | { type: 'set_mock'; mock: boolean }
  | { type: 'reset_session' };

// ---------------------------------------------------------------- helpers

let seq = 0;
export function uid(prefix = 'id'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export const initialState: State = {
  mock: false,
  connection: 'idle',
  transportState: 'disconnected',
  botReady: false,
  micEnabled: false,
  userSpeaking: false,
  botSpeaking: false,
  llmBusy: false,
  status: null,
  emotion: null,
  latency: {},
  llmStats: null,
  turns: [],
  currentAssistantId: null,
  pendingUserId: null,
  tools: {},
  actions: [],
  github: {},
  terminal: [],
  processes: {},
  files: {},
  fileOrder: [],
  workspaceTree: [],
  selectedFile: null,
  browserUrl: null,
  browserNonce: 0,
  browserShot: null,
  tab: 'terminal',
  tabPinnedAt: 0,
  confirms: [],
  toasts: [],
};

const PIN_MS = 10_000;
const MAX_LINES_PER_BLOCK = 2000;

function autoTab(s: State, tab: WorkbenchTab): State {
  if (s.tab === tab) return s;
  if (Date.now() - s.tabPinnedAt < PIN_MS) return s;
  return { ...s, tab };
}

function pushToast(s: State, level: ToastLevel, text: string): State {
  const toast: Toast = { id: uid('toast'), level, text, ts: Date.now() };
  return { ...s, toasts: [...s.toasts.slice(-4), toast] };
}

function updateTurn(s: State, id: string, fn: (t: Turn) => Turn): State {
  return { ...s, turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) };
}

function ensureAssistant(s: State): { s: State; id: string } {
  if (s.currentAssistantId && s.turns.some((t) => t.id === s.currentAssistantId)) {
    return { s, id: s.currentAssistantId };
  }
  const id = uid('a');
  const turn: AssistantTurn = { id, role: 'assistant', segments: [], streaming: false, ts: Date.now() };
  return { s: { ...s, turns: [...s.turns, turn], currentAssistantId: id }, id };
}

function appendOutput(block: TerminalBlock, stream: 'stdout' | 'stderr', chunk: string): TerminalBlock {
  const clean = stripAnsi(chunk).replace(/\r\n/g, '\n');
  if (!clean) return block;
  const endsWithNewline = clean.endsWith('\n');
  const parts = clean.split('\n');
  if (endsWithNewline) parts.pop();
  const lines = block.lines.slice();
  parts.forEach((part, i) => {
    const done = i < parts.length - 1 || endsWithNewline;
    const last = lines[lines.length - 1];
    if (i === 0 && last && !last.done && last.stream === stream) {
      lines[lines.length - 1] = { ...last, text: applyCarriageReturns(last.text + part), done };
    } else {
      lines.push({ stream, text: applyCarriageReturns(part), done });
    }
  });
  return { ...block, lines: lines.length > MAX_LINES_PER_BLOCK ? lines.slice(-MAX_LINES_PER_BLOCK) : lines };
}

function exitCodeOf(result: unknown, ok: boolean): number {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['exit_code', 'exitCode', 'returncode', 'code']) {
      const v = r[key];
      if (typeof v === 'number') return v;
    }
  }
  return ok ? 0 : 1;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '');
}

function commandOf(args: Record<string, unknown> | undefined): string {
  const v = args?.command ?? args?.cmd;
  return typeof v === 'string' ? v : v === undefined ? '' : String(v);
}

// ---------------------------------------------------------------- server messages

function reduceServer(s: State, msg: ServerMessage): State {
  switch (msg.type) {
    case 'status':
      return { ...s, status: msg };

    case 'tool_call': {
      const tool: ToolRecord = {
        id: msg.id,
        name: msg.name,
        args: msg.args ?? {},
        ts: msg.ts || Date.now(),
        status: 'running',
      };
      let next: State = {
        ...s,
        tools: { ...s.tools, [msg.id]: tool },
        actions: s.actions.some((a) => a.kind === 'tool' && a.id === msg.id)
          ? s.actions
          : [...s.actions, { kind: 'tool', id: msg.id }],
      };
      const ens = ensureAssistant(next);
      next = updateTurn(ens.s, ens.id, (t) =>
        t.role === 'assistant' ? { ...t, segments: [...t.segments, { kind: 'tool', id: msg.id }] } : t,
      );
      if (msg.name === 'run_shell' || msg.name === 'start_background') {
        const block: TerminalBlock = {
          id: msg.id,
          name: msg.name,
          command: commandOf(msg.args),
          status: 'running',
          lines: [],
          startedAt: Date.now(),
        };
        next = autoTab({ ...next, terminal: [...next.terminal, block] }, 'terminal');
      }
      return next;
    }

    case 'tool_output': {
      let terminal = s.terminal;
      let idx = terminal.findIndex((b) => b.id === msg.id);
      if (idx === -1) {
        const t = s.tools[msg.id];
        terminal = [
          ...terminal,
          {
            id: msg.id,
            name: t?.name ?? 'run_shell',
            command: commandOf(t?.args),
            status: t?.status ?? 'running',
            lines: [],
            startedAt: Date.now(),
          },
        ];
        idx = terminal.length - 1;
      }
      const updated = terminal.map((b, j) => (j === idx ? appendOutput(b, msg.stream, msg.chunk) : b));
      // Only a foreground command pulls the Terminal forward; chatter from background
      // servers (request logs) must not steal the tab from the Browser pane.
      const block = updated[idx];
      const foreground = block.name !== 'start_background' && block.status === 'running';
      return foreground ? autoTab({ ...s, terminal: updated }, 'terminal') : { ...s, terminal: updated };
    }

    case 'tool_result': {
      const prev = s.tools[msg.id];
      const base: ToolRecord = prev ?? { id: msg.id, name: msg.name, args: {}, ts: Date.now(), status: 'running' };
      const tool: ToolRecord = {
        ...base,
        name: msg.name || base.name,
        status: msg.ok ? 'ok' : 'failed',
        summary: msg.summary,
        result: msg.result,
        duration_ms: msg.duration_ms,
      };
      let next: State = { ...s, tools: { ...s.tools, [msg.id]: tool } };
      if (!prev) next = { ...next, actions: [...next.actions, { kind: 'tool', id: msg.id }] };
      next = {
        ...next,
        terminal: next.terminal.map((b) =>
          b.id === msg.id
            ? {
                ...b,
                status: msg.ok ? 'ok' : 'failed',
                exitCode: exitCodeOf(msg.result, msg.ok),
                duration_ms: msg.duration_ms,
                lines: b.lines.map((l) => (l.done ? l : { ...l, done: true })),
              }
            : b,
        ),
      };
      return next;
    }

    case 'confirm_request': {
      if (s.confirms.some((c) => c.id === msg.id)) return s;
      const next: State = {
        ...s,
        confirms: [...s.confirms, { id: msg.id, command: msg.command, reason: msg.reason, ts: Date.now() }],
      };
      return pushToast(next, 'warn', `Sayso needs your say-so: ${msg.command}`);
    }

    case 'confirm_resolved':
      return { ...s, confirms: s.confirms.filter((c) => c.id !== msg.id) };

    case 'emotion': {
      const snap: EmotionSnapshot = {
        top: msg.top,
        score: msg.score,
        mood: msg.mood,
        emotions: msg.emotions ?? [],
        voice_style: msg.voice_style,
        simulated: msg.simulated,
        ts: Date.now(),
      };
      let next: State = { ...s, emotion: snap };
      // Attach to the most recent user turn if it has no (fresh) emotion yet.
      for (let i = next.turns.length - 1; i >= 0 && i >= next.turns.length - 3; i -= 1) {
        const t = next.turns[i];
        if (t.role === 'user') {
          // Replace a snapshot that predates (or coincides with) the turn — it was carried over, not measured for it.
          if (!t.emotion || t.emotion.ts <= t.ts) {
            next = updateTurn(next, t.id, (u) => (u.role === 'user' ? { ...u, emotion: snap } : u));
          }
          break;
        }
      }
      return next;
    }

    case 'llm_stats':
      return {
        ...s,
        llmStats: msg,
        latency: { ...s.latency, tps: msg.tps, llmTtfb: msg.ttft_ms || s.latency.llmTtfb },
      };

    case 'open_url':
      return { ...s, browserUrl: msg.url, browserTitle: msg.title, browserNonce: s.browserNonce + 1, browserShot: null, tab: 'browser' };

    case 'browser_frame':
      return {
        ...s,
        browserShot: { image: msg.image, url: msg.url, title: msg.title, action: msg.action, ts: msg.ts },
        browserUrl: msg.url,
        browserTitle: msg.title,
        tab: 'browser',
      };

    case 'file_changed': {
      const rec: FileRecord = {
        path: msg.path,
        content: msg.content,
        language: msg.language,
        action: msg.action,
        ts: Date.now(),
      };
      const fileOrder = [msg.path, ...s.fileOrder.filter((p) => p !== msg.path)];
      // A rewrite while a page is open in the Browser pane: reload it in place so the
      // change is visible immediately, and keep the Browser tab in front.
      const liveReload = msg.action === 'write' && !!s.browserUrl && /\.(html?|css|js|mjs|svg|json)$/i.test(msg.path);
      const next = {
        ...s,
        files: { ...s.files, [msg.path]: rec },
        fileOrder,
        selectedFile: msg.path,
        browserNonce: liveReload ? s.browserNonce + 1 : s.browserNonce,
      };
      return autoTab(next, liveReload ? 'browser' : 'files');
    }

    case 'github_event': {
      const id = uid('gh');
      const ev: GithubEvent = {
        id,
        kind: msg.kind,
        url: msg.url,
        number: msg.number,
        title: msg.title,
        ts: Date.now(),
      };
      const label = msg.kind === 'issue' ? 'Issue' : msg.kind === 'pr' ? 'PR' : 'Repo';
      const next: State = {
        ...s,
        github: { ...s.github, [id]: ev },
        actions: [...s.actions, { kind: 'github', id }],
      };
      return pushToast(next, 'success', `${label}${msg.number ? ` #${msg.number}` : ''} · ${msg.title}`);
    }

    case 'process': {
      const info: ProcessInfo = {
        name: msg.name,
        pid: msg.pid,
        state: msg.state,
        command: msg.command,
        port: msg.port,
        ts: Date.now(),
      };
      return { ...s, processes: { ...s.processes, [msg.name]: info } };
    }

    case 'workspace':
      return { ...s, workspaceTree: Array.isArray(msg.tree) ? msg.tree : [] };

    case 'notice':
      return pushToast(s, msg.level, msg.text);

    default:
      return s;
  }
}

// ---------------------------------------------------------------- reducer

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'server':
      return reduceServer(s, a.msg);

    case 'connection': {
      const next: State = { ...s, connection: a.state, connectionError: a.error };
      if (a.state === 'idle' || a.state === 'error') {
        return {
          ...next,
          botReady: false,
          userSpeaking: false,
          botSpeaking: false,
          llmBusy: false,
          micEnabled: false,
          currentAssistantId: null,
          pendingUserId: null,
          turns: next.turns.map((t) =>
            t.role === 'assistant' && t.streaming ? { ...t, streaming: false } : t,
          ),
        };
      }
      if (a.state === 'connected') return { ...next, micEnabled: true };
      return next;
    }

    case 'transport_state': {
      const next: State = { ...s, transportState: a.state };
      if (a.state === 'disconnected' && (s.connection === 'connected' || s.connection === 'disconnecting')) {
        return reducer(next, { type: 'connection', state: 'idle' });
      }
      if (a.state === 'error' && s.connection !== 'idle') {
        return reducer(next, { type: 'connection', state: 'error', error: 'Transport error' });
      }
      return next;
    }

    case 'bot_ready':
      return { ...s, botReady: true, connection: 'connected', micEnabled: true };

    case 'mic':
      return { ...s, micEnabled: a.enabled };

    case 'user_transcript': {
      const text = a.text.trim();
      if (!text) return s;
      const now = Date.now();
      let next: State = { ...s, currentAssistantId: null };
      if (!a.final) {
        if (next.pendingUserId) {
          return updateTurn(next, next.pendingUserId, (t) => (t.role === 'user' ? { ...t, text } : t));
        }
        const id = uid('u');
        const turn: UserTurn = { id, role: 'user', text, final: false, ts: now, source: 'voice' };
        return { ...next, turns: [...next.turns, turn], pendingUserId: id };
      }
      const emotion = next.emotion && now - next.emotion.ts < 20_000 ? next.emotion : undefined;
      if (next.pendingUserId) {
        const pid = next.pendingUserId;
        next = updateTurn(next, pid, (t) =>
          t.role === 'user' ? { ...t, text, final: true, ts: now, emotion: t.emotion ?? emotion } : t,
        );
        return { ...next, pendingUserId: null };
      }
      const last = next.turns[next.turns.length - 1];
      if (last && last.role === 'user' && last.final) {
        // Echo of text we typed ourselves — the server may transcribe it back.
        if (last.source === 'text' && norm(last.text) === norm(text) && now - last.ts < 8000) return next;
        // Sentence-level finals for the same utterance: merge into one bubble.
        if (last.source === 'voice' && now - last.ts < 2500) {
          return updateTurn(next, last.id, (t) =>
            t.role === 'user' ? { ...t, text: `${t.text} ${text}`, ts: now } : t,
          );
        }
      }
      const turn: UserTurn = { id: uid('u'), role: 'user', text, final: true, ts: now, source: 'voice', emotion };
      return { ...next, turns: [...next.turns, turn] };
    }

    case 'user_speaking':
      return { ...s, userSpeaking: a.speaking };

    case 'bot_speaking':
      return { ...s, botSpeaking: a.speaking };

    case 'llm_started': {
      const ens = ensureAssistant(s);
      return {
        ...updateTurn(ens.s, ens.id, (t) => (t.role === 'assistant' ? { ...t, streaming: true } : t)),
        llmBusy: true,
      };
    }

    case 'llm_text': {
      if (!a.text) return s;
      const ens = ensureAssistant(s);
      return {
        ...updateTurn(ens.s, ens.id, (t) => {
          if (t.role !== 'assistant') return t;
          const segments = t.segments.slice();
          const last = segments[segments.length - 1];
          if (last && last.kind === 'text') segments[segments.length - 1] = { kind: 'text', text: last.text + a.text };
          else segments.push({ kind: 'text', text: a.text });
          return { ...t, segments, streaming: true };
        }),
        llmBusy: true,
      };
    }

    case 'llm_stopped': {
      const next: State = { ...s, llmBusy: false };
      if (!next.currentAssistantId) return next;
      return updateTurn(next, next.currentAssistantId, (t) =>
        t.role === 'assistant' ? { ...t, streaming: false } : t,
      );
    }

    case 'metrics': {
      const latency: Latency = { ...s.latency };
      for (const m of a.ttfb ?? []) {
        if (!m || typeof m.value !== 'number') continue;
        const name = String(m.processor ?? '').toLowerCase();
        // Pipecat reports TTFB in seconds.
        const ms = m.value >= 1000 ? Math.round(m.value) : Math.round(m.value * 1000);
        if (name.includes('stt')) latency.stt = ms;
        else if (name.includes('llm')) latency.llmTtfb = ms;
        else if (name.includes('tts')) latency.tts = ms;
      }
      return { ...s, latency };
    }

    case 'toast':
      return pushToast(s, a.level, a.text);

    case 'dismiss_toast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };

    case 'set_tab':
      return { ...s, tab: a.tab, tabPinnedAt: a.manual ? Date.now() : s.tabPinnedAt };

    case 'select_file':
      return { ...s, selectedFile: a.path };

    case 'browser_navigate':
      if (s.browserShot) return { ...s, browserShot: null, browserUrl: a.url, browserTitle: undefined, browserNonce: s.browserNonce + 1 };
      return { ...s, browserUrl: a.url, browserTitle: undefined, browserNonce: s.browserNonce + 1 };

    case 'browser_refresh':
      return { ...s, browserNonce: s.browserNonce + 1 };

    case 'clear_terminal':
      return { ...s, terminal: [] };

    case 'local_user_text': {
      const text = a.text.trim();
      if (!text) return s;
      const turn: UserTurn = { id: uid('u'), role: 'user', text, final: true, ts: Date.now(), source: 'text' };
      return { ...s, turns: [...s.turns, turn], currentAssistantId: null, pendingUserId: null };
    }

    case 'set_mock':
      return { ...s, mock: a.mock };

    case 'reset_session':
      return {
        ...initialState,
        mock: s.mock,
        status: s.status,
        tab: s.tab,
      };

    default:
      return s;
  }
}

// ---------------------------------------------------------------- selectors

export function voicePhase(s: State): VoicePhase {
  if (s.connection !== 'connected') return 'idle';
  if (s.botSpeaking) return 'speaking';
  if (s.llmBusy || Object.values(s.tools).some((t) => t.status === 'running')) return 'thinking';
  return 'listening';
}

export function voiceLabel(s: State): string {
  switch (voicePhase(s)) {
    case 'speaking':
      return 'Speaking…';
    case 'thinking':
      return 'Thinking…';
    case 'listening':
      return s.userSpeaking ? 'Hearing you…' : s.micEnabled ? 'Listening…' : 'Mic muted';
    default:
      if (s.connection === 'connecting') return 'Connecting…';
      return 'Tap Connect to start';
  }
}

export function assistantText(t: AssistantTurn): string {
  return t.segments
    .filter((seg): seg is { kind: 'text'; text: string } => seg.kind === 'text')
    .map((seg) => seg.text)
    .join('');
}

export function runningProcesses(s: State): ProcessInfo[] {
  return Object.values(s.processes)
    .filter((p) => p.state === 'started')
    .sort((a, b) => a.ts - b.ts);
}

export function actionCounts(s: State): { total: number; ok: number; failed: number; running: number } {
  let ok = 0;
  let failed = 0;
  let running = 0;
  for (const entry of s.actions) {
    if (entry.kind !== 'tool') {
      ok += 1;
      continue;
    }
    const t = s.tools[entry.id];
    if (!t) continue;
    if (t.status === 'ok') ok += 1;
    else if (t.status === 'failed') failed += 1;
    else running += 1;
  }
  return { total: s.actions.length, ok, failed, running };
}
