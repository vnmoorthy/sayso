"""Sayso tools: shell, background processes, files, browser, GitHub and confirmations.

Every tool streams what it does to the client (tool_call / tool_output / tool_result) so the
user sees the action happen on screen while the agent narrates it.
"""

from __future__ import annotations

import asyncio
import html
import inspect
import json
import os
import re
import signal
import time
import uuid
import webbrowser
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

from .bus import emit
from .config import Settings

# --------------------------------------------------------------------------------------
# Safety: destructive command detection
# --------------------------------------------------------------------------------------

DESTRUCTIVE_PATTERNS: list[tuple[str, str]] = [
    (r"\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b", "destructive: recursive delete"),
    (r"\brm\s+-[a-zA-Z]*f", "destructive: forced delete"),
    (r"\brmdir\b", "destructive: removes a directory"),
    (r"\bsudo\b|\bdoas\b", "privilege escalation"),
    (r"\bgit\s+push\b.*(--force|\s-f\b)", "destructive: force push"),
    (r"\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s)", "destructive: discards changes"),
    (r"\bmkfs\b|\bdd\s+if=|\bfdisk\b|\bdiskutil\b", "destructive: disk operation"),
    (r">\s*/dev/", "writes to a device"),
    (r"\bkill(all)?\b|\bpkill\b", "kills processes"),
    (r"\bshutdown\b|\breboot\b|\bhalt\b", "power operation"),
    (r":\(\)\s*\{", "fork bomb"),
    (r"\bchmod\s+-R\b|\bchown\s+-R\b", "recursive permission change"),
    (r"\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b", "pipes a remote script into a shell"),
    (r"\bnpm\s+publish\b|\bpip\s+upload\b|\btwine\s+upload\b", "publishes a package"),
    (r"\bdocker\s+(rm|rmi|system\s+prune)\b", "destructive: docker cleanup"),
    (r"\bfind\b.*-delete\b", "destructive: find -delete"),
    (r"\btruncate\b|\bshred\b", "destructive: truncates or shreds files"),
]

ESCAPE_PATTERNS: list[tuple[str, str]] = [
    (r"(^|[\s\"'=])/(Users|home|etc|var|usr|System|Library|private|opt|bin|sbin)(/|\b)", "touches a path outside the workspace"),
    (r"(^|[\s\"'=])~(/|\s|$)", "touches the home directory"),
    (r"(^|[\s\"'=/])\.\.(/|\s|$)", "leaves the workspace"),
]

LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
    ".html": "html", ".css": "css", ".json": "json", ".md": "markdown", ".sh": "bash",
    ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".txt": "text", ".sql": "sql", ".go": "go",
    ".rs": "rust", ".java": "java", ".rb": "ruby", ".c": "c", ".cpp": "cpp", ".swift": "swift",
}

MAX_RESULT_CHARS = 3000


def classify_command(command: str) -> str | None:
    """Return a human-readable reason if the command needs the user's say-so, else None."""
    for pattern, reason in DESTRUCTIVE_PATTERNS:
        if re.search(pattern, command):
            return reason
    for pattern, reason in ESCAPE_PATTERNS:
        if re.search(pattern, command):
            return reason
    return None


