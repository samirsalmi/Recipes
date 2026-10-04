import hashlib
import urllib.request
from urllib.parse import urlparse

import cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile

from .. import cloudinary_client  # noqa: F401 - configures the cloudinary SDK on import
from ..cache import cache_get_bytes, cache_set_bytes
from ..models import UserRow
from ..security import get_current_user

router = APIRouter(prefix="/api/images", tags=["images"])

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


@router.get("/proxy")
def proxy_image(url: str, request: Request):
    """Dev-only helper: lets a phone on the PC's hotspot load Cloudinary photos through the
    PC (Redis-cached) instead of reaching Cloudinary itself. Restricted to Cloudinary image
    URLs so it can't be used as an open proxy."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "res.cloudinary.com" or "/image/upload/" not in parsed.path:
        raise HTTPException(status_code=400, detail="Only Cloudinary image URLs can be proxied")

    accept = request.headers.get("accept", "")
    wants_avif = "image/avif" in accept
    key = "img:" + hashlib.sha256(f"{url}|{wants_avif}".encode()).hexdigest()
    cached = cache_get_bytes(key)
    if cached is None:
        req = urllib.request.Request(url, headers={"Accept": accept or "image/*"})
        try:
            with urllib.request.urlopen(req, timeout=15) as upstream:
                content_type = upstream.headers.get("Content-Type", "image/jpeg")
                cached = content_type.encode() + b"\n" + upstream.read()
        except OSError:
            raise HTTPException(status_code=502, detail="Could not fetch image")
        cache_set_bytes(key, cached)
    content_type, _, body = cached.partition(b"\n")
    return Response(
        content=body,
        media_type=content_type.decode(),
        headers={"Cache-Control": "public, max-age=86400", "Vary": "Accept"},
    )


@router.post("")
async def upload_image(file: UploadFile, current_user: UserRow = Depends(get_current_user)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large (max 8MB)")

    result = cloudinary.uploader.upload(
        contents,
        folder="recipe-manager",
        resource_type="image",
        format="avif",  # stored as AVIF regardless of the uploaded format
    )
    return {"url": result["secure_url"]}
