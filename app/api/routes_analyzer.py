"""
routes_analyzer.py — ENDPOINTS PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → RESPONSE
Flujo mejorado:
  Usuario → FastAPI → Percepción (valida/normaliza) → Razonamiento ReAct (8 iter) → Memoria (L1→L4) → Acción (Tool Router + cache) → RESPONSE (5) → USER

Compatibilidad: mantiene /analyze, /process, /execute legados + nuevos /react y /perception
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import os
import logging

from app.services.analyzer_service import AnalyzerService
from app.services.processor_service import ProcessorService
from app.services.response_service import ResponseService

# Nuevos servicios ReAct
try:
    from app.services.react_agent import ReactAgent
    from app.services.perception_service import PerceptionService
    from app.db.database import SessionLocal
    _has_react = True
except Exception as e:
    _has_react = False
    logging.warning(f"ReactAgent no disponible: {e}")

router = APIRouter(prefix="/api/v1/analyzer", tags=["Analyzer → Processor → Response"])

# ---------- Schemas ----------
class AnalyzeRequest(BaseModel):
    text: str = Field(..., example="Analiza el contrato y busca penalidades por demora")
    chat_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None

class ProcessorRequest(BaseModel):
    query: str = Field(..., example="penalidades por demora")
    plan: List[Dict[str, Any]] = Field(..., example=[{"tool": "web_search"}, {"tool": "rag"}])
    chat_id: Optional[str] = None

class ExecuteRequest(BaseModel):
    text: str = Field(..., example="Analiza X y busca información sobre Y")
    chat_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None

class ReactRequest(BaseModel):
    text: str = Field(..., example="Analiza el crecimiento de ventas del 25% y busca información complementaria.")
    chat_id: Optional[str] = Field(None, example="chat_abc123")
    user_id: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None

class PerceptionRequest(BaseModel):
    text: str = Field(..., example="Analiza   el crecimiento de ventas: 25%")
    source: str = Field("user", example="user")
    chat_id: Optional[str] = None

# ---------- Helpers LLM ----------
def get_active_llm():
    try:
        from app.api.routes_llm import _DB as LLM_DB, _ACTIVE_ID
        if _ACTIVE_ID and _ACTIVE_ID in LLM_DB:
            c = LLM_DB[_ACTIVE_ID]
            return {"provider": c["provider"], "model": c["model"], "api_key": c["api_key"], "temperature": c.get("temperature",0.7), "source": "db"}
    except: pass
    # Intenta DB llm_configs (postgres/sqlite)
    try:
        from app.db.database import SessionLocal as SL
        from app.config import get_llm_runtime_config
        db = SL()
        try:
            cfg = get_llm_runtime_config(db)
            if cfg and cfg.get("api_key"):
                return cfg
        finally:
            db.close()
    except:
        pass
    return {
        "provider": os.getenv("LLM_PROVIDER","openai"),
        "model": os.getenv("LLM_MODEL","gpt-4o-mini"),
        "api_key": os.getenv("OPENAI_API_KEY","sk-mock"),
        "temperature": 0.7,
        "source": "env"
    }

# ---------- Services singletons ----------
analyzer_svc = AnalyzerService()
processor_svc = ProcessorService()
response_svc = ResponseService()

# ---------- Endpoints ----------

@router.post("/perception", summary="PERCEPCIÓN — normaliza, valida, sanitiza, extrae entidades")
def perception(req: PerceptionRequest):
    """
    Capa de percepción (percepcion.md §2-8).
    Entrada: texto crudo → Salida: contexto estructurado normalizado.
    """
    if not _has_react:
        # Fallback al analyzer clásico
        result = analyzer_svc.analyze(req.text, chat_id=req.chat_id, history=[])
        return {"perception": result, "fallback": True}
    try:
        svc = PerceptionService()
        ctx = svc.build_context(req.text, source=req.source, chat_id=req.chat_id)
        return {
            "perception": ctx,
            "valid": ctx["validation"]["valid"],
            "warnings": ctx["validation"]["warnings"],
            "next": "reasoning",
        }
    except Exception as e:
        raise HTTPException(500, f"Perception error: {e}")

@router.post("/analyze", summary="ANALYZER — 10 pasos: interpretar → generar plan")
async def analyze(req: AnalyzeRequest):
    result = analyzer_svc.analyze(req.text, chat_id=req.chat_id, history=req.history or [])
    llm = get_active_llm()
    result["llm"] = {"provider": llm["provider"], "model": llm["model"], "source": llm["source"]}
    result["next"] = "PROCESSOR"
    return result

@router.post("/process", summary="PROCESSOR — 7 ramas + tri Web Search/RAG/External → Resultados")
async def process_endpoint(req: ProcessorRequest):
    tri = await processor_svc.process(req.query, req.plan, chat_id=req.chat_id)
    llm = get_active_llm()
    tri["llm"] = {"provider": llm["provider"], "model": llm["model"]}
    return tri

@router.post("/react", summary="ReAct COMPLETO — Percepción → Razonamiento → Memoria → Acción → Response")
async def react(req: ReactRequest):
    """
    Nuevo orquestador que integra los 4 módulos (percepcion, razonamiento, memoria, accion).
    Usa límites ReAct (MAX_ITERATIONS=8, MAX_TOOL_CALLS=10, TOOL_TIMEOUT=15) + cache L1/L2 + fallback SQLite.
    """
    if not _has_react:
        raise HTTPException(503, "ReactAgent no disponible — usa /api/v1/analyzer/execute legado")
    db = None
    try:
        db = SessionLocal()
    except:
        db = None
    try:
        agent = ReactAgent(db_session=db)
        result = await agent.run(req.text, chat_id=req.chat_id, user_id=req.user_id, extra=req.extra)
        llm = get_active_llm()
        result["llm"] = {"provider": llm["provider"], "model": llm["model"], "source": llm["source"]}
        return result
    except Exception as e:
        logging.exception("react error")
        raise HTTPException(500, f"React error: {e}")
    finally:
        if db:
            try:
                db.close()
            except:
                pass

@router.post("/execute", summary="ANALYZER → PROCESSOR → PROCESSOR RESULT → RESPONSE → USER (completo, legado) — AHORA con fallback ReAct")
async def execute(req: ExecuteRequest):
    """
    Flujo legado mantenido por compatibilidad frontend.
    Si ReactAgent está disponible, lo usa Internamente para mejorar razonamiento;
    si falla, fallback al flujo clásico ANALYZER→PROCESSOR→RESPONSE.
    """
    llm = get_active_llm()

    # Intenta ReAct mejorado primero
    if _has_react:
        try:
            db = None
            try:
                db = SessionLocal()
            except:
                db = None
            agent = ReactAgent(db_session=db)
            react_result = await agent.run(req.text, chat_id=req.chat_id, history=req.history)
            # Adapta a formato legado para frontend
            try:
                if db:
                    db.close()
            except:
                pass
            # Mapea campos esperados por frontend script.js
            return {
                "flow": react_result.get("flow", "PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → RESPONSE → USER"),
                "analyzer": react_result.get("reasoning", {}).get("trace", []) or react_result.get("reasoning", {}),
                "plan": [{"tool": t} for t in react_result.get("tools_used", [])] or [{"tool": "database"}],
                "processor": react_result.get("processor", {}),
                "tri_result": react_result.get("tri_result", {}),
                "processor_result": {"resultados": react_result.get("tri_result", {}), "total": react_result.get("tri_result", {}).get("total_items",0)},
                "response": react_result.get("response", {}),
                "reasoning": react_result.get("reasoning", {}),
                "perception": react_result.get("perception", {}),
                "run_id": react_result.get("run_id"),
                "elapsed_ms": react_result.get("elapsed_ms"),
                "llm": {"provider": llm["provider"], "model": llm["model"], "source": llm["source"]},
                "next": "USER",
                "channel": "WebSocket / Frontend",
                "sintesis": react_result.get("sintesis") or react_result.get("response", {}).get("sintesis",""),
                "fuentes": react_result.get("fuentes") or react_result.get("response", {}).get("fuentes",[]),
            }
        except Exception as e:
            logging.warning(f"React fallback a clásico: {e}")

    # Fallback clásico
    # 1. ANALYZER
    analyzer_result = analyzer_svc.analyze(req.text, chat_id=req.chat_id, history=req.history or [])
    plan = analyzer_result["plan"]
    # 2. PROCESSOR
    processor_result = await processor_svc.process(req.text, plan, chat_id=req.chat_id)
    resultados = processor_result["tri_result"]
    # 3. PROCESSOR RESULT (ya en processor_result)
    # 4. RESPONSE
    response_result = response_svc.build(req.text, analyzer_result, processor_result)
    # 5. USER (preparar payload WebSocket)
    return {
        "flow": "ANALYZER (10) → PROCESSOR (7 + tri) → PROCESSOR RESULT → RESPONSE (5) → USER",
        "analyzer": analyzer_result["analyzer"],
        "plan": plan,
        "processor": processor_result["processor"],
        "tri_result": resultados,
        "processor_result": {"resultados": resultados, "total": resultados.get("total_items",0)},
        "response": response_result["response"],
        "llm": {"provider": llm["provider"], "model": llm["model"], "source": llm["source"]},
        "next": "USER",
        "channel": "WebSocket / Frontend",
        "sintesis": response_result["response"]["sintesis"],
        "fuentes": response_result["response"]["fuentes"],
    }

@router.get("/status", summary="Estado del pipeline")
def status():
    llm = get_active_llm()
    extra = {}
    if _has_react:
        try:
            from app.services.react_agent import ReactAgent
            agent = ReactAgent()
            extra["react"] = agent.observability()
        except:
            pass
        try:
            from app.db.database import health_check
            extra["database"] = health_check()
        except Exception as e:
            extra["database"] = {"status": "unknown", "error": str(e)}
    return {
        "analyzer": {"pasos": ["interpretar_intencion","clasificar_solicitud","extraer_entidades","analizar_contexto","consultar_memoria_necesaria","detectar_necesidad_web_search","detectar_necesidad_rag","seleccionar_herramientas","evaluar_riesgo","generar_plan"], "status": "ok"},
        "processor": {"ramas": ["Web Search","RAG","Database","Documents","External APIs","Notifications","Workflows"], "tri": ["Web Search","RAG","External API"], "status": "ok"},
        "response": {"apartados": ["sintesis","explicacion","fuentes","recomendaciones","acciones_propuestas"], "status": "ok"},
        "perception": {"sources": ["texto","api","archivo","imagen","sensor","evento"], "status": "ok" if _has_react else "fallback"},
        "reasoning": {"pattern": "Reasoning → Action → Observation → Final Answer", "limits": {"MAX_ITERATIONS": int(os.getenv("MAX_ITERATIONS","8")), "MAX_TOOL_CALLS": int(os.getenv("MAX_TOOL_CALLS","10")), "TOOL_TIMEOUT": int(os.getenv("TOOL_TIMEOUT","15"))}, "status": "ok" if _has_react else "fallback"},
        "memory": {"levels": ["L1 LRU","L2 Upstash","L3 PostgreSQL/SQLite","L4 pgvector"], "status": "ok"},
        "action": {"router": ["result_analyzer","web_search","database_query","document_search","external_api"], "controls": ["human_in_loop","idempotency","circuit_breaker"], "status": "ok"},
        "llm": {"provider": llm["provider"], "model": llm["model"], "source": llm["source"]},
        "flow": "PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → OBSERVACIÓN → RESPONSE → USER",
        "connected": bool(llm.get("api_key")),
        "react_available": _has_react,
        **extra
    }
