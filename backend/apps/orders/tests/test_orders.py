import json
from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalogue.models import Brand, Category, Product
from apps.core.models import MarketplaceSettings
from apps.inventory.models import StockMovement, SupplierListing
from apps.orders.models import Order, SupplierOrder
from apps.suppliers.models import Supplier, SupplierMember

ADDRESS = {"recipient_name": "Wanjiku M", "phone": "+254700123456", "county": "Nairobi", "town": "Westlands",
           "street_address": "Mpaka Rd, Block B", "delivery_notes": "Gate 2"}


def client(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class OrderFlowTests(TestCase):
    def setUp(self):
        MarketplaceSettings.objects.update_or_create(pk=1, defaults={
            "default_markup_percent": Decimal("10"), "delivery_fee": Decimal("300"),
            "free_delivery_threshold": Decimal("0"),
        })
        cat = Category.objects.create(name="Filters")
        brand = Brand.objects.create(name="Bosch")
        self.admin = User.objects.create_superuser(email="admin@t.ke", password="x-pass-12345", full_name="Admin")
        self.customer = User.objects.create_user(email="cust@t.ke", password="x-pass-12345", full_name="Wanjiku")
        self.a, self.a_owner = self._supplier("Alpha")
        self.b, self.b_owner = self._supplier("Beta")
        self.oil = Product.objects.create(name="Oil filter", category=cat, brand=brand, part_number="OF1", status="active")
        self.air = Product.objects.create(name="Air filter", category=cat, brand=brand, part_number="AF1", status="active")
        self.a_oil = self._listing(self.a, self.oil, "1000", 5)
        self.b_air = self._listing(self.b, self.air, "2000", 10)
        self.b_oil = self._listing(self.b, self.oil, "1100", 10)

    def _supplier(self, name):
        u = User.objects.create_user(email=f"{name.lower()}@t.ke", password="x-pass-12345", full_name=name,
                                     role=User.Role.SUPPLIER)
        s = Supplier.objects.create(name=name, status="approved", business_phone="+2547999", physical_address="Plot 1")
        SupplierMember.objects.create(supplier=s, user=u, role="owner")
        return s, u

    def _listing(self, supplier, product, price, qty):
        return SupplierListing.objects.create(supplier=supplier, product=product, supplier_price=Decimal(price),
                                              quantity=qty, status="approved")

    def checkout(self, items, user=None, **extra):
        body = {"items": items, "address": ADDRESS, **extra}
        return client(user or self.customer).post("/api/account/orders/", body, format="json")

    def place(self):
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 2}, {"listing_id": self.b_air.id, "quantity": 1}])
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def admin_post(self, path, body=None):
        r = client(self.admin).post(path, body or {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def so(self, supplier):
        return SupplierOrder.objects.get(supplier=supplier, order__number=self.number)

    # --- checkout --------------------------------------------------------------------------------

    def test_payment_method_is_agreed_on_the_call_not_at_checkout(self):
        o = self.place()
        self.assertEqual((o["payment_method"], o["payment_method_display"]), ("to_be_agreed", "To be agreed"))
        self.assertNotIn("payment_methods", client(self.customer).get("/api/checkout/options/").json())
        r = client(self.admin).post(f"/api/admin/orders/{o['number']}/payment/",
                                    {"amount": "100", "method": "to_be_agreed"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_checkout_splits_by_supplier_prices_on_server_and_reserves_stock(self):
        o = self.place()
        self.number = o["number"]
        self.assertEqual(o["subtotal"], "4400.00")  # 2×1100 + 1×2200
        self.assertEqual(o["delivery_fee"], "0.00")  # delivery is agreed on the confirmation call
        self.assertEqual(o["total"], "4400.00")
        verified = self.admin_post(f"/api/admin/orders/{o['number']}/verify/")  # no fee given: county standard
        self.assertEqual((verified["delivery_fee"], verified["total"]), ("300.00", "4700.00"))
        self.assertEqual(o["status"], "pending")
        self.assertEqual(SupplierOrder.objects.filter(order__number=o["number"]).count(), 2)
        self.a_oil.refresh_from_db()
        self.assertEqual(self.a_oil.quantity, 3)
        self.assertTrue(StockMovement.objects.filter(listing=self.a_oil, reason="order", change=-2).exists())
        self.assertEqual(client(self.customer).get("/api/account/addresses/").json()[0]["town"], "Westlands")

    def test_cannot_order_more_than_stock_or_below_moq(self):
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 6}])
        self.assertEqual(r.status_code, 400)
        self.assertIn(str(self.a_oil.id), r.json()["item_errors"])
        self.b_air.min_order_quantity = 3
        self.b_air.save()
        r = self.checkout([{"listing_id": self.b_air.id, "quantity": 2}])
        self.assertIn("minimum", r.json()["item_errors"][str(self.b_air.id)])
        self.assertEqual(Order.objects.count(), 0)

    def test_price_change_since_cart_is_rejected(self):
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], expected_total="999")
        self.assertEqual(r.status_code, 409)
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], expected_total="1100")
        self.assertEqual(r.status_code, 201, r.content)

    def test_unpublished_listing_cannot_be_ordered(self):
        self.a_oil.status = "pending"
        self.a_oil.save()
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}])
        self.assertEqual(r.status_code, 400)

    def test_guest_can_quote_but_only_customers_check_out(self):
        r = client().post("/api/cart/quote/", {"items": [{"listing_id": self.a_oil.id, "quantity": 1}]}, format="json")
        self.assertEqual(r.json()["total"], "1100.00")
        self.assertNotIn("1000", json.dumps(r.json()))  # supplier price stays private
        self.assertIn(self.checkout([{"listing_id": self.a_oil.id, "quantity": 1}], user=self.a_owner).status_code, (403,))
        self.assertEqual(client().post("/api/account/orders/", {}, format="json").status_code, 403)

    def test_customer_cancels_pending_order_and_stock_returns(self):
        self.number = self.place()["number"]
        r = client(self.customer).post(f"/api/account/orders/{self.number}/cancel/")
        self.assertEqual(r.json()["status"], "cancelled")
        self.a_oil.refresh_from_db()
        self.assertEqual(self.a_oil.quantity, 5)

    # --- privacy ---------------------------------------------------------------------------------

    def test_suppliers_see_nothing_until_verified_and_never_customer_details(self):
        self.number = self.place()["number"]
        self.assertEqual(client(self.a_owner).get("/api/supplier/orders/").json()["count"], 0)
        self.admin_post(f"/api/admin/orders/{self.number}/verify/")
        r = client(self.a_owner).get(f"/api/supplier/orders/{self.so(self.a).number}/")
        self.assertEqual(r.status_code, 200)
        text = r.content.decode()
        for secret in ("Wanjiku", "+254700123456", "Westlands", "Mpaka", "cust@t.ke", '"unit_price"', "1100", "2200"):
            self.assertNotIn(secret, text)
        self.assertEqual(r.json()["supplier_total"], "2000.00")
        # Alpha can't open Beta's part of the order, nor see the other customer orders
        self.assertEqual(client(self.a_owner).get(f"/api/supplier/orders/{self.so(self.b).number}/").status_code, 404)
        self.assertEqual(client(self.a_owner).get(f"/api/account/orders/{self.number}/").status_code, 403)
        other = User.objects.create_user(email="o@t.ke", password="x-pass-12345", full_name="O")
        self.assertEqual(client(other).get(f"/api/account/orders/{self.number}/").status_code, 404)

    def test_customer_view_hides_supplier_prices_and_internal_notes(self):
        self.number = self.place()["number"]
        client(self.admin).post(f"/api/admin/orders/{self.number}/note/", {"message": "Customer sounded unsure"})
        text = client(self.customer).get(f"/api/account/orders/{self.number}/").content.decode()
        self.assertNotIn("supplier_unit_price", text)
        self.assertNotIn("Customer sounded unsure", text)

    # --- full lifecycle ------------------------------------------------------------------------

    def test_full_lifecycle(self):
        self.number = self.place()["number"]
        o = self.admin_post(f"/api/admin/orders/{self.number}/verify/", {"delivery_fee": "450"})
        self.assertEqual((o["status"], o["total"]), ("confirmed", "4850.00"))

        for supplier, owner in ((self.a, self.a_owner), (self.b, self.b_owner)):
            num = self.so(supplier).number
            for step in ("accept", "start", "ready"):
                r = client(owner).post(f"/api/supplier/orders/{num}/{step}/")
                self.assertEqual(r.status_code, 200, (step, r.content))

        r = client(self.admin).post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "G4S"})
        self.assertEqual(r.status_code, 400)  # not collected yet
        for supplier in (self.a, self.b):
            self.admin_post(f"/api/admin/supplier-orders/{self.so(supplier).id}/collected/")
        self.assertEqual(client(self.customer).get(f"/api/account/orders/{self.number}/").json()["stage"], "ready")
        self.admin_post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "G4S", "tracking_number": "G-1"})
        self.admin_post(f"/api/admin/orders/{self.number}/deliver/")
        r = client(self.admin).post(f"/api/admin/orders/{self.number}/complete/")
        self.assertEqual(r.status_code, 400)  # unpaid
        o = self.admin_post(f"/api/admin/orders/{self.number}/payment/", {"amount": "4850", "method": "cash_on_delivery",
                                                                         "reference": "RCPT-9"})
        self.assertEqual(o["payment_status"], "paid")
        o = self.admin_post(f"/api/admin/orders/{self.number}/complete/")
        self.assertEqual(o["status"], "completed")
        self.assertEqual(self.so(self.a).status, "completed")

        timeline = [e["kind"] for e in client(self.customer).get(f"/api/account/orders/{self.number}/").json()["timeline"]]
        self.assertEqual(timeline[:3], ["placed", "delivery_fee", "confirmed"])
        self.assertIn("dispatched", timeline)
        sales = client(self.a_owner).get("/api/supplier/analytics/").json()["sales"]
        self.assertEqual(sales["sales_total"], "2000.00")
        self.assertEqual(sales["fulfilment_rate"], 100)

    def test_supplier_rejects_then_admin_reassigns_to_other_supplier(self):
        r = self.checkout([{"listing_id": self.a_oil.id, "quantity": 2}])
        self.number = r.json()["number"]
        self.admin_post(f"/api/admin/orders/{self.number}/verify/")
        num = self.so(self.a).number
        r = client(self.a_owner).post(f"/api/supplier/orders/{num}/reject/", {"reason": "Damaged stock"})
        self.assertEqual(r.json()["status"], "rejected")
        self.a_oil.refresh_from_db()
        self.assertEqual(self.a_oil.quantity, 5)

        item = Order.objects.get(number=self.number).items.get()
        alts = client(self.admin).get(f"/api/admin/order-items/{item.id}/alternatives/").json()
        self.assertEqual([a["listing_id"] for a in alts], [self.b_oil.id])
        self.admin_post(f"/api/admin/order-items/{item.id}/reassign/", {"listing_id": self.b_oil.id})
        b_so = self.so(self.b)
        self.assertEqual(b_so.status, "incoming")
        self.b_oil.refresh_from_db()
        self.assertEqual(self.b_oil.quantity, 8)
        order = Order.objects.get(number=self.number)
        self.assertEqual(order.total, Decimal("2500"))  # customer keeps the price they agreed (2×1100 + 300)
        self.assertEqual(client(self.b_owner).get(f"/api/supplier/orders/{b_so.number}/").json()["supplier_total"], "2200.00")

    def test_removing_items_recalculates_and_last_item_cancels(self):
        self.number = self.place()["number"]
        order = Order.objects.get(number=self.number)
        oil, air = order.items.order_by("id")
        self.admin_post(f"/api/admin/order-items/{air.id}/remove/", {"reason": "Discontinued"})
        order.refresh_from_db()
        self.assertEqual(order.total, Decimal("2200"))
        self.admin_post(f"/api/admin/order-items/{oil.id}/remove/", {"reason": "Customer changed mind"})
        order.refresh_from_db()
        self.assertEqual(order.status, "cancelled")
        self.b_air.refresh_from_db()
        self.assertEqual(self.b_air.quantity, 10)

    def test_dispatch_blocked_while_rejected_items_unresolved(self):
        self.number = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{self.number}/verify/")
        client(self.a_owner).post(f"/api/supplier/orders/{self.so(self.a).number}/reject/", {"reason": "No stock"})
        b = self.so(self.b).number
        for step in ("accept", "ready"):
            client(self.b_owner).post(f"/api/supplier/orders/{b}/{step}/")
        self.admin_post(f"/api/admin/supplier-orders/{self.so(self.b).id}/collected/")
        r = client(self.admin).post(f"/api/admin/orders/{self.number}/dispatch/", {"courier": "Own rider"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("rejected", r.json()[0])

    def test_free_delivery_threshold(self):
        MarketplaceSettings.objects.filter(pk=1).update(free_delivery_threshold=Decimal("2000"))
        r = client().post("/api/cart/quote/", {"items": [{"listing_id": self.b_air.id, "quantity": 1}]}, format="json")
        self.assertEqual(r.json()["delivery_fee"], "0.00")
