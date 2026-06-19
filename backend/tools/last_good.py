import os
import json
import requests
import time
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from urllib.parse import unquote
from pathlib import Path
import openpyxl

from parsers.syllabus_text import extract_text_from_file
from ai.gemini_model import resolve_assignment_dates_with_gemini
from db import get_db, init_db

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

import re

STORAGE_ROOT = os.path.join("data", "storage")
SCHEDULE_KEYWORDS = ['syllabus', 'schedule', 'calendar']
FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls']

# -----------------------------
# APP SETUP
# -----------------------------
app = Flask(__name__)
CORS(app)
os.makedirs(STORAGE_ROOT, exist_ok=True)
init_db()


# -----------------------------
# HELPERS
# -----------------------------
def force_assignment_if_deliverable_keywords(name: str, desc: str):
    """
    Hard override:
    Anything mentioning WeBWorK / Gradescope / Homework is an ASSIGNMENT.
    """
    t = f"{name or ''} {desc or ''}".lower()

    # strong signals
    if "webwork" in t or "gradescope" in t:
        return True

    # "homework" or "hw" as a whole word
    if re.search(r"\bhomework\b", t) or re.search(r"\bhw\b", t):
        return True

    return False

def extract_text_from_xlsx(filepath: str, max_chars: int = 20000) -> str:
    """
    Minimal XLSX -> text extraction.
    Reads all sheets, outputs non-empty rows.
    """
    wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    out = []
    try:
        for ws in wb.worksheets:
            out.append(f"## Sheet: {ws.title}")
            for row in ws.iter_rows(values_only=True):
                if not row:
                    continue
                vals = []
                for v in row:
                    if v is None:
                        continue
                    s = str(v).strip()
                    if s:
                        vals.append(s)
                if vals:
                    out.append("\t".join(vals))

                if sum(len(x) for x in out) > max_chars:
                    out.append("â€¦")
                    return "\n".join(out)[:max_chars]
        return "\n".join(out).strip()
    finally:
        wb.close()


def extract_text_safely(filepath: str) -> str:
    """
    Uses your existing extract_text_from_file() for most types,
    but adds XLSX support.
    """
    ext = Path(filepath).suffix.lower()
    if ext in {".xlsx", ".xlsm", ".xltx", ".xltm", ".xls"}:
        return extract_text_from_xlsx(filepath)
    return extract_text_from_file(filepath)


def infer_category_from_canvas_assignment(canvas_json):
    name = (canvas_json.get("name") or "").strip().lower()
    submission_types = canvas_json.get("submission_types") or []
    points = canvas_json.get("points_possible")

    if name.startswith("reading:") or name.startswith("reading "):
        return "READING", 0

    if submission_types == ["none"] and (points is None or points == 0):
        return "READING", 0

    return "ASSIGNMENT", 1


def infer_category_from_discovered_item(name: str, description: str = ""):
    n = (name or "").strip().lower()
    d = (description or "").strip().lower()

    reading_prefixes = ("reading:", "reading ", "read ", "watch ", "view ", "listen ")
    if n.startswith(reading_prefixes):
        return "READING", 0

    reading_keywords = [
        "chapter", "chapters", "section", "sections", "textbook", "notes",
        "slides", "lecture notes", "reading assignment", "pp.", "pages",
        "problem sections", "skim", "review"
    ]
    if any(k in n for k in reading_keywords) or any(k in d for k in reading_keywords):
        return "READING", 0

    deliverable_keywords = [
        "homework", "hw", "problem set", "pset", "assignment", "quiz",
        "exam", "midterm", "final", "project", "lab", "worksheet",
        "submit", "submission", "due"
    ]
    if any(k in n for k in deliverable_keywords) or any(k in d for k in deliverable_keywords):
        return "ASSIGNMENT", 1

    return "ASSIGNMENT", 1


def canvas_headers(token):
    return {"Authorization": f"Bearer {token}"}


def is_schedule_file(filename):
    if not filename:
        return False
    lower = filename.lower()
    return any(keyword in lower for keyword in SCHEDULE_KEYWORDS)


def is_file_url(url):
    if not url:
        return False
    lower = url.lower()
    return any(ext in lower for ext in FILE_EXTENSIONS)


