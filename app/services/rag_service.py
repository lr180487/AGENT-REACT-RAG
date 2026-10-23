"""
rag_service.py — Base de Conocimiento (RAG) con retrieval real sobre documentos subidos
- Indexa documentos (chunks + keyword embeddings simulados)
- Retrieval por scoring keyword + TF + frase exacta
- Soporta filtros por chat_id y top_k
- Mock pgvector reemplazado por motor ligero en memoria, listo para migrar a pgvector/FAISS
"""

import re
import uuid
import time
from typing import Dict, Any, List, Optional
from datetime import datetime

# Almacenamiento en memoria: doc_id -> doc meta + chunks
_DOCS: Dict[str, Dict[str, Any]] = {}
# chunks: List[Dict] -> {id, doc_id, source, text, tokens}
_CHUNKS: List[Dict[str, Any]] = []

# Seed inicial para que la base no esté vacía aunque no haya uploads
_SEED_DOCS = [
    {
        "name": "Contrato_Marco_2024.pdf",
        "source": "Contrato_Marco_2024.pdf",
        "text": """CONTRATO MARCO 2024 — CLÁUSULAS PRINCIPALES
Cláusula 4.2 — Penalidad por incumplimiento: 5% del monto total por cada día de demora, con tope del 25%.
Cláusula 4.3 — Plazo de entrega: 30 días hábiles desde la orden de compra. Prórroga solo por fuerza mayor.
Cláusula 5.1 — Confidencialidad: las partes se obligan a no divulgar información técnica ni comercial por 2 años.
Cláusula 7 — Garantía: 12 meses por defectos de fabricación. Soporte técnico 24/7 primer trimestre.
Anexo A — Cronograma de pagos: 30% anticipo, 40% contra entrega, 30% a 30 días.
Anexo B — Memoria técnica: arquitectura en nube, escalable y con cifrado AES-256.
""",
    },
    {
        "name": "Pliego_Tecnico.pdf",
        "source": "Pliego_Tecnico.pdf",
        "text": """PLIEGO TÉCNICO — ESPECIFICACIONES
Sección 2.1 — Plazo de entrega: 45 días corridos. Penalidad 0,5% diario por demora injustificada.
Sección 3.4 — Confidencialidad: toda documentación marcada como reservada debe cifrarse.
Sección 4 — Soporte y mantenimiento: incluye actualización de software y capacitación al personal.
Sección 5 — Entregables: manual operativo + código fuente en repositorio privado.
""",
    },
    {
        "name": "Acta_Reunion_2024-03-15.md",
        "source": "Acta_Reunion_2024-03-15.md",
        "text": """Acta de Reunión — 15/03/2024
Participantes: Gerencia, Legal, Técnica.
Temas: Revisión de KPIs Q1 — ventas +12% vs Q4. Penalidad contratos: se acordó reducir tope a 15% para nuevos proveedores. Plazo de entrega crítico para proyecto Alfa: 20 días. Confidencialidad reforzada tras auditoría.
Acuerdos: validar garantía extendida y cronograma de pagos.
""",
    },
    {
        "name": "Manual_Operativo.docx",
        "source": "Manual_Operativo.docx",
        "text": """MANUAL OPERATIVO — Versión 2.3
Capítulo 1 — Uso del sistema: login, dashboard, carga de documentos (PDF, DOCX, XLSX, PPT, CSV, TXT, MD).
Capítulo 2 — Base de Conocimiento: la búsqueda semántica encuentra fragmentos relevantes por similitud.
Capítulo 3 — Preguntas frecuentes: ¿Cómo consultar penalidad? → buscar "penalidad por incumplimiento".
Capítulo 4 — Web Search: complementa con Tavily → SerpAPI → DuckDuckGo.
Garantía: soporte incluido 6 meses.
""",
    },
]

def _normalize(s: str) -> str:
    return (s or "").lower().strip().translate(str.maketrans("áéíóú","aeiou")).lower()

def _tokenize(s: str) -> List[str]:
    return re.findall(r"\w+", _normalize(s))

