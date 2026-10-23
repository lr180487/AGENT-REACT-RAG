"""
orchestrator_service.py — ORQUESTADOR LOOP del Agente ReAct

Mejora el razonamiento lineal (sequential result_analyzer → web_search → rag)
a un LOOP autónomo:  THINK → PLAN → ACT → OBSERVE → REFLECT → RE-PLAN → SYNTHESIZE

Inspirado en ReAct:Synergy, AutoGPT-planner y §8 razonamiento.md.

Arquitectura:

  Objetivo (goal)
     ↓
  ┌─────────────────────────────────────────────┐
  │ LOOP (MAX_ITERATIONS=8, MAX_TOOL_CALLS=10)  │
  │  ① DECOMPOSE: descompone goal en sub-goals │
  │  ② THINK:     LLM o heurística → thought  │
  │  ③ PLAN:      elige 1-2 tools próximos     │
  │  ④ ACT:       ejecuta paralelo con timeout │
  │  ⑤ OBSERVE:   normaliza + score            │
  │  ⑥ REFLECT:   confidence, cobertura, gap   │
  │  ⑦ RE-PLAN:   si gap>0 genera nuevos sub-goals │
  │  ↻ repite hasta confidence ≥0.85 o sin pending │
  └─────────────────────────────────────────────┘
     ↓
  SYNTHESIZE → síntesis + trace completo para RESPONSE (5 apartados)

Tools registradas (extensible):
  - result_analyzer  (heurístico, sin I/O)
  - web_search       (Tavily → Google → DuckDuckGo, con caché L1/L2)
  - rag              (pgvector-lite/BM25)
  - memory_lookup    (L1→L3)
  - database / documents (ProcessorService)

Integración:
  - Si hay LLM activo (OPENAI_API_KEY / llm_configs) intenta LLM-Thinking vía HTTP;
    si falla o es mock, usa heurística pura (sin dependencia).
  - Cache L1/L2 reutilizado (cache_service)
  - Compatibilidad: expone run_loop() + run_orchestrated_context() usado por ReactAgent.

Trazabilidad: cada iteración registra
  {iteration, phase, tool, input, output, latency_ms, confidence}
visible en /api/v1/analyzer/status y en el payload react.
"""

import os
import re
import time
import logging
import asyncio
import hashlib
import uuid
from typing import Dict, Any, List, Optional, Tuple

from app.services.cache_service import get_with_fallback, set_both, cache_key

logger = logging.getLogger(__name__)

# Límites ReAct §8 (parametrizables por .env)
MAX_ITERATIONS = int(os.getenv("MAX_ITERATIONS", "8"))
MAX_TOOL_CALLS = int(os.getenv("MAX_TOOL_CALLS", "10"))
TOOL_TIMEOUT = int(os.getenv("TOOL_TIMEOUT", "15"))
TOKEN_LIMIT = int(os.getenv("TOKEN_LIMIT", "8000"))
REACT_TIMEOUT = int(os.getenv("REACT_TIMEOUT", "45"))
CONFIDENCE_THRESHOLD = float(os.getenv("ORCHESTRATOR_CONFIDENCE", "0.82"))
MAX_PARALLEL_TOOLS = int(os.getenv("ORCHESTRATOR_PARALLEL", "2"))

# Tool registry
TOOL_SPECS = {
    "result_analyzer": {"cost": 1, "timeout": 2, "parallel": False, "needs_query": False},
    "web_search": {"cost": 2, "timeout": TOOL_TIMEOUT, "parallel": True, "needs_query": True},
    "rag": {"cost": 2, "timeout": TOOL_TIMEOUT, "parallel": True, "needs_query": True},
    "memory_lookup": {"cost": 1, "timeout": 3, "parallel": True, "needs_query": False},
}

# ──────────────────────────────────────────────────────────────────────
# LLM Think helper — intenta LLM real, fallback heurística inmediata
# ──────────────────────────────────────────────────────────────────────