def make_course_storage_dir(course_id):
    base = os.path.join(STORAGE_ROOT, f"course_{course_id}")
    schedule_dir = os.path.join(base, "schedules")
    os.makedirs(schedule_dir, exist_ok=True)
    return base, schedule_dir


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def get_canvas_download_url(base_url: str, headers: dict, file_id: int) -> str:
    """
    Canvas file objects often provide API URLs (metadata), NOT direct bytes.
    This produces a reliable download URL for the actual file bytes.
    """
    # Best-effort: ask Canvas for the file object; sometimes it includes a direct download_url.
    try:
        meta = requests.get(
            f"{base_url.rstrip('/')}/api/v1/files/{file_id}",
            headers=headers,
            allow_redirects=True,
            timeout=20
        )
        if meta.status_code == 200:
            data = meta.json()

            # Canvas commonly uses download_url; sometimes url may already be a /download endpoint.
            for key in ("download_url", "url"):
                u = data.get(key)
                if isinstance(u, str) and u.strip():
                    # If it already looks like a real download endpoint, use it.
                    if "/download" in u:
                        return u
    except Exception:
        pass

    # Fallback that works on most Canvas instances:
    # This is the *web* download endpoint (real bytes), not the API metadata endpoint.
    return f"{base_url.rstrip('/')}/files/{file_id}/download?download_frd=1"


def extract_links_from_html(html, base_url):
    """
    Extract schedule-related file links AND external Google Sheets/Docs from Canvas pages.
    """
    links = []
    if not html or not HAS_BS4:
        return links

    soup = BeautifulSoup(html, "html.parser")

    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        text = (a.get_text(strip=True) or "").strip()

        if not href:
            continue

        # Check if this is a Google Docs/Sheets link
        is_google_doc = "docs.google.com" in href.lower()
        is_google_sheet = "sheets.google.com" in href.lower() or "/spreadsheets/" in href.lower()

        # Check if it's a Canvas file
        is_canvas_file = False
        file_id = None

        if href.startswith("/"):
            href = base_url.rstrip("/") + href

        href_lower = href.lower()

        m = re.search(r"/files/(\d+)", href_lower)
        if m:
            file_id = int(m.group(1))
            # convert preview/link -> real download bytes URL
            href = f"{base_url.rstrip('/')}/files/{file_id}/download?download_frd=1"
            is_canvas_file = True
        elif is_file_url(href):
            is_canvas_file = True

        # Include if it's a Canvas file OR a Google Doc/Sheet
        if not (is_canvas_file or is_google_doc or is_google_sheet):
            continue

        fallback_name = unquote(href.split("?")[0].split("/")[-1]) if href else "Untitled"
        display_name = text or fallback_name

        display_lower = display_name.lower()
        url_lower = href.lower()

        # Match schedule keywords OR Google Docs/Sheets
        matches = (
                any(kw in display_lower for kw in SCHEDULE_KEYWORDS) or
                any(kw in url_lower for kw in SCHEDULE_KEYWORDS) or
                is_google_doc or is_google_sheet
        )

        if not matches:
            continue

        links.append({
            "url": href,
            "text": display_name,
            "filename": fallback_name,
            "file_id": file_id,
            "is_file": is_canvas_file,
            "is_google_sheet": is_google_sheet,
            "is_google_doc": is_google_doc
        })

    return links


def fetch_google_sheet_as_text(url: str) -> str:
    """
    Fetch a Google Sheet and convert to text.
    Uses the export URL to get it as CSV, then converts to readable text.
    """
    try:
        # Extract the sheet ID from various Google Sheets URL formats
        # Format 1: https://docs.google.com/spreadsheets/d/{ID}/edit
        # Format 2: https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
        if not match:
            print(f"   ⚠️  Could not extract sheet ID from URL: {url}")
            return ""

        sheet_id = match.group(1)

        # Use the export URL to download as CSV (this works for public sheets)
        export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"

        response = requests.get(export_url, timeout=30)

        if response.status_code != 200:
            print(f"   ⚠️  Failed to fetch Google Sheet (status {response.status_code})")
            print(f"      The sheet might be private or require authentication")
            return ""

        # Convert CSV to readable text
        import csv
        from io import StringIO

        csv_content = response.text
        reader = csv.reader(StringIO(csv_content))

        lines = []
        for row in reader:
            # Filter out empty cells
            cells = [cell.strip() for cell in row if cell.strip()]
            if cells:
                lines.append(" | ".join(cells))

        text = "\n".join(lines)
        return text

    except Exception as e:
        print(f"   ❌ Error fetching Google Sheet: {e}")
        return ""


def html_to_text(html):
    if not html:
        return ""
    if HAS_BS4:
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n", strip=True)
    text = re.sub(r"<[^>]+>", " ", html)
    return " ".join(text.split())


