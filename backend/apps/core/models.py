from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class MarketplaceSettings(models.Model):
    """Singleton row edited from the admin portal. Read with MarketplaceSettings.load()."""

    default_markup_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("15.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("500"))],
        help_text="Added to the supplier price to get the customer price, unless an admin overrides it.",
    )
    default_low_stock_threshold = models.PositiveIntegerField(default=5)
    currency = models.CharField(max_length=3, default="KES")
    delivery_fee = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("500"),
        help_text="Standard delivery charge. Admins can adjust it per order when verifying.",
    )
    free_delivery_threshold = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0"),
        help_text="Orders at or above this subtotal deliver free. 0 turns free delivery off.",
    )
    cash_on_delivery_enabled = models.BooleanField(default=True)
    support_phone = models.CharField(max_length=20, blank=True)
    support_whatsapp = models.CharField(max_length=20, blank=True, help_text="Number with country code, e.g. 254712345678")
    support_email = models.EmailField(blank=True)
    support_hours = models.CharField(max_length=120, blank=True, help_text="e.g. Mon–Sat 8am–6pm")
    google_client_id = models.CharField(
        max_length=200, blank=True,
        help_text="OAuth client ID from Google Cloud Console. Leave empty to hide 'Continue with Google'.",
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name = "marketplace settings"
        verbose_name_plural = "marketplace settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "MarketplaceSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def delivery_for(self, subtotal: Decimal, county: str | None = None) -> dict:
        """Fee and expected days for a county. Free delivery applies everywhere we deliver."""
        from apps.deliveries.models import DeliveryRate

        rate = DeliveryRate.objects.filter(county__iexact=(county or "").strip()).first() if county else None
        if rate and not rate.is_active:
            return {"fee": None, "days_min": None, "days_max": None, "available": False}
        fee = rate.fee if rate else self.delivery_fee
        if self.free_delivery_threshold and subtotal >= self.free_delivery_threshold:
            fee = Decimal("0")
        return {"fee": fee, "days_min": rate.days_min if rate else None, "days_max": rate.days_max if rate else None,
                "available": True}

    def delivery_fee_for(self, subtotal: Decimal, county: str | None = None) -> Decimal:
        return self.delivery_for(subtotal, county)["fee"] or Decimal("0")

    def __str__(self):
        return "Marketplace settings"


class AuditLog(models.Model):
    """Append-only record of sensitive actions (approvals, verifications, settings changes)."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    action = models.CharField(max_length=64, db_index=True)
    target_type = models.CharField(max_length=64)
    target_id = models.CharField(max_length=64)
    message = models.TextField(blank=True)
    data = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} {self.target_type}#{self.target_id}"
