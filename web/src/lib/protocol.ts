// Wire protocol between the Sayso web client and the Pipecat server.
// The ServerMessage union below is the fixed backend contract — do not edit.

export type Mood = 'neutral'|'excited'|'happy'|'frustrated'|'confused'|'calm'|'stressed'|'sad';
export type ServerMessage =
 | { type: 'status'; mode: 'live'|'demo'; llm: { provider: string; model: string; models: string[] }; stt: string; tts: 'hume'|'browser'|string; emotion: boolean; workspace: string; voices: { id: string; name: string }[]; voice: string | null; version: string }
 | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; ts: number }
 | { type: 'tool_output'; id: string; stream: 'stdout'|'stderr'; chunk: string }
 | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; result?: unknown; duration_ms: number }
 | { type: 'confirm_request'; id: string; command: string; reason: string }
 | { type: 'confirm_resolved'; id: string; approved: boolean }
 | { type: 'emotion'; top: string; score: number; mood: Mood; emotions: { name: string; score: number }[]; voice_style: string; simulated?: boolean }
 | { type: 'llm_stats'; ttft_ms: number; total_ms: number; tokens: number; tps: number; model: string }
 | { type: 'open_url'; url: string; title?: string }
 | { type: 'file_changed'; path: string; content: string; language: string; action: 'write'|'read' }
 | { type: 'github_event'; kind: 'issue'|'pr'|'repo'; url: string; number?: number; title: string }
 | { type: 'process'; name: string; pid?: number; state: 'started'|'exited'|'stopped'; command: string; port?: number }
 | { type: 'workspace'; tree: string[] }
 | { type: 'notice'; level: 'info'|'warn'|'error'; text: string };

// ---------------------------------------------------------------------------
// Helpers derived from the contract (additive; the union above is untouched).
// ---------------------------------------------------------------------------

export type ServerMessageType = ServerMessage['type'];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

export type StatusMessage = ServerMessageOf<'status'>;
export type EmotionMessage = ServerMessageOf<'emotion'>;
export type LlmStatsMessage = ServerMessageOf<'llm_stats'>;

/** Tool names the server is known to emit in tool_call / tool_result. */
export type ToolName =
  | 'run_shell'
  | 'start_background'
  | 'stop_background'
  | 'write_file'
  | 'read_file'
  | 'list_files'
  | 'open_url'
  | 'fetch_url'
  | 'github_create_issue'
  | 'github_repo_info'
  | 'resolve_confirmation'
  | 'reset_workspace';

/** Client → server custom messages, sent via client.sendClientMessage(type, data). */
export type ClientMessage =
  | { type: 'confirm'; data: { id: string; approved: boolean } }
  | { type: 'set_model'; data: { model: string } }
  | { type: 'set_voice'; data: { voice: string } }
  | { type: 'get_status'; data: Record<string, never> }
  | { type: 'reset_workspace'; data: Record<string, never> }
  | { type: 'stop_all'; data: Record<string, never> };

export type ClientMessageType = ClientMessage['type'];
export type ClientMessageData<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>['data'];

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  'status',
  'tool_call',
  'tool_output',
  'tool_result',
  'confirm_request',
  'confirm_resolved',
  'emotion',
  'llm_stats',
  'open_url',
  'file_changed',
  'github_event',
  'process',
  'workspace',
  'notice',
]);

/** Loose runtime guard for payloads arriving through onServerMessage. */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === 'string' && SERVER_MESSAGE_TYPES.has(t);
}
