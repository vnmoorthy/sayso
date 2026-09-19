"""Keyless demo brain: a tiny OpenAI-compatible server with a rule-based "model".

When no SambaNova / General Compute / OpenAI key is configured, Sayso points Pipecat's OpenAI
LLM service at this local server so the *entire* pipeline (tool calls, streaming, confirmations,
UI events) can be exercised end-to-end. It is deliberately scripted; swap in a real key and the
real model takes over with the same tools.
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger

app = FastAPI(title="Sayso demo brain")

STATE: dict[str, Any] = {"project": "pulse", "port": 8000, "pending": None, "fixed": False}

# --------------------------------------------------------------------------------------
# Templates (stdlib-only so they run anywhere, instantly)
# --------------------------------------------------------------------------------------


def clock_html(name: str, *, huge: bool = False, fixed: bool = False) -> str:
    title = name.title() if fixed else name.lower()
    size = "18vw" if huge else "3rem"
    color = "#39FF14" if huge else "#F4F4F5"
    glow = "0 0 24px #39FF14, 0 0 64px rgba(57,255,20,.6)" if huge else "none"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<style>
  html, body {{ height: 100%; margin: 0; background: #09090B; color: {color}; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  body {{ display: grid; place-items: center; }}
  #clock {{ font-size: {size}; font-weight: 700; letter-spacing: .04em; text-shadow: {glow}; }}
  p {{ color: #71717A; font-size: 14px; position: fixed; bottom: 16px; left: 0; right: 0; text-align: center; }}
</style>
</head>
<body>
  <div id="clock">--:--:--</div>
  <p>{name} · built by voice with Sayso</p>
  <script>
    const el = document.getElementById('clock');
    const tick = () => {{ el.textContent = new Date().toLocaleTimeString([], {{ hour12: false }}); }};
    tick(); setInterval(tick, 1000);
  </script>
</body>
</html>
"""


def test_py(name: str) -> str:
    return f'''"""Smoke tests for {name} (stdlib only)."""
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent


class TestApp(unittest.TestCase):
    def test_index_exists(self):
        self.assertTrue((HERE / "index.html").exists(), "index.html is missing")

    def test_title_is_capitalised(self):
        html = (HERE / "index.html").read_text()
        self.assertIn("<title>{name.title()}</title>", html, "expected the page title to be '{name.title()}'")

    def test_has_clock(self):
        html = (HERE / "index.html").read_text()
        self.assertIn('id="clock"', html)


if __name__ == "__main__":
    unittest.main(verbosity=1)
'''


# --------------------------------------------------------------------------------------
# The "model"
# --------------------------------------------------------------------------------------


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def _tone(messages: list[dict]) -> str:
    for msg in reversed(messages[-6:]):
        if msg.get("role") == "system" and "[User tone:" in _content_text(msg.get("content")):
            m = re.search(r"\[User tone: (\w+)", _content_text(msg["content"]))
            if m:
                return m.group(1)
    return "neutral"


def _prefix(tone: str) -> str:
    return {
        "frustrated": "Sorry about that. ",
        "stressed": "No stress, I've got it. ",
        "excited": "Love it. ",
        "happy": "",
        "confused": "Let me make that clear. ",
        "sad": "",
    }.get(tone, "")


def _name_from(text: str) -> str:
    m = re.search(r"(?:called|named|name it|name)\s+[\"']?([a-zA-Z][a-zA-Z0-9_-]{1,30})", text)
    return m.group(1).lower() if m else STATE["project"]


def _port_from(text: str) -> int:
    m = re.search(r"port\s+(\d{4,5})", text)
    if m:
        return int(m.group(1))
    m = re.search(r"\b(\d{4,5})\b", text)
    return int(m.group(1)) if m else STATE["port"]


