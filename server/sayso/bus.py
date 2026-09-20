"""Tiny event bus that forwards custom server messages to the connected client via RTVI."""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

_rtvis: list[Any] = []


def set_rtvi(rtvi: Any | None) -> None:
    """Register (or, with None, clear) RTVI processors that receive server messages.

    Every connected client gets every message: a second tab (or a test client) must never
    steal the tool/browser events from the first.
    """
    if rtvi is None:
        _rtvis.clear()
    elif rtvi not in _rtvis:
        _rtvis.append(rtvi)


def remove_rtvi(rtvi: Any) -> None:
    try:
        _rtvis.remove(rtvi)
    except ValueError:
        pass


async def emit(data: dict) -> None:
    """Broadcast a custom message to every attached client (dropped if none)."""
    for rtvi in list(_rtvis):
        try:
            await rtvi.send_server_message(data)
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug(f"bus.emit to {rtvi} failed: {exc}")
            remove_rtvi(rtvi)


def emit_soon(data: dict) -> None:
    """Fire-and-forget variant for synchronous call sites."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(emit(data))
