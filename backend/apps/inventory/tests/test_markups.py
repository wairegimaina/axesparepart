from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalogue.models import Brand, Category, Product
from apps.core.models import MarketplaceSettings
from apps.inventory.models import SupplierListing
from apps.inventory.pricing import Markups
from apps.orders.models import OrderItem
from apps.suppliers.models import Supplier, SupplierMember

ADDRESS = {"recipient_name": "Wanjiku M", "phone": "+254700123456", "county": "Nairobi", "town": "Westlands",
           "street_address": "Mpaka Rd", "delivery_notes": ""}


def client(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class CategoryMarkupAndSupplierShareTests(TestCase):
    def setUp(self):
        MarketplaceSettings.objects.update_or_create(pk=1, defaults={
            "default_markup_percent": Decimal("10"), "delivery_fee": Decimal("0"), "free_delivery_threshold": Decimal("0"),
        })
        self.engine = Category.objects.create(name="Engine", markup_percent=Decimal("20"))
        self.pistons = Category.objects.create(name="Pistons", parent=self.engine)  # inherits 20
        self.rings = Category.objects.create(name="Rings", parent=self.pistons, markup_percent=Decimal("30"))
        self.tyres = Category.objects.create(name="Tyres")  # default 10
        brand = Brand.objects.create(name="Bajaj")
        self.admin = User.objects.create_superuser(email="admin@t.ke", password="x-pass-12345", full_name="Admin")
        self.customer = User.objects.create_user(email="c@t.ke", password="x-pass-12345", full_name="Cust")
        self.owner = User.objects.create_user(email="s@t.ke", password="x-pass-12345", full_name="Sup",
                                              role=User.Role.SUPPLIER)
        self.supplier = Supplier.objects.create(name="Alpha", status="approved", business_phone="+2547",
                                                physical_address="Plot 1", markup_share_percent=Decimal("5"))
        SupplierMember.objects.create(supplier=self.supplier, user=self.owner, role="owner")
        self.piston = self._listing(self._product("Piston kit", self.pistons, "PK1"), "1000")
        self.ring = self._listing(self._product("Ring set", self.rings, "RS1"), "1000")
        self.tyre = self._listing(self._product("Tyre", self.tyres, "TY1"), "1000")

    def _product(self, name, cat, pn):
        return Product.objects.create(name=name, category=cat, brand=Brand.objects.first(), part_number=pn,
                                      status="active")

    def _listing(self, product, price):
        return SupplierListing.objects.create(supplier=self.supplier, product=product, supplier_price=Decimal(price),
                                              quantity=10, status="approved")

    def order(self, listing, qty=1):
        r = client(self.customer).post("/api/account/orders/", {
            "items": [{"listing_id": listing.id, "quantity": qty}], "address": ADDRESS}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return OrderItem.objects.get(order__number=r.json()["number"])

    # --- category markups ------------------------------------------------------------------------

    def test_markup_comes_from_the_category_or_its_nearest_parent_else_the_default(self):
        m = Markups.load()
        self.assertEqual(m.for_category(self.engine.id), Decimal("20"))
        self.assertEqual(m.for_category(self.pistons.id), Decimal("20"))
        self.assertEqual(m.for_category(self.rings.id), Decimal("30"))
        self.assertEqual(m.for_category(self.tyres.id), Decimal("10"))
        self.assertEqual([self.piston.regular_price(m), self.ring.regular_price(m), self.tyre.regular_price(m)],
                         [Decimal("1200"), Decimal("1300"), Decimal("1100")])

    def test_shop_pages_and_checkout_charge_the_category_price(self):
        prices = {p["name"]: p["min_price"] for p in client().get("/api/products/").json()["results"]}
        self.assertEqual(prices, {"Piston kit": "1200", "Ring set": "1300", "Tyre": "1100"})
        sort = [p["name"] for p in client().get("/api/products/?sort=price_desc").json()["results"]]
        self.assertEqual(sort, ["Ring set", "Piston kit", "Tyre"])
        detail = client().get(f"/api/products/{self.ring.product.slug}/").json()
        self.assertEqual(detail["offers"][0]["price"], "1300")
        self.assertEqual(self.order(self.ring).unit_price, Decimal("1300"))

    def test_admin_sets_category_markup_and_sees_what_applies(self):
        r = client(self.admin).patch(f"/api/admin/categories/{self.tyres.id}/", {"markup_percent": "15"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        cats = {c["name"]: c for c in client(self.admin).get("/api/admin/categories/").json()}
        self.assertEqual((cats["Pistons"]["markup_percent"], cats["Pistons"]["effective_markup_percent"]), (None, "20.00"))
        self.assertEqual(cats["Tyres"]["effective_markup_percent"], "15.00")
        self.assertEqual(self.order(self.tyre).unit_price, Decimal("1150"))

    # --- supplier share --------------------------------------------------------------------------

    def test_supplier_gets_their_share_of_the_markup_on_each_sale(self):
        item = self.order(self.piston, qty=2)  # customer 1200, supplier 1000 + 5% share
        self.assertEqual((item.unit_price, item.supplier_unit_price, item.supplier_share),
                         (Decimal("1200"), Decimal("1050.00"), Decimal("50.00")))
        self.assertEqual(item.supplier_line_total, Decimal("2100.00"))

    def test_share_never_exceeds_the_markup_or_what_the_customer_pays(self):
        self.supplier.markup_share_percent = Decimal("50")
        self.supplier.save()
        self.assertEqual(self.piston.supplier_payout(), Decimal("1200.00"))  # capped at the 20% markup
        self.piston.price_override = Decimal("1030")
        self.piston.save()
        self.assertEqual(self.piston.supplier_share(), Decimal("30.00"))  # only 30 above their price
        self.piston.price_override = Decimal("900")
        self.piston.save()
        self.assertEqual(self.piston.supplier_payout(), Decimal("1000"))  # never below their own price

    def test_no_share_on_parts_whose_markup_is_below_the_minimum(self):
        self.tyres.markup_percent = Decimal("2")
        self.tyres.save()
        item = self.order(self.tyre)  # 2% < 5% minimum: Axe keeps the whole 20
        self.assertEqual((item.unit_price, item.supplier_unit_price, item.supplier_share),
                         (Decimal("1020"), Decimal("1000.00"), Decimal("0.00")))
        self.tyres.markup_percent = Decimal("5")
        self.tyres.save()
        self.assertEqual(self.tyre.supplier_share(), Decimal("50.00"))  # at the minimum, the share applies
        r = client(self.admin).patch("/api/admin/settings/", {"share_min_markup_percent": "0"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.tyres.markup_percent = Decimal("2")
        self.tyres.save()
        self.assertEqual(self.tyre.supplier_share(), Decimal("20.00"))  # 0 = always share

    def test_supplier_sees_what_they_receive_but_cannot_change_their_share(self):
        listings = {x["product"]["name"]: x for x in client(self.owner).get("/api/supplier/listings/").json()["results"]}
        self.assertEqual((listings["Ring set"]["markup_share"], listings["Ring set"]["you_receive"]), ("50.00", "1050.00"))
        r = client(self.owner).patch("/api/supplier/profile/", {"markup_share_percent": "40"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.supplier.refresh_from_db()
        self.assertEqual(self.supplier.markup_share_percent, Decimal("5"))
        self.assertEqual(r.json()["markup_share_percent"], "5.00")
        item = self.order(self.ring)
        r = client(self.admin).post(f"/api/admin/orders/{item.order.number}/verify/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)  # suppliers see orders once confirmed
        so = client(self.owner).get(f"/api/supplier/orders/{item.supplier_order.number}/").json()
        self.assertEqual((so["items"][0]["supplier_unit_price"], so["items"][0]["supplier_share"]), ("1050.00", "50.00"))
        self.assertEqual(so["supplier_total"], "1050.00")

    def test_admin_sets_supplier_share(self):
        r = client(self.admin).patch(f"/api/admin/suppliers/{self.supplier.id}/", {"markup_share_percent": "8"},
                                     format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.supplier.refresh_from_db()
        self.assertEqual(self.supplier.markup_share_percent, Decimal("8"))
        r = client(self.admin).patch(f"/api/admin/suppliers/{self.supplier.id}/", {"markup_share_percent": "120"},
                                     format="json")
        self.assertEqual(r.status_code, 400)
