from django.contrib import admin

from .models import Payment, Refund, SupplierPayout

admin.site.register(Payment, list_display=["order", "method", "amount", "reference", "received_at"])
admin.site.register(Refund, list_display=["order", "method", "amount", "reference", "refunded_at"])
admin.site.register(SupplierPayout, list_display=["supplier", "amount", "method", "reference", "paid_at"])
