import os
import requests
import re
import json
import datetime
import tempfile
from parsers.syllabus_text import extract_text_from_file

# Constants
SCHEDULE_KEYWORDS = ['syllabus', 'schedule', 'calendar']

try:
    from bs4 import BeautifulSoup

    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False


def canvas_headers(token):
    return {"Authorization": f"Bearer {token}"}


def html_to_text(html):
    if not html:
        return ""
    if HAS_BS4:
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n", strip=True)
    text = re.sub(r"<[^>]+>", " ", html)
    return " ".join(text.split())


def is_schedule_file(filename):
    """Check if filename contains schedule-related keywords"""
    if not filename:
        return False
    lower = filename.lower()
    return any(keyword in lower for keyword in SCHEDULE_KEYWORDS)


def get_file_extension(filename):
    return os.path.splitext(filename)[1]


def now_iso():
    return datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"


# -----------------------------
# 🌟 UNIFIED COURSE MATERIALS SYNC
# -----------------------------

def sync_course_materials():
    """
    Unified endpoint that:
    1. Fetches Canvas Pages
    2. Lists all files (Files + Modules)
    3. Downloads files to TEMP storage only
    4. Extracts text
    5. Saves ALL extracted data to a single JSON file
    """
    base_url = "https://gatech.instructure.com/"
    token = os.environ.get("CANVAS_TOKEN")  # Ensure you replace this with your actual token
    course_id = "487144"

    headers = canvas_headers(token)
    extracted_materials = []

    print(f"\n{'=' * 60}")
    print(f"SYNCING COURSE MATERIALS: {course_id}")
    print(f"{'=' * 60}\n")

    # ============================================
    # STEP 1: Fetch Canvas Pages (Syllabus Page)
    # ============================================
    print("[1/5] Fetching Canvas Pages...")
    try:
        print (f"{base_url}/api/v1/courses/{course_id}/pages/syllabus-2?module_item_id=5303888")
        print (headers)
        pages_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/pages/syllabus-2?module_item_id=5303888",
            headers=headers,
            params={"per_page": 100}
        )
        print("hello1")
        print (pages_response)
        print("hello2")

        if pages_response.status_code == 200:
            pages = [pages_response.json()]

            # Filter for relevant pages
            def is_relevant_page(title):
                if not title: return False
                t = title.lower()
                keywords = ['syllabus', 'schedule', 'calendar', 'course info',
                            'course information', 'home', 'homepage', 'overview']
                return any(k in t for k in keywords)

            relevant_pages = [p for p in pages if is_relevant_page(p.get("title"))]
            print(f"   ✓ Found {len(relevant_pages)} relevant pages")

            for page in relevant_pages:
                slug = page.get("url")
                title = page.get("title") or slug

                if not slug: continue

                # Fetch page body
                page_response = requests.get(
                    f"{base_url}/api/v1/courses/{course_id}/pages/{slug}",
                    headers=headers,
                    params={"include[]": "body"}
                )

                if page_response.status_code == 200:
                    page_data = page_response.json()
                    body_html = page_data.get("body") or ""
                    text = html_to_text(body_html)

                    if text and len(text.strip()) > 50:
                        extracted_materials.append({
                            "type": "canvas_page",
                            "id": page.get("page_id"),
                            "title": title,
                            "content": text,
                            "url": f"{base_url}/courses/{course_id}/pages/{slug}",
                            "timestamp": now_iso()
                        })
                        print(f"   ✓ Extracted page: {title}")
        else:
            print(f"   ⚠ Pages fetch failed: {pages_response.status_code}")
    except Exception as e:
        print(f"   Error fetching pages: {e}")

    # ============================================
    # STEP 2 & 3: List Files (Files Section + Modules)
    # ============================================
    print("\n[2/5] Identifying relevant files...")
    files_to_download = []
    seen_file_ids = set()

    # Helper to add files to the download list
    def add_file(file_id, name, url, source):
        if file_id not in seen_file_ids:
            files_to_download.append({
                "file_id": file_id,
                "display_name": name,
                "url": url,
                "source": source
            })
            seen_file_ids.add(file_id)

    # 2. Get from Files API
    try:
        files_resp = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/files",
            headers=headers,
            params={"per_page": 100}
        )
        if files_resp.status_code == 200:
            for f in files_resp.json():
                name = f.get("display_name") or f.get("filename")
                if is_schedule_file(name):
                    add_file(f.get("id"), name, f.get("url"), "files_section")
    except Exception as e:
        print(f"   Error listing files: {e}")

    # 3. Get from Modules API
    try:
        modules_resp = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/modules",
            headers=headers,
            params={"include[]": "items", "per_page": 100}
        )
        if modules_resp.status_code == 200:
            for module in modules_resp.json():
                for item in module.get("items", []):
                    if item.get("type") == "File":
                        name = item.get("title")
                        if is_schedule_file(name):
                            add_file(item.get("content_id"), name, item.get("url"), "module")
    except Exception as e:
        print(f"   Error listing modules: {e}")

    print(f"   ✓ Found {len(files_to_download)} unique schedule files")

    # ============================================
    # STEP 4: Download to Temp & Extract
    # ============================================
    print(f"\n[4/5] Processing files (No local storage)...")

    for file_info in files_to_download:
        display_name = file_info["display_name"]
        url = file_info["url"]

        # Get extension for temp file (parsers often need the extension to know how to read)
        ext = get_file_extension(display_name)

        try:
            # Create a temporary file that deletes itself when closed
            # Note: delete=False is used here so we can close the file handle
            # before passing the path to the extractor, then we manually remove it.
            # This avoids file-lock issues on Windows.
            temp_fd, temp_path = tempfile.mkstemp(suffix=ext)

            # Download
            resp = requests.get(url, headers=headers, stream=True)
            if resp.status_code == 200:
                with os.fdopen(temp_fd, 'wb') as tmp:
                    for chunk in resp.iter_content(chunk_size=8192):
                        tmp.write(chunk)

                # Extract Text
                try:
                    text = extract_text_from_file(temp_path)
                    if text and len(text.strip()) > 50:
                        extracted_materials.append({
                            "type": "file",
                            "id": file_info["file_id"],
                            "title": display_name,
                            "content": text,
                            "source": file_info["source"],
                            "timestamp": now_iso()
                        })
                        print(f"   ✓ Processed: {display_name}")
                    else:
                        print(f"   ⚠ No text extracted: {display_name}")
                except Exception as ex:
                    print(f"   ⚠ Extraction error {display_name}: {ex}")
            else:
                print(f"   ⚠ Download failed {display_name}: {resp.status_code}")
                os.close(temp_fd)

        except Exception as e:
            print(f"   Error processing {display_name}: {e}")
        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.remove(temp_path)

    # ============================================
    # STEP 5: Save to JSON
    # ============================================
    output_filename = f"course_{course_id}_materials.json"
    print(f"\n[5/5] Saving data to {output_filename}...")

    try:
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(extracted_materials, f, indent=2, ensure_ascii=False)
        print(f"   ✓ SUCCESS! Saved {len(extracted_materials)} items to JSON.")
    except Exception as e:
        print(f"   ❌ Error saving JSON: {e}")


if __name__ == "__main__":
    sync_course_materials()