def decide(messages: list[dict]) -> tuple[str | None, list[tuple[str, dict]]]:
    """Return (text, tool_calls) for the next assistant turn."""
    tone = _tone(messages)
    last = messages[-1]

    if last.get("role") == "tool":
        return _summarize(messages, tone), []

    user = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            user = _content_text(msg.get("content"))
            break
        if msg.get("role") == "system" and "Greet the user" in _content_text(msg.get("content")):
            return (
                "Hey, I'm Sayso. I run your terminal, files, browser and GitHub by voice. Give me a task.",
                [],
            )
    u = user.lower().strip()
    project, port = STATE["project"], STATE["port"]

    if STATE["pending"] and re.search(r"\b(yes|yeah|yep|sure|approve|go ahead|do it|confirm|ok|okay)\b", u):
        cid = STATE["pending"]
        STATE["pending"] = None
        return None, [("resolve_confirmation", {"id": cid, "approved": True})]
    if STATE["pending"] and re.search(r"\b(no|nope|deny|cancel|stop|don't|dont)\b", u):
        cid = STATE["pending"]
        STATE["pending"] = None
        return None, [("resolve_confirmation", {"id": cid, "approved": False})]

    if not STATE["pending"] and re.fullmatch(r"(yes|yeah|yep|sure|approve|go ahead|do it|confirm|ok|okay)[.! ]*", u):
        return "Nothing is waiting on your approval right now.", []

    if re.search(r"\b(hi|hello|hey|what can you do|who are you|help|introduce)\b", u) and len(u) < 60:
        return (
            "Hey, I'm Sayso. Ask me to create and run an app, edit files, run tests, open the browser, or file a GitHub issue.",
            [],
        )

    if re.search(r"\b(create|make|build|scaffold|generate|new)\b.*\b(app|site|page|project|clock|website)\b", u):
        project = _name_from(u)
        port = _port_from(u) if re.search(r"\bport\b|\d{4,5}", u) else STATE["port"]
        STATE.update(project=project, port=port, fixed=False)
        calls: list[tuple[str, dict]] = [
            ("write_file", {"path": f"{project}/index.html", "content": clock_html(project)}),
            ("write_file", {"path": f"{project}/test_app.py", "content": test_py(project)}),
        ]
        if re.search(r"\b(run|start|serve|launch)\b", u):
            calls.append(
                (
                    "start_background",
                    {"command": f"python3 -m http.server {port} --directory {project}", "name": project, "port": port},
                )
            )
        return f"{_prefix(tone)}On it. Scaffolding {project} now.", calls

    if re.search(r"\b(run|start|serve|launch)\b.*\b(it|server|app|site|again)\b", u) and not re.search(r"test", u):
        port = _port_from(u) if re.search(r"\bport\b", u) else port
        STATE["port"] = port
        return None, [
            ("start_background", {"command": f"python3 -m http.server {port} --directory {project}", "name": project, "port": port})
        ]

    if re.search(r"\b(stop|kill|shut down)\b.*\b(server|it|process|app)\b", u):
        return None, [("stop_background", {"name": project})]

    if re.search(r"\b(open|show|preview|display)\b.*\b(browser|it|page|site|localhost|app)\b", u) or "localhost" in u:
        return None, [("open_url", {"url": f"http://localhost:{port}", "title": project})]

    if re.search(r"\b(test|tests|pytest|unittest)\b", u) and re.search(r"\b(run|execute|do|check)\b", u):
        return None, [("run_shell", {"command": f"cd {project} && python3 test_app.py"})]

    if re.search(r"\bfix\b|\bmake (it|them|the tests?) pass\b|\brepair\b", u):
        STATE["fixed"] = True
        huge = "huge" in u or "big" in u or "neon" in u or STATE.get("huge")
        return f"{_prefix(tone)}Fixing the title and re-running the tests.", [
            ("write_file", {"path": f"{project}/index.html", "content": clock_html(project, huge=bool(huge), fixed=True)}),
            ("run_shell", {"command": f"cd {project} && python3 test_app.py"}),
        ]

    if re.search(r"\b(issue|ticket|bug report)\b", u) and re.search(r"\b(file|create|open|make|log|raise)\b", u):
        m = re.search(r"(?:issue|ticket)\s+(?:to|for|about|that says|saying|titled)\s+(.+)", user, re.IGNORECASE)
        title = m.group(1).strip().rstrip(".") if m else "Follow-up from a Sayso voice session"
        title = title[0].upper() + title[1:]
        body = f"Filed by voice with Sayso during the AGI House Voice AI Hackathon.\n\n**Request:** {user}"
        return None, [("github_create_issue", {"title": title, "body": body})]

    if re.search(r"\b(stars|repo info|repository|how many stars)\b", u):
        return None, [("github_repo_info", {})]

    if re.search(r"\b(bigger|huge|larger|giant|neon|green|glow|color|colour|dark|font|style|pretty|nicer)\b", u):
        STATE["huge"] = True
        return f"{_prefix(tone)}Making it huge and neon.", [
            ("write_file", {"path": f"{project}/index.html", "content": clock_html(project, huge=True, fixed=STATE["fixed"])})
        ]

    if re.search(r"\b(list|show|what).*(files|folder|directory|workspace|tree)\b", u):
        return None, [("list_files", {"path": "."})]

    if re.search(r"\b(read|cat|print|display)\b.*\b(file|html|index|test)\b", u):
        target = "test_app.py" if "test" in u else "index.html"
        return None, [("read_file", {"path": f"{project}/{target}"})]

    if re.search(r"\b(delete|remove|wipe|clean|rm|nuke|clear)\b", u):
        m = re.search(r"(?:delete|remove|wipe|clean|rm|nuke|clear)\s+(?:the\s+)?([a-zA-Z0-9_./-]+)", u)
        target = m.group(1) if m else "build"
        if target in ("workspace", "everything", "all"):
            return None, [("reset_workspace", {})]
        return None, [("run_shell", {"command": f"rm -rf {target}"})]

    if re.search(r"\b(git status|status of git|commit)\b", u):
        return None, [("run_shell", {"command": "git status --short || echo 'not a git repo'"})]

    if re.search(r"\b(time|date|clock)\b", u):
        return f"It's {time.strftime('%-I:%M %p')}.", []

    if re.search(r"\b(fetch|read|summarize|summarise)\b.*https?://", user):
        url = re.search(r"https?://\S+", user).group(0)
        return None, [("fetch_url", {"url": url})]

    return (
        f"{_prefix(tone)}I heard: {user.strip()[:80]}. I can create and run apps, edit files, run tests, open the "
        "browser, and file GitHub issues. Try: create a web app called pulse with a live clock and run it on port 8000.",
        [],
    )


