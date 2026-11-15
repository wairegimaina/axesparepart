from collections import defaultdict

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, Max, Min, OuterRef, Prefetch, Q
from django.http import Http404
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import storage
from apps.core.background import wants_cutout
from apps.core.audit import audit
from apps.core.models import MarketplaceSettings
from apps.core.permissions import IsAdmin
from apps.inventory.models import SupplierListing
from apps.inventory.queries import deal_active_q, published_listings, published_q, regular_price_expr, selling_price_expr

from .models import Brand, Category, Product, ProductImage, normalize_part_number
from .serializers import (
    AdminProductSerializer, BrandSerializer, CategorySerializer, CategoryTreeSerializer, ImageSerializer,
    ProductCardSerializer, ProductDetailSerializer, ProductWriteSerializer,
)


class CategoryTreeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        cats = list(Category.objects.filter(is_active=True))
        by_parent = defaultdict(list)
        for c in cats:
            by_parent[c.parent_id].append(c)
        ctx = {"by_parent": by_parent}
        return Response(CategoryTreeSerializer(by_parent[None], many=True, context=ctx).data)


class BrandListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = BrandSerializer
    pagination_class = None
    filter_backends = []

    def get_queryset(self):
        """Brands with something on sale. `?all=1` lists every active brand (for product forms)."""
        if self.request.query_params.get("all") in ("1", "true"):
            return Brand.objects.filter(is_active=True)
        live = Q(products__status=Product.Status.ACTIVE, products__listings__in=published_listings())
        return (
            Brand.objects.filter(is_active=True)
            .annotate(product_count=Count("products", filter=live, distinct=True))
            .filter(product_count__gt=0)
            .order_by("name")
        )


def product_search_q(term: str) -> Q:
    term = term.strip()
    q = Q(name__icontains=term) | Q(brand__name__icontains=term) | Q(compatibility__icontains=term)
    normalized = normalize_part_number(term)
    if normalized:
        q |= Q(part_number_normalized__contains=normalized)
    return q


class PublicProductViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Marketplace browsing. A product appears once, however many suppliers sell it,
    with the lowest customer price across its published offers.

    Query params: q, category (slug, includes sub-categories), brand (slug, comma list),
    condition, in_stock=true, sort=price_asc|price_desc|newest|popular.
    """

    permission_classes = [AllowAny]
    lookup_field = "slug"
    filter_backends = []

    def get_serializer_class(self):
        return ProductDetailSerializer if self.action == "retrieve" else ProductCardSerializer

    def _offer_q(self, prefix: str) -> Q:
        p = self.request.query_params
        q = published_q(prefix)
        if p.get("condition"):
            q &= Q(**{f"{prefix}condition": p["condition"]})
        return q

    def get_queryset(self):
        p = self.request.query_params
        markup = MarketplaceSettings.load().default_markup_percent
        offer_q = self._offer_q("listings__")
        offers_qs = SupplierListing.objects.filter(self._offer_q("")).select_related("supplier")
        in_stock_offer = offers_qs.filter(
            product=OuterRef("pk"), availability=SupplierListing.Availability.IN_STOCK, quantity__gt=0
        )
        qs = (
            Product.objects.filter(status=Product.Status.ACTIVE)
            .select_related("brand", "category")
            .annotate(
                offer_count=Count("listings", filter=offer_q, distinct=True),
                min_price=Min(selling_price_expr(markup, "listings__"), filter=offer_q),
                regular_min_price=Min(regular_price_expr(markup, "listings__"), filter=offer_q),
                deal_percent=Max("listings__deal_percent", filter=offer_q & deal_active_q("listings__")),
                in_stock=Exists(in_stock_offer),
            )
            .filter(offer_count__gt=0)
            .prefetch_related(
                Prefetch("images", queryset=ProductImage.objects.filter(listing__isnull=True), to_attr="catalogue_images"),
                Prefetch("listings", queryset=offers_qs, to_attr="published_offers"),
            )
        )
        if p.get("q"):
            qs = qs.filter(product_search_q(p["q"]))
        if p.get("category"):
            cat = Category.objects.filter(slug=p["category"], is_active=True).first()
            qs = qs.filter(category_id__in=cat.descendant_ids()) if cat else qs.none()
        if p.get("brand"):
            qs = qs.filter(brand__slug__in=p["brand"].split(","))
        if p.get("in_stock") in ("1", "true"):
            qs = qs.filter(in_stock=True)
        if p.get("deals") in ("1", "true"):
            qs = qs.filter(deal_percent__isnull=False)
        order = {
            "deal": ["-deal_percent", "name"],
            "price_asc": ["min_price", "name"],
            "price_desc": ["-min_price", "name"],
            "newest": ["-created_at"],
            "popular": ["-view_count", "name"],
        }.get(p.get("sort", ""), ["-in_stock", "name"])
        return qs.order_by(*order)

    def retrieve(self, request, *args, **kwargs):
        product = (
            Product.objects.filter(slug=kwargs["slug"], status=Product.Status.ACTIVE)
            .select_related("brand", "category__parent__parent")
            .prefetch_related("images")
            .first()
        )
        if product is None:
            raise Http404
        markup = MarketplaceSettings.load().default_markup_percent
        offers = list(
            published_listings()
            .filter(product=product)
            .annotate(customer_price=selling_price_expr(markup))
            .prefetch_related("images")
            .order_by("customer_price")
        )
        if not offers:
            raise Http404
        Product.objects.filter(pk=product.pk).update(view_count=F("view_count") + 1)
        SupplierListing.objects.filter(pk__in=[o.pk for o in offers]).update(view_count=F("view_count") + 1)
        ser = ProductDetailSerializer(product, context={"request": request, "offers": offers})
        return Response(ser.data)


# --- Administrator ------------------------------------------------------------


class AdminCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = CategorySerializer
    queryset = Category.objects.all()
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete"]

    def perform_destroy(self, cat):
        if cat.products.exists() or cat.children.exists():
            raise ValidationError("This category has products or sub-categories. Deactivate it instead.")
        cat.delete()


class AdminBrandViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = BrandSerializer
    queryset = Brand.objects.all()
    search_fields = ["name"]
    http_method_names = ["get", "post", "patch", "delete"]

    def perform_destroy(self, brand):
        if brand.products.exists():
            raise ValidationError("This brand has products. Deactivate it instead.")
        brand.delete()


class AdminProductViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                          viewsets.GenericViewSet):
    """Canonical catalogue. Admins correct names, categories and specs that suppliers proposed."""

    permission_classes = [IsAdmin]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "patch", "post", "delete"]
    search_fields = ["name", "part_number", "brand__name"]
    filterset_fields = ["status", "category", "brand"]
    ordering_fields = ["name", "created_at", "view_count"]

    def get_queryset(self):
        return (
            Product.objects.select_related("brand", "category", "created_by_supplier")
            .prefetch_related("images")
            .annotate(listing_count=Count("listings", filter=~Q(listings__status="archived"), distinct=True))
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        return ProductWriteSerializer if self.action in ("update", "partial_update") else AdminProductSerializer

    def update(self, request, *args, **kwargs):
        product = self.get_object()
        s = ProductWriteSerializer(product, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                s.save()
        except IntegrityError:
            raise ValidationError({"part_number": "Another catalogue product already has this brand and part number."})
        if "status" in request.data and request.data["status"] in Product.Status.values:
            product.status = request.data["status"]
            product.save(update_fields=["status", "updated_at"])
        audit(request, "product.edited", product, fields=sorted(request.data.keys()))
        return Response(AdminProductSerializer(self.get_queryset().get(pk=product.pk)).data)

    @action(detail=True, methods=["post"], url_path="images")
    def upload_image(self, request, pk=None):
        product = self.get_object()
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose an image."})
        existing = product.images.filter(listing__isnull=True).count()
        if existing >= settings.MAX_PRODUCT_IMAGES:
            raise ValidationError(f"Up to {settings.MAX_PRODUCT_IMAGES} images per product.")
        stored = storage.upload_image(upload, f"products/{product.id}", remove_background=wants_cutout(request))
        img = ProductImage.objects.create(
            product=product, url=stored.url, public_id=stored.public_id, position=existing
        )
        return Response(ImageSerializer(img).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>\d+)")
    def delete_image(self, request, pk=None, image_id=None):
        img = ProductImage.objects.filter(product_id=pk, pk=image_id).first()
        if img is None:
            raise Http404
        storage.delete_file(img.public_id)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
