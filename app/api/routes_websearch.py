"""
routes_websearch.py — API Web Search con Tavily → Google → DuckDuckGo
POST /api/v1/websearch/search  {query, max_results}
GET  /api/v1/websearch/health
GET  /api/v1/websearch/providers
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/api/v1/websearch", tags=["WebSearch"])

class SearchReq(BaseModel):
    query: str = Field(..., example="inteligencia artificial en contratos")
    max_results: int = Field(5, ge=1, le=10)
    tavily_key: Optional[str] = None
    provider: Optional[str] = Field(None, description="forzar proveedor: tavily|google|duckduckgo")

@router.get("/health")
async def health():
    import os
    has_tavily = bool(os.getenv("TAVILY_API_KEY") or os.getenv("TAVILY_KEY"))
    has_google = bool(os.getenv("SERPAPI_API_KEY") or (os.getenv("GOOGLE_API_KEY") and os.getenv("GOOGLE_CSE_ID")))
    return {
        "status": "ok",
        "providers": ["tavily", "google", "duckduckgo"],
        "chain": "tavily → google → duckduckgo → mock",
        "fallback": "duckduckgo",
        "client": "python",
        "keys": {"tavily": has_tavily, "google": has_google, "duckduckgo": True},
    }

@router.get("/providers")
async def providers():
    return await health()

@router.post("/search")
async def search(req: SearchReq):
    from app.services.web_search_client import web_search, duckduckgo_search, google_search, tavily_search
    # Si se fuerza proveedor — cadena Tavily → Google → DuckDuckGo
    if req.provider == "tavily":
        data = await tavily_search(req.query, api_key=req.tavily_key, max_results=req.max_results)
        if not data or not data.get("results"):
            data = await google_search(req.query, max_results=req.max_results)
        if not data or not data.get("results"):
            data = await duckduckgo_search(req.query, max_results=req.max_results)
    elif req.provider == "google":
        data = await google_search(req.query, max_results=req.max_results)
        if not data or not data.get("results"):
            data = await duckduckgo_search(req.query, max_results=req.max_results)
    elif req.provider == "duckduckgo":
        data = await duckduckgo_search(req.query, max_results=req.max_results)
    else:
        # auto: Tavily → Google → DuckDuckGo → mock
        data = await web_search(req.query, max_results=req.max_results, tavily_key=req.tavily_key)
    # Normalize urls: ensure direct https link not /l/?kh= redirect
    for r in (data.get("results") or []):
        u = r.get("url") or ""
        if "uddg=" in u or u.startswith("/l/"):
            try:
                from urllib.parse import unquote
                import re as _re
                m = _re.search(r'uddg=([^&]+)', u)
                if m: r["url"] = unquote(m.group(1))
            except: pass
        if r.get("url","").startswith("//"): r["url"] = "https:"+r["url"]
        if r.get("url","") and not r["url"].startswith("http"):
            # fallback to ddg search link only if url empty
            if not r["url"].startswith("http"):
                import urllib.parse as _up
                r["url"] = "https://duckduckgo.com/?q="+_up.quote(req.query)
    return {
        "query": req.query,
        "provider": data.get("provider"),
        "results": data.get("results") or [],
        "answer": data.get("answer"),
        "count": len(data.get("results") or []),
        "chain": "tavily → google → duckduckgo",
    }
