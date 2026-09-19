"""Hume expression measurement: hear *how* the user speaks and adapt the agent's voice.

A frame processor that buffers the user's speech, sends it to Hume's streaming prosody model
when they stop talking, and then:
  * emits an `emotion` message to the UI (orb colour, emotion badge),
  * retunes Hume Octave TTS acting instructions so the reply *sounds* right,
  * drops a short tone note into the LLM context so the reply *reads* right.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import struct
import time
import wave
from typing import Any

import websockets
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    LLMMessagesAppendFrame,
    TTSUpdateSettingsFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from .bus import emit

HUME_STREAM_URL = "wss://api.hume.ai/v0/stream/models"
MAX_SECONDS = 5.0  # Hume streaming accepts up to ~5s of audio per message
MIN_SECONDS = 0.45

MOOD_GROUPS: dict[str, set[str]] = {
    "frustrated": {"Anger", "Annoyance", "Contempt", "Disgust", "Disappointment", "Disapproval", "Frustration"},
    "stressed": {"Anxiety", "Distress", "Fear", "Horror", "Pain", "Embarrassment"},
    "confused": {"Confusion", "Doubt", "Awkwardness"},
    "excited": {"Excitement", "Enthusiasm", "Ecstasy", "Triumph", "Surprise (positive)", "Awe", "Determination"},
    "happy": {"Joy", "Amusement", "Satisfaction", "Pride", "Love", "Gratitude", "Admiration", "Adoration", "Relief", "Contentment"},
    "calm": {"Calmness", "Concentration", "Interest", "Contemplation", "Realization"},
    "sad": {"Sadness", "Tiredness", "Boredom", "Guilt", "Shame", "Empathic Pain", "Nostalgia"},
}

VOICE_STYLE: dict[str, str] = {
    "neutral": "confident, friendly, crisp",
    "calm": "calm, steady, warm",
    "excited": "upbeat, bright, energetic",
    "happy": "warm, cheerful, light",
    "frustrated": "calm, warm, reassuring, unhurried",
    "stressed": "gentle, grounded, reassuring",
    "confused": "patient, clear, gently pedagogical",
    "sad": "soft, gentle, empathetic",
}


def mood_from_emotions(emotions: list[dict[str, float]]) -> tuple[str, float]:
    """Collapse Hume's 48 emotions into one of Sayso's moods."""
    totals: dict[str, float] = {m: 0.0 for m in MOOD_GROUPS}
    for e in emotions:
        for mood, names in MOOD_GROUPS.items():
            if e["name"] in names:
                totals[mood] += float(e["score"])
    mood, score = max(totals.items(), key=lambda kv: kv[1])
    if score < 0.12:
        return "neutral", score
    return mood, score


def pcm16_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def rms_db(pcm: bytes) -> float:
    n = len(pcm) // 2
    if n == 0:
        return -96.0
    samples = struct.unpack(f"<{n}h", pcm[: n * 2])
    mean_sq = sum(s * s for s in samples) / n
    return 20 * math.log10(math.sqrt(mean_sq) / 32768 + 1e-9)


class HumeEmotionProcessor(FrameProcessor):
    """Buffers user speech and scores it with Hume's prosody model."""

    def __init__(
        self,
        *,
        api_key: str | None,
        enabled: bool,
        fake: bool = False,
        tts_settings_cls: Any | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._api_key = api_key
        self._enabled = enabled and bool(api_key)
        self._fake = fake and not self._enabled
        self._tts_settings_cls = tts_settings_cls
        self._buf = bytearray()
        self._recording = False
        self._sample_rate = 16000
        self._channels = 1
        self._last_mood = "neutral"
        self._error_logged = False
        self._inflight: asyncio.Task | None = None

    @property
    def active(self) -> bool:
        return self._enabled or self._fake

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if self.active:
            if isinstance(frame, UserStartedSpeakingFrame):
                self._buf = bytearray()
                self._recording = True
            elif isinstance(frame, InputAudioRawFrame) and self._recording:
                self._sample_rate = frame.sample_rate or self._sample_rate
                self._channels = frame.num_channels or 1
                self._buf.extend(frame.audio)
                max_bytes = int(MAX_SECONDS * self._sample_rate * 2 * self._channels)
                if len(self._buf) > max_bytes:
                    del self._buf[: len(self._buf) - max_bytes]
            elif isinstance(frame, UserStoppedSpeakingFrame):
                self._recording = False
                audio = bytes(self._buf)
                seconds = len(audio) / (2 * self._channels * self._sample_rate)
                if seconds >= MIN_SECONDS:
                    if self._inflight and not self._inflight.done():
                        self._inflight.cancel()
                    self._inflight = asyncio.create_task(self._analyze(audio, seconds))

        await self.push_frame(frame, direction)

    # ------------------------------------------------------------------------------

    async def _analyze(self, audio: bytes, seconds: float) -> None:
        t0 = time.monotonic()
        try:
            if self._enabled:
                emotions = await self._score_with_hume(audio)
                simulated = False
            else:
                emotions = self._fake_emotions(audio, seconds)
                simulated = True
        except Exception as exc:  # noqa: BLE001
            if not self._error_logged:
                logger.warning(f"Hume emotion scoring failed: {exc}")
                self._error_logged = True
            return
        if not emotions:
            return

        emotions.sort(key=lambda e: e["score"], reverse=True)
        mood, mood_score = mood_from_emotions(emotions)
        top = emotions[0]
        style = VOICE_STYLE.get(mood, VOICE_STYLE["neutral"])
        latency = round((time.monotonic() - t0) * 1000)
        logger.info(f"🎭 tone: {mood} ({mood_score:.2f}) top={top['name']} {top['score']:.2f} in {latency}ms")

        await emit(
            {
                "type": "emotion",
                "top": top["name"],
                "score": round(float(top["score"]), 3),
                "mood": mood,
                "emotions": [{"name": e["name"], "score": round(float(e["score"]), 3)} for e in emotions[:6]],
                "voice_style": style,
                "simulated": simulated,
                "latency_ms": latency,
            }
        )

        # Retune the voice (Hume Octave acting instructions) when the mood shifts.
        if self._tts_settings_cls is not None and mood != self._last_mood:
            try:
                await self.push_frame(TTSUpdateSettingsFrame(delta=self._tts_settings_cls(description=style)))
            except Exception as exc:  # noqa: BLE001
                logger.debug(f"TTS settings update skipped: {exc}")
        self._last_mood = mood

        # Let the LLM adapt its wording, without triggering a run by itself.
        top3 = ", ".join(f"{e['name']} {e['score']:.2f}" for e in emotions[:3])
        note = f"[User tone: {mood} ({mood_score:.2f}); top emotions: {top3}. Adapt your tone; do not mention this note.]"
        await self.push_frame(LLMMessagesAppendFrame(messages=[{"role": "system", "content": note}], run_llm=False))

    async def _score_with_hume(self, audio: bytes) -> list[dict[str, float]]:
        wav = pcm16_to_wav(audio, self._sample_rate, self._channels)
        payload = json.dumps({"models": {"prosody": {}}, "data": base64.b64encode(wav).decode("ascii")})
        url = f"{HUME_STREAM_URL}?apikey={self._api_key}"
        async with websockets.connect(url, max_size=16 * 1024 * 1024, open_timeout=8) as ws:
            await ws.send(payload)
            raw = await asyncio.wait_for(ws.recv(), 10)
        msg = json.loads(raw)
        if "error" in msg:
            raise RuntimeError(msg.get("error"))
        predictions = (msg.get("prosody") or {}).get("predictions") or []
        if not predictions:
            return []
        acc: dict[str, list[float]] = {}
        for pred in predictions:
            for e in pred.get("emotions", []):
                acc.setdefault(e["name"], []).append(float(e["score"]))
        return [{"name": name, "score": sum(v) / len(v)} for name, v in acc.items()]

    def _fake_emotions(self, audio: bytes, seconds: float) -> list[dict[str, float]]:
        """Crude, clearly-labelled stand-in used only when SAYSO_FAKE_EMOTION=1 and no Hume key."""
        loud = rms_db(audio)
        energy = min(1.0, max(0.0, (loud + 40) / 30))  # -40dB..-10dB -> 0..1
        if energy > 0.7 and seconds < 2.5:
            return [{"name": "Excitement", "score": 0.35 + 0.3 * energy}, {"name": "Interest", "score": 0.3}, {"name": "Determination", "score": 0.2}]
        if energy > 0.55 and seconds >= 2.5:
            return [{"name": "Annoyance", "score": 0.3 + 0.3 * energy}, {"name": "Determination", "score": 0.25}, {"name": "Concentration", "score": 0.2}]
        if energy < 0.25:
            return [{"name": "Calmness", "score": 0.4}, {"name": "Contemplation", "score": 0.25}, {"name": "Interest", "score": 0.2}]
        return [{"name": "Interest", "score": 0.32}, {"name": "Concentration", "score": 0.28}, {"name": "Calmness", "score": 0.2}]
