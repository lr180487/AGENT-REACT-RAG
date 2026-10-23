"""
routes_sync.py — Estado de sincronía Backend ↔ Frontend.

GET /api/v1/sync/status
    Conteos reales de documentos (base y RAG), conversaciones y mensajes.
    Lo usa el frontend para mostrar si lo que ve coincide con lo guardado.
"""
from fastapi import APIRouter
from datetime import datetime

from app.db.database import SessionLocal
from app.db.models import Chat, Message
from app.services import documents_service, rag_service

router = APIRouter(prefix="/api/v1/sync", tags=["Sync"])


@router.get("/status", summary="Estado de sincronía")
async def sync_status():
    docs = documents_service.sync_report()

    chats = messages = 0
    db_ok = True
    try:
        db = SessionLocal()
        try:
            chats = db.query(Chat).count()
            messages = db.query(Message).count()
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        db_ok = False

    return {
        "ok": db_ok and docs["in_sync"],
        "storage": "sqlite/postgres",
        "documents": docs["documents"],
        "documents_seed": docs["documents_seed"],
        "documents_uploaded": docs["documents_uploaded"],
        "documents_chunks": docs["chunks_db"],
        "rag_documents": docs["rag_documents"],
        "rag_chunks": len(getattr(rag_service, "_CHUNKS", [])),
        "in_sync": docs["in_sync"],
        "chats": chats,
        "messages": messages,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }
