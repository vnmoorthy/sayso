"""Sayso pre-flight: validate every configured provider key in ~10 seconds.

    uv run scripts/check_keys.py

Prints one line per provider with latency, so you know the stack is live before you demo.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import os
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

OK, WARN, FAIL, SKIP = "✅", "⚠️ ", "❌", "·  "
TOOL = {
    "type": "function",
    "function": {
        "name": "open_url",
        "description": "Open a URL in the browser",
        "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
    },
}


def line(status: str, name: str, detail: str) -> None:
    print(f"{status} {name:<18} {detail}")


async def check_openai_compatible(name: str, key: str | None, base: str, model: str) -> None:
    if not key:
        return line(SKIP, name, "not set")
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"{base.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are a terse assistant with tools."},
                        {"role": "user", "content": "Open localhost port 8000 in the browser."},
                    ],
                    "tools": [TOOL],
                    "max_tokens": 120,
                },
            )
        ms = round((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return line(FAIL, name, f"HTTP {r.status_code}: {r.text[:120]}")
        msg = r.json()["choices"][0]["message"]
        called = bool(msg.get("tool_calls"))
        usage = r.json().get("usage", {})
        line(OK if called else WARN, name, f"{model} · {ms} ms · tool call {'✓' if called else 'not emitted'} · {usage.get('completion_tokens', '?')} tokens")
    except Exception as exc:  # noqa: BLE001
        line(FAIL, name, f"{type(exc).__name__}: {exc}")


def tone_wav(seconds: float = 1.2, rate: int = 16000) -> bytes:
    frames = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 180 * i / rate) * (0.6 + 0.4 * math.sin(i / 900)))) for i in range(int(seconds * rate)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(frames)
    return buf.getvalue()


async def check_hume() -> None:
    key = os.getenv("HUME_API_KEY")
    if not key:
        return line(SKIP, "Hume", "not set (browser speech fallback)")
    headers = {"X-Hume-Api-Key": key}
    try:
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get("https://api.hume.ai/v0/tts/voices", params={"provider": "HUME_AI", "page_size": 100}, headers=headers)
            if r.status_code != 200:
                return line(FAIL, "Hume voices", f"HTTP {r.status_code}: {r.text[:120]}")
            data = r.json()
            voices = data.get("voices_page") or data.get("voices") or data.get("data") or []
            wanted = (os.getenv("HUME_VOICE_NAME") or "Ava Song").lower()
            voice = next((v for v in voices if (v.get("name") or "").lower() == wanted), voices[0] if voices else None)
            line(OK, "Hume voices", f"{len(voices)} library voices · using {voice.get('name') if voice else '—'} ({round((time.perf_counter()-t0)*1000)} ms)")
            if voice:
                t0 = time.perf_counter()
                r = await c.post(
                    "https://api.hume.ai/v0/tts",
                    headers=headers,
                    json={
                        "utterances": [{"text": "Sayso is live.", "voice": {"id": voice["id"]}, "description": "confident, friendly"}],
                        "format": {"type": "mp3"},
                    },
                )
                if r.status_code == 200:
                    audio = r.json().get("generations", [{}])[0].get("audio", "")
                    line(OK, "Hume Octave TTS", f"{len(base64.b64decode(audio)) // 1024} KB mp3 in {round((time.perf_counter()-t0)*1000)} ms")
                else:
                    line(FAIL, "Hume Octave TTS", f"HTTP {r.status_code}: {r.text[:120]}")
    except Exception as exc:  # noqa: BLE001
        line(FAIL, "Hume", f"{type(exc).__name__}: {exc}")
    # Expression measurement (prosody) streaming
    try:
        import websockets

        t0 = time.perf_counter()
        async with websockets.connect(f"wss://api.hume.ai/v0/stream/models?apikey={key}", open_timeout=10) as ws:
            await ws.send(json.dumps({"models": {"prosody": {}}, "data": base64.b64encode(tone_wav()).decode()}))
            msg = json.loads(await asyncio.wait_for(ws.recv(), 15))
        if "error" in msg:
            line(WARN, "Hume prosody", f"API answered with error: {msg['error'][:100]} (emotion will be disabled at runtime)")
        else:
            preds = (msg.get("prosody") or {}).get("predictions") or []
            top = sorted(preds[0]["emotions"], key=lambda e: -e["score"])[0]["name"] if preds else "no speech detected in test tone (fine)"
            line(OK, "Hume prosody", f"streaming OK in {round((time.perf_counter()-t0)*1000)} ms · {top}")
    except Exception as exc:  # noqa: BLE001
        line(FAIL, "Hume prosody", f"{type(exc).__name__}: {exc}")


async def check_stt() -> None:
    if os.getenv("GRADIUM_API_KEY"):
        line(OK, "Gradium STT", "key set (validated on first connection)")
    if os.getenv("DEEPGRAM_API_KEY"):
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get("https://api.deepgram.com/v1/projects", headers={"Authorization": f"Token {os.getenv('DEEPGRAM_API_KEY')}"})
            line(OK if r.status_code == 200 else FAIL, "Deepgram STT", f"HTTP {r.status_code}")
        except Exception as exc:  # noqa: BLE001
            line(FAIL, "Deepgram STT", f"{type(exc).__name__}: {exc}")
    if not os.getenv("GRADIUM_API_KEY") and not os.getenv("DEEPGRAM_API_KEY"):
        line(WARN, "STT", "no cloud STT key → local Whisper (slower first start, works offline)")


def check_gh() -> None:
    try:
        out = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, timeout=15)
        ok = "Logged in" in (out.stdout + out.stderr)
        repo = os.getenv("SAYSO_GITHUB_REPO") or "(auto-detect)"
        line(OK if ok else FAIL, "GitHub (gh)", f"{'authenticated' if ok else 'not logged in'} · issues go to {repo}")
    except Exception as exc:  # noqa: BLE001
        line(FAIL, "GitHub (gh)", f"{type(exc).__name__}: {exc}")


async def main() -> None:
    print("\nSayso pre-flight\n" + "─" * 60)
    await check_openai_compatible("SambaNova", os.getenv("SAMBANOVA_API_KEY"), os.getenv("SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1"), os.getenv("SAYSO_MODEL", "Meta-Llama-3.3-70B-Instruct"))
    await check_openai_compatible("General Compute", os.getenv("GENERAL_COMPUTE_API_KEY"), os.getenv("GENERAL_COMPUTE_BASE_URL", "https://api.generalcompute.com/v1"), "gemma-4-31B-it")
    await check_openai_compatible("OpenAI", os.getenv("OPENAI_API_KEY"), os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"), "gpt-4.1-mini")
    if not any(os.getenv(k) for k in ("SAMBANOVA_API_KEY", "GENERAL_COMPUTE_API_KEY", "OPENAI_API_KEY")):
        line(WARN, "LLM", "no key → local demo brain (scripted, fully offline)")
    await check_hume()
    await check_stt()
    check_gh()
    print("─" * 60)


if __name__ == "__main__":
    asyncio.run(main())
