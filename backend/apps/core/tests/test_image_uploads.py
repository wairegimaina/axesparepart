import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.exceptions import ValidationError

from apps.core.storage import sanitize_image


def make_image(fmt="JPEG", size=(64, 48), mode="RGB", **save_kwargs) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (200, 30, 30) if mode == "RGB" else None).save(buf, fmt, **save_kwargs)
    return buf.getvalue()


def as_upload(data: bytes, name="photo.jpg", content_type="image/jpeg"):
    return SimpleUploadedFile(name, data, content_type=content_type)


def reopen(clean) -> Image.Image:
    return Image.open(io.BytesIO(clean.read()))


class SanitizeImageTests(SimpleTestCase):
    def test_valid_formats_are_reencoded(self):
        for fmt, ext in (("JPEG", "jpg"), ("PNG", "png"), ("WEBP", "webp")):
            clean, got = sanitize_image(as_upload(make_image(fmt), f"x.{ext}"))
            self.assertEqual(got, ext)
            self.assertEqual(reopen(clean).format, fmt)

    def test_exif_and_gps_are_stripped(self):
        exif = Image.Exif()
        exif[0x010F] = "PhoneMaker"  # Make
        exif.get_ifd(0x8825)[1] = "S"  # GPS latitude ref
        exif.get_ifd(0x8825)[2] = (1.0, 17.0, 0.0)  # GPS latitude
        clean, _ = sanitize_image(as_upload(make_image("JPEG", exif=exif.tobytes())))
        data = clean.read()
        self.assertNotIn(b"PhoneMaker", data)
        self.assertNotIn(b"Exif", data)

    def test_rotation_is_applied_before_exif_is_dropped(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # Orientation: rotate 90° CW
        clean, _ = sanitize_image(as_upload(make_image("JPEG", size=(80, 40), exif=exif.tobytes())))
        self.assertEqual(reopen(clean).size, (40, 80))

    def test_polyglot_payload_is_removed(self):
        payload = b"<html><script>alert(document.cookie)</script></html>"
        clean, _ = sanitize_image(as_upload(make_image("JPEG") + payload))
        self.assertNotIn(b"<script>", clean.read())

    def test_script_in_png_text_chunk_is_removed(self):
        from PIL import PngImagePlugin

        info = PngImagePlugin.PngInfo()
        info.add_text("Comment", "<script>alert(1)</script>")
        clean, _ = sanitize_image(as_upload(make_image("PNG", pnginfo=info), "x.png"))
        self.assertNotIn(b"<script>", clean.read())

    def test_non_images_are_rejected(self):
        for data, name in (
            (b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "x.svg"),
            (b"<?php system($_GET['c']); ?>", "x.jpg"),
            (b"%PDF-1.7 not an image", "x.pdf"),
            (b"GIF89a" + b"\x00" * 40, "x.gif"),
        ):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                sanitize_image(as_upload(data, name))

    def test_fake_header_with_garbage_is_rejected(self):
        with self.assertRaises(ValidationError):
            sanitize_image(as_upload(b"\x89PNG\r\n\x1a\n" + b"\x00garbage" * 50, "x.png"))
        with self.assertRaises(ValidationError):
            sanitize_image(as_upload(b"\xff\xd8\xff\xe0" + b"<script>" * 50))

    def test_truncated_image_is_rejected(self):
        data = make_image("PNG", size=(300, 300))
        with self.assertRaises(ValidationError):
            sanitize_image(as_upload(data[: len(data) // 2], "x.png"))

    @override_settings(MAX_IMAGE_PIXELS=10_000)
    def test_decompression_bomb_is_rejected(self):
        # 200x200 = 40,000 px: tiny file, too many pixels for the limit.
        data = make_image("PNG", size=(200, 200), mode="L")
        with self.assertRaisesMessage(ValidationError, "too large"):
            sanitize_image(as_upload(data, "x.png"))

    @override_settings(MAX_IMAGE_UPLOAD_MB=0)
    def test_file_size_limit(self):
        with self.assertRaisesMessage(ValidationError, "too large"):
            sanitize_image(as_upload(make_image("JPEG")))

    @override_settings(MAX_IMAGE_SIDE=100)
    def test_large_photos_are_scaled_down(self):
        clean, _ = sanitize_image(as_upload(make_image("JPEG", size=(400, 200))))
        self.assertEqual(reopen(clean).size, (100, 50))

    def test_png_transparency_is_kept(self):
        clean, _ = sanitize_image(as_upload(make_image("PNG", mode="RGBA"), "x.png"))
        self.assertEqual(reopen(clean).mode, "RGBA")


def cutout_of(size=(100, 80), box=(30, 20, 70, 60), soft=False) -> Image.Image:
    """What the model would return: a subject inside `box`, transparent elsewhere."""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    im.paste(Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (200, 30, 30, 120 if soft else 255)), box[:2])
    return im


class _Request:
    def __init__(self, data):
        self.data = data


@override_settings(BACKGROUND_REMOVAL=True)
class BackgroundRemovalTests(SimpleTestCase):
    def run_with(self, model_output=None, error=None):
        from unittest import mock

        def fake_remove(im, session=None, **kwargs):
            if error:
                raise error
            return model_output

        with mock.patch("apps.core.background._get_session", return_value=object()), \
                mock.patch("rembg.remove", side_effect=fake_remove):
            return sanitize_image(as_upload(make_image("JPEG", size=(100, 80))), remove_background=True)

    def test_clean_cutout_is_trimmed_transparent_webp(self):
        clean, fmt = self.run_with(cutout_of())
        im = reopen(clean)
        self.assertEqual((fmt, im.format, im.mode), ("webp", "WEBP", "RGBA"))
        # 40x40 subject plus a 4% margin (2px) on every side
        self.assertEqual(im.size, (44, 44))
        self.assertEqual(im.getpixel((0, 0))[3], 0)
        self.assertEqual(im.getpixel((22, 22))[3], 255)

    def test_unreliable_mask_keeps_original(self):
        clean, fmt = self.run_with(cutout_of(soft=True))
        self.assertEqual((fmt, reopen(clean).size), ("jpg", (100, 80)))

    def test_tiny_or_empty_subject_keeps_original(self):
        for box in ((0, 0, 1, 1), (0, 0, 100, 80)):
            clean, fmt = self.run_with(cutout_of(box=box))
            self.assertEqual(fmt, "jpg", box)

    def test_model_error_keeps_original(self):
        with self.assertLogs("apps.core.background", "ERROR"):
            clean, fmt = self.run_with(error=RuntimeError("boom"))
        self.assertEqual((fmt, reopen(clean).size), ("jpg", (100, 80)))

    @override_settings(BACKGROUND_REMOVAL=False)
    def test_switched_off(self):
        clean, fmt = self.run_with(cutout_of())
        self.assertEqual(fmt, "jpg")

    def test_not_requested(self):
        clean, fmt = sanitize_image(as_upload(make_image("JPEG")))
        self.assertEqual(fmt, "jpg")

    def test_wants_cutout_reads_form_flag(self):
        from apps.core.background import wants_cutout

        self.assertTrue(wants_cutout(_Request({})))
        self.assertTrue(wants_cutout(_Request({"remove_background": "true"})))
        for off in ("false", "0", "no", "off", "False"):
            self.assertFalse(wants_cutout(_Request({"remove_background": off})), off)
