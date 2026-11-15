from django.contrib import admin

from .models import Brand, Category, Product, ProductImage


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "brand", "part_number", "category", "status"]
    list_filter = ["status", "brand", "category"]
    search_fields = ["name", "part_number"]


admin.site.register(Category, list_display=["__str__", "is_active", "position"])
admin.site.register(Brand)
admin.site.register(ProductImage)
