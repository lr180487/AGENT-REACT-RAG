'use strict';

/**
 * processor.js — Frontend para PROCESSOR 7 ramas + tri
 * ├── Web Search → Internet → Results
 * ├── RAG → pgvector
 * ├── Database
 * ├── Documents
 * ├── External APIs
 * ├── Notifications
 * └── Workflows
 * Tri: Web Search / RAG / External API → Resultados
 */

const PROCESSOR_API = '/api/v1/analyzer';

async function callProcessor(query, plan, chatId = 'demo') {
  const r = await fetch(`${PROCESSOR_API}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, plan, chat_id: chatId })
  });
  if (!r.ok) throw new Error(`Processor ${r.status}: ${await r.text()}`);
  return r.json();
}

async function callTriProcessor(query, plan, chatId = 'demo') {
  // Tri es parte de processor, se usa el mismo endpoint
  return callProcessor(query, plan, chatId);
}

function renderProcessor(processorData, containerId = 'processorPanel') {
  const el = document.getElementById(containerId);
  if (!el || !processorData) return;
  const proc = processorData.processor || processorData;
  const ramas = [
    ['web_search', '🌐 Web Search'],
    ['rag', '📚 RAG'],
    ['database', '🗄️ Database'],
    ['documents', '📄 Documents'],
    ['external_apis', '🔌 External APIs'],
    ['notifications', '🔔 Notifications'],
    ['workflows', '🔀 Workflows'],
  ];
  let html = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
  for (const [key, label] of ramas) {
    const val = proc[key];
    let status = '—';
    let color = 'var(--muted)';
    let bg = '#f8fafc';
    if (val === 'ejecutado') { status = '✓ Ejecutado'; color = '#10b981'; bg = 'rgba(16,185,129,.08)'; }
    else if (val === 'skip') { status = '⊘ Skip'; color = 'var(--muted)'; }
    else if (typeof val === 'object' && val !== null) { status = '✓ Datos'; color = '#10b981'; bg = 'rgba(16,185,129,.08)'; }
    html += `<div style="padding:10px;background:${bg};border:1px solid var(--border);border-radius:10px;text-align:center">
      <div style="font-size:11px;font-weight:700;color:var(--text)">${label}</div>
      <div style="font-size:11px;color:${color};margin-top:4px">${status}</div>
    </div>`;
  }
  html += '</div>';

  // Tri resultados
  const tri = processorData.tri_result || processorData.resultados || {};
  if (tri.fuentes || tri.total_items !== undefined) {
    html += `<div style="margin-top:10px;padding:10px;background:#fff;border:1px solid var(--border);border-radius:10px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">Tri → Resultados</div>
      <div style="margin-top:6px;font-size:12px;color:var(--text)">Fuentes: <b>${(tri.fuentes || []).join(', ') || '—'}</b> · Total: <b>${tri.total_items ?? '—'}</b></div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${(tri.fuentes || []).map(f => `<span style="padding:3px 8px;background:#f1f5f9;border:1px solid var(--border);border-radius:999px;font-size:11px">${f}</span>`).join('')}</div>
    </div>`;
  }
  el.innerHTML = html;
}

if (typeof window !== 'undefined') {
  window.Processor = { callProcessor, callTriProcessor, renderProcessor, PROCESSOR_API };
}
