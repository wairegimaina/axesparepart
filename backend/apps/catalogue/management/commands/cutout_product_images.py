from pathlib import Path

import requests
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand
from django.test.utils import override_settings

from apps.catalogue.models import ProductImage
from apps.core import storage


class Command(BaseCommand):
    help = (
        "Remove the background from product photos uploaded before background removal existed. "
        "Each successful cut-out is stored as a new file and the photo is pointed at it; the original "
        "file is left in storage. Photos that can't be cut out cleanly are left unchanged."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would change without saving.")
        parser.add_argument("--product", type=int, help="Only this product id.")

    def _read(self, img: ProductImage) -> bytes:
        if img.url.startswith(("http://", "https://")):
            r = requests.get(img.url, timeout=30)
            r.raise_for_status()
            return r.content
        ext = img.url.rsplit(".", 1)[-1]
        root = Path(settings.MEDIA_ROOT).resolve()
        path = (root / f"{img.public_id}.{ext}").resolve()
        if root not in path.parents:
            raise ValueError("path outside MEDIA_ROOT")
        return path.read_bytes()

    def handle(self, *args, dry_run=False, product=None, **options):
        qs = ProductImage.objects.all().order_by("id")
        if product:
            qs = qs.filter(product_id=product)
        done = kept = failed = 0
        with override_settings(BACKGROUND_REMOVAL=True):
            for img in qs:
                label = f"image {img.id} (product {img.product_id})"
                try:
                    data = self._read(img)
                    with storage.Image.open(SimpleUploadedFile("x", data)) as probe:
                        if probe.mode in ("RGBA", "LA") and probe.getchannel("A").getextrema()[0] < 255:
                            kept += 1
                            self.stdout.write(f"{label}: already transparent, skipped")
                            continue
                    _, fmt = storage.sanitize_image(SimpleUploadedFile("photo", data), remove_background=True)
                    if fmt != "webp":
                        kept += 1
                        self.stdout.write(f"{label}: couldn't cut out cleanly, kept as is")
                        continue
                    if dry_run:
                        done += 1
                        self.stdout.write(f"{label}: would be cut out")
                        continue
                    stored = storage.upload_image(
                        SimpleUploadedFile("photo", data), f"products/{img.product_id}", remove_background=True
                    )
                    img.url, img.public_id = stored.url, stored.public_id
                    img.save(update_fields=["url", "public_id"])
                    done += 1
                    self.stdout.write(self.style.SUCCESS(f"{label}: cut out"))
                except Exception as exc:  # one bad file shouldn't stop the rest
                    failed += 1
                    self.stderr.write(f"{label}: failed ({exc})")
        verb = "would be cut out" if dry_run else "cut out"
        self.stdout.write(f"\n{done} {verb}, {kept} left as they were, {failed} failed.")
