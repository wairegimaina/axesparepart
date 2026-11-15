from unittest import mock

from django.core.mail import EmailMultiAlternatives
from django.test import SimpleTestCase, override_settings


@override_settings(EMAIL_BACKEND="apps.notifications.brevo.BrevoEmailBackend", BREVO_API_KEY="test-key",
                   DEFAULT_FROM_EMAIL="Axe Spare Parts <no-reply@example.com>")
class BrevoBackendTests(SimpleTestCase):
    @mock.patch("apps.notifications.brevo.requests.post")
    def test_posts_text_and_html(self, post):
        post.return_value.status_code = 201
        msg = EmailMultiAlternatives("Reset", "Plain body", None, ["Jane <jane@example.com>"])
        msg.attach_alternative("<p>Hi</p>", "text/html")
        self.assertEqual(msg.send(), 1)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(post.call_args.kwargs["headers"]["api-key"], "test-key")
        self.assertEqual(payload["sender"], {"email": "no-reply@example.com", "name": "Axe Spare Parts"})
        self.assertEqual(payload["to"], [{"email": "jane@example.com", "name": "Jane"}])
        self.assertEqual(payload["textContent"], "Plain body")
        self.assertEqual(payload["htmlContent"], "<p>Hi</p>")

    @mock.patch("apps.notifications.brevo.requests.post")
    def test_api_error_raises(self, post):
        post.return_value.status_code = 401
        post.return_value.text = "unauthorized"
        with self.assertRaises(RuntimeError):
            EmailMultiAlternatives("Reset", "Body", None, ["a@example.com"]).send()
