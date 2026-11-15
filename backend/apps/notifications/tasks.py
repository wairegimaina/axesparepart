import logging

from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings

log = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_email(self, to: str, subject: str, body: str, html: str | None = None):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to], fail_silently=False, html_message=html)
    except Exception as exc:  # network / provider errors: retry later
        log.warning("Email to %s failed: %s", to, exc)
        raise self.retry(exc=exc)
