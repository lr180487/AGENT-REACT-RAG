"""
action_service.py — ACCIÓN del agente (04_accion.md)
Conecta el razonamiento con el entorno mediante herramientas controladas.

Arquitectura:
  REASONING → Decisión → Tool Router → [Result Analyzer | Web Search | API Tool | ...] → Observation → Memory → Reasoning

Clasificación:
  - Lectura: Web Search, Database Read, Document Search, API GET (menor impacto, cacheable)
  - Escritura: Crear/Modificar/Enviar/Publicar/Eliminar/Ejecutar (requiere controlli adicionales)

Controles:
  - Human-in-the-loop para críticas (§8)
  - Caché L1 LRU + L2 Upstash antes de acción (§9)
  - Idempotencia (§10) con Idempotency-Key
  - Timeout / Retry / Circuit Breaker / DLQ (§11)
  - Observability: Agent Runs, Tool Calls, Errors, Latency, Hit Rate, Tokens (§13)
"""
import time
import asyncio
import hashlib
import logging
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.services.cache_service import get_with_fallback, set_both, cache_key

logger = logging.getLogger(__name__)

# ── Idempotency store (en-memoria; en prod: Redis/DB) ──
_idempotency_store: Dict[str, Any] = {}

# ── Circuit breaker simple ──
_circuit: Dict[str, Dict[str, Any]] = {}  # tool -> {failures, open_until}

def _circuit_is_open(tool: str) -> bool:
    c = _circuit.get(tool)
    if not c:
        return False
    if c.get("open_until") and time.time() < c["open_until"]:
        return True
    if c.get("open_until") and time.time() >= c["open_until"]:
        # Half-open: reset
        c["failures"] = 0
        c["open_until"] = None
    return False

def _circuit_record(tool: str, success: bool):
    c = _circuit.setdefault(tool, {"failures": 0, "open_until": None})
    if success:
        c["failures"] = 0
        c["open_until"] = None
    else:
        c["failures"] += 1
        if c["failures"] >= 3:
            # Open for 30s
            c["open_until"] = time.time() + 30
            logger.warning(f"Circuit OPEN for {tool} (3 failures) — 30s")

# ── Observability ──
_run_log: List[Dict[str, Any]] = []  # últimos 100 runs

def _log_run(entry: Dict[str, Any]):
    _run_log.append(entry)
    if len(_run_log) > 100:
        _run_log.pop(0)
    logger.info(f"AgentRun {entry.get('run_id')} tool={entry.get('tool')} status={entry.get('status')} {entry.get('duration_ms')}ms cached={entry.get('cached')}")

