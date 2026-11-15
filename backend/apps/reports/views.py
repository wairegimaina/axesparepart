import csv
from decimal import Decimal

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit
from apps.core.permissions import IsAdmin, SupplierRolePermission
from apps.payments.models import SupplierPayout
from apps.suppliers.models import Supplier, SupplierMember

from . import services
from .periods import parse_period


def csv_response(filename, columns, rows):
    """columns: [(key, header)]. Prefixed with a BOM so Excel opens UTF-8 correctly."""
    resp = HttpResponse(content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.write("﻿")
    w = csv.writer(resp)
    w.writerow([h for _, h in columns])
    for r in rows:
        w.writerow([_cell(r.get(k)) for k, _ in columns])
    return resp


def _cell(v):
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return timezone.localtime(v).strftime("%Y-%m-%d %H:%M") if hasattr(v, "hour") else v.isoformat()
    s = str(v)
    # Keep spreadsheet apps from treating text as a formula.
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not s.lstrip("-").replace(".", "", 1).isdigit() else s


class ReportView(APIView):
    permission_classes = [IsAdmin]
    name = ""
    columns: list = []
    rows_key = ""

    def build(self, start, end, days):
        raise NotImplementedError

    def get(self, request):
        d0, d1, start, end = parse_period(request.query_params)
        data = self.build(start, end, (d1 - d0).days + 1)
        if request.query_params.get("export") == "csv":
            return csv_response(f"axe-{self.name}-{d0}-to-{d1}.csv", self.columns, data[self.rows_key])
        return Response({"from": d0, "to": d1, **data})


class SalesReportView(ReportView):
    name, rows_key = "sales", "series"
    columns = [("period", "Period"), ("placed", "Orders placed"), ("orders", "Orders completed"),
               ("revenue", "Revenue (KES)"), ("margin", "Parts margin (KES)")]

    def build(self, start, end, days):
        return services.sales_report(start, end, days)


class ProductsReportView(ReportView):
    name, rows_key = "products", "products"
    columns = [("name", "Product"), ("brand", "Brand"), ("part_number", "Part number"), ("units", "Units"),
               ("orders", "Orders"), ("revenue", "Revenue (KES)"), ("margin", "Margin (KES)")]

    def build(self, start, end, days):
        return services.products_report(start, end)


class SuppliersReportView(ReportView):
    name, rows_key = "suppliers", "suppliers"
    columns = [("name", "Supplier"), ("orders_received", "Orders received"), ("orders_fulfilled", "Fulfilled"),
               ("orders_rejected", "Rejected"), ("fulfilment_rate", "Fulfilment %"),
               ("hours_to_accept", "Avg hours to accept"), ("hours_to_ready", "Avg hours to ready"),
               ("units", "Units"), ("customer_sales", "Customer sales (KES)"),
               ("supplier_earnings", "Supplier earnings (KES)"), ("margin", "Margin (KES)"),
               ("balance_owed", "Balance owed now (KES)")]

    def build(self, start, end, days):
        return services.suppliers_report(start, end)


class CustomersReportView(ReportView):
    name, rows_key = "customers", "customers"
    columns = [("name", "Customer"), ("email", "Email"), ("phone", "Phone"), ("orders", "Orders"),
               ("revenue", "Revenue (KES)")]

    def build(self, start, end, days):
        return services.customers_report(start, end)


# --- Supplier payouts & statements ------------------------------------------------------------


STATEMENT_COLUMNS = [("date", "Date"), ("type", "Type"), ("reference", "Reference"), ("earned", "Earned (KES)"),
                     ("paid", "Paid out (KES)")]


def statement_response(request, supplier):
    d0, d1, start, end = parse_period(request.query_params)
    data = services.supplier_statement(supplier, start, end)
    if request.query_params.get("export") == "csv":
        lines = [{"date": e["collected_at"], "type": "Order collected", "reference": e["number"], "earned": e["amount"]}
                 for e in data["earnings"]]
        lines += [{"date": p["paid_at"], "type": f"Payout ({p['method']})", "reference": p["reference"], "paid": p["amount"]}
                  for p in data["payouts"]]
        lines.sort(key=lambda r: r["date"])
        lines.insert(0, {"type": "Opening balance", "earned": data["opening_balance"]})
        lines.append({"type": "Closing balance", "earned": data["closing_balance"]})
        return csv_response(f"axe-statement-{supplier.slug}-{d0}-to-{d1}.csv", STATEMENT_COLUMNS, lines)
    return Response({"from": d0, "to": d1, "supplier": {"id": supplier.id, "name": supplier.name}, **data})


class PayoutInSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=SupplierPayout.Method.choices)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=80)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    paid_at = serializers.DateTimeField(required=False)


class AdminPayoutBalancesView(APIView):
    """Every supplier with money earned or paid: what we owe them now."""

    permission_classes = [IsAdmin]

    def get(self, request):
        balances = services.supplier_balances()
        suppliers = {s.id: s for s in Supplier.objects.filter(id__in=balances)}
        rows = sorted(
            ({"supplier_id": i, "name": suppliers[i].name, **b,
              "bank_details": getattr(suppliers[i], "payout_details", "")} for i, b in balances.items()),
            key=lambda r: r["balance"], reverse=True,
        )
        if request.query_params.get("export") == "csv":
            return csv_response("axe-supplier-balances.csv", [("name", "Supplier"), ("earned", "Earned (KES)"),
                                                               ("paid", "Paid (KES)"), ("balance", "Owed (KES)")], rows)
        return Response({"suppliers": rows, "total_owed": sum((r["balance"] for r in rows), services.ZERO)})


class AdminSupplierStatementView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        return statement_response(request, get_object_or_404(Supplier, pk=pk))

    def post(self, request, pk):
        """Record a payout to this supplier."""
        supplier = get_object_or_404(Supplier, pk=pk)
        s = PayoutInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        payout = SupplierPayout.objects.create(supplier=supplier, recorded_by=request.user,
                                               paid_at=s.validated_data.pop("paid_at", None) or timezone.now(),
                                               **s.validated_data)
        audit(request, "payout.recorded", supplier, amount=str(payout.amount), reference=payout.reference)
        from apps.notifications.service import notify_supplier

        notify_supplier(supplier, "payout", f"Payout of KES {payout.amount:,.0f} sent",
                        payout.reference and f"Reference {payout.reference}", "/supplier/statement",
                        roles=[SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER])
        return statement_response(request, supplier)


class SupplierStatementView(APIView):
    permission_classes = [SupplierRolePermission]
    member_roles = {"*": [SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER]}

    def get(self, request):
        return statement_response(request, request.supplier)
