import json
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.inventory.models import SupplierListing
from apps.orders.models import OrderItem
from apps.orders.tests import test_orders as base
from apps.orders.tests.test_orders import client


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class SupplierOfferTests(TestCase):
    setUp = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout

    def offer(self, listing, **body):
        return client(self.a_owner).post(f"/api/supplier/listings/{listing.id}/deal/", {"percent": 20, **body}, format="json")

    def deals(self):
        return client().get("/api/products/?deals=1").json()["results"]

    def test_offer_waits_for_approval_then_discounts_everywhere(self):
        r = self.offer(self.a_oil, title="Service week")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["deal"]
        self.assertEqual((d["status"], d["customer_price"], d["supplier_price"]), ("pending", "880", "800.00"))
        self.assertEqual(self.deals(), [])  # not live until approved

        r = client(self.admin).post(f"/api/admin/listings/{self.a_oil.id}/approve-deal/", format="json")
        self.assertEqual(r.status_code, 200, r.content)
        card = self.deals()[0]
        self.assertEqual((card["slug"], card["deal_percent"], card["min_price"], card["was_price"]),
                         (self.oil.slug, 20, "880", "1100"))
        detail = client().get(f"/api/products/{self.oil.slug}/").json()
        offer = next(o for o in detail["offers"] if o["id"] == self.a_oil.id)
        self.assertEqual((offer["price"], offer["deal"]["was_price"], offer["deal"]["title"]), ("880", "1100", "Service week"))
        self.assertNotIn("Alpha", json.dumps(detail))  # customers still never see the supplier

        q = client().post("/api/cart/quote/", {"items": [{"listing_id": self.a_oil.id, "quantity": 2}]}, format="json").json()
        self.assertEqual(q["total"], "1760.00")
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 2}])
        item = OrderItem.objects.get(order__number=r.json()["number"])
        self.assertEqual((str(item.unit_price), str(item.supplier_unit_price)), ("880.00", "800.00"))

    def test_rejected_expired_and_ended_offers_are_not_shown(self):
        self.offer(self.a_oil)
        r = client(self.admin).post(f"/api/admin/listings/{self.a_oil.id}/reject-deal/", {"reason": "Too deep"}, format="json")
        self.assertEqual(r.json()["deal"]["note"], "Too deep")
        self.assertEqual(self.deals(), [])

        self.offer(self.a_oil, ends_at=(timezone.now() + timedelta(days=2)).isoformat())
        client(self.admin).post(f"/api/admin/listings/{self.a_oil.id}/approve-deal/", format="json")
        self.assertEqual(len(self.deals()), 1)
        SupplierListing.objects.filter(pk=self.a_oil.pk).update(deal_ends_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.deals(), [])
        self.assertEqual(SupplierListing.objects.get(pk=self.a_oil.pk).selling_price(), 1100)

        r = client(self.a_owner).delete(f"/api/supplier/listings/{self.a_oil.id}/deal/")
        self.assertEqual((r.status_code, r.json()["deal"]), (200, None))

    def test_only_owner_supplier_on_published_products(self):
        self.assertEqual(client(self.b_owner).post(f"/api/supplier/listings/{self.a_oil.id}/deal/", {"percent": 10},
                                                   format="json").status_code, 404)
        self.assertEqual(self.offer(self.a_oil, percent=95).status_code, 400)
        SupplierListing.objects.filter(pk=self.a_oil.pk).update(status="draft")
        self.assertEqual(self.offer(self.a_oil).status_code, 400)
