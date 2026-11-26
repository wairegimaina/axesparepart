from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.customers.models import Address
from apps.payments.models import Payment, PaymentMethod, Refund
from apps.suppliers.serializers import SupplierBadgeSerializer

from .models import Order, OrderEvent, OrderItem, SupplierOrder

# --- Cart / checkout ---------------------------------------------------------------------


class CartLineInSerializer(serializers.Serializer):
    listing_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=10000)


class CartSerializer(serializers.Serializer):
    items = CartLineInSerializer(many=True, max_length=100)
    county = serializers.CharField(required=False, allow_blank=True, max_length=60)


def _canonical_county(value):
    from apps.deliveries.counties import COUNTIES

    match = next((c for c in COUNTIES if c.lower() == (value or "").strip().lower()), None)
    if not match:
        raise serializers.ValidationError("Choose a county from the list.")
    return match


class AddressSerializer(serializers.ModelSerializer):
    validate_county = staticmethod(_canonical_county)

    class Meta:
        model = Address
        fields = ["id", "label", "recipient_name", "phone", "county", "town", "street_address", "delivery_notes",
                  "is_default"]


class AddressInputSerializer(serializers.ModelSerializer):
    validate_county = staticmethod(_canonical_county)

    class Meta:
        model = Address
        fields = ["label", "recipient_name", "phone", "county", "town", "street_address", "delivery_notes"]


class CheckoutSerializer(CartSerializer):
    address_id = serializers.IntegerField(required=False)
    address = AddressInputSerializer(required=False)
    save_address = serializers.BooleanField(default=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    expected_total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)

    def validate(self, attrs):
        if not attrs.get("address_id") and not attrs.get("address"):
            raise serializers.ValidationError({"address": "Choose or add a delivery address."})
        if not attrs["items"]:
            raise serializers.ValidationError({"items": "Your cart is empty."})
        return attrs


def quote_payload(quote, settings, request=None):
    lines = []
    for ln in quote.lines:
        lst = ln.listing
        row = {"listing_id": ln.listing_id, "quantity": ln.quantity, "error": ln.error}
        if lst is not None:
            img = next((i.url for i in lst.product.images.all() if i.listing_id is None), None)
            row.update({
                "unit_price": str(ln.unit_price), "line_total": str(ln.line_total),
                "product": {"name": lst.product.name, "slug": lst.product.slug, "part_number": lst.product.part_number,
                            "brand": lst.product.brand.name, "image": img},
                "condition": lst.condition, "availability": lst.availability, "warranty": lst.warranty,
                "available_quantity": lst.quantity if lst.availability == "in_stock" else None,
                "min_order_quantity": lst.min_order_quantity,
            })
        lines.append(row)
    return {
        "lines": lines,
        "subtotal": str(quote.subtotal),
        "delivery_fee": str(quote.delivery_fee),
        "total": str(quote.total),
        "free_delivery_threshold": str(settings.free_delivery_threshold),
        "county": quote.county,
        "delivery_available": quote.delivery_available,
        "delivery_days": list(quote.delivery_days) if quote.delivery_days else None,
        "has_errors": quote.has_errors,
    }


# --- Shared pieces ---------------------------------------------------------------------------


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderEvent
        fields = ["id", "kind", "message", "created_at"]


class AdminEventSerializer(serializers.ModelSerializer):
    actor = serializers.CharField(source="actor.full_name", default=None)
    supplier_order = serializers.CharField(source="supplier_order.number", default=None)

    class Meta:
        model = OrderEvent
        fields = ["id", "kind", "message", "created_at", "actor", "supplier_order", "visible_to_customer",
                  "visible_to_supplier"]


# --- Customer ----------------------------------------------------------------------------------


class CustomerItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "product_name", "product_slug", "part_number", "brand_name", "condition", "warranty",
                  "quantity", "unit_price", "line_total", "status"]


def customer_stage(order: Order) -> str:
    """One friendly progress step for the customer, derived from the fulfilment state."""
    if order.status != Order.Status.CONFIRMED:
        return order.status
    statuses = {so.status for so in order.supplier_orders.all() if so.status in SupplierOrder.ACTIVE}
    if statuses and statuses <= {SupplierOrder.Status.COLLECTED}:
        return "ready"
    return "preparing"


class CustomerOrderListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display")
    item_count = serializers.IntegerField(read_only=True)
    stage = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ["number", "status", "status_display", "stage", "total", "payment_status", "item_count", "created_at"]

    def get_stage(self, obj):
        return customer_stage(obj)


