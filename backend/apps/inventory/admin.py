from django.contrib import admin

from .models import ListingEvent, StockMovement, SupplierListing


@admin.register(SupplierListing)
class SupplierListingAdmin(admin.ModelAdmin):
    list_display = ["product", "supplier", "condition", "supplier_price", "quantity", "status"]
    list_filter = ["status", "condition", "availability"]
    search_fields = ["product__name", "product__part_number", "sku", "supplier__name"]
    raw_id_fields = ["product"]


admin.site.register(StockMovement, list_display=["listing", "change", "quantity_after", "reason", "created_at"])
admin.site.register(ListingEvent, list_display=["listing", "action", "actor", "created_at"])
