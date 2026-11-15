from django.conf import settings
from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import Http404, HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalogue.models import Product, ProductImage
from apps.catalogue.views import product_search_q
from apps.core import storage
from apps.core.background import wants_cutout
from apps.core.audit import audit
from apps.core.models import MarketplaceSettings
from apps.core.permissions import IsAdmin, SupplierRolePermission
from apps.suppliers.models import SupplierMember

from . import importer, services
from .models import ListingEvent, StockMovement, SupplierListing
from .serializers import (
    AdminListingSerializer, ApproveSerializer, BulkStockSerializer, CatalogueMatchSerializer, ImageSerializer,
    ListingEventSerializer, ListingWriteSerializer, PriceSerializer, RejectSerializer, StockAdjustSerializer,
    StockMovementSerializer, SupplierListingSerializer, DealSerializer,
)

L = SupplierListing
R = SupplierMember.Role
STOCK_EDITORS = {R.OWNER, R.MANAGER, R.INVENTORY}
MAX_IMAGES = settings.MAX_PRODUCT_IMAGES


def pricing_context(extra=None):
    s = MarketplaceSettings.load()
    ctx = {"markup": s.default_markup_percent, "low_stock_default": s.default_low_stock_threshold}
    ctx.update(extra or {})
    return ctx


def low_stock_q():
    default = MarketplaceSettings.load().default_low_stock_threshold
    return ~Q(availability=L.Availability.ON_REQUEST) & (
        Q(low_stock_threshold__isnull=True, quantity__lte=default)
        | Q(low_stock_threshold__isnull=False, quantity__lte=F("low_stock_threshold"))
    )


# --- Supplier portal ----------------------------------------------------------


