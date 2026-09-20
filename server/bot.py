#
# Sayso — your terminal, on your say-so.
#
# A voice-native developer agent built with Pipecat: SambaNova for conversation-speed
# inference, Hume for an expressive voice that listens to how you feel, and a toolbox
# that runs your terminal, files, browser and GitHub.
#
# Run:  uv run bot.py        then open the web app (http://localhost:5173)
#

from __future__ import annotations

import os
import platform
import sys

from dotenv import load_dotenv
from loguru import logger

load_dotenv(override=True)

from sayso.config import SERVER_DIR, VERSION, load_settings  # noqa: E402

SETTINGS = load_settings()

print("🎙  Sayso server starting…")
print(f"    mode={SETTINGS.mode}  llm={SETTINGS.llm_provider}:{SETTINGS.llm_model}  stt={SETTINGS.stt_provider}  tts={SETTINGS.tts_provider}")
print(f"    workspace={SETTINGS.workspace}")

if SETTINGS.llm_provider == "demo":
    from sayso.demo_llm_server import start_demo_llm_server  # noqa: E402

    SETTINGS.demo_llm_port = start_demo_llm_server(SETTINGS.demo_llm_port)
    SETTINGS.llm_base_url = f"http://127.0.0.1:{SETTINGS.demo_llm_port}/v1"

logger.info("Loading Silero VAD…")
from pipecat.audio.vad.silero import SileroVADAnalyzer  # noqa: E402

