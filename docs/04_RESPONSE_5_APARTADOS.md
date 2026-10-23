# 04 — RESPONSE: 5 Apartados Obligatorios

El **ResponseService** convierte `tri_result + analyzer` en una respuesta estructurada, siempre con 5 apartados:

```
1 síntesis
2 explicación
3 fuentes
4 recomendaciones
5 acciones_propuestas
```

## 1. Síntesis (1 párrafo ejecutivo)

```
Síntesis: analizados {total_items} fragmentos sobre "{query[:60]}" desde [fuentes]. Hallazgo clave: ...
```

- Debe caber en 2 líneas en UI (clamp + tooltip con completo).
- Tono: ejecutivo, sin jerga.

## 2. Explicación (trazabilidad)

```
Explicación: intención '{intent_raw}'. Se ejecutó plan {plan} y se integraron resultados con ranking por relevancia.
```

- Explica **por qué** se eligieron esas tools (transparencia).
- Cita `evaluar_riesgo.nivel` si es medio/alto.

## 3. Fuentes (lista verificable)

- Web: `{titulo, url, tipo: web}`
- RAG: `{titulo: source, url: doc://id, tipo: rag}`
- Fallback: `{titulo: Interna, url: db://historial, tipo: database}`
- Máx 5, orden por `score`.
- En UI se renderizan como `🔗 Título (tipo) url` clicables.

## 4. Recomendaciones (checklist)

Base:
- “Revisar fuentes citadas antes de actuar.”
Reglas:
- Si `riesgo==alto` → “Confirmar con humano por riesgo alto.”
- Si `rag` en fuentes → “Validar contra documento original.”
- Siempre → “Iterar con pregunta más específica si falta detalle.”

## 5. Acciones Propuestas (accionables)

```json
[
  {"accion":"responder","detalle":"Entregar síntesis al usuario"},
  {"accion":"notificar","detalle":"Enviar alerta WebSocket"} // si web_search en plan
  {"accion":"workflow","detalle":"Disparar flujo de aprobación"} // si riesgo alto
]
```

En UI se muestran como `🚀 Acciones: responder → notificar`.

## Contrato de Salida

```json
{
  "response": { "sintesis": "...", "explicacion":"...", "fuentes":[...], "recomendaciones":[...], "acciones_propuestas":[...] },
  "resultados": {...},
  "next": "USER",
  "channel": "WebSocket / Frontend"
}
```

## Prompt Guía

> “Eres el Response. No inventes datos. Usa solo `tri_result`. Si faltan fuentes, dilo explícitamente (‘Sin fuentes externas’). Mantén cada apartado < 60 palabras. Termina siempre con `next: USER`.”

Ver `app/prompts/response_system.md`.

## Anti-patrones

- ❌ Resumir sin citar fuentes.
- ❌ Mezclar recomendaciones con acciones.
- ❌ Omitir `riesgo`.
- ✅ Mantener 5 apartados incluso con datos mock.
