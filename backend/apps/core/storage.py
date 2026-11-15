"""
File storage for images and private documents.

Production uses Cloudinary:
  * images (logos, covers, product photos) are uploaded as public "upload" assets;
  * supplier verification documents are uploaded as "authenticated" assets, which
    Cloudinary refuses to serve without a signed, expiring URL.

When CLOUDINARY_URL is empty (local development) files go to MEDIA_ROOT /
PRIVATE_MEDIA_ROOT instead, so the app runs without a Cloudinary account.
"""

import io
import time
import uuid
import warnings
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps
from rest_framework.exceptions import ValidationError

IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"RIFF": "webp",  # checked further below
}
DOCUMENT_TYPES = {"pdf", "jpg", "png"}


@dataclass
class StoredFile:
    url: str
    public_id: str
    format: str
    bytes: int


def _cloudinary_enabled() -> bool:
    return bool(settings.CLOUDINARY_URL)


def _sniff(upload) -> str | None:
    head = upload.read(16)
    upload.seek(0)
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    for sig, fmt in IMAGE_SIGNATURES.items():
        if sig != b"RIFF" and head.startswith(sig):
            return fmt
    return None


def _check_size(upload, max_mb: int):
    if upload.size > max_mb * 1024 * 1024:
        raise ValidationError(f"File is too large. The limit is {max_mb} MB.")


PIL_FORMATS = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}


def validate_image(upload) -> str:
    """Cheap first pass: size limit and file signature. `sanitize_image` does the real check."""
    _check_size(upload, settings.MAX_IMAGE_UPLOAD_MB)
    fmt = _sniff(upload)
    if fmt not in PIL_FORMATS:
        raise ValidationError("Upload a JPG, PNG or WebP image.")
    return fmt


