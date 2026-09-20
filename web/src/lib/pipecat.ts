// Thin wrapper around the Pipecat JS client. Creates the client lazily on
// connect, binds RTVI callbacks to store actions, and exposes a small API the
// UI can call. The MockSession implements the same interface.

import {
  PipecatClient,
  type BotLLMTextData,
  type DeviceError,
  type Participant,
  type PipecatMetricsData,
  type RTVIMessage,
  type TranscriptData,
  type TransportState,
} from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import type { Action } from './store';
import { isServerMessage, type ClientMessageData, type ClientMessageType } from './protocol';
import { levels, resetLevels } from './levels';
import { normalizeServerUrl } from './settings';

export type Dispatch = (action: Action) => void;

export interface SaysoSession {
  readonly kind: 'pipecat' | 'mock';
  connect(serverUrl: string): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendClientMessage<T extends ClientMessageType>(type: T, data: ClientMessageData<T>): void;
  enableMic(enabled: boolean): void;
}

type ErrorPayload = { error?: string; message?: string; fatal?: boolean };

function unwrapServerMessage(data: unknown): unknown {
  if (isServerMessage(data)) return data;
  if (data && typeof data === 'object' && 'data' in data) {
    const inner = (data as { data?: unknown }).data;
    if (isServerMessage(inner)) return inner;
  }
  return data;
}

function describeError(err: unknown, url: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw || /failed to fetch|networkerror|load failed|ECONNREFUSED/i.test(raw)) {
    return `Can't reach ${url} — is the Sayso server running?`;
  }
  if (/notallowed|permission|denied/i.test(raw)) return 'Microphone permission was denied.';
  return raw;
}

export class PipecatSession implements SaysoSession {
  readonly kind = 'pipecat' as const;
  private client: PipecatClient | null = null;
  private audio: HTMLAudioElement | null = null;
  private generation = 0;

