from django.core import mail
from django.test import TestCase, override_settings

from apps.notifications.models import Notification
from apps.orders.tests import test_orders as base
from apps.orders.tests.test_orders import client
from apps.support.models import Ticket


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True,
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class SupportTests(TestCase):
    setUp = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout
    place = base.OrderFlowTests.place

    def open(self, user, **extra):
        body = {"subject": "Where is my order?", "category": "order", "body": "It has been 3 days.", **extra}
        return client(user).post("/api/support/tickets/", body, format="json")

    def test_customer_opens_ticket_admin_replies_customer_notified(self):
        number = self.place()["number"]
        with self.captureOnCommitCallbacks(execute=True):
            r = self.open(self.customer, order_number=number.lower())
        self.assertEqual(r.status_code, 201, r.content)
        t = r.json()
        self.assertEqual((t["status"], t["order_number"]), ("open", number))
        self.assertTrue(Notification.objects.filter(user=self.admin, kind="ticket_new").exists())

        path = f"/api/admin/tickets/{t['number']}/"
        client(self.admin).post(path + "reply/", {"body": "Checking with the courier.", "internal": True}, format="json")
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            a = client(self.admin).post(path + "reply/", {"body": "It arrives tomorrow."}, format="json").json()
        self.assertEqual((a["status"], a["assigned_to"]), ("answered", "Admin"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("AXE", mail.outbox[0].alternatives[0][0])  # branded HTML version

        mine = client(self.customer).get(f"/api/support/tickets/{t['number']}/").json()
        bodies = [m["body"] for m in mine["messages"]]
        self.assertNotIn("Checking with the courier.", bodies)  # internal note hidden
        self.assertEqual(mine["messages"][-1]["author"], "Axe Support")

        r = client(self.customer).post(f"/api/support/tickets/{t['number']}/reply/", {"body": "Thanks"}, format="json")
        self.assertEqual(r.json()["status"], "open")
        client(self.customer).post(f"/api/support/tickets/{t['number']}/resolve/")
        self.assertEqual(Ticket.objects.get().status, "resolved")

    def test_cannot_link_someone_elses_order_or_read_their_ticket(self):
        number = self.place()["number"]
        other = type(self.customer).objects.create_user(email="o@t.ke", password="x-pass-12345", full_name="Other")
        self.assertEqual(self.open(other, order_number=number).status_code, 404)
        t = self.open(self.customer).json()["number"]
        self.assertEqual(client(other).get(f"/api/support/tickets/{t}/").status_code, 404)
        self.assertEqual(client(other).get("/api/support/tickets/").json()["count"], 0)
        self.assertEqual(client(self.customer).get("/api/admin/tickets/").status_code, 403)

    def test_supplier_team_shares_tickets_and_only_links_own_fulfilment_orders(self):
        number = self.place()["number"]
        client(self.admin).post(f"/api/admin/orders/{number}/verify/")
        so_a = self.a.supplier_orders.get().number
        so_b = self.b.supplier_orders.get().number
        self.assertEqual(self.open(self.a_owner, order_number=so_b).status_code, 404)
        r = self.open(self.a_owner, order_number=so_a, category="payment", subject="When are we paid?")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["supplier_order_number"], so_a)
        # Another member of the same company sees it; the other supplier doesn't.
        mate = type(self.customer).objects.create_user(email="mate@t.ke", password="x-pass-12345", full_name="Mate",
                                                      role="supplier")
        self.a.members.create(user=mate, role="sales")
        self.assertEqual(client(mate).get("/api/support/tickets/").json()["count"], 1)
        self.assertEqual(client(self.b_owner).get("/api/support/tickets/").json()["count"], 0)
        t = Ticket.objects.get()
        with self.captureOnCommitCallbacks(execute=True):
            reply = client(self.admin).post(f"/api/admin/tickets/{t.number}/reply/", {"body": "Fridays."}, format="json")
        self.assertEqual(reply.status_code, 200)
        self.assertTrue(Notification.objects.filter(user=mate, kind="ticket_reply",
                                                    link=f"/supplier/support/{t.number}").exists())
        row = client(self.admin).get("/api/admin/tickets/?status=answered").json()["results"][0]
        self.assertEqual(row["requester"]["name"], "Alpha")

    def test_admin_assign_status_and_counts(self):
        t = self.open(self.customer).json()["number"]
        r = client(self.admin).patch(f"/api/admin/tickets/{t}/", {"assigned_to": self.admin.id, "priority": "high",
                                                                   "status": "resolved"}, format="json")
        self.assertEqual((r.json()["priority"], r.json()["status"]), ("high", "resolved"))
        r = client(self.admin).patch(f"/api/admin/tickets/{t}/", {"assigned_to": self.customer.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(client(self.admin).get("/api/admin/tickets/counts/").json()["resolved"], 1)


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True,
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class EmailPreferenceTests(TestCase):
    setUp = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout
    place = base.OrderFlowTests.place

    def test_turning_off_order_emails_keeps_in_app_notifications(self):
        prefs = client(self.customer).get("/api/notifications/preferences/").json()
        self.assertEqual([p["group"] for p in prefs], ["orders", "support"])
        r = client(self.customer).patch("/api/notifications/preferences/", {"orders": False, "bogus": False}, format="json")
        self.assertEqual([p["email"] for p in r.json()], [False, True])
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            self.place()
        self.assertFalse([m for m in mail.outbox if m.to == [self.customer.email]])
        self.assertTrue(Notification.objects.filter(user=self.customer, kind="order_placed").exists())

    def test_public_config_has_support_contacts(self):
        from apps.core.models import MarketplaceSettings
        MarketplaceSettings.objects.filter(pk=1).update(support_phone="+254700000001", support_whatsapp="254700000001")
        r = client().get("/api/config/").json()
        self.assertEqual(r["support"]["whatsapp"], "254700000001")
