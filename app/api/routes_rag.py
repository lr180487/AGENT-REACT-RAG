"""
routes_rag.py — Base de Conocimiento RAG
POST /api/v1/rag/query   {query, top_k, chat_id, web_search?}
GET  /api/v1/rag/health
GET  /api/v1/rag/documents
POST /api/v1/rag/index   {name, text, chat_id} (indexar texto manual)
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

router = APIRouter(prefix="/api/v1/rag", tags=["RAG"])

class RagQueryReq(BaseModel):
    query: str = Field(..., example="penalidad por incumplimiento")
    top_k: int = Field(5, ge=1, le=10, description="Fragmentos a devolver")
    chat_id: Optional[str] = Field(None, description="Filtrar por chat")
    web_search: bool = Field(False, description="Complementar con búsqueda web")
    web_max_results: int = Field(3, ge=1, le=5)

class RagIndexReq(BaseModel):
    name: str = Field(..., example="contrato.pdf")
    text: str = Field(..., example="Cláusula 4.2 penalidad 5%...")
    chat_id: Optional[str] = Field(None)
    source: Optional[str] = None

@router.get("/health")
async def health():
    from app.services.rag_service import list_documents, _CHUNKS
    docs = list_documents()
    return {
        "status": "ok",
        "store": "pgvector-lite (memoria + keyword scoring → migrable a pgvector)",
        "documents": len(docs),
        "chunks": len(_CHUNKS),
        "seed": sum(1 for d in docs if d.get("is_seed")),
        "endpoints": ["/api/v1/rag/query", "/api/v1/rag/documents", "/api/v1/rag/index"],
    }

@router.get("/documents")
async def list_docs(chat_id: Optional[str] = Query(None)):
    from app.services.rag_service import list_documents, query_rag
    docs = list_documents(chat_id=chat_id)
    return {"items": docs, "total": len(docs)}

@router.post("/index")
async def index_doc(req: RagIndexReq):
    from app.services.rag_service import index_document
    import uuid
    doc_id = f"doc_{uuid.uuid4().hex[:8]}"
    meta = index_document(doc_id=doc_id, name=req.name, text=req.text, source=req.source or req.name, chat_id=req.chat_id or "demo")
    return {"indexed": True, "doc": meta}

@router.post("/query")
async def rag_query(req: RagQueryReq):
    from app.services.rag_service import query_rag
    from app.services.response_service import ResponseService

    # Retrieval
    rag_result = query_rag(req.query, top_k=req.top_k, chat_id=req.chat_id)

    # Opcional: complementar con web_search si el usuario lo pide
    web_result = None
    if req.web_search:
        try:
            from app.services.web_search_client import web_search as client_search
            ws = await client_search(req.query, max_results=req.web_max_results)
            norm = []
            for r in (ws.get("results") or [])[:req.web_max_results]:
                norm.append({"title": r.get("title") or "Sin título", "url": r.get("url") or "", "snippet": r.get("snippet") or "", "score": r.get("score") or 0.75})
            web_result = {"tool": "web_search", "query": req.query, "provider": ws.get("provider","unknown"), "results": norm}
        except Exception as e:
            web_result = {"tool": "web_search", "error": str(e), "results": []}

    # Construir tri_result como espera ResponseService
    resultados = {
        "fuentes": ["rag"] + (["web_search"] if web_result and web_result.get("results") else []),
        "resultados": [rag_result] + ([web_result] if web_result else []),
        "total_items": len(rag_result.get("chunks",[])) + (len(web_result.get("results",[])) if web_result else 0),
        "query": req.query,
    }

    # Analyzer mínimo para respuesta natural
    analyzer_mock = {
        "analyzer": {"interpretar_intencion": {"intent_raw": "consulta_rag"}},
        "plan": [{"tool": "rag"}] + ([{"tool":"web_search"}] if web_result else []),
        "riesgo": "bajo",
    }

    resp_service = ResponseService()
    built = resp_service.build(req.query, analyzer_mock, {"tri_result": resultados, "resultados": resultados})

    return {
        "query": req.query,
        "rag": rag_result,
        "web": web_result,
        "response": built["response"],
        "resultados": resultados,
        "next": "USER",
        "channel": "RAG / Base de Conocimiento",
    }
