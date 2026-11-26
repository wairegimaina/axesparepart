from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import AuditLog
from apps.orders.models import Order


def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class AdminCustomerEditDeleteTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email="admin@t.ke", password="x-pass-12345", full_name="Admin")
        self.staff = User.objects.create_user(email="staff@t.ke", password="x-pass-12345", full_name="Staff",
                                              role=User.Role.ADMIN, admin_scope=User.AdminScope.ORDERS)
        self.cust = User.objects.create_user(email="c@t.ke", password="x-pass-12345", full_name="Wanjiku")
        User.objects.create_user(email="taken@t.ke", password="x-pass-12345", full_name="Other")

    def url(self, u=None):
        return f"/api/admin/customers/{(u or self.cust).id}/"

    def test_admin_edits_name_email_phone_and_sign_in(self):
        r = client(self.admin).patch(self.url(), {"full_name": "Wanjiku M", "email": "New@T.ke", "phone": "+254700000001",
                                                  "is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.cust.refresh_from_db()
        self.assertEqual((self.cust.full_name, self.cust.email, self.cust.phone, self.cust.is_active),
                         ("Wanjiku M", "new@t.ke", "+254700000001", False))
        self.assertTrue(AuditLog.objects.filter(action="customer.update", target_id=str(self.cust.id)).exists())

    def test_email_must_be_free_and_name_not_empty(self):
        r = client(self.admin).patch(self.url(), {"email": "taken@t.ke", "full_name": " "}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("email", r.json())
        self.assertIn("full_name", r.json())

    def test_delete_customer_without_orders(self):
        self.assertTrue(client(self.admin).get(self.url()).json()["can_delete"])
        r = client(self.admin).delete(self.url())
        self.assertEqual(r.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.cust.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action="customer.delete").exists())

    def test_customer_with_orders_cannot_be_deleted(self):
        Order.objects.create(customer=self.cust, subtotal=Decimal("100"), delivery_fee=Decimal("0"), total=Decimal("100"))
        self.assertFalse(client(self.admin).get(self.url()).json()["can_delete"])
        r = client(self.admin).delete(self.url())
        self.assertEqual(r.status_code, 409)
        self.assertTrue(User.objects.filter(pk=self.cust.pk).exists())

    def test_orders_staff_can_edit_but_not_delete(self):
        self.assertEqual(client(self.staff).patch(self.url(), {"phone": "+254711"}, format="json").status_code, 200)
        self.assertEqual(client(self.staff).delete(self.url()).status_code, 403)

    def test_only_customers(self):
        self.assertEqual(client(self.admin).delete(self.url(self.staff)).status_code, 404)
