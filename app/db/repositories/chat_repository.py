# chat_repository.py — Acceso a PostgreSQL para chats
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.models import Chat

class ChatRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, user_id: Optional[str], title: str, provider=None, model=None) -> Chat:
        chat = Chat(user_id=user_id, title=title, provider=provider, model=model)
        self.db.add(chat)
        self.db.commit()
        self.db.refresh(chat)
        return chat

    def list_by_user(self, user_id: Optional[str], include_archived=False, q: Optional[str]=None, limit=50, offset=0):
        query = self.db.query(Chat)
        if user_id:
            query = query.filter(Chat.user_id == user_id)
        if not include_archived:
            query = query.filter(Chat.is_archived == False)
        if q:
            query = query.filter(Chat.title.ilike(f"%{q}%"))
        total = query.count()
        items = query.order_by(Chat.updated_at.desc()).offset(offset).limit(limit).all()
        return total, items

    def get(self, chat_id: str) -> Optional[Chat]:
        return self.db.query(Chat).filter(Chat.id == chat_id).first()

    def validate_owner(self, chat_id: str, user_id: Optional[str]) -> Chat:
        chat = self.get(chat_id)
        if not chat:
            from fastapi import HTTPException
            raise HTTPException(404, "Chat no encontrado")
        if user_id and chat.user_id and chat.user_id != user_id:
            from fastapi import HTTPException
            raise HTTPException(403, "No autorizado para este chat")
        return chat

    def update_title(self, chat_id: str, title: str) -> Chat:
        chat = self.get(chat_id)
        chat.title = title
        self.db.commit()
        self.db.refresh(chat)
        return chat

    def archive(self, chat_id: str):
        chat = self.get(chat_id)
        chat.is_archived = True
        self.db.commit()
        return chat

    def restore(self, chat_id: str):
        chat = self.get(chat_id)
        chat.is_archived = False
        self.db.commit()
        return chat

    def delete(self, chat_id: str):
        chat = self.get(chat_id)
        self.db.delete(chat)
        self.db.commit()
