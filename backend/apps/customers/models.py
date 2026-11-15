from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class Address(TimeStampedModel):
    """A customer's saved delivery address. Orders copy it, so later edits don't change past orders."""

    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, blank=True, help_text="e.g. Workshop, Home")
    recipient_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20)
    county = models.CharField(max_length=60)
    town = models.CharField(max_length=60)
    street_address = models.CharField(max_length=255, help_text="Street, building, floor or landmark")
    delivery_notes = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "-updated_at"]
        verbose_name_plural = "addresses"

    def save(self, *args, **kwargs):
        if not self.pk and not Address.objects.filter(customer=self.customer).exists():
            self.is_default = True
        super().save(*args, **kwargs)
        if self.is_default:
            Address.objects.filter(customer=self.customer).exclude(pk=self.pk).update(is_default=False)

    def __str__(self):
        return f"{self.recipient_name}, {self.town}"