logger.info("Loading pipeline components…")
import httpx  # noqa: E402
from pipecat.frames.frames import (  # noqa: E402
    ErrorFrame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    LLMUpdateSettingsFrame,
    ManuallySwitchServiceFrame,
    TTSUpdateSettingsFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed  # noqa: E402
from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyFailover  # noqa: E402
from pipecat.pipeline.pipeline import Pipeline  # noqa: E402
from pipecat.pipeline.task import PipelineParams  # noqa: E402
from pipecat.pipeline.worker import PipelineWorker  # noqa: E402
from pipecat.workers.runner import WorkerRunner  # noqa: E402
from pipecat.processors.aggregators.llm_context import LLMContext  # noqa: E402
from pipecat.processors.aggregators.llm_response_universal import (  # noqa: E402
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi.observer import RTVIObserver  # noqa: E402
from pipecat.processors.frameworks.rtvi.processor import RTVIProcessor  # noqa: E402
from pipecat.runner.types import RunnerArguments  # noqa: E402
from pipecat.runner.utils import create_transport  # noqa: E402
from pipecat.services.openai.llm import OpenAILLMService  # noqa: E402
from pipecat.transports.base_transport import BaseTransport, TransportParams  # noqa: E402

from fastapi.responses import Response  # noqa: E402
from pipecat.runner.run import app as runner_app  # noqa: E402

from sayso import browser as browser_mod  # noqa: E402
from sayso import bus  # noqa: E402
from sayso.emotion import HumeEmotionProcessor  # noqa: E402
from sayso.prompts import GREETING_INSTRUCTION, SYSTEM_PROMPT  # noqa: E402
from sayso.stats import LLMStatsProcessor  # noqa: E402
from sayso.tools import Toolbox  # noqa: E402

# Import the STT backend up front (torch/mlx imports are slow) so connects are instant.
if SETTINGS.stt_provider == "whisper-mlx":
    logger.info("Warming local Whisper (MLX)…")
    from pipecat.services.whisper.stt import MLXModel, WhisperSTTServiceMLX  # noqa: E402,F401

    try:  # load the weights now (first transcription otherwise pays a multi-second cold start)
        import mlx_whisper  # noqa: E402
        import numpy as _np  # noqa: E402

        _whisper_model = os.getenv("SAYSO_WHISPER_MODEL") or str(MLXModel.LARGE_V3_TURBO_Q4)
        # Same call shape as Pipecat's service so the cached weights match its dtype.
        mlx_whisper.transcribe(_np.zeros(16000, dtype=_np.float32), path_or_hf_repo=_whisper_model, language="en")
        logger.info(f"Whisper {_whisper_model} warm")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Whisper warm-up skipped: {exc}")
elif SETTINGS.stt_provider == "whisper-local":
    logger.info("Warming local Whisper (faster-whisper)…")
    from pipecat.services.whisper.stt import Model, WhisperSTTService  # noqa: E402,F401

if SETTINGS.tts_provider == "kokoro":
    try:
        from pipecat.services.kokoro.tts import KOKORO_CACHE_DIR, _ensure_model_files  # noqa: E402

        _ensure_model_files(KOKORO_CACHE_DIR / "kokoro-v1.0.onnx", KOKORO_CACHE_DIR / "voices-v1.0.bin")
        logger.info("Kokoro voice model ready")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Kokoro model prefetch failed: {exc}")

logger.info("✅ Components loaded")

TOOLBOX = Toolbox(SETTINGS)


@runner_app.get("/frames/{frame_id}.jpg", include_in_schema=False)
async def get_browser_frame(frame_id: str):
    """Latest screenshots from the agent's Chrome, referenced by browser_frame messages."""
    data = browser_mod.FRAMES.get(frame_id)
    if not data:
        return Response(status_code=404)
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def _shutdown_processes() -> None:
    """Best-effort cleanup of background processes when the server exits."""
    import signal as _signal

    for mp in list(TOOLBOX.procs.procs.values()):
        try:
            os.killpg(os.getpgid(mp.proc.pid), _signal.SIGTERM)
        except Exception:  # noqa: BLE001
            pass


import atexit  # noqa: E402

atexit.register(_shutdown_processes)


# --------------------------------------------------------------------------------------
# Service factories
# --------------------------------------------------------------------------------------


def build_stt():
    provider = SETTINGS.stt_provider
    if provider == "gradium":
        from pipecat.services.gradium.stt import GradiumSTTService

        logger.info("STT: Gradium")
        return GradiumSTTService(api_key=os.getenv("GRADIUM_API_KEY"))
    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        logger.info("STT: Deepgram")
        return DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
    if provider == "whisper-mlx":
        from pipecat.services.whisper.stt import MLXModel, WhisperSTTServiceMLX

        model = os.getenv("SAYSO_WHISPER_MODEL") or MLXModel.LARGE_V3_TURBO_Q4
        logger.info(f"STT: local Whisper (MLX) {model}")
        return WhisperSTTServiceMLX(settings=WhisperSTTServiceMLX.Settings(model=model))
    from pipecat.services.whisper.stt import Model, WhisperSTTService

    model = os.getenv("SAYSO_WHISPER_MODEL") or Model.DISTIL_MEDIUM_EN
    logger.info(f"STT: local Whisper (faster-whisper) {model}")
    return WhisperSTTService(settings=WhisperSTTService.Settings(model=model))


def build_llm():
    common = dict(
        temperature=0.4,
        max_tokens=900,
        system_instruction=SYSTEM_PROMPT
        + f"\nWorkspace: {SETTINGS.workspace}\nOS: {platform.system()} {platform.machine()}.",
    )
    if SETTINGS.llm_provider == "sambanova":
        from pipecat.services.sambanova.llm import SambaNovaLLMService

        logger.info(f"LLM: SambaNova {SETTINGS.llm_model} @ {SETTINGS.llm_base_url}")
        return SambaNovaLLMService(
            api_key=SETTINGS.llm_api_key,
            base_url=SETTINGS.llm_base_url,
            settings=SambaNovaLLMService.Settings(model=SETTINGS.llm_model, **common),
        )
    label = {"general_compute": "General Compute", "openai": "OpenAI", "demo": "demo brain", "local": "local MLX model"}.get(SETTINGS.llm_provider, SETTINGS.llm_provider)
    logger.info(f"LLM: {label} {SETTINGS.llm_model} @ {SETTINGS.llm_base_url or 'default'}")
    kwargs = {"api_key": SETTINGS.llm_api_key}
    if SETTINGS.llm_base_url:
        kwargs["base_url"] = SETTINGS.llm_base_url
    return OpenAILLMService(settings=OpenAILLMService.Settings(model=SETTINGS.llm_model, **common), **kwargs)


async def resolve_hume_voice() -> tuple[str | None, list[dict]]:
    """Pick a Hume voice id (env override, else by name from the Voice Library)."""
    voices: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.hume.ai/v0/tts/voices",
                params={"provider": "HUME_AI", "page_size": 100},
                headers={"X-Hume-Api-Key": SETTINGS.hume_api_key or ""},
            )
            if resp.status_code == 200:
                data = resp.json()
                raw = data.get("voices_page") or data.get("voices") or data.get("data") or []
                voices = [{"id": v.get("id"), "name": v.get("name")} for v in raw if v.get("id")]
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not list Hume voices: {exc}")
    voice_id = SETTINGS.hume_voice_id
    if not voice_id and voices:
        wanted = SETTINGS.hume_voice_name.lower()
        match = next((v for v in voices if (v["name"] or "").lower() == wanted), None)
        voice_id = (match or voices[0])["id"]
    return voice_id, voices[:40]


KOKORO_VOICES = [
    {"id": "af_heart", "name": "Heart (Kokoro, local)"},
    {"id": "af_bella", "name": "Bella (Kokoro, local)"},
    {"id": "af_nicole", "name": "Nicole (Kokoro, local)"},
    {"id": "af_sky", "name": "Sky (Kokoro, local)"},
    {"id": "am_adam", "name": "Adam (Kokoro, local)"},
    {"id": "am_michael", "name": "Michael (Kokoro, local)"},
    {"id": "bf_emma", "name": "Emma (Kokoro, local, British)"},
    {"id": "bm_george", "name": "George (Kokoro, local, British)"},
]


async def build_tts():
    if SETTINGS.tts_provider == "kokoro":
        from pipecat.services.kokoro.tts import KokoroTTSService

        voice = os.getenv("KOKORO_VOICE", "af_heart")
        logger.info(f"TTS: Kokoro (local neural voice) {voice}")
        try:
            tts = KokoroTTSService(settings=KokoroTTSService.Settings(voice=voice, speed=1.05))
            return tts, KOKORO_VOICES, voice
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Kokoro unavailable ({exc}); falling back to browser speech")
            return None, [], None
    if SETTINGS.tts_provider != "hume":
        logger.info("TTS: none on server → browser speech synthesis fallback")
        return None, [], None
    from pipecat.services.hume.tts import HumeTTSService

    voice_id, voices = await resolve_hume_voice()
    if not voice_id:
        logger.warning("Hume key present but no voice id resolved (API busy?); using the local Kokoro voice instead.")
        SETTINGS.tts_provider = "kokoro"
        return await build_tts()
    if not SETTINGS.hume_voice_id:
        # Remember the resolved id so restarts don't hit the voices endpoint again.
        try:
            env_path = SERVER_DIR / ".env"
            if env_path.exists() and "HUME_VOICE_ID=" not in env_path.read_text():
                with env_path.open("a") as fh:
                    fh.write(f"\nHUME_VOICE_ID={voice_id}\n")
                logger.info("Cached HUME_VOICE_ID in .env")
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"could not cache voice id: {exc}")
    logger.info(f"TTS: Hume Octave voice={voice_id}")
    tts = HumeTTSService(
        api_key=SETTINGS.hume_api_key,
        settings=HumeTTSService.Settings(voice=voice_id, description="confident, friendly, crisp", speed=1.05),
    )
    return tts, voices, voice_id


