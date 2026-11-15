from django.conf import settings
from django.db import models


class PaymentMethod(models.TextChoices):
    # New orders: how the customer pays is agreed on the confirmation call, not chosen at checkout.
    TO_BE_AGREED = "to_be_agreed", "To be agreed"
    CASH_ON_DELIVERY = "cash_on_delivery", "Cash on delivery"
    BANK_TRANSFER = "bank_transfer", "Bank transfer"
    # Gateways (e.g. M-Pesa) add a choice here plus a provider module that records Payments.


class Payment(models.Model):
    """Money received for an order. Recorded by an admin today; by a gateway callback later."""

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="payments")
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reference = models.CharField(max_length=80, blank=True, help_text="Bank reference, receipt number, …")
    note = models.CharField(max_length=255, blank=True)
    received_at = models.DateTimeField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self):
        return f"{self.amount} for {self.order}"


class Refund(models.Model):
    """Money returned to a customer, e.g. for a cancelled order or a removed item. Recorded by an admin."""

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        BANK_TRANSFER = "bank_transfer", "Bank transfer"
        OTHER = "other", "Other"

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, choices=Method.choices)
    reference = models.CharField(max_length=80, blank=True)
    reason = models.CharField(max_length=255)
    refunded_at = models.DateTimeField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-refunded_at"]

    def __str__(self):
        return f"Refund {self.amount} for {self.order}"


class SupplierPayout(models.Model):
    """Money the marketplace paid a supplier for parts collected from them."""

    class Method(models.TextChoices):
        BANK_TRANSFER = "bank_transfer", "Bank transfer"
        CASH = "cash", "Cash"
        CHEQUE = "cheque", "Cheque"
        OTHER = "other", "Other"

    supplier = models.ForeignKey("suppliers.Supplier", on_delete=models.PROTECT, related_name="payouts")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, choices=Method.choices, default=Method.BANK_TRANSFER)
    reference = models.CharField(max_length=80, blank=True)
    note = models.CharField(max_length=255, blank=True)
    paid_at = models.DateTimeField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at"]

    def __str__(self):
        return f"Payout {self.amount} to {self.supplier}"
