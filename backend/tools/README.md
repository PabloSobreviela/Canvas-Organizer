# Developer tools (NOT part of the deployed image)

These are local developer/maintenance scripts. They are intentionally **excluded
from the production Docker image** (see `backend/Dockerfile`).

Several of these are **destructive** (they delete or reset data). Never run them
against a production Supabase project. Most expect `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` (or local SQLite) in the environment.

| Script | Purpose | Destructive |
| --- | --- | --- |
| `check_schema.py` | Inspect the live DB schema | No |
| `download_canvas_files.py` | Ad-hoc Canvas file download | No |
| `debug_dates.py`, `debug_files.py` | Local debugging helpers | No |
| `last_good.py`, `testa.py`, `ts_scrapping.py` | Scratch/experimental | No |
| `reset_db.py` | Reset the database | YES |
| `wipe_all_tables.py` | Delete all rows in all tables | YES |
| `wipe_course_file_text.py` | Delete extracted file text | YES |
| `purge.py`, `run_cleanup.py` | Cleanup utilities | YES |

For production data lifecycle use the supported paths instead:
`backend/retention_service.py`, the `/api/user/delete-data` endpoint, and the
procedures in `docs/OPS_RUNBOOK.md`.