async def _llm_think(objective: str, observations: List[Dict], iteration: int, llm_cfg: Optional[Dict]=None) -> Optional[str]:
    """Intenta pedir thought al LLM activo (openai-compat). Retorna None si no hay clave o falla rápido."""
    if not llm_cfg or not llm_cfg.get("api_key") or "mock" in str(llm_cfg.get("api_key")) or "sk-mock" in str(llm_cfg.get("api_key")):
        return None
    # solo intenta si es provider conocido y timeout corto
    provider = llm_cfg.get("provider","openai")
    model = llm_cfg.get("model","gpt-4o-mini")
    api_key = llm_cfg.get("api_key")
    base = llm_cfg.get("base_url") or "https://api.openai.com/v1"
    if provider not in ("openai","groq","mistral","custom","anthropic") and "openai" not in base:
        return None
    # prompt minimalista
    obs_summary = "; ".join([f"{o.get('tool')}:{str(o.get('observation') or o.get('error') or '')[:80]}" for o in observations[-3:]]) or "sin observaciones"
    prompt = f"Eres orquestador ReAct. Objetivo: \"{objective[:180]}\"\nIter {iteration}, obs: {obs_summary}\nResponde en una línea: QUÉ falta hacer y POR QUÉ. Máx 30 palabras."
    try:
        import httpx
        # openai-compatible chat/completions
        url = base.rstrip("/") + "/chat/completions"
        # anthropic adaptation quick skip — solo openai-compat
        if provider == "anthropic":
            return None
        payload = {"model": model, "messages":[{"role":"user","content":prompt}], "temperature":0.2, "max_tokens":80}
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type":"application/json"}
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.post(url, json=payload, headers=headers)
            if r.status_code==200:
                j = r.json()
                txt = (j.get("choices") or [{}])[0].get("message",{}).get("content") or (j.get("choices") or [{}])[0].get("text") or ""
                if txt:
                    return txt.strip()[:300]
    except Exception as e:
        logger.debug(f"llm_think fallo iter {iteration}: {e}")
    return None

def _heuristic_think(objective: str, pending: List[str], observations: List[Dict], iteration: int) -> str:
    low = objective.lower()
    done = {o.get("tool") for o in observations if isinstance(o, dict)}
    gaps = []
    if any(k in low for k in ["analiza","resultado","crecimiento","métrica","por ciento","%"]) and "result_analyzer" not in done:
        gaps.append("falta analizar cifra/tendencia")
    if any(k in low for k in ["busca","informacion","externa","actual","precio","noticia","web","inteligencia","que es","quien"]) and "web_search" not in done:
        gaps.append("falta web_search")
    if any(k in low for k in ["documento","contrato","cláusula","penalidad","manual","rag","biblioteca","mis documentos"]) and "rag" not in done:
        gaps.append("falta rag")
    if not gaps and pending:
        gaps.append(f"pendientes: {', '.join(pending[:2])}")
    if not gaps:
        gaps.append("verificar si respuesta ya es completa")
    return f"Iter {iteration}: objetivo '{objective[:60]}' ∣ done [{', '.join(done) or 'ninguna'}] ∣ gap: {'; '.join(gaps)}"

# ──────────────────────────────────────────────────────────────────────

