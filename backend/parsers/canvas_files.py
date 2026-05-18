# backend/parsers/canvas_files.py
import requests
from parsers.file_heuristic import is_candidate

CANVAS_API = "https://gatech.instructure.com/api/v1"

def fetch_course_files(token, course_id):
    headers = {
        "Authorization": f"Bearer {token}"
    }

    url = f"{CANVAS_API}/courses/{course_id}/files"
    params = {"per_page": 100}

    files = []
    while url:
        res = requests.get(url, headers=headers, params=params)
        res.raise_for_status()
        data = res.json()
        files.extend(data)

        url = res.links.get("next", {}).get("url")

    return files


def extract_metadata(files):
    metadata = []
    for f in files:
        metadata.append({
            "file_id": f["id"],
            "name": f["display_name"],
            "content_type": f.get("content-type"),
            "size": f.get("size"),
            "url": f.get("url"),
            "created_at": f.get("created_at"),
            "updated_at": f.get("updated_at")
        })
    return metadata


def select_candidates(metadata):
    return [f for f in metadata if is_candidate(f["name"])]
