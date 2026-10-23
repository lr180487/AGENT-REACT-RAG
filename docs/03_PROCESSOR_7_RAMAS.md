# 03 — PROCESSOR: 7 Ramas + Tri-Split

## Arquitectura

```
                ┌─ Web Search (Tavily → DuckDuckGo)
                ├─ RAG (pgvector)
PLAN ──► TRI ───┤  (paralelo)
                └─ External APIs
                │
                ├─ Database (PostgreSQL)
                ├─ Documents (MarkItDown → Markdown)
                ├─ Notifications (WebSocket)
                └─ Workflows (orquestador)
```

## Tri-Split (núcleo paralelo)

El `tri_processor(query, plan)` ejecuta **en paralelo** con `asyncio.gather`:

- Si `web_search` en plan → `await web_search(query)` (latencia medida, provider logueado)
- Si `rag` en plan → `await rag(query, chat_id)` (chunks + score 0.89/0.81 mock, en prod pgvector)
- Si `external_apis` en plan → `await external_apis(query)`
- Si ninguno → `await database(query)` fallback

**Merge:** une `results|chunks|rows`, cuenta `total_items`, lista `fuentes`.

## Las 7 Ramas en detalle

### 1. Web Search
- Cliente `app/services/web_search_client.py`: Tavily primario (`POST api.tavily.com/search`) + fallback DuckDuckGo (`DDGS().text` o `html.duckduckgo.com`).
- Normaliza a `{title, url, snippet, score}`.
- Mide `latency_ms`, expone `provider` para UI (`Tavily → DDG`).

### 2. RAG
- En prod: `pgvector` + `MarkItDown` chunks (42 por doc).
- Mock actual: 2 chunks con `source` → permite probar pipeline sin vectores.

### 3. Database
- `PostgreSQL` historial previo. Siempre disponible como fallback.

### 4. Documents
- Parser `MarkItDown` (PDF, DOCX, XLSX, PPTX, CSV, MD) → Markdown AST → chunking.
- Usado cuando el plan incluye `documents` explícito.

### 5. External APIs
- REST genérico para integraciones. Retorna `{apis, status:ok}`.

### 6. Notifications
- `WebSocket /ws/langchain` push a frontend. `channel: websocket`.

### 7. Workflows
- `executed: plan, status: scheduled` — dispara flujos de aprobación si riesgo alto.

## Estrategia de Ranking

```python
all_snippets = results + chunks + rows
total_items = len(all_snippets)   # para Response.sintesis
```

Futuro: ranking por `score * recency * source_authority`.

## Errores y Fallback

Cada rama está envuelta en `try/except`:
- Si `web_search_client` falla → mock `example.com` con `internet:False`.
- Nunca rompe el Processor: siempre entrega `tri_result` aunque sea mock.

## Prompt Guía (para LLM que orquesta Processor)

> “Eres el Processor. Recibes `query + plan`. Ejecuta exactamente las tools listadas en `plan.orden`, en paralelo si son tri (web_search, rag, external_apis). No inventes fuentes. Si una tool falla, entrega el resto y marca `error`.”

Ver `app/prompts/processor_system.md`.
