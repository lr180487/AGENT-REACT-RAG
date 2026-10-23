"""
routes_documents.py — Sincronización Documentos Frontend ↔ Backend

Persistencia real en la tabla `documents` (SQLite/PostgreSQL) y sincronía con el
índice RAG mediante app.services.documents_service.

Frontend usa:
  GET    /api/v1/documents?chat_id=&limit=
  POST   /api/v1/documents/upload        (multipart)
  POST   /api/v1/documents               (JSON, tests)
  GET    /api/v1/documents/{doc_id}
  DELETE /api/v1/documents/{doc_id}
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from typing import Optional, Dict, Any

from app.services import documents_service

router = APIRouter(prefix="/api/v1/documents", tags=["Documents"])

# Extensiones de texto que se pueden leer tal cual
_TEXT_EXT = {"txt", "md", "markdown", "csv", "json", "log", "py", "js", "html", "xml", "yaml", "yml"}
_PARSERS = {
    "pdf": "PDF Parser", "doc": "DOCX Parser", "docx": "DOCX Parser",
    "xls": "Excel Parser", "xlsx": "Excel Parser", "csv": "CSV Parser",
    "ppt": "PowerPoint Parser", "pptx": "PowerPoint Parser",
    "md": "Markdown Parser", "markdown": "Markdown Parser",
    "txt": "Text Parser", "json": "JSON Parser",
    "png": "Image Parser", "jpg": "Image Parser", "jpeg": "Image Parser",
}


def _ext(filename: str) -> str:
    return (filename.rsplit(".", 1)[-1] if "." in (filename or "") else "").lower()


def _extract_text(filename: str, content: bytes) -> str:
    """Extrae texto útil para el RAG. Para binarios arma una ficha del documento."""
    ext = _ext(filename)
    if ext in _TEXT_EXT or ext in {"md", "markdown"}:
        try:
            return content.decode("utf-8", errors="ignore")[:20000]
        except Exception:  # noqa: BLE001
            pass
    # PDFs: intenta sacar texto legible de los streams (best-effort, sin dependencias)
    if ext == "pdf":
        try:
            raw = content.decode("latin-1", errors="ignore")
            import re
            pieces = re.findall(r"\((?:[^()\\]|\\.){4,}\)", raw)
            txt = " ".join(p[1:-1] for p in pieces)[:20000]
            if len(txt.strip()) > 40:
                return txt
        except Exception:  # noqa: BLE001
            pass
    return (
        f"Documento {filename}\n"
        f"Tipo: {ext.upper() or 'desconocido'} · Parser: {_PARSERS.get(ext, 'Text Parser')}\n"
        f"Tamaño: {len(content)} bytes\n"
        f"Contenido binario: se indexa por nombre y metadatos para búsqueda."
    )


@router.get("", summary="Listar documentos")
async def list_docs(chat_id: Optional[str] = Query(None), limit: int = Query(200, ge=1, le=500)):
    items = documents_service.list_documents(chat_id=chat_id, limit=limit)
    return {"items": items, "total": len(items)}


@router.post("", summary="Crear documento (JSON, para tests)")
async def create_doc(payload: Dict[str, Any]):
    name = payload.get("name") or payload.get("filename") or "documento.txt"
    text = payload.get("text") or payload.get("content") or f"Documento {name}"
    doc = documents_service.register_document(
        name=name,
        text=text,
        doc_id=payload.get("doc_id"),
        filename=payload.get("filename") or name,
        size=payload.get("size") or len(text.encode("utf-8")),
        content_type=payload.get("content_type") or "text/plain",
        chat_id=payload.get("chat_id") or "demo",
        parser=payload.get("parser") or _PARSERS.get(_ext(name), "Text Parser"),
    )
    return doc


@router.post("/upload", summary="Subir documento")
async def upload_doc(
    file: UploadFile = File(...),
    chat_id: Optional[str] = Form(None),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "El archivo está vacío")
    filename = file.filename or "archivo"
    text = _extract_text(filename, content)
    doc = documents_service.register_document(
        name=filename,
        text=text,
        filename=filename,
        size=len(content),
        content_type=file.content_type,
        chat_id=chat_id or "demo",
        parser=_PARSERS.get(_ext(filename), "Text Parser"),
    )
    return doc


@router.get("/{doc_id}/download", summary="Descargar el texto indexado del documento")
async def download_doc(doc_id: str):
    from fastapi import Response
    data = documents_service.get_document_text(doc_id)
    if not data:
        raise HTTPException(404, "Documento no encontrado")
    name, text = data
    filename = (name.rsplit(".", 1)[0] or "documento") + ".txt"
    return Response(
        content=text or "",
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{doc_id}", summary="Obtener documento")
async def get_doc(doc_id: str):
    doc = documents_service.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    return doc


@router.delete("/{doc_id}", summary="Eliminar documento")
async def delete_doc(doc_id: str):
    ok = documents_service.delete_document(doc_id)
    if not ok:
        raise HTTPException(404, "Documento no encontrado")
    return {"deleted": True, "doc_id": doc_id}
