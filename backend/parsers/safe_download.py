# backend/parsers/safe_download.py
import os
import re
import requests

def sanitize_filename(name):
    return re.sub(r'[<>:"/\\|?*]', '_', name)

def download_file(url, token, output_dir, original_name):
    os.makedirs(output_dir, exist_ok=True)

    safe_name = sanitize_filename(original_name)
    path = os.path.join(output_dir, safe_name)

    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers, timeout=60)

    r.raise_for_status()
    with open(path, "wb") as f:
        f.write(r.content)

    return path
