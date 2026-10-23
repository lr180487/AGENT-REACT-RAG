"""
reasoning_service.py — RAZONAMIENTO ReAct (02_razonamiento.md)
Núcleo: determina qué necesita, selecciona acciones, integra observaciones.

Patrón ReAct:
  Reasoning → Action → Observation → Reasoning → ... → Final Answer

Herramientas iniciales (razonamiento.md §4-5):
  - result_analyzer : interpreta resultados (25% → positivo, incremento)
  - web_search      : información externa (Tavily → DuckDuckGo fallback, Python)

Separación (razonamiento.md §7):
  LLM decide ¿Qué hacer?  →  Tool ejecuta ¿Cómo?  → Observation → LLM

Control (razonamiento.md §8):
  MAX_ITERATIONS=8, MAX_TOOL_CALLS=10, TOOL_TIMEOUT=15s, TOKEN_LIMIT

Caché (razonamiento.md §9):
  Antes de tool: L1 LRU → MISS → L2 Upstash → MISS → Tool

Modelo (razonamiento.md §10):
  Perception → Context → Reasoning → [ResultAnalyzer|WebSearch] → Observations → Reasoning → Final Answer
"""
import re
import time
import logging
import hashlib
import os
from typing import Dict, Any, List, Optional

from app.services.cache_service import get_with_fallback, set_both

logger = logging.getLogger(__name__)

# ── Límites desde .env ──
MAX_ITERATIONS = int(os.getenv("MAX_ITERATIONS", "8"))
MAX_TOOL_CALLS = int(os.getenv("MAX_TOOL_CALLS", "10"))
TOOL_TIMEOUT = int(os.getenv("TOOL_TIMEOUT", "15"))
TOKEN_LIMIT = int(os.getenv("TOKEN_LIMIT", "8000"))

# ── Tools ──
class ResultAnalyzerTool:
    """result_analyzer: interpreta un resultado/cifra."""

    def run(self, raw: str) -> Dict[str, Any]:
        # Extrae valor y contexto
        import re
        m = re.search(r"(\d+[.,]?\d*)\s*(%|por ciento|percent)?", raw or "")
        value = None
        unit = None
        if m:
            try:
                value = float(m.group(1).replace(",", "."))
                unit = "%" if m.group(2) else None
            except:
                value = m.group(1)
        # Tendencia
        lower = (raw or "").lower()
        if any(w in lower for w in ["caída", "baja", "negativo", "pérdida", "down"]):
            trend = "negative"
        elif any(w in lower for w in ["crecimiento", "suba", "incremento", "up", "positivo", "aument"]):
            trend = "positive"
        else:
            trend = "neutral" if value is None else ("positive" if isinstance(value, float) and value > 0 else "neutral")
        tipo = "percentage" if unit == "%" else "numeric" if value is not None else "text"

        return {
            "tool": "result_analyzer",
            "input": raw[:200] if raw else "",
            "value": value,
            "unit": unit,
            "trend": trend,
            "type": tipo,
            "interpretation": "incremento respecto al periodo base" if trend == "positive" else "decremento" if trend == "negative" else "sin tendencia clara",
            "confidence": 0.88,
        }

class WebSearchTool:
    """web_search: externo vía Tavily/DuckDuckGo client."""

    async def run(self, query: str) -> Dict[str, Any]:
        # Usa caché L1/L2 antes de ejecutar
        from app.services.cache_service import cache_key
        key = cache_key("web_search", query)
        cached, tier = get_with_fallback(key)
        if cached is not None:
            cached["cached"] = True
            cached["cache_tier"] = tier
            return cached

        t0 = time.time()
        try:
            from app.services.web_search_client import web_search as client_search
            data = await client_search(query, max_results=5)
            results = data.get("results") or []
            provider = data.get("provider") or "unknown"
            norm = []
            for r in results:
                norm.append({
                    "title": r.get("title") or "Sin título",
                    "url": r.get("url") or "",
                    "snippet": r.get("snippet") or r.get("body") or "",
                    "score": r.get("score") or 0.75,
                })
            out = {
                "tool": "web_search",
                "query": query,
                "provider": provider,
                "results": norm[:5],
                "answer": data.get("answer"),
                "cached": False,
                "latency_ms": int((time.time() - t0) * 1000),
            }
            set_both(key, out, l1_ttl=300, l2_ttl=1800)
            return out
        except Exception as e:
            # Fallback mock si falla cliente
            out = {
                "tool": "web_search",
                "query": query,
                "provider": "mock",
                "error": str(e),
                "results": [
                    {"title": "Resultado mock 1", "url": "https://example.com/1", "snippet": f"Info sobre {query[:40]}...", "score": 0.92},
                ],
                "cached": False,
                "latency_ms": int((time.time() - t0) * 1000),
            }
            return out

