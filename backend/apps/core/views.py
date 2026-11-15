from django.contrib.auth import get_user_model
from datetime import timedelta

from django.db.models import Count, F, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalogue.models import Product
from apps.inventory.models import SupplierListing
from apps.orders.models import Order, SupplierOrder
from apps.suppliers.models import Supplier, SupplierDocument
from apps.support.models import Ticket

from .audit import audit
from .models import AuditLog, MarketplaceSettings
from .permissions import IsAdmin, OrdersStaffView
from .serializers import AuditLogSerializer, MarketplaceSettingsSerializer

User = get_user_model()


class PublicConfigView(APIView):
    """Non-secret settings the storefront needs."""

    def get(self, request):
        s = MarketplaceSettings.load()
        return Response({
            "currency": s.currency,
            "support": {"phone": s.support_phone, "whatsapp": s.support_whatsapp, "email": s.support_email,
                        "hours": s.support_hours},
            "google_client_id": s.google_client_id,
        })


class AdminSettingsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(MarketplaceSettingsSerializer(MarketplaceSettings.load()).data)

    def patch(self, request):
        obj = MarketplaceSettings.load()
        before = MarketplaceSettingsSerializer(obj).data
        s = MarketplaceSettingsSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save(updated_by=request.user)
        audit(request, "settings.updated", obj, before=before, after=s.data)
        return Response(s.data)


class AdminDashboardView(OrdersStaffView, APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        def counts(qs, field="status"):
            return {r[field]: r["n"] for r in qs.values(field).annotate(n=Count("id"))}

        return Response({
            "suppliers": counts(Supplier.objects.all()),
            "verified_suppliers": Supplier.objects.filter(is_verified=True).count(),
            "listings": counts(SupplierListing.objects.all()),
            "products": counts(Product.objects.all()),
            "pending_documents": SupplierDocument.objects.filter(status="pending").count(),
            "pending_deals": SupplierListing.objects.filter(deal_status=SupplierListing.DealStatus.PENDING).count(),
            "customers": User.objects.filter(role=User.Role.CUSTOMER).count(),
            "orders": counts(Order.objects.all()),
            "rejected_supplier_orders": SupplierOrder.objects.filter(
                status=SupplierOrder.Status.REJECTED, order__status=Order.Status.CONFIRMED,
                items__status="active").distinct().count(),
            "ready_for_pickup": SupplierOrder.objects.filter(status=SupplierOrder.Status.READY).count(),
            "unpaid_delivered": Order.objects.filter(status=Order.Status.DELIVERED).exclude(payment_status="paid").count(),
            "open_tickets": Ticket.objects.filter(status=Ticket.Status.OPEN).count(),
            "sales_completed": str(Order.objects.filter(status=Order.Status.COMPLETED).aggregate(t=Sum("total"))["t"] or 0),
            **self._today(),
        })

    @staticmethod
    def _today():
        today = timezone.localdate()
        week_start = today - timedelta(days=today.weekday())
        live = Order.objects.exclude(status=Order.Status.CANCELLED)
        placed = live.filter(created_at__date=today).aggregate(n=Count("id"), t=Sum("total"))
        week = Order.objects.filter(status=Order.Status.COMPLETED, completed_at__date__gte=week_start).aggregate(
            n=Count("id"), t=Sum("total"))

        def row(o):
            return {"number": o.number, "customer_name": o.customer.full_name, "phone": o.phone, "town": o.town,
                    "total": str(o.total), "status": o.status, "status_display": o.get_status_display(),
                    "created_at": o.created_at, "call_attempts": o.call_attempts, "last_call_at": o.last_call_at}

        to_call = (Order.objects.filter(status=Order.Status.PENDING).select_related("customer")
                   .order_by(F("last_call_at").asc(nulls_first=True), "created_at"))
        return {
            "today": {"orders": placed["n"], "value": str(placed["t"] or 0)},
            "this_week": {"orders": week["n"], "sales": str(week["t"] or 0)},
            "to_call": [row(o) for o in to_call[:6]],
            "to_call_count": to_call.count(),
            "recent_orders": [row(o) for o in Order.objects.select_related("customer").order_by("-created_at")[:6]],
        }


class AdminAuditLogView(generics.ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor")
    filterset_fields = ["action", "target_type", "target_id"]
    search_fields = ["message", "actor__email"]
