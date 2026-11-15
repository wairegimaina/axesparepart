from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from .counties import COUNTIES


class DeliveryRate(models.Model):
    """Delivery fee and time for one county. Counties without a rate use the standard fee in settings."""

    county = models.CharField(max_length=60, unique=True, choices=[(c, c) for c in COUNTIES])
    fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    days_min = models.PositiveSmallIntegerField(default=1)
    days_max = models.PositiveSmallIntegerField(default=3)
    is_active = models.BooleanField(default=True, help_text="Off = we don't deliver to this county.")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["county"]

    def clean(self):
        if self.days_max < self.days_min:
            raise ValidationError({"days_max": "Must be at least the minimum days."})

    def __str__(self):
        return f"{self.county}: {self.fee}"
