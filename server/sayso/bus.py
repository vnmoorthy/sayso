"""Tiny event bus that forwards custom server messages to the connected client via RTVI."""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

_rtvi: Any | None = None
_pending: list[dict] = []


def set_rtvi(rtvi: Any | None) -> None:
    """Register the RTVI processor used to deliver server messages."""
    global _rtvi
    _rtvi = rtvi


async def emit(data: dict) -> None:
    """Send a custom message to the client (silently dropped if no client is attached)."""
    if _rtvi is None:
        _pending.append(data)
        if len(_pending) > 200:
            del _pending[:100]
        return
    try:
        await _rtvi.send_server_message(data)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"bus.emit failed: {exc}")


def emit_soon(data: dict) -> None:
    """Fire-and-forget variant for synchronous call sites."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(emit(data))
