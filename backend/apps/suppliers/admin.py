from django.contrib import admin

from .models import BusinessCategory, Supplier, SupplierDocument, SupplierMember


class MemberInline(admin.TabularInline):
    model = SupplierMember
    extra = 0
    raw_id_fields = ["user"]


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ["name", "status", "is_verified", "county", "created_at"]
    list_filter = ["status", "is_verified", "county"]
    search_fields = ["name", "registration_number", "business_email"]
    inlines = [MemberInline]


admin.site.register(BusinessCategory)
admin.site.register(SupplierDocument, list_display=["supplier", "doc_type", "status", "created_at"])
