"""
response_service.py — RESPONSE natural, sin jerga técnica
Entrega respuestas útiles, claras y conversacionales.
Ya no expone internals (ReAct, tri_result, plan, fragments, etc.)
"""

from typing import Dict, Any, List, Optional
import pathlib as _pl

def _load_md3(n):
    for c in [_pl.Path("/home/user/agente_react_rag/docs")/n, _pl.Path(__file__).resolve().parents[2]/"docs"/n]:
        if c.exists():
            try: return c.read_text(encoding="utf-8")[:2000]
            except: pass
    return ""
_MD_RESPONSE = _load_md3("04_RESPONSE_5_APARTADOS.md")

class ResponseService:
    def sintesis(self, resultados: Dict[str, Any], query: str) -> str:
        """Respuesta natural y contextual, sin métricas internas."""
        web_items = []
        rag_chunks = []
        analyzer_items = []
        for r in resultados.get("resultados", []):
            if r.get("tool") == "web_search" and r.get("results"):
                web_items.extend(r.get("results", [])[:3])
            if r.get("tool") == "rag" and r.get("chunks"):
                rag_chunks.extend(r.get("chunks", [])[:3])
            if r.get("tool") == "result_analyzer":
                analyzer_items.append(r)

        # Caso 1: RAG + Web — prioriza base de conocimiento
        if rag_chunks and web_items:
            # Usa primer chunk como base
            chunk_text = (rag_chunks[0].get("text","") or "")[:280]
            web_title = web_items[0].get("title","")[:60]
            if chunk_text:
                return (
                    f"Según tus documentos, {chunk_text.strip().rstrip('.')}.\n\n"
                    f"Información complementaria actualizada: {web_items[0].get('snippet','')[:220].strip()} "
                    f"Te dejo las fuentes abajo para que verifiques."
                ).strip()
            return (
                f"Encontré información relevante tanto en tus documentos como en la web sobre \"{query[:55]}...\". "
                f"{web_items[0].get('snippet','')[:240].strip()} "
                f"Revisá las fuentes para más detalle."
            ).strip()

        # Caso 2: Solo RAG
        if rag_chunks:
            texts = [c.get("text","").strip() for c in rag_chunks[:2] if c.get("text")]
            if len(texts) == 1:
                base = texts[0][:420]
                # Si es largo, resume con primera frase + contexto
                if len(base) > 380:
                    base = base[:380].rsplit(" ",1)[0] + "..."
                return (
                    f"En tus documentos encontré lo siguiente sobre \"{query[:45]}...\":\n\n"
                    f"\"{base.strip()}\"\n\n"
                    f"¿Querés que profundice en algún punto específico de estos documentos?"
                ).strip()
            elif len(texts) > 1:
                joined = " ".join(t[:180] for t in texts)[:500]
                return (
                    f"Según tu base de conocimiento, sobre \"{query[:45]}...\":\n\n"
                    f"{joined.strip()}\n\n"
                    f"Encontré {len(rag_chunks)} resultados relevantes. Decime si querés que profundice en alguno."
                ).strip()
            else:
                return f"Encontré información en tus documentos sobre \"{query[:60]}...\". Revisá las fuentes citadas abajo."

        # Caso 3: Solo Web
        if web_items:
            # Natural summary from first two snippets
            first = web_items[0]
            snippet = (first.get("snippet","") or "")[:260].strip()
            if snippet:
                # Limpiar snippet cortado
                if not snippet.endswith("."):
                    snippet = snippet.rsplit(" ",1)[0] + "."
                title = first.get("title","").strip()
                if title:
                    return (
                        f"Sobre \"{query[:60]}...\": {snippet}\n\n"
                        f"Fuente destacada: {title}. "
                        f"Si querés, puedo ampliar con más detalles o buscar algo más específico."
                    ).strip()
                return (
                    f"Sobre \"{query[:60]}...\": {snippet}\n\n"
                    f"Te dejo abajo las fuentes para que puedas profundizar."
                ).strip()
            # Fallback si no hay snippet
            titles = ", ".join([w.get("title","")[:50] for w in web_items[:2] if w.get("title")])
            if titles:
                return (
                    f"Encontré información actualizada sobre \"{query[:60]}...\". "
                    f"Algunas fuentes relevantes: {titles}. "
                    f"Contame si querés que profundice en alguna."
                ).strip()
            return f"Encontré información actualizada sobre \"{query[:60]}...\". ¿Te interesa que la detalle más?"

        # Caso 4: Solo análisis de métrica
        if analyzer_items:
            ana = analyzer_items[0]
            val = ana.get("value")
            unit = ana.get("unit") or ""
            trend = ana.get("trend","neutral")
            interp = ana.get("interpretation","")
            if val is not None:
                tendencia = "al alza" if trend=="positive" else "a la baja" if trend=="negative" else "estable"
                return (
                    f"Analicé tu consulta: el valor es {val}{unit}, con tendencia {tendencia}. "
                    f"{interp.capitalize() if interp else ''} "
                    f"¿Querés que compare con otros períodos o te arme un resumen?"
                ).strip()
            return f"Analicé \"{query[:60]}...\". {interp} ¿Te armo un resumen o comparación?"

        # Caso 5: Sin resultados específicos — respuesta útil, no vacía
        lower = (query or "").lower()
        if any(k in lower for k in ["hola","buen","gracias","chau","ayuda"]):
            return (
                "¡Hola! Soy tu asistente. Puedo ayudarte a consultar tus documentos, "
                "buscar información actualizada en la web o analizar datos. "
                "Decime qué necesitás y lo vemos juntos."
            )
        if "mis documentos" in lower or "qué hay en mis" in lower:
            return (
                "Para responder sobre tus documentos, subilos en la sección **Documentos** y luego "
                "preguntame en **Base de Conocimiento**. También podés buscar por palabras clave como "
                "\"penalidad\", \"plazo de entrega\" o \"confidencialidad\"."
            )
        return (
            f"Sobre \"{query[:60]}...\" aún no tengo un resultado específico en tu base. "
            f"Probá reformulando con más detalle o indicame si preferís que busque en tus documentos "
            f"o en la web. ¡Estoy listo para ayudarte!"
        )

    def explicacion(self, resultados: Dict[str, Any], analyzer: Dict) -> str:
        """Explicación simple, sin jerga técnica. Si no aporta valor, retorna vacío para ocultar."""
        # Ya no exponemos ReAct, plan, tools, fragments. Mensaje humano y breve.
        has_rag = any(r.get("tool")=="rag" for r in resultados.get("resultados",[]))
        has_web = any(r.get("tool")=="web_search" for r in resultados.get("resultados",[]))
        if has_rag and has_web:
            return "Combiné lo que encontré en tus archivos con información actualizada de la web para darte una respuesta más completa."
        if has_rag:
            return "Usé como base lo que está en tus documentos, citando los pasajes más relevantes."
        if has_web:
            return "Complementé tu consulta con información actualizada de fuentes confiables en la web."
        # Para consultas directas, no necesita explicación técnica
        return ""

    def fuentes(self, resultados: Dict[str, Any]) -> List[Dict[str,str]]:
        srcs = []
        for r in resultados.get("resultados", []):
            for item in r.get("results", []):
                if "url" in item and item["url"]:
                    # Solo URLs http válidas, ignora internas vacías
                    url = item["url"]
                    if url.startswith("http"):
                        srcs.append({"titulo": item.get("title","Fuente")[:80], "url": url, "tipo": "web", "snippet": item.get("snippet","")[:150]})
            for item in r.get("chunks", []):
                if "source" in item or "text" in item:
                    titulo = item.get("source") or item.get("title") or "Documento"
                    # URL amigable: si hay doc_id, link a documento, si no solo nombre
                    url = item.get("url") or f"doc://{item.get('id','')}" if item.get("id") else ""
                    # Para UI, si no hay URL http, muestra nombre como titulo y no link roto
                    if not url or not url.startswith("http"):
                        url = ""  # frontend mostrará sin link, solo título
                    srcs.append({"titulo": titulo[:60], "url": url, "tipo": "documento", "snippet": item.get("text","")[:120]})
        # De-duplicar por url/titulo
        seen = set()
        uniq = []
        for s in srcs:
            key = (s["titulo"], s["url"])
            if key not in seen:
                seen.add(key)
                uniq.append(s)
        return uniq[:5]

    def recomendaciones(self, resultados: Dict, riesgo: str) -> List[str]:
        recs = []
        has_rag = any(r.get("tool")=="rag" for r in resultados.get("resultados",[]))
        has_web = any(r.get("tool")=="web_search" for r in resultados.get("resultados",[]))
        # Recomendaciones naturales, no técnicas
        if has_rag:
            recs.append("Podés pedir el documento completo para ver el contexto original.")
        if has_web:
            recs.append("Revisá las fuentes web citadas si necesitás más detalle.")
        # Siempre útil: sugerir profundizar
        recs.append("Si querés, haceme una pregunta más específica y te lo detallo.")
        return recs[:3]

    def acciones_propuestas(self, resultados: Dict, analyzer: Dict) -> List[Dict[str,str]]:
        # Acciones internas mínimas, no visibles en chat principal
        return [{"accion": "responder", "detalle": "Entregar respuesta al usuario"}]

    def build(self, query: str, analyzer: Dict, processor: Dict) -> Dict[str, Any]:
        resultados = processor.get("tri_result") or processor.get("resultados") or {}
        riesgo = analyzer.get("riesgo","bajo")
        exp = self.explicacion(resultados, analyzer)
        return {
            "response": {
                "sintesis": self.sintesis(resultados, query),
                "explicacion": exp,
                "fuentes": self.fuentes(resultados),
                "recomendaciones": self.recomendaciones(resultados, riesgo),
                "acciones_propuestas": self.acciones_propuestas(resultados, analyzer),
            },
            "resultados": resultados,
            "next": "USER",
            "channel": "WebSocket / Frontend"
        }
