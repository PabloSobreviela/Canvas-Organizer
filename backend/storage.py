# Supabase Storage Module
# Uses Supabase Storage for file uploads/downloads in multi-user deployment

import os
from typing import Optional, List
from supabase import create_client, Client

_supabase_client: Optional[Client] = None

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
BUCKET_NAME = os.getenv("SUPABASE_STORAGE_BUCKET", "course-files")


def _sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal (e.g. ../../../other_user/...).
    Rejects /, \\, and .. components.
    """
    if not filename or not isinstance(filename, str):
        return "file"
    # Replace path separators
    safe = filename.replace("/", "_").replace("\\", "_")
    # Remove any remaining .. or empty path segments
    parts = [p for p in safe.split("_") if p and p != ".."]
    safe = "_".join(parts) if parts else "file"
    # Fallback for names that become empty
    return safe.strip() or "file"


_ALLOWED_SUBFOLDERS = frozenset({"files", "schedules"})


def _sanitize_subfolder(subfolder: str) -> str:
    """
    Sanitize subfolder to prevent path traversal. Only allow known subfolders.
    """
    if not subfolder or not isinstance(subfolder, str):
        return "files"
    cleaned = subfolder.strip().lower()
    return cleaned if cleaned in _ALLOWED_SUBFOLDERS else "files"


def _guess_content_type(filename: str) -> str:
    """Guess content type from filename extension"""
    ext = filename.lower().split('.')[-1] if '.' in filename else ''

    content_types = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'txt': 'text/plain',
        'csv': 'text/csv',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
    }

    return content_types.get(ext, 'application/octet-stream')


def get_supabase_client() -> Client:
    """Get or create Supabase client"""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _supabase_client


def _storage_bucket():
    """Get a reference to the configured storage bucket"""
    return get_supabase_client().storage.from_(BUCKET_NAME)


def upload_user_file(user_id: str, course_id: str, filename: str, file_content: bytes,
                     subfolder: str = "files") -> str:
    """
    Upload file to Supabase Storage under user's directory.

    Args:
        user_id: Firebase user ID
        course_id: Canvas course ID
        filename: Name of the file
        file_content: File content as bytes
        subfolder: Subfolder within course directory (default: "files")

    Returns:
        Storage path to the file
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    storage_path = f"{user_id}/{course_id}/{subfolder}/{filename}"

    content_type = _guess_content_type(filename)

    try:
        _storage_bucket().remove([storage_path])
    except Exception:
        pass

    _storage_bucket().upload(
        storage_path,
        file_content,
        {"content-type": content_type},
    )

    print(f"[OK] Uploaded: {BUCKET_NAME}/{storage_path}")
    return storage_path


def download_user_file(user_id: str, course_id: str, filename: str,
                       subfolder: str = "files") -> Optional[bytes]:
    """
    Download file from Supabase Storage.

    Returns:
        File content as bytes, or None if file doesn't exist
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    storage_path = f"{user_id}/{course_id}/{subfolder}/{filename}"

    try:
        data = _storage_bucket().download(storage_path)
        return data
    except Exception as e:
        print(f"[WARN] File not found or download failed: {BUCKET_NAME}/{storage_path} – {e}")
        return None


def delete_user_file(user_id: str, course_id: str, filename: str,
                     subfolder: str = "files") -> bool:
    """
    Delete file from Supabase Storage.

    Returns:
        True if deleted, False if file didn't exist or deletion failed
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    storage_path = f"{user_id}/{course_id}/{subfolder}/{filename}"

    try:
        result = _storage_bucket().remove([storage_path])
        if result:
            print(f"[INFO] Deleted: {BUCKET_NAME}/{storage_path}")
            return True
        return False
    except Exception as e:
        print(f"[WARN] Delete failed: {BUCKET_NAME}/{storage_path} – {e}")
        return False


def list_user_files(user_id: str, course_id: str, subfolder: str = "files") -> List[str]:
    """
    List all files in a user's course directory.

    Returns:
        List of filenames (not full paths)
    """
    subfolder = _sanitize_subfolder(subfolder)
    folder_path = f"{user_id}/{course_id}/{subfolder}"

    try:
        entries = _storage_bucket().list(folder_path)
        return [
            entry["name"]
            for entry in entries
            if entry.get("name") and entry.get("id")  # skip folder placeholders
        ]
    except Exception as e:
        print(f"[WARN] List failed: {BUCKET_NAME}/{folder_path} – {e}")
        return []


