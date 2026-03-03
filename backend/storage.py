# Google Cloud Storage Module
# Replaces local filesystem storage with Cloud Storage for multi-user deployment

import os
from typing import Optional, List
from google.cloud import storage

# Storage client (lazy initialized)
_storage_client = None
_bucket = None

BUCKET_NAME = os.getenv('GCS_BUCKET', 'canvas-organizer-files')


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


def get_storage_client():
    """Get or create Cloud Storage client"""
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


def get_bucket():
    """Get or create bucket reference"""
    global _bucket
    if _bucket is None:
        client = get_storage_client()
        _bucket = client.bucket(BUCKET_NAME)
    return _bucket


def upload_user_file(user_id: str, course_id: str, filename: str, file_content: bytes, 
                     subfolder: str = "files") -> str:
    """
    Upload file to Cloud Storage under user's directory.
    
    Args:
        user_id: Firebase user ID
        course_id: Canvas course ID
        filename: Name of the file
        file_content: File content as bytes
        subfolder: Subfolder within course directory (default: "files")
        
    Returns:
        Public URL or gs:// path to the file
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    bucket = get_bucket()
    blob_path = f"{user_id}/{course_id}/{subfolder}/{filename}"
    blob = bucket.blob(blob_path)
    
    # Detect content type from filename
    content_type = _guess_content_type(filename)
    
    blob.upload_from_string(file_content, content_type=content_type)
    
    print(f"[OK] Uploaded: gs://{BUCKET_NAME}/{blob_path}")
    return f"gs://{BUCKET_NAME}/{blob_path}"


def download_user_file(user_id: str, course_id: str, filename: str, 
                       subfolder: str = "files") -> Optional[bytes]:
    """
    Download file from Cloud Storage.
    
    Returns:
        File content as bytes, or None if file doesn't exist
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    bucket = get_bucket()
    blob_path = f"{user_id}/{course_id}/{subfolder}/{filename}"
    blob = bucket.blob(blob_path)

    if not blob.exists():
        print(f"[WARN] File not found: gs://{BUCKET_NAME}/{blob_path}")
        return None
    
    return blob.download_as_bytes()


def delete_user_file(user_id: str, course_id: str, filename: str, 
                     subfolder: str = "files") -> bool:
    """
    Delete file from Cloud Storage.
    
    Returns:
        True if deleted, False if file didn't exist
    """
    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    bucket = get_bucket()
    blob_path = f"{user_id}/{course_id}/{subfolder}/{filename}"
    blob = bucket.blob(blob_path)

    if blob.exists():
        blob.delete()
        print(f"[INFO] Deleted: gs://{BUCKET_NAME}/{blob_path}")
        return True
    
    return False


def list_user_files(user_id: str, course_id: str, subfolder: str = "files") -> List[str]:
    """
    List all files in a user's course directory.
    
    Returns:
        List of filenames (not full paths)
    """
    bucket = get_bucket()
    prefix = f"{user_id}/{course_id}/{subfolder}/"
    
    blobs = bucket.list_blobs(prefix=prefix)
    filenames = []
    
    for blob in blobs:
        # Extract just the filename from the full path
        filename = blob.name.replace(prefix, '')
        if filename:  # Skip empty (the directory itself)
            filenames.append(filename)
    
    return filenames


def get_signed_url(user_id: str, course_id: str, filename: str, 
                   subfolder: str = "files", expiration_hours: int = 1) -> Optional[str]:
    """
    Generate a signed URL for temporary access to a file.
    
    Args:
        expiration_hours: How long the URL should be valid (default: 1 hour)
        
    Returns:
        Signed URL string, or None if file doesn't exist
    """
    from datetime import timedelta

    filename = _sanitize_filename(filename)
    subfolder = _sanitize_subfolder(subfolder)
    bucket = get_bucket()
    blob_path = f"{user_id}/{course_id}/{subfolder}/{filename}"
    blob = bucket.blob(blob_path)
    
    if not blob.exists():
        return None
    
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(hours=expiration_hours),
        method="GET"
    )
    
    return url


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


# =============================================================================
# LOCAL FALLBACK (for development without Cloud Storage)
# =============================================================================

class LocalStorageFallback:
    """
    Local filesystem storage for development when Cloud Storage isn't available.
    Mirrors the Cloud Storage API but uses local filesystem.
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


# Create local fallback instance for development
_local_storage = None

def get_local_storage() -> LocalStorageFallback:
    """Get local storage fallback for development"""
    global _local_storage
    if _local_storage is None:
        _local_storage = LocalStorageFallback()
    return _local_storage


def is_cloud_storage_available() -> bool:
    """Check if Cloud Storage is configured and available"""
    try:
        client = get_storage_client()
        bucket = client.bucket(BUCKET_NAME)
        return bucket.exists()
    except Exception as e:
        print(f"[WARN] Cloud Storage not available: {e}")
        return False


if __name__ == "__main__":
    # Test local storage fallback
    storage = get_local_storage()
    print(f"Local storage initialized at: {storage.root_path}")
    print(f"Cloud Storage available: {is_cloud_storage_available()}")
