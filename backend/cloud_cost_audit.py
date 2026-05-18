"""
Cloud cost audit helpers.

This module reads BigQuery Billing Export data and returns a focused view for:
- Cloud Run spend
- Artifact Registry spend
- Time-bucketed totals ("when")
- Breakdowns by revision/service/repository/SKU ("what instance")
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any


class CostAuditConfigError(ValueError):
    """Raised when billing export configuration is missing or invalid."""


class CostAuditQueryError(RuntimeError):
    """Raised when BigQuery execution fails."""


def _env_str(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _to_iso_utc(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return str(value)


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _row_value(row: Any, key: str, default: Any = None) -> Any:
    if row is None:
        return default
    if isinstance(row, dict):
        return row.get(key, default)

    getter = getattr(row, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            try:
                return getter(key)
            except Exception:
                pass

    try:
        return row[key]
    except Exception:
        pass

    return getattr(row, key, default)


def _quoted_lower_values(values: list[str]) -> str:
    cleaned = []
    for raw in values:
        v = str(raw or "").strip().lower()
        if not v:
            continue
        cleaned.append("'" + v.replace("'", "''") + "'")
    return ", ".join(cleaned)


def _label_lookup_expr(available: set[str], column: str, keys: list[str], alias: str) -> str | None:
    if column not in available:
        return None
    keys_sql = _quoted_lower_values(keys)
    if not keys_sql:
        return None
    return (
        f"(SELECT ANY_VALUE({alias}.value) "
        f"FROM UNNEST({column}) {alias} "
        f"WHERE LOWER({alias}.key) IN ({keys_sql}))"
    )


def _coalesce_string_expr(candidates: list[str | None]) -> str:
    cleaned = [c for c in candidates if c]
    if not cleaned:
        return "NULL"
    normalized = [f"NULLIF(TRIM(CAST({expr} AS STRING)), '')" for expr in cleaned]
    if len(normalized) == 1:
        return normalized[0]
    return f"COALESCE({', '.join(normalized)})"


def _extract_schema_info(table_schema: list[Any]) -> dict[str, Any]:
    fields = {f.name: f for f in table_schema}
    names = set(fields.keys())

    def has_struct_subfield(parent: str, child: str) -> bool:
        f = fields.get(parent)
        if not f:
            return False
        return any(sf.name == child for sf in (f.fields or ()))

    def first_struct_subfield(parent: str, candidates: list[str]) -> str | None:
        for candidate in candidates:
            if has_struct_subfield(parent, candidate):
                return candidate
        return None

    info: dict[str, Any] = {
        "names": names,
        "has_project_id": has_struct_subfield("project", "id"),
        "has_service_description": has_struct_subfield("service", "description"),
        "has_sku_description": has_struct_subfield("sku", "description"),
        "has_cost": "cost" in names,
        "has_credits": "credits" in names,
        "has_usage_start_time": "usage_start_time" in names,
        "has_usage_end_time": "usage_end_time" in names,
        "has_labels": "labels" in names,
        "has_system_labels": "system_labels" in names,
        "resource_subfield": first_struct_subfield("resource", ["global_name", "name"]),
        "location_subfield": first_struct_subfield("location", ["location", "region", "zone", "country"]),
    }
    return info


def _accumulate_dimension(
    store: dict[str, dict[str, Any]],
    key: str | None,
    *,
    cost: float,
    usage_rows: int,
    first_seen: str | None,
    last_seen: str | None,
    extra: dict[str, Any] | None = None,
) -> None:
    normalized = str(key or "").strip() or "(unknown)"
    current = store.get(normalized)
    if not current:
        current = {
            "name": normalized,
            "costUsd": 0.0,
            "usageRows": 0,
            "firstSeen": first_seen,
            "lastSeen": last_seen,
        }
        if extra:
            current.update(extra)
        store[normalized] = current

    current["costUsd"] = round(_safe_float(current.get("costUsd")) + _safe_float(cost), 10)
    current["usageRows"] = _safe_int(current.get("usageRows")) + _safe_int(usage_rows)

    if first_seen and (not current.get("firstSeen") or str(first_seen) < str(current.get("firstSeen"))):
        current["firstSeen"] = first_seen
    if last_seen and (not current.get("lastSeen") or str(last_seen) > str(current.get("lastSeen"))):
        current["lastSeen"] = last_seen

    if extra:
        for k, v in extra.items():
            if current.get(k) in (None, "", "(unknown)") and v not in (None, ""):
                current[k] = v


def _sorted_dimension_rows(store: dict[str, dict[str, Any]], limit: int = 50) -> list[dict[str, Any]]:
    rows = list(store.values())
    rows.sort(key=lambda item: (_safe_float(item.get("costUsd")) * -1.0, str(item.get("name") or "")))
    return rows[: max(1, limit)]


def fetch_cloud_cost_snapshot(
    *,
    days: int = 7,
    granularity: str = "day",
    detail_limit: int = 300,
    project_filter: str | None = None,
    cloud_run_service: str | None = None,
    artifact_repository: str | None = None,
) -> dict[str, Any]:
    """
    Query Billing Export and return Cloud Run / Artifact Registry cost insights.

    Required env vars:
    - GCP_BILLING_DATASET
    - GCP_BILLING_TABLE
    Optional env vars:
    - GCP_BILLING_PROJECT_ID (defaults to GCP_PROJECT_ID)
    - GCP_BILLING_FILTER_PROJECT_ID (defaults to GCP_PROJECT_ID)
    - GCP_BILLING_BQ_LOCATION
    - GCP_CLOUD_RUN_SERVICE (default filter if query param omitted)
    - GCP_ARTIFACT_REPOSITORY or GCP_ARTIFACT_REPO (default filter)
    """
    try:
        days_int = int(days)
    except (TypeError, ValueError):
        days_int = 7
    days_int = max(1, min(days_int, 120))

    gran = str(granularity or "day").strip().lower()
    if gran not in {"hour", "day"}:
        raise CostAuditConfigError("granularity must be 'hour' or 'day'.")
    granularity_sql = "HOUR" if gran == "hour" else "DAY"

    try:
        detail_limit_int = int(detail_limit)
    except (TypeError, ValueError):
        detail_limit_int = 300
    detail_limit_int = max(10, min(detail_limit_int, 2000))

    billing_project_id = _env_str("GCP_BILLING_PROJECT_ID") or _env_str("GCP_PROJECT_ID")
    dataset = _env_str("GCP_BILLING_DATASET")
    table = _env_str("GCP_BILLING_TABLE")
    bq_location = _env_str("GCP_BILLING_BQ_LOCATION")

    if not billing_project_id:
        raise CostAuditConfigError("Missing GCP_BILLING_PROJECT_ID (or fallback GCP_PROJECT_ID).")
    if not dataset or not table:
        raise CostAuditConfigError(
            "Missing billing export table config. Set GCP_BILLING_DATASET and GCP_BILLING_TABLE."
        )
    if "*" in table:
        raise CostAuditConfigError(
            "GCP_BILLING_TABLE must be a concrete table name (wildcards are not supported here)."
        )

    effective_project_filter = _clean_optional(project_filter)
    if not effective_project_filter:
        effective_project_filter = _clean_optional(_env_str("GCP_BILLING_FILTER_PROJECT_ID") or _env_str("GCP_PROJECT_ID"))

    effective_cloud_run_service = _clean_optional(cloud_run_service) or _clean_optional(_env_str("GCP_CLOUD_RUN_SERVICE"))
    effective_artifact_repo = _clean_optional(artifact_repository) or _clean_optional(
        _env_str("GCP_ARTIFACT_REPOSITORY") or _env_str("GCP_ARTIFACT_REPO")
    )

    table_id = f"{billing_project_id}.{dataset}.{table}"
    table_id_quoted = f"`{table_id}`"

    try:
        # Lazy import: keep cold starts for normal endpoints low.
        from google.cloud import bigquery  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise CostAuditConfigError(
            "google-cloud-bigquery is not available. Add it to backend dependencies."
        ) from exc

    client = bigquery.Client(project=billing_project_id)

    try:
        table_obj = client.get_table(table_id)
    except Exception as exc:
        raise CostAuditConfigError(f"Cannot access billing export table '{table_id}': {exc}") from exc

    schema_info = _extract_schema_info(table_obj.schema)
    available = schema_info["names"]

    if not schema_info["has_usage_start_time"]:
        raise CostAuditConfigError("Billing export table is missing usage_start_time.")
    if not schema_info["has_cost"]:
        raise CostAuditConfigError("Billing export table is missing cost.")

    project_id_expr = "project.id" if schema_info["has_project_id"] else "NULL"
    service_desc_expr = "service.description" if schema_info["has_service_description"] else "NULL"
    sku_desc_expr = "sku.description" if schema_info["has_sku_description"] else "NULL"
    usage_end_expr = "usage_end_time" if schema_info["has_usage_end_time"] else "usage_start_time"
    cost_expr = (
        "(CAST(cost AS FLOAT64) + COALESCE((SELECT SUM(CAST(c.amount AS FLOAT64)) FROM UNNEST(credits) c), 0.0))"
        if schema_info["has_credits"]
        else "CAST(cost AS FLOAT64)"
    )

    resource_name_source = None
    if schema_info["resource_subfield"]:
        resource_name_source = f"resource.{schema_info['resource_subfield']}"
    resource_name_expr = _coalesce_string_expr([resource_name_source])

    labels_service_name = _label_lookup_expr(
        available,
        "labels",
        ["service_name", "run.googleapis.com/service_name", "goog-run-service-name"],
        "l_srv",
    )
    system_service_name = _label_lookup_expr(
        available,
        "system_labels",
        ["service_name", "run.googleapis.com/service_name", "goog-run-service-name"],
        "sl_srv",
    )
    labels_revision_name = _label_lookup_expr(
        available,
        "labels",
        ["revision_name", "run.googleapis.com/revision_name", "goog-run-revision-name"],
        "l_rev",
    )
    system_revision_name = _label_lookup_expr(
        available,
        "system_labels",
        ["revision_name", "run.googleapis.com/revision_name", "goog-run-revision-name"],
        "sl_rev",
    )
    labels_repository = _label_lookup_expr(
        available,
        "labels",
        ["repository", "repository_name", "artifactregistry.googleapis.com/repository"],
        "l_repo",
    )
    system_repository = _label_lookup_expr(
        available,
        "system_labels",
        ["repository", "repository_name", "artifactregistry.googleapis.com/repository"],
        "sl_repo",
    )
    labels_location = _label_lookup_expr(
        available,
        "labels",
        ["location", "cloud.googleapis.com/location", "region", "zone"],
        "l_loc",
    )
    system_location = _label_lookup_expr(
        available,
        "system_labels",
        ["location", "cloud.googleapis.com/location", "region", "zone"],
        "sl_loc",
    )

    location_struct_expr = None
    if schema_info["location_subfield"]:
        location_struct_expr = f"location.{schema_info['location_subfield']}"

    resource_service_expr = None
    resource_revision_expr = None
    resource_repository_expr = None
    if resource_name_source:
        resource_service_expr = f"REGEXP_EXTRACT(CAST({resource_name_source} AS STRING), r'/services/([^/]+)')"
        resource_revision_expr = f"REGEXP_EXTRACT(CAST({resource_name_source} AS STRING), r'/revisions/([^/]+)')"
        resource_repository_expr = f"REGEXP_EXTRACT(CAST({resource_name_source} AS STRING), r'/repositories/([^/]+)')"

    run_service_expr = _coalesce_string_expr([labels_service_name, system_service_name, resource_service_expr])
    run_revision_expr = _coalesce_string_expr([labels_revision_name, system_revision_name, resource_revision_expr])
    artifact_repo_expr = _coalesce_string_expr([labels_repository, system_repository, resource_repository_expr])
    location_expr = _coalesce_string_expr([location_struct_expr, labels_location, system_location])

    service_kind_expr = (
        "CASE "
        f"WHEN LOWER(COALESCE(CAST({service_desc_expr} AS STRING), '')) LIKE '%cloud run%' THEN 'cloud_run' "
        f"WHEN LOWER(COALESCE(CAST({service_desc_expr} AS STRING), '')) LIKE '%artifact registry%' THEN 'artifact_registry' "
        f"WHEN LOWER(COALESCE(CAST({sku_desc_expr} AS STRING), '')) LIKE '%artifact registry%' THEN 'artifact_registry' "
        "ELSE 'other' END"
    )

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=days_int)

    query = f"""
