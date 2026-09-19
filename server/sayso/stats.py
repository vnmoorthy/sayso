"""LLM throughput stats (time-to-first-token, tokens/second) streamed to the UI."""

from __future__ import annotations

import time
from typing import Callable

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    MetricsFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from .bus import emit


class LLMStatsProcessor(FrameProcessor):
    """Sits right after the LLM and measures how fast the silicon is talking."""

    def __init__(self, *, model_getter: Callable[[], str], **kwargs):
        super().__init__(**kwargs)
        self._model_getter = model_getter
        self._t_start: float | None = None
        self._t_first: float | None = None
        self._t_last: float | None = None
        self._chars = 0
        self._usage_tokens: int | None = None
        self.history: list[dict] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._t_start = time.monotonic()
            self._t_first = None
            self._t_last = None
            self._chars = 0
            self._usage_tokens = None
        elif isinstance(frame, LLMTextFrame) and self._t_start is not None:
            now = time.monotonic()
            if self._t_first is None:
                self._t_first = now
            self._t_last = now
            self._chars += len(frame.text or "")
        elif isinstance(frame, MetricsFrame):
            for item in frame.data:
                if isinstance(item, LLMUsageMetricsData):
                    try:
                        self._usage_tokens = int(item.value.completion_tokens)
                    except Exception:  # noqa: BLE001
                        pass
        elif isinstance(frame, LLMFullResponseEndFrame) and self._t_start is not None:
            await self._report()
            self._t_start = None

        await self.push_frame(frame, direction)

    async def _report(self) -> None:
        end = time.monotonic()
        total_ms = round((end - (self._t_start or end)) * 1000)
        if self._t_first is None:
            return  # tool-call-only turn; nothing was spoken
        ttft_ms = round((self._t_first - (self._t_start or self._t_first)) * 1000)
        tokens = self._usage_tokens if self._usage_tokens else max(1, round(self._chars / 4))
        gen_seconds = max(0.001, (self._t_last or end) - self._t_first)
        tps = round(tokens / gen_seconds) if tokens > 1 else 0
        stats = {
            "type": "llm_stats",
            "ttft_ms": ttft_ms,
            "total_ms": total_ms,
            "tokens": tokens,
            "tps": tps,
            "estimated": self._usage_tokens is None,
            "model": self._model_getter(),
        }
        self.history.append(stats)
        if len(self.history) > 50:
            del self.history[:25]
        await emit(stats)