# -----------------------------
# ðŸŒŸ UNIFIED COURSE MATERIALS SYNC
# -----------------------------
@app.route("/api/sync_course_materials", methods=["POST"])
def sync_course_materials():
    payload = request.json
    base_url = payload["base_url"]
    token = payload["token"]
    course_id = str(payload["course_id"])

    headers = canvas_headers(token)
    course_base, schedule_dir = make_course_storage_dir(course_id)

    extracted_materials = []
    files_to_download = []

    print(f"\n{'=' * 60}")
    print(f"ðŸš€ SYNCING COURSE MATERIALS: {course_id}")
    print(f"{'=' * 60}\n")

    # ============================================
    # STEP 1: Fetch Front Page
    # ============================================
    print("ðŸ“„ [1/6] Fetching Front Page...")
    try:
        front_page_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/front_page",
            headers=headers
        )

        if front_page_response.status_code == 200:
            page_data = front_page_response.json()
            body_html = page_data.get("body") or ""
            title = page_data.get("title") or "Front Page"

            if body_html:
                text = html_to_text(body_html)
                if text and len(text.strip()) > 50:
                    extracted_materials.append({
                        "source_type": "canvas_page",
                        "name": f"Canvas Page: {title}",
                        "text": text,
                        "metadata": {"page_id": page_data.get("page_id"), "source": "front_page"}
                    })
                    print(f"   âœ“ Extracted front page: {title} ({len(text)} chars)")

                links = extract_links_from_html(body_html, base_url)
                for link in links:
                    if link['is_file']:
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "front_page_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })
                        print(f"   ðŸ”— Found file link: {link['text']}")
        else:
            print(f"   âš  Front page not available (status {front_page_response.status_code})")
    except Exception as e:
        print(f"   âŒ Error fetching front page: {e}")

    # ============================================
    # STEP 2: Fetch Syllabus Body
    # ============================================
    # STEP 2: Fetch Syllabus Body
    print("\n📋 [2/6] Fetching Syllabus from Course...")
    try:
        syllabus_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}",
            headers=headers,
            params={"include[]": "syllabus_body"}
        )

        if syllabus_response.status_code == 200:
            course_data = syllabus_response.json()
            syllabus_html = course_data.get("syllabus_body") or ""

            if syllabus_html:
                # Extract links BEFORE converting to text
                links = extract_links_from_html(syllabus_html, base_url)
                for link in links:
                    if link.get('is_google_sheet') or link.get('is_google_doc'):
                        print(f"   📊 Found Google Sheet link: {link['text']}")
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "syllabus_google_link",
                            "file_id": f"google_{abs(hash(link['url']))}",
                            "is_google_sheet": link.get('is_google_sheet', False),
                            "is_google_doc": link.get('is_google_doc', False)
                        })
                    elif link['is_file']:
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "syllabus_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })
                        print(f"   📗 Found file link: {link['text']}")

                # Now convert to text for storage
                text = html_to_text(syllabus_html)
                if text and len(text.strip()) > 50:
                    extracted_materials.append({
                        "source_type": "canvas_page",
                        "name": "Canvas Page: Syllabus",
                        "text": text,
                        "metadata": {"source": "syllabus_body"}
                    })
                    print(f"   ✓ Extracted syllabus body ({len(text)} chars)")
                for link in links:
                    if link['is_file']:
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "syllabus_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })
                        print(f"   ðŸ”— Found file link: {link['text']}")
            else:
                print("   âš  No syllabus body found")
        else:
            print(f"   âš  Syllabus fetch failed (status {syllabus_response.status_code})")
    except Exception as e:
        print(f"   âŒ Error fetching syllabus: {e}")

    # ============================================
    # STEP 3: List Files from Files Section
    # ============================================
    print("\nðŸ“ [3/6] Listing files from Files section...")
    try:
        files_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/files",
            headers=headers,
            params={"per_page": 100}
        )

        if files_response.status_code == 200:
            all_files = files_response.json()
            schedule_files = [f for f in all_files if is_schedule_file(f.get("display_name") or f.get("filename"))]

            print(f"   âœ“ Found {len(schedule_files)} schedule files out of {len(all_files)} total")

            for f in schedule_files:
                fid = f.get("id")
                display = f.get("display_name") or f.get("filename") or f"file_{fid}"
                if not fid:
                    continue

                # Avoid duplicates from page links
                if not any(str(x.get("file_id")) == str(fid) for x in files_to_download):
                    files_to_download.append({
                        "file_id": int(fid),
                        "display_name": display,
                        "url": None,  # we'll compute a real download URL in step 5
                        "source": "files_section"
                    })
        elif files_response.status_code == 403:
            print("   âš  Files section forbidden (403) - may be disabled for this course")
        else:
            print(f"   âš  Files fetch failed: {files_response.status_code}")
    except Exception as e:
        print(f"   âŒ Error listing files: {e}")

    # ============================================
    # STEP 4: List Files from Modules
    # ============================================
    print("\nðŸ“š [4/6] Listing files from Modules...")
    try:
        modules_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/modules",
            headers=headers,
            params={"include[]": "items", "per_page": 100}
        )

        if modules_response.status_code == 200:
            modules = modules_response.json()
            module_file_count = 0
            module_page_count = 0

            print(f"   â†’ Found {len(modules)} modules to scan")

            for module in modules:
                module_name = module.get("name", "Unnamed Module")
                items = module.get("items", [])

                print(f"   â†’ Scanning module: {module_name} ({len(items)} items)")

                for item in items:
                    item_type = item.get("type")
                    title = item.get("title", "Untitled")

                    print(f"      â€¢ {item_type}: {title}")

                    if item_type == "File":
                        file_id = item.get("content_id")
                        display_name = item.get("title") or "Untitled File"

                        if file_id and is_schedule_file(display_name):
                            if not any(str(f.get("file_id")) == str(file_id) for f in files_to_download):
                                files_to_download.append({
                                    "file_id": int(file_id),
                                    "display_name": display_name,
                                    "url": None,  # compute in step 5
                                    "source": "module_file"
                                })
                                module_file_count += 1
                                print("        âœ“ Matched schedule file!")

                    elif item_type == "Page":
                        page_url = item.get("page_url")

                        if page_url and any(keyword in title.lower() for keyword in SCHEDULE_KEYWORDS):
                            print("        â†’ Fetching page content (schedule keyword match)")
                            try:
                                page_response = requests.get(
                                    f"{base_url}/api/v1/courses/{course_id}/pages/{page_url}",
                                    headers=headers
                                )

                                if page_response.status_code == 200:
                                    page_data = page_response.json()
                                    body_html = page_data.get("body") or ""

                                    if body_html:
                                        text = html_to_text(body_html)
                                        if text and len(text.strip()) > 50:
                                            extracted_materials.append({
                                                "source_type": "canvas_page",
                                                "name": f"Module Page: {title}",
                                                "text": text,
                                                "metadata": {"page_url": page_url, "source": "module_page"}
                                            })
                                            module_page_count += 1
                                            print(f"        âœ“ Extracted page text ({len(text)} chars)")

                                        links = extract_links_from_html(body_html, base_url)
                                        if links:
                                            print(f"        â†’ Found {len(links)} links in page")
                                        for link in links:
                                            print(f"          â€¢ Link: {link['text']} (file)")
                                            if link['is_file']:
                                                if not any(f.get("url") == link['url'] for f in files_to_download):
                                                    files_to_download.append({
                                                        "url": link['url'],
                                                        "display_name": link['text'],
                                                        "source": "module_page_link",
                                                        "file_id": link.get("file_id") or f"link_{abs(hash(link['url']))}"
                                                    })
                                                    print("            âœ“ Added file to download queue")
                                else:
                                    print(f"        âš  Page fetch failed: {page_response.status_code}")
                            except Exception as e:
                                print(f"        âŒ Error fetching page: {e}")
                                import traceback
                                traceback.print_exc()

            print("\n   âœ“ Module scan complete:")
            print(f"     â€¢ Direct file items: {module_file_count}")
            print(f"     â€¢ Schedule pages: {module_page_count}")
            print(f"     â€¢ Total files queued: {len(files_to_download)}")
        else:
            print(f"   âš  Modules fetch failed: {modules_response.status_code}")
    except Exception as e:
        print(f"   âŒ Error listing modules: {e}")

    # ============================================
    # STEP 5: Download All Collected Files
    # ============================================
    print(f"\nâ¬‡ï¸  [5/6] Downloading {len(files_to_download)} schedule files...")

    for file_info in files_to_download:
        file_id = file_info.get("file_id", f"unknown_{hash(file_info.get('url', ''))}")
        display_name = file_info.get("display_name") or str(file_id)
        url = file_info.get("url")
        source = file_info.get("source", "unknown")
        is_google_sheet = file_info.get("is_google_sheet", False)

        # Handle Google Sheets differently
        if is_google_sheet:
            print(f"   📊 Fetching Google Sheet: {display_name}")
            text = fetch_google_sheet_as_text(url)

            if text and len(text.strip()) > 50:
                extracted_materials.append({
                    "source_type": "google_sheet",
                    "name": f"Google Sheet: {display_name}",
                    "text": text,
                    "metadata": {
                        "url": url,
                        "source": source
                    }
                })
                print(f"   ✓ Extracted Google Sheet: {display_name} ({len(text)} chars)")
            else:
                print(f"   ⚠  Could not extract Google Sheet: {display_name}")
            continue

        # If file_id is numeric, compute a real download URL (fixes 404 + HTML preview issues)
        if isinstance(file_id, int) and (not url):
            url = get_canvas_download_url(base_url, headers, file_id)

        # Create safe filename
        safe_name = display_name.replace("/", "_").replace("\\", "_")
        safe_name = safe_name.split("?")[0]
        local_filename = f"{file_id}_{safe_name}"
        local_path = os.path.join(schedule_dir, local_filename)

        if not url:
            print(f"   âš  No URL for {display_name} (skipping)")
            continue

        if not os.path.exists(local_path):
            try:
                resp = requests.get(url, headers=headers, stream=True, allow_redirects=True)
                if resp.status_code == 200:
                    with open(local_path, "wb") as out:
                        for chunk in resp.iter_content(chunk_size=8192):
                            if chunk:
                                out.write(chunk)
                    print(f"   âœ“ Downloaded: {display_name}")
                else:
                    print(f"   âš  Download failed for {display_name}: {resp.status_code}")
                    continue
            except Exception as e:
                print(f"   âŒ Error downloading {display_name}: {e}")
                continue
        else:
            print(f"   â†» Cached: {display_name}")

        # Extract text immediately
        try:
            text = extract_text_safely(local_path)

            if text and len(text.strip()) > 50:
                extracted_materials.append({
                    "source_type": "file",
                    "name": display_name,
                    "text": text,
                    "metadata": {
                        "file_id": file_id if isinstance(file_id, int) else None,
                        "source": source,
                        "path": local_path
                    }
                })
                print(f"   âœ“ Extracted: {display_name} ({len(text)} chars)")
            else:
                print(f"   âš  Empty or invalid text: {display_name}")
        except Exception as e:
            print(f"   âŒ Extraction failed for {display_name}: {e}")

    # ============================================
    # STEP 6: Store in Database
    # ============================================
    print(f"\nðŸ’¾ [6/6] Storing {len(extracted_materials)} materials in database...")

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        DELETE FROM course_file_text
        WHERE course_id = ? AND file_type = 'schedule'
    """, (course_id,))

    inserted = 0
    for material in extracted_materials:
        cur.execute("""
            INSERT INTO course_file_text (
                course_id,
                canvas_file_id,
                file_type,
                file_name,
                storage_path,
                extracted_text,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            course_id,
            material["metadata"].get("file_id"),
            "schedule",
            material["name"],
            material["metadata"].get("path", f"canvas_page:{material['metadata'].get('source', 'unknown')}"),
            material["text"],
            now_iso()
        ))
        inserted += 1

    conn.commit()
    conn.close()

    print(f"   âœ“ Inserted {inserted} materials into database")

    summary = {
        "course_id": course_id,
        "timestamp": now_iso(),
        "materials_extracted": len(extracted_materials),
        "breakdown": {
            "canvas_pages": sum(1 for m in extracted_materials if m["source_type"] == "canvas_page"),
            "files": sum(1 for m in extracted_materials if m["source_type"] == "file")
        },
        "materials": [
            {"name": m["name"], "source_type": m["source_type"], "text_length": len(m["text"])}
            for m in extracted_materials
        ]
    }

    summary_path = os.path.join(course_base, "sync_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'=' * 60}")
    print("âœ… SYNC COMPLETE")
    print(f"{'=' * 60}\n")

    return jsonify(summary)