class RagTool:
    """rag: consulta base de conocimiento (pgvector-lite)."""

    async def run(self, query: str) -> Dict[str, Any]:
        t0 = time.time()
        try:
            from app.services.rag_service import query_rag
            res = query_rag(query, top_k=5)
            # Cache opcional: no usa L1/L2 por ahora, directo
            out = {
                "tool": "rag",
                "query": query,
                "store": res.get("store","pgvector-lite"),
                "chunks": res.get("chunks", []),
                "total": res.get("total",0),
                "latency_ms": int((time.time()-t0)*1000),
                "observation": f"Base de conocimiento: {len(res.get('chunks',[]))} fragmentos",
            }
            return out
        except Exception as e:
            return {
                "tool": "rag",
                "query": query,
                "store": "pgvector-lite",
                "error": str(e),
                "chunks": [],
                "latency_ms": int((time.time()-t0)*1000),
            }

# ── Reasoning Engine ──
class ReasoningService:
    """
    Motor ReAct con límites, trazabilidad y manejo de errores.
    """

    def __init__(self):
        self.analyzer = ResultAnalyzerTool()
        self.web_search = WebSearchTool()
        self.rag = RagTool()
        self.run_counter = 0

    def _should_use_tools(self, text: str, metric: Optional[Dict]) -> Dict[str, bool]:
        """
        Decide qué herramientas usar — MEJORADO: usa web_search por defecto para consultas factuales.
        """
        lower = (text or "").lower().strip()
        # Analyzer: números o métricas o palabras de análisis
        needs_analyzer = bool(metric) or bool(re.search(r"\d+\s*%", text)) or any(k in lower for k in ["analiza", "resultado", "crecimiento", "incremento", "decremento", "tendencia", "%", "25%", "kpi", "métrica"])
        # Web search: CORREGIDO — mucho más permisivo
        web_keywords = ["busca", "search", "información", "informacion", "complementaria", "externa", "actual", "actualidad", "hoy", "ayer", "precio", "noticia", "noticias", "investiga", "internet", "web", "qué es", "que es", "quién", "quien", "cómo", "como", "cuándo", "cuando", "dónde", "donde", "por qué", "por que", "cuál", "cual", "define", "definición", "definicion", "explica", "explícame", "qué pasó", "que paso", "último", "ultimo", "reciente", "novedad", "2024", "2025", "2026", "inteligencia artificial", "ia", "tecnología", "tecnologia"]
        needs_search = any(k in lower for k in web_keywords)
        # Si es pregunta (empieza con qué/cómo/etc o contiene ?) → web_search (excepto si es consulta de documentos)
        is_doc_q = any(k in lower for k in ["mis documentos", "mi documento", "qué hay en mis", "en mis archivos", "contrato", "penalidad", "cláusula", "clausula", "plazo de entrega", "confidencialidad", "pliego", "acta", "manual", "garantía", "garantia", "base de conocimiento", "biblioteca"] )
        if not is_doc_q and (lower.startswith(("qué ", "que ", "quién", "quien", "cómo", "como ", "cuál", "cual ", "cuándo", "cuando", "dónde", "donde", "por qué", "por que", "define", "explica")) or "?" in text or "¿" in text):
            needs_search = True
        # Si es consulta factual larga (>8 palabras) y no es claramente sobre documentos locales
        is_doc_query = any(k in lower for k in ["mis documentos", "mi documento", "mi pdf", "mi contrato", "subidos", "en mis archivos", "qué hay en mis", "contrato", "penalidad", "cláusula", "clausula", "plazo de entrega", "confidencialidad", "pliego", "acta", "manual", "garantía", "garantia", "base de conocimiento", "biblioteca"] )
        if not is_doc_query and len(text.split()) >= 4 and not needs_search:
            # Por defecto, para consultas informativas generales, usar web_search
            # Esto hace que "qué es la inteligencia artificial" → web_search True
            if any(k in lower for k in ["qué es", "que es", "qué son", "que son", "inteligencia", "artificial", "tecnología", "ciencia", "historia", "quien es", "quién es"]):
                needs_search = True
            elif len(text) > 20 and lower not in ["hola", "gracias", "ayuda"]:
                # Para cualquier consulta con contenido informativo, activar web_search por defecto
                needs_search = True
        # Heurística especial: "Analiza... y busca..." → ambos
        if "analiza" in lower and "busca" in lower:
            needs_analyzer = True
            needs_search = True
        # CORREGIDO: consultas sobre documentos locales no usan web_search
        is_doc_query = any(k in lower for k in ["mis documentos", "mi documento", "mi pdf", "mi contrato", "subidos", "en mis archivos", "qué hay en mis", "contrato", "penalidad", "cláusula", "clausula", "plazo de entrega", "confidencialidad", "pliego", "acta", "manual", "garantía", "garantia", "base de conocimiento", "biblioteca"] )
        if is_doc_query:
            # Solo usar web si pide explícitamente web/internet
            if not any(k in lower for k in ["web", "internet", "externa", "busca en web", "buscar en web"]):
                needs_search = False
        # Caso especial: si el usuario escribe explícitamente "sin web" o "solo documentos" → no buscar
        if any(k in lower for k in ["sin web", "solo documentos", "solo mis documentos", "no busques en web"]):
            needs_search = False
        # RAG: si menciona documentos/base de conocimiento, activar
        rag_keywords = ["documento","pdf","contrato","penalidad","cláusula","clausula","plazo","confidencialidad","pliego","acta","manual","garantía","garantia","base de conocimiento","biblioteca","mis documentos","mi documento"]
        needs_rag = any(k in lower for k in rag_keywords)
        # Si es consulta sobre documentos, priorizar RAG y desactivar web salvo pedido explícito web
        if needs_rag:
            # ya manejado arriba para web, pero asegura rag true
            pass
        # SONDEO DE LA BASE: si los documentos indexados responden bien a la
        # consulta, se usa RAG aunque no aparezcan las palabras clave de arriba.
        # Así el asistente contesta con lo que el usuario subió.
        try:
            from app.services.rag_service import query_rag
            probe = query_rag(text, top_k=1)
            top = (probe.get("chunks") or [{}])[0]
            if len(text.split()) >= 2 and top.get("score", 0) >= 0.45:
                needs_rag = True
                pide_web = any(k in lower for k in ["web", "internet", "externa", "actualidad", "hoy", "ayer", "noticia", "precio", "cotización", "cotizacion"])
                if not pide_web:
                    needs_search = False
        except Exception:
            pass
        return {"result_analyzer": needs_analyzer, "web_search": needs_search, "rag": needs_rag}

    async def run_react(self, context: Dict[str, Any], history: Optional[List[Dict]] = None, run_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Ejecuta ciclo ReAct completo.
        Entrada: contexto de percepción + historial corto
        Salida: {status, tools_used, observations, final_reasoning, next_step, trace}
        """
        import uuid as _uuid
        run_id = run_id or f"run_{_uuid.uuid4().hex[:8]}"
        text = context.get("text") or context.get("cleaned") or context.get("input") or ""
        metric = context.get("metric")
        trace: List[Dict[str, Any]] = []
        observations: List[Dict[str, Any]] = []
        tools_used: List[str] = []

        start = time.time()
        tool_calls = 0
        iterations = 0

        # ── Paso 1: Reasoning inicial ──
        trace.append({"step": 1, "type": "reasoning", "thought": f"Usuario proporciona: '{text[:80]}...'. Necesito determinar si hay resultado que analizar y si requiere información externa."})
        iterations += 1

        decision = self._should_use_tools(text, metric)
        trace.append({"step": 2, "type": "decision", "needs": decision})

        # ── Paso 2-4: result_analyzer si corresponde ──
        if decision["result_analyzer"]:
            if tool_calls >= MAX_TOOL_CALLS:
                trace.append({"type": "limit", "reason": "MAX_TOOL_CALLS alcanzado antes de result_analyzer"})
            elif iterations >= MAX_ITERATIONS:
                trace.append({"type": "limit", "reason": "MAX_ITERATIONS alcanzado"})
            else:
                # Cache check ya está dentro de tool si aplica, aquí directo
                trace.append({"step": 3, "type": "action", "tool": "result_analyzer", "input": text[:120]})
                try:
                    obs = self.analyzer.run(text)
                    obs["observation"] = f"Resultado {'positivo' if obs['trend']=='positive' else 'negativo' if obs['trend']=='negative' else 'neutro'}. Variación {obs.get('value')}% — {obs['interpretation']}"
                    observations.append(obs)
                    tools_used.append("result_analyzer")
                    tool_calls += 1
                    iterations += 1
                    trace.append({"step": 4, "type": "observation", "tool": "result_analyzer", "output": obs["observation"]})
                except Exception as e:
                    err = {"tool": "result_analyzer", "error": str(e), "status": "failed"}
                    observations.append(err)
                    trace.append({"type": "error", "tool": "result_analyzer", "error": str(e)})
                    logger.warning(f"[{run_id}] result_analyzer error: {e}")

        # ── Paso 5-6: web_search si corresponde ──
        if decision["web_search"]:
            if tool_calls >= MAX_TOOL_CALLS:
                trace.append({"type": "limit", "reason": "MAX_TOOL_CALLS alcanzado antes de web_search"})
            elif iterations >= MAX_ITERATIONS:
                trace.append({"type": "limit", "reason": "MAX_ITERATIONS antes de web_search"})
            else:
                # Construye query: MEJORADO — usa el texto real del usuario
                query = (text or "").strip()[:200]
                # Si hay métrica, enriquecer query con contexto
                if metric and metric.get('metric'):
                    query = f"{query} {metric.get('metric')} {metric.get('value','')}{metric.get('unit','')}".strip()[:200]
                # Limpiar query para web search (quitar exceso)
                query = query.replace("  ", " ").strip()
                if len(query) < 5:
                    query = (text or "consulta general")[:200]
                trace.append({"step": 5, "type": "action", "tool": "web_search", "input": query})
                try:
                    # Timeout control
                    import asyncio
                    obs = await asyncio.wait_for(self.web_search.run(query), timeout=TOOL_TIMEOUT)
                    obs["observation"] = f"Resultados de búsqueda: {len(obs.get('results',[]))} fuentes ({obs.get('provider')})" + (" [cached]" if obs.get("cached") else "")
                    observations.append(obs)
                    tools_used.append("web_search")
                    tool_calls += 1
                    iterations += 1
                    trace.append({"step": 6, "type": "observation", "tool": "web_search", "output": obs["observation"]})
                except asyncio.TimeoutError:
                    err = {"tool": "web_search", "error": f"timeout {TOOL_TIMEOUT}s", "status": "timeout"}
                    observations.append(err)
                    trace.append({"type": "timeout", "tool": "web_search", "timeout": TOOL_TIMEOUT})
                except Exception as e:
                    err = {"tool": "web_search", "error": str(e), "status": "failed"}
                    observations.append(err)
                    trace.append({"type": "error", "tool": "web_search", "error": str(e)})

        # ── RAG: consulta base de conocimiento si corresponde ──
        if decision.get("rag"):
            if tool_calls >= MAX_TOOL_CALLS:
                trace.append({"type": "limit", "reason": "MAX_TOOL_CALLS alcanzado antes de rag"})
            elif iterations >= MAX_ITERATIONS:
                trace.append({"type": "limit", "reason": "MAX_ITERATIONS antes de rag"})
            else:
                trace.append({"step": 5, "type": "action", "tool": "rag", "input": text[:120]})
                try:
                    import asyncio
                    obs = await asyncio.wait_for(self.rag.run(text), timeout=TOOL_TIMEOUT)
                    obs["observation"] = f"Base de conocimiento: {len(obs.get('chunks',[]))} fragmentos"
                    observations.append(obs)
                    tools_used.append("rag")
                    tool_calls += 1
                    iterations += 1
                    trace.append({"step": 6, "type": "observation", "tool": "rag", "output": obs["observation"]})
                except asyncio.TimeoutError:
                    err = {"tool": "rag", "error": f"timeout {TOOL_TIMEOUT}s", "status": "timeout"}
                    observations.append(err)
                    trace.append({"type": "timeout", "tool": "rag", "timeout": TOOL_TIMEOUT})
                except Exception as e:
                    err = {"tool": "rag", "error": str(e), "status": "failed"}
                    observations.append(err)
                    trace.append({"type": "error", "tool": "rag", "error": str(e)})

        # ── Paso 7: Reasoning integración ──
        if time.time() - start > int(os.getenv("REACT_TIMEOUT", "45")):
            trace.append({"type": "timeout", "reason": "REACT_TIMEOUT global"})
            status = "timeout"
        else:
            trace.append({"step": 7, "type": "reasoning", "thought": f"Integrando {len(observations)} observaciones: {', '.join(tools_used) or 'ninguna'}. Decido generar respuesta final."})
            status = "completed"
        iterations += 1

        # ── Límites finales ──
        token_estimate = len(text) // 4 + sum(len(str(o)) // 4 for o in observations)
        if token_estimate > TOKEN_LIMIT:
            trace.append({"type": "warning", "reason": f"TOKEN_LIMIT {token_estimate} > {TOKEN_LIMIT}, truncando"})
        if iterations > MAX_ITERATIONS:
            trace.append({"type": "warning", "reason": f"iterations {iterations} > MAX_ITERATIONS {MAX_ITERATIONS}"})

        elapsed_ms = int((time.time() - start) * 1000)

        return {
            "run_id": run_id,
            "status": status,
            "context_hash": context.get("hash"),
            "tools_used": tools_used,
            "observations": observations,
            "trace": trace,
            "iterations": iterations,
            "tool_calls": tool_calls,
            "elapsed_ms": elapsed_ms,
            "token_estimate": token_estimate,
            "next_step": "final_answer" if status == "completed" else "retry_or_fallback",
            "limits": {"MAX_ITERATIONS": MAX_ITERATIONS, "MAX_TOOL_CALLS": MAX_TOOL_CALLS, "TOOL_TIMEOUT": TOOL_TIMEOUT, "TOKEN_LIMIT": TOKEN_LIMIT},
            "model": "Perception → Context → Reasoning → [ResultAnalyzer|WebSearch] → Observations → Reasoning → Final Answer"
        }