WITH base AS (
  SELECT
    usage_start_time,
    {usage_end_expr} AS usage_end_time,
    {project_id_expr} AS project_id,
    {service_kind_expr} AS service_kind,
    {service_desc_expr} AS service_description,
    {sku_desc_expr} AS sku_description,
    {cost_expr} AS net_cost_usd,
    {run_service_expr} AS run_service_name,
    {run_revision_expr} AS run_revision_name,
    {artifact_repo_expr} AS artifact_repository,
    {location_expr} AS location_label,
    {resource_name_expr} AS resource_name
  FROM {table_id_quoted}
  WHERE usage_start_time >= @start_time
    AND usage_start_time < @end_time
),
filtered AS (
  SELECT *
  FROM base
  WHERE (@project_filter IS NULL OR project_id = @project_filter)
    AND (
      @cloud_run_service IS NULL
      OR service_kind != 'cloud_run'
      OR LOWER(run_service_name) = LOWER(@cloud_run_service)
    )
    AND (
      @artifact_repository IS NULL
      OR service_kind != 'artifact_registry'
      OR LOWER(artifact_repository) = LOWER(@artifact_repository)
    )
)
SELECT
  SUM(net_cost_usd) AS total_cost_usd,
  SUM(IF(service_kind = 'cloud_run', net_cost_usd, 0)) AS cloud_run_cost_usd,
  SUM(IF(service_kind = 'artifact_registry', net_cost_usd, 0)) AS artifact_registry_cost_usd,
  ARRAY(
    SELECT AS STRUCT
      TIMESTAMP_TRUNC(usage_start_time, {granularity_sql}) AS bucket_start,
      service_kind,
      SUM(net_cost_usd) AS cost_usd
    FROM filtered
    GROUP BY bucket_start, service_kind
    ORDER BY bucket_start ASC, service_kind
  ) AS series_rows,
  ARRAY(
    SELECT AS STRUCT
      service_kind,
      service_description,
      sku_description,
      run_service_name,
      run_revision_name,
      artifact_repository,
      location_label,
      resource_name,
      SUM(net_cost_usd) AS cost_usd,
      COUNT(1) AS usage_rows,
      MIN(usage_start_time) AS first_seen,
      MAX(usage_end_time) AS last_seen
    FROM filtered
    WHERE service_kind IN ('cloud_run', 'artifact_registry')
    GROUP BY
      service_kind,
      service_description,
      sku_description,
      run_service_name,
      run_revision_name,
      artifact_repository,
      location_label,
      resource_name
    ORDER BY cost_usd DESC
    LIMIT @detail_limit
  ) AS detail_rows
