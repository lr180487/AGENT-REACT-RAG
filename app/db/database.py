"""
database.py — PostgreSQL con fallback SQLite + pgvector opcional
Según memoria.md L3→PostgreSQL + L4→pgvector, con fallback automático a SQLite para desarrollo.

Arquitectura:
  PostgreSQL (primario) → si falla/existe → SQLite fallback (app/data/app.db)
  Redis/Upstash L2 y LRU L1 son caché, no persistencia principal.

Uso:
  from app.db.database import Base, SessionLocal, engine, get_db, init_db, is_postgres
"""
import os
import logging
import pathlib
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)

# ── Paths ──
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DATA_DIR / "app.db"
SQLITE_URL = f"sqlite:///{SQLITE_PATH}"

# ── ENV ──
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
# Soporta variable alternativa
if not DATABASE_URL:
    DATABASE_URL = os.getenv("POSTGRES_URL", "").strip()
if not DATABASE_URL:
    DATABASE_URL = os.getenv("POSTGRES_DSN", "").strip()

# Si el .env tiene placeholder tipo postgresql://user:pass@localhost — considerarlo no válido si no conecta
def _is_placeholder_url(url: str) -> bool:
    placeholders = ["user:pass", "postgres:postgres@localhost", "localhost:5432/react_rag"]
    return any(p in url for p in placeholders) and os.getenv("ENV", "development") == "development"

# ── Base ──
Base = declarative_base()

# ── Engine resolution ──
engine = None
is_postgres = False
is_sqlite = False
_db_error = None

def _create_postgres_engine(url: str):
    # Intenta importar driver
    try:
        import psycopg2  # noqa
        driver_available = True
    except ImportError:
        try:
            import psycopg  # noqa
            driver_available = True
        except ImportError:
            driver_available = False
            logger.warning("PostgreSQL driver no instalado (psycopg2/psycopg) — fallback a SQLite")
            return None, "driver_missing"
    # Normaliza URL para psycopg2 vs psycopg
    # SQLAlchemy soporta postgresql:// y postgresql+psycopg2://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    try:
        eng = create_engine(
            url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=3600,
            echo=False,
        )
        # Test connection con timeout corto
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
            # Test pgvector extension si está disponible (no falla si no existe)
            try:
                conn.execute(text("SELECT 1"))
            except Exception:
                pass
        logger.info(f"✓ PostgreSQL conectado: {url.split('@')[-1]}")
        return eng, None
    except Exception as e:
        logger.warning(f"PostgreSQL no disponible ({e}) — fallback a SQLite")
        return None, str(e)

def _create_sqlite_engine():
    eng = create_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )
    logger.info(f"✓ SQLite fallback activo: {SQLITE_PATH}")
    return eng

# Lógica principal
if DATABASE_URL and DATABASE_URL.startswith(("postgresql://", "postgres://")):
    # Si es placeholder en dev, no intentes conectar, ve directo a sqlite para evitar timeout
    if _is_placeholder_url(DATABASE_URL):
        logger.info("DATABASE_URL es placeholder de ejemplo — usando SQLite fallback directamente")
        engine = _create_sqlite_engine()
        is_sqlite = True
    else:
        _eng, _err = _create_postgres_engine(DATABASE_URL)
        if _eng is not None:
            engine = _eng
            is_postgres = True
        else:
            _db_error = _err
            engine = _create_sqlite_engine()
            is_sqlite = True
else:
    if DATABASE_URL and not DATABASE_URL.startswith("sqlite"):
        logger.warning(f"DATABASE_URL no es postgres ni sqlite ('{DATABASE_URL[:30]}...') — usando SQLite")
    engine = _create_sqlite_engine()
    is_sqlite = True
    if DATABASE_URL:
        _db_error = f"URL no reconocida: {DATABASE_URL}"

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency FastAPI: yield session con commit/rollback automático."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_session():
    """Helper directo sin FastAPI Depends."""
    return SessionLocal()

def init_db():
    """
    Crea todas las tablas si no existen.
    Para PostgreSQL: intenta crear extensión pgvector (ignora si falla).
    Para SQLite: crea esquema compatible (sin vector).
    """
    try:
        if is_postgres:
            with engine.connect() as conn:
                try:
                    conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
                    conn.execute(text('CREATE EXTENSION IF NOT EXISTS vector'))
                    conn.commit()
                    logger.info("✓ Extensiones PostgreSQL (uuid-ossp, vector) verificadas")
                except Exception as e:
                    logger.warning(f"Extensión pgvector no disponible (continuando sin vector): {e}")
        # Importa todos los modelos para que Base los conozca antes de create_all
        try:
            import app.db.models  # noqa
        except Exception as e:
            logger.warning(f"Import models failed: {e}")
        try:
            import app.db.models_chat  # noqa
        except Exception as e:
            logger.warning(f"Import models_chat failed: {e}")
        try:
            import app.db.models_llm  # noqa
        except Exception as e:
            logger.warning(f"Import models_llm failed: {e}")
        try:
            import app.db.models_doc  # noqa
        except Exception as e:
            logger.warning(f"Import models_doc failed: {e}")
        Base.metadata.create_all(bind=engine)
        logger.info(f"✓ DB init completo ({'PostgreSQL' if is_postgres else 'SQLite'}) — tablas: {list(Base.metadata.tables.keys())}")
    except Exception as e:
        logger.error(f"init_db fallo: {e}")
        raise

def health_check() -> dict:
    """Para /health: retorna estado de DB."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "engine": "postgresql" if is_postgres else "sqlite",
            "url": SQLITE_URL if is_sqlite else DATABASE_URL.split("@")[-1],
            "sqlite_path": str(SQLITE_PATH) if is_sqlite else None,
            "fallback": is_sqlite and bool(_db_error),
            "error": _db_error,
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "fallback": is_sqlite}