  constructor(private readonly dispatch: Dispatch) {}

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audio = el;
    return el;
  }

  private build(gen: number): PipecatClient {
    const d = this.dispatch;
    // Only forward callbacks from the current client instance.
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (gen === this.generation) fn(...args);
      };

    return new PipecatClient({
      transport: new SmallWebRTCTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onTransportStateChanged: guard((state: TransportState) => d({ type: 'transport_state', state })),
        onConnected: guard(() => d({ type: 'transport_state', state: 'connected' })),
        onDisconnected: guard(() => {
          resetLevels();
          d({ type: 'connection', state: 'idle' });
        }),
        onBotReady: guard(() => d({ type: 'bot_ready' })),
        onBotConnected: guard((_participant: Participant) => undefined),
        onBotDisconnected: guard(() => d({ type: 'toast', level: 'info', text: 'Sayso left the session' })),
        onUserTranscript: guard((t: TranscriptData) =>
          d({ type: 'user_transcript', text: t.text, final: t.final }),
        ),
        onBotLlmStarted: guard(() => d({ type: 'llm_started' })),
        onBotLlmText: guard((t: BotLLMTextData) => d({ type: 'llm_text', text: t.text })),
        onBotLlmStopped: guard(() => d({ type: 'llm_stopped' })),
        onBotTranscript: guard((_t: BotLLMTextData) => undefined), // streaming text comes from onBotLlmText
        onBotTtsText: guard(() => undefined),
        onUserStartedSpeaking: guard(() => d({ type: 'user_speaking', speaking: true })),
        onUserStoppedSpeaking: guard(() => {
          levels.local = 0;
          d({ type: 'user_speaking', speaking: false });
        }),
        onBotStartedSpeaking: guard(() => d({ type: 'bot_speaking', speaking: true })),
        onBotStoppedSpeaking: guard(() => {
          levels.remote = 0;
          d({ type: 'bot_speaking', speaking: false });
        }),
        onLocalAudioLevel: guard((level: number) => {
          levels.local = level;
        }),
        onRemoteAudioLevel: guard((level: number) => {
          levels.remote = level;
        }),
        onMetrics: guard((m: PipecatMetricsData) =>
          d({ type: 'metrics', ttfb: m.ttfb, processing: m.processing }),
        ),
        onServerMessage: guard((data: unknown) => {
          const payload = unwrapServerMessage(data);
          if (isServerMessage(payload)) d({ type: 'server', msg: payload });
        }),
        onTrackStarted: guard((track: MediaStreamTrack, participant?: Participant) => {
          if (participant?.local || track.kind !== 'audio') return;
          const el = this.ensureAudio();
          el.srcObject = new MediaStream([track]);
          void el.play().catch(() => undefined);
        }),
        onError: guard((message: RTVIMessage) => {
          const data = (message?.data ?? {}) as ErrorPayload;
          const text = data.error ?? data.message ?? 'Something went wrong on the server';
          if (data.fatal) {
            d({ type: 'toast', level: 'error', text: text.slice(0, 160) });
            d({ type: 'connection', state: 'error', error: text });
            return;
          }
          // Non-fatal provider hiccups (a rate-limited TTS sentence, an STT reconnect) are
          // handled by the server's failover; keep them out of the user's face.
          console.warn('[sayso] server reported a recoverable error:', text.slice(0, 300));
        }),
        onDeviceError: guard((err: DeviceError) =>
          d({ type: 'toast', level: 'error', text: `Microphone: ${err.message || err.type}` }),
        ),
      },
    });
  }

  private async teardown(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.generation += 1;
    resetLevels();
    if (this.audio) this.audio.srcObject = null;
    if (client) {
      // A dead peer (e.g. the server restarted) can make disconnect() hang on ICE
      // teardown; never let that block a fresh connect.
      await Promise.race([
        client.disconnect().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
  }

  async connect(serverUrl: string): Promise<void> {
    const url = normalizeServerUrl(serverUrl);
    await this.teardown();
    this.generation += 1;
    const gen = this.generation;
    const client = this.build(gen);
    this.client = client;
    this.dispatch({ type: 'connection', state: 'connecting' });
    try {
      // Same POST to `${url}/api/offer` as the legacy `webrtcUrl` option, without the deprecation warning.
      await client.connect({ webrtcRequestParams: { endpoint: `${url}/api/offer` } });
      if (gen !== this.generation) return;
      this.dispatch({ type: 'connection', state: 'connected' });
      this.dispatch({ type: 'mic', enabled: client.isMicEnabled });
      try {
        client.sendClientMessage('get_status', {});
      } catch {
        // status will arrive on its own
      }
    } catch (err) {
      if (gen !== this.generation) return;
      const text = describeError(err, url);
      this.dispatch({ type: 'connection', state: 'error', error: text });
      this.dispatch({ type: 'toast', level: 'error', text });
      await this.teardown();
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      this.dispatch({ type: 'connection', state: 'idle' });
      return;
    }
    this.dispatch({ type: 'connection', state: 'disconnecting' });
    await this.teardown();
    this.dispatch({ type: 'connection', state: 'idle' });
  }

  async sendText(text: string): Promise<void> {
    const client = this.client;
    if (!client || !client.connected) {
      this.dispatch({ type: 'toast', level: 'warn', text: 'Connect first — then type or talk.' });
      return;
    }
    try {
      await client.sendText(text, { run_immediately: true, audio_response: true });
    } catch (err) {
      this.dispatch({ type: 'toast', level: 'error', text: describeError(err, '') });
    }
  }

  sendClientMessage<T extends ClientMessageType>(type: T, data: ClientMessageData<T>): void {
    const client = this.client;
    if (!client) return;
    try {
      client.sendClientMessage(type, data);
    } catch (err) {
      this.dispatch({ type: 'toast', level: 'error', text: describeError(err, '') });
    }
  }

  enableMic(enabled: boolean): void {
    try {
      this.client?.enableMic(enabled);
    } catch {
      // transport not ready
    }
    if (!enabled) levels.local = 0;
    this.dispatch({ type: 'mic', enabled });
  }
}
