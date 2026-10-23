'use strict';

/**
 * llm-config.js — Gestión API LLM (frontend)
 * Sincroniza localStorage (llm_configs, llm_active) con backend /api/v1/llm
 * Compatible: ES Module (import) y global (window.LLMConfig)
 */

const LLM_API = '/api/v1/llm';
const LS_KEY = 'llm_configs';
const LS_ACTIVE = 'llm_active';

// Helpers localStorage con try/catch
function lsGet(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch (_) {
    return fallback;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {
    console.warn('localStorage set failed', k);
  }
}
function lsGetStr(k) {
  try { return localStorage.getItem(k); } catch (_) { return null; }
}
function lsSetStr(k, v) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (_) {}
}

// Fetch helper con manejo de errores
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(txt || `HTTP ${r.status}`);
  }
  // 204 No Content
  if (r.status === 204) return null;
  return r.json();
}

// Backend sync (opcional, fallback a localStorage si backend no disponible)
async function fetchLLMs() {
  try {
    const list = await apiFetch(`${LLM_API}/config`);
    // Sincroniza a localStorage (sin exponer api_key real, solo masked_key)
    // Mantiene copia local para UI offline
    if (Array.isArray(list) && list.length) {
      const local = lsGet(LS_KEY, []);
      // Si backend tiene más, actualiza local (merge por id)
      const merged = [...local];
      for (const b of list) {
        if (!merged.find((l) => l.id === b.id)) {
          merged.push({
            id: b.id,
            provider: b.provider,
            name: b.name,
            model: b.model,
            base_url: b.base_url || '',
            temperature: b.temperature ?? 0.7,
            max_tokens: b.max_tokens ?? 2048,
            timeout: b.timeout ?? 30000,
            api_key: `••••${(b.masked_key || '').slice(-4)}`, // no exponer real
            is_active: b.is_active,
          });
        }
      }
      lsSet(LS_KEY, merged);
      const active = list.find((c) => c.is_active);
      if (active) lsSetStr(LS_ACTIVE, active.id);
    }
    return list;
  } catch (e) {
    console.warn('fetchLLMs backend fallo, usando localStorage', e.message);
    return lsGet(LS_KEY, []);
  }
}

async function saveLLM(payload) {
  // payload: {provider, name, api_key, model, base_url, temperature, max_tokens, timeout}
  if (!payload || !payload.api_key || payload.api_key.length < 8) {
    throw new Error('API Key inválida (mín 8 chars)');
  }
  try {
    const saved = await apiFetch(`${LLM_API}/config`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    // Actualiza localStorage
    const local = lsGet(LS_KEY, []);
    local.push({
      id: saved.id,
      provider: saved.provider,
      name: saved.name,
      model: saved.model,
      base_url: saved.base_url || '',
      temperature: saved.temperature,
      max_tokens: saved.max_tokens,
      timeout: saved.timeout,
      api_key: payload.api_key, // guarda real solo local
      is_active: saved.is_active,
    });
    lsSet(LS_KEY, local);
    if (saved.is_active) lsSetStr(LS_ACTIVE, saved.id);
    return saved;
  } catch (e) {
    // Fallback local si backend no disponible (demo)
    console.warn('saveLLM backend fallo, guardando solo local', e.message);
    const id = `llm_${Date.now()}`;
    const rec = { id, ...payload, is_active: lsGet(LS_KEY, []).length === 0 };
    const local = lsGet(LS_KEY, []);
    local.push({ ...rec, api_key: payload.api_key });
    lsSet(LS_KEY, local);
    if (rec.is_active) lsSetStr(LS_ACTIVE, id);
    return { id, ...payload, masked_key: `••••${payload.api_key.slice(-4)}`, is_active: rec.is_active };
  }
}

async function testLLM(payload) {
  // payload: {provider, api_key, model, base_url}
  return apiFetch(`${LLM_API}/test`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function activateLLM(id) {
  if (!id) throw new Error('id requerido');
  try {
    const res = await apiFetch(`${LLM_API}/config/${id}/activate`, { method: 'POST' });
    lsSetStr(LS_ACTIVE, id);
    // Actualiza flag local
    const local = lsGet(LS_KEY, []);
    local.forEach((c) => { c.is_active = c.id === id; });
    lsSet(LS_KEY, local);
    return res;
  } catch (e) {
    // Fallback local
    console.warn('activateLLM backend fallo, solo local', e.message);
    lsSetStr(LS_ACTIVE, id);
    const local = lsGet(LS_KEY, []);
    local.forEach((c) => { c.is_active = c.id === id; });
    lsSet(LS_KEY, local);
    return { id, activated: true, local: true };
  }
}

async function deleteLLM(id) {
  if (!id) throw new Error('id requerido');
  try {
    await apiFetch(`${LLM_API}/config/${id}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('deleteLLM backend fallo', e.message);
  }
  const local = lsGet(LS_KEY, []).filter((c) => c.id !== id);
  lsSet(LS_KEY, local);
  if (lsGetStr(LS_ACTIVE) === id) {
    const next = local[0]?.id || null;
    lsSetStr(LS_ACTIVE, next);
  }
  return { deleted: id };
}

function getActiveLocal() {
  const activeId = lsGetStr(LS_ACTIVE);
  const list = lsGet(LS_KEY, []);
  return list.find((c) => c.id === activeId) || list[0] || null;
}

// Exponer global para scripts no-module
if (typeof window !== 'undefined') {
  window.LLMConfig = { fetchLLMs, saveLLM, testLLM, activateLLM, deleteLLM, getActiveLocal, LLM_API };
}