def _clip(text: str, limit: int = MAX_RESULT_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-(limit // 2) :]
    return f"{head}\n… [{len(text) - limit} chars trimmed] …\n{tail}"


def _short_result(result: dict) -> dict:
    """Trim a tool result so it stays small in the LLM context and on the wire."""
    out: dict[str, Any] = {}
    for key, value in result.items():
        if isinstance(value, str):
            out[key] = _clip(value, 1500)
        else:
            out[key] = value
    return out


def _guess_port(command: str, explicit: int | None) -> int | None:
    if explicit:
        return int(explicit)
    match = re.search(r"(?:--port[= ]|-p\s*|:|\bport\s+)(\d{4,5})\b", command)
    if match:
        return int(match.group(1))
    match = re.search(r"http\.server\s+(\d{4,5})", command)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(\d{4,5})\b", command)
    return int(match.group(1)) if match else None


# --------------------------------------------------------------------------------------
# Background process manager
# --------------------------------------------------------------------------------------


class ManagedProcess:
    def __init__(self, name: str, command: str, port: int | None, proc: asyncio.subprocess.Process):
        self.name = name
        self.command = command
        self.port = port
        self.proc = proc
        self.tail: deque[str] = deque(maxlen=40)
        self.pump_task: asyncio.Task | None = None


class ProcessManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.procs: dict[str, ManagedProcess] = {}

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        env.setdefault("PYTHONUNBUFFERED", "1")
        env["TERM"] = "dumb"
        env["NO_COLOR"] = "1"
        env["FORCE_COLOR"] = "0"
        return env

    async def _pump(self, mp: ManagedProcess, tool_id: str) -> None:
        async def read(stream: asyncio.StreamReader | None, name: str) -> None:
            if stream is None:
                return
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                mp.tail.append(text.rstrip("\n"))
                await emit({"type": "tool_output", "id": tool_id, "stream": name, "chunk": text})

        await asyncio.gather(read(mp.proc.stdout, "stdout"), read(mp.proc.stderr, "stderr"))
        code = await mp.proc.wait()
        await emit(
            {
                "type": "process",
                "name": mp.name,
                "pid": mp.proc.pid,
                "state": "exited",
                "command": mp.command,
                "port": mp.port,
                "exit_code": code,
            }
        )
        self.procs.pop(mp.name, None)

    async def start(self, tool_id: str, name: str, command: str, port: int | None) -> dict:
        name = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name.strip()) or f"proc-{uuid.uuid4().hex[:4]}"
        port = _guess_port(command, port)
        # Replace anything already running under the same name or port.
        for existing in list(self.procs.values()):
            if existing.name == name or (port and existing.port == port):
                await self.stop(existing.name, quiet=True)
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.settings.workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._env(),
            executable="/bin/bash",
            start_new_session=True,
        )
        mp = ManagedProcess(name, command, port, proc)
        self.procs[name] = mp
        mp.pump_task = asyncio.create_task(self._pump(mp, tool_id))
        await emit(
            {"type": "process", "name": name, "pid": proc.pid, "state": "started", "command": command, "port": port}
        )
        # Give it a moment to crash if it is going to.
        await asyncio.sleep(1.2)
        if proc.returncode is not None:
            tail = "\n".join(mp.tail)
            return {
                "ok": False,
                "name": name,
                "exit_code": proc.returncode,
                "output": _clip(tail),
                "summary": f"{name} exited immediately with code {proc.returncode}",
            }
        url = f"http://localhost:{port}" if port else None
        return {
            "ok": True,
            "name": name,
            "pid": proc.pid,
            "port": port,
            "url": url,
            "output": _clip("\n".join(mp.tail)),
            "summary": f"{name} is running" + (f" on port {port}" if port else ""),
        }

    async def stop(self, name: str, quiet: bool = False) -> dict:
        mp = self.procs.get(name)
        if not mp:
            return {"ok": False, "error": f"no background process named {name}", "running": list(self.procs)}
        try:
            os.killpg(os.getpgid(mp.proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(mp.proc.wait(), 2.5)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(mp.proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.procs.pop(name, None)
        if not quiet:
            await emit(
                {"type": "process", "name": name, "pid": mp.proc.pid, "state": "stopped", "command": mp.command, "port": mp.port}
            )
        return {"ok": True, "name": name, "summary": f"stopped {name}"}

    async def stop_all(self) -> dict:
        names = list(self.procs)
        for name in names:
            await self.stop(name)
        return {"ok": True, "stopped": names, "summary": f"stopped {len(names)} process(es)"}

    def snapshot(self) -> list[dict]:
        return [
            {"name": p.name, "pid": p.proc.pid, "port": p.port, "command": p.command} for p in self.procs.values()
        ]


# --------------------------------------------------------------------------------------
# Toolbox
# --------------------------------------------------------------------------------------


class Toolbox:
    """All tool implementations plus their JSON schemas."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.procs = ProcessManager(settings)
        self.pending: dict[str, dict] = {}  # confirmation id -> {command, reason, kind}
        self.seen_files: set[str] = set()

    # ---- helpers -----------------------------------------------------------------

    def _resolve(self, path: str, allow_outside: bool = False) -> Path:
        raw = Path(path).expanduser()
        target = raw if raw.is_absolute() else self.settings.workspace / raw
        target = target.resolve()
        if not allow_outside and self.settings.workspace not in target.parents and target != self.settings.workspace:
            raise PermissionError(f"{path} is outside the workspace ({self.settings.workspace})")
        return target

    def _rel(self, target: Path) -> str:
        try:
            return str(target.relative_to(self.settings.workspace))
        except ValueError:
            return str(target)

    async def _run_streaming(self, tool_id: str, command: str, timeout: float | None) -> dict:
        timeout = float(timeout or self.settings.shell_timeout)
        started = time.monotonic()
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.settings.workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self.procs._env(),
            executable="/bin/bash",
            start_new_session=True,
        )
        out_lines: list[str] = []
        err_lines: list[str] = []

        async def read(stream: asyncio.StreamReader | None, name: str, sink: list[str]) -> None:
            if stream is None:
                return
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                sink.append(text)
                await emit({"type": "tool_output", "id": tool_id, "stream": name, "chunk": text})

        timed_out = False
        try:
            await asyncio.wait_for(
                asyncio.gather(read(proc.stdout, "stdout", out_lines), read(proc.stderr, "stderr", err_lines)),
                timeout,
            )
            code = await asyncio.wait_for(proc.wait(), 5)
        except asyncio.TimeoutError:
            timed_out = True
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            code = -9
        duration = round((time.monotonic() - started) * 1000)
        stdout = "".join(out_lines)
        stderr = "".join(err_lines)
        ok = code == 0 and not timed_out
        summary = (
            f"timed out after {int(timeout)}s"
            if timed_out
            else (f"exit {code}" + (f" · {stdout.strip().splitlines()[-1][:80]}" if ok and stdout.strip() else ""))
        )
        return {
            "ok": ok,
            "exit_code": code,
            "stdout": _clip(stdout),
            "stderr": _clip(stderr),
            "duration_ms": duration,
            "timed_out": timed_out,
            "summary": summary,
        }

    async def _request_confirmation(self, command: str, reason: str, kind: str = "shell") -> dict:
        cid = f"c_{uuid.uuid4().hex[:6]}"
        self.pending[cid] = {"command": command, "reason": reason, "kind": kind}
        await emit({"type": "confirm_request", "id": cid, "command": command, "reason": reason})
        return {
            "ok": True,
            "awaiting_confirmation": True,
            "confirmation_id": cid,
            "command": command,
            "reason": reason,
            "summary": f"needs your say-so ({reason})",
            "instructions": "Tell the user what you want to run and ask them to say yes or approve on screen. "
            "When they approve, call resolve_confirmation with this confirmation_id.",
        }

    # ---- shell ------------------------------------------------------------------------

    async def run_shell(self, tool_id: str, command: str, timeout_s: int | None = None) -> dict:
        command = (command or "").strip()
        if not command:
            return {"ok": False, "error": "empty command"}
        reason = classify_command(command)
        if reason:
            return await self._request_confirmation(command, reason)
        return await self._run_streaming(tool_id, command, timeout_s)

    async def start_background(self, tool_id: str, command: str, name: str, port: int | None = None) -> dict:
        command = (command or "").strip()
        if not command:
            return {"ok": False, "error": "empty command"}
        reason = classify_command(command)
        if reason:
            return await self._request_confirmation(command, reason, kind="background:" + name)
        return await self.procs.start(tool_id, name or "server", command, port)

    async def stop_background(self, tool_id: str, name: str) -> dict:
        return await self.procs.stop(name)

    # ---- files --------------------------------------------------------------------------

    async def write_file(self, tool_id: str, path: str, content: str) -> dict:
        target = self._resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = content if content is not None else ""
        target.write_text(content, encoding="utf-8")
        rel = self._rel(target)
        self.seen_files.add(rel)
        await emit(
            {
                "type": "file_changed",
                "path": rel,
                "content": content[:20000],
                "language": LANG_BY_EXT.get(target.suffix.lower(), "text"),
                "action": "write",
            }
        )
        return {"ok": True, "path": rel, "bytes": len(content.encode()), "summary": f"wrote {rel}"}

    async def read_file(self, tool_id: str, path: str) -> dict:
        target = self._resolve(path)
        if not target.exists():
            return {"ok": False, "error": f"{path} does not exist"}
        content = target.read_text(encoding="utf-8", errors="replace")
        rel = self._rel(target)
        self.seen_files.add(rel)
        await emit(
            {
                "type": "file_changed",
                "path": rel,
                "content": content[:20000],
                "language": LANG_BY_EXT.get(target.suffix.lower(), "text"),
                "action": "read",
            }
        )
        return {"ok": True, "path": rel, "content": _clip(content), "summary": f"read {rel}"}

    async def list_files(self, tool_id: str, path: str = ".") -> dict:
        root = self._resolve(path or ".")
        if not root.exists():
            return {"ok": False, "error": f"{path} does not exist"}
        skip = {"node_modules", ".venv", ".git", "__pycache__", ".mypy_cache", "dist", ".next"}
        tree: list[str] = []
        for p in sorted(root.rglob("*")):
            if any(part in skip for part in p.parts):
                continue
            rel = self._rel(p)
            if len(rel.split("/")) > 4:
                continue
            tree.append(rel + ("/" if p.is_dir() else ""))
            if len(tree) >= 200:
                break
        await emit({"type": "workspace", "tree": tree})
        return {"ok": True, "root": self._rel(root) or ".", "entries": tree, "summary": f"{len(tree)} entries"}

    # ---- browser ------------------------------------------------------------------------

    async def open_url(self, tool_id: str, url: str, title: str | None = None) -> dict:
        url = (url or "").strip()
        if not url:
            return {"ok": False, "error": "empty url"}
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
            url = "http://" + url
        await emit({"type": "open_url", "url": url, "title": title})
        if self.settings.open_system_browser:
            try:
                webbrowser.open(url)
            except Exception as exc:  # pragma: no cover
                logger.warning(f"system browser open failed: {exc}")
        return {"ok": True, "url": url, "summary": f"opened {url}"}

    async def fetch_url(self, tool_id: str, url: str) -> dict:
        url = (url or "").strip()
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
            url = "http://" + url
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers={"User-Agent": "Sayso/0.1 (+https://github.com/vnmoorthy/sayso)"})
        text = resp.text
        text = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()
        return {
            "ok": resp.status_code < 400,
            "status": resp.status_code,
            "url": str(resp.url),
            "text": _clip(text, 4000),
            "summary": f"HTTP {resp.status_code} · {len(text)} chars",
        }

    # ---- GitHub -------------------------------------------------------------------------

    async def _gh(self, args: list[str]) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            "gh",
            *args,
            cwd=str(self.settings.workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self.procs._env(),
        )
        out, err = await asyncio.wait_for(proc.communicate(), 45)
        return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")

    async def _default_repo(self, repo: str | None) -> str | None:
        if repo:
            return repo
        if self.settings.github_repo:
            return self.settings.github_repo
        code, out, _ = await self._gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
        return out.strip() if code == 0 and out.strip() else None

    async def github_create_issue(self, tool_id: str, title: str, body: str | None = None, repo: str | None = None) -> dict:
        target = await self._default_repo(repo)
        if not target:
            return {"ok": False, "error": "No GitHub repo configured. Set SAYSO_GITHUB_REPO=owner/name."}
        body = body or f"Filed by voice with Sayso.\n\n> {title}"
        code, out, err = await self._gh(["issue", "create", "-R", target, "-t", title, "-b", body])
        if code != 0:
            return {"ok": False, "error": err.strip() or out.strip(), "summary": "gh issue create failed"}
        url = out.strip().splitlines()[-1]
        number = int(url.rstrip("/").split("/")[-1]) if url.rstrip("/").split("/")[-1].isdigit() else None
        await emit({"type": "github_event", "kind": "issue", "url": url, "number": number, "title": title})
        return {"ok": True, "url": url, "number": number, "repo": target, "summary": f"opened issue #{number} in {target}"}

    async def github_repo_info(self, tool_id: str, repo: str | None = None) -> dict:
        target = await self._default_repo(repo)
        if not target:
            return {"ok": False, "error": "No GitHub repo configured. Set SAYSO_GITHUB_REPO=owner/name."}
        code, out, err = await self._gh(
            ["repo", "view", target, "--json", "nameWithOwner,description,stargazerCount,url,isPrivate,pushedAt"]
        )
        if code != 0:
            return {"ok": False, "error": err.strip() or out.strip()}
        info = json.loads(out)
        await emit({"type": "github_event", "kind": "repo", "url": info.get("url", ""), "title": info.get("nameWithOwner", target)})
        info["ok"] = True
        info["summary"] = f"{info.get('nameWithOwner')} · {info.get('stargazerCount', 0)} stars"
        return info

    # ---- confirmations & workspace -----------------------------------------------------------

    async def resolve_confirmation(self, tool_id: str, id: str, approved: bool = True) -> dict:
        pending = self.pending.pop(id, None)
        if not pending:
            if self.pending and id in ("last", "latest", "pending", ""):
                last_id = list(self.pending)[-1]
                pending = self.pending.pop(last_id)
                id = last_id
            else:
                return {"ok": False, "error": f"no pending confirmation with id {id}", "pending": list(self.pending)}
        approved = bool(approved) if not isinstance(approved, str) else approved.lower() in ("true", "yes", "1", "approve")
        await emit({"type": "confirm_resolved", "id": id, "approved": approved})
        if not approved:
            return {"ok": True, "approved": False, "summary": "denied — nothing was run"}
        kind = pending.get("kind", "shell")
        if kind == "reset":
            return await self._do_reset()
        if kind.startswith("background:"):
            return await self.procs.start(tool_id, kind.split(":", 1)[1] or "server", pending["command"], None)
        result = await self._run_streaming(tool_id, pending["command"], None)
        result["approved"] = True
        return result

    async def reset_workspace(self, tool_id: str) -> dict:
        return await self._request_confirmation("reset workspace (delete everything inside it)", "destructive: wipes the workspace", kind="reset")

    async def _do_reset(self) -> dict:
        import shutil

        await self.procs.stop_all()
        removed = 0
        for child in self.settings.workspace.iterdir():
            if child.name == ".gitkeep":
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
            removed += 1
        self.seen_files.clear()
        await emit({"type": "workspace", "tree": []})
        return {"ok": True, "removed": removed, "summary": f"workspace reset ({removed} entries removed)"}

    # ---- schemas -------------------------------------------------------------------------------

    def schemas(self) -> ToolsSchema:
        fs = FunctionSchema
        tools = [
            fs(
                name="run_shell",
                description="Run a shell command inside the workspace and stream its output to the user's screen. "
                "Use for one-shot commands (ls, cat, python3 script.py, git status, tests). Not for servers.",
                properties={
                    "command": {"type": "string", "description": "Bash command to run"},
                    "timeout_s": {"type": "integer", "description": "Optional timeout in seconds (default 90)"},
                },
                required=["command"],
            ),
            fs(
                name="start_background",
                description="Start a long-running process such as a dev server or watcher, and keep it running. "
                "Returns immediately with the URL if a port is detected.",
                properties={
                    "command": {"type": "string", "description": "Command to run, e.g. python3 -m http.server 8000 --directory pulse"},
                    "name": {"type": "string", "description": "Short name for the process, e.g. pulse"},
                    "port": {"type": "integer", "description": "Port the process listens on, if known"},
                },
                required=["command", "name"],
            ),
            fs(
                name="stop_background",
                description="Stop a background process started with start_background.",
                properties={"name": {"type": "string", "description": "Process name"}},
                required=["name"],
            ),
            fs(
                name="write_file",
                description="Create or overwrite a file inside the workspace with the full content.",
                properties={
                    "path": {"type": "string", "description": "Workspace-relative path, e.g. pulse/index.html"},
                    "content": {"type": "string", "description": "Complete file contents"},
                },
                required=["path", "content"],
            ),
            fs(
                name="read_file",
                description="Read a file from the workspace and show it on screen.",
                properties={"path": {"type": "string", "description": "Workspace-relative path"}},
                required=["path"],
            ),
            fs(
                name="list_files",
                description="List files and folders in the workspace (or a sub-folder).",
                properties={"path": {"type": "string", "description": "Folder to list, default '.'"}},
                required=[],
            ),
            fs(
                name="open_url",
                description="Open a URL in the user's browser panel, e.g. a server you just started.",
                properties={
                    "url": {"type": "string", "description": "URL, e.g. http://localhost:8000"},
                    "title": {"type": "string", "description": "Optional tab title"},
                },
                required=["url"],
            ),
            fs(
                name="fetch_url",
                description="Fetch a web page and return its readable text so you can answer questions about it.",
                properties={"url": {"type": "string", "description": "URL to fetch"}},
                required=["url"],
            ),
            fs(
                name="github_create_issue",
                description="Create a GitHub issue (real action via the gh CLI). Use the configured repo unless the user names one.",
                properties={
                    "title": {"type": "string", "description": "Issue title"},
                    "body": {"type": "string", "description": "Issue body in markdown"},
                    "repo": {"type": "string", "description": "owner/name, optional"},
                },
                required=["title"],
            ),
            fs(
                name="github_repo_info",
                description="Get information (stars, description, url) about a GitHub repository.",
                properties={"repo": {"type": "string", "description": "owner/name, optional"}},
                required=[],
            ),
            fs(
                name="resolve_confirmation",
                description="Approve or deny a pending destructive command after the user says yes or no.",
                properties={
                    "id": {"type": "string", "description": "confirmation_id returned earlier"},
                    "approved": {"type": "boolean", "description": "true if the user approved"},
                },
                required=["id", "approved"],
            ),
            fs(
                name="reset_workspace",
                description="Delete everything in the workspace (asks for confirmation first).",
                properties={},
                required=[],
            ),
        ]
        return ToolsSchema(standard_tools=tools)

    def handlers(self) -> dict[str, Callable[..., Awaitable[dict]]]:
        return {
            "run_shell": self.run_shell,
            "start_background": self.start_background,
            "stop_background": self.stop_background,
            "write_file": self.write_file,
            "read_file": self.read_file,
            "list_files": self.list_files,
            "open_url": self.open_url,
            "fetch_url": self.fetch_url,
            "github_create_issue": self.github_create_issue,
            "github_repo_info": self.github_repo_info,
            "resolve_confirmation": self.resolve_confirmation,
            "reset_workspace": self.reset_workspace,
        }

    # ---- registration with the LLM service ------------------------------------------------------

    def register(self, llm: Any) -> None:
        for name, fn in self.handlers().items():
            llm.register_function(name, self._wrap(name, fn))

    def _wrap(self, name: str, fn: Callable[..., Awaitable[dict]]):
        sig = inspect.signature(fn)
        accepted = {p for p in sig.parameters if p != "tool_id"}

        async def handler(params: FunctionCallParams) -> None:
            tool_id = params.tool_call_id or f"t_{uuid.uuid4().hex[:8]}"
            raw_args = dict(params.arguments or {})
            args = {k: v for k, v in raw_args.items() if k in accepted}
            started = time.monotonic()
            await emit({"type": "tool_call", "id": tool_id, "name": name, "args": raw_args, "ts": time.time()})
            try:
                result = await fn(tool_id, **args)
                if not isinstance(result, dict):
                    result = {"ok": True, "result": result}
            except TypeError as exc:
                result = {"ok": False, "error": f"bad arguments for {name}: {exc}"}
            except PermissionError as exc:
                result = {"ok": False, "error": str(exc)}
            except Exception as exc:  # noqa: BLE001
                logger.exception(f"tool {name} failed")
                result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            ok = bool(result.get("ok", True))
            duration = round((time.monotonic() - started) * 1000)
            summary = result.get("summary") or (result.get("error") if not ok else "done")
            await emit(
                {
                    "type": "tool_result",
                    "id": tool_id,
                    "name": name,
                    "ok": ok,
                    "summary": str(summary)[:200],
                    "result": _short_result(result),
                    "duration_ms": duration,
                }
            )
            await params.result_callback(_short_result(result))

        return handler
