"""
Send email through Brevo's HTTPS API instead of SMTP.

Some hosts (Render's free plan among them) block outgoing SMTP ports; HTTPS on 443 always works.
Enable with EMAIL_BACKEND=apps.notifications.brevo.BrevoEmailBackend and BREVO_API_KEY=xkeysib-...
"""

from email.utils import getaddresses, parseaddr

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

API_URL = "https://api.brevo.com/v3/smtp/email"


def _contacts(addresses):
    return [{"email": email, **({"name": name} if name else {})} for name, email in getaddresses(addresses) if email]


class BrevoEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        key = getattr(settings, "BREVO_API_KEY", "")
        if not key:
            if self.fail_silently:
                return 0
            raise RuntimeError("BREVO_API_KEY is not set.")
        sent = 0
        for message in email_messages:
            name, sender = parseaddr(message.from_email or settings.DEFAULT_FROM_EMAIL)
            payload = {
                "sender": {"email": sender, **({"name": name} if name else {})},
                "to": _contacts(message.to),
                "subject": message.subject,
                "textContent": message.body or " ",
            }
            if message.cc:
                payload["cc"] = _contacts(message.cc)
            if message.bcc:
                payload["bcc"] = _contacts(message.bcc)
            if message.reply_to:
                payload["replyTo"] = _contacts(message.reply_to)[0]
            for content, mimetype in getattr(message, "alternatives", []):
                if mimetype == "text/html":
                    payload["htmlContent"] = content
            try:
                response = requests.post(
                    API_URL, json=payload, timeout=settings.EMAIL_TIMEOUT,
                    headers={"api-key": key, "accept": "application/json"},
                )
                if response.status_code >= 400:
                    raise RuntimeError(f"Brevo API {response.status_code}: {response.text[:300]}")
            except Exception:
                if not self.fail_silently:
                    raise
                continue
            sent += 1
        return sent
