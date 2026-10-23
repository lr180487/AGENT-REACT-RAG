# models.py — Esquema completo PostgreSQL
# USER → CHAT → MESSAGE + MEMORY + RAG
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Boolean, Integer, JSON, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.db.database import Base

# --- USER (opcional, para validar usuario) ---
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, index=True)
    name = Column(String(128))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")

# --- CHAT ---
class Chat(Base):
    __tablename__ = "chats"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))  # chat_id
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String(200), default="Nuevo chat")
    is_archived = Column(Boolean, default=False, index=True)
    provider = Column(String(32), nullable=True)  # openai, anthropic...
    model = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    meta = Column(JSON, nullable=True)

    user = relationship("User", back_populates="chats")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan", order_by="Message.created_at")
    memory = relationship("ChatMemory", back_populates="chat", uselist=False, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "chat_id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "is_archived": self.is_archived,
            "provider": self.provider,
            "model": self.model,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "message_count": len(self.messages) if self.messages else 0,
        }

# --- MESSAGE ---
class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))  # message_id
    chat_id = Column(String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    tokens = Column(Integer, nullable=True)
    meta = Column(JSON, nullable=True)  # {rag_chunks, latency, model}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    chat = relationship("Chat", back_populates="messages")

    def to_dict(self):
        return {
            "message_id": self.id,
            "chat_id": self.chat_id,
            "role": self.role,
            "content": self.content,
            "tokens": self.tokens,
            "meta": self.meta,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

# --- MEMORY (por chat) ---
class ChatMemory(Base):
    __tablename__ = "chat_memories"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    chat_id = Column(String, ForeignKey("chats.id", ondelete="CASCADE"), unique=True, index=True)
    summary = Column(Text, nullable=True)  # resumen del historial
    vector_ids = Column(JSON, nullable=True)  # ids en pgvector
    extra = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    chat = relationship("Chat", back_populates="memory")

    def to_dict(self):
        return {"chat_id": self.chat_id, "summary": self.summary, "updated_at": self.updated_at.isoformat() if self.updated_at else None}

# Índices para RAG
Index("ix_messages_chat_created", Message.chat_id, Message.created_at)
Index("ix_chats_user_updated", Chat.user_id, Chat.updated_at)
