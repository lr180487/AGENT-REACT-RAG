# config.py — Configuración central PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN
# Soporta PostgreSQL con fallback SQLite + Upstash + LLM dinámico + límites ReAct
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os
import pathlib

# Detecta ruta .env: busca en varios niveles para soportar uvicorn desde raíz o app/
_ENV_CANDIDATES = [
    pathlib.Path("/home/user/agente_react_rag/.env"),
    pathlib.Path(__file__).resolve().parent.parent / ".env",  # agente_react_rag/.env
    pathlib.Path(__file__).resolve().parent / ".env",          # app/.env
    pathlib.Path.cwd() / ".env",
    pathlib.Path(__file__).resolve().parents[2] / ".env",
]

def _find_env():
    for p in _ENV_CANDIDATES:
        if p.exists():
            return str(p)
    return ".env"

class Settings(BaseSettings):
    # ── App ──
    APP_NAME: str = Field(default="agente_react_rag")
    VERSION: str = Field(default="2.1.0")
    ENV: str = Field(default="development")  # development | production | test
    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=8000)
    DEBUG: bool = Field(default=False)
    LOG_LEVEL: str = Field(default="INFO")

    # ── Database — PostgreSQL primario + SQLite fallback ──
    # Ejemplo postgres: postgresql://user:pass@localhost:5432/react_rag
    # Ejemplo docker:    postgresql://postgres:postgres@postgres:5432/react_rag
    # Fallback automático: si falla o es placeholder, usa sqlite:////home/user/agente_react_rag/app/data/app.db
    DATABASE_URL: str = Field(default="postgresql://user:pass@localhost:5432/react_rag")
    DATABASE_FALLBACK: str = Field(default="sqlite")  # sqlite | none
    SQLITE_PATH: str = Field(default="")  # vacío = app/data/app.db automático

    # ── Redis / Upstash (L2) ──
    REDIS_URL: str = Field(default="redis://localhost:6379/0")
    UPSTASH_REDIS_URL: Optional[str] = Field(default=None)
    UPSTASH_REDIS_TOKEN: Optional[str] = Field(default=None)

    # ── LLM dinámico (fallback .env si no hay DB llm_configs) ──
    LLM_PROVIDER: str = Field(default="openai")  # openai | anthropic | gemini | groq | mistral | ollama | custom
    LLM_MODEL: str = Field(default="gpt-4o-mini")
    LLM_BASE_URL: Optional[str] = Field(default="https://api.openai.com/v1")
    LLM_TEMPERATURE: float = Field(default=0.7)
    LLM_MAX_TOKENS: int = Field(default=2048)
    LLM_TIMEOUT_MS: int = Field(default=15000)

    # Keys fallback (si no se usa POST /api/v1/llm/config)
    OPENAI_API_KEY: Optional[str] = Field(default=None)
    ANTHROPIC_API_KEY: Optional[str] = Field(default=None)
    GEMINI_API_KEY: Optional[str] = Field(default=None)
    GROQ_API_KEY: Optional[str] = Field(default=None)
    MISTRAL_API_KEY: Optional[str] = Field(default=None)
    OLLAMA_BASE_URL: str = Field(default="http://localhost:11434")

    # ── Seguridad ──
    SECRET_KEY: str = Field(default="dev-secret-change-in-production-32chars!")
    ENCRYPTION_KEY: str = Field(default="32bytes-key-for-aes-256-gcm-!!!!")

    # ── RAG / Embeddings ──
    EMBEDDING_MODEL: str = Field(default="text-embedding-3-small")
    EMBEDDING_DIM: int = Field(default=1536)
    CHUNK_SIZE: int = Field(default=800)
    CHUNK_OVERLAP: int = Field(default=120)
    PGVECTOR_DIM: int = Field(default=1536)

    # ── Web Search ──
    TAVILY_API_KEY: Optional[str] = Field(default=None)
    SERPAPI_API_KEY: Optional[str] = Field(default=None)
    WEB_SEARCH_PROVIDER: str = Field(default="tavily")  # tavily | duckduckgo | serpapi

    # ── ReAct — Control del razonamiento (razonamiento.md §8) ──
    MAX_ITERATIONS: int = Field(default=8, description="Límite de ciclos ReAct")
    MAX_TOOL_CALLS: int = Field(default=10, description="Límite total de tool calls por run")
    TOOL_TIMEOUT: int = Field(default=15, description="Timeout por tool en segundos")
    TOKEN_LIMIT: int = Field(default=8000, description="Límite de tokens por run")
    REACT_TIMEOUT: int = Field(default=45, description="Timeout global ReAct en segundos")

    # ── Memoria — TTLs (memoria.md §9) ──
    LRU_MAX_SIZE: int = Field(default=512, description="L1 LRU max entries")
    LRU_TTL_SECONDS: int = Field(default=300, description="5 min para respuesta temporal")
    UPSTASH_TTL_SECONDS: int = Field(default=1800, description="30 min para web_search")
    SESSION_TTL_SECONDS: int = Field(default=3600, description="TTL sesión Upstash")
    UPSTASH_ENABLED: bool = Field(default=False)

    # ── Caché ──
    CACHE_ENABLED: bool = Field(default=True)

    # ── Acción — Controles (accion.md §7-11) ──
    HUMAN_IN_THE_LOOP: bool = Field(default=False, description="Requiere aprobación para escrituras críticas")
    IDEMPOTENCY_ENABLED: bool = Field(default=True)
    CIRCUIT_BREAKER_ENABLED: bool = Field(default=True)
    RATE_LIMIT_RPS: int = Field(default=10)

    # ── Frontend / WebSocket ──
    FRONTEND_URL: str = Field(default="http://localhost:8000/frontend")
    CORS_ORIGINS: str = Field(default="*")
    WS_LANGCHAIN_PATH: str = Field(default="/ws/langchain")
    WS_HEARTBEAT_INTERVAL: int = Field(default=2)

    # ── Uploads ──
    MAX_UPLOAD_MB: int = Field(default=20)
    ALLOWED_EXTENSIONS: str = Field(default="pdf,docx,doc,xlsx,xls,ppt,pptx,csv,txt,md,png,jpg,jpeg")

    class Config:
        env_file = _find_env()
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"  # ignora variables extra (ej. DATABASE_URL de e2b)