# -----------------------------
# ANNOUNCEMENTS
# -----------------------------
@app.route("/api/sync_announcements", methods=["POST"])
def sync_announcements():
    payload = request.json
    base_url = payload["base_url"]
    token = payload["token"]
    course_ids = payload["course_ids"]

    params = []
    for cid in course_ids:
        params.append(("context_codes[]", f"course_{cid}"))

    r = requests.get(
        f"{base_url}/api/v1/announcements",
        headers=canvas_headers(token),
        params=params
    )

    if r.status_code != 200:
        return jsonify({"error": "Failed to fetch announcements"}), 400

    announcements = r.json()
    conn = get_db()
    cur = conn.cursor()

    for a in announcements:
        context_id = a.get("context_id")
        if not context_id and "context_code" in a:
            context_code = a.get("context_code", "")
            if context_code.startswith("course_"):
                context_id = context_code.split("_", 1)[1]

        if not context_id:
            print(f"âš  Skipping announcement {a.get('id')}: no context_id or context_code")
            continue

        cur.execute("""
            INSERT OR IGNORE INTO canvas_announcements (
                canvas_announcement_id, course_id, title, message, posted_at, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            a.get("id"),
            str(context_id),
            a.get("title"),
            a.get("message"),
            a.get("created_at") or a.get("posted_at"),
            json.dumps(a)
        ))

    conn.commit()
    conn.close()

    return jsonify({"inserted": len(announcements)})


def get_all_announcements(course_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT canvas_announcement_id, title, message, posted_at
        FROM canvas_announcements
        WHERE course_id = ?
        ORDER BY datetime(posted_at) ASC
    """, (str(course_id),))
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# -----------------------------
# ASSIGNMENTS SYNC
# -----------------------------
@app.route("/api/sync_assignments", methods=["POST"])
def sync_assignments():
    payload = request.json
    base_url = payload.get("base_url")
    token = payload.get("token")
    course_id = str(payload.get("course_id"))

    if not base_url or not token or not course_id:
        return jsonify({"error": "Missing base_url, token, or course_id"}), 400

    try:
        r = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/assignments?per_page=100",
            headers=canvas_headers(token)
        )
    except Exception as e:
        return jsonify({"error": f"Error calling Canvas: {e}"}), 500

    if r.status_code != 200:
        return jsonify({
            "error": "Failed to fetch assignments from Canvas",
            "status": r.status_code,
            "body": r.text,
        }), 400

    assignments = r.json()
    now = now_iso()

    conn = get_db()
    cur = conn.cursor()

    for a in assignments:
        canvas_assignment_id = a.get("id")
        name = a.get("name") or ""
        description = a.get("description") or ""
        due_at = a.get("due_at")

        # AI will categorize everything, so mark as pending
        category = "PENDING"
        deliverable = 1  # Will be determined by AI

        status = "OK" if due_at else "MISSING_DUE_DATE"
        raw_json_str = json.dumps(a, ensure_ascii=False)

        cur.execute("""
            SELECT id, normalized_due_at, status
            FROM assignments_normalized
            WHERE course_id = ? AND canvas_assignment_id = ?
        """, (course_id, canvas_assignment_id))
        row = cur.fetchone()

        if row is None:
            cur.execute("""
                INSERT INTO assignments_normalized (
                    course_id,
                    canvas_assignment_id,
                    name,
                    description,
                    original_due_at,
                    normalized_due_at,
                    source_of_truth,
                    confidence,
                    status,
                    raw_canvas_json,
                    category,
                    deliverable,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                course_id,
                canvas_assignment_id,
                name,
                description,
                due_at,
                due_at,
                "Canvas",
                None,
                status,
                raw_json_str,
                category,
                deliverable,
                now,
                now,
            ))
        else:
            existing_normalized = row["normalized_due_at"]
            existing_status = row["status"] or status
            normalized_due = existing_normalized if existing_normalized is not None else due_at

            cur.execute("""
                UPDATE assignments_normalized
                SET
                    name = ?,
                    description = ?,
                    original_due_at = ?,
                    normalized_due_at = ?,
                    status = ?,
                    raw_canvas_json = ?,
                    updated_at = ?
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (
                name,
                description,
                due_at,
                normalized_due,
                existing_status,
                raw_json_str,
                now,
                course_id,
                canvas_assignment_id,
            ))

    conn.commit()
    conn.close()

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            course_id,
            canvas_assignment_id,
            name,
            description,
            original_due_at,
            normalized_due_at,
            source_of_truth,
            confidence,
            status,
            category,
            deliverable,
            created_at,
            updated_at
        FROM assignments_normalized
        WHERE course_id = ? AND category != 'PLACEHOLDER'
        ORDER BY datetime(normalized_due_at) IS NULL, normalized_due_at
    """, (course_id,))
    rows = cur.fetchall()
    conn.close()

    result = []
    for row in rows:
        result.append({
            "course_id": row["course_id"],
            "canvas_assignment_id": row["canvas_assignment_id"],
            "name": row["name"],
            "description": row["description"],
            "original_due_at": row["original_due_at"],
            "normalized_due_at": row["normalized_due_at"],
            "source_of_truth": row["source_of_truth"],
            "confidence": row["confidence"],
            "status": row["status"],
            "category": row["category"],
            "deliverable": row["deliverable"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })

    return jsonify({
        "course_id": course_id,
        "assignments": result
    })


# -----------------------------
# RESOLVE COURSE DATES (AI) + DISCOVER NEW ASSIGNMENTS
# -----------------------------
@app.route("/api/resolve_course_dates", methods=["POST"])
def resolve_course_dates():
    payload = request.json
    course_id = str(payload.get("course_id"))
    timezone = payload.get("course_timezone", "America/New_York")
    discover_new = payload.get("discover_new_assignments", True)

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT canvas_assignment_id, name, original_due_at, normalized_due_at
        FROM assignments_normalized
        WHERE course_id = ?
    """, (course_id,))
    assignments = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT file_name, file_type, extracted_text
        FROM course_file_text
        WHERE course_id = ? AND file_type = 'schedule'
        ORDER BY LENGTH(extracted_text) DESC
    """, (course_id,))
    files = [dict(r) for r in cur.fetchall()]
    conn.close()

    announcements = get_all_announcements(course_id)

    print(f"[GEMINI] Resolving {len(assignments)} Canvas assignments using {len(files)} files and {len(announcements)} announcements")
    if discover_new:
        print("[GEMINI] Also discovering new assignments from schedules...")

    try:
        gemini_results = resolve_assignment_dates_with_gemini(
            assignments=assignments,
            announcements=announcements,
            files=files,
            course_timezone=timezone,
            confidence_threshold=0.0,
            discover_new_assignments=discover_new
        )
        print(f"\n🔍 GEMINI RETURNED {len(gemini_results)} TOTAL ENTRIES")

        for i, r in enumerate(gemini_results[:5]):
            if r.get("canvas_assignment_id"):
                print(f"  [{i+1}] Canvas ID {r['canvas_assignment_id']}: status={r.get('status')}, date={r.get('normalized_due_at')}")

    except Exception as e:
        import traceback
        print("ðŸ”¥ GEMINI RESOLUTION FAILED:")
        print(traceback.format_exc())
        return jsonify({
            "error": "Gemini resolution failed",
            "details": str(e)
        }), 500

    canvas_updates = [r for r in gemini_results if r.get("canvas_assignment_id")]
    discovered = [r for r in gemini_results if not r.get("canvas_assignment_id")]

    for r in discovered:
        if r.get("status") == "CONFLICT":
            print(f"⚠️  WARNING: Discovered item '{r.get('name')}' incorrectly marked as CONFLICT")
            print(f"    Changing to DISCOVERED status")
            r["status"] = "DISCOVERED"

    updated = 0
    conflicts = 0
    discovered_count = 0

    conn = get_db()
    cur = conn.cursor()

    # Track which assignments Gemini actually returned
    gemini_assignment_ids = {r["canvas_assignment_id"] for r in canvas_updates if r.get("canvas_assignment_id")}

    # Get all Canvas assignment IDs that should have been processed
    cur.execute("""
        SELECT canvas_assignment_id 
        FROM assignments_normalized 
        WHERE course_id = ? AND canvas_assignment_id IS NOT NULL
    """, (course_id,))
    all_canvas_ids = {row["canvas_assignment_id"] for row in cur.fetchall()}

    # Warn if Gemini didn't return entries for all assignments
    missing_ids = all_canvas_ids - gemini_assignment_ids
    if missing_ids:
        print(f"⚠️  WARNING: Gemini did not return entries for {len(missing_ids)} Canvas assignments: {missing_ids}")
        print("    These assignments will keep their existing dates.")

    for r in canvas_updates:
        canvas_id = r.get("canvas_assignment_id")
        if not canvas_id:
            continue

        if r.get("status") == "CONFLICT":
            conflicts += 1
            ai_category = r.get("category", "ASSIGNMENT")
            deliverable = 0 if ai_category in ("READING", "ATTENDANCE", "PLACEHOLDER") else 1

            cur.execute("""
                UPDATE assignments_normalized
                SET
                    normalized_due_at = ?,
                    source_of_truth = ?,
                    confidence = ?,
                    status = 'CONFLICT',
                    category = ?,
                    deliverable = ?
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (
                r.get("normalized_due_at"),
                r.get("source_of_truth", "Canvas"),
                r.get("confidence", 0.0),
                ai_category,
                deliverable,
                course_id,
                canvas_id
            ))
            continue

        if r.get("status") == "RESOLVED":
            # Get category from AI response
            ai_category = r.get("category", "ASSIGNMENT")
            deliverable = 0 if ai_category == "READING" else 1

            cur.execute("""
                UPDATE assignments_normalized
                SET
                    normalized_due_at = ?,
                    source_of_truth = ?,
                    confidence = ?,
                    status = 'RESOLVED',
                    category = ?,
                    deliverable = ?
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (
                r.get("normalized_due_at"),
                r.get("source_of_truth"),
                r.get("confidence"),
                ai_category,
                deliverable,
                course_id,
                canvas_id
            ))
            updated += 1
            continue

        if r.get("status") == "CANNOT_DETERMINE":
            ai_category = r.get("category", "ASSIGNMENT")
            deliverable = 0 if ai_category == "READING" else 1

            cur.execute("""
                UPDATE assignments_normalized
                SET
                    normalized_due_at = ?,
                    source_of_truth = ?,
                    confidence = ?,
                    status = 'CANNOT_DETERMINE',
                    category = ?,
                    deliverable = ?
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (
                r.get("normalized_due_at"),
                r.get("source_of_truth") or "Canvas",
                r.get("confidence") or 0.0,
                ai_category,
                deliverable,
                course_id,
                canvas_id
            ))
            continue

    for r in discovered:
        if r.get("status") != "DISCOVERED":
            continue

        name = (r.get("name") or "").strip()
        desc = (r.get("description") or "").strip()
        due = r.get("normalized_due_at")  # may be None (especially for readings)

        confidence = float(r.get("confidence", 0.7) or 0.7)
        source = r.get("source_of_truth", "Schedule")
        evidence = r.get("reason", "")

        if not name:
            continue

        # ✅ HARD OVERRIDE: WeBWorK / Gradescope / Homework => ASSIGNMENT
        force_assignment = force_assignment_if_deliverable_keywords(name, desc)

        # Use Gemini's category if present (accept full set)
        model_category = (r.get("category") or "").strip().upper()
        if model_category not in ("ASSIGNMENT", "QUIZ", "READING", "EXAM", "ATTENDANCE", "PLACEHOLDER"):
            model_category = None

        if force_assignment:
            category = "ASSIGNMENT"
            deliverable = 1
        else:
            category, deliverable = infer_category_from_discovered_item(name, desc)
            if model_category:
                category = model_category
                deliverable = 0 if category in ("READING", "ATTENDANCE", "PLACEHOLDER") else 1

        # ✅ KEY FIX: allow readings with no due date/time
        if not due and category != "READING":
            continue

        # Store readings in reading_items (optional but keeps your current UI working)


        # Upsert into assignments_normalized (canvas_assignment_id NULL => discovered)
        cur.execute("""
            SELECT id FROM assignments_normalized
            WHERE course_id = ?
              AND canvas_assignment_id IS NULL
              AND category = ?
              AND normalized_due_at IS ?
        """, (course_id, category, due))
        existing = cur.fetchone()

        if not existing:
            cur.execute("""
                INSERT INTO assignments_normalized (
                    course_id,
                    canvas_assignment_id,
                    name,
                    description,
                    original_due_at,
                    normalized_due_at,
                    source_of_truth,
                    confidence,
                    status,
                    raw_canvas_json,
                    category,
                    deliverable,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                course_id,
                None,
                name,
                desc or "Discovered from schedule",
                None,
                due,  # can be None for READING
                source,
                confidence,
                "DISCOVERED",
                json.dumps({"discovered": True, "category": category, "source": source, "forced": force_assignment}),
                category,
                0 if category in ("READING", "ATTENDANCE", "PLACEHOLDER") else 1,
                now_iso(),
                now_iso()
            ))
            discovered_count += 1
            print(f"   ✓ Discovered {category}: {name} due {due}")
        else:
            cur.execute("""
                UPDATE assignments_normalized
                SET
                    description = ?,
                    normalized_due_at = ?,
                    source_of_truth = ?,
                    confidence = ?,
                    status = 'DISCOVERED',
                    category = ?,
                    deliverable = ?,
                    updated_at = ?
                WHERE id = ?
            """, (
                desc or "Discovered from schedule",
                due,
                source,
                confidence,
                category,
                0 if category in ("READING", "ATTENDANCE", "PLACEHOLDER") else 1,
                now_iso(),
                existing["id"]
            ))
    conn.commit()
    conn.close()

    return jsonify({
        "course_id": course_id,
        "updated": updated,
        "conflicts": conflicts,
        "discovered": discovered_count
    }), 200


# -----------------------------
# CANVAS PASSTHROUGH APIs
# -----------------------------
@app.route("/api/canvas/test", methods=["POST"])
def test_canvas():
    payload = request.json
    base_url = payload.get("base_url")
    token = payload.get("token")

    try:
        r = requests.get(
            f"{base_url}/api/v1/courses?per_page=1",
            headers=canvas_headers(token)
        )
        return jsonify({
            "valid": r.status_code == 200,
            "status": r.status_code
        })
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500


@app.route("/api/canvas/courses", methods=["POST"])
def canvas_courses():
    payload = request.json
    base_url = payload["base_url"]
    token = payload["token"]

    r = requests.get(
        f"{base_url}/api/v1/courses?per_page=100",
        headers=canvas_headers(token)
    )

    return jsonify(r.json())


@app.route("/api/reading_items/<course_id>", methods=["GET"])
def reading_items(course_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT name, details, due_at, source_of_truth, confidence
        FROM reading_items
        WHERE course_id = ?
        ORDER BY datetime(due_at) IS NULL, due_at
    """, (str(course_id),))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


if __name__ == "__main__":
    app.run(port=5000, debug=False, use_reloader=False)