# models_doc.py — Documentos persistidos en SQLite/PostgreSQL
# Fuente de verdad de la sección "Documentos" y del índice RAG.
from sqlalchemy import Column, String, Text, DateTime, Boolean, Integer, Index
from sqlalchemy.sql import func
import uuid

from app.db.database import Base


def _new_doc_id() -> str:
    return "doc_" + uuid.uuid4().hex[:12]


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=_new_doc_id)
    name = Column(String(300), nullable=False)
    filename = Column(String(300), nullable=True)
    size = Column(Integer, default=0)            # bytes
    content_type = Column(String(120), nullable=True)
    chat_id = Column(String(64), default="demo", index=True)
    parser = Column(String(64), default="Text Parser")
    status = Column(String(32), default="indexed")   # indexed | error
    chunks = Column(Integer, default=0)
    is_seed = Column(Boolean, default=False, index=True)
    text = Column(Text, nullable=True)            # texto extraído (permite reindexar)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (Index("ix_documents_chat_created", "chat_id", "created_at"),)
