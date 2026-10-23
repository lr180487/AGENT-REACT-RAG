'use strict';

/**
 * analyzer.js — Frontend para ANALYZER 10 pasos
 * Sincronizado con backend app/services/analyzer_service.py
 * ├── interpretar intención
 * ├── clasificar solicitud
 * ├── extraer entidades
 * ├── analizar contexto
 * ├── consultar memoria necesaria
 * ├── detectar necesidad de Web Search
 * ├── detectar necesidad de RAG
 * ├── seleccionar herramientas
 * ├── evaluar riesgo
 * └── generar plan
 */

const ANALYZER_API = '/api/v1/analyzer';

async function callAnalyzer(text, chatId = 'demo', history = []) {
  const r = await fetch(`${ANALYZER_API}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, chat_id: chatId, history })
  });
  if (!r.ok) throw new Error(`Analyzer ${r.status}: ${await r.text()}`);
  return r.json();
}

function renderAnalyzer(analyzerData, containerId = 'analyzerPanel') {
  const el = document.getElementById(containerId);
  if (!el || !analyzerData) return;
  const steps = [
    ['interpretar_intencion', '🎯 Interpretar intención', 'intent_raw'],
    ['clasificar_solicitud', '🏷️ Clasificar', 'tipo'],
    ['extraer_entidades', '🔍 Entidades', 'keywords'],
    ['analizar_contexto', '📜 Contexto', 'contexto'],
    ['consultar_memoria_necesaria', '🧠 Memoria', 'necesita_memoria'],
    ['detectar_necesidad_web_search', '🌐 Web Search', 'necesita_web_search'],
    ['detectar_necesidad_rag', '📚 RAG', 'necesita_rag'],
    ['seleccionar_herramientas', '🛠️ Herramientas', 'seleccion_final'],
    ['evaluar_riesgo', '⚠️ Riesgo', 'nivel'],
    ['generar_plan', '📋 Plan', 'orden'],
  ];
  const a = analyzerData.analyzer || analyzerData;
  let html = '<div style="display:grid;gap:8px">';
  for (const [key, label, field] of steps) {
    const data = a[key];
    if (!data) continue;
    let val = data[field];
    if (Array.isArray(val)) val = val.join(', ') || '—';
    else if (typeof val === 'boolean') val = val ? 'Sí' : 'No';
    else if (typeof val === 'object') val = JSON.stringify(val).slice(0, 60);
    if (!val) val = '—';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:10px;font-size:11px">
      <span style="font-weight:700;color:var(--text)">${label}</span>
      <span style="color:var(--muted);max-width:60%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${val}</span>
    </div>`;
  }
  html += '</div>';
  // Plan detallado
  const plan = analyzerData.plan || a.generar_plan?.plan || [];
  if (plan.length) {
    html += `<div style="margin-top:10px;padding:10px;background:#fff;border:1px solid var(--border);border-radius:10px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">Plan → PROCESSOR</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${plan.map(p => `<span style="padding:4px 8px;background:var(--primary);color:#fff;border-radius:999px;font-size:11px">${p.tool}</span>`).join('')}</div>
    </div>`;
  }
  el.innerHTML = html;
}

// Exponer global
if (typeof window !== 'undefined') {
  window.Analyzer = { callAnalyzer, renderAnalyzer, ANALYZER_API };
}
