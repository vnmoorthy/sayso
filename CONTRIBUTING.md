# Contributing to Sayso

Thanks for helping. Sayso is small and moves fast; this page is everything you need to make a change that lands.

## Dev setup

```bash
git clone https://github.com/vnmoorthy/sayso && cd sayso

# server (Python 3.12 + uv)
cd server && cp .env.example .env    # keys are optional; no keys = demo brain + local Whisper + browser TTS
uv sync
uv run bot.py                        # http://localhost:7860

# web (Node 20+)
cd ../web && npm install
npm run dev                          # http://localhost:5173
```

Useful while developing:

- `SAYSO_WHISPER_MODEL=mlx-community/whisper-tiny uv run bot.py` for a fast local STT model.
- `SAYSO_FAKE_EMOTION=1` to exercise the mood UI without a Hume key.
- `http://localhost:5173/?mock=1` to work on the UI with no server at all.
- `.claude/launch.json` has both dev servers pre-wired for Claude Code's preview.

Type-check the web app before pushing: `npm run build` runs `tsc --noEmit` and the Vite build.

## Code style

**Python** (`server/`): [ruff](https://docs.astral.sh/ruff/) and black defaults (88 columns, double quotes), `from __future__ import annotations`, type hints on public functions, `loguru` for logging (no `print` outside `bot.py` startup). Async everywhere in the pipeline; never block the event loop with a synchronous subprocess or HTTP call. Format the files you touch; a few hackathon-era lines are still long and are being brought in line file by file rather than in one noisy reformat.

```bash
uvx ruff check server && uvx ruff format --check server
```

**TypeScript** (`web/`): [Prettier](https://prettier.io/) defaults with single quotes, strict TypeScript, functional React components, Tailwind utility classes over custom CSS. No `any` in `src/lib/`.

```bash
npx prettier --check "web/src/**/*.{ts,tsx}"
```

Keep the two sides of the wire in sync: `web/src/lib/protocol.ts` is the shared event contract. A server change that adds or alters an event ships with the matching `protocol.ts` change in the same PR.

## How to add a tool

A tool is three edits: the handler, its schema, and (only if it needs a new UI event) the protocol.

**1. Handler** in `server/sayso/tools.py`, as an async method on `Toolbox`. The first argument is always `tool_id`; the rest are the model-facing arguments. Return a `dict` with at least `ok` and a short `summary` (the summary is spoken-length; the whole dict is shown in the Actions rail and trimmed before it goes back to the model).

```python
async def count_lines(self, tool_id: str, path: str) -> dict:
    target = self._resolve(path)                 # refuses paths outside workspace/
    n = sum(1 for _ in target.open(encoding="utf-8", errors="replace"))
    await emit({"type": "notice", "level": "info", "text": f"{path}: {n} lines"})
    return {"ok": True, "path": self._rel(target), "lines": n, "summary": f"{n} lines"}
```

Stream progress with `emit({"type": "tool_output", "id": tool_id, "stream": "stdout", "chunk": line})` if the tool runs for a while. If the tool can do damage, do what `run_shell` does: call `classify_command()` (or your own check) and return `await self._request_confirmation(command, reason, kind=...)` so it lands on the say-so card instead of running.

**2. Schema** in `Toolbox.schemas()` and a name → method entry in `Toolbox.handlers()`:

```python
fs(
    name="count_lines",
    description="Count the lines in a workspace file.",
    properties={"path": {"type": "string", "description": "Workspace-relative path"}},
    required=["path"],
),
```

`Toolbox.register()` wraps every handler so `tool_call` and `tool_result` events, timing and error handling come for free. Mention the tool in `server/sayso/prompts.py` if the model needs guidance on when to use it, and teach `decide()` in `server/sayso/demo_llm_server.py` a trigger phrase if it should work in keyless demo mode.

**3. Protocol** in `web/src/lib/protocol.ts`, only when the tool emits a new event type. Add the variant to the `ServerMessage` union, add its `type` string to `SERVER_MESSAGE_TYPES`, add the tool name to `ToolName`, then render it in the UI. Existing events (`tool_output`, `file_changed`, `notice`, `open_url`, …) cover most tools without touching the contract.

Manual test: run the server in demo mode, say or type a phrase that triggers the tool, and check the Actions rail shows the call, the result and the timing.

## Pull requests

- One change per PR, with a title in the imperative ("Add count_lines tool"). Describe what you tested and how (demo mode, live keys, `?mock=1`).
- Keep `server/` and `web/` changes that depend on each other in the same PR.
- No secrets, ever: `.env` is git-ignored, and PRs that add keys, tokens or personal paths will be closed.
- Docs count. If you change an event, a tool or a setting, update `README.md` and `docs/ARCHITECTURE.md` in the same PR.
- Be kind in review. Hackathon code has rough edges; point at the line and suggest the fix.

By contributing you agree your work is released under the [MIT License](LICENSE).
