# 02 — ANALYZER: 10 Pasos Secuenciales

El **Analyzer** es el cerebro reflexivo. Ejecuta 10 pasos deterministas antes de tocar cualquier herramienta.

```
1 interpretar_intencion
2 clasificar_solicitud
3 extraer_entidades
4 analizar_contexto
5 consultar_memoria_necesaria
6 detectar_necesidad_web_search
7 detectar_necesidad_rag
8 seleccionar_herramientas
9 evaluar_riesgo
10 generar_plan
```

## Paso 1 — interpretar_intencion

- **Input:** `text` crudo del usuario.
- **Heurística:** keywords → `analisis | busqueda | comparacion | generacion | consulta`
- **Prompt mejorado:**
  > “Lee el texto y decide: ¿el usuario quiere ENTENDER, BUSCAR, COMPARAR o CREAR? Si el texto contiene ‘busca/investiga/encuentra + sustantivo concreto’ → busqueda. Si contiene ‘analiza/resume’ → analisis.”
- **Salida:** `{intent_raw, confidence 0.92, text}`

## Paso 2 — clasificar_solicitud

- **Tipo:** `informativa` (busqueda, consulta) vs `transformativa` (generacion, comparacion)
- **Prioridad:** `alta` si contiene `urgente|ahora|hoy|inmediato`, else `media`.
- **Uso downstream:** prioridad alta acorta `top_k` y exige `web_search`.

## Paso 3 — extraer_entidades

Regex ligero:
- `fechas`: `DD/MM/YYYY`
- `emails`, `numeros`, `keywords` (palabras >4 chars)
- **Mejora:** normalizar `NFD` para acentos, guardar `keywords` para RAG query expansion.

## Paso 4 — analizar_contexto

- Si `chat_id` tiene historial → `con_historial` + ventana últimas 3.
- Sin historial → `sin_historial`.
- Esto evita alucinar referencias.

## Paso 5 — consultar_memoria_necesaria

- `necesita_memoria = len(ventana)>0 OR 'recuerda' in text`
- Si `false`, el Processor ignora `chat_memory` y ahorra tokens.

## Paso 6 — detectar_necesidad_web_search

- Keywords: `busca|internet|actual|precio|noticia|web|search|último|reciente` + intent==busqueda.
- **Proveedor:** `tavily/serpapi` si hay key, else `duckduckgo`.
- Si `false`, se ahorra latencia de red.

## Paso 7 — detectar_necesidad_rag

- Keywords: `documento|pdf|contrato|analiza|resume|extrae|rag|conocimiento`
- **Store:** `pgvector`
- Si `true`, el plan incluye `rag` y el Processor hará `await rag(query)`.

## Paso 8 — seleccionar_herramientas

Mapeo:
- `web_search` → si p6
- `rag` → si p7
- `memory` → si p5
- Siempre disponibles: `database, documents, external_apis, notifications, workflows`
- **Seleccion_final:** `tools + database` si tools vacío → garantiza 1 tool.

## Paso 9 — evaluar_riesgo

- `input_largo` si len>2000
- `llamada_externa` si `external_apis` en seleccion_final
- **Niveles:** `alto (>1 factor externo) | medio (1 factor) | bajo (0)`

## Paso 10 — generar_plan

Ordena tools en secuencia ejecutable:
- `web_search → rag → database` (si existen)
- Si ninguno, `database` como fallback.
- Añade `siguiente: PROCESSOR` y `timestamp`.

### Diagrama

```
Usuario → [1-10] → plan[] → PROCESSOR
```

> Archivos de prompt por paso están en `app/prompts/analyzer/*.md` para fine-tuning sin redeploy.
