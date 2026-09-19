"""End-to-end *voice* test for Sayso — no microphone or browser needed.

Streams real spoken audio into a running Sayso server over WebRTC exactly the way the web app
does (Opus over SmallWebRTC + RTVI data channel), then reports what the pipeline did with it:
the transcript Whisper/Gradium produced, the tool calls the agent made, what it said back, and
whether audio came back from the voice (Kokoro/Hume).

    uv run scripts/voice_e2e.py                 # uses ../tests/speech/*.wav, generates them on macOS if missing
    uv run scripts/voice_e2e.py --server http://localhost:7860 --wavs /path/to/wavs

Utterances are the demo script. On macOS the WAVs are synthesised with `say` on first run.
"""

from __future__ import annotations

import argparse
import asyncio
import fractions
import json
import subprocess
import sys
import time
import uuid
import wave
from pathlib import Path

import httpx
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame

UTTERANCES = [
    ("Create a web app called pulse with a live clock and run it on port 8000", {"write_file", "start_background"}),
    ("Open it in the browser", {"open_url"}),
    ("Run the tests", {"run_shell"}),
    ("Fix it", {"write_file", "run_shell"}),
    ("Delete the pulse folder", {"run_shell"}),
    ("Yes, go ahead", {"resolve_confirmation"}),
]
SAMPLE_RATE = 16000
FRAME = int(SAMPLE_RATE * 0.02)  # 20 ms


def ensure_wavs(folder: Path) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, (text, _) in enumerate(UTTERANCES, 1):
        wav = folder / f"u{i}.wav"
        if not wav.exists():
            if sys.platform != "darwin":
                sys.exit(f"missing {wav}; generate 16 kHz mono WAVs for the utterances (macOS can do it with `say`)")
            aiff = folder / f"u{i}.aiff"
            subprocess.run(["say", "-v", "Samantha", "-r", "185", "-o", str(aiff), text], check=True)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)], check=True)
            aiff.unlink()
        paths.append(wav)
    return paths


class SpokenTrack(MediaStreamTrack):
    """A microphone that speaks WAV files on demand and silence otherwise."""

    kind = "audio"

    def __init__(self) -> None:
        super().__init__()
        self._pcm = b""
        self._pts = 0
        self._start: float | None = None

    def say(self, wav: Path) -> float:
        with wave.open(str(wav)) as w:
            assert w.getframerate() == SAMPLE_RATE and w.getnchannels() == 1, "need 16 kHz mono"
            data = w.readframes(w.getnframes())
        self._pcm += data + b"\x00" * (SAMPLE_RATE * 2)  # a second of silence to close the turn
        return len(data) / (SAMPLE_RATE * 2)

    async def recv(self) -> AudioFrame:
        if self._start is None:
            self._start = time.monotonic()
        wait = self._start + self._pts / SAMPLE_RATE - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        n = FRAME * 2
        chunk = self._pcm[:n]
        self._pcm = self._pcm[n:]
        if len(chunk) < n:
            chunk += b"\x00" * (n - len(chunk))
        frame = AudioFrame(format="s16", layout="mono", samples=FRAME)
        frame.planes[0].update(chunk)
        frame.sample_rate = SAMPLE_RATE
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, SAMPLE_RATE)
        self._pts += FRAME
        return frame


