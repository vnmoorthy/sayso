"""Environment-driven configuration and provider selection for Sayso."""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field
from pathlib import Path

VERSION = "0.1.0"

SAMBANOVA_MODELS = [
    "Meta-Llama-3.3-70B-Instruct",
    "DeepSeek-V3.1",
    "gpt-oss-120b",
    "MiniMax-M2.7",
    "DeepSeek-V3.2",
    "gemma-4-31B-it",
]
GENERAL_COMPUTE_MODELS = ["gemma-4-31B-it"]
OPENAI_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]
DEMO_MODELS = ["sayso-demo-brain"]

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


@dataclass
class Settings:
    """Resolved runtime settings."""

    # LLM
    llm_provider: str = "demo"  # sambanova | general_compute | openai | demo
    llm_model: str = DEMO_MODELS[0]
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_models: list[str] = field(default_factory=lambda: list(DEMO_MODELS))
    # STT
    stt_provider: str = "whisper-local"  # gradium | deepgram | whisper-mlx | whisper-local
    # TTS
    tts_provider: str = "kokoro"  # hume | kokoro (local neural voice) | browser
    hume_api_key: str | None = None
    hume_voice_id: str | None = None
    hume_voice_name: str = "Ava Song"
    # Emotion
    emotion_enabled: bool = False
    fake_emotion: bool = False
    # Workspace / actions
    workspace: Path = REPO_DIR / "workspace"
    github_repo: str | None = None
    open_system_browser: bool = False
    shell_timeout: float = 90.0
    demo_llm_port: int = 7861

    @property
    def mode(self) -> str:
        return "demo" if self.llm_provider == "demo" else "live"


def load_settings() -> Settings:
    """Build settings from environment variables with graceful fallbacks."""
    s = Settings()

    # ---- LLM provider selection -------------------------------------------------
    forced = (_env("SAYSO_LLM_PROVIDER") or "").lower()
    sn_key = _env("SAMBANOVA_API_KEY")
    gc_key = _env("GENERAL_COMPUTE_API_KEY")
    oa_key = _env("OPENAI_API_KEY")

    if forced == "sambanova" or (not forced and sn_key):
        s.llm_provider = "sambanova"
        s.llm_api_key = sn_key
        s.llm_base_url = _env("SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1")
        s.llm_models = list(SAMBANOVA_MODELS)
        s.llm_model = _env("SAYSO_MODEL", SAMBANOVA_MODELS[0]) or SAMBANOVA_MODELS[0]
    elif forced == "general_compute" or (not forced and gc_key):
        s.llm_provider = "general_compute"
        s.llm_api_key = gc_key
        s.llm_base_url = _env("GENERAL_COMPUTE_BASE_URL", "https://api.generalcompute.com/v1")
        s.llm_models = list(GENERAL_COMPUTE_MODELS)
        s.llm_model = _env("SAYSO_MODEL", GENERAL_COMPUTE_MODELS[0]) or GENERAL_COMPUTE_MODELS[0]
    elif forced == "openai" or (not forced and oa_key):
        s.llm_provider = "openai"
        s.llm_api_key = oa_key
        s.llm_base_url = _env("OPENAI_BASE_URL")
        s.llm_models = list(OPENAI_MODELS)
        s.llm_model = _env("SAYSO_MODEL", OPENAI_MODELS[0]) or OPENAI_MODELS[0]
    else:
        s.llm_provider = "demo"
        s.llm_api_key = "demo"
        s.llm_base_url = f"http://127.0.0.1:{s.demo_llm_port}/v1"
        s.llm_models = list(DEMO_MODELS)
        s.llm_model = DEMO_MODELS[0]

    # ---- STT -----------------------------------------------------------------------
    forced_stt = (_env("SAYSO_STT_PROVIDER") or "").lower()
    if forced_stt:
        s.stt_provider = forced_stt
    elif _env("GRADIUM_API_KEY"):
        s.stt_provider = "gradium"
    elif _env("DEEPGRAM_API_KEY"):
        s.stt_provider = "deepgram"
    elif platform.system() == "Darwin" and platform.machine() == "arm64":
        s.stt_provider = "whisper-mlx"
    else:
        s.stt_provider = "whisper-local"

    # ---- TTS / Hume ------------------------------------------------------------------
    s.hume_api_key = _env("HUME_API_KEY")
    s.hume_voice_id = _env("HUME_VOICE_ID")
    s.hume_voice_name = _env("HUME_VOICE_NAME", "Ava Song") or "Ava Song"
    forced_tts = (_env("SAYSO_TTS_PROVIDER") or "").lower()
    s.tts_provider = forced_tts or ("hume" if s.hume_api_key else "kokoro")
    s.emotion_enabled = bool(s.hume_api_key) and (_env("SAYSO_EMOTION", "1") != "0")
    s.fake_emotion = _env("SAYSO_FAKE_EMOTION", "0") == "1"

    # ---- Workspace & actions -------------------------------------------------------
    ws = _env("SAYSO_WORKSPACE")
    s.workspace = Path(ws).expanduser().resolve() if ws else (REPO_DIR / "workspace").resolve()
    s.workspace.mkdir(parents=True, exist_ok=True)
    s.github_repo = _env("SAYSO_GITHUB_REPO")
    s.open_system_browser = _env("SAYSO_OPEN_SYSTEM_BROWSER", "0") == "1"
    s.shell_timeout = float(_env("SAYSO_SHELL_TIMEOUT", "90") or 90)
    s.demo_llm_port = int(_env("SAYSO_DEMO_LLM_PORT", "7861") or 7861)
    return s
