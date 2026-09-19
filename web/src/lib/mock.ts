// Scripted session for screenshots and demos without a server (?mock=1).
// Dispatches the exact same events the Pipecat bridge would, with realistic
// delays, through the same reducer.

import type { ServerMessage, StatusMessage, ClientMessageData, ClientMessageType, Mood } from './protocol';
import type { Dispatch, SaysoSession } from './pipecat';
import { levels, resetLevels } from './levels';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (base: number, spread = 0.35) => Math.round(base * (1 - spread / 2 + Math.random() * spread));

class Cancelled extends Error {
  constructor() {
    super('mock cancelled');
  }
}

const CLOCK_V1 = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>pulse</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #0b0b0f; color: #f4f4f5; font-family: system-ui, sans-serif; }
    #clock { font-size: 24px; letter-spacing: .04em; }
  </style>
</head>
<body>
  <div id="clock">--:--:--</div>
  <script>
    const el = document.getElementById('clock');
    const tick = () => { el.textContent = new Date().toLocaleTimeString(); };
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>
`;

const CLOCK_V2 = CLOCK_V1.replace(
  '#clock { font-size: 24px; letter-spacing: .04em; }',
  `#clock {
      font-size: clamp(64px, 18vw, 220px);
      font-weight: 700;
      letter-spacing: .02em;
      color: #c8ff3d;
      text-shadow: 0 0 12px #c8ff3d, 0 0 48px rgba(200,255,61,.6), 0 0 120px rgba(200,255,61,.35);
    }`,
);

const CLOCK_V3 = CLOCK_V2.replace('<title>pulse</title>', '<title>Pulse</title>');

const FAILING_TEST = `F
======================================================================
FAIL: test_title (__main__.PulseTests.test_title)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/Users/you/sayso/workspace/test_app.py", line 14, in test_title
    self.assertIn("<title>Pulse</title>", html)
AssertionError: '<title>Pulse</title>' not found in '<!doctype html>\\n<html lang="en">\\n<head>\\n  <meta charset="utf-8">\\n  <title>pulse</title>…'

----------------------------------------------------------------------
Ran 1 test in 0.004s

FAILED (failures=1)
`;

const PASSING_TEST = `.
----------------------------------------------------------------------
Ran 1 test in 0.003s

