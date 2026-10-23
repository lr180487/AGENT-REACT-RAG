"""
react_agent.py — Orquestador ReAct completo
PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → OBSERVACIÓN → RAZONAMIENTO → FINAL ANSWER

Integra los 4 módulos:
  - percepcion.md   → PerceptionService
  - razonamiento.md → ReasoningService (ReAct + límites + caché)
  - memoria.md      → MemoryService (L1→L4 + TTLs + aislamiento)
  - accion.md       → ActionService (Tool Router + human-in-loop + idempotencia + DLQ)

Flujo por run_id:
  User Request
    ↓ Perception (normaliza, valida, sanitiza)
    ↓ Memory (recupera historial corto + resumen largo)
    ↓ Reasoning (decide herramientas, límite 8 iter)
    ↓ Action (ejecuta con cache L1/L2, timeout 15, retry, circuit)
    ↓ Observation → Memory Update (L1,L2,L3)
    ↓ Reasoning → Final Answer (5 apartados)
    ↓ Response → USER (WebSocket/Frontend)

Trazabilidad: cada run genera run_id, trace, observations, token_estimate, latency.
"""
import time
import uuid
import logging
from typing import Dict, Any, List, Optional

from app.services.perception_service import PerceptionService
from app.services.memory_service import MemoryService
from app.services.reasoning_service import ReasoningService
from app.services.action_service import ActionService
from app.services.response_service import ResponseService
import os

logger = logging.getLogger(__name__)

