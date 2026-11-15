from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.orders.tests import test_orders as base
from apps.orders.tests.test_orders import client
from apps.payments.models import SupplierPayout


@override_settings(CLOUDINARY_URL="", CELERY_TASK_ALWAYS_EAGER=True)
class ReportTests(TestCase):
    setUp = base.OrderFlowTests.setUp
    _supplier = base.OrderFlowTests._supplier
    _listing = base.OrderFlowTests._listing
    checkout = base.OrderFlowTests.checkout
    place = base.OrderFlowTests.place
    admin_post = base.OrderFlowTests.admin_post

    def complete(self):
        """2×oil from Alpha (customer 1100, supplier 1000) + 1×air from Beta (2200 / 2000), delivery 300."""
        n = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{n}/verify/")
        from apps.orders.models import SupplierOrder
        for so in SupplierOrder.objects.filter(order__number=n):
            owner = self.a_owner if so.supplier == self.a else self.b_owner
            for step in ("accept", "ready"):
                client(owner).post(f"/api/supplier/orders/{so.number}/{step}/")
            self.admin_post(f"/api/admin/supplier-orders/{so.id}/collected/")
        self.admin_post(f"/api/admin/orders/{n}/dispatch/", {"courier": "G4S"})
        self.admin_post(f"/api/admin/orders/{n}/deliver/")
        self.admin_post(f"/api/admin/orders/{n}/payment/", {"amount": "4700", "method": "cash_on_delivery"})
        self.admin_post(f"/api/admin/orders/{n}/complete/")
        return n

    def test_sales_report_figures_and_csv(self):
        self.complete()
        n2 = self.place()["number"]
        self.admin_post(f"/api/admin/orders/{n2}/cancel/", {"reason": "Changed mind"})
        r = client(self.admin).get("/api/admin/reports/sales/").json()
        self.assertEqual((r["orders_placed"], r["completed_orders"], r["cancellation_rate"]), (2, 1, 50))
        self.assertEqual(Decimal(r["revenue"]), Decimal("4700"))
        self.assertEqual(Decimal(r["parts_sales"]), Decimal("4400"))
        self.assertEqual(Decimal(r["supplier_cost"]), Decimal("4000"))
        self.assertEqual(Decimal(r["parts_margin"]), Decimal("400"))
        self.assertEqual(Decimal(r["delivery_fees"]), Decimal("300"))
        self.assertEqual(r["granularity"], "day")
        self.assertEqual(sum(p["orders"] for p in r["series"]), 1)
        csv = client(self.admin).get("/api/admin/reports/sales/?export=csv")
        self.assertEqual(csv["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("Orders placed", csv.content.decode("utf-8-sig"))

    def test_period_filters_and_validation(self):
        self.complete()
        old = (timezone.localdate() - timedelta(days=400)).isoformat()
        older = (timezone.localdate() - timedelta(days=380)).isoformat()
        r = client(self.admin).get(f"/api/admin/reports/sales/?from={old}&to={older}").json()
        self.assertEqual(r["completed_orders"], 0)
        self.assertEqual(client(self.admin).get("/api/admin/reports/sales/?from=2026-12-01&to=2026-01-01").status_code, 400)
        self.assertEqual(client(self.admin).get("/api/admin/reports/sales/?from=nope").status_code, 400)

    def test_products_suppliers_customers(self):
        self.complete()
        p = client(self.admin).get("/api/admin/reports/products/").json()
        self.assertEqual({x["name"]: x["units"] for x in p["products"]}, {"Oil filter": 2, "Air filter": 1})
        s = client(self.admin).get("/api/admin/reports/suppliers/").json()["suppliers"]
        alpha = next(x for x in s if x["name"] == "Alpha")
        self.assertEqual((alpha["orders_fulfilled"], alpha["fulfilment_rate"]), (1, 100))
        self.assertEqual(Decimal(alpha["supplier_earnings"]), Decimal("2000"))
        self.assertEqual(Decimal(alpha["balance_owed"]), Decimal("2000"))
        c = client(self.admin).get("/api/admin/reports/customers/").json()
        self.assertEqual((c["customers_ordering"], c["first_time_customers"], c["customers"][0]["orders"]), (1, 1, 1))

    def test_payouts_reduce_balance_and_supplier_sees_statement(self):
        self.complete()
        r = client(self.admin).post(f"/api/admin/payouts/{self.a.id}/", {"amount": "1500", "method": "bank_transfer",
                                                                         "reference": "EFT-1"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Decimal(r.json()["closing_balance"]), Decimal("500"))
        bal = client(self.admin).get("/api/admin/payouts/").json()
        self.assertEqual(Decimal(bal["total_owed"]), Decimal("2500"))  # Alpha 500 + Beta 2000
        st = client(self.a_owner).get("/api/supplier/statement/").json()
        self.assertEqual((Decimal(st["earned"]), Decimal(st["paid"])), (Decimal("2000"), Decimal("1500")))
        self.assertEqual(st["payouts"][0]["reference"], "EFT-1")
        csv = client(self.a_owner).get("/api/supplier/statement/?export=csv").content.decode("utf-8-sig")
        self.assertIn("Closing balance", csv)
        self.assertNotIn("Beta", csv)
        # Customer prices never appear on the supplier statement.
        self.assertNotIn("1100", str(st))
        self.assertEqual(SupplierPayout.objects.count(), 1)

    def test_reports_are_admin_only_and_statement_owner_or_manager(self):
        for path in ("/api/admin/reports/sales/", "/api/admin/payouts/", f"/api/admin/payouts/{self.a.id}/"):
            self.assertEqual(client(self.a_owner).get(path).status_code, 403)
            self.assertEqual(client(self.customer).get(path).status_code, 403)
        sales = type(self.customer).objects.create_user(email="s@t.ke", password="x-pass-12345", full_name="S", role="supplier")
        self.a.members.create(user=sales, role="sales")
        self.assertEqual(client(sales).get("/api/supplier/statement/").status_code, 403)

    def test_csv_cells_cannot_inject_formulas(self):
        from apps.reports.views import _cell
        self.assertEqual(_cell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
        self.assertEqual(_cell("-500"), "-500")
        self.assertEqual(_cell(Decimal("12.50")), "12.50")
