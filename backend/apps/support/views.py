from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdmin, OrdersStaffView
from apps.orders.models import Order, SupplierOrder

from . import services
from .models import Ticket, TicketMessage
from .serializers import (
    AdminReplySerializer, AdminTicketListSerializer, AdminTicketSerializer, AdminTicketUpdateSerializer,
    ReplySerializer, TicketCreateSerializer, TicketListSerializer, TicketSerializer,
)


class IsRequester(IsAuthenticated):
    """Customers, and active members of a supplier company. Sets request.supplier for suppliers."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        user = request.user
        if user.role == user.Role.CUSTOMER:
            request.supplier = None
            return True
        membership = getattr(user, "supplier_membership", None)
        if user.role == user.Role.SUPPLIER and membership and membership.is_active:
            request.supplier = membership.supplier
            return True
        return False


class TicketViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsRequester]
    lookup_field = "number"
    filter_backends = []

    def get_queryset(self):
        qs = Ticket.objects.select_related("order", "supplier_order").prefetch_related("messages__author")
        if self.request.supplier:
            return qs.filter(supplier=self.request.supplier)
        return qs.filter(opened_by=self.request.user, supplier__isnull=True)

    def get_serializer_class(self):
        return TicketListSerializer if self.action == "list" else TicketSerializer

    def _detail(self, ticket):
        return Response(TicketSerializer(self.get_queryset().get(pk=ticket.pk)).data)

    def create(self, request):
        s = TicketCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        order = supplier_order = None
        ref = (d.get("order_number") or "").strip()
        if ref:
            # Only your own orders can be linked.
            if request.supplier:
                supplier_order = get_object_or_404(SupplierOrder, number__iexact=ref, supplier=request.supplier,
                                                   released_at__isnull=False)
            else:
                order = get_object_or_404(Order, number__iexact=ref, customer=request.user)
        t = services.open_ticket(request.user, d["subject"], d["body"], d["category"], supplier=request.supplier,
                                 order=order, supplier_order=supplier_order)
        r = self._detail(t)
        r.status_code = status.HTTP_201_CREATED
        return r

    @action(detail=True, methods=["post"])
    def reply(self, request, number=None):
        s = ReplySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ticket = self.get_object()
        services.requester_reply(ticket, request.user, s.validated_data["body"])
        return self._detail(ticket)

    @action(detail=True, methods=["post"])
    def resolve(self, request, number=None):
        return self._detail(services.set_status(self.get_object(), Ticket.Status.RESOLVED))


class AdminTicketViewSet(OrdersStaffView, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                         viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    lookup_field = "number"
    http_method_names = ["get", "post", "patch"]
    search_fields = ["number", "subject", "opened_by__email", "opened_by__full_name", "supplier__name",
                     "order__number", "supplier_order__number"]
    filterset_fields = ["status", "category", "priority"]

    def get_queryset(self):
        qs = Ticket.objects.select_related("opened_by", "supplier", "assigned_to", "order", "supplier_order")
        if self.request.query_params.get("mine") in ("1", "true"):
            qs = qs.filter(assigned_to=self.request.user)
        if self.action != "list":
            qs = qs.prefetch_related(Prefetch("messages", queryset=TicketMessage.objects.select_related("author")))
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return AdminTicketListSerializer
        if self.action in ("update", "partial_update"):
            return AdminTicketUpdateSerializer
        return AdminTicketSerializer

    def _detail(self, ticket):
        return Response(AdminTicketSerializer(self.get_queryset().get(pk=ticket.pk)).data)

    def update(self, request, *args, **kwargs):
        ticket = self.get_object()
        s = AdminTicketUpdateSerializer(ticket, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        if "status" in s.validated_data:
            services.set_status(ticket, s.validated_data.pop("status"))
        s.save()
        return self._detail(ticket)

    @action(detail=True, methods=["post"])
    def reply(self, request, number=None):
        s = AdminReplySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ticket = self.get_object()
        services.staff_reply(ticket, request.user, **s.validated_data)
        return self._detail(ticket)

    @action(detail=False, methods=["get"])
    def counts(self, request):
        rows = {r["status"]: r["n"] for r in Ticket.objects.values("status").annotate(n=Count("id"))}
        rows["mine"] = Ticket.objects.filter(assigned_to=request.user, status=Ticket.Status.OPEN).count()
        return Response(rows)
