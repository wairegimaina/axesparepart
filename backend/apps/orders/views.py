from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, Sum
from django.db.models.functions import TruncMonth
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit
from apps.core.models import MarketplaceSettings
from apps.core.permissions import IsAdmin, OrdersStaffView, IsCustomer, SupplierRolePermission
from apps.customers.models import Address
from apps.inventory.models import SupplierListing
from apps.inventory.pricing import Markups
from apps.inventory.queries import published_listings

from . import services
from .models import Order, OrderEvent, OrderItem, SupplierOrder
from .serializers import (
    AddressInputSerializer, AddressSerializer, AdminOrderListSerializer, AdminOrderSerializer,
    AdminOrderUpdateSerializer, CartSerializer, CheckoutSerializer, CustomerOrderListSerializer,
    CustomerOrderSerializer, DispatchSerializer, NoteSerializer, PaymentInSerializer, PaymentSerializer,
    ReasonSerializer, RefundInSerializer, ReassignSerializer, SupplierOrderListSerializer, SupplierOrderSerializer, VerifySerializer,
    quote_payload,
)

User = get_user_model()
S = SupplierOrder.Status


# --- Cart (public, so guests can see prices before signing in) -----------------------------


class CartQuoteView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        s = CartSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        quote = services.build_quote(s.validated_data["items"], county=s.validated_data.get("county") or None)
        return Response(quote_payload(quote, MarketplaceSettings.load()))


# --- Customer account --------------------------------------------------------------------------


class AddressViewSet(viewsets.ModelViewSet):
    permission_classes = [IsCustomer]
    serializer_class = AddressSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        return self.request.user.addresses.all()

    def perform_create(self, serializer):
        serializer.save(customer=self.request.user)


def _customer_order_qs():
    return Order.objects.prefetch_related(
        Prefetch("items", queryset=OrderItem.objects.select_related("supplier_order__supplier")),
        "supplier_orders", "events", "refunds",
    ).annotate(item_count=Sum("items__quantity", filter=Q(items__status="active")))


class CustomerOrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsCustomer]
    lookup_field = "number"
    filter_backends = []

    def get_queryset(self):
        return _customer_order_qs().filter(customer=self.request.user)

    def get_serializer_class(self):
        return CustomerOrderListSerializer if self.action == "list" else CustomerOrderSerializer

    def _detail(self, order):
        return Response(CustomerOrderSerializer(self.get_queryset().get(pk=order.pk)).data)

    def create(self, request):
        s = CheckoutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with transaction.atomic():
            if d.get("address_id"):
                addr = get_object_or_404(Address, pk=d["address_id"], customer=request.user)
                address = AddressSerializer(addr).data
            else:
                address = dict(d["address"])
                if d.get("save_address"):
                    Address.objects.create(customer=request.user, **address)
            order = services.place_order(
                request.user, d["items"], address, d.get("notes", ""), d.get("expected_total"),
            )
        return Response(CustomerOrderSerializer(self.get_queryset().get(pk=order.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, number=None):
        order = services.cancel_order(self.get_object(), request.user, request.data.get("reason", ""), by_customer=True)
        return self._detail(order)


class CheckoutOptionsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        s = MarketplaceSettings.load()
        return Response({
            "delivery_fee": str(s.delivery_fee),
            "free_delivery_threshold": str(s.free_delivery_threshold),
        })


# --- Supplier fulfilment ---------------------------------------------------------------------------


class SupplierOrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Only fulfilment orders the marketplace has released. No customer details anywhere."""

    permission_classes = [SupplierRolePermission]
    lookup_field = "number"
    filter_backends = []

    def get_queryset(self):
        qs = (
            SupplierOrder.objects.filter(supplier=self.request.supplier, released_at__isnull=False)
            .prefetch_related("items", "events")
            .order_by("-released_at")
        )
        status_param = self.request.query_params.get("status")
        groups = {
            "incoming": [S.INCOMING],
            "accepted": [S.ACCEPTED],
            "processing": [S.PROCESSING, S.READY],
            "completed": [S.COLLECTED, S.COMPLETED],
            "closed": [S.REJECTED, S.CANCELLED],
        }
        if status_param in groups:
            qs = qs.filter(status__in=groups[status_param])
        return qs

    def get_serializer_class(self):
        return SupplierOrderListSerializer if self.action == "list" else SupplierOrderSerializer

    def _act(self, fn, *args):
        so = fn(self.get_object(), self.request.user, *args)
        return Response(SupplierOrderSerializer(self.get_queryset().get(pk=so.pk)).data)

    @action(detail=True, methods=["post"])
    def accept(self, request, number=None):
        return self._act(services.supplier_accept)

    @action(detail=True, methods=["post"])
    def start(self, request, number=None):
        return self._act(services.supplier_start)

    @action(detail=True, methods=["post"])
    def ready(self, request, number=None):
        return self._act(services.supplier_ready)

    @action(detail=True, methods=["post"])
    def reject(self, request, number=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._act(services.supplier_reject, s.validated_data.get("reason", ""))

    @action(detail=False, methods=["get"])
    def counts(self, request):
        qs = SupplierOrder.objects.filter(supplier=request.supplier, released_at__isnull=False)
        rows = {r["status"]: r["n"] for r in qs.values("status").annotate(n=Count("id"))}
        return Response({
            "incoming": rows.get(S.INCOMING, 0), "accepted": rows.get(S.ACCEPTED, 0),
            "processing": rows.get(S.PROCESSING, 0) + rows.get(S.READY, 0),
            "completed": rows.get(S.COLLECTED, 0) + rows.get(S.COMPLETED, 0),
        })


def supplier_sales(supplier) -> dict:
    """Order and sales figures for a supplier, at supplier prices."""
    items = OrderItem.objects.filter(supplier_order__supplier=supplier, status="active",
                                     supplier_order__released_at__isnull=False)
    value = F("supplier_unit_price") * F("quantity")
    done = items.filter(supplier_order__status__in=[S.COLLECTED, S.COMPLETED])
    open_ = items.filter(supplier_order__status__in=[S.INCOMING, S.ACCEPTED, S.PROCESSING, S.READY])
    since = (timezone.now() - timedelta(days=365)).replace(day=1)
    monthly = (
        done.filter(supplier_order__collected_at__gte=since)
        .annotate(month=TruncMonth("supplier_order__collected_at"))
        .values("month").annotate(total=Sum(value), units=Sum("quantity")).order_by("month")
    )
    sos = SupplierOrder.objects.filter(supplier=supplier, released_at__isnull=False)
    counts = {r["status"]: r["n"] for r in sos.values("status").annotate(n=Count("id"))}
    finished = sum(counts.get(s, 0) for s in (S.COLLECTED, S.COMPLETED))
    rejected = counts.get(S.REJECTED, 0)
    return {
        "sales_total": str(done.aggregate(t=Sum(value))["t"] or Decimal("0")),
        "open_value": str(open_.aggregate(t=Sum(value))["t"] or Decimal("0")),
        "orders_by_status": counts,
        "fulfilment_rate": round(100 * finished / (finished + rejected)) if finished + rejected else None,
        "monthly": [{"month": r["month"].strftime("%Y-%m"), "total": str(r["total"]), "units": r["units"]} for r in monthly],
    }


# --- Administrator ---------------------------------------------------------------------------------


def refund_due_q():
    """Orders where we hold more than the order now costs (see Order.refund_due)."""
    net = F("amount_paid") - F("amount_refunded")
    return (Q(status=Order.Status.CANCELLED) & Q(amount_paid__gt=F("amount_refunded"))) | (
        ~Q(status=Order.Status.CANCELLED) & Q(total__lt=net))


def ready_to_dispatch(qs):
    """Confirmed orders where every supplier part has been collected and nothing rejected is left."""
    waiting = SupplierOrder.objects.filter(
        order=OuterRef("pk"), status__in=[S.ON_HOLD, S.INCOMING, S.ACCEPTED, S.PROCESSING, S.READY])
    rejected = OrderItem.objects.filter(order=OuterRef("pk"), status="active", supplier_order__status=S.REJECTED)
    return qs.filter(status=Order.Status.CONFIRMED).exclude(Exists(waiting)).exclude(Exists(rejected))


class AdminOrderViewSet(OrdersStaffView, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                        viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    orders_staff_denied = ("refund",)  # money going back out stays with full admins
    lookup_field = "number"
    http_method_names = ["get", "post", "patch"]
    search_fields = ["number", "customer__email", "customer__full_name", "phone", "recipient_name",
                     "supplier_orders__number"]
    filterset_fields = ["status", "payment_status", "payment_method"]
    ordering_fields = ["created_at", "total"]

    def get_queryset(self):
        qs = Order.objects.select_related("customer").prefetch_related(
            Prefetch("supplier_orders", queryset=SupplierOrder.objects.select_related("supplier").prefetch_related("items")),
        )
        if self.action == "list":
            qs = qs.annotate(supplier_count=Count("supplier_orders", distinct=True))
            view = self.request.query_params.get("view")
            if view == "to_call":
                # Never-called first, then whoever we tried longest ago.
                return qs.filter(status=Order.Status.PENDING).order_by(
                    F("last_call_at").asc(nulls_first=True), "created_at")
            if view == "attention":
                qs = qs.filter(Q(status=Order.Status.PENDING) | Q(status=Order.Status.CONFIRMED)
                               | Q(status=Order.Status.DELIVERED) | refund_due_q())
            elif view == "ready_to_dispatch":
                qs = ready_to_dispatch(qs)
            elif view == "out_for_delivery":
                qs = qs.filter(status=Order.Status.DISPATCHED)
            elif view == "refund_due":
                qs = qs.filter(refund_due_q())
            elif view == "unpaid":
                qs = qs.exclude(status=Order.Status.CANCELLED).filter(
                    payment_status__in=[Order.PaymentStatus.UNPAID, Order.PaymentStatus.PARTIAL])
        else:
            qs = qs.prefetch_related(
                Prefetch("events", queryset=OrderEvent.objects.select_related("actor", "supplier_order")),
                Prefetch("payments"), Prefetch("refunds"), "items",
            )
        return qs.order_by("-created_at").distinct()

    def get_serializer_class(self):
        if self.action == "list":
            return AdminOrderListSerializer
        if self.action in ("update", "partial_update"):
            return AdminOrderUpdateSerializer
        return AdminOrderSerializer

    def _detail(self, order):
        return Response(AdminOrderSerializer(self.get_queryset().get(pk=order.pk)).data)

    def update(self, request, *args, **kwargs):
        order = self.get_object()
        s = AdminOrderUpdateSerializer(order, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        audit(request, "order.edited", order, fields=sorted(request.data.keys()))
        return self._detail(order)

    @action(detail=True, methods=["post"])
    def verify(self, request, number=None):
        s = VerifySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = services.verify_order(self.get_object(), request.user, s.validated_data.get("delivery_fee"),
                                      s.validated_data.get("note", ""))
        audit(request, "order.verified", order)
        return self._detail(order)

    @action(detail=True, methods=["post"], url_path="no-answer")
    def no_answer(self, request, number=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._detail(services.record_no_answer(self.get_object(), request.user, s.validated_data.get("reason", "")))

    @action(detail=True, methods=["post"])
    def cancel(self, request, number=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = services.cancel_order(self.get_object(), request.user, s.validated_data.get("reason", ""))
        audit(request, "order.cancelled", order, order.cancel_reason)
        return self._detail(order)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_order(self, request, number=None):
        s = DispatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._detail(services.dispatch_order(self.get_object(), request.user, **s.validated_data))

    @action(detail=True, methods=["post"], url_path="delivery-failed")
    def delivery_failed(self, request, number=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = services.delivery_failed(self.get_object(), request.user, s.validated_data.get("reason", ""))
        audit(request, "order.delivery_failed", order)
        return self._detail(order)

    @action(detail=True, methods=["post"])
    def refund(self, request, number=None):
        s = RefundInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = self.get_object()
        r = services.record_refund(order, request.user, **s.validated_data)
        audit(request, "refund.recorded", order, amount=str(r.amount), reference=r.reference)
        return self._detail(order)

    @action(detail=True, methods=["post"])
    def deliver(self, request, number=None):
        return self._detail(services.mark_delivered(self.get_object(), request.user, request.data.get("note", "")))

    @action(detail=True, methods=["post"])
    def complete(self, request, number=None):
        return self._detail(services.complete_order(self.get_object(), request.user))

    @action(detail=True, methods=["post"])
    def payment(self, request, number=None):
        s = PaymentInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = self.get_object()
        p = services.record_payment(order, request.user, **s.validated_data)
        audit(request, "payment.recorded", order, amount=str(p.amount), reference=p.reference)
        return self._detail(order)

    @action(detail=True, methods=["post"])
    def note(self, request, number=None):
        s = NoteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = self.get_object()
        services.event(order, "note", s.validated_data["message"], request.user,
                       customer=s.validated_data["visible_to_customer"])
        return self._detail(order)

    @action(detail=False, methods=["get"])
    def counts(self, request):
        rows = {r["status"]: r["n"] for r in Order.objects.values("status").annotate(n=Count("id"))}
        rows["ready_to_dispatch"] = ready_to_dispatch(Order.objects.all()).count()
        rows["refund_due"] = Order.objects.filter(refund_due_q()).count()
        return Response(rows)


class AdminSupplierOrderViewSet(OrdersStaffView, viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    queryset = SupplierOrder.objects.select_related("order", "supplier")

    @action(detail=True, methods=["post"])
    def collected(self, request, pk=None):
        so = services.mark_collected(self.get_object(), request.user)
        return Response({"status": so.status})

    @action(detail=True, methods=["post"])
    def note(self, request, pk=None):
        so = self.get_object()
        message = request.data.get("message", "").strip()
        if not message:
            raise ValidationError({"message": "Write a note."})
        so.supplier_notes = message
        so.save(update_fields=["supplier_notes", "updated_at"])
        services.event(so.order, "supplier_note", message, request.user, so, supplier=True)
        return Response({"ok": True})


class AdminOrderItemViewSet(OrdersStaffView, viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    queryset = OrderItem.objects.select_related("order", "supplier_order", "listing")

    @action(detail=True, methods=["get"])
    def alternatives(self, request, pk=None):
        """Other suppliers' published offers of the same part, cheapest first."""
        item = self.get_object()
        markups = Markups.load()
        offers = (
            published_listings().filter(product_id=item.listing.product_id)
            .exclude(supplier_id=item.supplier_order.supplier_id)
            .exclude(availability=SupplierListing.Availability.OUT_OF_STOCK)
            .order_by("supplier_price")
        )
        return Response([
            {"listing_id": o.id, "supplier": o.supplier.name, "supplier_verified": o.supplier.is_verified,
             "condition": o.condition, "availability": o.availability, "quantity": o.quantity,
             "supplier_price": str(o.supplier_price), "customer_price": str(o.selling_price(markups)),
             "enough_stock": o.availability == "on_request" or o.quantity >= item.quantity}
            for o in offers
        ])

    @action(detail=True, methods=["post"])
    def reassign(self, request, pk=None):
        s = ReassignSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        listing = get_object_or_404(SupplierListing, pk=s.validated_data["listing_id"])
        item = services.reassign_item(self.get_object(), request.user, listing)
        audit(request, "order.item_reassigned", item.order, item=item.pk, listing=listing.pk)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        item = services.remove_item(self.get_object(), request.user, s.validated_data.get("reason", ""))
        audit(request, "order.item_removed", item.order, item=item.pk)
        return Response({"ok": True})


class AdminCustomerListView(OrdersStaffView, generics.ListAPIView):
    permission_classes = [IsAdmin]
    search_fields = ["email", "full_name", "phone"]
    ordering_fields = ["date_joined", "order_count", "spent"]

    def get_queryset(self):
        return (
            User.objects.filter(role=User.Role.CUSTOMER)
            .annotate(
                order_count=Count("orders", distinct=True),
                spent=Sum("orders__total", filter=Q(orders__status=Order.Status.COMPLETED)),
            )
            .order_by("-date_joined")
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = [
            {"id": u.id, "full_name": u.full_name, "email": u.email, "phone": u.phone, "is_active": u.is_active,
             "date_joined": u.date_joined, "order_count": u.order_count, "spent": str(u.spent or 0)}
            for u in page
        ]
        return self.get_paginated_response(rows)


class AdminCustomerDetailView(OrdersStaffView, APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        u = self._customer(pk)
        orders = Order.objects.filter(customer=u).annotate(supplier_count=Count("supplier_orders")).prefetch_related(
            "supplier_orders__items")
        return Response({
            "id": u.id, "full_name": u.full_name, "email": u.email, "phone": u.phone, "is_active": u.is_active,
            "date_joined": u.date_joined, "last_login": u.last_login,
            "addresses": AddressSerializer(u.addresses.all(), many=True).data,
            "orders": AdminOrderListSerializer(orders, many=True).data,
            "can_delete": not self._delete_blockers(u),
        })

    def _customer(self, pk):
        u = User.objects.filter(role=User.Role.CUSTOMER, pk=pk).first()
        if u is None:
            raise Http404
        return u

    @staticmethod
    def _delete_blockers(u) -> str:
        """Why this customer can't be deleted: orders and help requests are records we must keep."""
        from apps.support.models import Ticket
        if u.orders.exists():
            return "This customer has orders, which must be kept. Deactivate the account instead."
        if Ticket.objects.filter(opened_by=u).exists():
            return "This customer has help requests, which must be kept. Deactivate the account instead."
        return ""

    def patch(self, request, pk):
        """Edit name, email, phone, or turn sign-in on/off."""
        u = self._customer(pk)
        data, errors, changed = request.data, {}, {}
        if "full_name" in data:
            name = str(data["full_name"]).strip()
            if not name:
                errors["full_name"] = ["Enter a name."]
            changed["full_name"] = name
        if "email" in data:
            email = str(data["email"]).strip().lower()
            if not email or "@" not in email:
                errors["email"] = ["Enter a valid email."]
            elif User.objects.filter(email__iexact=email).exclude(pk=u.pk).exists():
                errors["email"] = ["Another account already uses this email."]
            changed["email"] = email
        if "phone" in data:
            phone = str(data["phone"]).strip()
            if len(phone) > 20:
                errors["phone"] = ["Phone is too long."]
            changed["phone"] = phone
        if "is_active" in data:
            changed["is_active"] = data["is_active"] in (True, "true", "1", 1)
        if errors:
            raise ValidationError(errors)
        before = {k: getattr(u, k) for k in changed}
        for k, v in changed.items():
            setattr(u, k, v)
        u.save(update_fields=list(changed) or None)
        diff = {k: [before[k], v] for k, v in changed.items() if before[k] != v}
        if diff:
            audit(request, "customer.update", u, f"Edited customer {u.email}", changes=diff)
        return self.get(request, pk)

    def delete(self, request, pk):
        if request.user.is_orders_staff:
            return Response({"detail": "Only full admins can delete customers."}, status=status.HTTP_403_FORBIDDEN)
        u = self._customer(pk)
        reason = self._delete_blockers(u)
        if reason:
            return Response({"detail": reason}, status=status.HTTP_409_CONFLICT)
        try:
            with transaction.atomic():
                audit(request, "customer.delete", u, f"Deleted customer {u.email}", email=u.email, name=u.full_name)
                u.delete()
        except ProtectedError:
            return Response({"detail": "This customer has records that must be kept. Deactivate the account instead."},
                            status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)
