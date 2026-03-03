import json
import os
import re
import time
import uuid
from typing import Any, Dict, Optional

_OTEL_INIT_ATTEMPTED = False
_OTEL_ENABLED = False
_OTEL_LOGGER = None

# Fallback model pricing (USD per 1M tokens). Override with env vars.
_DEFAULT_MODEL_PRICING_USD_PER_1M = {
    "gemini-2.5-flash-lite": {"input": 0.10, "output": 0.40},
}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_iso_utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _read_usage_field(usage_metadata: Any, field_name: str) -> int:
    if usage_metadata is None:
        return 0

    # Vertex SDK object path.
    value = getattr(usage_metadata, field_name, None)
    if value is not None:
        return _safe_int(value, 0)

    # Dict-like fallback.
    if isinstance(usage_metadata, dict):
        return _safe_int(usage_metadata.get(field_name), 0)

    # Protobuf / attrs fallback.
    try:
        return _safe_int(usage_metadata[field_name], 0)
    except Exception:
        return 0


def extract_usage_metrics(response: Any) -> Dict[str, int]:
    usage_metadata = getattr(response, "usage_metadata", None)

    input_tokens = _read_usage_field(usage_metadata, "prompt_token_count")
    output_tokens = _read_usage_field(usage_metadata, "candidates_token_count")
    total_tokens = _read_usage_field(usage_metadata, "total_token_count")
    cached_tokens = _read_usage_field(usage_metadata, "cached_content_token_count")

    if total_tokens <= 0:
        total_tokens = max(0, input_tokens + output_tokens)

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "cached_tokens": cached_tokens,
    }


