# Backend y sincronización con el frontend

Estado: **funcionando y verificado** (2026-10-21).

Antes el backend existía pero estaba *desconectado* del frontend en los dos puntos
que más se notan al usarlo:

| Problema | Antes | Ahora |
|---|---|---|
| Documentos | `dict` en memoria → al reiniciar, la lista quedaba vacía | Tabla `documents` en SQLite/PostgreSQL, persiste |
| Índice RAG | Semilla propia en memoria + reinicio = documentos duplicados o perdidos | La base es la fuente de verdad; el RAG se reindexa al arrancar |
| Conversaciones | Dos `dict` en memoria → historial perdido al reiniciar | Tablas `chats` / `messages`, historial real |
| Lista del frontend | Solo mostraba archivos subidos en esa pestaña | Al abrir se cargan los documentos del servidor |
| Responder con tus documentos | El planificador mandaba casi todo a búsqueda web | Sondea la base primero y usa RAG si hay coincidencia |

## Piezas nuevas

| Archivo | Qué hace |
|---|---|
| `app/db/models_doc.py` | Modelo `Document` (nombre, tamaño, parser, chunks, texto, semilla) |
| `app/services/documents_service.py` | Alta/baja/listado de documentos, semilla única, reindexado del RAG y estado de sincronía |
| `app/api/routes_documents.py` | Reescrito sobre la base + `GET /api/v1/documents/{id}/download` |
| `app/api/routes_chats.py` | Reescrito sobre las tablas `chats`/`messages` con el mismo contrato JSON |
| `app/api/routes_sync.py` | `GET /api/v1/sync/status` |

Cambios de apoyo:
- `app/db/database.py`: registra el modelo `Document` en `create_all`.
- `app/main.py`: en el arranque siembra documentos y reindexa el RAG; incluye el router de sincronía.
- `app/services/rag_service.py`: sin auto-semilla al importar (evita duplicados), pool global de documentos.
- `app/services/reasoning_service.py`: sondeo de la base antes de decidir herramientas.
- `app/services/memory_service.py`: `created_at` con microsegundos (orden estable) y título automático de la conversación.

## Frontend

`frontend/script.js` gana un bloque de sincronía:
- `syncLoadDocuments()` pinta los documentos del servidor en **Documentos** con Vista previa, Descargar y Eliminar.
- `syncLoadKnowledge()` pone métricas reales (documentos y fragmentos) en la tarjeta **Conocimiento**.
- `ensureChat()` / `restoreChatHistory()` guardan y recuperan la conversación (`currentChatId` en `localStorage`).
- El envío usa el `chat_id` real; el guardado lo hace el backend (sin duplicados).
- «Limpiar» empieza una conversación nueva.

## Verificación

```
GET /api/v1/sync/status
{ "ok": true, "documents": 5, "documents_seed": 4, "documents_uploaded": 1,
  "documents_chunks": 7, "rag_documents": 5, "rag_chunks": 7,
  "in_sync": true, "chats": 19, "messages": 127 }
```

- Subida de `acta_sync.txt` → 6 documentos → tras recargar seguía en la lista → eliminado desde la interfaz → 5 documentos, RAG también en 5.
- Pregunta «¿Qué cubre la póliza de prueba?» → el planificador elige `rag` y responde con el texto del archivo subido.
- Recargar el chat recupera el historial desde la base.
- 6 páginas en 1440 y 390 px: 0 errores JS, sin desbordes.

## Cómo arrancar

```bash
cd agente_react_rag
bash resume.sh          # instala lo que falte y levanta :8000
bash resume.sh --check  # solo diagnóstico
```
