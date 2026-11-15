from django.conf import settings
from django.core.management.base import BaseCommand
from django.test.utils import override_settings


class Command(BaseCommand):
    help = "Download and load the product photo background-removal model (run at build time)."

    def handle(self, *args, **options):
        if not settings.BACKGROUND_REMOVAL:
            self.stdout.write("BACKGROUND_REMOVAL is off; nothing to download.")
            return
        from apps.core import background

        with override_settings(BACKGROUND_MODEL_AUTO_DOWNLOAD=True):
            background.load_model()
        self.stdout.write(self.style.SUCCESS(
            f"Background model {settings.BACKGROUND_MODEL} ready in {settings.BACKGROUND_MODEL_DIR}"
        ))
