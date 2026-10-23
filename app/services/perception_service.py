"""
perception_service.py — PERCEPCIÓN del agente (01_percepcion.md)
Transforma información del entorno (texto, APIs, archivos, imágenes, sensores)
en contexto estructurado listo para el razonamiento.

Flujo:
  ENTORNO (Texto/API/Archivo/Imagen/Sensor/Evento)
    ↓
  Capa de percepción (FastAPI → Pydantic → Agent Gateway)
    ↓
  Normalización (limpieza, idioma, entidades, números, fechas)
    ↓
  Validación + Seguridad (límites, sanitización, prompt-injection)
    ↓
  Contexto normalizado → Reasoning

Ver percepcion.md §2-8.
"""
import re
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime

class PerceptionService:
    """
    Capa de percepción unificada.
    Soporta múltiples fuentes pero entrada principal es texto vía FastAPI.
    Preparado para extender a APIs, archivos, visión, sensores.
    """

    # ── Normalización ──
    def normalize_text(self, raw: str) -> Dict[str, Any]:
        """
        Limpia y extrae entidades del texto de entrada.
        - Elimina espacios innecesarios
        - Normaliza caracteres
        - Detecta idioma (es/en simple), entidades, números, fechas, indicadores
        """
        if not isinstance(raw, str):
            raw = str(raw)
        # Limpieza básica
        cleaned = re.sub(r"\s+", " ", raw).strip()
        # Normaliza saltos y caracteres raros
        cleaned = cleaned.replace("\u00a0", " ")

        # Extracción entidades
        entidades = {
            "fechas": re.findall(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", cleaned),
            "emails": re.findall(r"[\w\.-]+@[\w\.-]+\.\w+", cleaned),
            "urls": re.findall(r"https?://[^\s]+", cleaned),
            "numeros": re.findall(r"\b\d+[.,]?\d*\b", cleaned),
            "porcentajes": re.findall(r"\b\d+[.,]?\d*\s*%", cleaned),
            "keywords": [w for w in cleaned.split() if len(w) > 4][:10],
        }

        # Métrica / indicador detectado
        metric = None
        if "crecimiento" in cleaned.lower() or "ventas" in cleaned.lower():
            # Busca valor numérico principal
            m = re.search(r"(\d+[.,]?\d*)\s*%", cleaned)
            if m:
                try:
                    metric = {"metric": "crecimiento de ventas", "value": float(m.group(1).replace(",", ".")), "unit": "%", "type": "percentage"}
                except:
                    metric = {"metric": "crecimiento de ventas", "value": m.group(1), "unit": "%", "type": "percentage"}

        # Idioma simple
        spanish_hints = ["el", "la", "de", "que", "analiza", "crecimiento", "ventas", "busca", "contrato"]
        lang = "es" if any(w in cleaned.lower() for w in spanish_hints) else "en"

        # Tamaño / hash para idempotencia y límites
        size = len(cleaned.encode("utf-8"))
        hash_id = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()[:12]

        return {
            "raw": raw,
            "cleaned": cleaned,
            "normalized": cleaned,
            "length": len(cleaned),
            "size_bytes": size,
            "hash": hash_id,
            "language": lang,
            "entities": entidades,
            "metric": metric,
            "timestamp": datetime.utcnow().isoformat(),
        }

    def detect_source_type(self, payload: Dict[str, Any]) -> str:
        """Detecta tipo de fuente: texto | api | archivo | imagen | sensor | evento."""
        if payload.get("file") or payload.get("filename"):
            return "archivo"
        if payload.get("image") or payload.get("image_url"):
            return "imagen"
        if payload.get("sensor") or payload.get("sensor_id"):
            return "sensor"
        if payload.get("event") or payload.get("event_type"):
            return "evento"
        if payload.get("api_response"):
            return "api"
        return "texto"

    def validate(self, normalized: Dict[str, Any], max_size: int = 20000) -> Dict[str, Any]:
        """
        Valida + sanitiza + limita (percepcion.md §7 Seguridad).
        - Límites de tamaño
        - Sanitización básica
        - Detección prompt injection simple
        """
        cleaned = normalized.get("cleaned", "")
        errors = []
        warnings = []

        # Tamaño
        if len(cleaned.encode("utf-8")) > max_size:
            errors.append(f"input_exceeds_limit:{max_size}")

        # Vacío
        if not cleaned.strip():
            errors.append("empty_input")

        # Prompt injection simple (no bloquea, solo marca)
        injection_patterns = [
            r"ignore previous instructions",
            r"system\s*:", r"jailbreak", r"do anything now",
            r"exfiltrate", r"reveal system prompt"
        ]
        lower = cleaned.lower()
        injection_detected = any(re.search(p, lower) for p in injection_patterns)
        if injection_detected:
            warnings.append("possible_prompt_injection")

        # Sanitización: elimina potenciales secretos (sk-..., keys)
        # No se modifica el contenido para el LLM, solo se marca para no guardar en memoria sin cifrar
        has_secret = bool(re.search(r"sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{30,}|gsk_[a-zA-Z0-9]{20,}", cleaned))
        if has_secret:
            warnings.append("contains_secret_do_not_persist_plain")

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "sanitized": cleaned.strip()[:max_size],
            "injection": injection_detected,
            "has_secret": has_secret,
        }

    def build_context(self, raw_input: str, source: str = "user", extra: Optional[Dict] = None, chat_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Construye contexto estructurado final para el módulo de razonamiento.
        Salida (percepcion.md §8):
          {input, source, type, normalized, entities, metric, validated, ...}
        """
        normalized = self.normalize_text(raw_input)
        validation = self.validate(normalized)
        src_type = self.detect_source_type(extra or {"text": raw_input})

        context = {
            "input": raw_input,
            "cleaned": normalized["cleaned"],
            "source": source,
            "type": src_type,
            "normalized": validation["sanitized"] if validation["valid"] else normalized["cleaned"],
            "is_normalized": True,
            "language": normalized["language"],
            "entities": normalized["entities"],
            "metric": normalized["metric"],
            "hash": normalized["hash"],
            "validation": validation,
            "chat_id": chat_id,
            "extra": extra or {},
            "timestamp": normalized["timestamp"],
            # Para compatibilidad con analyzer_service
            "text": validation["sanitized"],
        }
        return context

    # ── Extensores para futuras fuentes (percepcion.md §5) ──

    def from_api(self, api_data: Dict[str, Any]) -> Dict[str, Any]:
        """Adapter para datos externos de API."""
        text = api_data.get("text") or api_data.get("question") or str(api_data)
        return self.build_context(text, source="api", extra={"api_response": api_data})

    def from_file(self, file_meta: Dict[str, Any], extracted_text: str) -> Dict[str, Any]:
        """Loader para PDF/CSV/JSON/DOCX → contexto."""
        ctx = self.build_context(extracted_text, source="file", extra={"file": file_meta})
        ctx["type"] = "archivo"
        ctx["file_meta"] = file_meta
        return ctx

    def from_image(self, image_meta: Dict[str, Any], vision_output: str) -> Dict[str, Any]:
        """Visión artificial → contexto."""
        ctx = self.build_context(vision_output, source="vision", extra={"image": image_meta})
        ctx["type"] = "imagen"
        return ctx

    def from_sensor(self, sensor_data: Dict[str, Any]) -> Dict[str, Any]:
        """IoT Gateway → contexto."""
        text = sensor_data.get("text") or str(sensor_data)
        ctx = self.build_context(text, source="sensor", extra={"sensor": sensor_data})
        ctx["type"] = "sensor"
        return ctx
