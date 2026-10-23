"""
cache_service.py — Caché L1 Python LRU + L2 Upstash Redis (memoria.md §6, razonamiento.md §9)
Flujo:
  Request → L1 (LRU in-memory) → HIT → Return
              ↓ MISS
             L2 (Upstash) → HIT → Return + warm L1
              ↓ MISS
             Tool execution → Store L1+L2 → Observation

Distinción (memoria.md §6):
  LRU = caché rápido volátil
  Upstash = caché distribuido / estado temporal
  Memory = contexto del agente (no es caché)

TTL por tipo (memoria.md §9):
  Respuesta temporal → LRU 5 min
  Resultado Web Search → Upstash 30 min
  Sesión → Upstash configurable
  Historial → PostgreSQL/SQLite
  Conocimiento → pgvector/SQLite
"""
import time
import hashlib
import logging
from collections import OrderedDict
from typing import Any, Optional, Dict
import os

logger = logging.getLogger(__name__)

# ── L1: LRU in-memory ──
class LRUCache:
    def __init__(self, max_size: int = 512, default_ttl: int = 300):
        self.max_size = max_size
        self.default_ttl = default_ttl
        self.store: OrderedDict[str, tuple[Any, float]] = OrderedDict()  # key -> (value, expires_at)
        self.hits = 0
        self.misses = 0

    def _expired(self, expires_at: float) -> bool:
        return time.time() > expires_at

    def get(self, key: str) -> Optional[Any]:
        if key not in self.store:
            self.misses += 1
            return None
        value, exp = self.store[key]
        if self._expired(exp):
            del self.store[key]
            self.misses += 1
            return None
        # Move to end (MRU)
        self.store.move_to_end(key)
        self.hits += 1
        return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        exp = time.time() + (ttl if ttl is not None else self.default_ttl)
        if key in self.store:
            del self.store[key]
        elif len(self.store) >= self.max_size:
            self.store.popitem(last=False)  # LRU evict
        self.store[key] = (value, exp)

    def delete(self, key: str):
        self.store.pop(key, None)

    def stats(self):
        total = self.hits + self.misses
        hit_rate = (self.hits / total) if total else 0.0
        return {"size": len(self.store), "max": self.max_size, "hits": self.hits, "misses": self.misses, "hit_rate": round(hit_rate, 3)}

# Singleton L1
_lru = LRUCache(
    max_size=int(os.getenv("LRU_MAX_SIZE", "512")),
    default_ttl=int(os.getenv("LRU_TTL_SECONDS", "300")),
)

# ── L2: Upstash Redis (mock si no configurado) ──
class UpstashMock:
    """Fallback en-memoria si Upstash no está configurado (desarrollo)."""
    def __init__(self):
        self.store: Dict[str, tuple[Any, float]] = {}
        self.hits = 0
        self.misses = 0

    def get(self, key: str):
        if key not in self.store:
            self.misses += 1
            return None
        val, exp = self.store[key]
        if time.time() > exp:
            del self.store[key]
            self.misses += 1
            return None
        self.hits += 1
        return val

    def set(self, key: str, value: Any, ttl: int = 1800):
        self.store[key] = (value, time.time() + ttl)

    def delete(self, key: str):
        self.store.pop(key, None)

    def stats(self):
        total = self.hits + self.misses
        return {"size": len(self.store), "hits": self.hits, "misses": self.misses, "hit_rate": round(self.hits / total, 3) if total else 0}

_upstash = UpstashMock()

# Si hay credenciales Upstash reales, se podría inicializar cliente HTTP aquí.
# Por ahora: mock que respeta la misma interfaz.

# ── Helpers ──
def cache_key(tool: str, payload: str, chat_id: Optional[str] = None) -> str:
    base = f"{tool}:{payload.strip()[:200]}"
    if chat_id:
        base += f":{chat_id}"
    return "cache:" + hashlib.sha256(base.encode()).hexdigest()[:16]

def l1_get(key: str): return _lru.get(key)
def l1_set(key: str, value: Any, ttl: Optional[int] = None): return _lru.set(key, value, ttl=ttl)
def l2_get(key: str): return _upstash.get(key)
def l2_set(key: str, value: Any, ttl: int = 1800): return _upstash.set(key, value, ttl=ttl)

def get_with_fallback(key: str):
    """L1 → L2 → None, con warming L1 si L2 hit."""
    v = _lru.get(key)
    if v is not None:
        return v, "L1"
    v = _upstash.get(key)
    if v is not None:
        # Warm L1
        _lru.set(key, v)
        return v, "L2"
    return None, "MISS"

def set_both(key: str, value: Any, l1_ttl: int = 300, l2_ttl: int = 1800):
    _lru.set(key, value, ttl=l1_ttl)
    _upstash.set(key, value, ttl=l2_ttl)

def stats():
    return {"L1": _lru.stats(), "L2": _upstash.stats()}

# ── TTL presets (memoria.md §9) ──
TTL_PRESETS = {
    "temporal": 300,      # 5 min LRU
    "web_search": 1800,   # 30 min Upstash
    "session": 3600,      # configurable
    "knowledge": 0,       # persistente (no expirar, va a PG)
}
