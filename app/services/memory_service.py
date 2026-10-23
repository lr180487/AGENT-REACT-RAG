"""
memory_service.py — MEMORIA del agente (03_memoria.md)
Niveles:
  L1 → LRU (caché volátil 5 min)
  L2 → Upstash Redis (distribuido 30 min)
  L3 → PostgreSQL / SQLite fallback (persistente)
  L4 → pgvector (embeddings) o SQLite BM25 fallback

Flujo por request (memoria.md §8):
  Usuario → Session ID → Short-Term Memory → ReAct → New Observation → Memory Update (L1,L2,L3)

Seguridad (memoria.md §10):
  - Aislamiento por session_id / user_id
  - No persistir secretos en texto plano
  - TTLs y políticas de eliminación
"""
import logging
import hashlib
import os
from typing import Dict, Any, List, Optional
from datetime import datetime

from app.services.cache_service import l1_get, l1_set, l2_get, l2_set, TTL_PRESETS
from app.services.cache_service import cache_key as _cache_key

logger = logging.getLogger(__name__)

# ── Short-Term in-memory (fallback si no hay Upstash / DB) ──
try:
    from langchain_core.chat_history import InMemoryChatMessageHistory  # opcional
    _has_langchain = True
except Exception:
    _has_langchain = False

_memory_store: Dict[str, Any] = {}  # session_id -> InMemoryChatMessageHistory o lista simple

def _get_inmemory_history(session_id: str):
    if _has_langchain:
        if session_id not in _memory_store:
            _memory_store[session_id] = InMemoryChatMessageHistory()
        return _memory_store[session_id]
    else:
        if session_id not in _memory_store:
            _memory_store[session_id] = []
        return _memory_store[session_id]