def get_signed_url(user_id: str, course_id: str, filename: str,
                   subfolder: str = "files", expiration_hours: int = 1) -> Optional[str]:
    """
    Generate a signed URL for temporary access to a file.

    Args:
        expiration_hours: How long the URL should be valid (default: 1 hour)

    Returns:
        Signed URL string, or None if file doesn't exist
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    storage_path = f"{user_id}/{course_id}/{subfolder}/{filename}"

    try:
        expires_in = expiration_hours * 3600
        result = _storage_bucket().create_signed_url(storage_path, expires_in)
        return result.get("signedURL") or result.get("signedUrl")
    except Exception as e:
        print(f"[WARN] Signed URL failed: {BUCKET_NAME}/{storage_path} – {e}")
        return None


def upload_schedule_file(user_id: str, course_id: str, filename: str,
                         file_content: bytes) -> str:
    """Convenience function for uploading schedule files"""
    return upload_user_file(user_id, course_id, filename, file_content, subfolder="schedules")


def download_schedule_file(user_id: str, course_id: str, filename: str) -> Optional[bytes]:
    """Convenience function for downloading schedule files"""
    return download_user_file(user_id, course_id, filename, subfolder="schedules")


def list_schedule_files(user_id: str, course_id: str) -> List[str]:
    """Convenience function for listing schedule files"""
    return list_user_files(user_id, course_id, subfolder="schedules")


# =============================================================================
# LOCAL FALLBACK (for development without Supabase Storage)
# =============================================================================

class LocalStorageFallback:
    """
    Local filesystem storage for development when Supabase Storage isn't available.
    Mirrors the Supabase Storage API but uses local filesystem.
    """
    def __init__(self, root_path: str = "data/storage"):
        self.root_path = root_path
        os.makedirs(root_path, exist_ok=True)

    def _get_path(self, user_id: str, course_id: str, subfolder: str, filename: str) -> str:
        filename = _sanitize_filename(filename)
        subfolder = _sanitize_subfolder(subfolder)
        path = os.path.join(self.root_path, user_id, course_id, subfolder)
        os.makedirs(path, exist_ok=True)
        return os.path.join(path, filename)

    def upload(self, user_id: str, course_id: str, filename: str,
               content: bytes, subfolder: str = "files") -> str:
        path = self._get_path(user_id, course_id, subfolder, filename)
        with open(path, 'wb') as f:
            f.write(content)
        return f"file://{path}"

    def download(self, user_id: str, course_id: str, filename: str,
                 subfolder: str = "files") -> Optional[bytes]:
        path = self._get_path(user_id, course_id, subfolder, filename)
        if os.path.exists(path):
            with open(path, 'rb') as f:
                return f.read()
        return None

    def delete(self, user_id: str, course_id: str, filename: str,
               subfolder: str = "files") -> bool:
        path = self._get_path(user_id, course_id, subfolder, filename)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    def list_files(self, user_id: str, course_id: str, subfolder: str = "files") -> List[str]:
        path = os.path.join(self.root_path, user_id, course_id, subfolder)
        if os.path.exists(path):
            return os.listdir(path)
        return []


_local_storage = None


def get_local_storage() -> LocalStorageFallback:
    """Get local storage fallback for development"""
    global _local_storage
    if _local_storage is None:
        _local_storage = LocalStorageFallback()
    return _local_storage


def is_cloud_storage_available() -> bool:
    """Check if Supabase Storage is configured and reachable"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("[WARN] Supabase credentials not configured")
        return False
    try:
        _storage_bucket().list("")
        return True
    except Exception as e:
        print(f"[WARN] Supabase Storage not available: {e}")
        return False


if __name__ == "__main__":
    storage = get_local_storage()
    print(f"Local storage initialized at: {storage.root_path}")
    print(f"Supabase Storage available: {is_cloud_storage_available()}")
