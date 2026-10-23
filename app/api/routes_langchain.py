"""
routes_langchain.py — WebSocket LangChain + HTTP status
Endpoints:
  GET  /api/langchain/status        (y /api/v1/langchain/status compat)
  WS   /ws/langchain                → langchain_status cada 2s + ReAct via analyzer
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Any
import asyncio
import json
import time
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["LangChain WS & Status"])

# Memoria mock + detección de langchain real
try:
    import langchain_core
    HAS_LANGCHAIN = True
    LANGCHAIN_VER = getattr(langchain_core, "__version__", "1.x")
except ImportError:
    HAS_LANGCHAIN = False
    LANGCHAIN_VER = None

# Estado en memoria para WS
SESSIONS: Dict[str, Any] = {}
WS_CLIENTS: set[WebSocket] = set()

def get_langchain_status() -> Dict[str, Any]:
    return {
        "has_langchain": HAS_LANGCHAIN,
        "langchain_core": HAS_LANGCHAIN,
        "store": f"{'LangChain ✓' if HAS_LANGCHAIN else 'InMemory'}ChatMessageHistory (L1 LRU + L2 Upstash fallback + L3 PostgreSQL + pgvector)",
        "version": LANGCHAIN_VER or "fallback",
        "sessions": len(SESSIONS),
        "messages": sum(len(v.get("messages", [])) for v in SESSIONS.values()),
        "has_langchain_core": HAS_LANGCHAIN,
        "ws_clients": len(WS_CLIENTS),
        "timestamp": int(time.time() * 1000),
    }

@router.get("/api/langchain/status")
@router.get("/api/v1/langchain/status")
@router.get("/api/langchain/status/")
@router.get("/api/v1/langchain/status/")
async def langchain_status():
    lc = get_langchain_status()
    return {
        "status": "ok",
        "langchain": lc,
        "has_langchain": lc["has_langchain"],
        "store": lc["store"],
    }

@router.get("/api/status")
async def api_status():
    # Compat para frontend que probea /api/status
    return await langchain_status()

# WebSocket principal
@router.websocket("/ws/langchain")
async def ws_langchain(ws: WebSocket):
    await ws.accept()
    WS_CLIENTS.add(ws)
    # Registrar sesión mock
    session_id = f"ws_{id(ws)}"
    SESSIONS[session_id] = {"messages": [], "created_at": time.time()}
    logger.info(f"WS LangChain conectado: {session_id} total {len(WS_CLIENTS)}")
    # Tarea de envío periódico
    async def send_periodic():
        try:
            while True:
                await asyncio.sleep(2)
                if ws.client_state.name != "CONNECTED":
                    break
                payload = {
                    "type": "langchain_status",
                    "langchain": get_langchain_status(),
                    "host": ws.url.hostname if hasattr(ws.url, 'hostname') else "localhost",
                    "time": int(time.time() * 1000),
                }
                try:
                    await ws.send_text(json.dumps(payload))
                except:
                    break
        except asyncio.CancelledError:
            pass

    periodic_task = asyncio.create_task(send_periodic())
    # Enviar inmediato al conectar
    try:
        await ws.send_text(json.dumps({
            "type": "langchain_status",
            "langchain": get_langchain_status(),
            "host": "connected",
            "time": int(time.time() * 1000),
        }))
    except:
        pass

    try:
        while True:
            data = await ws.receive_text()
            # Intenta parsear JSON
            try:
                msg = json.loads(data)
            except:
                msg = {"type": "chat", "text": data}

            mtype = msg.get("type", "chat")

            if mtype in ("ping", "heartbeat"):
                await ws.send_text(json.dumps({"type": "pong", "langchain": get_langchain_status()}))
                continue

            if mtype in ("chat", "message", "execute", "analyzer"):
                text = msg.get("text") or msg.get("message") or msg.get("query") or ""
                chat_id = msg.get("chat_id") or msg.get("session_id") or session_id

                # Guardar en sesión
                SESSIONS[session_id]["messages"].append({"role": "user", "text": text, "ts": time.time()})

                # --- Pipeline ANALYZER → PROCESSOR → RESPONSE via servicios ---
                try:
                    from app.services.analyzer_service import AnalyzerService
                    from app.services.processor_service import ProcessorService
                    from app.services.response_service import ResponseService

                    analyzer = AnalyzerService()
                    processor = ProcessorService()
                    response_svc = ResponseService()

                    a_res = analyzer.analyze(text, chat_id=chat_id, history=[])
                    p_res = await processor.process(text, a_res["plan"], chat_id=chat_id)
                    r_res = response_svc.build(text, a_res, p_res)

                    # Respuesta estructurada
                    reply = {
                        "type": "langchain_response",
                        "flow": "ANALYZER (10) → PROCESSOR (7 + tri) → RESPONSE (5) → USER (WS)",
                        "analyzer": a_res["analyzer"],
                        "plan": a_res["plan"],
                        "processor": p_res["processor"],
                        "tri_result": p_res["tri_result"],
                        "response": r_res["response"],
                        "langchain": get_langchain_status(),
                        "chat_id": chat_id,
                        "text": text,
                    }
                    # Guarda assistant
                    SESSIONS[session_id]["messages"].append({"role": "assistant", "text": r_res["response"]["sintesis"], "ts": time.time()})
                    await ws.send_text(json.dumps(reply))

                    # También broadcast de status actualizado
                    await ws.send_text(json.dumps({
                        "type": "langchain_status",
                        "langchain": get_langchain_status(),
                    }))

                except Exception as e:
                    logger.exception("WS analyzer error")
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "error": str(e),
                        "langchain": get_langchain_status(),
                    }))
                continue

            # Eco por defecto
            await ws.send_text(json.dumps({
                "type": "echo",
                "echo": msg,
                "langchain": get_langchain_status(),
            }))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WS error: {e}")
    finally:
        periodic_task.cancel()
        try:
            await periodic_task
        except:
            pass
        WS_CLIENTS.discard(ws)
        SESSIONS.pop(session_id, None)
        logger.info(f"WS LangChain desconectado: {session_id} restantes {len(WS_CLIENTS)}")
        try:
            await ws.close()
        except:
            pass

# Compat: también exponer en /ws/langchain/ con slash
@router.websocket("/ws/langchain/")
async def ws_langchain_slash(ws: WebSocket):
    await ws_langchain(ws)
