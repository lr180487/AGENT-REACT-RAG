# chat_memory.py — Memoria por chat + global
from typing import Optional, List

class ChatMemoryManager:
    """
    Flujo por request:
      chat_id → validar usuario → obtener historial → recuperar memoria → RAG si corresponde → ReAct → guardar USER/ASSISTANT
    """
    def __init__(self, db):
        self.db = db
        from app.db.repositories.memory_repository import MemoryRepository
        from app.db.repositories.message_repository import MessageRepository
        self.mem_repo = MemoryRepository(db)
        self.msg_repo = MessageRepository(db)

    def get_context(self, chat_id: str, limit=10) -> dict:
        """Recupera últimos N mensajes + resumen de memoria para inyectar al prompt"""
        _, msgs = self.msg_repo.list(chat_id, limit=limit, offset=max(0, self.msg_repo.list(chat_id, limit=1)[0] - limit))
        mem = self.mem_repo.get_by_chat(chat_id)
        # ordenar por created_at asc ya viene así
        return {
            "history": [m.to_dict() for m in msgs],
            "summary": mem.summary if mem else "",
            "vector_ids": mem.vector_ids if mem and mem.vector_ids else []
        }

    def append_interaction(self, chat_id: str, user_text: str, assistant_text: str):
        """Guarda USER y ASSISTANT juntos (llamado después del ReAct)"""
        from app.db.repositories.message_repository import MessageRepository
        from app.db.repositories.chat_repository import ChatRepository
        # ya guardados por MessageService, solo actualiza memoria resumida
        mem = self.mem_repo.get_by_chat(chat_id)
        new_summary = (mem.summary or "")[-1500:] + f"\nU:{user_text[:80]} | A:{assistant_text[:80]}"
        self.mem_repo.upsert(chat_id, summary=new_summary)

# Memoria global (opcional)
class GlobalMemory:
    def __init__(self, db):
        self.db = db
    def get_user_memory(self, user_id: str):
        # podría agregar preferencias, embeddings globales, etc.
        return {"user_id": user_id, "notes": "memoria global por usuario"}
