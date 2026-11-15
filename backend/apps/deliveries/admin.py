from django.contrib import admin

from .models import DeliveryRate

admin.site.register(DeliveryRate, list_display=["county", "fee", "days_min", "days_max", "is_active"])
