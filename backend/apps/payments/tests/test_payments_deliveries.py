from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.models import MarketplaceSettings
from apps.deliveries.models import DeliveryRate
from apps.orders.models import Order
from apps.orders.tests import test_orders as base
from apps.orders.tests.test_orders import ADDRESS, client


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class PaymentsAndDeliveriesTests(TestCase):
    # Reuse the order-flow fixtures without re-running those tests.
    setUp = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout
    place = base.OrderFlowTests.place
    admin_post = base.OrderFlowTests.admin_post
    so = base.OrderFlowTests.so

    def to_ready(self):
        """Place, confirm, and collect from both suppliers."""
        self.number = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{self.number}/verify/")
        for supplier, owner in ((self.a, self.a_owner), (self.b, self.b_owner)):
            for step in ("accept", "ready"):
                client(owner).post(f"/api/supplier/orders/{self.so(supplier).number}/{step}/")
            self.admin_post(f"/api/admin/supplier-orders/{self.so(supplier).id}/collected/")

    # --- delivery rates ---------------------------------------------------------------------------

    def test_county_rate_sets_fee_and_days(self):
        DeliveryRate.objects.create(county="Mombasa", fee=Decimal("800"), days_min=2, days_max=4)
        body = {"items": [{"listing_id": self.a_oil.id, "quantity": 1}]}
        r = client().post("/api/cart/quote/", {**body, "county": "mombasa"}, format="json").json()
        self.assertEqual((r["delivery_fee"], r["delivery_days"]), ("0.00", [2, 4]))  # fee is agreed on the call
        r = client().post("/api/cart/quote/", {**body, "county": "Kisumu"}, format="json").json()
        self.assertEqual(r["delivery_days"], None)
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], address={**ADDRESS, "county": "Mombasa"})
        self.assertEqual(r.json()["delivery_fee"], "0.00")
        number = r.json()["number"]
        self.assertEqual(client(self.admin).get(f"/api/admin/orders/{number}/").json()["suggested_delivery_fee"], "800.00")
        self.assertEqual(self.admin_post(f"/api/admin/orders/{number}/verify/")["delivery_fee"], "800.00")

    def test_free_delivery_beats_county_rate(self):
        DeliveryRate.objects.create(county="Nairobi", fee=Decimal("200"))
        MarketplaceSettings.objects.filter(pk=1).update(free_delivery_threshold=Decimal("1000"))
        r = client().post("/api/cart/quote/", {"items": [{"listing_id": self.a_oil.id, "quantity": 1}],
                                               "county": "Nairobi"}, format="json").json()
        self.assertEqual(r["delivery_fee"], "0.00")

    def test_no_delivery_to_switched_off_county(self):
        DeliveryRate.objects.create(county="Mandera", fee=Decimal("2000"), is_active=False)
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], address={**ADDRESS, "county": "Mandera"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Mandera", str(r.json()))
        self.assertEqual(Order.objects.count(), 0)

    def test_unknown_county_rejected_and_names_normalised(self):
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], address={**ADDRESS, "county": "Atlantis"})
        self.assertEqual(r.status_code, 400)
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], address={**ADDRESS, "county": "nairobi"})
        self.assertEqual(r.json()["county"], "Nairobi")

    def test_county_list_and_rate_admin_only(self):
        rows = client().get("/api/delivery/counties/").json()
        self.assertEqual(len(rows), 47)
        self.assertEqual(client(self.customer).post("/api/admin/delivery-rates/", {"county": "Nakuru", "fee": "1"}).status_code, 403)
        r = client(self.admin).post("/api/admin/delivery-rates/", {"county": "Nakuru", "fee": "650", "days_min": 3,
                                                                   "days_max": 1}, format="json")
        self.assertEqual(r.status_code, 400)  # max < min
        r = client(self.admin).post("/api/admin/delivery-rates/", {"county": "Nakuru", "fee": "650", "days_min": 1,
                                                                   "days_max": 2}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        nakuru = next(c for c in client().get("/api/delivery/counties/").json() if c["county"] == "Nakuru")
        self.assertEqual((nakuru["fee"], nakuru["days_max"]), ("650.00", 2))

    # --- deliveries -------------------------------------------------------------------------------

    def test_dispatch_sets_expected_date_and_failed_delivery_returns_to_queue(self):
        DeliveryRate.objects.create(county="Nairobi", fee=Decimal("300"), days_min=1, days_max=2)
        self.to_ready()
        ready = client(self.admin).get("/api/admin/orders/?view=ready_to_dispatch").json()["results"]
        self.assertEqual([o["number"] for o in ready], [self.number])
        o = self.admin_post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "Rider Otieno",
                                                                          "courier_phone": "+254711000111"})
        self.assertEqual(o["expected_delivery_date"], str(timezone.localdate() + timedelta(days=2)))
        cust = client(self.customer).get(f"/api/account/orders/{self.number}/").json()
        self.assertEqual(cust["courier_phone"], "+254711000111")

        r = client(self.admin).post(f"/api/admin/orders/{self.number}/delivery-failed/", {"reason": ""}, format="json")
        self.assertEqual(r.status_code, 400)
        o = self.admin_post(f"/api/admin/orders/{self.number}/delivery-failed/", {"reason": "Customer not reachable."})
        self.assertEqual((o["status"], o["delivery_attempts"], o["attention"]), ("confirmed", 1, "Ready to dispatch"))
        timeline = client(self.customer).get(f"/api/account/orders/{self.number}/").json()["timeline"]
        self.assertIn("not reachable", timeline[-1]["message"])
        self.admin_post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "Rider Otieno"})
        self.admin_post(f"/api/admin/orders/{self.number}/deliver/")

    def test_overdue_delivery_flagged(self):
        self.to_ready()
        yesterday = timezone.localdate() - timedelta(days=1)
        self.admin_post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "G4S",
                                                                      "expected_delivery_date": str(yesterday)})
        rows = client(self.admin).get("/api/admin/orders/?view=out_for_delivery").json()["results"]
        self.assertEqual(rows[0]["attention"], "Delivery overdue")

    # --- refunds ----------------------------------------------------------------------------------

    def test_paid_then_cancelled_order_is_refunded(self):
        self.number = self.place()["number"]  # total 4700
        self.admin_post(f"/api/admin/orders/{self.number}/payment/", {"amount": "4700", "method": "bank_transfer"})
        self.admin_post(f"/api/admin/orders/{self.number}/cancel/", {"reason": "Customer no longer needs it"})
        o = client(self.admin).get(f"/api/admin/orders/{self.number}/").json()
        self.assertEqual((o["refund_due"], o["balance_due"], o["attention"]), ("4700.00", "0.00", "Refund due"))
        self.assertEqual(client(self.admin).get("/api/admin/orders/?view=refund_due").json()["count"], 1)

        r = client(self.admin).post(f"/api/admin/orders/{self.number}/refund/",
                                    {"amount": "5000", "method": "bank_transfer", "reason": "x"}, format="json")
        self.assertEqual(r.status_code, 400)  # more than received
        o = self.admin_post(f"/api/admin/orders/{self.number}/refund/",
                            {"amount": "4700", "method": "bank_transfer", "reason": "Order cancelled", "reference": "TRX-1"})
        self.assertEqual((o["payment_status"], o["refund_due"], o["attention"]), ("refunded", "0.00", ""))
        cust = client(self.customer).get(f"/api/account/orders/{self.number}/").json()
        self.assertEqual(cust["refunds"][0]["amount"], "4700.00")
        self.assertIn("refund", [e["kind"] for e in cust["timeline"]])

    def test_removed_item_after_payment_leaves_partial_refund(self):
        self.number = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{self.number}/payment/", {"amount": "4400", "method": "bank_transfer"})
        air = Order.objects.get(number=self.number).items.get(listing=self.b_air)
        self.admin_post(f"/api/admin/order-items/{air.id}/remove/", {"reason": "Discontinued"})
        o = client(self.admin).get(f"/api/admin/orders/{self.number}/").json()
        self.assertEqual((o["total"], o["refund_due"], o["payment_status"]), ("2200.00", "2200.00", "paid"))
        o = self.admin_post(f"/api/admin/orders/{self.number}/refund/",
                            {"amount": "2200", "method": "cash", "reason": "Air filter removed"})
        self.assertEqual((o["payment_status"], o["refund_due"], o["balance_due"]), ("paid", "0.00", "0.00"))

    def test_finance_summary_and_lists(self):
        self.number = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{self.number}/payment/", {"amount": "1000", "method": "bank_transfer",
                                                                     "reference": "ABC"})
        s = client(self.admin).get("/api/admin/payments/summary/").json()
        self.assertEqual((s["received"], s["outstanding"], s["outstanding_orders"]), ("1000.00", "3400.00", 1))
        rows = client(self.admin).get("/api/admin/payments/?search=ABC").json()["results"]
        self.assertEqual(rows[0]["order"]["number"], self.number)
        self.assertEqual(client(self.customer).get("/api/admin/payments/").status_code, 403)
        self.assertEqual(client(self.a_owner).get("/api/admin/refunds/").status_code, 403)
