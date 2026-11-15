from django.contrib import admin

# Register your models here.
from .models import Order, OrderEvent, OrderItem, SupplierOrder


class ItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    raw_id_fields = ["listing", "supplier_order"]


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["number", "customer", "status", "payment_status", "total", "created_at"]
    list_filter = ["status", "payment_status"]
    search_fields = ["number", "customer__email", "phone"]
    inlines = [ItemInline]
    raw_id_fields = ["customer"]


admin.site.register(SupplierOrder, list_display=["number", "supplier", "status", "released_at"])
admin.site.register(OrderEvent, list_display=["order", "kind", "created_at"])