class CustomerOrderSerializer(CustomerOrderListSerializer):
    items = CustomerItemSerializer(many=True, read_only=True)
    timeline = serializers.SerializerMethodField()
    payment_method_display = serializers.CharField(source="get_payment_method_display")
    payment_status_display = serializers.CharField(source="get_payment_status_display")
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    can_cancel = serializers.SerializerMethodField()
    refunds = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = CustomerOrderListSerializer.Meta.fields + [
            "items", "timeline", "subtotal", "delivery_fee", "amount_paid", "balance_due", "payment_method",
            "payment_method_display", "payment_status_display", "recipient_name", "phone", "county", "town",
            "street_address", "delivery_notes", "customer_notes", "courier", "tracking_number", "dispatched_at",
            "delivered_at", "cancel_reason", "can_cancel", "courier_phone",
            "expected_delivery_date", "amount_refunded", "refunds", "verified_at",
        ]

    def get_refunds(self, obj):
        return [{"amount": str(r.amount), "refunded_at": r.refunded_at, "reference": r.reference}
                for r in obj.refunds.all()]

    def get_timeline(self, obj):
        return EventSerializer([e for e in obj.events.all() if e.visible_to_customer], many=True).data

    def get_can_cancel(self, obj):
        return obj.status == Order.Status.PENDING


# --- Supplier ----------------------------------------------------------------------------------


class SupplierItemSerializer(serializers.ModelSerializer):
    """No customer price here: suppliers see what they'll be paid."""

    supplier_line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "listing", "product_name", "part_number", "brand_name", "condition", "sku", "warranty",
                  "on_request", "quantity", "supplier_unit_price", "supplier_share", "supplier_line_total", "status"]


class SupplierOrderListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display")
    item_count = serializers.SerializerMethodField()
    supplier_total = serializers.SerializerMethodField()

    class Meta:
        model = SupplierOrder
        fields = ["id", "number", "status", "status_display", "released_at", "accepted_at", "ready_at",
                  "collected_at", "item_count", "supplier_total"]

    def _active(self, obj):
        items = list(obj.items.all())
        active = [i for i in items if i.status == OrderItem.Status.ACTIVE]
        # A rejected/cancelled order keeps its lines visible for the record.
        return active or items

    def get_item_count(self, obj):
        return sum(i.quantity for i in self._active(obj))

    def get_supplier_total(self, obj):
        return str(sum((i.supplier_line_total for i in self._active(obj)), Decimal("0")))


class SupplierOrderSerializer(SupplierOrderListSerializer):
    items = SupplierItemSerializer(many=True, read_only=True)
    timeline = serializers.SerializerMethodField()

    class Meta:
        model = SupplierOrder
        fields = SupplierOrderListSerializer.Meta.fields + ["items", "timeline", "rejection_reason", "supplier_notes"]

    def get_timeline(self, obj):
        return EventSerializer([e for e in obj.events.all() if e.visible_to_supplier], many=True).data


# --- Admin --------------------------------------------------------------------------------------


class AdminItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    supplier_line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    product_id = serializers.IntegerField(source="listing.product_id", read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "listing", "product_id", "product_name", "product_slug", "part_number", "brand_name",
                  "condition", "sku", "on_request", "quantity", "unit_price", "line_total", "supplier_unit_price",
                  "supplier_share", "supplier_line_total", "status", "stock_reserved"]


class AdminSupplierOrderSerializer(serializers.ModelSerializer):
    supplier = SupplierBadgeSerializer(read_only=True)
    supplier_phone = serializers.CharField(source="supplier.business_phone", read_only=True)
    supplier_address = serializers.CharField(source="supplier.physical_address", read_only=True)
    status_display = serializers.CharField(source="get_status_display")
    items = AdminItemSerializer(many=True, read_only=True)

    class Meta:
        model = SupplierOrder
        fields = ["id", "number", "supplier", "supplier_phone", "supplier_address", "status", "status_display",
                  "released_at", "accepted_at", "ready_at", "collected_at", "rejection_reason", "supplier_notes", "items"]


class PaymentSerializer(serializers.ModelSerializer):
    recorded_by = serializers.CharField(source="recorded_by.full_name", default=None)
    method_display = serializers.CharField(source="get_method_display", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "method", "method_display", "amount", "reference", "note", "received_at", "recorded_by"]


class RefundSerializer(serializers.ModelSerializer):
    recorded_by = serializers.CharField(source="recorded_by.full_name", default=None)
    method_display = serializers.CharField(source="get_method_display", read_only=True)

    class Meta:
        model = Refund
        fields = ["id", "method", "method_display", "amount", "reference", "reason", "refunded_at", "recorded_by"]


class AdminOrderListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.full_name")
    status_display = serializers.CharField(source="get_status_display")
    supplier_count = serializers.IntegerField(read_only=True)
    attention = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ["number", "status", "status_display", "customer_name", "phone", "town", "county", "total",
                  "payment_method", "payment_status", "supplier_count", "attention", "created_at", "courier",
                  "courier_phone", "tracking_number", "dispatched_at", "expected_delivery_date", "delivery_attempts",
                  "call_attempts", "last_call_at"]

    def get_attention(self, obj):
        """Short note on what the admin needs to do next."""
        if obj.refund_due > 0:
            return "Refund due"
        if obj.status == Order.Status.PENDING:
            return f"Call again · {obj.call_attempts} missed" if obj.call_attempts else "Call customer to confirm"
        if obj.status == Order.Status.CONFIRMED:
            sos = [so for so in obj.supplier_orders.all()]
            if any(so.status == SupplierOrder.Status.REJECTED and any(i.status == "active" for i in so.items.all())
                   for so in sos):
                return "Supplier rejected items"
            active = [so for so in sos if so.status in SupplierOrder.ACTIVE]
            if active and all(so.status == SupplierOrder.Status.COLLECTED for so in active):
                return "Ready to dispatch"
            ready = sum(so.status == SupplierOrder.Status.READY for so in active)
            if ready:
                return f"{ready} ready for pickup"
            return "Waiting on suppliers"
        if obj.status == Order.Status.DISPATCHED and obj.expected_delivery_date \
                and obj.expected_delivery_date < timezone.localdate():
            return "Delivery overdue"
        if obj.status == Order.Status.DELIVERED and obj.payment_status != Order.PaymentStatus.PAID:
            return "Record payment"
        if obj.status == Order.Status.DELIVERED:
            return "Mark complete"
        return ""


class AdminOrderSerializer(AdminOrderListSerializer):
    customer = serializers.SerializerMethodField()
    supplier_orders = AdminSupplierOrderSerializer(many=True, read_only=True)
    events = AdminEventSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    refunds = RefundSerializer(many=True, read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    refund_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    supplier_cost = serializers.SerializerMethodField()
    suggested_delivery_fee = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = AdminOrderListSerializer.Meta.fields + [
            "suggested_delivery_fee",
            "customer", "recipient_name", "county", "street_address", "delivery_notes", "customer_notes",
            "admin_notes", "subtotal", "delivery_fee", "amount_paid", "balance_due", "supplier_cost", "verified_at",
            "courier", "tracking_number", "dispatched_at", "delivered_at", "completed_at", "cancelled_at",
            "cancel_reason", "supplier_orders", "events", "payments", "refunds", "amount_refunded", "refund_due",
        ]

    def get_suggested_delivery_fee(self, obj):
        """The county's standard fee, to start the conversation on the confirmation call."""
        from apps.core.models import MarketplaceSettings

        return str(MarketplaceSettings.load().delivery_fee_for(obj.subtotal, obj.county))

    def get_customer(self, obj):
        c = obj.customer
        return {"id": c.id, "full_name": c.full_name, "email": c.email, "phone": c.phone,
                "order_count": c.orders.count()}

    def get_supplier_cost(self, obj):
        return str(sum((i.supplier_line_total for i in obj.items.all() if i.status == "active"), Decimal("0")))


class AdminOrderUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["recipient_name", "phone", "county", "town", "street_address", "delivery_notes", "admin_notes"]


class VerifySerializer(serializers.Serializer):
    delivery_fee = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class DispatchSerializer(serializers.Serializer):
    courier = serializers.CharField(max_length=80)
    tracking_number = serializers.CharField(required=False, allow_blank=True, max_length=80)
    courier_phone = serializers.CharField(required=False, allow_blank=True, max_length=20)
    expected_delivery_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)


class PaymentInSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=[c for c in PaymentMethod.choices if c[0] != PaymentMethod.TO_BE_AGREED])
    reference = serializers.CharField(required=False, allow_blank=True, max_length=80)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    received_at = serializers.DateTimeField(required=False)


class RefundInSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=Refund.Method.choices)
    reason = serializers.CharField(max_length=255)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=80)
    refunded_at = serializers.DateTimeField(required=False)


class NoteSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)
    visible_to_customer = serializers.BooleanField(default=False)


class ReassignSerializer(serializers.Serializer):
    listing_id = serializers.IntegerField()