def _summarize(messages: list[dict], tone: str) -> str:
    """Turn the most recent batch of tool results into one spoken sentence."""
    results: list[tuple[str, dict]] = []
    names: dict[str, str] = {}
    for msg in reversed(messages):
        if msg.get("role") == "tool":
            try:
                payload = json.loads(_content_text(msg.get("content")) or "{}")
            except json.JSONDecodeError:
                payload = {"raw": _content_text(msg.get("content"))}
            results.append((msg.get("tool_call_id", ""), payload))
        elif msg.get("role") == "assistant" and msg.get("tool_calls"):
            for call in msg["tool_calls"]:
                names[call.get("id", "")] = call.get("function", {}).get("name", "")
            break
        elif msg.get("role") == "assistant":
            break
    results.reverse()
    parts: list[str] = []
    for call_id, payload in results:
        name = names.get(call_id, "")
        if payload.get("awaiting_confirmation"):
            STATE["pending"] = payload.get("confirmation_id")
            return (
                f"That's {payload.get('reason', 'destructive')}, so I need your say-so before I run "
                f"{payload.get('command', 'it')}. Approve on screen or just say yes."
            )
        ok = payload.get("ok", True)
        if name == "start_background":
            if ok:
                parts.append(f"{payload.get('name', 'it')} is live on port {payload.get('port')}. Want me to open it?")
            else:
                parts.append(f"{payload.get('name', 'it')} crashed on start: {payload.get('output', '')[-120:].strip()}")
        elif name == "run_shell" or name == "resolve_confirmation":
            if name == "resolve_confirmation" and not ok and "no pending confirmation" in str(payload.get("error", "")):
                parts.append("That one was already handled on screen.")
            elif payload.get("approved") is False:
                parts.append("Okay, I left it alone.")
            elif ok:
                tail = (payload.get("stdout") or "").strip().splitlines()
                parts.append("Done, exit code zero." + (f" It printed {tail[-1][:60]}." if tail else ""))
            else:
                err = (payload.get("stderr") or payload.get("stdout") or payload.get("error") or "").strip().splitlines()
                detail = next((l for l in reversed(err) if l.strip()), "")
                if "expected the page title" in detail:
                    parts.append("One test failed: it expected the page title to be capitalised. Want me to fix it?")
                else:
                    parts.append(f"That failed with exit code {payload.get('exit_code')}. {detail[:100]}")
        elif name == "write_file":
            parts.append(f"Wrote {payload.get('path', 'the file')}.")
        elif name == "open_url":
            parts.append("It's up in your browser panel.")
        elif name == "github_create_issue":
            parts.append(
                f"Opened issue number {payload.get('number')} in {payload.get('repo')}. The link is on your screen."
                if ok
                else f"GitHub said no: {payload.get('error', '')[:100]}"
            )
        elif name == "github_repo_info":
            parts.append(f"{payload.get('nameWithOwner')} has {payload.get('stargazerCount', 0)} stars." if ok else "I couldn't reach GitHub.")
        elif name == "list_files":
            parts.append(f"There are {len(payload.get('entries', []))} entries; they're on your screen.")
        elif name == "read_file":
            parts.append(f"{payload.get('path')} is on your screen.")
        elif name == "stop_background":
            parts.append(f"Stopped {payload.get('name', 'it')}." if ok else payload.get("error", "Nothing to stop."))
        elif name == "fetch_url":
            text = (payload.get("text") or "")[:160]
            parts.append(f"Got it. It starts with: {text}")
        elif name == "reset_workspace":
            parts.append(payload.get("summary", "Workspace reset."))
        elif not ok:
            parts.append(f"{name or 'that'} failed: {payload.get('error', '')[:100]}")
    if not parts:
        return "Done."
    # Collapse: "Wrote a. Wrote b. X is live" -> keep last two distinct sentences.
    writes = [p for p in parts if p.startswith("Wrote ")]
    others = [p for p in parts if not p.startswith("Wrote ")]
    if writes and others:
        text = " ".join(others)
    elif writes:
        text = f"Wrote {len(writes)} file{'s' if len(writes) > 1 else ''}." if len(writes) > 1 else writes[0]
    else:
        text = " ".join(others)
    if tone == "excited" and "exit code zero" in text:
        text = "All green. " + text
    return _prefix(tone) + text