class SupplierListingViewSet(viewsets.ModelViewSet):
    """
    The supplier's products. Filters: status, condition, availability, low_stock=true, search.
    """

    permission_classes = [SupplierRolePermission]
    member_roles = {a: STOCK_EDITORS for a in (
        "create", "update", "partial_update", "destroy", "submit", "archive", "adjust_stock",
        "upload_image", "delete_image", "deal",
    )}
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "post", "patch", "delete"]
    search_fields = ["product__name", "product__part_number", "sku", "product__brand__name"]
    filterset_fields = ["status", "condition", "availability"]
    ordering_fields = ["updated_at", "created_at", "quantity", "supplier_price", "view_count"]

    def get_queryset(self):
        qs = (
            self.request.supplier.listings.select_related("supplier", "product__brand", "product__category")
            .prefetch_related("images", "product__images")
        )
        if self.request.query_params.get("low_stock") in ("1", "true"):
            qs = qs.filter(low_stock_q()).exclude(status=L.Status.ARCHIVED)
        if self.action == "list" and "status" not in self.request.query_params:
            qs = qs.exclude(status=L.Status.ARCHIVED)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **pricing_context()}

    def get_serializer_class(self):
        return ListingWriteSerializer if self.action in ("create", "update", "partial_update") else SupplierListingSerializer

    def _respond(self, listing, code=status.HTTP_200_OK, **extra):
        listing = self.get_queryset().model.objects.select_related(
            "supplier", "product__brand", "product__category"
        ).prefetch_related("images", "product__images").get(pk=listing.pk)
        data = SupplierListingSerializer(listing, context=self.get_serializer_context()).data
        data.update(extra)
        return Response(data, status=code)

    def create(self, request, *args, **kwargs):
        s = ListingWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        product_data = data.pop("product_details", None)
        listing, matched = services.create_listing(request.supplier, request.user, data, product_data)
        return self._respond(listing, status.HTTP_201_CREATED, matched_existing_product=matched)

    def update(self, request, *args, **kwargs):
        listing = self.get_object()
        s = ListingWriteSerializer(listing, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        product_data = data.pop("product_details", None)
        services.update_listing(listing, request.user, data, product_data)
        return self._respond(listing)

    def destroy(self, request, *args, **kwargs):
        listing = self.get_object()
        if listing.status == L.Status.DRAFT and not listing.events.exclude(action=ListingEvent.Action.CREATED).exists():
            product = listing.product
            with transaction.atomic():
                for img in listing.images.all():
                    storage.delete_file(img.public_id)
                listing.delete()
                if product.status == Product.Status.PENDING and not product.listings.exists():
                    for img in product.images.all():
                        storage.delete_file(img.public_id)
                    product.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        services.archive_listing(listing, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        return self._respond(services.submit_listing(self.get_object(), request.user))

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._respond(services.archive_listing(self.get_object(), request.user))

    @action(detail=True, methods=["post", "delete"])
    def deal(self, request, pk=None):
        """POST starts an offer (sent to the admin for approval); DELETE ends it."""
        listing = self.get_object()
        if request.method == "DELETE":
            return self._respond(services.end_deal(listing, request.user))
        s = DealSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        return self._respond(services.start_deal(listing, request.user, d["percent"], d.get("title", ""), d.get("ends_at")))

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        events = self.get_object().events.select_related("actor")
        return Response(ListingEventSerializer(events, many=True).data)

    @action(detail=True, methods=["post"], url_path="stock")
    def adjust_stock(self, request, pk=None):
        listing = self.get_object()
        s = StockAdjustSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.set_quantity(listing, s.validated_data["quantity"], s.validated_data["reason"], request.user,
                              s.validated_data.get("note", ""))
        return self._respond(listing)

    @action(detail=True, methods=["post"], url_path="images")
    def upload_image(self, request, pk=None):
        """New product the supplier created → catalogue image. Shared product → this listing's own photo."""
        listing = self.get_object()
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose an image."})
        to_catalogue = services.can_edit_product(listing.product, listing.supplier)
        existing = (ProductImage.objects.filter(product=listing.product, listing__isnull=True) if to_catalogue
                    else listing.images.all())
        if existing.count() >= MAX_IMAGES:
            raise ValidationError(f"Up to {MAX_IMAGES} images per product.")
        stored = storage.upload_image(upload, f"products/{listing.product_id}", remove_background=wants_cutout(request))
        img = ProductImage.objects.create(
            product=listing.product, listing=None if to_catalogue else listing, url=stored.url,
            public_id=stored.public_id, position=existing.count(),
        )
        return Response(ImageSerializer(img).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>\d+)")
    def delete_image(self, request, pk=None, image_id=None):
        listing = self.get_object()
        img = ProductImage.objects.filter(pk=image_id).filter(
            Q(listing=listing) | Q(listing__isnull=True, product=listing.product)
        ).first()
        if img is None:
            raise Http404
        if img.listing_id is None and not services.can_edit_product(listing.product, listing.supplier):
            raise ValidationError("Catalogue images are managed by the marketplace admin.")
        storage.delete_file(img.public_id)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CatalogueSearchView(APIView):
    """Lets a supplier find an existing catalogue part before creating a duplicate."""

    permission_classes = [SupplierRolePermission]

    def get(self, request):
        term = request.query_params.get("q", "").strip()
        if len(term) < 2:
            return Response([])
        qs = (
            Product.objects.exclude(status=Product.Status.INACTIVE)
            .filter(Q(status=Product.Status.ACTIVE) | Q(created_by_supplier=request.supplier))
            .filter(product_search_q(term))
            .select_related("brand", "category")[:20]
        )
        return Response(CatalogueMatchSerializer(qs, many=True).data)


class BulkStockUpdateView(APIView):
    permission_classes = [SupplierRolePermission]
    member_roles = {"*": STOCK_EDITORS}

    def post(self, request):
        s = BulkStockSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        items = s.validated_data["items"]
        note = s.validated_data.get("note", "")
        listings = {lst.id: lst for lst in request.supplier.listings.filter(id__in=[i["id"] for i in items])}
        missing = [i["id"] for i in items if i["id"] not in listings]
        if missing:
            raise ValidationError({"items": f"Not your products: {missing}"})
        with transaction.atomic():
            for item in items:
                listing = listings[item["id"]]
                fields = {k: v for k, v in item.items() if k in ("supplier_price", "availability")}
                if fields:
                    services.update_listing(listing, request.user, fields, None)
                if "quantity" in item:
                    services.set_quantity(listing, item["quantity"], StockMovement.Reason.BULK, request.user, note)
        return Response({"updated": len(items)})


class StockMovementListView(APIView):
    permission_classes = [SupplierRolePermission]

    def get(self, request):
        qs = StockMovement.objects.filter(listing__supplier=request.supplier).select_related(
            "listing__product", "user"
        )
        if request.query_params.get("listing"):
            qs = qs.filter(listing_id=request.query_params["listing"])
        from apps.core.pagination import StandardPagination

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(StockMovementSerializer(page, many=True).data)


class ImportTemplateView(APIView):
    permission_classes = [SupplierRolePermission]

    def get(self, request):
        resp = HttpResponse(
            importer.build_template(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        resp["Content-Disposition"] = 'attachment; filename="axespareparts-product-import.xlsx"'
        return resp


class ImportView(APIView):
    permission_classes = [SupplierRolePermission]
    member_roles = {"*": STOCK_EDITORS}
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose the filled-in template."})
        if upload.size > 5 * 1024 * 1024:
            raise ValidationError({"file": "The file is larger than 5 MB."})
        dry_run = request.data.get("dry_run") in ("1", "true", True)
        return Response(importer.run_import(request.supplier, request.user, upload, dry_run=dry_run))


class SupplierDashboardView(APIView):
    permission_classes = [SupplierRolePermission]

    def get(self, request):
        supplier = request.supplier
        listings = supplier.listings.exclude(status=L.Status.ARCHIVED)
        by_status = {r["status"]: r["n"] for r in listings.values("status").annotate(n=Count("id"))}
        totals = listings.aggregate(views=Sum("view_count"), units=Sum("quantity"))
        recent = ListingEvent.objects.filter(listing__supplier=supplier).select_related("listing__product", "actor")[:10]
        return Response({
            "company_status": supplier.status,
            "is_verified": supplier.is_verified,
            "status_reason": supplier.status_reason,
            "profile_completeness": profile_completeness(supplier),
            "listings_by_status": {s: by_status.get(s, 0) for s in ("draft", "pending", "approved", "rejected")},
            "low_stock": listings.filter(status=L.Status.APPROVED).filter(low_stock_q()).count(),
            "orders": supplier_order_counts(supplier),
            "total_views": totals["views"] or 0,
            "units_in_stock": totals["units"] or 0,
            "recent_activity": [
                {"id": e.id, "action": e.action, "product": e.listing.product.name, "listing_id": e.listing_id,
                 "note": e.note, "created_at": e.created_at}
                for e in recent
            ],
        })


def supplier_order_counts(supplier) -> dict:
    from apps.orders.models import SupplierOrder

    S = SupplierOrder.Status
    rows = {
        r["status"]: r["n"]
        for r in SupplierOrder.objects.filter(supplier=supplier, released_at__isnull=False)
        .values("status").annotate(n=Count("id"))
    }
    return {
        "incoming": rows.get(S.INCOMING, 0),
        "in_progress": rows.get(S.ACCEPTED, 0) + rows.get(S.PROCESSING, 0) + rows.get(S.READY, 0),
    }


def profile_completeness(supplier) -> dict:
    checks = {
        "logo": bool(supplier.logo_url),
        "cover_image": bool(supplier.cover_url),
        "description": len(supplier.description) >= 80,
        "business_categories": supplier.business_categories.exists(),
        "contact_details": bool(supplier.business_phone and supplier.business_email),
        "location": bool(supplier.county and supplier.physical_address),
        "registration_document": supplier.documents.filter(doc_type="registration").exists(),
        "tax_document": supplier.documents.filter(doc_type="tax").exists(),
    }
    return {"percent": round(100 * sum(checks.values()) / len(checks)), "checks": checks}


def supplier_sales(supplier):
    from apps.orders.views import supplier_sales as compute

    return compute(supplier)


class SupplierAnalyticsView(APIView):
    permission_classes = [SupplierRolePermission]

    def get(self, request):
        listings = (
            request.supplier.listings.filter(status=L.Status.APPROVED)
            .select_related("product")
            .order_by("-view_count")[:20]
        )
        return Response({
            "top_products": [
                {"id": lst.id, "name": lst.product.name, "part_number": lst.product.part_number,
                 "views": lst.view_count, "quantity": lst.quantity}
                for lst in listings
            ],
            "sales": supplier_sales(request.supplier),
        })


# --- Administrator ------------------------------------------------------------


class AdminListingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Approval queue and every listing on the marketplace."""

    permission_classes = [IsAdmin]
    serializer_class = AdminListingSerializer
    search_fields = ["product__name", "product__part_number", "sku", "supplier__name"]
    filterset_fields = ["status", "supplier", "condition", "product", "deal_status"]
    ordering_fields = ["submitted_at", "updated_at", "supplier_price"]

    def get_queryset(self):
        return (
            L.objects.select_related("supplier", "product__brand", "product__category")
            .prefetch_related("images", "product__images")
            .order_by(F("submitted_at").asc(nulls_last=True), "-updated_at")
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **pricing_context({"detail": self.action != "list"})}

    def _respond(self, listing):
        listing = self.get_queryset().get(pk=listing.pk)
        return Response(AdminListingSerializer(listing, context=pricing_context({"detail": True})).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        s = ApproveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        listing = services.approve_listing(
            self.get_object(), request.user, s.validated_data.get("price_override"), s.validated_data.get("note", "")
        )
        audit(request, "listing.approved", listing)
        return self._respond(listing)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        s = RejectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        listing = services.reject_listing(self.get_object(), request.user, s.validated_data["reason"])
        audit(request, "listing.rejected", listing, s.validated_data["reason"])
        return self._respond(listing)

    @action(detail=True, methods=["post"])
    def price(self, request, pk=None):
        s = PriceSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        listing = services.set_price_override(self.get_object(), request.user, s.validated_data["price_override"])
        audit(request, "listing.price_set", listing, price=str(s.validated_data["price_override"]))
        return self._respond(listing)

    @action(detail=True, methods=["post"], url_path="approve-deal")
    def approve_deal(self, request, pk=None):
        listing = services.approve_deal(self.get_object(), request.user)
        audit(request, "listing.deal_approved", listing, percent=listing.deal_percent)
        return self._respond(listing)

    @action(detail=True, methods=["post"], url_path="reject-deal")
    def reject_deal(self, request, pk=None):
        s = RejectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        listing = services.reject_deal(self.get_object(), request.user, s.validated_data["reason"])
        audit(request, "listing.deal_rejected", listing, s.validated_data["reason"])
        return self._respond(listing)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        listing = self.get_object()
        reason = request.data.get("reason", "")
        if listing.status != L.Status.APPROVED:
            raise ValidationError("Only published listings can be unpublished.")
        listing.status = L.Status.PENDING
        listing.save(update_fields=["status", "updated_at"])
        services.log_event(listing, ListingEvent.Action.REAPPROVAL, request.user, reason or "Unpublished by admin")
        audit(request, "listing.unpublished", listing, reason)
        return self._respond(listing)
