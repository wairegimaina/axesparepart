from datetime import timedelta

from django.db.models import Count, F, Q, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin, OrdersStaffView
from apps.orders.models import Order

from .models import Payment, Refund
from .serializers import AdminPaymentRowSerializer, AdminRefundRowSerializer


def _period(request):
    """?days=30 (default) → start datetime."""
    try:
        days = max(1, min(int(request.query_params.get("days", 30)), 3650))
    except ValueError:
        days = 30
    return days, timezone.now() - timedelta(days=days)


class AdminPaymentListView(OrdersStaffView, generics.ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AdminPaymentRowSerializer
    search_fields = ["order__number", "reference", "order__customer__full_name"]
    filterset_fields = ["method"]

    def get_queryset(self):
        return Payment.objects.select_related("order__customer", "recorded_by").order_by("-received_at")


class AdminRefundListView(OrdersStaffView, generics.ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AdminRefundRowSerializer
    search_fields = ["order__number", "reference", "order__customer__full_name"]
    filterset_fields = ["method"]

    def get_queryset(self):
        return Refund.objects.select_related("order__customer", "recorded_by").order_by("-refunded_at")


class AdminPaymentSummaryView(OrdersStaffView, APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        days, since = _period(request)
        paid = Payment.objects.filter(received_at__gte=since)
        refunded = Refund.objects.filter(refunded_at__gte=since)
        by_method = list(paid.values("method").annotate(total=Sum("amount"), count=Count("id")).order_by("-total"))
        open_orders = Order.objects.exclude(status=Order.Status.CANCELLED).annotate(
            due=F("total") - F("amount_paid") + F("amount_refunded")).filter(due__gt=0)
        delivered_unpaid = open_orders.filter(status=Order.Status.DELIVERED)
        received = paid.aggregate(s=Sum("amount"))["s"] or 0
        out = refunded.aggregate(s=Sum("amount"))["s"] or 0
        return Response({
            "days": days,
            "received": str(received),
            "refunded": str(out),
            "net": str(received - out),
            "by_method": [{**r, "total": str(r["total"])} for r in by_method],
            "outstanding": str(open_orders.aggregate(s=Sum("due"))["s"] or 0),
            "outstanding_orders": open_orders.count(),
            "delivered_unpaid": delivered_unpaid.count(),
            "refund_due_orders": Order.objects.filter(
                (Q(status=Order.Status.CANCELLED) & Q(amount_paid__gt=F("amount_refunded")))
                | (~Q(status=Order.Status.CANCELLED) & Q(total__lt=F("amount_paid") - F("amount_refunded")))
            ).count(),
        })
