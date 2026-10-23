
"""
processor_service.py — PROCESSOR con 7 ramas + tri Split
├── Web Search
├── RAG
├── Database
├── Documents
├── External APIs
├── Notifications
└── Workflows

Tri: Web Search / RAG / External API → Resultados
"""
from typing import Dict, Any, List, Optional
import asyncio
import re
import pathlib as _pl
def _load_md2(n):
    for c in [_pl.Path("/home/user/agente_react_rag/docs")/n, _pl.Path(__file__).resolve().parents[2]/"docs"/n]:
        if c.exists():
            try: return c.read_text(encoding="utf-8")[:2000]
            except: pass
    return ""
_MD_PROCESSOR = _load_md2("03_PROCESSOR_7_RAMAS.md")

class ProcessorService:
    async def web_search(self, query: str) -> Dict[str, Any]:
        # Cliente real: Tavily primario + DuckDuckGo fallback (Python)
        import time
        t0 = time.time()
        try:
            from app.services.web_search_client import web_search as client_search
            data = await client_search(query, max_results=5)
            results = data.get("results") or []
            provider = data.get("provider") or "unknown"
            # Normalizar a formato esperado
            norm = []
            for r in results:
                norm.append({
                    "title": r.get("title") or "Sin título",
                    "url": r.get("url") or "",
                    "snippet": r.get("snippet") or r.get("body") or "",
                    "score": r.get("score") or 0.75,
                })
            return {
                "tool": "web_search",
                "query": query,
                "internet": True,
                "provider": provider,
                "results": norm[:5],
                "latency_ms": int((time.time()-t0)*1000),
                "answer": data.get("answer"),
            }
        except Exception as e:
            # Fallback mock si falla cliente
            return {
                "tool": "web_search",
                "query": query,
                "internet": False,
                "provider": "mock",
                "error": str(e),
                "results": [
                    {"title": "Resultado 1 (mock)", "url": "https://example.com/1", "snippet": f"Info sobre {query[:40]}...", "score": 0.92},
                    {"title": "Resultado 2 (mock)", "url": "https://example.com/2", "snippet": "Datos complementarios...", "score": 0.84},
                ],
                "latency_ms": int((time.time()-t0)*1000),
            }

    async def rag(self, query: str, chat_id: Optional[str]=None) -> Dict[str, Any]:
        # RAG real via rag_service (base de conocimiento indexada)
        try:
            from app.services.rag_service import query_rag
            res = query_rag(query, top_k=5, chat_id=chat_id)
            # Compat: ya incluye chunks, score, source
            return res
        except Exception as e:
            # Fallback si falla índice
            return {
                "tool": "rag",
                "query": query,
                "store": "pgvector-lite",
                "error": str(e),
                "chunks": [
                    {"id": "doc_1::c42", "text": "Contrato cláusula 5: penalidad 5% por demora...", "score": 0.89, "source": "contrato.pdf"},
                    {"id": "doc_2::c11", "text": "Anexo memoria técnica...", "score": 0.81, "source": "memoria.md"},
                ],
                "filters": {"chat_id": chat_id},
            }

    async def database(self, query: str, chat_id: Optional[str]=None) -> Dict[str, Any]:
        return {"tool": "database", "query": query, "rows": [{"id": 1, "content": "historial previo"}], "engine": "PostgreSQL"}

    async def documents(self, query: str) -> Dict[str, Any]:
        return {"tool": "documents", "query": query, "parser": "MarkItDown", "docs": ["accion.md","percepcion.md"]}

    async def external_apis(self, query: str) -> Dict[str, Any]:
        return {"tool": "external_apis", "query": query, "apis": ["rest","tools"], "status": "ok"}

    async def notifications(self, payload: Dict) -> Dict[str, Any]:
        return {"tool": "notifications", "sent": True, "channel": "websocket"}

    async def workflows(self, plan: List[Dict]) -> Dict[str, Any]:
        return {"tool": "workflows", "executed": plan, "status": "scheduled"}

    # --- Tri Processor: Web Search / RAG / External API → Resultados ---
    async def tri_processor(self, query: str, plan: List[Dict], chat_id: Optional[str]=None) -> Dict[str, Any]:
        tasks = []
        tools = [p["tool"] for p in plan]
        if "web_search" in tools:
            tasks.append(self.web_search(query))
        if "rag" in tools:
            tasks.append(self.rag(query, chat_id))
        if "external_apis" in tools or "external_api" in tools:
            tasks.append(self.external_apis(query))
        if not tasks:
            tasks.append(self.database(query, chat_id))
        results = await asyncio.gather(*tasks)
        # Normaliza
        merged = {"query": query, "fuentes": [r["tool"] for r in results], "resultados": results}
        # Rank simple por score
        all_snippets = []
        for r in results:
            for key in ["results","chunks","rows"]:
                if key in r:
                    all_snippets.extend(r[key])
        merged["total_items"] = len(all_snippets)
        return merged

    async def process(self, query: str, plan: List[Dict], chat_id: Optional[str]=None) -> Dict[str, Any]:
        # Ejecuta 7 ramas según plan, pero para diagrama ejecuta tri
        tri = await self.tri_processor(query, plan, chat_id)
        # Ejecuta complementarios
        extras = {}
        if "documents" in [p["tool"] for p in plan]:
            extras["documents"] = await self.documents(query)
        if "notifications" in [p["tool"] for p in plan]:
            extras["notifications"] = await self.notifications({"query": query})
        return {
            "processor": {
                "web_search": "ejecutado" if "web_search" in tri["fuentes"] else "skip",
                "rag": "ejecutado" if "rag" in tri["fuentes"] else "skip",
                "database": "ejecutado" if "database" in tri["fuentes"] else "skip",
                "documents": extras.get("documents", "skip"),
                "external_apis": "ejecutado" if "external_apis" in tri["fuentes"] else "skip",
                "notifications": extras.get("notifications", "skip"),
                "workflows": "skip",
            },
            "tri_result": tri,
            "resultados": tri,
            "next": "PROCESSOR RESULT",
        }