class ActionService:
    """
    Tool Router + Ejecución segura.
    """

    def __init__(self):
        # Herramientas disponibles (accion.md §6 extensible)
        self.tools = {
            "result_analyzer": {"type": "read", "cacheable": False, "critical": False},
            "web_search": {"type": "read", "cacheable": True, "critical": False},
            "database_query": {"type": "read", "cacheable": True, "critical": False},
            "document_search": {"type": "read", "cacheable": True, "critical": False},
            "weather_api": {"type": "read", "cacheable": True, "critical": False},
            "external_api": {"type": "read", "cacheable": False, "critical": False},
            "create_record": {"type": "write", "cacheable": False, "critical": True},
            "send_notification": {"type": "write", "cacheable": False, "critical": True},
            "execute_workflow": {"type": "write", "cacheable": False, "critical": True},
        }

    def classify(self, tool: str) -> str:
        return self.tools.get(tool, {}).get("type", "read")

    def is_critical(self, tool: str) -> bool:
        return self.tools.get(tool, {}).get("critical", False)

    def requires_approval(self, tool: str) -> bool:
        # Si HUMAN_IN_THE_LOOP=true y es escritura crítica → requiere aprobación
        if os.getenv("HUMAN_IN_THE_LOOP", "false").lower() == "true" and self.is_critical(tool):
            return True
        # Heurística: herramientas con "send", "create", "delete", "publish"
        if self.classify(tool) == "write":
            return True
        return False

    # ── Idempotencia (§10) ──
    def idempotency_check(self, key: Optional[str]) -> Optional[Any]:
        if not key or os.getenv("IDEMPOTENCY_ENABLED", "true").lower() != "true":
            return None
        return _idempotency_store.get(key)

    def idempotency_store(self, key: str, result: Any):
        if not key:
            return
        _idempotency_store[key] = {"result": result, "stored_at": time.time()}
        # LRU simple: max 500
        if len(_idempotency_store) > 500:
            oldest = next(iter(_idempotency_store))
            del _idempotency_store[oldest]

    # ── Ejecución con timeout/retry/circuit (§11) ──
    async def execute(
        self,
        tool: str,
        payload: Dict[str, Any],
        run_id: str = "run_unknown",
        idempotency_key: Optional[str] = None,
        timeout: int = 15,
        retries: int = 1,
    ) -> Dict[str, Any]:
        """
        Flujo completo (accion.md §12):
          Select Tool → Cache Check → HIT Return | MISS Execute → Observation → Memory
        """
        t0 = time.time()
        is_read = self.classify(tool) == "read"
        cacheable = self.tools.get(tool, {}).get("cacheable", False)

        # 1. Idempotencia (para writes)
        if idempotency_key:
            prev = self.idempotency_check(idempotency_key)
            if prev is not None:
                return {"tool": tool, "status": "idempotent_hit", "result": prev["result"], "cached": True, "idempotent": True, "run_id": run_id}

        # 2. Human-in-the-loop
        if self.requires_approval(tool):
            # En este MVP: si no hay aprobación explícita en payload, retorna propuesta
            if not payload.get("_approved"):
                return {
                    "tool": tool,
                    "status": "needs_approval",
                    "proposal": f"Ejecutar {tool} con {payload}",
                    "human_in_the_loop": True,
                    "run_id": run_id,
                    "next": "await_approval"
                }

        # 3. Circuit breaker
        if _circuit_is_open(tool):
            return {"tool": tool, "status": "circuit_open", "error": "Circuit breaker open — tool temporalmente deshabilitado", "run_id": run_id}

        # 4. Cache (solo reads cacheables)
        cache_tier = None
        if is_read and cacheable:
            key = cache_key(tool, str(payload))
            cached, tier = get_with_fallback(key)
            if cached is not None:
                dur = int((time.time() - t0) * 1000)
                entry = {"run_id": run_id, "tool": tool, "status": "hit", "duration_ms": dur, "cached": True, "tier": tier}
                _log_run(entry)
                cached["cache_tier"] = tier
                cached["cached"] = True
                return cached
            cache_tier = key  # para guardar después

        # 5. Execute con timeout/retry
        last_err = None
        for attempt in range(retries + 1):
            try:
                # Simula timeout con asyncio.wait_for
                result = await asyncio.wait_for(self._call_tool(tool, payload), timeout=timeout)
                dur = int((time.time() - t0) * 1000)
                result["run_id"] = run_id
                result["duration_ms"] = dur
                result["attempt"] = attempt + 1
                result["cached"] = False

                # Guarda en cache si aplica
                if cache_tier:
                    ttl_l1 = 300 if tool == "web_search" else 300
                    ttl_l2 = 1800 if tool == "web_search" else 300
                    set_both(cache_tier, result, l1_ttl=ttl_l1, l2_ttl=ttl_l2)

                # Idempotencia store
                if idempotency_key:
                    self.idempotency_store(idempotency_key, result)

                _circuit_record(tool, True)
                _log_run({"run_id": run_id, "tool": tool, "status": "success", "duration_ms": dur, "cached": False, "attempt": attempt+1})
                return result

            except asyncio.TimeoutError:
                last_err = f"timeout {timeout}s"
                logger.warning(f"[{run_id}] {tool} timeout attempt {attempt+1}")
            except Exception as e:
                last_err = str(e)
                logger.warning(f"[{run_id}] {tool} error attempt {attempt+1}: {e}")
            # Retry backoff
            if attempt < retries:
                await asyncio.sleep(0.3 * (attempt + 1))

        # Fallo tras retries → DLQ / error
        _circuit_record(tool, False)
        dur = int((time.time() - t0) * 1000)
        err_result = {"tool": tool, "status": "failed", "error": last_err, "run_id": run_id, "duration_ms": dur, "dlq": True}
        _log_run({"run_id": run_id, "tool": tool, "status": "failed", "duration_ms": dur, "cached": False, "error": last_err})
        return err_result

    async def _call_tool(self, tool: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dispatch real a cada herramienta.
        Cada herramienta debe tener responsabilidad concreta (accion.md §6).
        """
        if tool == "result_analyzer":
            from app.services.reasoning_service import ResultAnalyzerTool
            t = ResultAnalyzerTool()
            out = t.run(payload.get("input") or payload.get("text") or "")
            return {"tool": tool, "status": "success", "result": out, "observation": out.get("interpretation")}

        if tool == "web_search":
            from app.services.reasoning_service import WebSearchTool
            t = WebSearchTool()
            out = await t.run(payload.get("query") or payload.get("input") or "")
            return {"tool": tool, "status": "success", "result": out, "observation": out.get("answer") or f"{len(out.get('results',[]))} resultados"}

        if tool == "database_query":
            # Mock: en prod usaría ChatRepository
            return {"tool": tool, "status": "success", "result": {"rows": [{"id": 1, "content": "historial"}]}, "observation": "1 fila"}

        if tool == "document_search":
            return {"tool": tool, "status": "success", "result": {"chunks": []}, "observation": "0 chunks"}

        if tool == "external_api":
            # Genérico
            import httpx
            url = payload.get("url")
            if url:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(url)
                    return {"tool": tool, "status": "success", "result": {"status": r.status_code, "body": r.text[:500]}, "observation": f"GET {url} → {r.status_code}"}
            return {"tool": tool, "status": "success", "result": {"ok": True}, "observation": "external_api mock"}

        if tool == "send_notification":
            return {"tool": tool, "status": "success", "result": {"sent": True, "channel": "websocket"}, "observation": "notificación enviada"}

        if tool == "create_record":
            return {"tool": tool, "status": "success", "result": {"created": True}, "observation": "registro creado"}

        # Default
        return {"tool": tool, "status": "success", "result": {"payload": payload}, "observation": f"tool {tool} executed"}

    # ── Observability (§13) ──
    def observability(self) -> Dict[str, Any]:
        from app.services.cache_service import stats as cache_stats
        return {
            "recent_runs": _run_log[-10:],
            "total_runs": len(_run_log),
            "circuit": _circuit,
            "idempotency_keys": len(_idempotency_store),
            "cache": cache_stats(),
        }