# Instancia global
settings = Settings()

# ── Helper para resolver config LLM activa ──
def get_llm_runtime_config(db_session=None):
    """
    1. Buscar en DB llm_configs donde is_active=True
    2. Si no hay o falla, usar fallback de .env
    Soporta tanto PostgreSQL como SQLite (mismo modelo).
    """
    if db_session is not None:
        try:
            from app.db.models_llm import LLMConfig
            # Intenta importar decrypt, si no existe usa valor plano
            try:
                from app.core.crypto import decrypt
                def _dec(v): return decrypt(v)
            except Exception:
                def _dec(v): return v  # fallback sin cifrado
            active = db_session.query(LLMConfig).filter(LLMConfig.is_active == True).first()
            if active:
                api_key = _dec(active.api_key_encrypted) if hasattr(active, 'api_key_encrypted') else getattr(active, 'api_key', None)
                return {
                    "provider": active.provider,
                    "model": active.model,
                    "api_key": api_key,
                    "base_url": active.base_url,
                    "temperature": active.temperature,
                    "max_tokens": active.max_tokens,
                    "timeout": getattr(active, 'timeout', settings.LLM_TIMEOUT_MS),
                    "source": "db",
                }
        except Exception as e:
            # No loggear warning ruidoso si DB vacía
            pass
    # fallback .env
    key_map = {
        "openai": settings.OPENAI_API_KEY,
        "anthropic": settings.ANTHROPIC_API_KEY,
        "gemini": settings.GEMINI_API_KEY,
        "groq": settings.GROQ_API_KEY,
        "mistral": settings.MISTRAL_API_KEY,
    }
    return {
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_MODEL,
        "api_key": key_map.get(settings.LLM_PROVIDER),
        "base_url": settings.LLM_BASE_URL,
        "temperature": settings.LLM_TEMPERATURE,
        "max_tokens": settings.LLM_MAX_TOKENS,
        "timeout": settings.LLM_TIMEOUT_MS,
        "source": "env",
    }

def get_database_url_resolved() -> str:
    """Retorna DATABASE_URL resuelto con fallback a SQLite si es placeholder o falla."""
    url = settings.DATABASE_URL or ""
    # Si es placeholder de ejemplo en dev, usa SQLite
    placeholders = ["user:pass", "postgres:postgres@localhost"]
    if url and any(p in url for p in placeholders) and settings.ENV == "development":
        from app.db.database import SQLITE_URL
        return SQLITE_URL
    if not url or url.strip() == "":
        from app.db.database import SQLITE_URL
        return SQLITE_URL
    return url
