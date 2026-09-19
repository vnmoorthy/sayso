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

from sayso.config import VERSION, load_settings  # noqa: E402

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
from pipecat.frames.frames import LLMMessagesAppendFrame, LLMRunFrame, LLMUpdateSettingsFrame, TTSUpdateSettingsFrame  # noqa: E402
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

from sayso import bus  # noqa: E402
from sayso.emotion import HumeEmotionProcessor  # noqa: E402
from sayso.prompts import GREETING_INSTRUCTION, SYSTEM_PROMPT  # noqa: E402
from sayso.stats import LLMStatsProcessor  # noqa: E402
from sayso.tools import Toolbox  # noqa: E402

# Import the STT backend up front (torch/mlx imports are slow) so connects are instant.
if SETTINGS.stt_provider == "whisper-mlx":
    logger.info("Warming local Whisper (MLX)…")
    from pipecat.services.whisper.stt import MLXModel, WhisperSTTServiceMLX  # noqa: E402,F401
elif SETTINGS.stt_provider == "whisper-local":
    logger.info("Warming local Whisper (faster-whisper)…")
    from pipecat.services.whisper.stt import Model, WhisperSTTService  # noqa: E402,F401

logger.info("✅ Components loaded")

TOOLBOX = Toolbox(SETTINGS)


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
    label = {"general_compute": "General Compute", "openai": "OpenAI", "demo": "demo brain"}[SETTINGS.llm_provider]
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


async def build_tts():
    if SETTINGS.tts_provider != "hume":
        logger.info("TTS: none on server → browser speech synthesis fallback")
        return None, [], None
    from pipecat.services.hume.tts import HumeTTSService

    voice_id, voices = await resolve_hume_voice()
    if not voice_id:
        logger.warning("Hume key present but no voice id resolved; set HUME_VOICE_ID. Falling back to browser TTS.")
        return None, voices, None
    logger.info(f"TTS: Hume Octave voice={voice_id}")
    tts = HumeTTSService(
        api_key=SETTINGS.hume_api_key,
        settings=HumeTTSService.Settings(voice=voice_id, description="confident, friendly, crisp", speed=1.05),
    )
    return tts, voices, voice_id


# --------------------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------------------


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    logger.info("Starting Sayso pipeline")

    toolbox = TOOLBOX
    stt = build_stt()
    llm = build_llm()
    tts, voices, voice_id = await build_tts()
    current = {"model": SETTINGS.llm_model, "voice": voice_id}

    toolbox.register(llm)

    rtvi = RTVIProcessor()
    bus.set_rtvi(rtvi)

    tts_settings_cls = type(tts).Settings if tts is not None else None
    emotion = HumeEmotionProcessor(
        api_key=SETTINGS.hume_api_key,
        enabled=SETTINGS.emotion_enabled,
        fake=SETTINGS.fake_emotion,
        tts_settings_cls=tts_settings_cls,
    )
    stats = LLMStatsProcessor(model_getter=lambda: current["model"])

    context = LLMContext(tools=toolbox.schemas())
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    processors = [transport.input(), rtvi, emotion, stt, user_aggregator, llm, stats]
    if tts is not None:
        processors.append(tts)
    processors += [transport.output(), assistant_aggregator]
    pipeline = Pipeline(processors)

    task = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=[RTVIObserver(rtvi)],
    )

    async def send_status() -> None:
        await bus.emit(
            {
                "type": "status",
                "mode": SETTINGS.mode,
                "llm": {"provider": SETTINGS.llm_provider, "model": current["model"], "models": SETTINGS.llm_models},
                "stt": SETTINGS.stt_provider,
                "tts": "hume" if tts is not None else "browser",
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
                    await rtvi_processor.push_frame(TTSUpdateSettingsFrame(delta=type(tts).Settings(voice=voice)))
                    await bus.emit({"type": "notice", "level": "info", "text": "Voice updated"})
                    await send_status()
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
        bus.set_rtvi(None)
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