FROM filtered
"""

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("start_time", "TIMESTAMP", start_time),
            bigquery.ScalarQueryParameter("end_time", "TIMESTAMP", end_time),
            bigquery.ScalarQueryParameter("project_filter", "STRING", effective_project_filter),
            bigquery.ScalarQueryParameter("cloud_run_service", "STRING", effective_cloud_run_service),
            bigquery.ScalarQueryParameter("artifact_repository", "STRING", effective_artifact_repo),
            bigquery.ScalarQueryParameter("detail_limit", "INT64", detail_limit_int),
        ]
    )

    try:
        query_job = client.query(query, job_config=job_config, location=bq_location or None)
        result_rows = list(query_job.result())
    except Exception as exc:
        raise CostAuditQueryError(f"BigQuery billing query failed: {exc}") from exc

    if not result_rows:
        result_row: Any = {}
    else:
        result_row = result_rows[0]

    total_cost_usd = round(_safe_float(_row_value(result_row, "total_cost_usd")), 10)
    cloud_run_cost_usd = round(_safe_float(_row_value(result_row, "cloud_run_cost_usd")), 10)
    artifact_registry_cost_usd = round(_safe_float(_row_value(result_row, "artifact_registry_cost_usd")), 10)
    other_cost_usd = round(total_cost_usd - cloud_run_cost_usd - artifact_registry_cost_usd, 10)

    series_rows = list(_row_value(result_row, "series_rows", []) or [])
    series_by_bucket: dict[str, dict[str, Any]] = {}
    for item in series_rows:
        bucket_iso = _to_iso_utc(_row_value(item, "bucket_start"))
        if not bucket_iso:
            continue
        entry = series_by_bucket.get(bucket_iso)
        if not entry:
            entry = {
                "bucketStart": bucket_iso,
                "cloudRunUsd": 0.0,
                "artifactRegistryUsd": 0.0,
                "otherUsd": 0.0,
                "totalUsd": 0.0,
            }
            series_by_bucket[bucket_iso] = entry

        kind = str(_row_value(item, "service_kind") or "other").strip()
        value = round(_safe_float(_row_value(item, "cost_usd")), 10)
        if kind == "cloud_run":
            entry["cloudRunUsd"] = round(_safe_float(entry["cloudRunUsd"]) + value, 10)
        elif kind == "artifact_registry":
            entry["artifactRegistryUsd"] = round(_safe_float(entry["artifactRegistryUsd"]) + value, 10)
        else:
            entry["otherUsd"] = round(_safe_float(entry["otherUsd"]) + value, 10)
        entry["totalUsd"] = round(
            _safe_float(entry["cloudRunUsd"]) + _safe_float(entry["artifactRegistryUsd"]) + _safe_float(entry["otherUsd"]),
            10,
        )

    series = [series_by_bucket[key] for key in sorted(series_by_bucket.keys())]

    detail_rows = list(_row_value(result_row, "detail_rows", []) or [])
    details: list[dict[str, Any]] = []

    cloud_by_sku: dict[str, dict[str, Any]] = {}
    cloud_by_service: dict[str, dict[str, Any]] = {}
    cloud_by_revision: dict[str, dict[str, Any]] = {}
    cloud_by_location: dict[str, dict[str, Any]] = {}
    cloud_by_resource: dict[str, dict[str, Any]] = {}

    artifact_by_sku: dict[str, dict[str, Any]] = {}
    artifact_by_repo: dict[str, dict[str, Any]] = {}
    artifact_by_location: dict[str, dict[str, Any]] = {}
    artifact_by_resource: dict[str, dict[str, Any]] = {}

    for item in detail_rows:
        kind = str(_row_value(item, "service_kind") or "").strip()
        cost = round(_safe_float(_row_value(item, "cost_usd")), 10)
        usage_rows = _safe_int(_row_value(item, "usage_rows"))
        first_seen = _to_iso_utc(_row_value(item, "first_seen"))
        last_seen = _to_iso_utc(_row_value(item, "last_seen"))

        sku = str(_row_value(item, "sku_description") or "").strip() or "(unknown)"
        run_service = str(_row_value(item, "run_service_name") or "").strip() or "(unknown)"
        run_revision = str(_row_value(item, "run_revision_name") or "").strip() or "(unknown)"
        artifact_repo = str(_row_value(item, "artifact_repository") or "").strip() or "(unknown)"
        location = str(_row_value(item, "location_label") or "").strip() or "(unknown)"
        resource_name = str(_row_value(item, "resource_name") or "").strip() or "(unknown)"

        detail_item = {
            "serviceKind": kind or "other",
            "serviceDescription": str(_row_value(item, "service_description") or "") or "(unknown)",
            "skuDescription": sku,
            "runService": run_service,
            "runRevision": run_revision,
            "artifactRepository": artifact_repo,
            "location": location,
            "resourceName": resource_name,
            "costUsd": cost,
            "usageRows": usage_rows,
            "firstSeen": first_seen,
            "lastSeen": last_seen,
        }
        details.append(detail_item)

        if kind == "cloud_run":
            _accumulate_dimension(cloud_by_sku, sku, cost=cost, usage_rows=usage_rows, first_seen=first_seen, last_seen=last_seen)
            _accumulate_dimension(
                cloud_by_service,
                run_service,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )

            revision_key = f"{run_service}::{run_revision}"
            _accumulate_dimension(
                cloud_by_revision,
                revision_key,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
                extra={"runService": run_service, "runRevision": run_revision},
            )

            _accumulate_dimension(
                cloud_by_location,
                location,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )
            _accumulate_dimension(
                cloud_by_resource,
                resource_name,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )

        elif kind == "artifact_registry":
            _accumulate_dimension(
                artifact_by_sku,
                sku,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )
            _accumulate_dimension(
                artifact_by_repo,
                artifact_repo,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )
            _accumulate_dimension(
                artifact_by_location,
                location,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )
            _accumulate_dimension(
                artifact_by_resource,
                resource_name,
                cost=cost,
                usage_rows=usage_rows,
                first_seen=first_seen,
                last_seen=last_seen,
            )

    details.sort(key=lambda item: (_safe_float(item.get("costUsd")) * -1.0, str(item.get("serviceKind") or "")))

    return {
        "window": {
            "days": days_int,
            "granularity": gran,
            "start": _to_iso_utc(start_time),
            "end": _to_iso_utc(end_time),
        },
        "filters": {
            "projectId": effective_project_filter,
            "cloudRunService": effective_cloud_run_service,
            "artifactRepository": effective_artifact_repo,
        },
        "totals": {
            "overallUsd": total_cost_usd,
            "cloudRunUsd": cloud_run_cost_usd,
            "artifactRegistryUsd": artifact_registry_cost_usd,
            "otherUsd": other_cost_usd,
        },
        "series": series,
        "cloudRun": {
            "totalUsd": cloud_run_cost_usd,
            "bySku": _sorted_dimension_rows(cloud_by_sku),
            "byService": _sorted_dimension_rows(cloud_by_service),
            "byRevision": _sorted_dimension_rows(cloud_by_revision),
            "byLocation": _sorted_dimension_rows(cloud_by_location),
            "byResource": _sorted_dimension_rows(cloud_by_resource),
        },
        "artifactRegistry": {
            "totalUsd": artifact_registry_cost_usd,
            "bySku": _sorted_dimension_rows(artifact_by_sku),
            "byRepository": _sorted_dimension_rows(artifact_by_repo),
            "byLocation": _sorted_dimension_rows(artifact_by_location),
            "byResource": _sorted_dimension_rows(artifact_by_resource),
        },
        "details": details[:detail_limit_int],
        "meta": {
            "billingProjectId": billing_project_id,
            "billingTable": table_id,
            "bigQueryLocation": bq_location or None,
            "bytesProcessed": _safe_int(getattr(query_job, "total_bytes_processed", 0)),
            "bytesBilled": _safe_int(getattr(query_job, "total_bytes_billed", 0)),
            "slotMillis": _safe_int(getattr(query_job, "slot_millis", 0)),
            "generatedAt": _to_iso_utc(datetime.now(timezone.utc)),
        },
    }
