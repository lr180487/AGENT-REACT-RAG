'use strict';

/**
 * app.js — Coordinador principal ANALYZER → PROCESSOR → RESPONSE
 * Usa analyzer.js, processor.js, response.js, llm-config.js
 * Sincronizado con backend 2.1 (WS /ws/langchain + /api/v1/analyzer/execute)
 */

// Helpers
function escHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function executeFullFlow(text, chatId = 'demo') {
  // Llama al backend que orquesta los 3 servicios
  const data = await fetch('/api/v1/analyzer/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, chat_id: chatId })
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  // Renderiza en paneles si existen
  try {
    if (window.Analyzer && data.analyzer) window.Analyzer.renderAnalyzer(data, 'analyzerPanel');
    if (window.Processor && data.processor) window.Processor.renderProcessor(data, 'processorPanel');
    if (window.Response && data.response) window.Response.renderResponse(data, 'responsePanel');
  } catch (e) {
    console.warn('render panels error', e);
  }

  return data;
}

// WebSocket LangChain helper (para dot/pill)
let _ws = null;
function connectLangChainWS(onStatus) {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'];
  let idx = 0;
  function tryConnect() {
    if (_ws && _ws.readyState === WebSocket.OPEN) return;
    const url = proto + hosts[idx] + '/ws/langchain';
    try { _ws = new WebSocket(url); } catch { idx = (idx + 1) % hosts.length; setTimeout(tryConnect, 800); return; }
    _ws.onopen = () => {
      if (onStatus) onStatus({ has_langchain: true, store: 'connected ' + hosts[idx] });
    };
    _ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'langchain_status' && onStatus) onStatus(d.langchain);
        if (d.type === 'langchain_response' && window.Response) {
          window.Response.renderResponse(d, 'responsePanel');
        }
      } catch {}
    };
    _ws.onclose = () => { idx = (idx + 1) % hosts.length; setTimeout(tryConnect, 1200); };
    _ws.onerror = () => { try { _ws.close(); } catch {} };
  }
  tryConnect();
  // Fallback HTTP
  setTimeout(async () => {
    if (_ws && _ws.readyState === WebSocket.OPEN) return;
    for (const h of hosts) {
      try {
        const r = await fetch(proto + h + '/api/langchain/status').then(x => x.json());
        if (r && r.langchain && onStatus) { onStatus(r.langchain); break; }
      } catch {}
    }
  }, 3000);
}

if (typeof window !== 'undefined') {
  window.App = { executeFullFlow, connectLangChainWS, escHtml };
}

// Auto-conectar si hay elementos de estado
document.addEventListener('DOMContentLoaded', () => {
  const dot = document.getElementById('wsLangchainDot');
  const txt = document.getElementById('wsLangchainText');
  const meta = document.getElementById('wsLangchainMeta');
  if (dot || txt) {
    connectLangChainWS((lc) => {
      const has = lc.has_langchain;
      if (dot) { dot.style.background = has ? '#10b981' : '#f59e0b'; dot.style.boxShadow = has ? '0 0 0 6px rgba(16,185,129,.18)' : '0 0 0 6px rgba(245,158,11,.18)'; }
      if (txt) txt.textContent = has ? 'LangChain ✓' : 'InMemory';
      if (meta) meta.textContent = `${lc.sessions || 0} sesiones · ${lc.messages || 0} msgs`;
    });
  }
});
