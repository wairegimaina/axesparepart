import secrets

from django.conf import settings
from django.db import models

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_ticket_number():
    while True:
        number = "SUP-" + "".join(secrets.choice(ALPHABET) for _ in range(6))
        if not Ticket.objects.filter(number=number).exists():
            return number


class Ticket(models.Model):
    """A help request from a customer or a supplier company. Only admins answer."""

    class Status(models.TextChoices):
        OPEN = "open", "Waiting for us"
        ANSWERED = "answered", "Answered"
        RESOLVED = "resolved", "Resolved"

    class Category(models.TextChoices):
        ORDER = "order", "An order"
        DELIVERY = "delivery", "Delivery"
        PAYMENT = "payment", "Payment or refund"
        PRODUCT = "product", "A product"
        ACCOUNT = "account", "My account"
        OTHER = "other", "Something else"

    class Priority(models.TextChoices):
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"

    number = models.CharField(max_length=12, unique=True, editable=False)
    opened_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="tickets")
    # Set when a supplier team member opens it, so the whole team shares it.
    supplier = models.ForeignKey("suppliers.Supplier", null=True, blank=True, on_delete=models.CASCADE,
                                 related_name="tickets")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="tickets")
    supplier_order = models.ForeignKey("orders.SupplierOrder", null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="tickets")
    category = models.CharField(max_length=12, choices=Category.choices, default=Category.OTHER)
    subject = models.CharField(max_length=150)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.NORMAL)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="assigned_tickets")
    last_message_at = models.DateTimeField(auto_now_add=True, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_message_at"]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = new_ticket_number()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.number} {self.subject}"


class TicketMessage(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    from_staff = models.BooleanField(default=False)
    internal = models.BooleanField(default=False, help_text="Staff-only note, never shown to the requester.")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