class TTSFailoverObserver(BaseObserver):
    """Hand the voice to the local Kokoro model when the cloud voice can't deliver.

    Cloud TTS can rate-limit (429), reject a key, or finish a sentence with no audio in the
    middle of a demo. Any of those from the primary voice flips the ServiceSwitcher to the
    fallback so the agent never goes silent; the UI is told what happened.
    """

    TRIGGERS = ("429", "quota", "rate limit", "too many requests", "no audio", "401", "402", "403")

    def __init__(self, *, primary, fallback, queue_frame, on_switch, **kwargs):
        super().__init__(**kwargs)
        self._primary = primary
        self._fallback = fallback
        self._queue_frame = queue_frame
        self._on_switch = on_switch
        self._switched = False

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if self._switched or not isinstance(frame, ErrorFrame) or frame.fatal:
            return
        origin = getattr(frame, "processor", None) or data.source
        if origin is not self._primary:
            return
        text = str(frame.error).lower()
        if not any(trigger in text for trigger in self.TRIGGERS):
            return
        self._switched = True
        logger.warning(f"Cloud voice unavailable ({text[:80]}…) → switching to the local Kokoro voice")
        await self._queue_frame(ManuallySwitchServiceFrame(service=self._fallback))
        await self._on_switch()


# --------------------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------------------


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    logger.info("Starting Sayso pipeline")

    toolbox = TOOLBOX
    stt = build_stt()
    llm = build_llm()
    tts, voices, voice_id = await build_tts()
    current = {"model": SETTINGS.llm_model, "voice": voice_id, "tts": SETTINGS.tts_provider if tts is not None else "browser"}

    # Local fallback voice behind the cloud voice: quota/rate-limit/no-audio → Kokoro.
    fallback_tts = None
    if tts is not None and SETTINGS.tts_provider == "hume":
        try:
            from pipecat.services.kokoro.tts import KokoroTTSService

            fallback_tts = KokoroTTSService(
                settings=KokoroTTSService.Settings(voice=os.getenv("KOKORO_VOICE", "af_heart"), speed=1.05)
            )
            voices = voices + KOKORO_VOICES
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"No local fallback voice ({exc})")
    tts_stage = tts
    if fallback_tts is not None:
        tts_stage = ServiceSwitcher([tts, fallback_tts], strategy_type=ServiceSwitcherStrategyFailover)

    toolbox.register(llm)

    rtvi = RTVIProcessor()
    bus.set_rtvi(rtvi)

    tts_settings_cls = type(tts).Settings if (tts is not None and SETTINGS.tts_provider == "hume") else None
    emotion = HumeEmotionProcessor(
        api_key=SETTINGS.hume_api_key,
        enabled=SETTINGS.emotion_enabled,
        fake=SETTINGS.fake_emotion or os.getenv("SAYSO_EMOTION", "1") != "0",
        tts_settings_cls=tts_settings_cls,
        tts_service=tts if tts_settings_cls else None,
    )
    stats = LLMStatsProcessor(model_getter=lambda: current["model"])

    context = LLMContext(tools=toolbox.schemas())
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    processors = [transport.input(), rtvi, stt, emotion, user_aggregator, llm, stats]
    if tts_stage is not None:
        processors.append(tts_stage)
    processors += [transport.output(), assistant_aggregator]
    pipeline = Pipeline(processors)

    observers = [RTVIObserver(rtvi)]

    async def on_voice_switched() -> None:
        current["tts"] = "kokoro"
        await bus.emit({"type": "notice", "level": "warn", "text": "Hume voice rate-limited — switched to the local Kokoro voice"})
        await send_status()

    if fallback_tts is not None:
        observers.append(
            TTSFailoverObserver(
                primary=tts,
                fallback=fallback_tts,
                queue_frame=lambda frame: task.queue_frame(frame),
                on_switch=on_voice_switched,
            )
        )

        @tts_stage.strategy.event_handler("on_service_switched")
        async def on_service_switched(strategy, service):
            current["tts"] = "kokoro" if service is fallback_tts else "hume"
            await send_status()

    task = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=observers,
    )

    async def send_status() -> None:
        await bus.emit(
            {
                "type": "status",
                "mode": SETTINGS.mode,
                "llm": {"provider": SETTINGS.llm_provider, "model": current["model"], "models": SETTINGS.llm_models},
                "stt": SETTINGS.stt_provider,
                "tts": current["tts"],
                "emotion": emotion.active,
                "workspace": str(SETTINGS.workspace),
                "voices": voices,
                "voice": current["voice"],
                "version": VERSION,
                "processes": toolbox.procs.snapshot(),
                "github_repo": SETTINGS.github_repo,
            }
        )

    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi_processor):
        await rtvi_processor.set_bot_ready()
        await send_status()

    @rtvi.event_handler("on_client_message")
    async def on_client_message(rtvi_processor, message):
        mtype = getattr(message, "type", None)
        data = getattr(message, "data", None) or {}
        logger.info(f"client message: {mtype} {data}")
        try:
            if mtype == "confirm":
                cid = str(data.get("id", ""))
                approved = bool(data.get("approved", False))
                result = await toolbox.resolve_confirmation("ui_" + cid, cid, approved)
                await bus.emit(
                    {"type": "tool_result", "id": "ui_" + cid, "name": "resolve_confirmation", "ok": bool(result.get("ok", True)),
                     "summary": str(result.get("summary", ""))[:200], "result": result, "duration_ms": int(result.get("duration_ms", 0) or 0)}
                )
                note = (
                    f"[The user {'approved' if approved else 'denied'} the pending command on screen. "
                    f"Outcome: {result.get('summary', '')}. Tell them in one short sentence.]"
                )
                await rtvi_processor.push_frame(
                    LLMMessagesAppendFrame(messages=[{"role": "system", "content": note}], run_llm=True)
                )
            elif mtype == "set_model":
                model = str(data.get("model", "")).strip()
                if model:
                    current["model"] = model
                    await rtvi_processor.push_frame(LLMUpdateSettingsFrame(delta=type(llm).Settings(model=model)))
                    await bus.emit({"type": "notice", "level": "info", "text": f"Model switched to {model}"})
                    await send_status()
            elif mtype == "set_voice":
                voice = str(data.get("voice", "")).strip()
                if voice and tts is not None:
                    current["voice"] = voice
                    target = fallback_tts if (fallback_tts is not None and voice.startswith(("af_", "am_", "bf_", "bm_"))) else tts
                    await rtvi_processor.push_frame(TTSUpdateSettingsFrame(delta=type(target).Settings(voice=voice), service=target))
                    await bus.emit({"type": "notice", "level": "info", "text": "Voice updated"})
                    await send_status()
            elif mtype == "say":
                # Typed input: add it straight to the context and run the model, exactly like
                # the greeting does. This bypasses the user-turn machinery, which can hold
                # runs hostage after a clipped turn (mute mid-sentence, stray room audio).
                text = str(data.get("text", "")).strip()
                if text:
                    context.add_message({"role": "user", "content": text})
                    await task.queue_frames([LLMRunFrame()])
            elif mtype == "get_status":
                await send_status()
            elif mtype == "stop_all":
                result = await toolbox.procs.stop_all()
                await bus.emit({"type": "notice", "level": "info", "text": result["summary"]})
            elif mtype == "reset_workspace":
                result = await toolbox._do_reset()
                await bus.emit({"type": "notice", "level": "info", "text": result["summary"]})
            else:
                logger.debug(f"unhandled client message type {mtype}")
        except Exception as exc:  # noqa: BLE001
            logger.exception("client message handling failed")
            await bus.emit({"type": "notice", "level": "error", "text": f"{type(exc).__name__}: {exc}"})

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")
        context.add_message({"role": "system", "content": GREETING_INSTRUCTION})
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected (background processes keep running until the server exits)")
        bus.remove_rtvi(rtvi)
        await task.cancel()

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(task)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    """Entry point used by the Pipecat development runner."""
    transport_params = {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
        ),
    }
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    if "--host" not in sys.argv:
        sys.argv += ["--host", os.getenv("SAYSO_HOST", "0.0.0.0")]
    if "--port" not in sys.argv:
        sys.argv += ["--port", os.getenv("SAYSO_PORT", "7860")]
    main()
