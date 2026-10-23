# memory_repository.py
from sqlalchemy.orm import Session
from app.db.models import ChatMemory

class MemoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_chat(self, chat_id: str):
        return self.db.query(ChatMemory).filter(ChatMemory.chat_id == chat_id).first()

    def upsert(self, chat_id: str, summary: str = None, vector_ids=None, extra=None):
        mem = self.get_by_chat(chat_id)
        if not mem:
            mem = ChatMemory(chat_id=chat_id, summary=summary, vector_ids=vector_ids, extra=extra)
            self.db.add(mem)
        else:
            if summary is not None: mem.summary = summary
            if vector_ids is not None: mem.vector_ids = vector_ids
            if extra is not None: mem.extra = extra
        self.db.commit()
        self.db.refresh(mem)
        return mem
