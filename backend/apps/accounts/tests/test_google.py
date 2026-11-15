from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import MarketplaceSettings

VERIFY = "apps.accounts.views.verify_google_credential"


def token(email="jane@gmail.com", verified=True, name="Jane Wanjiru"):
    return {"email": email, "email_verified": verified, "name": name}


class GoogleLoginTests(TestCase):
    def setUp(self):
        s = MarketplaceSettings.load()
        s.google_client_id = "test-client.apps.googleusercontent.com"
        s.save()
        self.c = APIClient()

    def post(self):
        return self.c.post("/api/auth/google/", {"credential": "x"}, format="json")

    def test_new_email_creates_customer_and_signs_in(self):
        with mock.patch(VERIFY, return_value=token()) as v:
            r = self.post()
        self.assertEqual(r.status_code, 201)
        v.assert_called_once_with("x", "test-client.apps.googleusercontent.com")
        u = User.objects.get(email="jane@gmail.com")
        self.assertEqual((u.role, u.full_name, u.has_usable_password()), ("customer", "Jane Wanjiru", False))
        self.assertEqual(self.c.get("/api/auth/me/").json()["email"], "jane@gmail.com")

    def test_existing_account_signs_in(self):
        User.objects.create_user(email="jane@gmail.com", password="pw-123456!", full_name="Jane")
        with mock.patch(VERIFY, return_value=token(email="Jane@Gmail.com")):
            self.assertEqual(self.post().status_code, 200)
        self.assertEqual(User.objects.count(), 1)

    def test_rejections(self):
        User.objects.create_superuser(email="boss@gmail.com", password="pw-123456!", full_name="Boss")
        with mock.patch(VERIFY, return_value=token(email="boss@gmail.com")):
            self.assertEqual(self.post().status_code, 400)  # admins use their password
        with mock.patch(VERIFY, return_value=token(verified=False)):
            self.assertEqual(self.post().status_code, 400)
        with mock.patch(VERIFY, side_effect=ValueError("bad token")):
            self.assertEqual(self.post().status_code, 400)
        self.assertEqual(self.c.get("/api/auth/me/").status_code, 403)
        s = MarketplaceSettings.load()
        s.google_client_id = ""
        s.save()
        with mock.patch(VERIFY, return_value=token()):
            self.assertEqual(self.post().status_code, 400)
        self.assertFalse(User.objects.filter(email="jane@gmail.com").exists())

    def test_config_exposes_client_id(self):
        self.assertEqual(self.c.get("/api/config/").json()["google_client_id"], "test-client.apps.googleusercontent.com")
