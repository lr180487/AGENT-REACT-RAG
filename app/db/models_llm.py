# models_llm.py — Modelo SQLAlchemy para PostgreSQL
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
from app.db.database import Base

class LLMConfig(Base):
    __tablename__ = "llm_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = Column(String(32), nullable=False)  # openai | anthropic | gemini | groq | ollama | custom
    name = Column(String(128), nullable=False)
    api_key_encrypted = Column(Text, nullable=False)  # AES-256-GCM, nunca en texto plano
    model = Column(String(128), nullable=False)
    base_url = Column(String(512), nullable=True)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=2048)
    timeout = Column(Integer, default=30000)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict_masked(self):
        # Desencriptar solo para uso interno, exponer solo masked
        return {
            "id": self.id,
            "provider": self.provider,
            "name": self.name,
            "model": self.model,
            "base_url": self.base_url,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout": self.timeout,
            "is_active": self.is_active,
            "masked_key": "••••" + self.api_key_encrypted[-4:] if self.api_key_encrypted else "••••",
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