class OrchestratorService:
    """
    Orquestador loop — coordina THINK→PLAN→ACT→REFLECT hasta cierre.
    Uso:
        orch = OrchestratorService()
        result = await orch.run_loop(text, context, history, chat_id)
    """

    def __init__(self, reasoning_ref=None):
        # referencia lazy a ReasoningService para reutilizar tools (evita import circular en __init__)
        self._reasoning_ref = reasoning_ref
        self._web = None
        self._rag = None
        self._analyzer = None
        self._ensure_tools()

    def _ensure_tools(self):
        if self._web is None:
            try:
                from app.services.reasoning_service import ReasoningService
                rs = self._reasoning_ref or ReasoningService()
                self._web = rs.web_search
                self._rag = rs.rag
                self._analyzer = rs.analyzer
                self._reasoning = rs
            except Exception as e:
                logger.warning(f"orchestrator init tools fallo: {e}")

    # ── decompose ──
    def _decompose(self, text: str) -> List[str]:
        low = text.lower().strip()
        # compuestos con y / , / ;  o con dos intenciones
        parts = []
        # split por conectores fuertes
        for sep in [" y ", " e ", " luego ", " después ", " ; ", " , luego "]:
            if sep in low:
                # descompone preservando original casing aproximado
                raw_parts = re.split(re.escape(sep), text, flags=re.IGNORECASE)
                if len(raw_parts) > 1:
                    parts = [p.strip(" .,;") for p in raw_parts if p.strip()]
                    break
        if not parts:
            # heuristics: si pide "Analiza X y busca Y" ya son 2 subgoals
            if "analiza" in low and "busca" in low:
                # divide en analiza / busca
                m = re.search(r"(analiza.+?)(busca.+)", low, flags=re.DOTALL)
                if m:
                    # recupera del texto original con índices aproximados
                    parts = [text[:len(m.group(1))].strip(), text[len(m.group(1)):].strip()]
                else:
                    parts = [text]
            else:
                parts = [text]
        # limita y limpia
        cleaned = []
        for p in parts:
            if len(p) > 5:
                cleaned.append(p.strip())
        # fallback: cada frase >3 palabras como subgoal si texto largo y sin split previo
        if len(cleaned)==1 and len(text.split())>12 and text.count("?")==0:
            # considera dos subgoals: análisis + síntesis
            pass
        return cleaned[:4] if cleaned else [text]

    # ── think ──
    async def _think(self, objective: str, pending: List[str], observations: List[Dict], iteration: int, llm_cfg: Optional[Dict]) -> Dict[str, Any]:
        llm_thought = await _llm_think(objective, observations, iteration, llm_cfg)
        thought = llm_thought if llm_thought else _heuristic_think(objective, pending, observations, iteration)
        return {"phase":"THINK", "iteration": iteration+1, "thought": thought, "llm_used": bool(llm_thought), "pending": pending[:2]}

    # ── plan ──
    def _plan_next(self, thought: Dict, pending: List[str], observations: List[Dict], tools_used: List[str], decision_hint: Dict, original_text: str="") -> Dict[str, Any]:
        """
        Decide 1-2 tools a ejecutar en esta iteración.
        Usa original_text (full) para query — todos los tools reciben contexto completo.
        Prioriza no repetir tool y respeta dependencias.
        """
        done = set(tools_used)
        # query base: original_text completo (máx 200) — mejor que pending[0] parcial
        full_query = (original_text or thought.get("thought","") or " ".join(pending))[:200].strip()
        if not full_query:
            full_query = "consulta general"
        query = full_query

        candidates: List[Tuple[str, str, float]] = [] # (tool, reason, priority)

        # usa hint del reasoning_service._should_use_tools si disponible (sobre original_text)
        hint = decision_hint or {}
        # si no hay hint, infiere de pending/thought + original_text
        text_low = (original_text or " ".join(pending)).lower() + " " + thought.get("thought","").lower()
        needs_analyzer = hint.get("result_analyzer") or ("analizar" in text_low or any(k in text_low for k in ["%","crecimiento","métrica","tendencia"])) or bool(re.search(r"\d+\s*%", original_text or ""))
        needs_search = hint.get("web_search") or any(k in text_low for k in ["busca","web","externa","actual","informacion","que es","inteligencia","explícame","define"])
        needs_rag = hint.get("rag") or any(k in text_low for k in ["documento","contrato","cláusula","penalidad","rag","biblioteca","mis documentos"])

        # saludo corto → solo memoria, no web_search
        greetings = {"hola","hello","hi","hey","buenas","gracias","adios","adiós","buenos dias","buenas tardes"}
        is_greeting = (original_text or "").strip().lower() in greetings or (len((original_text or "").strip())<6 and len((original_text or "").strip().split())==1)
        if is_greeting:
            if "memory_lookup" not in done:
                candidates.append(("memory_lookup", "saludo breve — solo memoria/historial", 6))
            # no añadir más tools para saludo
            candidates.sort(key=lambda x: -x[2])
            filtered = [c for c in candidates if c[0] not in done]
            batch = filtered[:MAX_PARALLEL_TOOLS]
            plan_tools = [{"tool": t, "reason": r, "query": query} for t, r, _ in batch]
            return {
                "phase":"PLAN",
                "iteration": thought.get("iteration", 1),
                "thought_ref": thought.get("thought","")[:80],
                "tools": plan_tools,
                "query": query,
                "candidates_considered": len(candidates),
                "hint": hint,
            }

        # prioridad: analyzer primero (barato), luego rag/web en paralelo
        if needs_analyzer and "result_analyzer" not in done:
            candidates.append(("result_analyzer", "heurística indica cifra/tendencia por analizar", 10))
        if needs_rag and "rag" not in done:
            candidates.append(("rag", "consulta pide base de conocimiento/documentos", 9))
        if needs_search and "web_search" not in done:
            candidates.append(("web_search", "falta información externa/verificación", 8))
        # si no candidate pero pendiente, usa memoria
        if not candidates and pending and "memory_lookup" not in done:
            # solo si es saludo o historial
            if len(original_text.split()) <= 3 or any(k in text_low for k in ["hola","recuerda","historial"]):
                candidates.append(("memory_lookup", "consultar memoria/historial para contexto", 5))
        if not candidates and not done:
            candidates.append(("web_search", "exploración inicial web como fallback informativo", 4))

        # ordena por prioridad y dedup
        candidates.sort(key=lambda x: -x[2])
        # filtra ya ejecutados
        filtered = [c for c in candidates if c[0] not in done]
        # límite paralelo — permite result_analyzer en paralelo (es sync ligero)
        batch = filtered[:MAX_PARALLEL_TOOLS]

        plan_tools = [{"tool": t, "reason": r, "query": query} for t, r, _ in batch]
        return {
            "phase":"PLAN",
            "iteration": thought.get("iteration", 1),
            "thought_ref": thought.get("thought","")[:80],
            "tools": plan_tools,
            "query": query,
            "candidates_considered": len(candidates),
            "hint": hint,
        }

    # ── act ──
    async def _act(self, plan: Dict, text: str, metric: Optional[Dict]=None) -> List[Dict]:
        tools = plan.get("tools") or []
        if not tools:
            return []
        results: List[Dict] = []
        # prepara coros paralelas
        coros = []
        tool_names = []
        for t in tools:
            name = t["tool"]
            q = t.get("query") or text
            tool_names.append(name)
            if name == "result_analyzer":
                # sync
                async def _run_analyzer(query=q, metric=metric):
                    try:
                        # usa instancia analyzer
                        obs = self._analyzer.run(query)
                        obs["observation"] = f"Análisis {obs.get('trend')}: {obs.get('interpretation')}"
                        return obs
                    except Exception as e:
                        return {"tool":"result_analyzer","error":str(e),"status":"failed"}
                coros.append(_run_analyzer())
            elif name == "web_search":
                async def _run_ws(query=q):
                    try:
                        key = cache_key("web_search", query)
                        cached, tier = get_with_fallback(key)
                        if cached is not None:
                            cached = dict(cached)
                            cached["cached"]=True
                            cached["cache_tier"]=tier
                            # normaliza cached para observación
                            if "observation" not in cached:
                                cached["observation"] = f"Resultados cached ({cached.get('provider')})"
                            return cached
                        # no cache → llama tool
                        import asyncio as _aio
                        obs = await asyncio.wait_for(self._web.run(query), timeout=TOOL_TIMEOUT)
                        obs["observation"] = f"Web {len(obs.get('results',[]))} resultados ({obs.get('provider')})" + (" [cached]" if obs.get("cached") else "")
                        return obs
                    except asyncio.TimeoutError:
                        return {"tool":"web_search","error":f"timeout {TOOL_TIMEOUT}s","status":"timeout","query":query}
                    except Exception as e:
                        return {"tool":"web_search","error":str(e),"status":"failed","query":query}
                coros.append(_run_ws())
            elif name == "rag":
                async def _run_rag(query=q):
                    try:
                        import asyncio as _aio
                        obs = await asyncio.wait_for(self._rag.run(query), timeout=TOOL_TIMEOUT)
                        # obs ya tiene chunks
                        if "observation" not in obs:
                            obs["observation"] = f"RAG {len(obs.get('chunks',[]))} fragmentos"
                        return obs
                    except asyncio.TimeoutError:
                        return {"tool":"rag","error":f"timeout {TOOL_TIMEOUT}s","status":"timeout","query":query}
                    except Exception as e:
                        return {"tool":"rag","error":str(e),"status":"failed","query":query}
                coros.append(_run_rag())
            elif name == "memory_lookup":
                async def _run_mem(query=q):
                    try:
                        # intenta memory service
                        return {"tool":"memory_lookup","hits":0,"observation":"memoria sin hits","query":query}
                    except Exception as e:
                        return {"tool":"memory_lookup","error":str(e)}
                coros.append(_run_mem())
            else:
                async def _run_unknown(name=name):
                    return {"tool":name,"error":"unknown tool"}
                coros.append(_run_unknown())

        # ejecuta con gather (paralelo real si >1)
        t0 = time.time()
        try:
            if len(coros)==1:
                res = await coros[0]
                results = [res]
            else:
                results = await asyncio.gather(*coros)
        except Exception as e:
            results = [{"tool":"unknown","error":str(e)}]
        # añade latencia + normaliza
        elapsed = int((time.time()-t0)*1000)
        for r in results:
            if "latency_ms" not in r:
                r["latency_ms"] = elapsed // max(1, len(results))
            if "tool" not in r:
                r["tool"] = tool_names[0] if tool_names else "unknown"
        return results

    # ── reflect ──
    def _reflect(self, objective: str, observations: List[Dict], pending: List[str], iteration: int) -> Dict[str, Any]:
        # cobertura por subgoal
        total_sub = max(1, len(pending) if pending else 1)
        # confidence heurística
        scores = []
        has_error = any(o.get("error") or o.get("status") in ("failed","timeout") for o in observations)
        for o in observations:
            tool = o.get("tool")
            if tool == "web_search":
                n = len(o.get("results") or [])
                scores.append(0.85 if n>=3 else 0.65 if n>=1 else 0.25 if not o.get("error") else 0.1)
            elif tool == "rag":
                n = len(o.get("chunks") or [])
                scores.append(0.90 if n>=2 else 0.70 if n>=1 else 0.30)
            elif tool == "result_analyzer":
                scores.append(0.88 if o.get("trend")!="neutral" else 0.60)
            elif tool == "memory_lookup":
                scores.append(0.50)
            else:
                scores.append(0.40)
        avg = sum(scores)/len(scores) if scores else 0.0
        # penaliza errores
        if has_error:
            avg *= 0.85
        # penaliza iteraciones altas
        if iteration >= MAX_ITERATIONS-1:
            avg *= 0.90

        # decide si faltan subgoals
        done_tools = {o.get("tool") for o in observations if isinstance(o, dict)}
        # re-deriva pending restante: si ya tenemos web_search y rag y analyzer, consideramos cubierto salvo failure
        remaining = []
        # simple: si objective largo y solo 1 tool, sugiere que faltan
        low = objective.lower()
        if " y " in low and len(observations) < 2 and len(remaining)==0:
            # aún quedarían subgoals compuestos
            pass
        # confidence-based remaining
        needs_more = avg < CONFIDENCE_THRESHOLD and iteration < MAX_ITERATIONS-1
        # si hay error de timeout, necesita replan con re-query
        needs_replan = any(o.get("status")=="timeout" for o in observations) or (avg < 0.45 and iteration < 3)
        # gaps explícitos
        gaps = []
        if avg < 0.60:
            gaps.append("cobertura baja, falta evidencia")
        if any("rag" in low and "rag" not in done_tools for low in [low]):
            gaps.append("faltan fragmentos RAG")
        if has_error:
            gaps.append("hubo error/timeout en alguna tool — reintentar o alternar")

        # dequeue: si progreso y confianza razonable, avanza cola; si ya cubrimos todos los tool-types necesarios, vaciar
        done_set = set([o.get("tool") for o in observations if o.get("tool")])
        # needed basado en objective
        need_analyzer = any(k in objective.lower() for k in ["analiza","%","crecimiento","métrica","tendencia"])
        need_rag = any(k in objective.lower() for k in ["documento","contrato","cláusula","penalidad","rag","biblioteca","mis documentos"])
        need_search = any(k in objective.lower() for k in ["busca","web","externa","actual","informacion","que es","inteligencia","define","explícame"])
        # si todos los necesarios ya están en done y avg ok, limpiar pending
        all_needed_done = True
        if need_analyzer and "result_analyzer" not in done_set:
            all_needed_done = False
        if need_rag and "rag" not in done_set:
            all_needed_done = False
        if need_search and "web_search" not in done_set:
            all_needed_done = False
        if all_needed_done and avg >= 0.60:
            remaining_after = []
        elif pending and len(pending) >= 1:
            if avg >= 0.55:
                remaining_after = pending[1:]
            else:
                remaining_after = pending  # reintentar mismo subgoal
        else:
            remaining_after = []

        return {
            "phase":"REFLECT",
            "iteration": iteration+1,
            "avg_score": round(avg,3),
            "confidence": round(avg,3),
            "needs_more": needs_more,
            "needs_replan": needs_replan,
            "gaps": gaps,
            "remaining_subgoals": remaining_after,
            "done_tools": list(done_tools),
            "assessment": "suficiente evidencia" if avg>=CONFIDENCE_THRESHOLD else "evidencia parcial — continuar" if needs_more else "terminar con lo disponible",
        }

    # ── loop principal ──
    async def run_loop(self, text: str, context: Dict[str, Any], history: Optional[List[Dict]]=None, chat_id: Optional[str]=None, llm_cfg: Optional[Dict]=None) -> Dict[str, Any]:
        """
        Loop orquestado completo. Retorna dict compatible con ReasoningService.run_react()
        + campos extra {orchestrator, loops, reflections}.
        """
        t_start = time.time()
        run_id = f"orch_{uuid.uuid4().hex[:8]}"
        metric = context.get("metric")
        trace: List[Dict] = []
        observations: List[Dict] = []
        tools_used: List[str] = []
        tool_calls = 0
        iteration = 0

        # decompose
        pending = self._decompose(text)
        trace.append({"iteration":0, "phase":"DECOMPOSE", "goal": text[:120], "subgoals": pending, "count": len(pending)})

        # intenta cargar llm cfg si no pasado
        if llm_cfg is None:
            try:
                from app.api.routes_analyzer import get_active_llm as _get_llm
                llm_cfg = _get_llm()
            except:
                llm_cfg=None

        # decision_hint inicial vía reasoning._should_use_tools
        decision = {}
        try:
            decision = self._reasoning._should_use_tools(text, metric)
            trace.append({"phase":"DECISION_HINT", "hint": decision})
        except Exception:
            pass

        status = "completed"
        reflections: List[Dict] = []

        while iteration < MAX_ITERATIONS and tool_calls < MAX_TOOL_CALLS:
            # timeout global
            if time.time() - t_start > REACT_TIMEOUT:
                trace.append({"phase":"TIMEOUT", "reason":f"REACT_TIMEOUT {REACT_TIMEOUT}s"})
                status="timeout"
                break
            # si no quedan pending y ya tenemos observations, refleja y sale
            # THINK
            think = await self._think(text, pending, observations, iteration, llm_cfg)
            trace.append(think)

            # PLAN
            plan = self._plan_next(think, pending, observations, tools_used, decision, original_text=text)
            trace.append(plan)

            if not plan.get("tools"):
                # nada que hacer → reflection final
                refl = self._reflect(text, observations, pending, iteration)
                trace.append(refl)
                reflections.append(refl)
                # actualiza pending según reflexión
                pending = refl.get("remaining_subgoals", pending)
                if not refl["needs_more"]:
                    # sin necesidad de más → limpiar pending y salir
                    pending = []
                    break
                # si needs_more pero plan vacío, fuerza fallback si no hay observations
                if refl["needs_more"] and not observations:
                    plan = {"tools":[{"tool":"web_search","reason":"fallback loop","query": text[:200]}]}
                    # no break, continúa a ACT con fallback
                else:
                    # no hay tools candidatas pero aún hay gaps → limpiar y salir o seguir
                    if refl["confidence"] >= 0.60:
                        pending = []
                    break

            # ACT
            t_act = time.time()
            batch_results = await self._act(plan, text, metric)
            # ACT trace
            for r in batch_results:
                trace.append({"phase":"OBSERVE", "iteration":iteration+1, "tool": r.get("tool"), "observation": r.get("observation") or r.get("error") or str(r)[:120], "latency_ms": r.get("latency_ms"), "provider": r.get("provider"), "cached": r.get("cached")})
            observations.extend(batch_results)
            for r in batch_results:
                if r.get("tool") not in tools_used:
                    tools_used.append(r.get("tool"))
            tool_calls += len(batch_results)

            # si result_analyzer ejecutado, actualiza pending para no replan same
            # REFLECT
            refl = self._reflect(text, observations, pending, iteration)
            trace.append(refl)
            reflections.append(refl)

            # actualiza pending según reflection (dequeue 1 si hubo progreso)
            pending = refl.get("remaining_subgoals", pending)
            # re-query: si web_search sin resultados → marcar replan
            for o in batch_results:
                if o.get("tool")=="web_search" and len(o.get("results") or [])==0 and not o.get("error"):
                    if "rag" not in tools_used:
                        trace.append({"phase":"REPLAN", "reason": "web_search sin resultados → intentar rag", "next": "rag"})
            if not pending:
                # todos los subgoals cubiertos con confianza OK → éxito
                if refl["confidence"] >= 0.55:
                    break
            if not refl["needs_more"]:
                # si el reflector dice no necesita más, terminar aunque quede pending textual
                # (ya tenemos cobertura de tools necesarias)
                if refl["confidence"] >= 0.60 or not refl.get("gaps"):
                    # considera pending completado
                    pending = []
                    break
            # si aún pending y needs_more, continúa loop para refinar
            if pending and refl["needs_more"] and iteration < MAX_ITERATIONS-1:
                pass

            # actualiza decision_hint para próxima iter (re-evalúa con contexto enriquecido)
            try:
                # enriquece text con observación para heurística más rica
                enriched = text + " " + " ".join([o.get("observation","")[:40] for o in observations[-2:]])
                decision = self._reasoning._should_use_tools(enriched, metric)
            except:
                pass

            iteration += 1
            # early stop si ya iteramos y no hay gap y confidence aceptable
            if iteration >= 1 and refl["confidence"] >= 0.78 and not refl["gaps"]:
                break
            # si ya no quedan pending y confidence razonable → stop
            if not pending and refl["confidence"] >= 0.65:
                break

        elapsed_ms = int((time.time()-t_start)*1000)
        token_est = len(text)//4 + sum(len(str(o))//4 for o in observations)

        # synthesis quick (antes de RESPONSE 5 apartados)
        synthesis_hint = f"Loop {iteration+1} iters, {tool_calls} tools, confidence {reflections[-1]['confidence'] if reflections else 0:.2f}: " + "; ".join([o.get("observation","")[:60] for o in observations[:2]])

        return {
            "run_id": run_id,
            "status": status,
            "context_hash": context.get("hash"),
            "orchestrator": {
                "mode": "loop",
                "iterations": iteration+1,
                "tool_calls": tool_calls,
                "pending_initial": self._decompose(text),
                "pending_remaining": pending,
                "confidence": reflections[-1]["confidence"] if reflections else 0.0,
                "reflections": reflections,
            },
            "loops": iteration+1,
            "tools_used": tools_used,
            "observations": observations,
            "trace": trace,
            "iterations": iteration+1,
            "tool_calls": tool_calls,
            "elapsed_ms": elapsed_ms,
            "token_estimate": token_est,
            "next_step": "final_answer" if status=="completed" else "retry_or_fallback",
            "limits": {"MAX_ITERATIONS": MAX_ITERATIONS, "MAX_TOOL_CALLS": MAX_TOOL_CALLS, "TOOL_TIMEOUT": TOOL_TIMEOUT, "TOKEN_LIMIT": TOKEN_LIMIT, "REACT_TIMEOUT": REACT_TIMEOUT, "CONFIDENCE_THRESHOLD": CONFIDENCE_THRESHOLD},
            "model": "Orchestrator LOOP: Decompose → Think(LLM|heuristic) → Plan → Act(parallel≤2) → Observe → Reflect → RePlan → Synthesize",
            "synthesis_hint": synthesis_hint,
            "decision_hint": decision,
        }

    # alias para compatibilidad con ReactAgent
    async def run_orchestrated(self, *args, **kwargs):
        return await self.run_loop(*args, **kwargs)