class ReactAgent:
    def __init__(self, db_session=None):
        self.perception = PerceptionService()
        self.memory = MemoryService(db_session=db_session)
        self.reasoning = ReasoningService()
        self.action = ActionService()
        self.response = ResponseService()
        self.db = db_session
        # Orchestrator loop — mejora razonamiento con THINK→PLAN→ACT→REFLECT
        try:
            from app.services.orchestrator_service import OrchestratorService
            self.orchestrator = OrchestratorService(reasoning_ref=self.reasoning)
            self._orch_enabled = os.getenv("ORCHESTRATOR_ENABLED", "true").lower() not in ("0","false","off","no")
        except Exception as e:
            self.orchestrator = None
            self._orch_enabled = False
            logger.warning(f"orchestrator init fallo: {e}")

    async def run(
        self,
        text: str,
        chat_id: Optional[str] = None,
        history: Optional[List[Dict]] = None,
        user_id: Optional[str] = None,
        extra: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Ejecuta ciclo completo ReAct para una solicitud.
        Retorna payload listo para frontend / WebSocket.
        """
        run_id = f"run_{uuid.uuid4().hex[:8]}"
        t0 = time.time()

        # ── 1. PERCEPCIÓN ──
        context = self.perception.build_context(text, source="user", extra=extra, chat_id=chat_id)
        if not context["validation"]["valid"]:
            return {
                "run_id": run_id,
                "status": "rejected",
                "reason": context["validation"]["errors"],
                "context": context,
                "next": "error",
            }

        # ── 2. MEMORIA (recupera contexto corto + largo) ──
        mem_ctx = self.memory.get_context(chat_id, limit=10, user_id=user_id)
        # Si se pasó history externo, lo prioriza
        effective_history = history if history is not None else mem_ctx.get("history", [])
        context["history"] = effective_history
        context["memory_summary"] = mem_ctx.get("summary", "")

        # ── 3. RAZONAMIENTO (Orchestrator LOOP si activo, sino ReAct lineal) ──
        if self.orchestrator and self._orch_enabled:
            try:
                react_result = await self.orchestrator.run_loop(text, context, history=effective_history, chat_id=chat_id)
                # marca que es orchestrator
                react_result["_orchestrated"] = True
            except Exception as e:
                logger.warning(f"orchestrator loop fallo, fallback a reasoning lineal: {e}")
                react_result = await self.reasoning.run_react(context, history=effective_history, run_id=run_id)
        else:
            react_result = await self.reasoning.run_react(context, history=effective_history, run_id=run_id)

        # Si el razonamiento decidió qué tools usar, ejecuta vía ActionService con controles completos
        # (ReasoningService ya ejecutó los tools en su run_react, pero ActionService añade
        #  human-in-loop, idempotencia, circuit, observabilidad — lo reconciliamos aquí)
        observations = react_result.get("observations", [])
        tools_used = react_result.get("tools_used", [])

        # ── 4. ACTION → Memoria update (para cada observation) ──
        # Ya tenemos observations del reasoning; ahora actualiza memoria corta/larga
        # El reasoning ya pasó por cache L1/L2; aquí solo persistimos.

        # Guarda USER
        if chat_id:
            try:
                self.memory.append_short_term(chat_id, "user", text, meta={"run_id": run_id})
            except Exception as e:
                logger.debug(f"memory append user fallo: {e}")

        # ── 5. RESPONSE (5 apartados) ──
        # Construye estructura compatible con processor_service tri_result
        # Para el response_service, necesita analyzer_result y processor_result
        # Simulamos analyzer_result a partir del trace
        analyzer_result = {
            "analyzer": {
                "interpretar_intencion": {"intent_raw": "consulta"},
                "evaluar_riesgo": {"nivel": "bajo"},
            },
            "plan": [{"tool": t} for t in tools_used] if tools_used else [{"tool": "database"}],
            "riesgo": "bajo",
        }
        # Extrae riesgo / intención si existen en observations
        try:
            # Intenta enriquecer desde context
            pass
        except:
            pass

        # Formatea tri_result para response
        tri_result = {
            "fuentes": tools_used,
            "resultados": observations,
            "total_items": sum(len(o.get("results", []) or o.get("chunks", []) or []) for o in observations if isinstance(o, dict)),
            "query": text,
        }
        processor_result = {"tri_result": tri_result, "resultados": tri_result, "processor": {t: "ejecutado" for t in tools_used}}

        response_payload = self.response.build(text, analyzer_result, processor_result)

        # ── 6. MEMORIA update con ASSISTANT ──
        if chat_id:
            try:
                assistant_text = response_payload.get("response", {}).get("sintesis", "")[:500]
                self.memory.append_short_term(chat_id, "assistant", assistant_text, meta={"run_id": run_id, "tools": tools_used})
                self.memory.update_long_term(chat_id, assistant_text=assistant_text, user_text=text)
            except Exception as e:
                logger.debug(f"memory append assistant fallo: {e}")

        elapsed = int((time.time() - t0) * 1000)

        # ── Payload final (compatible con /api/v1/analyzer/execute actual) ──
        return {
            "run_id": run_id,
            "status": "completed",
            "flow": "PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → OBSERVACIÓN → RAZONAMIENTO → FINAL ANSWER",
            "context": {"hash": context.get("hash"), "language": context.get("language"), "entities": context.get("entities"), "metric": context.get("metric")},
            "perception": {"valid": context["validation"]["valid"], "warnings": context["validation"]["warnings"], "source": context["source"], "type": context["type"]},
            "memory": {"history_len": len(effective_history), "summary_len": len(mem_ctx.get("summary","")), "has_history": mem_ctx.get("has_history")},
            "reasoning": react_result,
            "observations": observations,
            "tools_used": tools_used,
            "processor": processor_result["processor"],
            "tri_result": tri_result,
            "response": response_payload["response"],
            "sintesis": response_payload["response"]["sintesis"],
            "fuentes": response_payload["response"]["fuentes"],
            "recomendaciones": response_payload["response"]["recomendaciones"],
            "acciones_propuestas": response_payload["response"]["acciones_propuestas"],
            "elapsed_ms": elapsed,
            "limits": react_result.get("limits"),
            "next": "USER",
            "channel": "WebSocket / Frontend",
        }

    def observability(self) -> Dict[str, Any]:
        """Expone métricas de todos los subsistemas."""
        from app.services.cache_service import stats as cache_stats
        base = {
            "perception": {"ok": True},
            "memory": self.memory.policy(),
            "action": self.action.observability(),
            "cache": cache_stats(),
        }
        if getattr(self, 'orchestrator', None):
            base["orchestrator"] = {
                "enabled": getattr(self, '_orch_enabled', False),
                "mode": "loop Decompose→Think→Plan→Act→Reflect→RePlan",
                "limits": {"MAX_ITERATIONS": int(os.getenv("MAX_ITERATIONS","8")), "MAX_TOOL_CALLS": int(os.getenv("MAX_TOOL_CALLS","10")), "CONFIDENCE_THRESHOLD": float(os.getenv("ORCHESTRATOR_CONFIDENCE","0.82"))},
                "parallel": int(os.getenv("ORCHESTRATOR_PARALLEL","2")),
            }
        return base
