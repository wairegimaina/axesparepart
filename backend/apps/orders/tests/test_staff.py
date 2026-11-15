import json

from django.test import TestCase, override_settings

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.orders.models import Order
from apps.orders.tests import test_orders as base
from apps.orders.tests.test_orders import client


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class OrdersStaffAndCallTests(TestCase):
    setUp_base = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout
    place = base.OrderFlowTests.place

    def setUp(self):
        self.setUp_base()
        self.staff = User.objects.create_user(email="caller@t.ke", password="x-pass-12345", full_name="Caller",
                                              role=User.Role.ADMIN, admin_scope=User.AdminScope.ORDERS)
        self.number = self.place()["number"]

    def test_orders_staff_reach_order_pages_only(self):
        c = client(self.staff)
        for path in ("/api/admin/orders/", f"/api/admin/orders/{self.number}/", "/api/admin/dashboard/",
                     "/api/admin/payments/", "/api/admin/customers/", "/api/admin/tickets/"):
            self.assertEqual(c.get(path).status_code, 200, path)
        for path in ("/api/admin/settings/", "/api/admin/suppliers/", "/api/admin/payouts/", "/api/admin/team/",
                     "/api/admin/reports/sales/", "/api/admin/listings/", "/api/admin/audit-logs/"):
            self.assertEqual(c.get(path).status_code, 403, path)
        self.assertEqual(c.post(f"/api/admin/orders/{self.number}/refund/",
                                {"amount": "1", "method": "bank_transfer"}, format="json").status_code, 403)
        self.assertEqual(c.get("/api/auth/me/").json()["admin_scope"], "orders")

    def test_orders_staff_never_see_supplier_costs(self):
        body = json.dumps(client(self.staff).get(f"/api/admin/orders/{self.number}/").json())
        for key in ("supplier_cost", "supplier_unit_price", "supplier_line_total"):
            self.assertNotIn(key, body)
        self.assertIn("supplier_cost", json.dumps(client(self.admin).get(f"/api/admin/orders/{self.number}/").json()))

    def test_no_answer_keeps_order_in_call_list_and_tells_customer(self):
        r = client(self.staff).post(f"/api/admin/orders/{self.number}/no-answer/", {"reason": "Phone off"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual((d["status"], d["call_attempts"]), ("pending", 1))
        self.assertTrue(d["attention"].startswith("Call again"))
        self.assertTrue(Notification.objects.filter(user=self.customer, kind="order_call_missed").exists())
        mine = client(self.customer).get(f"/api/account/orders/{self.number}/").json()
        self.assertIn("couldn't reach you", json.dumps(mine["timeline"]))
        self.assertNotIn("Phone off", json.dumps(mine))  # the staff note stays internal

        dash = client(self.staff).get("/api/admin/dashboard/").json()
        self.assertEqual(dash["to_call_count"], 1)
        self.assertEqual(dash["to_call"][0]["call_attempts"], 1)
        self.assertEqual(dash["today"]["orders"], 1)

        client(self.staff).post(f"/api/admin/orders/{self.number}/verify/", {}, format="json")
        self.assertEqual(Order.objects.get(number=self.number).status, "confirmed")
        r = client(self.staff).post(f"/api/admin/orders/{self.number}/no-answer/", {}, format="json")
        self.assertEqual(r.status_code, 400)  # only while waiting for confirmation

    def test_call_list_puts_never_called_first(self):
        second = self.place()["number"]
        client(self.admin).post(f"/api/admin/orders/{self.number}/no-answer/", {}, format="json")
        rows = client(self.admin).get("/api/admin/orders/?view=to_call").json()["results"]
        self.assertEqual([r["number"] for r in rows], [second, self.number])

    def test_full_admin_manages_team(self):
        c = client(self.admin)
        r = c.post("/api/admin/team/", {"email": "New@T.ke", "full_name": "New Caller", "phone": "+254700000001",
                                        "admin_scope": "orders"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        u = User.objects.get(email="new@t.ke")
        self.assertEqual((u.role, u.admin_scope, u.has_usable_password()), ("admin", "orders", False))
        self.assertEqual(c.post("/api/admin/team/", {"email": "new@t.ke", "full_name": "X"}, format="json").status_code, 400)
        self.assertEqual(c.patch(f"/api/admin/team/{u.id}/", {"is_active": False}, format="json").status_code, 200)
        self.assertEqual(c.patch(f"/api/admin/team/{self.admin.id}/", {"admin_scope": "orders"}, format="json").status_code, 400)
        self.assertEqual(len(c.get("/api/admin/team/").json()), 3)
        self.assertEqual(client(self.staff).post("/api/admin/team/", {"email": "z@t.ke", "full_name": "Z"},
                                                 format="json").status_code, 403)