def sanitize_image(upload, remove_background: bool = False) -> tuple[ContentFile, str]:
    """
    Decode the upload as a real image and re-encode it from its pixels.

    The stored file is always freshly written by Pillow, so anything smuggled into the
    original (HTML/JS after a valid header, polyglot files, oversized chunks) is dropped,
    as is all metadata: EXIF (including GPS location), XMP, comments and ICC profiles.
    Decompression bombs and very large dimensions are refused before pixels are decoded.

    With `remove_background`, the part is cut out of its background and trimmed (see
    apps/core/background.py) and saved as a transparent WebP. If the cut-out fails or looks
    unreliable, the photo is kept as it was.
    """
    fmt = validate_image(upload)
    pil_format = PIL_FORMATS[fmt]
    bad = ValidationError("This file isn't a valid image. Upload a JPG, PNG or WebP photo.")
    try:
        with warnings.catch_warnings():
            # Pillow warns (rather than fails) between MAX_IMAGE_PIXELS and 2x that; treat both as errors.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            upload.seek(0)
            with Image.open(upload, formats=[pil_format]) as probe:
                w, h = probe.size
                if w < 1 or h < 1 or w * h > settings.MAX_IMAGE_PIXELS:
                    raise ValidationError("This image is too large. Use a photo under 40 megapixels.")
                probe.verify()  # structural check (CRC, truncation); leaves the object unusable
            upload.seek(0)
            with Image.open(upload, formats=[pil_format]) as im:
                im.seek(0)  # animated PNG/WebP: keep the first frame only
                im.load()
                im = ImageOps.exif_transpose(im)  # bake in the camera rotation before EXIF is dropped
                im.thumbnail((settings.MAX_IMAGE_SIDE, settings.MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
                if remove_background:
                    from apps.core.background import remove_background as cut_out

                    cutout = cut_out(im)
                    if cutout is not None:
                        im, fmt = cutout, "webp"
                has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
                if fmt == "jpg" or not has_alpha:
                    im = im.convert("RGB")
                else:
                    im = im.convert("RGBA")
                out = io.BytesIO()
                if fmt == "jpg":
                    im.save(out, "JPEG", quality=88, optimize=True, progressive=True)
                elif fmt == "png":
                    im.save(out, "PNG", optimize=True)
                else:
                    im.save(out, "WEBP", quality=88, method=4)
    except ValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError("This image is too large. Use a photo under 40 megapixels.")
    except Exception:  # Pillow raises OSError, SyntaxError, ValueError, struct.error… on malformed files
        raise bad
    finally:
        upload.seek(0)
    return ContentFile(out.getvalue(), name=f"{uuid.uuid4().hex}.{fmt}"), fmt


def validate_document(upload) -> str:
    _check_size(upload, settings.MAX_DOCUMENT_UPLOAD_MB)
    fmt = _sniff(upload)
    if fmt not in DOCUMENT_TYPES:
        raise ValidationError("Upload a PDF, JPG or PNG document.")
    return fmt


def _local_save(root: Path, folder: str, upload, fmt: str) -> tuple[str, Path]:
    public_id = f"{folder}/{uuid.uuid4().hex}"
    path = root / f"{public_id}.{fmt}"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as out:
        for chunk in upload.chunks():
            out.write(chunk)
    return public_id, path


def upload_image(upload, folder: str, remove_background: bool = False) -> StoredFile:
    upload, fmt = sanitize_image(upload, remove_background=remove_background)
    if _cloudinary_enabled():
        import cloudinary.uploader

        res = cloudinary.uploader.upload(
            upload,
            folder=f"{settings.CLOUDINARY_FOLDER}/{folder}",
            resource_type="image",
            type="upload",
            overwrite=False,
            unique_filename=True,
        )
        return StoredFile(res["secure_url"], res["public_id"], res.get("format", fmt), res.get("bytes", upload.size))
    public_id, _ = _local_save(Path(settings.MEDIA_ROOT), folder, upload, fmt)
    url = f"{settings.MEDIA_URL}{public_id}.{fmt}"
    return StoredFile(url, public_id, fmt, upload.size)


def upload_private_document(upload, folder: str) -> StoredFile:
    fmt = validate_document(upload)
    if _cloudinary_enabled():
        import cloudinary.uploader

        res = cloudinary.uploader.upload(
            upload,
            folder=f"{settings.CLOUDINARY_FOLDER}/private/{folder}",
            resource_type="image",  # Cloudinary stores PDFs as image assets
            type="authenticated",
            overwrite=False,
            unique_filename=True,
        )
        return StoredFile("", res["public_id"], res.get("format", fmt), res.get("bytes", upload.size))
    public_id, _ = _local_save(Path(settings.PRIVATE_MEDIA_ROOT), folder, upload, fmt)
    return StoredFile("", public_id, fmt, upload.size)


def private_document_url(public_id: str, fmt: str, expires_in: int = 300) -> str | None:
    """Short-lived URL for an authenticated Cloudinary asset. None in local mode (stream instead)."""
    if not _cloudinary_enabled():
        return None
    import cloudinary.utils

    return cloudinary.utils.private_download_url(
        public_id, fmt, resource_type="image", type="authenticated", expires_at=int(time.time()) + expires_in
    )


def local_private_path(public_id: str, fmt: str) -> Path:
    root = Path(settings.PRIVATE_MEDIA_ROOT).resolve()
    path = (root / f"{public_id}.{fmt}").resolve()
    if root not in path.parents:
        raise ValidationError("Invalid document path.")
    return path


def delete_file(public_id: str, fmt: str = "", private: bool = False) -> None:
    if not public_id:
        return
    if _cloudinary_enabled():
        import cloudinary.uploader

        cloudinary.uploader.destroy(
            public_id, resource_type="image", type="authenticated" if private else "upload", invalidate=True
        )
        return
    root = Path(settings.PRIVATE_MEDIA_ROOT if private else settings.MEDIA_ROOT)
    for candidate in root.glob(f"{public_id}.*"):
        candidate.unlink(missing_ok=True)
