# Sayso — 3-minute demo storyboard

> Talk track for the 10-slide deck (`docs/deck/Sayso.pptx`). Timings assume a brisk pace; the live demo is the centrepiece — slides 4–7 are spoken *over* the live app, not read.
>
> **Setup (before you're called):** server running (`uv run bot.py`), web app on screen (`npm run dev`), workspace reset, `pulse` server not running, mic tested. Have the say-so card colour and the HUD visible. Volume up.

| Beat | Slide | Time | What the audience sees | What you say |
|---|---|---|---|---|
| 1 | 1 · Title | 0:00–0:15 | Title slide with the orb and wordmark | "I'm [name]. This is **Sayso** — your terminal, on your say-so. You talk; it runs your terminal, your browser and your GitHub. And it listens to *how* you say it." |
| 2 | 2 · Problem | 0:15–0:35 | Three pains: dead air · flat voice · toy demos | "Voice agents today have three problems. They're slow — you talk, then you wait. They're flat — every reply sounds the same whether you're delighted or furious. And they don't *do* anything; they narrate. Developers meanwhile live in three windows — terminal, browser, GitHub — and switch between them a hundred times a day." |
| 3 | 3 · Idea | 0:35–0:50 | One sentence + the two hackathon tracks | "Sayso collapses those windows into one conversation. It's voice-controlled software *and* an agent that acts — both tracks. Built today on SambaNova, Hume and Pipecat." |
| 4 | 4 · Live demo | 0:50–2:10 | **Switch to the app.** | Press Connect. Sayso greets you. Then, out loud: |
| 4a | | | Files appear in the Files pane; the process tray shows `pulse :8000`; HUD shows TTFT and tok/s | **"Create a web app called pulse with a live clock and run it on port 8000."** — "Watch the right side. Two files written, a server started, and look at the HUD: that's SambaNova — first token in a couple hundred milliseconds, hundreds of tokens a second. The whole turn, three tool calls, is over before I finish this sentence." |
| 4b | | | Browser pane shows the running clock | **"Open it in the browser."** — "It's live. Served from the workspace, rendered right here." |
| 4c | | | Emotion badge flips to *Frustration*, orb goes amber-red, `voice: calm, warm, reassuring`; file rewritten | Put real annoyance in your voice: **"Ugh, the clock is tiny — make it huge and neon."** — "Did you hear that? Hume's prosody model scored my tone, the orb changed, and Sayso's *voice* softened — those are Octave acting instructions being retuned live. Same words, different delivery, because I sounded annoyed." |
| 4d | | | Terminal streams the failing unittest, exit 1 in red | **"Run the tests."** — "One fails. Output streams as it happens — nothing is hidden behind a spinner." |
| 4e | | | Rewrite + re-run, green ✓; orb goes lime | **"Fix it."** — "Rewrite, re-run, green. And notice the voice again — brighter, because I did sound pleased." |
| 4f | | | Actions rail shows a GitHub card with the issue number and link | **"File a GitHub issue to add dark mode."** — "That's a real issue, on a real repo, via the authenticated GitHub CLI. Agents that act — not narrate." |
| 4g | | | Amber **say-so card**: `rm -rf pulse`, reason: recursive delete | **"Delete the pulse folder."** — "Here's the part I care most about. Every command is classified before it runs. Destructive ones stop at the *say-so gate* — I approve by clicking, or just by saying…" **"Yes."** — "…gone. Sandboxed to the workspace, transparent, and reversible up to the moment I say so." |
| 5 | 5 · Architecture | 2:10–2:30 | Pipeline diagram | "Under the hood it's one Pipecat pipeline: WebRTC in, a Hume emotion processor scoring my speech, STT, then a SambaNova model doing function calling against a toolbox — shell, processes, files, browser, GitHub — behind the safety gate, then Hume Octave out. Every tool streams RTVI events to the UI, so the screen *is* the audit log." |
| 6 | 6 · Speed | 2:30–2:40 | HUD close-up + why throughput matters | "Why silicon speed matters: a tool-heavy turn is hundreds of tokens of JSON. At hundreds of tokens a second that's sub-second; on slower inference it's dead air. Speed isn't a nicety for voice — it's the difference between a colleague and a phone tree." |
| 7 | 7 · Voice that listens | 2:40–2:48 | 48 emotions → 8 moods → acting instructions | "Hume gives us 48 emotions; we collapse them into eight moods that steer both the words and the voice." |
| 8 | 8 · Safety | 2:48–2:53 | Say-so gate | "And the say-so gate means a voice agent with root-level power is still safe to run." |
| 9 | 9 · Built today | 2:53–2:58 | Stack + repo link | "All of this is open source at github.com/vnmoorthy/sayso — twelve tools, a keyless demo mode, and a pre-flight script so you can run it in ten minutes." |
| 10 | 10 · Next | 2:58–3:00 | Roadmap: phone-in, Unitree Go2, multi-agent | "Next: phone-in via Twilio, and yes — the same brain on a Unitree Go2. *Sayso, fetch.* Thank you." |

## Fallbacks

- **Mic trouble:** type the same commands in the composer — the pipeline is identical.
- **Wi-Fi trouble:** unset the keys → demo brain + browser speech; the whole script still runs offline.
- **Emotion not firing:** speak in a longer, clearly annoyed sentence (≥ 1.5 s of audio) — the scorer needs a real utterance.
- **Port 8000 busy:** say "run it on port 8010" instead.

## One-liners to have ready

- "It doesn't transcribe your commands. It *executes* them."
- "The screen is the audit log."
- "Speed is the feature. Emotion is the difference."
