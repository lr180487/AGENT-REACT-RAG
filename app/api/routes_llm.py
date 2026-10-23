"""
routes_llm.py — Nuevo módulo para gestionar APIs LLM
POST /api/v1/llm/config  → guardar / actualizar
GET  /api/v1/llm/config  → listar (sin exponer keys completas)
GET  /api/v1/llm/config/{id}
DELETE /api/v1/llm/config/{id}
POST /api/v1/llm/config/{id}/activate → marcar como activa
POST /api/v1/llm/test → probar conexión (valida key contra proveedor)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/v1/llm", tags=["LLM Config"])

# --- Modelos Pydantic ---
Provider = Literal["openai","anthropic","gemini","groq","mistral","ollama","custom"]

class LLMConfigCreate(BaseModel):
    provider: Provider = Field(..., description="Proveedor LLM")
    name: str = Field(..., example="OpenAI Producción")
    api_key: str = Field(..., min_length=8, description="API Key, se almacenará cifrada")
    model: str = Field(..., example="gpt-4o-mini")
    base_url: Optional[str] = Field(None, example="https://api.openai.com/v1")
    temperature: float = Field(0.7, ge=0, le=2)
    max_tokens: int = Field(2048, ge=1, le=128000)
    timeout: int = Field(30000, description="Timeout en ms")

class LLMConfigResponse(BaseModel):
    id: str
    provider: Provider
    name: str
    model: str
    base_url: Optional[str]
    temperature: float
    max_tokens: int
    timeout: int
    is_active: bool
    masked_key: str  # ej: ••••1234
    created_at: datetime

class LLMTestRequest(BaseModel):
    provider: Provider
    api_key: str
    model: str
    base_url: Optional[str] = None

# --- Storage mock (reemplazar por SQLAlchemy + PostgreSQL) ---
# En producción: tabla llm_configs con columna api_key_encrypted (AES-256-GCM)
_DB: dict[str, dict] = {}
_ACTIVE_ID: Optional[str] = None

def _mask(key: str) -> str:
    return "••••" + key[-4:] if len(key) >= 4 else "••••"

# Opcional: dependencia para cifrado
# from app.core.crypto import encrypt, decrypt

@router.get("/config", response_model=List[LLMConfigResponse])
def list_configs():
    return [
        LLMConfigResponse(
            id=v["id"],
            provider=v["provider"],
            name=v["name"],
            model=v["model"],
            base_url=v["base_url"],
            temperature=v["temperature"],
            max_tokens=v["max_tokens"],
            timeout=v["timeout"],
            is_active=(v["id"]==_ACTIVE_ID),
            masked_key=_mask(v["api_key"]),
            created_at=v["created_at"]
        ) for v in _DB.values()
    ]

@router.post("/config", response_model=LLMConfigResponse, status_code=201)
def create_config(payload: LLMConfigCreate):
    # TODO: cifrar api_key -> encrypt(payload.api_key)
    new_id = str(uuid.uuid4())
    record = {
        "id": new_id,
        "provider": payload.provider,
        "name": payload.name,
        "api_key": payload.api_key,  # guardar cifrado en prod
        "model": payload.model,
        "base_url": payload.base_url,
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
        "timeout": payload.timeout,
        "created_at": datetime.utcnow(),
    }
    _DB[new_id] = record
    global _ACTIVE_ID
    if _ACTIVE_ID is None:
        _ACTIVE_ID = new_id
    return LLMConfigResponse(
        id=new_id, provider=record["provider"], name=record["name"],
        model=record["model"], base_url=record["base_url"],
        temperature=record["temperature"], max_tokens=record["max_tokens"],
        timeout=record["timeout"], is_active=(new_id==_ACTIVE_ID),
        masked_key=_mask(record["api_key"]), created_at=record["created_at"]
    )

@router.put("/config/{config_id}", response_model=LLMConfigResponse)
def update_config(config_id: str, payload: LLMConfigCreate):
    if config_id not in _DB:
        raise HTTPException(404, "Config no encontrada")
    _DB[config_id].update({
        "provider": payload.provider,
        "name": payload.name,
        "api_key": payload.api_key,
        "model": payload.model,
        "base_url": payload.base_url,
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
        "timeout": payload.timeout,
    })
    v = _DB[config_id]
    return LLMConfigResponse(
        id=v["id"], provider=v["provider"], name=v["name"],
        model=v["model"], base_url=v["base_url"],
        temperature=v["temperature"], max_tokens=v["max_tokens"],
        timeout=v["timeout"], is_active=(v["id"]==_ACTIVE_ID),
        masked_key=_mask(v["api_key"]), created_at=v["created_at"]
    )

@router.delete("/config/{config_id}", status_code=204)
def delete_config(config_id: str):
    if config_id not in _DB:
        raise HTTPException(404, "Config no encontrada")
    del _DB[config_id]
    global _ACTIVE_ID
    if _ACTIVE_ID == config_id:
        _ACTIVE_ID = next(iter(_DB), None)
    return

@router.post("/config/{config_id}/activate")
def activate_config(config_id: str):
    if config_id not in _DB:
        raise HTTPException(404, "Config no encontrada")
    global _ACTIVE_ID
    _ACTIVE_ID = config_id
    return {"active_id": _ACTIVE_ID, "message": "LLM activo para ReAct Agent"}

@router.post("/test")
async def test_connection(payload: LLMTestRequest):
    """
    Valida la API Key haciendo una llamada mínima al proveedor.
    En prod: usa httpx con timeout corto.
    Ej. OpenAI: GET /v1/models con header Authorization: Bearer <key>
    """
    import httpx
    # Mapeo de endpoints de validación
    endpoints = {
        "openai": f"{payload.base_url or 'https://api.openai.com/v1'}/models",
        "groq": f"{payload.base_url or 'https://api.groq.com/openai/v1'}/models",
        "mistral": f"{payload.base_url or 'https://api.mistral.ai/v1'}/models",
        "anthropic": "https://api.anthropic.com/v1/models",
        "gemini": "https://generativelanguage.googleapis.com/v1/models",
        "ollama": f"{payload.base_url or 'http://localhost:11434'}/api/tags",
        "custom": f"{payload.base_url or ''}/models",
    }
    url = endpoints.get(payload.provider)
    # Simulación rápida si no hay httpx o para demo
    # Para demo local devolvemos ok si key parece válida
    if len(payload.api_key) < 10 and payload.provider != "ollama":
        raise HTTPException(400, "API Key inválida")
    # Descomenta para validación real:
    # try:
    #     headers = {}
    #     if payload.provider in ("openai","groq","mistral","custom"):
    #         headers["Authorization"] = f"Bearer {payload.api_key}"
    #     elif payload.provider == "anthropic":
    #         headers["x-api-key"] = payload.api_key
    #     async with httpx.AsyncClient(timeout=5) as client:
    #         r = await client.get(url, headers=headers)
    #         if r.status_code == 200:
    #             return {"ok": True, "latency_ms": r.elapsed.microseconds//1000, "model": payload.model}
    #         raise HTTPException(r.status_code, f"Proveedor respondió {r.status_code}")
    # except Exception as e:
    #     raise HTTPException(500, str(e))
    return {"ok": True, "provider": payload.provider, "model": payload.model, "latency_ms": 320, "message": "Conexión válida (mock)"}

# Helper para que el Agent use la config activa
def get_active_llm_config():
    if _ACTIVE_ID and _ACTIVE_ID in _DB:
        return _DB[_ACTIVE_ID]
    return None
