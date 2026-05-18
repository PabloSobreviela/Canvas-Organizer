import os
import re
import sys
import requests
from urllib.parse import urlparse

# Use environment variables; never hardcode instance URLs or course IDs.
BASE = os.environ.get("CANVAS_BASE_URL", "https://your-school.instructure.com")
COURSE_ID = os.environ.get("CANVAS_COURSE_ID", "")
TOKEN = os.environ.get("CANVAS_TOKEN")
OUTDIR = os.environ.get("CANVAS_DOWNLOAD_OUTDIR", "course_files")

if not TOKEN:
    print("Set CANVAS_TOKEN in your environment. Example: $env:CANVAS_TOKEN='YOUR_TOKEN' (PowerShell)")
    sys.exit(1)
if not COURSE_ID:
    print("Set CANVAS_COURSE_ID (numeric Canvas course ID). Example: $env:CANVAS_COURSE_ID='12345'")
    sys.exit(1)

headers = {"Authorization": f"Bearer {TOKEN}"}
os.makedirs(OUTDIR, exist_ok=True)

def safe_name(name: str) -> str:
    name = name.strip()
    # Windows-illegal chars: < > : " / \ | ? *
    name = re.sub(r'[<>:"/\\\\|?*]', "_", name)
    name = re.sub(r"\s+", " ", name)
    return name[:180] if len(name) > 180 else name

def parse_next_link(link_header: str) -> str | None:
    # Canvas uses RFC5988 Link headers: <url>; rel="next", ...
    if not link_header:
        return None
    parts = [p.strip() for p in link_header.split(",")]
    for p in parts:
        if 'rel="next"' in p:
            m = re.search(r"<([^>]+)>", p)
            return m.group(1) if m else None
    return None

url = f"{BASE}/api/v1/courses/{COURSE_ID}/files?per_page=100"
seen = set()
downloaded = 0

while url:
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    files = r.json()

    for f in files:
        file_id = f.get("id")
        if file_id in seen:
            continue
        seen.add(file_id)

        name = safe_name(f.get("display_name") or f.get("filename") or f"file_{file_id}")
        download_url = f.get("url")

        if not download_url:
            print(f"SKIP (no url): {name}")
            continue

        # Avoid overwriting duplicates: add (id) if filename already exists
        path = os.path.join(OUTDIR, name)
        if os.path.exists(path):
            root, ext = os.path.splitext(name)
            path = os.path.join(OUTDIR, f"{root} ({file_id}){ext}")

        print(f"DOWNLOADING: {name}")
        with requests.get(download_url, headers=headers, stream=True, timeout=60) as d:
            d.raise_for_status()
            with open(path, "wb") as out:
                for chunk in d.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        out.write(chunk)

        downloaded += 1

    url = parse_next_link(r.headers.get("Link"))

print(f"\nDone. Downloaded {downloaded} files to ./{OUTDIR}")
