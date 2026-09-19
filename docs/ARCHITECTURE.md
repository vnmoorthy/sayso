# Sayso architecture

How one spoken sentence becomes a running dev server, a rewritten file or a GitHub issue, and how the UI keeps up while it happens.

![Architecture](assets/architecture.png)

Contents: [Pipeline](#pipeline) · [Provider selection](#provider-selection) · [RTVI event contract](#rtvi-event-contract) · [Emotion loop](#the-emotion-loop) · [Toolbox](#the-toolbox) · [Confirmation state machine](#the-confirmation-state-machine) · [Stats](#llm-stats) · [Demo brain](#the-demo-brain) · [Swapping providers](#swapping-providers)

## Pipeline

`server/bot.py` builds a single Pipecat `Pipeline` per connected client. The processor list, in order:

| # | Processor | Module | Role |
| --- | --- | --- | --- |
| 1 | `transport.input()` | Pipecat SmallWebRTC | Receives 16 kHz mono PCM from the browser as `InputAudioRawFrame`s. |
| 2 | `RTVIProcessor` | Pipecat RTVI | Bridges the RTVI protocol: client-ready handshake, client messages, and the channel every custom server message rides on. |
| 3 | `HumeEmotionProcessor` | `sayso/emotion.py` | Buffers the utterance between `UserStartedSpeakingFrame` and `UserStoppedSpeakingFrame`, scores prosody with Hume, emits `emotion`, retunes TTS, drops a tone note into the context. Passes every frame through untouched. |
| 4 | STT service | Pipecat Gradium / Deepgram / Whisper | Turns audio into `TranscriptionFrame`s. |
| 5 | `user_aggregator` | Pipecat `LLMContextAggregatorPair` | Owns the `LLMContext` (system prompt + tool schema), decides when the user's turn is over (Silero VAD via `LLMUserAggregatorParams`, smart-turn v3 end-of-turn prediction), and appends the transcript. |
| 6 | LLM service | Pipecat SambaNova / OpenAI-compatible | Streams text and function calls. Tool handlers registered by `Toolbox.register()` run here. |
| 7 | `LLMStatsProcessor` | `sayso/stats.py` | Measures TTFT, tokens and tokens/sec per response and emits `llm_stats`. |
| 8 | TTS service (optional) | Pipecat Hume | Hume Octave; omitted entirely when there is no Hume key, in which case the browser speaks completed assistant turns. |
| 9 | `transport.output()` | Pipecat SmallWebRTC | Sends synthesized audio back to the browser. |
| 10 | `assistant_aggregator` | Pipecat | Appends the spoken reply to the context so the next turn has it. |

The `PipelineTask` runs with `enable_metrics=True, enable_usage_metrics=True` and an `RTVIObserver`, which is what turns transcripts, bot speaking state and metrics into standard RTVI events for the client library. Custom Sayso events go through `sayso/bus.py`: `emit(dict)` calls `rtvi.send_server_message(...)`; messages emitted while no client is attached are dropped.

Lifecycle: on `on_client_connected` the greeting instruction is added to the context and an `LLMRunFrame` is queued, so the agent speaks first. On `on_client_ready` the server sends a `status` message. On `on_client_disconnected` every background process is stopped and the task is cancelled.

## Provider selection

`sayso/config.py` resolves everything from environment variables once at startup, with graceful fallbacks so the pipeline always comes up:

| Concern | Resolution order |
| --- | --- |
| LLM | `SAYSO_LLM_PROVIDER` if set; else the first of `SAMBANOVA_API_KEY` → `GENERAL_COMPUTE_API_KEY` → `OPENAI_API_KEY` that exists; else the local demo brain (`http://127.0.0.1:7861/v1`). SambaNova uses `pipecat.services.sambanova.llm.SambaNovaLLMService`; the others use `OpenAILLMService` with a `base_url`. |
| Model | `SAYSO_MODEL`, else the provider's first entry: `Meta-Llama-3.3-70B-Instruct` (SambaNova), `gemma-4-31B-it` (General Compute), `gpt-4.1-mini` (OpenAI), `sayso-demo-brain` (demo). The UI's model list comes from the same tables. |
| STT | `SAYSO_STT_PROVIDER` if set; else Gradium if `GRADIUM_API_KEY`; else Deepgram if `DEEPGRAM_API_KEY`; else `whisper-mlx` on Apple Silicon (`whisper-large-v3-turbo-q4`); else faster-whisper (`distil-medium.en`). `SAYSO_WHISPER_MODEL` overrides the local model. |
| TTS | Hume if `HUME_API_KEY`, else `browser`. The voice id is `HUME_VOICE_ID`, else looked up by `HUME_VOICE_NAME` (default "Ava Song") in Hume's voice library at startup; the first 40 library voices are sent to the UI for the voice picker. |
| Emotion | Enabled when a Hume key exists and `SAYSO_EMOTION != 0`. `SAYSO_FAKE_EMOTION=1` enables a loudness-based simulator only when there is no key. |
| Mode | `demo` when the LLM provider is the demo brain, otherwise `live`. Shown in the UI. |

Every settings dataclass field has a matching env var; see `server/.env.example`.

## RTVI event contract

Custom server → client messages are plain JSON objects with a `type` field, delivered through RTVI's server-message channel and typed in `web/src/lib/protocol.ts` as the `ServerMessage` union. That file is the contract: server and web changes ship together.

| `type` | Fields | Emitted by | UI |
| --- | --- | --- | --- |
| `status` | `mode: 'live'\|'demo'`, `llm: { provider, model, models[] }`, `stt`, `tts: 'hume'\|'browser'`, `emotion: boolean`, `workspace`, `voices: {id,name}[]`, `voice`, `version`; also `processes[]` and `github_repo` today | `bot.py` on client ready, `get_status`, model/voice change | Header, Settings, process list |
| `tool_call` | `id`, `name`, `args`, `ts` | `Toolbox._wrap` before every handler | Actions rail card (pending) |
| `tool_output` | `id`, `stream: 'stdout'\|'stderr'`, `chunk` | `run_shell` and background process pumps, one line at a time | Terminal tab, streamed |
| `tool_result` | `id`, `name`, `ok`, `summary`, `result?`, `duration_ms` | `Toolbox._wrap` after every handler | Actions rail card (done / failed) |
| `confirm_request` | `id`, `command`, `reason` | `Toolbox._request_confirmation` | Say-so card |
| `confirm_resolved` | `id`, `approved` | `Toolbox.resolve_confirmation` | Say-so card closes |
| `emotion` | `top`, `score`, `mood`, `emotions: {name,score}[]` (top 6), `voice_style`, `simulated?`; also `latency_ms` | `HumeEmotionProcessor` | Orb hue, transcript badge, voice-style chip |
| `llm_stats` | `ttft_ms`, `total_ms`, `tokens`, `tps`, `model`; also `estimated` (true when tokens were approximated from characters) | `LLMStatsProcessor` | Latency HUD |
| `open_url` | `url`, `title?` | `open_url` tool | Workbench → Browser tab |
| `file_changed` | `path`, `content` (≤ 20 000 chars), `language`, `action: 'write'\|'read'` | `write_file`, `read_file` | Workbench → Files tab |
| `github_event` | `kind: 'issue'\|'pr'\|'repo'`, `url`, `number?`, `title` | `github_create_issue`, `github_repo_info` | GitHub card with link |
| `process` | `name`, `pid?`, `state: 'started'\|'exited'\|'stopped'`, `command`, `port?` | `ProcessManager` | Process chips, "open it" affordance |
| `workspace` | `tree: string[]` | `list_files`, `reset_workspace` | Files tab tree |
| `notice` | `level: 'info'\|'warn'\|'error'`, `text` | anywhere | Toast |

Client → server messages (`client.sendClientMessage(type, data)`), handled in `bot.py`'s `on_client_message`:

| `type` | `data` | Effect |
| --- | --- | --- |
| `confirm` | `{ id, approved }` | Resolves a pending say-so from the UI (see state machine below). |
| `set_model` | `{ model }` | Pushes `LLMUpdateSettingsFrame`, updates the reported model, re-sends `status`. |
| `set_voice` | `{ voice }` | Pushes `TTSUpdateSettingsFrame(voice=…)`, re-sends `status`. |
| `get_status` | `{}` | Re-sends `status`. |
| `stop_all` | `{}` | Stops every background process. |
| `reset_workspace` | `{}` | Wipes `workspace/` immediately (the UI asks first; the voice path goes through the say-so gate). |

Standard RTVI events (user/bot transcripts, bot started/stopped speaking, metrics) are produced by `RTVIObserver` and consumed via `@pipecat-ai/client-js` callbacks as usual.

## The emotion loop

`sayso/emotion.py` is a `FrameProcessor` placed *before* STT so it sees raw audio and the VAD's speaking frames.

1. **Buffer.** On `UserStartedSpeakingFrame` the buffer is cleared and recording starts. Each `InputAudioRawFrame` is appended; the buffer is capped at the last 5 s (`MAX_SECONDS`, Hume's per-message limit for streaming audio). Utterances shorter than 0.45 s are ignored.
2. **Score.** On `UserStoppedSpeakingFrame` the PCM is wrapped as WAV and sent as one base64 message to `wss://api.hume.ai/v0/stream/models` with `{"models": {"prosody": {}}}`. Predictions are averaged per emotion name over any returned segments. An in-flight request is cancelled if the user speaks again first, so scoring never delays the turn.
3. **Collapse.** `mood_from_emotions()` sums scores inside seven groups (`frustrated`, `stressed`, `confused`, `excited`, `happy`, `calm`, `sad`); the best group wins unless its total is below 0.12, which yields `neutral`. Eight moods total.
4. **Emit.** An `emotion` message goes to the UI with the top emotion, the top 6 scores, the mood and its `voice_style`.
5. **Retune the voice.** If the mood changed since the last utterance, a `TTSUpdateSettingsFrame(delta=HumeTTSService.Settings(description=style))` is pushed downstream so Octave's acting instructions change for the very next reply. The styles:

   | Mood | Acting instructions |
   | --- | --- |
   | neutral | confident, friendly, crisp |
   | calm | calm, steady, warm |
   | excited | upbeat, bright, energetic |
   | happy | warm, cheerful, light |
   | frustrated | calm, warm, reassuring, unhurried |
   | stressed | gentle, grounded, reassuring |
   | confused | patient, clear, gently pedagogical |
   | sad | soft, gentle, empathetic |

6. **Retune the words.** An `LLMMessagesAppendFrame` with `run_llm=False` appends a system note such as `[User tone: frustrated (0.62); top emotions: Annoyance 0.41, …. Adapt your tone; do not mention this note.]`. The system prompt tells the model how to use it (calmer when frustrated or stressed, brighter when excited, step-by-step when confused). `run_llm=False` matters: the note must ride along with the transcript, not trigger a turn of its own.

With `SAYSO_FAKE_EMOTION=1` and no key, `_fake_emotions()` derives a plausible top-3 from loudness and duration; those messages carry `simulated: true` and the UI labels them.

## The toolbox

`sayso/tools.py` holds every tool as an async method on `Toolbox`, the JSON schemas the model sees (`FunctionSchema` → `ToolsSchema`), and a `ProcessManager` for long-running commands.

`Toolbox.register(llm)` wraps each handler: the wrapper emits `tool_call`, calls the method with `tool_id` plus the model's arguments (unknown keys are dropped), converts exceptions into `{"ok": false, "error": …}`, emits `tool_result` with the duration, and returns a trimmed result (strings clipped to 1 500 chars) to the model via `params.result_callback`. Handlers are registered with `cancel_on_interruption=False` so a user barging in cannot orphan a half-written file.

| Tool | Behaviour |
| --- | --- |
| `run_shell(command, timeout_s?)` | Classified first (below). Runs under `/bin/bash` with `cwd=workspace/`, its own session, `TERM=dumb`/`NO_COLOR=1`; stdout and stderr are read line by line and each line is emitted as `tool_output`. Killed (whole process group) after `SAYSO_SHELL_TIMEOUT`. |
| `start_background(command, name, port?)` | Classified first. Spawns via `ProcessManager.start`, guesses the port from `--port`, `:PORT`, `http.server PORT` or any 4–5 digit number, replaces anything already running under the same name or port, emits `process` (`started`), streams its output as `tool_output` (keeping a 40-line tail) and waits 1.2 s to catch an immediate crash. Returns `http://localhost:PORT` so the model can offer to open it; `process` (`exited`, with `exit_code`) follows whenever it ends. |
| `stop_background(name)` | Terminates the named process; emits `process` (`stopped`). All processes are stopped on disconnect and on `stop_all`. |
| `write_file(path, content)` | Resolves inside the workspace (raises `PermissionError` otherwise), creates parents, writes UTF-8, emits `file_changed` (`write`). |
| `read_file(path)` | Emits `file_changed` (`read`) so the Files tab shows it; returns clipped content. |
| `list_files(path='.')` | Recursive listing (skips `node_modules`, `.venv`, `.git`, …, depth ≤ 4, ≤ 200 entries); emits `workspace`. |
| `open_url(url, title?)` | Emits `open_url` for the in-app browser panel; also opens the system browser if `SAYSO_OPEN_SYSTEM_BROWSER=1`. |
| `fetch_url(url)` | `httpx` GET, strips tags/scripts, returns up to 4 000 chars of readable text. |
| `github_create_issue(title, body?, repo?)` | `gh issue create -R owner/name …`; repo from the argument, `SAYSO_GITHUB_REPO`, or `gh repo view` in the workspace. Emits `github_event` (`issue`) with the real URL and number. |
| `github_repo_info(repo?)` | `gh repo view --json …`; emits `github_event` (`repo`). |
| `resolve_confirmation(id, approved)` | See below. |
| `reset_workspace()` | Always held: requests confirmation with `kind="reset"`; on approval stops processes and deletes everything but `.gitkeep`. |

## The confirmation state machine

Sayso's safety gate lives in `classify_command()` plus a small pending-confirmations map.

```
                 classify_command(cmd) → None                 run immediately
  run_shell ─────────────────────────────────────────────────▶ stream output ─▶ tool_result
  start_background                                                    ▲
      │                                                               │
      │ classify_command(cmd) → reason                                │ approved
      ▼                                                               │
  PENDING  pending[cid] = {command, reason, kind}                     │
      │    emit confirm_request{id, command, reason}                  │
      │    return {awaiting_confirmation, confirmation_id, …}         │
      │    (model tells the user, asks for a yes)                     │
      │                                                               │
      ├── voice: user says "yes"/"no" → model calls                   │
      │        resolve_confirmation(id, approved) ─────┐              │
      │                                                ├─▶ pop pending[id]
      └── click: UI sends client message               │   emit confirm_resolved{id, approved}
               confirm{id, approved} → bot.py calls    │   approved ─▶ run by kind ───────────┘
               toolbox.resolve_confirmation("ui_"+id)──┘   denied   ─▶ {"summary": "denied — nothing was run"}
               then LLMMessagesAppendFrame(run_llm=True)
               so the agent narrates the outcome
```

Details that matter:

- `classify_command` checks `DESTRUCTIVE_PATTERNS` (recursive/forced `rm`, `rmdir`, `sudo`/`doas`, force push, `git reset --hard`/`clean -f`/`checkout --`, `mkfs`/`dd if=`/`fdisk`/`diskutil`, `> /dev/`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`/`halt`, fork bombs, `chmod -R`/`chown -R`, `curl|sh`/`wget|sh`, `npm publish`/`pip upload`/`twine upload`, `docker rm/rmi/system prune`, `find -delete`, `truncate`/`shred`) and then `ESCAPE_PATTERNS` (`/Users`, `/home`, `/etc`, `/var`, `/usr`, `/System`, `/Library`, `/private`, `/opt`, `/bin`, `/sbin`, `~`, `..`). The first match's reason is what the say-so card shows.
- `kind` records how to run the command once approved: `shell` → `_run_streaming`, `background:<name>` → `ProcessManager.start`, `reset` → `_do_reset`.
- `resolve_confirmation` accepts `"last"`, `"latest"`, `"pending"` or an empty id as "the most recent one", because a spoken "yes" rarely carries an id. `approved` may arrive as a string ("yes", "approve", "true", "1").
- The click path uses tool id `ui_<cid>` for its `tool_result` so the Actions rail can attach it to the card, and appends a system note with `run_llm=True` so the agent says what happened in one sentence.
- Denial runs nothing and leaves no pending state.

## LLM stats

`LLMStatsProcessor` sits right after the LLM. On `LLMFullResponseStartFrame` it starts a clock; the first `LLMTextFrame` sets TTFT; each text frame counts characters; `MetricsFrame`s carrying `LLMUsageMetricsData` set the exact completion-token count. On `LLMFullResponseEndFrame` it emits `llm_stats` with `ttft_ms`, `total_ms`, `tokens` (usage if available, else `chars / 4` and `estimated: true`), `tps` (tokens over the first-to-last-token window) and the current model. Tool-call-only responses (no text) emit nothing. The HUD renders the latest values; the processor keeps the last 50 in `history`.

## The demo brain

`sayso/demo_llm_server.py` is a FastAPI app started in a daemon thread on `127.0.0.1:7861` whenever no LLM key is configured. It implements just enough of the OpenAI protocol for Pipecat's `OpenAILLMService`: `GET /v1/models` and `POST /v1/chat/completions` with streaming (`text/event-stream` chunks, tool-call deltas, `usage`) and non-streaming responses.

`decide(messages)` is a rule-based policy over the last user message plus a small `STATE` (`project`, `port`, `pending`, `fixed`):

- greetings → an introduction; "create/make/build … app/site/clock" → `write_file` × 2 (an `index.html` clock and a stdlib `test_app.py`) and, if asked, `start_background` on the requested port;
- "run/start/serve it" → `start_background`; "open it" → `open_url`; "run the tests" → `run_shell(python3 test_app.py)`, which fails on purpose the first time; "fix it" → rewrite and re-run;
- "huge/neon/bigger" → restyle; "file an issue …" → `github_create_issue`; "stars/repo info" → `github_repo_info`; "list files" → `list_files`; "read …" → `read_file`;
- "delete/remove/wipe X" → `run_shell(rm -rf X)` which the gate holds, or `reset_workspace` for "everything"; a later "yes"/"no" → `resolve_confirmation`;
- after any tool result → a one-sentence summary.

It also reads the same `[User tone: …]` notes the real model gets and prefixes replies accordingly ("Sorry about that." for frustrated, "No stress, I've got it." for stressed, "Love it." for excited), so the emotion loop is demonstrable without a model key. Everything it writes is stdlib-only so the served app and tests run anywhere.

## Swapping providers

- **Another OpenAI-compatible LLM.** Set `OPENAI_API_KEY` and `OPENAI_BASE_URL`, or force `SAYSO_LLM_PROVIDER=openai`. Anything that speaks chat-completions with tool calls works; `build_llm()` in `bot.py` is the one place to add a dedicated Pipecat service.
- **Another SambaNova model.** `SAYSO_MODEL=DeepSeek-V3.1` (or pick it in Settings; `set_model` pushes an `LLMUpdateSettingsFrame` live). The list in `config.SAMBANOVA_MODELS` feeds the picker.
- **General Compute.** Set `GENERAL_COMPUTE_API_KEY`; the base URL defaults to `https://api.generalcompute.com/v1` and the model to `gemma-4-31B-it`.
- **STT.** Set a Gradium or Deepgram key, or force `SAYSO_STT_PROVIDER=whisper-mlx|whisper-local|gradium|deepgram`. Adding another Pipecat STT service is a new branch in `build_stt()`.
- **TTS.** Only Hume is wired on the server; without a key the web app speaks completed turns with `speechSynthesis`. A different TTS is a new branch in `build_tts()`, and `HumeEmotionProcessor` takes `tts_settings_cls` so mood → description updates target whichever service is active (or are skipped when that service has no `description`).
- **Emotion off.** `SAYSO_EMOTION=0` keeps Hume TTS but disables prosody scoring and the tone notes.
- **Workspace.** `SAYSO_WORKSPACE=/path/to/dir`; it is created if missing and every path check uses its resolved location.