# --------------------------------------------------------------------------------------
# OpenAI-compatible wire format
# --------------------------------------------------------------------------------------


def _chunk(cid: str, model: str, delta: dict, finish: str | None = None, usage: dict | None = None) -> str:
    body: dict[str, Any] = {
        "id": cid,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage is not None:
        body["usage"] = usage
        body["choices"] = []
    return f"data: {json.dumps(body)}\n\n"


async def _stream(cid: str, model: str, text: str | None, calls: list[tuple[str, dict]], prompt_tokens: int):
    import asyncio

    completion_tokens = 0
    yield _chunk(cid, model, {"role": "assistant", "content": ""})
    if text:
        words = text.split(" ")
        for i, word in enumerate(words):
            piece = word if i == 0 else " " + word
            completion_tokens += 1
            yield _chunk(cid, model, {"content": piece})
            await asyncio.sleep(0.012)
    if calls:
        for index, (name, args) in enumerate(calls):
            call_id = f"call_{uuid.uuid4().hex[:8]}"
            yield _chunk(
                cid,
                model,
                {"tool_calls": [{"index": index, "id": call_id, "type": "function", "function": {"name": name, "arguments": ""}}]},
            )
            arg_json = json.dumps(args)
            for start in range(0, len(arg_json), 64):
                completion_tokens += 8
                yield _chunk(cid, model, {"tool_calls": [{"index": index, "function": {"arguments": arg_json[start : start + 64]}}]})
        yield _chunk(cid, model, {}, finish="tool_calls")
    else:
        yield _chunk(cid, model, {}, finish="stop")
    yield _chunk(
        cid,
        model,
        {},
        usage={
            "prompt_tokens": prompt_tokens,
            "completion_tokens": max(1, completion_tokens),
            "total_tokens": prompt_tokens + max(1, completion_tokens),
        },
    )
    yield "data: [DONE]\n\n"


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": "sayso-demo-brain", "object": "model", "owned_by": "sayso"}]}


@app.post("/v1/chat/completions")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    model = body.get("model", "sayso-demo-brain")
    cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    prompt_tokens = sum(len(_content_text(m.get("content"))) // 4 for m in messages)
    try:
        text, calls = decide(messages)
    except Exception as exc:  # noqa: BLE001
        logger.exception("demo brain failed")
        text, calls = f"My demo brain hiccuped: {exc}", []
    if body.get("stream", False):
        return StreamingResponse(_stream(cid, model, text, calls, prompt_tokens), media_type="text/event-stream")
    message: dict[str, Any] = {"role": "assistant", "content": text or None}
    if calls:
        message["tool_calls"] = [
            {"id": f"call_{uuid.uuid4().hex[:8]}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}}
            for n, a in calls
        ]
    return JSONResponse(
        {
            "id": cid,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": 32, "total_tokens": prompt_tokens + 32},
        }
    )


_server_thread: threading.Thread | None = None


def _port_state(port: int) -> str:
    """'free' | 'ours' (a live demo brain) | 'busy' (something else)."""
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        if sock.connect_ex(("127.0.0.1", port)) != 0:
            return "free"
    try:
        import httpx

        r = httpx.get(f"http://127.0.0.1:{port}/v1/models", timeout=1.0)
        if r.status_code == 200 and "sayso-demo-brain" in r.text:
            return "ours"
    except Exception:  # noqa: BLE001
        pass
    return "busy"


def _free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_demo_llm_server(port: int = 7861) -> int:
    """Run the demo brain in a daemon thread and return the port it is reachable on.

    Reuses an already-running demo brain (e.g. from a previous server that has not fully
    exited yet) and falls back to a free port if something else owns the preferred one.
    """
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return port
    state = _port_state(port)
    if state == "ours":
        logger.info(f"🧠 Reusing running demo brain on http://127.0.0.1:{port}/v1")
        return port
    if state == "busy":
        port = _free_port()
    import uvicorn

    def _run() -> None:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

    _server_thread = threading.Thread(target=_run, name="sayso-demo-brain", daemon=True)
    _server_thread.start()
    # Wait until it answers so the LLM service never races it.
    import time as _time

    for _ in range(50):
        if _port_state(port) == "ours":
            break
        _time.sleep(0.1)
    logger.info(f"🧠 Demo brain (no API keys found) listening on http://127.0.0.1:{port}/v1")
    return port
