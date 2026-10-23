"""
routes_chats.py — API de Chats con persistencia real (SQLite/PostgreSQL)

Antes los chats vivían en dos dicts en memoria: al reiniciar se perdía todo el
historial y "Mi espacio → Conversaciones" aparecía vacío. Ahora usa las tablas
`chats` y `messages` (app/db/models.py) manteniendo exactamente el mismo
contrato que consume el frontend.

  GET    /api/v1/chats?limit=100
  POST   /api/v1/chats
  GET    /api/v1/chats/{id}?limit=&offset=     (historial)
  GET    /api/v1/chats/{id}/messages?limit=&offset=
  POST   /api/v1/chats/{id}/messages
  PUT    /api/v1/chats/{id}/messages/{mid}
  DELETE /api/v1/chats/{id}/messages/{mid}
  PUT/PATCH /api/v1/chats/{id}
  DELETE /api/v1/chats/{id}
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid

from app.db.database import SessionLocal
from app.db.models import Chat, Message

router = APIRouter(prefix="/api/v1/chats", tags=["Chats"])


# ───────────────────────── modelos de entrada ─────────────────────────
class CreateChatReq(BaseModel):
    title: Optional[str] = "Nuevo chat"
    provider: Optional[str] = None
    model: Optional[str] = None


class UpdateChatReq(BaseModel):
    title: Optional[str] = None
    is_archived: Optional[bool] = None


class CreateMessageReq(BaseModel):
    role: str
    content: str
    meta: Optional[Dict[str, Any]] = None


class UpdateMessageReq(BaseModel):
    content: str


# ───────────────────────── helpers ─────────────────────────
def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def _msg_to_dict(m: Message) -> Dict[str, Any]:
    return {
        "id": m.id,
        "message_id": m.id,
        "session_id": m.chat_id,
        "chat_id": m.chat_id,
        "role": m.role,
        "content": m.content,
        "meta": m.meta,
        "created_at": _iso(m.created_at),
        "updated_at": _iso(m.updated_at),
    }


def _chat_to_dict(c: Chat, db, message_count: Optional[int] = None, with_messages: bool = False) -> Dict[str, Any]:
    if message_count is None:
        message_count = db.query(Message).filter(Message.chat_id == c.id).count()
    out = {
        "id": c.id,
        "chat_id": c.id,
        "title": c.title,
        "provider": c.provider,
        "model": c.model,
        "is_archived": bool(c.is_archived),
        "created_at": _iso(c.created_at),
        "created": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
        "message_count": message_count,
    }
    if with_messages:
        msgs = (
            db.query(Message)
            .filter(Message.chat_id == c.id)
            .order_by(Message.created_at.asc(), Message.id.asc())
            .all()
        )
        out["messages"] = [_msg_to_dict(m) for m in msgs]
    return out


def _get_chat_or_404(db, chat_id: str) -> Chat:
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat no encontrado")
    return chat


# ───────────────────────── endpoints ─────────────────────────
@router.get("", summary="Listar chats")
async def list_chats(limit: int = Query(100, ge=1, le=500)):
    db = SessionLocal()
    try:
        chats = db.query(Chat).order_by(Chat.updated_at.desc()).limit(limit).all()
        items = [_chat_to_dict(c, db) for c in chats]
        return {"items": items, "total": len(items)}
    finally:
        db.close()


@router.post("", status_code=201, summary="Crear chat")
async def create_chat(payload: CreateChatReq):
    db = SessionLocal()
    try:
        chat = Chat(
            id="chat_" + uuid.uuid4().hex[:12],
            title=(payload.title or "Nuevo chat")[:200],
            provider=payload.provider,
            model=payload.model,
        )
        db.add(chat)
        db.commit()
        db.refresh(chat)
        return _chat_to_dict(chat, db, message_count=0)
    finally:
        db.close()


@router.get("/{chat_id}", summary="Obtener chat + mensajes paginados (historial)")
async def get_chat(chat_id: str, limit: int = Query(30, ge=1, le=1000), offset: int = Query(0, ge=0)):
    db = SessionLocal()
    try:
        chat = _get_chat_or_404(db, chat_id)
        all_msgs = (
            db.query(Message)
            .filter(Message.chat_id == chat_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
            .all()
        )
        total = len(all_msgs)
        start = max(0, total - offset - limit)
        end = total - offset
        page = [_msg_to_dict(m) for m in all_msgs[start:end]]
        base = _chat_to_dict(chat, db, message_count=total)
        return {
            "session": base,
            "chat": base,
            "messages": page,
            "total": total,
            "has_more": start > 0,
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()


@router.get("/{chat_id}/messages", summary="Listar mensajes de un chat")
async def list_messages(chat_id: str, limit: int = Query(30, ge=1, le=1000), offset: int = Query(0, ge=0)):
    db = SessionLocal()
    try:
        chat = _get_chat_or_404(db, chat_id)
        all_msgs = (
            db.query(Message)
            .filter(Message.chat_id == chat_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
            .all()
        )
        total = len(all_msgs)
        start = max(0, total - offset - limit)
        end = total - offset
        page = [_msg_to_dict(m) for m in all_msgs[start:end]]
        return {
            "session": _chat_to_dict(chat, db, message_count=total),
            "messages": page,
            "items": page,
            "total": total,
            "has_more": start > 0,
        }
    finally:
        db.close()


@router.post("/{chat_id}/messages", status_code=201, summary="Crear mensaje")
async def create_message(chat_id: str, payload: CreateMessageReq):
    db = SessionLocal()
    try:
        chat = _get_chat_or_404(db, chat_id)
        if payload.role not in ("user", "assistant", "system", "bot"):
            raise HTTPException(400, "role inválido")
        role = "assistant" if payload.role == "bot" else payload.role
        now = datetime.utcnow()
        msg = Message(
            id="msg_" + uuid.uuid4().hex[:10],
            chat_id=chat_id,
            role=role,
            content=payload.content or "",
            meta=payload.meta,
            created_at=now,
            updated_at=now,
        )
        db.add(msg)
        # El primer mensaje del usuario nombra la conversación
        count = db.query(Message).filter(Message.chat_id == chat_id).count()
        if count == 0 and role == "user":
            chat.title = (payload.content or "Nuevo chat")[:60]
        chat.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(msg)
        return _msg_to_dict(msg)
    finally:
        db.close()


@router.put("/{chat_id}/messages/{message_id}", summary="Editar mensaje")
async def update_message(chat_id: str, message_id: str, payload: UpdateMessageReq):
    db = SessionLocal()
    try:
        _get_chat_or_404(db, chat_id)
        msg = db.query(Message).filter(Message.chat_id == chat_id, Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=404, detail="Mensaje no encontrado")
        msg.content = payload.content
        db.commit()
        db.refresh(msg)
        return _msg_to_dict(msg)
    finally:
        db.close()


@router.delete("/{chat_id}/messages/{message_id}", summary="Eliminar mensaje")
async def delete_message(chat_id: str, message_id: str):
    db = SessionLocal()
    try:
        _get_chat_or_404(db, chat_id)
        msg = db.query(Message).filter(Message.chat_id == chat_id, Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=404, detail="Mensaje no encontrado")
        db.delete(msg)
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


@router.put("/{chat_id}", summary="Actualizar chat (PUT)")
async def update_chat_put(chat_id: str, payload: UpdateChatReq):
    return await _update_chat(chat_id, payload)


@router.patch("/{chat_id}", summary="Actualizar chat (PATCH)")
async def update_chat_patch(chat_id: str, payload: UpdateChatReq):
    return await _update_chat(chat_id, payload)


async def _update_chat(chat_id: str, payload: UpdateChatReq):
    db = SessionLocal()
    try:
        chat = _get_chat_or_404(db, chat_id)
        if payload.title is not None:
            chat.title = payload.title[:200]
        if payload.is_archived is not None:
            chat.is_archived = payload.is_archived
        db.commit()
        db.refresh(chat)
        return _chat_to_dict(chat, db)
    finally:
        db.close()


@router.delete("/{chat_id}", summary="Eliminar chat")
async def delete_chat(chat_id: str):
    db = SessionLocal()
    try:
        chat = _get_chat_or_404(db, chat_id)
        db.query(Message).filter(Message.chat_id == chat_id).delete()
        db.delete(chat)
        db.commit()
        return {"deleted": True, "id": chat_id}
    finally:
        db.close()