OK
`;

const CANNED_REPLIES = [
  'On it. This is the mock session, so I am only nodding along — connect to a live Sayso server and I will actually run that.',
  'Got it. In a live session I would run that in your terminal right now; in mock mode I just listen.',
  'Sure thing. Mock mode means no real commands run — flip to a live server and say it again.',
];

export class MockSession implements SaysoSession {
  readonly kind = 'mock' as const;
  private run = 0;
  private toolSeq = 0;
  private pendingConfirm: { id: string; resolve: (approved: boolean) => void } | null = null;
  private running = new Map<string, { pid: number; port?: number; command: string }>();
  private tree: string[] = ['README.md', 'test_app.py', 'build/', 'build/old-bundle.js'];
  private status: StatusMessage = {
    type: 'status',
    mode: 'live',
    llm: {
      provider: 'SambaNova',
      model: 'Meta-Llama-3.3-70B-Instruct',
      models: [
        'Meta-Llama-3.3-70B-Instruct',
        'Meta-Llama-3.1-8B-Instruct',
        'Llama-4-Maverick-17B-128E-Instruct',
        'DeepSeek-R1-Distill-Llama-70B',
      ],
    },
    stt: 'Gradium',
    tts: 'hume',
    emotion: true,
    workspace: '~/sayso/workspace',
    voices: [
      { id: 'ava', name: 'Ava Song' },
      { id: 'kora', name: 'Kora' },
      { id: 'colton', name: 'Colton Rivers' },
    ],
    voice: 'ava',
    version: '0.1.0-mock',
  };

  constructor(
    private readonly dispatch: Dispatch,
    private readonly options: { instant?: boolean } = {},
  ) {}

  /** Instant mode: every delay collapses so the whole script lands in one render. */
  private get instant(): boolean {
    return this.options.instant === true;
  }

  // ------------------------------------------------------------ session API

  async connect(): Promise<void> {
    this.run += 1;
    const run = this.run;
    this.pendingConfirm = null;
    this.running.clear();
    resetLevels();
    this.dispatch({ type: 'reset_session' });
    this.dispatch({ type: 'set_mock', mock: true });
    this.dispatch({ type: 'connection', state: 'connecting' });
    try {
      await this.wait(run, 700);
      this.dispatch({ type: 'connection', state: 'connected' });
      this.dispatch({ type: 'bot_ready' });
      this.server({ ...this.status });
      this.server({ type: 'workspace', tree: [...this.tree] });
      this.server({ type: 'notice', level: 'info', text: 'Mock session — scripted events, no server needed.' });
      await this.script(run);
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.run += 1;
    this.pendingConfirm = null;
    resetLevels();
    this.dispatch({ type: 'connection', state: 'idle' });
  }

  async sendText(text: string): Promise<void> {
    const run = this.run;
    if (!this.alive(run)) return;
    const reply = CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)];
    try {
      await this.wait(run, 350);
      await this.assistantSays(run, reply, { ttft: 190 + Math.round(Math.random() * 80), tps: 600 + Math.round(Math.random() * 90) });
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
    void text;
  }

  sendClientMessage<T extends ClientMessageType>(type: T, data: ClientMessageData<T>): void {
    switch (type) {
      case 'confirm': {
        const d = data as ClientMessageData<'confirm'>;
        if (this.pendingConfirm && this.pendingConfirm.id === d.id) this.pendingConfirm.resolve(d.approved);
        return;
      }
      case 'get_status':
        this.server({ ...this.status });
        return;
      case 'set_model': {
        const d = data as ClientMessageData<'set_model'>;
        this.status = { ...this.status, llm: { ...this.status.llm, model: d.model } };
        this.server({ ...this.status });
        this.server({ type: 'notice', level: 'info', text: `Model switched to ${d.model}` });
        return;
      }
      case 'set_voice': {
        const d = data as ClientMessageData<'set_voice'>;
        this.status = { ...this.status, voice: d.voice };
        this.server({ ...this.status });
        const name = this.status.voices.find((v) => v.id === d.voice)?.name ?? d.voice;
        this.server({ type: 'notice', level: 'info', text: `Voice switched to ${name}` });
        return;
      }
      case 'stop_all': {
        for (const [name, p] of this.running) {
          this.server({ type: 'process', name, pid: p.pid, state: 'stopped', command: p.command, port: p.port });
        }
        const n = this.running.size;
        this.running.clear();
        this.server({ type: 'notice', level: 'info', text: n ? `Stopped ${n} background process${n === 1 ? '' : 'es'}` : 'Nothing running' });
        return;
      }
      case 'reset_workspace': {
        this.tree = ['README.md', 'test_app.py'];
        this.server({ type: 'workspace', tree: [...this.tree] });
        this.server({ type: 'notice', level: 'info', text: 'Workspace reset' });
        return;
      }
      default:
        return;
    }
  }

  enableMic(enabled: boolean): void {
    if (!enabled) levels.local = 0;
    this.dispatch({ type: 'mic', enabled });
  }

  // ------------------------------------------------------------ primitives

  private alive(run: number): boolean {
    return run === this.run;
  }

  private check(run: number): void {
    if (!this.alive(run)) throw new Cancelled();
  }

  private async wait(run: number, ms: number): Promise<void> {
    if (!this.instant) await sleep(ms);
    this.check(run);
  }

  private server(msg: ServerMessage): void {
    this.dispatch({ type: 'server', msg });
  }

  private async pulseLevels(run: number, key: 'local' | 'remote', ms: number): Promise<void> {
    if (this.instant) {
      levels[key] = 0;
      return;
    }
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = performance.now() - start;
        if (t >= ms || !this.alive(run)) {
          clearInterval(timer);
          levels[key] = 0;
          resolve();
          return;
        }
        const wave = Math.abs(Math.sin(t / 170)) * 0.7 + Math.abs(Math.sin(t / 57)) * 0.3;
        levels[key] = 0.15 + wave * (0.55 + Math.random() * 0.3);
      }, 50);
    });
  }

  private async userSays(run: number, text: string): Promise<void> {
    this.check(run);
    this.dispatch({ type: 'user_speaking', speaking: true });
    const words = text.split(' ');
    const perWord = 105;
    const pulse = this.pulseLevels(run, 'local', words.length * perWord + 250);
    for (let i = 0; i < words.length; i += 1) {
      await this.wait(run, jitter(perWord, 0.5));
      this.dispatch({ type: 'user_transcript', text: words.slice(0, i + 1).join(' '), final: false });
    }
    await this.wait(run, 260);
    this.dispatch({ type: 'user_speaking', speaking: false });
    this.dispatch({ type: 'user_transcript', text, final: true });
    this.dispatch({
      type: 'metrics',
      ttfb: [{ processor: 'GradiumSTTService#0', value: 0.12 + Math.random() * 0.07 }],
    });
    await pulse;
  }

  private emotion(
    top: string,
    score: number,
    mood: Mood,
    voiceStyle: string,
    others: [string, number][],
  ): void {
    this.server({
      type: 'emotion',
      top,
      score,
      mood,
      emotions: [[top, score] as [string, number], ...others].map(([name, s]) => ({ name, score: s })),
      voice_style: voiceStyle,
    });
  }

  private async assistantSays(run: number, text: string, opts: { ttft?: number; tps?: number } = {}): Promise<void> {
    this.check(run);
    const ttft = opts.ttft ?? 212;
    const tps = opts.tps ?? 641;
    this.dispatch({ type: 'llm_started' });
    await this.wait(run, ttft);
    this.dispatch({ type: 'metrics', ttfb: [{ processor: 'SambaNovaLLMService#0', value: ttft / 1000 }] });
    const words = text.split(' ');
    const started = performance.now();
    for (let i = 0; i < words.length; i += 1) {
      this.dispatch({ type: 'llm_text', text: (i ? ' ' : '') + words[i] });
      await this.wait(run, jitter(42, 0.6));
    }
    const total = Math.round(performance.now() - started) + ttft;
    this.dispatch({ type: 'llm_stopped' });
    this.server({
      type: 'llm_stats',
      ttft_ms: ttft,
      total_ms: total,
      tokens: Math.max(4, Math.round(text.length / 3.6)),
      tps,
      model: this.status.llm.model,
    });
    // Speak it.
    await this.wait(run, 120);
    this.dispatch({ type: 'metrics', ttfb: [{ processor: 'HumeTTSService#0', value: 0.08 + Math.random() * 0.05 }] });
    this.dispatch({ type: 'bot_speaking', speaking: true });
    const speakMs = Math.min(3200, Math.max(1100, text.length * 38));
    await this.pulseLevels(run, 'remote', speakMs);
    this.check(run);
    this.dispatch({ type: 'bot_speaking', speaking: false });
  }

  private async tool(
    run: number,
    name: string,
    args: Record<string, unknown>,
    body: (id: string) => Promise<{ ok: boolean; summary: string; result?: unknown }>,
    durationMs: number,
  ): Promise<string> {
    this.check(run);
    this.toolSeq += 1;
    const id = `mock_tool_${this.toolSeq}`;
    this.server({ type: 'tool_call', id, name, args, ts: Date.now() });
    const started = performance.now();
    const outcome = await body(id);
    const elapsed = performance.now() - started;
    if (elapsed < durationMs) await this.wait(run, durationMs - elapsed);
    this.server({
      type: 'tool_result',
      id,
      name,
      ok: outcome.ok,
      summary: outcome.summary,
      result: outcome.result,
      duration_ms: jitter(durationMs, 0.2),
    });
    return id;
  }

  private writeFile(path: string, content: string): void {
    this.server({ type: 'file_changed', path, content, language: 'html', action: 'write' });
    if (!this.tree.includes(path)) {
      this.tree = [...this.tree, path].sort();
      this.server({ type: 'workspace', tree: [...this.tree] });
    }
  }

  // ------------------------------------------------------------ the script

  private async script(run: number): Promise<void> {
    await this.wait(run, 900);

    // 1. Build the app
    await this.userSays(run, 'Create a web app called pulse with a live clock and run it on port 8000');
    await this.wait(run, 180);
    this.emotion('Interest', 0.41, 'neutral', 'neutral, attentive', [
      ['Concentration', 0.33],
      ['Calmness', 0.29],
    ]);
    await this.assistantSays(run, 'On it. Scaffolding pulse and starting it on port eight thousand.', { ttft: 212, tps: 641 });

    await this.tool(run, 'write_file', { path: 'pulse/index.html', bytes: CLOCK_V1.length }, async () => {
      await this.wait(run, 120);
      this.writeFile('pulse/index.html', CLOCK_V1);
      return { ok: true, summary: `Wrote pulse/index.html (${CLOCK_V1.length} bytes)` };
    }, 18);

    await this.wait(run, 300);
    const serverCmd = 'python3 -m http.server 8000 --directory pulse';
    await this.tool(run, 'start_background', { name: 'pulse', command: serverCmd, port: 8000 }, async (id) => {
      await this.wait(run, 420);
      this.server({ type: 'tool_output', id, stream: 'stdout', chunk: 'Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...\n' });
      await this.wait(run, 200);
      this.running.set('pulse', { pid: 48213, port: 8000, command: serverCmd });
      this.server({ type: 'process', name: 'pulse', pid: 48213, state: 'started', command: serverCmd, port: 8000 });
      return { ok: true, summary: 'Started pulse (pid 48213) on :8000', result: { pid: 48213, port: 8000 } };
    }, 640);

    await this.wait(run, 250);
    await this.assistantSays(run, 'Pulse is live on port 8000. Want me to open it?', { ttft: 198, tps: 655 });

    // 2. Open it
    await this.wait(run, 700);
    await this.userSays(run, 'Open it in the browser');
    await this.wait(run, 200);
    await this.assistantSays(run, 'Opening it now.', { ttft: 175, tps: 662 });
    await this.tool(run, 'open_url', { url: 'http://localhost:8000' }, async () => {
      await this.wait(run, 160);
      this.server({ type: 'open_url', url: 'http://localhost:8000', title: 'Pulse' });
      return { ok: true, summary: 'Opened http://localhost:8000' };
    }, 210);

    // 3. Frustration → reassurance
    await this.wait(run, 1400);
    await this.userSays(run, 'Ugh, the clock is tiny, make it huge and neon');
    await this.wait(run, 150);
    this.emotion('Frustration', 0.62, 'frustrated', 'calm, warm, reassuring', [
      ['Annoyance', 0.41],
      ['Disappointment', 0.22],
    ]);
    await this.assistantSays(run, 'Sorry about that — making it big and neon now.', { ttft: 205, tps: 648 });
    await this.tool(run, 'write_file', { path: 'pulse/index.html', bytes: CLOCK_V2.length }, async () => {
      await this.wait(run, 140);
      this.writeFile('pulse/index.html', CLOCK_V2);
      return { ok: true, summary: `Wrote pulse/index.html (${CLOCK_V2.length} bytes)` };
    }, 21);
    await this.wait(run, 200);
    await this.assistantSays(run, 'Done. It is big, neon, and impossible to miss.', { ttft: 188, tps: 659 });

    // 4. Tests fail
    await this.wait(run, 900);
    await this.userSays(run, 'Run the tests');
    await this.wait(run, 200);
    await this.assistantSays(run, 'Running the tests.', { ttft: 171, tps: 670 });
    await this.tool(run, 'run_shell', { command: 'python3 test_app.py' }, async (id) => {
      await this.wait(run, 380);
      const lines = FAILING_TEST.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const isLast = i === lines.length - 1;
        this.server({ type: 'tool_output', id, stream: 'stderr', chunk: lines[i] + (isLast ? '' : '\n') });
        await this.wait(run, i < 3 ? 140 : 45);
      }
      return { ok: false, summary: '1 test failed', result: { exit_code: 1 } };
    }, 1180);
    await this.wait(run, 250);
    await this.assistantSays(run, "One test failed: it expected the title 'Pulse'. Want me to fix it?", { ttft: 224, tps: 633 });

    // 5. Fix it
    await this.wait(run, 700);
    await this.userSays(run, 'Fix it');
    await this.wait(run, 200);
    await this.assistantSays(run, 'Fixing the title and re-running.', { ttft: 182, tps: 664 });
    await this.tool(run, 'write_file', { path: 'pulse/index.html', bytes: CLOCK_V3.length }, async () => {
      await this.wait(run, 120);
      this.writeFile('pulse/index.html', CLOCK_V3);
      return { ok: true, summary: `Wrote pulse/index.html (${CLOCK_V3.length} bytes)` };
    }, 17);
    await this.wait(run, 200);
    await this.tool(run, 'run_shell', { command: 'python3 test_app.py' }, async (id) => {
      await this.wait(run, 420);
      const lines = PASSING_TEST.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const isLast = i === lines.length - 1;
        this.server({ type: 'tool_output', id, stream: 'stdout', chunk: lines[i] + (isLast ? '' : '\n') });
        await this.wait(run, 70);
      }
      return { ok: true, summary: 'All tests passed', result: { exit_code: 0 } };
    }, 940);
    await this.wait(run, 200);
    this.emotion('Excitement', 0.71, 'excited', 'upbeat, bright', [
      ['Joy', 0.44],
      ['Satisfaction', 0.39],
    ]);
    await this.assistantSays(run, 'All green.', { ttft: 168, tps: 672 });

    // 6. GitHub issue
    await this.wait(run, 900);
    await this.userSays(run, 'File a GitHub issue to add dark mode');
    await this.wait(run, 200);
    await this.assistantSays(run, 'Filing it on vnmoorthy slash sayso.', { ttft: 201, tps: 650 });
    await this.tool(
      run,
      'github_create_issue',
      { repo: 'vnmoorthy/sayso', title: 'Add dark mode', body: 'Requested by voice via Sayso: add a dark theme toggle to Pulse.' },
      async () => {
        await this.wait(run, 620);
        this.server({ type: 'github_event', kind: 'issue', url: 'https://github.com/vnmoorthy/sayso/issues/4', number: 4, title: 'Add dark mode' });
        return { ok: true, summary: 'Created issue #4', result: { number: 4, url: 'https://github.com/vnmoorthy/sayso/issues/4' } };
      },
      830,
    );
    await this.wait(run, 200);
    await this.assistantSays(run, 'Opened issue number four.', { ttft: 179, tps: 661 });

    // 7. Destructive command → confirmation
    await this.wait(run, 900);
    await this.userSays(run, 'Delete the build folder');
    await this.wait(run, 220);
    await this.assistantSays(run, 'That one is destructive — I need your say-so.', { ttft: 193, tps: 655 });
    const confirmId = 'c1';
    this.server({ type: 'confirm_request', id: confirmId, command: 'rm -rf build', reason: 'destructive: recursive delete' });
    const approved = await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean) => {
        if (settled) return;
        settled = true;
        this.pendingConfirm = null;
        resolve(v);
      };
      this.pendingConfirm = { id: confirmId, resolve: settle };
      if (this.instant) settle(true);
      else setTimeout(() => settle(true), 6000);
    });
    this.check(run);
    this.server({ type: 'confirm_resolved', id: confirmId, approved });
    if (!approved) {
      await this.wait(run, 200);
      await this.assistantSays(run, 'Okay, leaving the build folder alone.', { ttft: 176, tps: 660 });
      return;
    }
    await this.wait(run, 200);
    await this.tool(run, 'run_shell', { command: 'rm -rf build' }, async () => {
      await this.wait(run, 90);
      this.tree = this.tree.filter((p) => !p.startsWith('build'));
      this.server({ type: 'workspace', tree: [...this.tree] });
      return { ok: true, summary: 'Removed build/', result: { exit_code: 0 } };
    }, 12);
    await this.wait(run, 200);
    await this.assistantSays(run, 'Gone.', { ttft: 164, tps: 668 });
  }
}
