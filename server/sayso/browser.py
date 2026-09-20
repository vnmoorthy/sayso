"""A real Chrome the agent can operate: open, search, click, type, scroll, read.

Every action returns a compact snapshot the LLM can reason about — page title, the visible
text, and a numbered list of interactive elements — and streams a screenshot to the UI's
Browser pane so the audience sees exactly what the agent sees.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
import time
from typing import Any
from urllib.parse import quote_plus

from loguru import logger

from .bus import emit

SNAPSHOT_JS = r"""
() => {
  const sel = 'a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [contenteditable=true], summary';
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > -200 && r.top < innerHeight * 2.5;
  };
  document.querySelectorAll('[data-sayso-id]').forEach((e) => e.removeAttribute('data-sayso-id'));
  const els = Array.from(document.querySelectorAll(sel)).filter(vis);
  const out = [];
  let n = 0;
  for (const e of els) {
    const tag = e.tagName.toLowerCase();
    const text = (e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || e.title || e.alt || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!text && tag !== 'input' && tag !== 'textarea' && tag !== 'select') continue;
    n += 1;
    e.setAttribute('data-sayso-id', String(n));
    const role = e.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (e.type || 'input') : tag);
    const item = { id: n, role, text };
    if (tag === 'a') item.href = (e.getAttribute('href') || '').slice(0, 120);
    if (tag === 'input' || tag === 'textarea') item.name = e.getAttribute('name') || e.getAttribute('id') || undefined;
    out.push(item);
    if (out.length >= 70) break;
  }
  const main = document.querySelector('main, article, [role=main], #content, .content') || document.body;
  const text = (main && main.innerText ? main.innerText : '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3200);
  return { url: location.href, title: document.title, text, elements: out, scrollY: Math.round(scrollY), scrollMax: Math.round(document.documentElement.scrollHeight - innerHeight) };
}
"""

KNOWN_SITES = {
    "hacker news": "https://news.ycombinator.com",
    "hackernews": "https://news.ycombinator.com",
    "google": "https://www.google.com",
    "youtube": "https://www.youtube.com",
    "github": "https://github.com",
    "wikipedia": "https://en.wikipedia.org",
    "reddit": "https://www.reddit.com",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "amazon": "https://www.amazon.com",
    "bbc": "https://www.bbc.com/news",
    "cnn": "https://www.cnn.com",
    "new york times": "https://www.nytimes.com",
    "nytimes": "https://www.nytimes.com",
    "product hunt": "https://www.producthunt.com",
    "stack overflow": "https://stackoverflow.com",
    "linkedin": "https://www.linkedin.com",
    "pipecat": "https://docs.pipecat.ai",
    "sambanova": "https://sambanova.ai",
    "hume": "https://www.hume.ai",
    "agi house": "https://agihouse.ai",
    "weather": "https://weather.com",
    "maps": "https://www.google.com/maps",
    "gmail": "https://mail.google.com",
    "duckduckgo": "https://duckduckgo.com",
}


def resolve_site(name: str) -> str:
    """Turn 'hacker news', 'github.com', 'https://…' into a URL."""
    n = (name or "").strip().strip('"\'.,!?').lower()
    n = re.sub(r"^(the\s+)?(website\s+|site\s+)?", "", n)
    if n in KNOWN_SITES:
        return KNOWN_SITES[n]
    for key, url in KNOWN_SITES.items():
        if n.startswith(key + " ") or n.endswith(" " + key):
            return url
    if re.match(r"^[a-z][a-z0-9+.-]*://", n):
        return n
    if re.match(r"^[\w.-]+\.[a-z]{2,}(/.*)?$", n):
        return "https://" + n
    return "https://duckduckgo.com/?q=" + quote_plus(name.strip())


class BrowserController:
    """One Chrome window/tab the agent drives through Playwright."""

    def __init__(self, headless: bool | None = None):
        self._headless = (os.getenv("SAYSO_BROWSER_HEADLESS", "1") != "0") if headless is None else headless
        self._pw = None
        self._browser = None
        self._page = None
        self._lock = asyncio.Lock()
        self.last_snapshot: dict[str, Any] | None = None

    # ------------------------------------------------------------------ lifecycle

    async def _ensure(self):
        if self._page is not None and not self._page.is_closed():
            return self._page
        from playwright.async_api import async_playwright

        if self._pw is None:
            self._pw = await async_playwright().start()
        if self._browser is None or not self._browser.is_connected():
            launch_kwargs: dict[str, Any] = {"headless": self._headless, "args": ["--disable-blink-features=AutomationControlled"]}
            try:
                self._browser = await self._pw.chromium.launch(channel="chrome", **launch_kwargs)
            except Exception as exc:  # noqa: BLE001 — no system Chrome; use Playwright's Chromium
                logger.warning(f"System Chrome unavailable ({exc}); using bundled Chromium")
                self._browser = await self._pw.chromium.launch(**launch_kwargs)
        context = await self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            locale="en-US",
        )
        self._page = await context.new_page()
        self._page.set_default_timeout(15000)
        logger.info(f"🌐 Chrome ready (headless={self._headless})")
        return self._page

    async def close(self) -> None:
        try:
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        except Exception:  # noqa: BLE001
            pass
        self._browser = None
        self._page = None
        self._pw = None

    # ------------------------------------------------------------------ helpers

    async def _settle(self, page) -> None:
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        try:
            await page.wait_for_load_state("networkidle", timeout=2500)
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(0.25)

    async def _snapshot(self, page) -> dict[str, Any]:
        try:
            snap = await page.evaluate(SNAPSHOT_JS)
        except Exception as exc:  # noqa: BLE001
            snap = {"url": page.url, "title": await page.title(), "text": "", "elements": [], "error": str(exc)[:120]}
        self.last_snapshot = snap
        return snap

    async def _frame(self, page, action: str) -> None:
        try:
            shot = await page.screenshot(type="jpeg", quality=55, full_page=False)
            await emit(
                {
                    "type": "browser_frame",
                    "image": "data:image/jpeg;base64," + base64.b64encode(shot).decode("ascii"),
                    "url": page.url,
                    "title": await page.title(),
                    "action": action,
                    "ts": time.time(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"screenshot failed: {exc}")

    async def _result(self, page, action: str, ok: bool = True, **extra) -> dict[str, Any]:
        snap = await self._snapshot(page)
        await self._frame(page, action)
        elements = snap.get("elements", [])
        summary = f"{snap.get('title') or page.url}"
        return {
            "ok": ok,
            "url": snap.get("url", page.url),
            "title": snap.get("title", ""),
            "text": snap.get("text", ""),
            "elements": elements,
            "scroll": {"y": snap.get("scrollY"), "max": snap.get("scrollMax")},
            "summary": summary,
            **extra,
        }

    async def _locator(self, page, element_id: int | None, text: str | None):
        if element_id is not None:
            loc = page.locator(f'[data-sayso-id="{int(element_id)}"]')
            if await loc.count() > 0:
                return loc.first
            raise ValueError(f"element {element_id} is no longer on the page — call browser_read and use a fresh id")
        if text:
            for cand in (
                page.get_by_role("link", name=text, exact=False),
                page.get_by_role("button", name=text, exact=False),
                page.get_by_text(text, exact=False),
                page.get_by_placeholder(text, exact=False),
                page.get_by_label(text, exact=False),
            ):
                try:
                    if await cand.count() > 0:
                        return cand.first
                except Exception:  # noqa: BLE001
                    continue
            raise ValueError(f"nothing on the page matches '{text}'")
        raise ValueError("give an element id (from the last page read) or a visible text")

    # ------------------------------------------------------------------ actions

    async def open(self, url: str) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            target = resolve_site(url)
            try:
                await page.goto(target, wait_until="domcontentloaded", timeout=25000)
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "open", ok=False, error=f"could not open {target}: {str(exc)[:120]}")
            await self._settle(page)
            return await self._result(page, "open")

    async def search(self, query: str) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            url = "https://duckduckgo.com/?q=" + quote_plus(query) + "&ia=web"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "search", ok=False, error=str(exc)[:120])
            await self._settle(page)
            return await self._result(page, "search", query=query)

    async def click(self, element_id: int | None = None, text: str | None = None) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            try:
                loc = await self._locator(page, element_id, text)
                try:
                    async with page.expect_navigation(timeout=4000):
                        await loc.click(timeout=8000)
                except Exception:  # noqa: BLE001 — no navigation happened; that's fine
                    pass
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "click", ok=False, error=str(exc)[:160])
            await self._settle(page)
            return await self._result(page, "click", clicked=text or element_id)

    async def type(self, text: str, element_id: int | None = None, field: str | None = None, press_enter: bool = True) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            try:
                if element_id is None and not field:
                    loc = page.locator("input:not([type=hidden]):visible, textarea:visible, [contenteditable=true]:visible").first
                else:
                    loc = await self._locator(page, element_id, field)
                await loc.click(timeout=8000)
                await loc.fill("")
                await loc.type(text, delay=20)
                if press_enter:
                    try:
                        async with page.expect_navigation(timeout=4000):
                            await loc.press("Enter")
                    except Exception:  # noqa: BLE001
                        pass
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "type", ok=False, error=str(exc)[:160])
            await self._settle(page)
            return await self._result(page, "type", typed=text)

    async def press(self, key: str) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            try:
                await page.keyboard.press(key)
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "press", ok=False, error=str(exc)[:120])
            await self._settle(page)
            return await self._result(page, "press", key=key)

    async def scroll(self, direction: str = "down", amount: int = 700) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            dy = -abs(amount) if str(direction).lower().startswith("u") else abs(amount)
            await page.mouse.wheel(0, dy)
            await asyncio.sleep(0.5)
            return await self._result(page, "scroll", direction=direction)

    async def back(self) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            try:
                await page.go_back(wait_until="domcontentloaded", timeout=15000)
            except Exception as exc:  # noqa: BLE001
                return await self._result(page, "back", ok=False, error=str(exc)[:120])
            await self._settle(page)
            return await self._result(page, "back")

    async def read(self) -> dict[str, Any]:
        async with self._lock:
            page = await self._ensure()
            return await self._result(page, "read")
