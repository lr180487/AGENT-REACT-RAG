'use strict';

/**
 * response.js — Frontend para RESPONSE 5 apartados
 * ├── síntesis
 * ├── explicación
 * ├── fuentes
 * ├── recomendaciones
 * └── acciones propuestas
 */

function renderResponse(responseData, containerId = 'responsePanel') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const r = responseData.response || responseData;
  if (!r || !r.sintesis) {
    el.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px;text-align:center">Sin respuesta</div>';
    return;
  }

  const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const fuentes = (r.fuentes || []).map(f =>
    `<div style="padding:8px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(f.titulo || 'Fuente')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;word-break:break-all">${esc(f.url)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;text-transform:uppercase;letter-spacing:.04em">${esc(f.tipo)}</div>
    </div>`
  ).join('') || '<div style="color:var(--muted);font-size:12px">— Sin fuentes —</div>';

  const recs = (r.recomendaciones || []).map(x => `<div style="padding:6px 0;border-bottom:1px dashed var(--border);font-size:12px;color:var(--text)">• ${esc(x)}</div>`).join('') || '—';
  const acts = (r.acciones_propuestas || []).map(a => `<div style="padding:6px 0;border-bottom:1px dashed var(--border);font-size:12px"><b style="color:var(--primary)">${esc(a.accion)}</b>: <span style="color:var(--text)">${esc(a.detalle)}</span></div>`).join('') || '—';

  el.innerHTML = `
    <div style="display:grid;gap:12px">
      <div style="padding:14px;background:linear-gradient(135deg,rgba(124,92,255,.06),rgba(46,197,255,.04));border:1px solid rgba(124,92,255,.14);border-radius:12px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--primary)">📝 Síntesis</div>
        <div style="margin-top:6px;font-size:13px;color:var(--text);line-height:1.6">${esc(r.sintesis).replace(/\n/g,'<br>')}</div>
      </div>
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">💡 Explicación</div>
        <div style="margin-top:6px;font-size:12px;color:var(--muted);line-height:1.5">${esc(r.explicacion).replace(/\n/g,'<br>')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">📚 Fuentes</div>
          <div style="margin-top:8px">${fuentes}</div>
        </div>
        <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">✅ Recomendaciones</div>
          <div style="margin-top:8px">${recs}</div>
        </div>
      </div>
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">🚀 Acciones propuestas</div>
        <div style="margin-top:8px">${acts}</div>
      </div>
    </div>
  `;
}

async function callExecute(text, chatId = 'demo', history = []) {
  const r = await fetch('/api/v1/analyzer/execute', {  // fallback handled in script.js
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, chat_id: chatId, history })
  });
  if (!r.ok) throw new Error(`Execute ${r.status}: ${await r.text()}`);
  return r.json();
}

if (typeof window !== 'undefined') {
  window.Response = { renderResponse, callExecute };
}
