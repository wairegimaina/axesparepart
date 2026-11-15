"""
Customer orders and supplier fulfilment orders.

    Order (what the customer bought from the marketplace)
      ├── SupplierOrder for supplier A  ── OrderItems from A
      └── SupplierOrder for supplier B  ── OrderItems from B

The customer only deals with the marketplace. Each supplier only ever sees its own
SupplierOrder: items, quantities and its own prices, never the customer.
"""

import secrets

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.payments.models import PaymentMethod

NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def new_order_number() -> str:
    while True:
        number = "AXE-" + "".join(secrets.choice(NUMBER_ALPHABET) for _ in range(7))
        if not Order.objects.filter(number=number).exists():
            return number


class Order(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        DISPATCHED = "dispatched", "Out for delivery"
        DELIVERED = "delivered", "Delivered"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class PaymentStatus(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PARTIAL = "partial", "Partly paid"
        PAID = "paid", "Paid"
        REFUNDED = "refunded", "Refunded"

    number = models.CharField(max_length=20, unique=True, editable=False)
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True)

    # Delivery details, copied from the address at checkout.
    recipient_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20)
    county = models.CharField(max_length=60)
    town = models.CharField(max_length=60)
    street_address = models.CharField(max_length=255)
    delivery_notes = models.CharField(max_length=255, blank=True)
    customer_notes = models.TextField(blank=True)

    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)

    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    payment_status = models.CharField(max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_refunded = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    call_attempts = models.PositiveSmallIntegerField(default=0, help_text="Confirmation calls with no answer.")
    last_call_at = models.DateTimeField(null=True, blank=True)
    courier = models.CharField(max_length=80, blank=True)
    tracking_number = models.CharField(max_length=80, blank=True)
    courier_phone = models.CharField(max_length=20, blank=True)
    expected_delivery_date = models.DateField(null=True, blank=True)
    delivery_attempts = models.PositiveSmallIntegerField(default=0, help_text="Failed delivery attempts.")
    dispatched_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)
    admin_notes = models.TextField(blank=True, help_text="Internal only.")

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = new_order_number()
        super().save(*args, **kwargs)

    @property
    def net_paid(self):
        return self.amount_paid - self.amount_refunded

    @property
    def balance_due(self):
        if self.status == self.Status.CANCELLED:
            return 0
        return max(self.total - self.net_paid, 0)

    @property
    def refund_due(self):
        """Money we hold beyond what the order now costs (cancelled, item removed, overpaid)."""
        owed = self.net_paid if self.status == self.Status.CANCELLED else self.net_paid - self.total
        return max(owed, 0)

    def __str__(self):
        return self.number


class SupplierOrder(TimeStampedModel):
    """The part of an order one supplier fulfils."""

    class Status(models.TextChoices):
        ON_HOLD = "on_hold", "Waiting for order confirmation"  # not yet visible to the supplier
        INCOMING = "incoming", "New order"
        ACCEPTED = "accepted", "Accepted"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready for pickup"
        COLLECTED = "collected", "Collected by marketplace"
        COMPLETED = "completed", "Completed"
        REJECTED = "rejected", "Rejected by supplier"
        CANCELLED = "cancelled", "Cancelled"

    VISIBLE_TO_SUPPLIER = (
        Status.INCOMING, Status.ACCEPTED, Status.PROCESSING, Status.READY, Status.COLLECTED,
        Status.COMPLETED, Status.REJECTED, Status.CANCELLED,
    )
    ACTIVE = (Status.ON_HOLD, Status.INCOMING, Status.ACCEPTED, Status.PROCESSING, Status.READY, Status.COLLECTED)

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="supplier_orders")
    supplier = models.ForeignKey("suppliers.Supplier", on_delete=models.PROTECT, related_name="supplier_orders")
    number = models.CharField(max_length=24, unique=True, editable=False)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ON_HOLD, db_index=True)
    released_at = models.DateTimeField(null=True, blank=True, help_text="When the supplier could first see it.")
    accepted_at = models.DateTimeField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    supplier_notes = models.TextField(blank=True, help_text="Note from the marketplace to the supplier.")

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.number:
            n = SupplierOrder.objects.filter(order=self.order).count() + 1
            self.number = f"{self.order.number}-{n}"
            while SupplierOrder.objects.filter(number=self.number).exists():
                n += 1
                self.number = f"{self.order.number}-{n}"
        super().save(*args, **kwargs)

    @property
    def is_visible_to_supplier(self):
        return self.released_at is not None

    def __str__(self):
        return self.number


class OrderItem(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CANCELLED = "cancelled", "Cancelled"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    supplier_order = models.ForeignKey(SupplierOrder, on_delete=models.PROTECT, related_name="items")
    listing = models.ForeignKey("inventory.SupplierListing", on_delete=models.PROTECT, related_name="order_items")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)

    # Snapshot at checkout so later catalogue edits don't rewrite history.
    product_name = models.CharField(max_length=200)
    product_slug = models.SlugField(max_length=90)
    part_number = models.CharField(max_length=80, blank=True)
    brand_name = models.CharField(max_length=100)
    condition = models.CharField(max_length=12)
    sku = models.CharField(max_length=60, blank=True)
    warranty = models.CharField(max_length=120, blank=True)
    on_request = models.BooleanField(default=False, help_text="Supplier sources it; no stock was reserved.")

    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, help_text="Customer price")
    supplier_unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    stock_reserved = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]

    @property
    def line_total(self):
        return self.unit_price * self.quantity

    @property
    def supplier_line_total(self):
        return self.supplier_unit_price * self.quantity


class OrderEvent(models.Model):
    """Timeline entry. Flags decide who may read it."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    supplier_order = models.ForeignKey(SupplierOrder, null=True, blank=True, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=40)
    message = models.TextField()
    visible_to_customer = models.BooleanField(default=False)
    visible_to_supplier = models.BooleanField(default=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
