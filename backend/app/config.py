from pathlib import Path
import logging
import os

from dotenv import load_dotenv

_logger = logging.getLogger(__name__)


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
# Repo-root `.env` is primary for local dev; optional `backend/.env` fills missing keys.
load_dotenv(ROOT_DIR / ".env", override=True)
if (BACKEND_DIR / ".env").exists():
    load_dotenv(BACKEND_DIR / ".env", override=False)
OUTPUTS_DIR = Path(os.getenv("OUTPUTS_DIR", str(ROOT_DIR / "outputs")))
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

JOB_METADATA_FILENAME = "job.json"
SPEC_FILENAME = "spec.json"
MANIFEST_FILENAME = "manifest.json"

GENERATION_TIMEOUT_SECONDS = int(os.getenv("GENERATION_TIMEOUT_SECONDS", "45"))
GENERATION_MAX_RETRIES = int(os.getenv("GENERATION_MAX_RETRIES", "1"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL_RAW = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip() or "gpt-4o-mini"
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com").rstrip("/")
# OpenAI's Chat Completions API only accepts OpenAI deployment/model ids; DeepSeek ids → 404.
_if_openai_platform = "openai.com" in OPENAI_BASE_URL.lower()
_deepseek_like = "deepseek" in OPENAI_MODEL_RAW.lower()
if _if_openai_platform and _deepseek_like:
    OPENAI_MODEL = "gpt-4o-mini"
    _logger.warning(
        "OPENAI_MODEL=%r is not a valid OpenAI chat model id (you are calling %s). "
        "Using gpt-4o-mini for spec/chat. Use gpt-4o-mini or gpt-4o etc., or point OPENAI_BASE_URL at DeepSeek for deepseek-chat.",
        OPENAI_MODEL_RAW,
        OPENAI_BASE_URL,
    )
else:
    OPENAI_MODEL = OPENAI_MODEL_RAW
SPEC_LLM_TIMEOUT_SECONDS = int(os.getenv("SPEC_LLM_TIMEOUT_SECONDS", "20"))
SPEC_LLM_MAX_RETRIES = int(os.getenv("SPEC_LLM_MAX_RETRIES", "1"))
# Reference file analysis (vision + PDF file parts): larger payloads and slower than spec JSON.
ASSET_ANALYSIS_LLM_TIMEOUT_SECONDS = int(
    os.getenv("ASSET_ANALYSIS_LLM_TIMEOUT_SECONDS", "180")
)
ASSET_ANALYSIS_LLM_MAX_RETRIES = int(os.getenv("ASSET_ANALYSIS_LLM_MAX_RETRIES", "1"))

# Brand research (Tavily + chat JSON) before reference images
TAVILY_API_KEY = (os.getenv("TAVILY_API_KEY") or "").strip() or None
RESEARCH_LLM_TIMEOUT_SECONDS = int(os.getenv("RESEARCH_LLM_TIMEOUT_SECONDS", "120"))
RESEARCH_LLM_MAX_RETRIES = int(os.getenv("RESEARCH_LLM_MAX_RETRIES", "1"))
RESEARCH_TAVILY_MAX_RESULTS = int(os.getenv("RESEARCH_TAVILY_MAX_RESULTS", "5"))
RESEARCH_MAX_QUERIES = int(os.getenv("RESEARCH_MAX_QUERIES", "3"))

# Optional Backboard (https://docs.backboard.io/) for research synthesis, web search, thread documents, memory, asset analysis.
BACKBOARD_API_KEY = (os.getenv("BACKBOARD_API_KEY") or "").strip() or None
BACKBOARD_BASE_URL = (os.getenv("BACKBOARD_BASE_URL") or "https://app.backboard.io/api").rstrip("/")
BACKBOARD_ASSISTANT_ID = (os.getenv("BACKBOARD_ASSISTANT_ID") or "").strip() or None
BACKBOARD_LLM_PROVIDER = (os.getenv("BACKBOARD_LLM_PROVIDER") or "openai").strip() or "openai"
BACKBOARD_MODEL_NAME = (os.getenv("BACKBOARD_MODEL_NAME") or "gpt-4o").strip() or "gpt-4o"
BACKBOARD_HTTP_TIMEOUT_SECONDS = int(os.getenv("BACKBOARD_HTTP_TIMEOUT_SECONDS", "180"))
BACKBOARD_DOCUMENT_POLL_INTERVAL_SECONDS = float(os.getenv("BACKBOARD_DOCUMENT_POLL_INTERVAL_SECONDS", "2"))
BACKBOARD_DOCUMENT_POLL_MAX_SECONDS = int(os.getenv("BACKBOARD_DOCUMENT_POLL_MAX_SECONDS", "180"))
# Memory Lite on message sends: off | Auto | Readonly (see Backboard docs).
BACKBOARD_MEMORY = (os.getenv("BACKBOARD_MEMORY") or "off").strip() or "off"


def _env_truthy(name: str, default: str = "0") -> bool:
    return (os.getenv(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


# Requires BACKBOARD_API_KEY: use Backboard for brand-research JSON synthesis instead of OpenAI chat completions.
ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS = _env_truthy("ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS")
# Requires ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS: skip Tavily and use Backboard web_search Auto on the synthesis call.
ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY = _env_truthy("ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY")
# With Tavily snippets in the prompt, also enable Backboard web_search Auto (JSON output may be disabled by Backboard).
ARTIFEX_BACKBOARD_RESEARCH_MERGE_WEB = _env_truthy("ARTIFEX_BACKBOARD_RESEARCH_MERGE_WEB")
# Upload internal context strings as thread documents (RAG) before synthesis; requires BACKBOARD_API_KEY and ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS.
ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS = _env_truthy("ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS")
# Analyze uploaded reference assets via Backboard multipart /threads/messages (instead of OpenAI chat completions).
ARTIFEX_BACKBOARD_ASSET_ANALYSIS = _env_truthy("ARTIFEX_BACKBOARD_ASSET_ANALYSIS")

# Concept pipeline: image reference + image->3D
# Reference images use OpenAI Images: /v1/images/generations (typically api.openai.com).
# Reuse OPENAI_API_KEY for images when you're on OpenAI (default) or an unknown host —
# but not when OPENAI_BASE_URL is a known third-party API (DeepSeek, etc.): wrong key → HTTP 401.
_explicit_image_api_key = (os.getenv("IMAGE_OPENAI_API_KEY") or "").strip() or None
_llm_host_lower = OPENAI_BASE_URL.lower()
_third_party_chat_markers = (
    "deepseek",
    "anthropic",
    "groq",
    "together.xyz",
    "mistral",
    "cohere",
    "fireworks.ai",
    "perplexity",
)
_chat_is_third_party = any(m in _llm_host_lower for m in _third_party_chat_markers)
if _explicit_image_api_key:
    IMAGE_OPENAI_API_KEY = _explicit_image_api_key
elif OPENAI_API_KEY and not _chat_is_third_party:
    IMAGE_OPENAI_API_KEY = OPENAI_API_KEY.strip()
else:
    IMAGE_OPENAI_API_KEY = None

IMAGE_OPENAI_MODEL = os.getenv("IMAGE_OPENAI_MODEL", "gpt-image-1")
# Used when the client requests fast reference-image generation (POST /generate fast_reference_images=true).
IMAGE_OPENAI_MODEL_FAST = os.getenv("IMAGE_OPENAI_MODEL_FAST", "gpt-image-1-mini")
# Optional: GPT image model id for /v1/images/edits three-quarter view when IMAGE_OPENAI_MODEL is DALL-E (no image edits).
IMAGE_OPENAI_EDIT_MODEL = (os.getenv("IMAGE_OPENAI_EDIT_MODEL") or "").strip() or None
_default_openai_image_host = "https://api.openai.com"
if os.getenv("IMAGE_OPENAI_BASE_URL"):
    IMAGE_OPENAI_BASE_URL = os.getenv("IMAGE_OPENAI_BASE_URL", _default_openai_image_host)
elif OPENAI_BASE_URL and "openai.com" in OPENAI_BASE_URL.lower():
    IMAGE_OPENAI_BASE_URL = OPENAI_BASE_URL.rstrip("/")
else:
    IMAGE_OPENAI_BASE_URL = _default_openai_image_host
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
MESHY_AI_MODEL = os.getenv("MESHY_AI_MODEL", "latest")
# Meshy OpenAPI (create task, poll status, asset URLs): retries + per-attempt socket read timeout.
MESHY_HTTP_TIMEOUT_SECONDS = int(os.getenv("MESHY_HTTP_TIMEOUT_SECONDS", "120"))
MESHY_HTTP_RETRIES = int(os.getenv("MESHY_HTTP_RETRIES", "4"))
# GPT image models often exceed 60s; short timeouts surface as flaky failures while long hangs look "stuck".
CONCEPT_IMAGE_HTTP_TIMEOUT_SECONDS = int(os.getenv("CONCEPT_IMAGE_HTTP_TIMEOUT_SECONDS", "360"))
# Retries for connect/read timeouts and transient 5xx/429 from the image host.
CONCEPT_IMAGE_HTTP_RETRIES = int(os.getenv("CONCEPT_IMAGE_HTTP_RETRIES", "3"))

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")  # local | s3
S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL")

# Optional: deliver PNG previews and concept references via Cloudinary (CDN + URL transforms).
CLOUDINARY_CLOUD_NAME = (os.getenv("CLOUDINARY_CLOUD_NAME") or "").strip() or None
CLOUDINARY_API_KEY = (os.getenv("CLOUDINARY_API_KEY") or "").strip() or None
CLOUDINARY_API_SECRET = (os.getenv("CLOUDINARY_API_SECRET") or "").strip() or None

QUEUE_BACKEND = os.getenv("QUEUE_BACKEND", "inline")  # inline | rq
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RQ_QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "generation")

API_AUTH_TOKEN = os.getenv("API_AUTH_TOKEN")
DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID", "anonymous")

# Optional Composio (connected sources → context documents)
COMPOSIO_API_KEY = (os.getenv("COMPOSIO_API_KEY") or "").strip() or None
COMPOSIO_ALLOWED_TOOLKITS_RAW = os.getenv("COMPOSIO_ALLOWED_TOOLKITS", "")
COMPOSIO_FETCH_TIMEOUT_SECONDS = float(os.getenv("COMPOSIO_FETCH_TIMEOUT_SECONDS", "45"))
# Optional: pin a tool schema version for tools.execute() (must not be the string "latest").
COMPOSIO_TOOL_EXECUTE_VERSION = (os.getenv("COMPOSIO_TOOL_EXECUTE_VERSION") or "").strip() or None
COMPOSIO_DEFAULT_CALLBACK_URL = (os.getenv("COMPOSIO_OAUTH_CALLBACK_URL") or "").strip() or None
# Comma-separated URL prefixes; if set, POST /composio/connect callback_url must start with one.
_COMPOSIO_CB_PREFIXES_RAW = os.getenv("COMPOSIO_OAUTH_CALLBACK_URL_PREFIXES", "")


def canonical_composio_toolkit(part: str) -> str | None:
    """Map env/user input to Composio toolkit slugs used by auth_configs / link."""
    k = part.strip().lower().replace("-", "_")
    if k in ("googledrive", "google_drive", "drive"):
        return "googledrive"
    if k == "notion":
        return "notion"
    return None


def _parse_composio_allowed_toolkits(raw: str) -> list[str]:
    out: list[str] = []
    for part in (raw or "").split(","):
        slug = canonical_composio_toolkit(part)
        if slug and slug not in out:
            out.append(slug)
    return out


COMPOSIO_ALLOWED_TOOLKITS = _parse_composio_allowed_toolkits(COMPOSIO_ALLOWED_TOOLKITS_RAW)


def composio_oauth_callback_prefixes() -> list[str]:
    """Normalized prefixes (always end with '/') for validating user-supplied OAuth return URLs."""
    out: list[str] = []
    for part in _COMPOSIO_CB_PREFIXES_RAW.split(","):
        p = part.strip()
        if not p:
            continue
        out.append(p.rstrip("/") + "/")
    return out


def composio_feature_enabled() -> bool:
    return bool(COMPOSIO_API_KEY and COMPOSIO_ALLOWED_TOOLKITS)