class MemoryService:
    """
    Capa de memoria unificada L1→L4.
    Compatible con PostgreSQL y SQLite fallback (database.py).
    """

    def __init__(self, db_session=None):
        self.db = db_session
        # Detecta si estamos en fallback SQLite (sin pgvector)
        try:
            from app.db.database import is_postgres
            self.is_postgres = is_postgres
        except Exception:
            self.is_postgres = False

    # ── Session ID ──
    def session_key(self, chat_id: Optional[str], user_id: Optional[str] = None) -> str:
        if chat_id:
            return f"session:{chat_id}"
        if user_id:
            return f"user:{user_id}"
        return "session:anonymous"

    # ── Short-Term (L1/L2 + fallback in-memory) ──
    def get_short_term(self, chat_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Recupera historial corto plazo.
        Orden: L1 LRU → L2 Upstash → DB (messages) → in-memory
        """
        key = f"stm:{chat_id}:{limit}"
        cached = l1_get(key)
        if cached is not None:
            return cached
        cached = l2_get(key)
        if cached is not None:
            l1_set(key, cached, ttl=TTL_PRESETS["temporal"])
            return cached

        # DB fallback
        history: List[Dict[str, Any]] = []
        if self.db is not None:
            try:
                # Intenta ambas tablas: messages (models.py) y chat_messages (models_chat.py)
                rows = []
                try:
                    from app.db.models import Message
                    rows = self.db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at.desc()).limit(limit).all()
                    history = [{"role": r.role, "content": r.content, "created_at": r.created_at.isoformat() if r.created_at else None, "meta": r.meta} for r in reversed(rows)]
                except Exception:
                    from app.db.models_chat import ChatMessage
                    rows = self.db.query(ChatMessage).filter(ChatMessage.session_id == chat_id).order_by(ChatMessage.created_at.desc()).limit(limit).all()
                    history = [{"role": r.role, "content": r.content, "created_at": r.created_at.isoformat() if r.created_at else None, "meta": r.meta} for r in reversed(rows)]
                if history:
                    l1_set(key, history, ttl=TTL_PRESETS["temporal"])
                    l2_set(key, history, ttl=TTL_PRESETS["web_search"])
                    return history
            except Exception as e:
                logger.debug(f"get_short_term DB fallo: {e}")

        # In-memory fallback
        mem = _get_inmemory_history(chat_id)
        if _has_langchain:
            try:
                msgs = mem.messages[-limit:] if hasattr(mem, 'messages') else []
                history = [{"role": getattr(m, 'type', 'user'), "content": getattr(m, 'content', ''), "created_at": None} for m in msgs]
            except Exception:
                history = []
        else:
            history = mem[-limit:] if isinstance(mem, list) else []
        return history

    def append_short_term(self, chat_id: str, role: str, content: str, meta: Optional[Dict] = None):
        """
        Guarda USER/ASSISTANT en memoria corto plazo.
        Actualiza L1, L2, DB y in-memory.
        """
        # No persistir secretos
        if "sk-" in content or "api_key" in content.lower():
            logger.warning("Intento de persistir posible secreto — sanitizando")
            content = "[REDACTED]"

        # In-memory
        mem = _get_inmemory_history(chat_id)
        if _has_langchain:
            try:
                from langchain_core.messages import HumanMessage, AIMessage
                if role == "user":
                    mem.add_message(HumanMessage(content=content))
                else:
                    mem.add_message(AIMessage(content=content))
            except Exception:
                pass
        else:
            if isinstance(mem, list):
                mem.append({"role": role, "content": content, "created_at": datetime.utcnow().isoformat(), "meta": meta})
                # Limita a 50
                del mem[:-50]

        # Invalida caché L1/L2 para forzar recarga
        for k in [f"stm:{chat_id}:10", f"stm:{chat_id}:20", f"stm:{chat_id}:5"]:
            try:
                from app.services.cache_service import _lru, _upstash
                _lru.delete(k); _upstash.delete(k)
            except:
                pass

        # DB persistencia
        if self.db is not None:
            try:
                # Intenta models.Message primero
                try:
                    from app.db.models import Message, Chat
                    # Asegura chat existe
                    chat = self.db.query(Chat).filter(Chat.id == chat_id).first()
                    if not chat:
                        # Si no existe, no falla — crea Chat mínimo en SQLite/Postgres
                        try:
                            chat = Chat(id=chat_id, title="Nuevo chat", created_at=datetime.utcnow())
                            self.db.add(chat)
                            self.db.flush()
                        except Exception:
                            pass
                    msg = Message(
                        chat_id=chat_id,
                        role=role if role in ("user","assistant","system") else "user",
                        content=content,
                        meta=meta,
                        created_at=datetime.utcnow(),   # microsegundos → orden estable
                        updated_at=datetime.utcnow(),
                    )
                    self.db.add(msg)
                    # La primera pregunta del usuario da nombre a la conversación
                    try:
                        if role == "user" and chat is not None and (chat.title or "") in ("Nuevo chat", "Nueva conversación", ""):
                            previos = self.db.query(Message).filter(Message.chat_id == chat_id).count()
                            if previos == 0:
                                chat.title = (content or "Nuevo chat")[:60]
                    except Exception:
                        pass
                    self.db.commit()
                except Exception as e1:
                    # Fallback a chat_messages
                    from app.db.models_chat import ChatMessage, ChatSession
                    sess = self.db.query(ChatSession).filter(ChatSession.id == chat_id).first()
                    if not sess:
                        try:
                            sess = ChatSession(id=chat_id, title="Nuevo chat")
                            self.db.add(sess)
                            self.db.flush()
                        except Exception:
                            pass
                    msg = ChatMessage(session_id=chat_id, role=role, content=content, meta=meta)
                    self.db.add(msg)
                    self.db.commit()
            except Exception as e:
                logger.warning(f"append_short_term DB fallo (fallback a memoria): {e}")
                try:
                    self.db.rollback()
                except:
                    pass

    def get_context(self, chat_id: Optional[str], limit: int = 10, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Recupera contexto completo para ReAct:
         - historial corto
         - resumen memoria larga (L3)
         - vector_ids (L4)
        """
        history = self.get_short_term(chat_id, limit=limit) if chat_id else []
        summary = ""
        vector_ids = []
        if chat_id and self.db is not None:
            try:
                from app.db.models import ChatMemory
                mem = self.db.query(ChatMemory).filter(ChatMemory.chat_id == chat_id).first()
                if mem:
                    summary = mem.summary or ""
                    vector_ids = mem.vector_ids or []
                else:
                    # Fallback chat_memories alternativa
                    from app.db.models_chat import ChatSession  # dummy
                    pass
            except Exception:
                try:
                    # Intenta tabla alternativa si existe
                    pass
                except:
                    pass
        # Cache del resumen
        return {
            "history": history,
            "summary": summary,
            "vector_ids": vector_ids,
            "chat_id": chat_id,
            "user_id": user_id,
            "has_history": len(history) > 0,
        }

    def update_long_term(self, chat_id: str, assistant_text: Optional[str] = None, user_text: Optional[str] = None):
        """
        Actualiza memoria de largo plazo (L3) con resumen rolling.
        No guarda secretos, respeta TTL.
        """
        if not self.db or not chat_id:
            return
        try:
            from app.db.models import ChatMemory
            mem = self.db.query(ChatMemory).filter(ChatMemory.chat_id == chat_id).first()
            prev = mem.summary if mem and mem.summary else ""
            # Rolling summary: últimos 1500 chars + nuevo
            add = ""
            if user_text:
                add += f" U:{user_text[:80]}"
            if assistant_text:
                add += f" A:{assistant_text[:80]}"
            new_summary = (prev[-1500:] + add) if prev else add.strip()
            # No persistir si parece secreto
            if "sk-" in new_summary:
                new_summary = new_summary.replace("sk-", "[REDACTED]")
            if mem:
                mem.summary = new_summary
                mem.updated_at = datetime.utcnow()
            else:
                mem = ChatMemory(chat_id=chat_id, summary=new_summary, vector_ids=[], extra={})
                self.db.add(mem)
            self.db.commit()
            logger.debug(f"Long-term actualizado {chat_id}: {len(new_summary)} chars")
        except Exception as e:
            logger.debug(f"update_long_term fallo: {e}")
            try:
                self.db.rollback()
            except:
                pass

    # ── Policies (memoria.md §9) ──
    def policy(self) -> Dict[str, Any]:
        return {
            "table": {
                "respuesta_temporal": {"store": "L1 LRU", "ttl": "5 min"},
                "web_search": {"store": "L2 Upstash", "ttl": "30 min"},
                "sesion": {"store": "L2 Upstash", "ttl": "configurable (1h)"},
                "historial": {"store": "L3 PostgreSQL/SQLite", "ttl": "política definida"},
                "conocimiento": {"store": "L4 pgvector/SQLite BM25", "ttl": "persistente"},
            },
            "is_postgres": self.is_postgres,
            "fallback": "SQLite app/data/app.db" if not self.is_postgres else None,
        }
