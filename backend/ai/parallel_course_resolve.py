"""
Bounded parallel AI resolve across independent course groups.

Same class-code sections (lecture + lab/recitation) stay in one group and share a
single merged LLM call. Parallelism is across groups only, never within a group.
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional, Sequence

AI_MAX_CONCURRENCY = max(1, int(os.getenv("AI_MAX_CONCURRENCY", "10")))
AI_TRANSIENT_MAX_RETRIES = max(0, int(os.getenv("AI_TRANSIENT_MAX_RETRIES", "2")))


def call_with_transient_retry(
    fn: Callable[[], Any],
    *,
    is_transient_error: Callable[[Exception], bool],
    max_retries: int = AI_TRANSIENT_MAX_RETRIES,
    label: str = "AI",
) -> Any:
    """
    Retry *transient* provider failures with exponential backoff.
    Validation/business-logic errors are not retried.
    """
    last_error: Optional[Exception] = None
    attempts = max_retries + 1
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            if attempt >= attempts or not is_transient_error(exc):
                raise
            backoff = min(8.0, 1.25 * (2 ** (attempt - 1)))
            print(
                f"[WARN] {label} transient failure (attempt {attempt}/{attempts}): {exc}. "
                f"Retrying in {backoff:.1f}s."
            )
            time.sleep(backoff)
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"{label} call failed without exception detail.")


def _normalize_group(group: Sequence[str]) -> List[str]:
    return list(dict.fromkeys(str(cid).strip() for cid in (group or []) if str(cid).strip()))


def run_parallel_group_resolve(
    groups: List[List[str]],
    worker: Callable[[List[str]], Dict[str, Any]],
    *,
    max_concurrency: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Process independent course groups with bounded parallelism.

    `worker(group_course_ids)` loads merged context for the group, calls the LLM
    once, persists results for all courses in the group, and returns stats.
    """
    normalized_groups = [_normalize_group(g) for g in (groups or [])]
    normalized_groups = [g for g in normalized_groups if g]
    if not normalized_groups:
        return []

    max_workers = max(1, int(max_concurrency or AI_MAX_CONCURRENCY))
    max_workers = min(max_workers, len(normalized_groups))

    results_by_key: Dict[str, Dict[str, Any]] = {}
    for group in normalized_groups:
        group_key = group[0]
        results_by_key[group_key] = {
            "group_id": group_key,
            "course_ids": group,
            "status": "pending",
            "courses": [{"course_id": cid, "status": "pending"} for cid in group],
        }

    lock = __import__("threading").Lock()

    def _run_one(group: List[str]) -> None:
        group_key = group[0]
        with lock:
            entry = results_by_key[group_key]
            entry["status"] = "running"
            entry["courses"] = [{"course_id": cid, "status": "running"} for cid in group]
        try:
            payload = worker(group) or {}
            course_statuses = payload.pop(
                "courses",
                [{"course_id": cid, "status": "succeeded"} for cid in group],
            )
            with lock:
                results_by_key[group_key] = {
                    "group_id": group_key,
                    "course_ids": group,
                    "status": "succeeded",
                    "courses": course_statuses,
                    **payload,
                }
        except Exception as exc:
            err = f"{type(exc).__name__}: {exc}"[:400]
            with lock:
                results_by_key[group_key] = {
                    "group_id": group_key,
                    "course_ids": group,
                    "status": "failed",
                    "error": err,
                    "courses": [{"course_id": cid, "status": "failed", "error": err} for cid in group],
                }

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(_run_one, group) for group in normalized_groups]
        for future in as_completed(futures):
            future.result()

    return [results_by_key[g[0]] for g in normalized_groups]


# Backward-compatible alias (deprecated: resolves per-course, not per-group).
run_parallel_course_resolve = run_parallel_group_resolve