class Session:
    def __init__(self, server: str) -> None:
        self.server = server.rstrip("/")
        self.pc = RTCPeerConnection()
        self.channel = self.pc.createDataChannel("chat")
        self.mic = SpokenTrack()
        self.events: list[dict] = []
        self.last_event = time.monotonic()
        self.bot_ready = asyncio.Event()
        self.audio_frames = 0
        self.voiced_frames = 0
        self.pc.addTrack(self.mic)
        self.channel.on("message", self._on_message)
        self.pc.on("track", self._on_track)

    def _on_message(self, raw: str | bytes) -> None:
        try:
            msg = json.loads(raw)
        except Exception:  # noqa: BLE001
            return
        self.events.append(msg)
        self.last_event = time.monotonic()
        if msg.get("type") == "bot-ready":
            self.bot_ready.set()

    def _on_track(self, track: MediaStreamTrack) -> None:
        if track.kind != "audio":
            return

        async def drain() -> None:
            while True:
                try:
                    frame = await track.recv()
                except Exception:  # noqa: BLE001
                    return
                self.audio_frames += 1
                pcm = frame.to_ndarray()
                if pcm.size and float(np.abs(pcm.astype(np.float32)).mean()) > 50:
                    self.voiced_frames += 1

        asyncio.ensure_future(drain())

    async def connect(self) -> None:
        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{self.server}/api/offer", json={"sdp": self.pc.localDescription.sdp, "type": "offer"})
            r.raise_for_status()
            answer = r.json()
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        for _ in range(100):
            if self.channel.readyState == "open":
                break
            await asyncio.sleep(0.1)
        self.channel.send(
            json.dumps(
                {
                    "label": "rtvi-ai",
                    "type": "client-ready",
                    "id": uuid.uuid4().hex,
                    "data": {"version": "2.1.0", "about": {"library": "sayso-voice-e2e", "library_version": "0.1.0"}},
                }
            )
        )
        await asyncio.wait_for(self.bot_ready.wait(), 30)

    async def quiesce(self, idle: float = 3.0, limit: float = 40.0) -> None:
        start = time.monotonic()
        while time.monotonic() - start < limit:
            await asyncio.sleep(0.25)
            if time.monotonic() - self.last_event > idle and time.monotonic() - start > 2.0:
                return

    def take(self) -> list[dict]:
        out, self.events = self.events, []
        return out


def summarize(events: list[dict]) -> dict:
    transcript = ""
    tools: list[str] = []
    bot_text: list[str] = []
    ttft = None
    for e in events:
        t = e.get("type")
        d = e.get("data") or {}
        if t == "user-transcription" and d.get("final"):
            transcript = d.get("text", "")
        elif t == "bot-llm-text":
            bot_text.append(d.get("text", ""))
        elif t == "server-message":
            inner = d.get("data", d) if isinstance(d, dict) else {}
            if inner.get("type") == "tool_call":
                tools.append(inner.get("name", "?"))
            elif inner.get("type") == "llm_stats" and ttft is None:
                ttft = inner.get("ttft_ms")
    return {"transcript": transcript, "tools": tools, "bot": "".join(bot_text).strip(), "ttft_ms": ttft}


def overlap(a: str, b: str) -> float:
    wa = set(w.strip(".,!?").lower() for w in a.split())
    wb = set(w.strip(".,!?").lower() for w in b.split())
    return len(wa & wb) / max(1, len(wa))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://localhost:7860")
    ap.add_argument("--wavs", default=str(Path(__file__).resolve().parent.parent / "tests" / "speech"))
    args = ap.parse_args()
    wavs = ensure_wavs(Path(args.wavs))

    s = Session(args.server)
    t0 = time.monotonic()
    await s.connect()
    print(f"✅ connected + bot ready in {time.monotonic() - t0:.1f}s")
    await s.quiesce(idle=2.5, limit=20)
    greet = summarize(s.take())
    print(f"🗣  greeting: {greet['bot'][:90]!r}  (bot audio frames so far: {s.audio_frames}, voiced: {s.voiced_frames})")

    failures = 0
    for (text, expected), wav in zip(UTTERANCES, wavs):
        voiced_before = s.voiced_frames
        dur = s.mic.say(wav)
        await asyncio.sleep(dur + 0.5)
        await s.quiesce(idle=3.0, limit=45)
        r = summarize(s.take())
        heard = overlap(text, r["transcript"])
        tools_ok = expected.issubset(set(r["tools"]))
        spoke = s.voiced_frames > voiced_before
        ok = heard >= 0.5 and tools_ok
        failures += 0 if ok else 1
        print(f"\n{'✅' if ok else '❌'} said:  {text}")
        print(f"   heard: {r['transcript']!r}  (word overlap {heard:.0%})")
        print(f"   tools: {r['tools']}  expected ⊇ {sorted(expected)} → {'ok' if tools_ok else 'MISSING'}")
        print(f"   reply: {r['bot'][:110]!r}  · TTFT {r['ttft_ms']} ms · voice audio {'✓' if spoke else '— (no server TTS)'}")

    await s.pc.close()
    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILED'} · bot audio frames: {s.audio_frames} (voiced {s.voiced_frames})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