def _chunk_text(text: str, chunk_size: int = 450, overlap: int = 60) -> List[str]:
    """Chunking por caracteres con overlap, simple y efectivo."""
    if not text:
        return []
    text = text.strip()
    if len(text) <= chunk_size:
        return [text]
    chunks = []
    i = 0
    while i < len(text):
        chunk = text[i:i+chunk_size]
        # Intenta cortar en fin de frase
        if len(chunk) == chunk_size and i + chunk_size < len(text):
            last_dot = chunk.rfind(".")
            last_nl = chunk.rfind("\n")
            cut = max(last_dot, last_nl)
            if cut > chunk_size * 0.6:
                chunk = chunk[:cut+1]
                i += cut+1 - overlap if overlap else cut+1
                chunks.append(chunk.strip())
                continue
        chunks.append(chunk.strip())
        i += chunk_size - overlap
    return [c for c in chunks if len(c.strip()) > 20]

_SEEDED = False
def _ensure_seed():
    global _SEEDED
    if _SEEDED:
        return
    if _CHUNKS:
        _SEEDED = True
        return
    _SEEDED = True
    for d in _SEED_DOCS:
        # Evita recursión: indexa directo sin volver a llamar _ensure_seed
        doc_id = f"seed_{uuid.uuid4().hex[:8]}"
        name = d["name"]
        text = d["text"]
        source = d["source"]
        meta = {
            "doc_id": doc_id,
            "name": name,
            "source": source,
            "chat_id": "demo",
            "created_at": datetime.utcnow().isoformat()+"Z",
            "chunks": 0,
            "is_seed": True,
            "preview": (text or "")[:220],
        }
        _DOCS[doc_id] = meta
        chunks = _chunk_text(text or f"Documento {name} — contenido de ejemplo.")
        for idx, ch_text in enumerate(chunks):
            cid = f"{doc_id}::c{idx:03d}"
            _CHUNKS.append({
                "id": cid,
                "doc_id": doc_id,
                "source": source,
                "title": f"{name} — chunk {idx+1}",
                "text": ch_text.strip(),
                "tokens": set(_tokenize(ch_text)),
                "norm": _normalize(ch_text),
                "chat_id": "demo",
            })
        _DOCS[doc_id]["chunks"] = len(chunks)

def index_document(doc_id: str, name: str, text: str, source: Optional[str]=None, chat_id: str="demo", is_seed: bool=False):
    """Indexa un documento: guarda meta y chunks."""
    if not _SEEDED:
        _ensure_seed()
    source = source or name
    doc_id = doc_id or f"doc_{uuid.uuid4().hex[:8]}"
    meta = {
        "doc_id": doc_id,
        "name": name,
        "source": source,
        "chat_id": chat_id,
        "created_at": datetime.utcnow().isoformat()+"Z",
        "chunks": 0,
        "is_seed": is_seed,
        "preview": (text or "")[:220],
    }
    _DOCS[doc_id] = meta
    chunks = _chunk_text(text or f"Documento {name} — contenido de ejemplo para búsqueda semántica.")
    for idx, ch_text in enumerate(chunks):
        cid = f"{doc_id}::c{idx:03d}"
        _CHUNKS.append({
            "id": cid,
            "doc_id": doc_id,
            "source": source,
            "title": f"{name} — chunk {idx+1}",
            "text": ch_text.strip(),
            "tokens": set(_tokenize(ch_text)),
            "norm": _normalize(ch_text),
            "chat_id": chat_id,
        })
    _DOCS[doc_id]["chunks"] = len(chunks)
    return meta

def list_documents(chat_id: Optional[str]=None) -> List[Dict[str, Any]]:
    _ensure_seed()
    docs = list(_DOCS.values())
    if chat_id and chat_id != "all":
        docs = [d for d in docs if d.get("chat_id")==chat_id or d.get("is_seed")]
    docs.sort(key=lambda x: x["created_at"], reverse=True)
    return docs

