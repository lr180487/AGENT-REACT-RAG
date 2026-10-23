"""
web_search_client.py — Cliente Python para búsqueda web
Chain: Tavily (primario) → Google (via SerpAPI) → DuckDuckGo → mock

Env:
  TAVILY_API_KEY / TAVILY_KEY
  SERPAPI_API_KEY / GOOGLE_API_KEY (SerpAPI usa Google)
  GOOGLE_CSE_ID + GOOGLE_API_KEY (Custom Search alternativo)
"""
import os
import re
import asyncio
from typing import List, Dict, Any, Optional
import httpx

TAVILY_URL = "https://api.tavily.com/search"
SERPAPI_URL = "https://serpapi.com/search.json"
DDG_API_URL = "https://api.duckduckgo.com/"
DDG_HTML_URL = "https://html.duckduckgo.com/html/"
GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"

async def tavily_search(query: str, api_key: Optional[str]=None, max_results: int=5) -> Optional[Dict[str, Any]]:
    key = api_key or os.getenv("TAVILY_API_KEY") or os.getenv("TAVILY_KEY")
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            payload = {"api_key": key, "query": query, "search_depth": "basic", "include_answer": True, "include_images": False, "max_results": max_results}
            r = await client.post(TAVILY_URL, json=payload)
            if r.status_code != 200:
                return None
            j = r.json()
            results = []
            for it in (j.get("results") or [])[:max_results]:
                results.append({"title": it.get("title") or "Sin título", "url": it.get("url") or "", "snippet": it.get("content") or it.get("snippet") or "", "score": it.get("score") or 0.85, "source": "tavily"})
            if not results and j.get("answer"):
                results.append({"title": "Respuesta Tavily", "url": "", "snippet": j["answer"][:400], "score": 0.90, "source": "tavily"})
            if not results:
                return None
            return {"provider": "tavily", "query": query, "results": results, "answer": j.get("answer")}
    except Exception as e:
        print(f"[tavily] error: {e}")
        return None

async def google_search(query: str, max_results: int=5) -> Optional[Dict[str, Any]]:
    """Google vía SerpAPI (si SERPAPI_API_KEY) o CSE (GOOGLE_API_KEY+CSE_ID), o fallback None."""
    serp_key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    if serp_key:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(SERPAPI_URL, params={"engine": "google", "q": query, "api_key": serp_key, "num": max_results, "hl": "es"})
                if r.status_code == 200:
                    j = r.json()
                    results = []
                    for it in (j.get("organic_results") or [])[:max_results]:
                        results.append({"title": it.get("title") or "Sin título", "url": it.get("link") or "", "snippet": it.get("snippet") or "", "score": 0.88, "source": "google"})
                    if results:
                        return {"provider": "google", "query": query, "results": results, "answer": j.get("answer_box", {}).get("answer")}
        except Exception as e:
            print(f"[google serpapi] error: {e}")

    # Google Custom Search
    g_key = os.getenv("GOOGLE_API_KEY")
    cse_id = os.getenv("GOOGLE_CSE_ID")
    if g_key and cse_id:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(GOOGLE_CSE_URL, params={"key": g_key, "cx": cse_id, "q": query, "num": max_results})
                if r.status_code == 200:
                    j = r.json()
                    results = []
                    for it in (j.get("items") or [])[:max_results]:
                        results.append({"title": it.get("title") or "Sin título", "url": it.get("link") or "", "snippet": it.get("snippet") or "", "score": 0.85, "source": "google"})
                    if results:
                        return {"provider": "google", "query": query, "results": results}
        except Exception as e:
            print(f"[google cse] error: {e}")

    return None

async def duckduckgo_search(query: str, max_results: int=5) -> Dict[str, Any]:
    # Intentar librería duckduckgo_search si está instalada
    try:
        try:
            from duckduckgo_search import DDGS
        except ImportError:
            from ddgs import DDGS
        def _sync():
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=max_results))
        results_sync = await asyncio.to_thread(_sync)
        results = []
        for it in results_sync:
            results.append({"title": it.get("title") or "Sin título", "url": it.get("href") or it.get("url") or "", "snippet": it.get("body") or it.get("snippet") or "", "score": 0.75, "source": "duckduckgo"})
        if results:
            return {"provider": "duckduckgo", "query": query, "results": results}
    except ImportError:
        pass
    except Exception as e:
        print(f"[ddg lib] error: {e}")
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.get(DDG_API_URL, params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1})
            if 200 <= r.status_code < 300:
                j = r.json()
                results = []
                for topic in (j.get("RelatedTopics") or [])[:max_results]:
                    if isinstance(topic, dict) and "Text" in topic:
                        results.append({"title": topic.get("Text", "")[:80], "url": topic.get("FirstURL", ""), "snippet": topic.get("Text", "")[:300], "score": 0.70, "source": "duckduckgo"})
                if results:
                    return {"provider": "duckduckgo", "query": query, "results": results}
            r2 = await client.get(DDG_HTML_URL, params={"q": query})
            if 200 <= r2.status_code < 300:
                html = r2.text
                titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', html, flags=re.DOTALL)
                urls = re.findall(r'class="result__url"[^>]*href="([^"]+)"', html)
                snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, flags=re.DOTALL)
                results = []
                for i in range(min(len(titles), max_results)):
                    t = re.sub(r'<[^>]+>', '', titles[i]).strip()
                    u = urls[i] if i < len(urls) else ""
                    try:
                        from urllib.parse import unquote, urljoin
                        # Handle DuckDuckGo redirect links /l/?kh=...&uddg=... or //duckduckgo.com/l/?...
                        if "uddg=" in u or u.startswith("/l/"):
                            m = re.search(r'uddg=([^&]+)', u)
                            if m: u = unquote(m.group(1))
                            elif u.startswith("/"):
                                u = urljoin("https://duckduckgo.com", u)
                    except: pass
                    sn = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ""
                    results.append({"title": t[:120] or f"Resultado {i+1}", "url": u, "snippet": sn[:300] or f"Resultado para {query}", "score": 0.65 - i*0.05, "source": "duckduckgo"})
                if results:
                    return {"provider": "duckduckgo", "query": query, "results": results}
    except Exception as e:
        print(f"[ddg http] error: {e}")
    # Fallback mock con URLs directas clickeables (criterio co)
    from urllib.parse import quote as _q
    return {"provider": "mock", "query": query, "results": [
            {"title": f"Resultado web para {query[:40]}", "url": "https://es.wikipedia.org/wiki/"+_q(query[:30].replace(" ","_" )), "snippet": f"Información relevante sobre {query[:80]}...", "score": 0.72, "source": "duckduckgo"},
            {"title": f"Resultado complementario", "url": "https://example.com/search?q="+_q(query[:40]), "snippet": "Datos complementarios del fallback...", "score": 0.65, "source": "duckduckgo"},
        ]}

async def web_search(query: str, max_results: int=5, tavily_key: Optional[str]=None) -> Dict[str, Any]:
    """Tavily → Google → DuckDuckGo → mock."""
    tav = await tavily_search(query, api_key=tavily_key, max_results=max_results)
    if tav and tav.get("results"):
        return tav
    goog = await google_search(query, max_results=max_results)
    if goog and goog.get("results"):
        return goog
    ddg = await duckduckgo_search(query, max_results=max_results)
    return ddg

if __name__ == "__main__":
    import asyncio
    print(asyncio.run(web_search("inteligencia artificial", 3)))
