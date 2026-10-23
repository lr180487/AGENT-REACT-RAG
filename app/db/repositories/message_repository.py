# message_repository.py
from sqlalchemy.orm import Session
from typing import List
from app.db.models import Message

class MessageRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, chat_id: str, limit=50, offset=0) -> tuple[int, List[Message]]:
        query = self.db.query(Message).filter(Message.chat_id == chat_id)
        total = query.count()
        items = query.order_by(Message.created_at.asc()).offset(offset).limit(limit).all()
        return total, items

    def create(self, chat_id: str, role: str, content: str, tokens=None, meta=None) -> Message:
        msg = Message(chat_id=chat_id, role=role, content=content, tokens=tokens, meta=meta)
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def get(self, message_id: str):
        return self.db.query(Message).filter(Message.id == message_id).first()

    def update(self, message_id: str, content: str):
        msg = self.get(message_id)
        msg.content = content
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def delete(self, message_id: str):
        msg = self.get(message_id)
        self.db.delete(msg)
        self.db.commit()