def _model_to_env_prefix(model_name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", (model_name or "").strip().upper())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "GEMINI"


def _pricing_for_model(model_name: str) -> Dict[str, Any]:
    model_key = (model_name or "").strip().lower()
    defaults = _DEFAULT_MODEL_PRICING_USD_PER_1M.get(model_key, {})

    model_prefix = _model_to_env_prefix(model_name)
    model_input_env = os.getenv(f"{model_prefix}_INPUT_COST_PER_1M_USD")
    model_output_env = os.getenv(f"{model_prefix}_OUTPUT_COST_PER_1M_USD")
    global_input_env = os.getenv("GEMINI_INPUT_COST_PER_1M_USD")
    global_output_env = os.getenv("GEMINI_OUTPUT_COST_PER_1M_USD")

    input_rate = _safe_float(
        model_input_env if model_input_env is not None else global_input_env,
        _safe_float(defaults.get("input"), 0.0),
    )
    output_rate = _safe_float(
        model_output_env if model_output_env is not None else global_output_env,
        _safe_float(defaults.get("output"), 0.0),
    )

    if model_input_env is not None or model_output_env is not None:
        source = "env:model"
    elif global_input_env is not None or global_output_env is not None:
        source = "env:global"
    elif defaults:
        source = "default:model"
    else:
        source = "unconfigured"

    return {
        "input_rate_per_1m_usd": max(0.0, input_rate),
        "output_rate_per_1m_usd": max(0.0, output_rate),
        "pricing_source": source,
    }


def _estimate_cost_usd(model_name: str, input_tokens: int, output_tokens: int) -> Dict[str, Any]:
    pricing = _pricing_for_model(model_name)
    input_rate = pricing["input_rate_per_1m_usd"]
    output_rate = pricing["output_rate_per_1m_usd"]

    input_cost = (_safe_int(input_tokens, 0) / 1_000_000.0) * input_rate
    output_cost = (_safe_int(output_tokens, 0) / 1_000_000.0) * output_rate
    total_cost = round(input_cost + output_cost, 10)

    return {
        **pricing,
        "estimated_cost_usd": total_cost,
        "currency": "USD",
    }


def _parse_otlp_headers(value: str) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    for part in (value or "").split(","):
        item = part.strip()
        if not item or "=" not in item:
            continue
        key, val = item.split("=", 1)
        key = key.strip()
        val = val.strip()
        if key:
            headers[key] = val
    return headers


def _setup_otel_logger() -> bool:
    global _OTEL_INIT_ATTEMPTED, _OTEL_ENABLED, _OTEL_LOGGER

    if _OTEL_INIT_ATTEMPTED:
        return _OTEL_ENABLED
    _OTEL_INIT_ATTEMPTED = True

    try:
        from opentelemetry import _logs as otel_logs
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor, ConsoleLogExporter
        from opentelemetry.sdk.resources import Resource
    except Exception as e:
        print(f"[WARN] OpenTelemetry unavailable for Gemini usage logs: {e}")
        _OTEL_ENABLED = False
        return False

    try:
        provider = otel_logs.get_logger_provider()

        # If there is no SDK provider yet, create one.
        if not isinstance(provider, LoggerProvider):
            resource = Resource.create({
                "service.name": os.getenv("OTEL_SERVICE_NAME", "canvas-organizer-backend"),
                "service.version": os.getenv("OTEL_SERVICE_VERSION", "unknown"),
            })
            provider = LoggerProvider(resource=resource)

            exporter = None
            endpoint = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
            if endpoint:
                try:
                    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

                    headers = _parse_otlp_headers(os.getenv("OTEL_EXPORTER_OTLP_HEADERS", ""))
                    exporter = OTLPLogExporter(endpoint=endpoint, headers=headers or None)
                except Exception as e:
                    print(f"[WARN] OTLP log exporter init failed; falling back to console: {e}")

            if exporter is None:
                exporter = ConsoleLogExporter()

            provider.add_log_record_processor(BatchLogRecordProcessor(exporter))
            otel_logs.set_logger_provider(provider)

        _OTEL_LOGGER = otel_logs.get_logger("canvas-organizer.ai.gemini", "1.0.0")
        _OTEL_ENABLED = True
        return True
    except Exception as e:
        print(f"[WARN] Failed to initialize OpenTelemetry logger: {e}")
        _OTEL_ENABLED = False
        _OTEL_LOGGER = None
        return False


def _to_otel_attributes(payload: Dict[str, Any]) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if value is None:
            continue
        if isinstance(value, (str, bool, int, float)):
            attrs[key] = value
        else:
            attrs[key] = json.dumps(value, ensure_ascii=True, sort_keys=True)
    return attrs


def build_usage_payload(
    response: Any,
    *,
    model_name: str,
    operation: str,
    telemetry_context: Optional[Dict[str, Any]] = None,
    prompt_chars: Optional[int] = None,
) -> Dict[str, Any]:
    metrics = extract_usage_metrics(response)
    pricing = _estimate_cost_usd(model_name, metrics["input_tokens"], metrics["output_tokens"])
    context = dict(telemetry_context or {})

    payload: Dict[str, Any] = {
        "event": "vertexai.gemini.usage",
        "timestamp": _to_iso_utc_now(),
        "request_id": str(context.get("request_id") or uuid.uuid4()),
        "operation": operation,
        "model": model_name,
        "prompt_chars": _safe_int(prompt_chars, 0),
        "user_id": context.get("user_id"),
        "course_id": str(context.get("course_id")) if context.get("course_id") is not None else None,
        "is_resync": bool(context.get("is_resync")) if context.get("is_resync") is not None else None,
        # GenAI semantic conventions.
        "gen_ai.system": "vertex_ai",
        "gen_ai.request.model": model_name,
        "gen_ai.usage.input_tokens": metrics["input_tokens"],
        "gen_ai.usage.output_tokens": metrics["output_tokens"],
        "gen_ai.usage.total_tokens": metrics["total_tokens"],
        "gen_ai.usage.cached_tokens": metrics["cached_tokens"],
        # App-level keys for DB/UI.
        "input_tokens": metrics["input_tokens"],
        "output_tokens": metrics["output_tokens"],
        "total_tokens": metrics["total_tokens"],
        "cached_tokens": metrics["cached_tokens"],
        "estimated_cost_usd": pricing["estimated_cost_usd"],
        "currency": pricing["currency"],
        "pricing_source": pricing["pricing_source"],
        "input_rate_per_1m_usd": pricing["input_rate_per_1m_usd"],
        "output_rate_per_1m_usd": pricing["output_rate_per_1m_usd"],
        "status": "ok",
    }

    if context.get("iteration") is not None:
        payload["iteration"] = _safe_int(context.get("iteration"), 0)

    return payload


def mark_usage_error(payload: Dict[str, Any], error: Exception) -> Dict[str, Any]:
    result = dict(payload or {})
    result["status"] = "error"
    result["error_type"] = type(error).__name__
    result["error_message"] = str(error)[:400]
    return result


def emit_usage_log(payload: Dict[str, Any]) -> None:
    attributes = _to_otel_attributes(payload)

    if _setup_otel_logger() and _OTEL_LOGGER is not None:
        try:
            _OTEL_LOGGER.emit(
                body="vertexai.gemini.usage",
                severity_text="INFO",
                attributes=attributes,
            )
            return
        except Exception as e:
            print(f"[WARN] Failed to emit OpenTelemetry Gemini usage log: {e}")

    # Always keep a plain-text fallback for local debugging.
    print(f"[GEMINI_USAGE] {json.dumps(attributes, ensure_ascii=True, sort_keys=True)}")
