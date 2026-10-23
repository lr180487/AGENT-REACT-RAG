"""
main.py — Backend PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN → RESPONSE
Versión 3.0 — PostgreSQL con fallback SQLite
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from pathlib import Path
import logging

# Routers
try:
    from app.api.routes_analyzer import router as analyzer_router
except ImportError:
    analyzer_router = None

try:
    from app.api.routes_langchain import router as langchain_router
except ImportError:
    langchain_router = None

try:
    from app.api.routes_llm import router as llm_router
except ImportError:
    llm_router = None

try:
    from app.api.routes_health import router as health_router
except ImportError:
    health_router = None

try:
    from app.api.routes_websearch import router as websearch_router
except ImportError:
    websearch_router = None

try:
    from app.api.routes_chats import router as chats_router
except ImportError:
    chats_router = None

try:
    from app.api.routes_sync import router as sync_router
except ImportError:
    sync_router = None

try:
    from app.api.routes_documents import router as documents_router
except ImportError:
    documents_router = None

try:
    from app.api.routes_rag import router as rag_router
except ImportError:
    rag_router = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="agente_react_rag — PERCEPCIÓN → RAZONAMIENTO → MEMORIA → ACCIÓN",
    description="""
    **Flujo ReAct:** Percepción (texto/API/archivo/imagen/sensor) → Razonamiento (8 iter, 10 tools, timeout 15s) → Memoria (L1 LRU → L2 Upstash → L3 Postgres/SQLite → L4 pgvector) → Acción (Tool Router + cache + human-in-loop + idempotencia) → Response (5 apartados) → USER

    **DB:** PostgreSQL primario con fallback automático a SQLite `app/data/app.db` si no conecta.
    **WebSocket:** WS /ws/langchain cada 2s + GET /api/langchain/status
    **App:** /frontend/interfaz.html
    **Env:** `.env` en raíz con DATABASE_URL, REDIS_URL, LLM_*, MAX_ITERATIONS etc.
    """,
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers - ANTES de estáticos
if health_router:
    app.include_router(health_router, prefix="/api/v1", tags=["Health"])
    logger.info("✓ health_router en /api/v1")

if langchain_router:
    app.include_router(langchain_router)
    logger.info("✓ langchain_router en /ws/langchain y /api/langchain/status")

if analyzer_router:
    app.include_router(analyzer_router)
    logger.info("✓ analyzer_router en /api/v1/analyzer (con ReAct)")

if llm_router:
    app.include_router(llm_router)
    logger.info("✓ llm_router en /api/v1/llm")

if websearch_router:
    app.include_router(websearch_router)
    logger.info("✓ websearch_router en /api/v1/websearch")

if chats_router:
    app.include_router(chats_router)
    logger.info("✓ chats_router en /api/v1/chats")

if documents_router:
    app.include_router(documents_router)
    logger.info("✓ documents_router en /api/v1/documents")

if rag_router:
    app.include_router(rag_router)

if sync_router:
    app.include_router(sync_router)
    logger.info("✓ rag_router en /api/v1/rag (Base de Conocimiento)")

# ── DB health endpoint (Postgres → SQLite fallback) ──
@app.get("/api/v1/db/health", tags=["Database"])
def db_health():
    try:
        from app.db.database import health_check
        return health_check()
    except Exception as e:
        return {"status": "error", "error": str(e), "engine": "unknown"}

@app.get("/api/v1/db/stats", tags=["Database"])
def db_stats():
    try:
        from app.db.database import engine, is_postgres, is_sqlite, SQLITE_PATH
        from sqlalchemy import text
        with engine.connect() as conn:
            # Cuenta tablas
            if is_postgres:
                rows = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'")).fetchall()
                tables = [r[0] for r in rows]
            else:
                rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
                tables = [r[0] for r in rows]
            # Cuenta chats si existe
            count = 0
            try:
                if "chats" in tables:
                    count = conn.execute(text("SELECT COUNT(*) FROM chats")).scalar() or 0
                elif "chat_sessions" in tables:
                    count = conn.execute(text("SELECT COUNT(*) FROM chat_sessions")).scalar() or 0
            except:
                pass
        return {"engine": "postgresql" if is_postgres else "sqlite", "sqlite_path": str(SQLITE_PATH) if is_sqlite else None, "tables": tables, "chats": count}
    except Exception as e:
        return {"error": str(e)}

# Frontend - detección robusta
FRONTEND_CANDIDATES = [
    Path("/home/user/agente_react_rag/frontend"),
    Path(__file__).resolve().parent.parent / "frontend",
    Path(__file__).resolve().parents[2] / "agente_react_rag" / "frontend",
    Path(__file__).resolve().parent / "frontend",
]
frontend_dir = None
for cand in FRONTEND_CANDIDATES:
    if cand.exists() and (cand / "index.html").exists():
        frontend_dir = cand
        break

root_dir = Path("/home/user")
BASE_DIR = Path(__file__).resolve().parent.parent

# Dashboard eliminado → redirigir a la app
@app.get("/dashboard", include_in_schema=False)
@app.get("/dashboard.html", include_in_schema=False)
@app.get("/frontend/dashboard.html", include_in_schema=False)
async def _dashboard_gone():
    return RedirectResponse(url="/frontend/interfaz.html#view-chat", status_code=307)

if frontend_dir:
    app.mount("/frontend", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
    logger.info(f"✓ Frontend en /frontend → {frontend_dir}")

# Montar /static solo si root tiene archivos sueltos (evita conflicto con frontend)
if (root_dir / "interfaz.html").exists():
    try:
        app.mount("/static", StaticFiles(directory=str(root_dir)), name="static")
        logger.info("✓ Static en /static → /home/user")
    except Exception:
        pass
elif frontend_dir:
    try:
        app.mount("/static", StaticFiles(directory=str(frontend_dir), html=True), name="static-fallback")
        logger.info(f"✓ Static fallback → {frontend_dir}")
    except Exception:
        pass

# Health - ANTES del catch-all
@app.get("/health", tags=["Health"])
def health():
    db_info = {}
    try:
        from app.db.database import health_check
        db_info = health_check()
    except:
        db_info = {"status": "unknown"}
    return {
        "status": "ok",
        "flow": "PERCEPCIÓN → RAZONAMIENTO (ReAct 8) → MEMORIA (L1→L4) → ACCIÓN → RESPONSE (5) → USER → WS",
        "analyzer": "10 pasos",
        "processor": "7 ramas + tri",
        "response": "5 apartados",
        "perception": "texto | api | archivo | imagen | sensor | evento",
        "reasoning": "Reasoning → Action → Observation → Final Answer",
        "memory": "L1 LRU → L2 Upstash → L3 Postgres/SQLite → L4 pgvector",
        "action": "Tool Router + cache + human-in-loop + idempotencia + circuit",
        "database": db_info.get("engine", "unknown"),
        "db_status": db_info.get("status", "unknown"),
        "fallback": db_info.get("fallback", False),
        "websocket": "/ws/langchain",
        "frontend": "/frontend/ , /frontend/interfaz.html , /frontend/nuevo-chat.html",
        "version": "3.0.0",
    }

# Assets en root (evita 404 en /llm-config.js etc.) - ANTES del catch-all
ASSET_FILES = ["llm-config.js", "script.js", "nuevo-chat.js", "chat.js", "analyzer.js", "processor.js", "response.js", "app.js", "main.js", "favicon.png", "favicon.svg", "favicon.ico"]
for asset in ASSET_FILES:
    def _make_asset_handler(fname=asset):
        async def _asset():
            for base in [frontend_dir, root_dir, BASE_DIR / "frontend"]:
                if base and (base / fname).exists():
                    return FileResponse(str(base / fname))
            return HTMLResponse(f"404 {fname} no encontrado", status_code=404)
        return _asset
    app.get(f"/{asset}", tags=["Frontend-Assets"])(_make_asset_handler(asset))

# Root - ANTES del catch-all
@app.get("/", response_class=HTMLResponse, tags=["Root"])
async def root():
    for cand in [
        frontend_dir / "index.html" if frontend_dir else None,
        frontend_dir / "interfaz.html" if frontend_dir else None,
        root_dir / "interfaz.html",
        BASE_DIR / "frontend" / "index.html",
    ]:
        if cand and cand.exists():
            return FileResponse(str(cand))
    return HTMLResponse(content="""
    <html><body style="font-family:monospace;padding:32px">
    <h3>agente_react_rag 3.0</h3>
    <p>Flow: PERCEPCIÓN → RAZONAMIENTO (ReAct) → MEMORIA (L1→L4) → ACCIÓN → RESPONSE → USER</p>
    <ul>
      <li><a href="/docs">/docs</a></li>
      <li><a href="/api/langchain/status">/api/langchain/status</a> · WS <code>/ws/langchain</code></li>
      <li><a href="/api/v1/db/health">/api/v1/db/health</a> · DB Postgres→SQLite fallback</li>
      <li><a href="/frontend/">/frontend/</a> | <a href="/frontend/interfaz.html">/interfaz.html</a></li>
    </ul>
    </body></html>
    """)

# HTML directos
for fname in ["interfaz.html", "nuevo-chat.html", "index.html", "redirigir.html"]:
    def _make_handler(name=fname):
        async def _handler():
            for base in [frontend_dir, root_dir, BASE_DIR / "frontend"]:
                if base and (base / name).exists():
                    return FileResponse(str(base / name))
            return HTMLResponse(f"<h1>404 {name} no encontrado</h1>", status_code=404)
        return _handler
    app.get(f"/{fname}", response_class=HTMLResponse, tags=["Frontend"])(_make_handler(fname))
    app.get(f"/{fname.replace('.html','')}", response_class=HTMLResponse, tags=["Frontend"])(_make_handler(fname))

# Catch-all AL FINAL - solo para archivos con extensión
@app.get("/{full_path:path}", tags=["Frontend-CatchAll"], include_in_schema=False)
async def serve_frontend_assets(request: Request, full_path: str):
    if full_path.startswith(("api/", "ws/", "docs", "redoc", "openapi.json", "health", "frontend/", "static/")):
        return HTMLResponse("Not found", status_code=404)
    if "." not in full_path:
        return HTMLResponse("Not found", status_code=404)
    for base in [frontend_dir, root_dir, BASE_DIR / "frontend"]:
        if base:
            candidate = base / full_path
            try:
                candidate.resolve().relative_to(base.resolve())
            except ValueError:
                continue
            if candidate.exists() and candidate.is_file():
                return FileResponse(str(candidate))
    return HTMLResponse(f"404 {full_path} no encontrado", status_code=404)

@app.on_event("startup")
async def on_startup():
    logger.info("🚀 agente_react_rag 3.0 — PERCEPCIÓN → RAZONAMIENTO (ReAct 8) → MEMORIA (L1→L4) → ACCIÓN → RESPONSE (5) | WS /ws/langchain")
    if frontend_dir:
        logger.info(f"   Frontend: {frontend_dir}")
    # Init DB (Postgres → SQLite fallback)
    try:
        from app.db.database import init_db, health_check
        init_db()
        h = health_check()
        logger.info(f"   DB: {h.get('engine')} status={h.get('status')} fallback={h.get('fallback')} {h.get('sqlite_path') or ''}")
    except Exception as e:
        logger.warning(f"   DB init fallo (continuando sin DB persistente): {e}")
    # Sincroniza documentos: base ↔ RAG
    try:
        from app.services import documents_service
        creados = documents_service.ensure_seed()
        reindex = documents_service.hydrate_rag()
        st = documents_service.stats()
        logger.info(
            f"   Documentos: {st['total']} en base ({st['seed']} semilla, {st['uploaded']} subidos) · "
            f"{st['chunks']} chunks · nuevos={creados} reindexados={reindex}"
        )
    except Exception as e:
        logger.warning(f"   Sync de documentos falló: {e}")
    # Verifica .env
    try:
        from app.config import settings
        logger.info(f"   ENV: {settings.ENV} PORT={settings.PORT} MAX_ITERATIONS={settings.MAX_ITERATIONS} MAX_TOOL_CALLS={settings.MAX_TOOL_CALLS}")
    except Exception as e:
        logger.warning(f"   Config load fallo: {e}")

@app.on_event("shutdown")
async def on_shutdown():
    logger.info("🛑 Backend detenido")
