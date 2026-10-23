"""
documents_service.py — Documentos con persistencia real y sincronía con el RAG.

Antes /api/v1/documents vivía en un dict en memoria: al reiniciar el backend la
sección "Documentos" quedaba vacía mientras el asistente seguía respondiendo con
los documentos semilla del RAG. Ahora:

  1. La tabla `documents` (SQLite/PostgreSQL) es la fuente de verdad.
  2. Los 4 documentos semilla del RAG se siembran una sola vez con ids estables.
  3. Al arrancar se reindexa en el RAG todo documento de la base que falte
     (así un reinicio no rompe las respuestas del asistente).
  4. Subir/eliminar por API actualiza base y RAG a la vez.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.db.database import SessionLocal
from app.db.models_doc import Document
from app.services import rag_service

logger = logging.getLogger(__name__)


# ───────────────────────── helpers ─────────────────────────
def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def _slug(text: str, maxlen: int = 40) -> str:
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "_", t).strip("_").lower()
    return (t or "doc")[:maxlen]


def to_dict(d: Document, include_preview: bool = True) -> Dict[str, Any]:
    return {
        "doc_id": d.id,
        "id": d.id,
        "name": d.name,
        "filename": d.filename or d.name,
        "size": d.size or 0,
        "content_type": d.content_type,
        "chat_id": d.chat_id or "demo",
        "parser": d.parser,
        "status": d.status or "indexed",
        "chunks": d.chunks or 0,
        "is_seed": bool(d.is_seed),
        "created_at": _iso(d.created_at),
        "preview": ((d.text or "")[:600] if include_preview else ""),
    }


def _session():
    return SessionLocal()


# ───────────────────────── lectura ─────────────────────────
def list_documents(chat_id: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    db = _session()
    try:
        q = db.query(Document)
        if chat_id and chat_id not in ("all", "demo"):
            q = q.filter((Document.chat_id == chat_id) | (Document.is_seed.is_(True)))
        q = q.order_by(Document.created_at.desc()).limit(limit)
        return [to_dict(d) for d in q.all()]
    finally:
        db.close()


def get_document(doc_id: str) -> Optional[Dict[str, Any]]:
    db = _session()
    try:
        d = db.query(Document).filter(Document.id == doc_id).first()
        return to_dict(d) if d else None
    finally:
        db.close()


def get_document_text(doc_id: str):
    """Devuelve (nombre, texto completo) para la descarga."""
    db = _session()
    try:
        d = db.query(Document).filter(Document.id == doc_id).first()
        return (d.name, d.text or "") if d else None
    finally:
        db.close()


def stats() -> Dict[str, Any]:
    db = _session()
    try:
        total = db.query(Document).count()
        seeds = db.query(Document).filter(Document.is_seed.is_(True)).count()
        uploaded = total - seeds
        chunks = sum((d.chunks or 0) for d in db.query(Document).all())
        size = sum((d.size or 0) for d in db.query(Document).all())
        return {"total": total, "seed": seeds, "uploaded": uploaded, "chunks": chunks, "bytes": size}
    finally:
        db.close()


# ───────────────────────── escritura ─────────────────────────
def _index_in_rag(doc_id: str, name: str, text: str, source: str, chat_id: str, is_seed: bool) -> int:
    """Indexa en el RAG y devuelve la cantidad de chunks."""
    try:
        meta = rag_service.index_document(
            doc_id=doc_id, name=name, text=text or name, source=source,
            chat_id=chat_id, is_seed=is_seed,
        )
        return int(meta.get("chunks") or 0)
    except Exception as e:  # noqa: BLE001
        logger.warning("No se pudo indexar %s en RAG: %s", name, e)
        return 0


def register_document(
    name: str,
    text: str,
    *,
    doc_id: Optional[str] = None,
    filename: Optional[str] = None,
    size: int = 0,
    content_type: Optional[str] = None,
    chat_id: str = "demo",
    parser: str = "Text Parser",
    is_seed: bool = False,
) -> Dict[str, Any]:
    """Guarda el documento en la base y lo indexa en el RAG."""
    db = _session()
    try:
        doc = Document(
            id=doc_id or None,
            name=name,
            filename=filename or name,
            size=size,
            content_type=content_type,
            chat_id=chat_id or "demo",
            parser=parser,
            status="indexed",
            is_seed=is_seed,
            text=text or "",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        chunks = _index_in_rag(doc.id, doc.name, text, doc.filename, doc.chat_id, is_seed)
        doc.chunks = chunks
        db.commit()
        db.refresh(doc)
        return to_dict(doc)
    finally:
        db.close()


def delete_document(doc_id: str) -> bool:
    db = _session()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            return False
        db.delete(doc)
        db.commit()
    finally:
        db.close()
    # Quita del índice RAG
    try:
        rag_service._DOCS.pop(doc_id, None)  # noqa: SLF001
        rag_service._CHUNKS[:] = [c for c in rag_service._CHUNKS if c.get("doc_id") != doc_id]  # noqa: SLF001
    except Exception as e:  # noqa: BLE001
        logger.warning("No se pudo quitar %s del RAG: %s", doc_id, e)
    return True


# ───────────────────────── semilla y reindexado ─────────────────────────
def ensure_seed() -> int:
    """
    Siembra los documentos de ejemplo del RAG en la base con ids estables.
    Devuelve cuántos se crearon.
    """
    # El RAG no debe sembrar por su cuenta: la base manda.
    rag_service._SEEDED = True  # noqa: SLF001

    db = _session()
    created = 0
    try:
        existing = {d.id for d in db.query(Document).all()}
        for item in rag_service._SEED_DOCS:  # noqa: SLF001
            name = item.get("name") or "Documento"
            doc_id = "seed_" + _slug(name)
            if doc_id in existing:
                continue
            text = item.get("text") or ""
            doc = Document(
                id=doc_id,
                name=name,
                filename=item.get("source") or name,
                size=len(text.encode("utf-8")),
                content_type="application/pdf" if name.lower().endswith(".pdf") else "text/plain",
                chat_id="demo",
                parser="PDF Parser" if name.lower().endswith(".pdf") else "Text Parser",
                status="indexed",
                is_seed=True,
                text=text,
            )
            db.add(doc)
            created += 1
        db.commit()
        if created:
            logger.info("✓ Documentos semilla creados en la base: %s", created)
        return created
    finally:
        db.close()


def hydrate_rag() -> int:
    """Indexa en el RAG lo que falte y elimina semillas huérfanas (sin base)."""
    rag_service._SEEDED = True  # noqa: SLF001
    db = _session()
    indexed = 0
    try:
        valid_ids = {d.id for d in db.query(Document).all()}
        # Limpia semillas que ya no existen en la base (evita duplicados tras reinicios)
        orphans = [
            did for did, meta in list(rag_service._DOCS.items())  # noqa: SLF001
            if did not in valid_ids
        ]
        for did in orphans:
            rag_service._DOCS.pop(did, None)  # noqa: SLF001
        if orphans:
            rag_service._CHUNKS[:] = [c for c in rag_service._CHUNKS if c.get("doc_id") not in orphans]  # noqa: SLF001
            logger.info("✓ RAG: %s documentos huérfanos eliminados", len(orphans))
        for doc in db.query(Document).all():
            if doc.id in rag_service._DOCS:
                continue
            chunks = _index_in_rag(doc.id, doc.name, doc.text or doc.name, doc.filename or doc.name, doc.chat_id or "demo", bool(doc.is_seed))
            doc.chunks = chunks
            indexed += 1
        db.commit()
        if indexed:
            logger.info("✓ RAG reindexado desde la base: %s documentos", indexed)
        return indexed
    finally:
        db.close()


def sync_report() -> Dict[str, Any]:
    """Estado de sincronía base ↔ RAG para /api/v1/sync/status."""
    db_stats = stats()
    rag_docs = len(getattr(rag_service, "_DOCS", {}))
    rag_chunks = len(getattr(rag_service, "_CHUNKS", []))
    return {
        "documents": db_stats["total"],
        "documents_seed": db_stats["seed"],
        "documents_uploaded": db_stats["uploaded"],
        "chunks_db": db_stats["chunks"],
        "rag_documents": rag_docs,
        "rag_chunks": rag_chunks,
        "in_sync": db_stats["total"] == rag_docs,
        "checked_at": _now(),
    }
