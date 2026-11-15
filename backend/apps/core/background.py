"""
Product photo background removal.

Uses rembg's open-source ISNet model (runs on the CPU via onnxruntime) to cut the part out
of its background, then trims the empty space around it so every product sits the same way
in cards and the gallery.

The model is loaded once per process, on first use (~1 s per photo after that). If rembg is
not installed, the model file is missing, or the cut-out looks unreliable, the caller keeps
the original photo: an upload never fails because of background removal.
"""

import logging
import os
import threading

from django.conf import settings
from PIL import Image

log = logging.getLogger(__name__)

_session = None
_session_lock = threading.Lock()
_run_lock = threading.Lock()  # one inference at a time per process keeps memory bounded

# Mask quality limits (tuned on real supplier photos). Clean cut-outs have under ~17% of their
# visible pixels half-transparent; failed ones (busy scenes, faded scans) have 35%+.
MAX_SOFT_SHARE = 0.25
MIN_SUBJECT_SHARE = 0.02  # subject smaller than 2% of the photo: probably the wrong thing
MAX_SUBJECT_SHARE = 0.98  # nothing removed: keep the original
MARGIN = 0.04  # transparent border left around the trimmed subject, as a share of its longer side


def _get_session():
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                os.environ["U2NET_HOME"] = str(settings.BACKGROUND_MODEL_DIR)
                name = settings.BACKGROUND_MODEL
                model_file = settings.BACKGROUND_MODEL_DIR / "models" / name / f"{name}.onnx"
                if not model_file.exists() and not settings.BACKGROUND_MODEL_AUTO_DOWNLOAD:
                    raise FileNotFoundError(f"{model_file} is missing; run `manage.py download_background_model`")
                import onnxruntime as ort
                from rembg import new_session

                # Lean session: without these, onnxruntime's memory arena grows to ~1.7 GB per process;
                # with them it stays around 600 MB (photos take ~1.5 s instead of ~1 s).
                opts = ort.SessionOptions()
                opts.enable_cpu_mem_arena = False
                opts.enable_mem_pattern = False
                opts.intra_op_num_threads = settings.BACKGROUND_THREADS
                opts.inter_op_num_threads = 1
                _session = new_session(name, sess_opts=opts)
    return _session


def load_model():
    """Download (if needed) and load the model. Used by the management command at build time."""
    return _get_session()


def _mask_is_reliable(alpha: Image.Image) -> bool:
    hist = alpha.histogram()  # 256 buckets for an "L" image
    total = alpha.width * alpha.height
    visible = sum(hist[26:])  # alpha > ~10%
    solid = sum(hist[128:])
    soft = sum(hist[26:230])  # between ~10% and ~90%
    if not visible:
        return False
    if not (MIN_SUBJECT_SHARE <= solid / total <= MAX_SUBJECT_SHARE):
        return False
    return soft / visible <= MAX_SOFT_SHARE


def _trim(im: Image.Image) -> Image.Image:
    alpha = im.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > 12 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    pad = round(max(im.size) * MARGIN)
    canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad))
    return canvas


def remove_background(im: Image.Image) -> Image.Image | None:
    """Return the subject on a transparent background, trimmed, or None to keep the original."""
    if not settings.BACKGROUND_REMOVAL:
        return None
    try:
        session = _get_session()
        from rembg import remove

        with _run_lock:
            cut = remove(im.convert("RGB"), session=session)
    except Exception:
        log.exception("Background removal failed; keeping the original photo")
        return None
    cut = cut.convert("RGBA")
    if not _mask_is_reliable(cut.getchannel("A")):
        log.info("Background removal looked unreliable; keeping the original photo")
        return None
    return _trim(cut)


def wants_cutout(request) -> bool:
    """Upload views: remove the background unless the form sends remove_background=false."""
    value = str(request.data.get("remove_background", "true")).strip().lower()
    return value not in {"0", "false", "no", "off"}
