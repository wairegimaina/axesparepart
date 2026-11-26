from decimal import Decimal
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalogue.models import Brand, Category, Product
from apps.core.models import MarketplaceSettings
from apps.inventory.models import SupplierListing
from apps.suppliers.models import Supplier, SupplierMember

PDF = b"%PDF-1.4\n%test\n"


def make_supplier(name, approved=True, role=SupplierMember.Role.OWNER, email=None):
    user = User.objects.create_user(email=email or f"{name.lower().replace(' ', '')}@test.ke", password="x-pass-12345",
                                    full_name=name, role=User.Role.SUPPLIER)
    supplier = Supplier.objects.create(
        name=name, status=Supplier.Status.APPROVED if approved else Supplier.Status.PENDING,
        business_phone="+254711111111", business_email="secret@company.ke", registration_number="PVT-123",
        physical_address="Plot 7, Secret Road",
    )
    SupplierMember.objects.create(supplier=supplier, user=user, role=role)
    return supplier, user


def client_for(user):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class MarketplaceTests(TestCase):
    def setUp(self):
        MarketplaceSettings.objects.update_or_create(pk=1, defaults={"default_markup_percent": Decimal("20")})
        parent = Category.objects.create(name="Automotive")
        self.category = Category.objects.create(name="Filters", parent=parent)
        self.brand = Brand.objects.create(name="Bosch")
        self.admin = User.objects.create_superuser(email="admin@test.ke", password="x-pass-12345", full_name="Admin")
        self.supplier, self.owner = make_supplier("Alpha Spares")
        self.other_supplier, self.other_owner = make_supplier("Beta Spares")
        self.customer = User.objects.create_user(email="c@test.ke", password="x-pass-12345", full_name="Cust")

    def create_listing(self, user, part_number="0 451 103 316", price="1000", **extra):
        payload = {
            "product_details": {"name": "Oil filter", "category_id": self.category.id, "brand_id": self.brand.id,
                                "part_number": part_number,
                                "specifications": [{"name": "Thread", "value": "M20"}]},
            "supplier_price": price, "quantity": 10, "warranty": "3 months", **extra,
        }
        r = client_for(user).post("/api/supplier/listings/", payload, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def publish(self, user, listing_id, price_override=None):
        r = client_for(user).post(f"/api/supplier/listings/{listing_id}/submit/")
        self.assertEqual(r.status_code, 200, r.content)
        body = {"price_override": price_override} if price_override else {}
        r = client_for(self.admin).post(f"/api/admin/listings/{listing_id}/approve/", body, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    # --- workflow -------------------------------------------------------------

    def test_draft_submit_approve_publishes(self):
        listing = self.create_listing(self.owner)
        self.assertEqual(listing["status"], "draft")
        self.assertEqual(client_for(None).get("/api/products/").json()["count"], 0)

        self.publish(self.owner, listing["id"])
        products = client_for(None).get("/api/products/").json()
        self.assertEqual(products["count"], 1)
        self.assertEqual(products["results"][0]["min_price"], "1200")  # 1000 + 20% markup

    def test_pending_supplier_cannot_submit(self):
        _, pending_owner = make_supplier("Gamma Spares", approved=False)
        listing = self.create_listing(pending_owner, part_number="X-1")
        r = client_for(pending_owner).post(f"/api/supplier/listings/{listing['id']}/submit/")
        self.assertEqual(r.status_code, 400)

    def test_reject_then_resubmit(self):
        listing = self.create_listing(self.owner)
        client_for(self.owner).post(f"/api/supplier/listings/{listing['id']}/submit/")
        r = client_for(self.admin).post(f"/api/admin/listings/{listing['id']}/reject/", {"reason": "Add photos"})
        self.assertEqual(r.json()["status"], "rejected")
        r = client_for(self.owner).post(f"/api/supplier/listings/{listing['id']}/submit/")
        self.assertEqual(r.json()["status"], "pending")
        actions = [e["action"] for e in client_for(self.owner).get(f"/api/supplier/listings/{listing['id']}/history/").json()]
        self.assertEqual(actions, ["submitted", "rejected", "submitted", "created"])

    def test_stock_and_price_changes_stay_published_but_condition_needs_reapproval(self):
        listing = self.create_listing(self.owner)
        self.publish(self.owner, listing["id"])
        c = client_for(self.owner)
        r = c.patch(f"/api/supplier/listings/{listing['id']}/", {"quantity": 3, "supplier_price": "1100"}, format="json")
        self.assertEqual(r.json()["status"], "approved")
        self.assertEqual(r.json()["quantity"], 3)
        r = c.patch(f"/api/supplier/listings/{listing['id']}/", {"condition": "refurbished"}, format="json")
        self.assertEqual(r.json()["status"], "pending")

    def test_quantity_zero_marks_out_of_stock(self):
        listing = self.create_listing(self.owner)
        r = client_for(self.owner).post(f"/api/supplier/listings/{listing['id']}/stock/", {"quantity": 0})
        self.assertEqual(r.json()["availability"], "out_of_stock")
        r = client_for(self.owner).post(f"/api/supplier/listings/{listing['id']}/stock/", {"quantity": 5})
        self.assertEqual(r.json()["availability"], "in_stock")

    # --- catalogue dedupe -------------------------------------------------------

    def test_same_part_from_two_suppliers_is_one_product(self):
        a = self.create_listing(self.owner, part_number="0 451 103 316", price="1000")
        b = self.create_listing(self.other_owner, part_number="0451103316", price="900")
        self.assertEqual(a["product"]["id"], b["product"]["id"])
        self.assertEqual(Product.objects.count(), 1)
        self.publish(self.owner, a["id"])
        self.publish(self.other_owner, b["id"])

        card = client_for(None).get("/api/products/").json()["results"][0]
        self.assertEqual(card["offer_count"], 2)
        self.assertEqual(card["min_price"], "1080")
        detail = client_for(None).get(f"/api/products/{card['slug']}/").json()
        self.assertEqual([o["price"] for o in detail["offers"]], ["1080", "1200"])

    def test_supplier_cannot_edit_shared_catalogue_product(self):
        a = self.create_listing(self.owner)
        b = self.create_listing(self.other_owner)
        r = client_for(self.owner).patch(f"/api/supplier/listings/{a['id']}/",
                                         {"product_details": {"name": "Renamed"}}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertFalse(client_for(self.other_owner).get(f"/api/supplier/listings/{b['id']}/").json()["can_edit_product"])

    def test_admin_price_override(self):
        listing = self.create_listing(self.owner)
        self.publish(self.owner, listing["id"], price_override="1150")
        self.assertEqual(client_for(None).get("/api/products/").json()["results"][0]["min_price"], "1150")

    # --- privacy ------------------------------------------------------------------

    def test_public_api_never_exposes_supplier_price_or_contacts(self):
        listing = self.create_listing(self.owner, price="1000")
        self.publish(self.owner, listing["id"])
        slug = client_for(None).get("/api/products/").json()["results"][0]["slug"]
        bodies = [
            client_for(None).get("/api/products/").content,
            client_for(None).get(f"/api/products/{slug}/").content,
            client_for(self.customer).get(f"/api/products/{slug}/").content,
        ]
        for body in bodies:
            text = body.decode()
            self.assertNotIn(self.supplier.name, text)
            for secret in ("supplier_price", "price_override", "secret@company.ke", "+254711111111", "PVT-123",
                           "Secret Road", "1000.00"):
                self.assertNotIn(secret, text)

    def test_no_public_supplier_directory(self):
        self.assertEqual(client_for(None).get("/api/suppliers/").status_code, 404)

    def test_suppliers_only_see_their_own_listings(self):
        mine = self.create_listing(self.owner)
        c = client_for(self.other_owner)
        self.assertEqual(c.get(f"/api/supplier/listings/{mine['id']}/").status_code, 404)
        self.assertEqual(c.get("/api/supplier/listings/").json()["count"], 0)
        r = c.post("/api/supplier/inventory/bulk-update/", {"items": [{"id": mine["id"], "quantity": 0}]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(SupplierListing.objects.get(pk=mine["id"]).quantity, 10)

    def test_non_admins_cannot_use_admin_api(self):
        for user in (None, self.customer, self.owner):
            self.assertIn(client_for(user).get("/api/admin/listings/").status_code, (401, 403))
            self.assertIn(client_for(user).get("/api/admin/suppliers/").status_code, (401, 403))

    def test_customers_cannot_use_supplier_portal(self):
        self.assertEqual(client_for(self.customer).get("/api/supplier/listings/").status_code, 403)

    def test_documents_private_to_admin_and_owner(self):
        r = client_for(self.owner).post(
            "/api/supplier/documents/",
            {"doc_type": "registration", "file": SimpleUploadedFile("cert.pdf", PDF, "application/pdf")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        doc_id = r.json()["id"]
        self.assertEqual(client_for(self.owner).get(f"/api/supplier/documents/{doc_id}/download/").status_code, 200)
        self.assertEqual(client_for(self.admin).get(f"/api/admin/documents/{doc_id}/download/").status_code, 200)
        self.assertEqual(client_for(self.other_owner).get(f"/api/supplier/documents/{doc_id}/download/").status_code, 404)
        self.assertEqual(client_for(self.customer).get(f"/api/admin/documents/{doc_id}/download/").status_code, 403)

    def test_rejects_non_pdf_document(self):
        r = client_for(self.owner).post(
            "/api/supplier/documents/",
            {"doc_type": "tax", "file": SimpleUploadedFile("x.pdf", b"<html>not a pdf</html>", "application/pdf")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400)

    # --- roles ----------------------------------------------------------------------

    def test_sales_member_is_read_only_for_products(self):
        sales = User.objects.create_user(email="sales@test.ke", password="x-pass-12345", full_name="S",
                                         role=User.Role.SUPPLIER)
        SupplierMember.objects.create(supplier=self.supplier, user=sales, role=SupplierMember.Role.SALES)
        self.create_listing(self.owner)
        c = client_for(sales)
        self.assertEqual(c.get("/api/supplier/listings/").json()["count"], 1)
        r = c.post("/api/supplier/listings/", {"product_id": Product.objects.first().id, "supplier_price": "5",
                                                "condition": "used"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(c.patch("/api/supplier/profile/", {"tagline": "x"}, format="json").status_code, 403)

    def test_approved_supplier_cannot_rename_company(self):
        r = client_for(self.owner).patch("/api/supplier/profile/", {"name": "Fake Co"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = client_for(self.owner).patch("/api/supplier/profile/", {"tagline": "Best parts"}, format="json")
        self.assertEqual(r.status_code, 200)

    # --- bulk import ----------------------------------------------------------------

    def test_excel_import_creates_then_updates_by_sku(self):
        c = client_for(self.owner)
        wb = load_workbook(BytesIO(c.get("/api/supplier/import/template/").content))
        ws = wb["Products"]
        ws.append(["Air filter", self.category.slug, "Bosch", "F 026 400 001", "AF-1", "new", "1500", "8"])
        ws.append(["Bad row", "no-such-category", "Bosch", "", "", "", "abc"])
        out = BytesIO()
        wb.save(out)

        def upload(data):
            return c.post("/api/supplier/import/",
                          {"file": SimpleUploadedFile("p.xlsx", data, "application/octet-stream")},
                          format="multipart").json()

        result = upload(out.getvalue())
        self.assertEqual(result["created"], 1)
        self.assertEqual(len(result["errors"]), 1, result)
        self.assertEqual(result["errors"][0]["row"], 5)

        ws.delete_rows(5)
        ws["H4"] = 20
        out = BytesIO()
        wb.save(out)
        result = upload(out.getvalue())
        self.assertEqual((result["created"], result["updated"]), (0, 1))
        self.assertEqual(SupplierListing.objects.get(sku="AF-1").quantity, 20)


@override_settings(CLOUDINARY_URL="")
class AuthTests(TestCase):
    def test_suppliers_cannot_self_register_admin_onboards_them(self):
        self.assertEqual(APIClient().post("/api/auth/register/supplier/", {}, format="json").status_code, 404)
        admin = User.objects.create_superuser(email="ad@m.ke", password="Strong-pass-2026", full_name="Admin")
        c = APIClient()
        c.force_authenticate(admin)
        body = {"company_name": "Jane Moto", "business_phone": "+254722000000", "county": "Mombasa",
                "owner_name": "Jane Owner", "owner_email": "Jane@Parts.ke"}
        r = c.post("/api/admin/suppliers/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["status"], "approved")
        owner = User.objects.get(email="jane@parts.ke")
        self.assertEqual(owner.role, "supplier")
        self.assertFalse(owner.has_usable_password())  # sets it from the invite email
        self.assertEqual(owner.supplier_membership.role, "owner")
        self.assertEqual(c.post("/api/admin/suppliers/", body, format="json").status_code, 400)  # email taken
        self.assertEqual(c.post(f"/api/admin/suppliers/{r.json()['id']}/resend-invite/").json()["sent_to"], "jane@parts.ke")
        customer = User.objects.create_user(email="c@c.ke", password="Strong-pass-2026", full_name="C")
        c.force_authenticate(customer)
        self.assertEqual(c.post("/api/admin/suppliers/", body, format="json").status_code, 403)

    def test_customer_email_can_become_a_supplier_owner(self):
        admin = User.objects.create_superuser(email="ad@m.ke", password="Strong-pass-2026", full_name="Admin")
        cust = User.objects.create_user(email="moto@parts.ke", password="Strong-pass-2026", full_name="Moto Owner")
        c = APIClient()
        c.force_authenticate(admin)
        body = {"company_name": "Moto Spares", "business_phone": "+254722000001", "county": "Nairobi",
                "owner_name": "Ignored", "owner_email": "MOTO@parts.ke"}
        r = c.post("/api/admin/suppliers/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        cust.refresh_from_db()
        self.assertEqual((cust.role, cust.full_name, cust.supplier_membership.role), ("supplier", "Moto Owner", "owner"))
        self.assertTrue(cust.check_password("Strong-pass-2026"))  # keeps their password
        self.assertEqual(User.objects.filter(email__iexact="moto@parts.ke").count(), 1)
        # Now a supplier login: can't start a second company, or be invited to another team.
        body["company_name"] = "Second Co"
        self.assertEqual(c.post("/api/admin/suppliers/", body, format="json").status_code, 400)
        self.assertEqual(c.post("/api/admin/suppliers/", {**body, "owner_email": "ad@m.ke"}, format="json").status_code, 400)

    def test_login_requires_csrf(self):
        User.objects.create_user(email="a@b.ke", password="Strong-pass-2026", full_name="A")
        c = APIClient(enforce_csrf_checks=True)
        self.assertEqual(c.post("/api/auth/login/", {"email": "a@b.ke", "password": "Strong-pass-2026"}).status_code, 403)
        token = c.get("/api/auth/csrf/").json()["csrfToken"]
        r = c.post("/api/auth/login/", {"email": "a@b.ke", "password": "Strong-pass-2026"}, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 200)

    def test_weak_password_rejected(self):
        r = APIClient().post("/api/auth/register/customer/",
                             {"full_name": "A", "email": "a@b.ke", "password": "12345678"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.json())
