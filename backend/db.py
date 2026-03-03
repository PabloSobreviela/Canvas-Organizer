import os
import sqlite3

DB_PATH = os.path.join("data", "app.db")


def get_db():
    # Ensure the data directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    conn = sqlite3.connect(
        DB_PATH,
        timeout=30,
        check_same_thread=False
    )
    conn.row_factory = sqlite3.Row

    # ✅ Concurrency-friendly settings
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=30000;")

    return conn


# Allowlist of tables that may be migrated via ensure_column (prevents SQL injection).
_ALLOWED_ALTER_TABLES = frozenset({"assignments_normalized", "course_file_text"})
# Allowlist of column definitions to prevent SQL injection via column_def.
_ALLOWED_COLUMN_DEFS = frozenset({
    "category TEXT DEFAULT 'ASSIGNMENT'",
    "deliverable INTEGER DEFAULT 1",
    "is_previous INTEGER DEFAULT 0",
    "archived_at TEXT",
})


def ensure_column(conn: sqlite3.Connection, table: str, column_def: str):
    """
    Safely adds a column if it doesn't already exist.
    Both table and column_def must be in allowlists to prevent SQL injection.
    """
    if table not in _ALLOWED_ALTER_TABLES:
        raise ValueError(f"Table '{table}' is not in the allowlist for ensure_column.")
    if column_def not in _ALLOWED_COLUMN_DEFS:
        raise ValueError(f"Column def '{column_def}' is not in the allowlist for ensure_column.")
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_def};")
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        # SQLite throws "duplicate column name: X" if it already exists
        if "duplicate column name" in msg:
            return
        raise


def init_db():
    # Ensure the data directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    conn = sqlite3.connect(
        DB_PATH,
        timeout=30,
        check_same_thread=False
    )
    conn.row_factory = sqlite3.Row

    # ✅ Force WAL + timeout at DB creation time too
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=30000;")

    cur = conn.cursor()

    # Table for AI-extracted syllabus rules
    cur.execute("""
        CREATE TABLE IF NOT EXISTS syllabus_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_name TEXT NOT NULL,
            rules_json TEXT NOT NULL
        );
    """)
    # ✅ NEW: Store AI-extracted course codes (e.g. "CS 1331")
    cur.execute("""
            CREATE TABLE IF NOT EXISTS course_metadata (
                course_id TEXT PRIMARY KEY,
                course_code TEXT,
                updated_at TEXT
            );
        """)

    # 🌟 Normalized assignments (deliverables)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS assignments_normalized (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            canvas_assignment_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            original_due_at TEXT,
            normalized_due_at TEXT,
            source_of_truth TEXT DEFAULT 'Canvas',
            confidence REAL,
            status TEXT,
            raw_canvas_json TEXT,
            created_at TEXT,
            updated_at TEXT
        );
    """)

    # ✅ Add these columns if missing (migration-safe)
    ensure_column(conn, "assignments_normalized", "category TEXT DEFAULT 'ASSIGNMENT'")
    ensure_column(conn, "assignments_normalized", "deliverable INTEGER DEFAULT 1")

    # -----------------------------
    # Canvas announcements
    # -----------------------------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS canvas_announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canvas_announcement_id INTEGER UNIQUE,
            course_id TEXT NOT NULL,
            title TEXT,
            message TEXT,
            posted_at TEXT,
            raw_json TEXT
        );
    """)

    # -----------------------------
    # Extracted course file text
    # -----------------------------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS course_file_text (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            canvas_file_id INTEGER,
            file_type TEXT,
            file_name TEXT,
            storage_path TEXT,
            extracted_text TEXT,
            created_at TEXT
        );
    """)

    # ✅ Local resync support (versioned/archived schedule files)
    ensure_column(conn, "course_file_text", "is_previous INTEGER DEFAULT 0")
    ensure_column(conn, "course_file_text", "archived_at TEXT")

    # -----------------------------
    # Reading / study items (non-deliverable)
    # -----------------------------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS reading_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            name TEXT NOT NULL,
            details TEXT,
            due_at TEXT,              -- ISO string with timezone if available
            source_of_truth TEXT,     -- "Schedule" / "Syllabus" / "Announcement"
            confidence REAL,
            evidence TEXT,            -- short quote / proof
            created_at TEXT NOT NULL
        );
    """)

    # Change the index to ONLY enforce uniqueness on actual Canvas IDs
    cur.execute("DROP INDEX IF EXISTS idx_assignments_course_canvas;")
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_course_canvas
        ON assignments_normalized (course_id, canvas_assignment_id)
        WHERE canvas_assignment_id IS NOT NULL; 
    """)

    # -----------------------------
    # Assignment audit log
    # -----------------------------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS assignment_change_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            canvas_assignment_id INTEGER NOT NULL,
            old_original_due_at TEXT,
            old_normalized_due_at TEXT,
            new_normalized_due_at TEXT,
            old_source_of_truth TEXT,
            new_source_of_truth TEXT,
            old_confidence REAL,
            new_confidence REAL,
            reason TEXT,
            created_at TEXT NOT NULL
        );
    """)

    # -----------------------------
    # AI usage logs (Gemini tokens + estimated cost)
    # -----------------------------
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            course_id TEXT,
            request_id TEXT,
            operation TEXT,
            model TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            cached_tokens INTEGER DEFAULT 0,
            estimated_cost_usd REAL DEFAULT 0,
            currency TEXT DEFAULT 'USD',
            pricing_source TEXT,
            status TEXT DEFAULT 'ok',
            prompt_chars INTEGER DEFAULT 0,
            is_resync INTEGER,
            raw_json TEXT,
            created_at TEXT NOT NULL
        );
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_created
        ON ai_usage_logs (user_id, created_at DESC);
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_course_created
        ON ai_usage_logs (course_id, created_at DESC);
    """)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print("Database initialized at", DB_PATH)
