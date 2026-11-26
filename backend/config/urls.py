from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts import views as accounts
from apps.catalogue import views as catalogue
from apps.core import seo
from apps.core import views as core
from apps.deliveries import views as deliveries
from apps.inventory import views as inventory
from apps.notifications.views import NotificationViewSet
from apps.orders import views as orders
from apps.payments import views as payments
from apps.reports import views as reports
from apps.suppliers import views as suppliers
from apps.support import views as support

public = DefaultRouter()
public.register("products", catalogue.PublicProductViewSet, basename="product")
public.register("notifications", NotificationViewSet, basename="notification")
public.register("account/addresses", orders.AddressViewSet, basename="address")
public.register("account/orders", orders.CustomerOrderViewSet, basename="customer-order")
public.register("support/tickets", support.TicketViewSet, basename="ticket")

supplier = DefaultRouter()
supplier.register("listings", inventory.SupplierListingViewSet, basename="supplier-listing")
supplier.register("documents", suppliers.SupplierDocumentViewSet, basename="supplier-document")
supplier.register("members", suppliers.SupplierMemberViewSet, basename="supplier-member")
supplier.register("orders", orders.SupplierOrderViewSet, basename="supplier-order")

admin_api = DefaultRouter()
admin_api.register("suppliers", suppliers.AdminSupplierViewSet, basename="admin-supplier")
admin_api.register("documents", suppliers.AdminDocumentViewSet, basename="admin-document")
admin_api.register("business-categories", suppliers.AdminBusinessCategoryViewSet, basename="admin-business-category")
admin_api.register("listings", inventory.AdminListingViewSet, basename="admin-listing")
admin_api.register("products", catalogue.AdminProductViewSet, basename="admin-product")
admin_api.register("categories", catalogue.AdminCategoryViewSet, basename="admin-category")
admin_api.register("brands", catalogue.AdminBrandViewSet, basename="admin-brand")
admin_api.register("orders", orders.AdminOrderViewSet, basename="admin-order")
admin_api.register("supplier-orders", orders.AdminSupplierOrderViewSet, basename="admin-supplier-order")
admin_api.register("order-items", orders.AdminOrderItemViewSet, basename="admin-order-item")
admin_api.register("delivery-rates", deliveries.AdminDeliveryRateViewSet, basename="admin-delivery-rate")
admin_api.register("tickets", support.AdminTicketViewSet, basename="admin-ticket")
admin_api.register("team", accounts.AdminTeamViewSet, basename="admin-team")

supplier_urls = [
    path("profile/", suppliers.SupplierProfileView.as_view()),
    path("profile/logo/", suppliers.SupplierImageView.as_view(kind="logo")),
    path("profile/cover/", suppliers.SupplierImageView.as_view(kind="cover")),
    path("dashboard/", inventory.SupplierDashboardView.as_view()),
    path("analytics/", inventory.SupplierAnalyticsView.as_view()),
    path("statement/", reports.SupplierStatementView.as_view()),
    path("catalogue-search/", inventory.CatalogueSearchView.as_view()),
    path("inventory/bulk-update/", inventory.BulkStockUpdateView.as_view()),
    path("inventory/movements/", inventory.StockMovementListView.as_view()),
    path("import/template/", inventory.ImportTemplateView.as_view()),
    path("import/", inventory.ImportView.as_view()),
    path("", include(supplier.urls)),
]

admin_urls = [
    path("dashboard/", core.AdminDashboardView.as_view()),
    path("settings/", core.AdminSettingsView.as_view()),
    path("audit-logs/", core.AdminAuditLogView.as_view()),
    path("customers/", orders.AdminCustomerListView.as_view()),
    path("customers/<int:pk>/", orders.AdminCustomerDetailView.as_view()),
    path("payments/", payments.AdminPaymentListView.as_view()),
    path("payments/summary/", payments.AdminPaymentSummaryView.as_view()),
    path("refunds/", payments.AdminRefundListView.as_view()),
    path("reports/sales/", reports.SalesReportView.as_view()),
    path("reports/products/", reports.ProductsReportView.as_view()),
    path("reports/suppliers/", reports.SuppliersReportView.as_view()),
    path("reports/customers/", reports.CustomersReportView.as_view()),
    path("payouts/", reports.AdminPayoutBalancesView.as_view()),
    path("payouts/<int:pk>/", reports.AdminSupplierStatementView.as_view()),
    path("", include(admin_api.urls)),
]

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("healthz", lambda r: JsonResponse({"ok": True})),
    path("robots.txt", seo.robots_txt),
    path("sitemap.xml", seo.sitemap_xml),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/config/", core.PublicConfigView.as_view()),
    path("api/categories/", catalogue.CategoryTreeView.as_view()),
    path("api/brands/", catalogue.BrandListView.as_view()),
    path("api/cart/quote/", orders.CartQuoteView.as_view()),
    path("api/checkout/options/", orders.CheckoutOptionsView.as_view()),
    path("api/delivery/counties/", deliveries.CountyListView.as_view()),
    path("api/business-categories/", suppliers.BusinessCategoryListView.as_view()),
    path("api/supplier/", include(supplier_urls)),
    path("api/admin/", include(admin_urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/", include(public.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
