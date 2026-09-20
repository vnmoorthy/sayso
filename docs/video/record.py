"""Record the demo video of the *live* Sayso app with Playwright (no microphone needed).

    cd server && uv run ../docs/video/record.py            # writes docs/video/raw.webm

Drives the real web app against the running server: connects, then types the demo script
into the composer with pauses so every tool call, terminal stream, browser frame and
say-so card is captured. Narration is added afterwards with docs/video/assemble.sh.
"""

from __future__ import annotations

import asyncio
import shutil
import sys
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
APP = "http://localhost:5173/"
W, H = 1600, 1000

BEATS = [
    ("Create a web app called pulse with a live clock and run it on port 8000", 9),
    ("Open it in the browser", 7),
    ("Run the tests", 8),
    ("Fix it", 8),
    ("Open hacker news", 9),
    ("Search for pipecat voice agents", 9),
    ("Delete the pulse folder", 7),
    ("Yes, go ahead", 7),
]


async def main() -> int:
    out_dir = HERE / "_rec"
    shutil.rmtree(out_dir, ignore_errors=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--autoplay-policy=no-user-gesture-required"])
        context = await browser.new_context(viewport={"width": W, "height": H}, record_video_dir=str(out_dir), record_video_size={"width": W, "height": H})
        page = await context.new_page()
        await page.goto(APP, wait_until="networkidle")
        await asyncio.sleep(2.5)
        await page.get_by_role("button", name="Connect").first.click()
        for _ in range(60):
            if await page.get_by_label("Message Sayso").count() and await page.get_by_label("Message Sayso").is_enabled():
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(6)  # greeting
        for text, wait in BEATS:
            box = page.get_by_label("Message Sayso")
            await box.click()
            await box.type(text, delay=28)
            await asyncio.sleep(0.4)
            await box.press("Enter")
            await asyncio.sleep(wait)
        await asyncio.sleep(3)
        video = page.video
        await context.close()
        await browser.close()
        path = await video.path() if video else None
    if not path:
        print("no video produced", file=sys.stderr)
        return 1
    final = HERE / "raw.webm"
    shutil.move(path, final)
    shutil.rmtree(out_dir, ignore_errors=True)
    print(f"✓ {final} ({final.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