def _score(query: str, chunk: Dict[str, Any]) -> float:
    """Scoring híbrido: keyword TF + frase exacta + título boost + longitud."""
    q_norm = _normalize(query)
    q_tokens = _tokenize(q_norm)
    if not q_tokens:
        return 0.0
    c_norm = chunk["norm"]
    c_tokens = chunk["tokens"]
    # TF simple sobre tokens
    hit_tokens = sum(1 for t in q_tokens if t in c_tokens)
    if hit_tokens == 0:
        return 0.0
    score = 0.0
    # Base por cobertura de tokens
    coverage = hit_tokens / len(q_tokens)
    score += coverage * 0.55
    # Bonus por frecuencia de cada token
    for tok in q_tokens:
        cnt = c_norm.count(tok)
        if cnt:
            score += min(cnt*0.08, 0.18)
    # Frase exacta boost alto
    if q_norm in c_norm:
        score += 0.35
    # Bonus si todos los tokens aparecen
    if hit_tokens == len(q_tokens):
        score += 0.12
    # Boost por aparición en título/source
    if any(t in _normalize(chunk["source"]) for t in q_tokens):
        score += 0.12
    # Penaliza chunks muy cortos
    if len(chunk["text"]) < 80:
        score *= 0.85
    # Jitter deterministico pequeño para desempate (según id)
    score += (hash(chunk["id"]) % 100) / 5000.0
    return min(score, 0.99)

def query_rag(query: str, top_k: int=5, chat_id: Optional[str]=None, min_score: float=0.08) -> Dict[str, Any]:
    """
    Retrieval principal. Retorna {query, chunks, total, latency_ms}
    """
    t0 = time.time()
    _ensure_seed()
    if not query or len(query.strip()) < 2:
        return {"query": query, "chunks": [], "total": 0, "latency_ms": 0, "store": "pgvector-lite"}
    pool = _CHUNKS
    if chat_id and chat_id not in ("demo","all",None):
        # La base de conocimiento es del usuario, no de un chat concreto: los
        # documentos subidos ("demo") deben verse desde cualquier conversación.
        pool = [
            c for c in _CHUNKS
            if c.get("chat_id") in (chat_id, "demo") or str(c.get("doc_id","")).startswith("seed_")
        ]
        if not pool:
            pool = _CHUNKS
    scored = []
    for ch in pool:
        s = _score(query, ch)
        if s >= min_score:
            scored.append((s, ch))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_k]
    chunks = []
    for score, ch in top:
        # Highlight snippet: contexto alrededor del primer hit
        text = ch["text"]
        norm_text = _normalize(text)
        q_norm = _normalize(query)
        # Encuentra primera ocurrencia de cualquier token
        pos = -1
        for tok in _tokenize(q_norm):
            p = norm_text.find(tok)
            if p >= 0 and (pos==-1 or p < pos):
                pos = p
        # Si hay frase exacta, prioriza
        pf = norm_text.find(q_norm)
        if pf >=0:
            pos = pf
        snippet = text
        if pos >= 0 and len(text) > 260:
            # Mapear pos aproximada (norm ~ text length similar)
            # Usa pos proporcional
            ratio = pos / max(len(norm_text),1)
            center = int(ratio * len(text))
            start = max(0, center - 110)
            end = min(len(text), center + 220)
            snippet = ("…" if start>0 else "") + text[start:end].strip() + ("…" if end<len(text) else "")
        chunks.append({
            "id": ch["id"],
            "doc_id": ch["doc_id"],
            "source": ch["source"],
            "title": ch["title"],
            "text": ch["text"][:900],
            "snippet": snippet,
            "score": round(score, 3),
            "url": "",  # para compatibilidad con response fuentes
        })
    latency = int((time.time()-t0)*1000)
    return {
        "tool": "rag",
        "query": query,
        "store": "pgvector-lite",
        "chunks": chunks,
        "total": len(scored),
        "top_k": top_k,
        "latency_ms": latency,
    }

# Auto-seed DESACTIVADO: la semilla la controla app.services.documents_service
# (tabla `documents` como fuente de verdad) para no duplicar documentos al
# importar el módulo. Si se necesita el seed aislado, llamar _ensure_seed().
