from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.catalogue.models import Product
from apps.catalogue.serializers import (
    BrandRefSerializer, CategoryRefSerializer, ImageSerializer, ProductWriteSerializer, SpecificationSerializer,
)
from apps.suppliers.serializers import SupplierBadgeSerializer

from .models import ListingEvent, StockMovement, SupplierListing

L = SupplierListing


class PublicOfferSerializer(serializers.ModelSerializer):
    """An offer as customers see it: customer price only. Customers never see who supplies it."""

    price = serializers.SerializerMethodField()
    images = ImageSerializer(many=True, read_only=True)
    in_stock = serializers.SerializerMethodField()
    deal = serializers.SerializerMethodField()

    class Meta:
        model = SupplierListing
        fields = [
            "id", "condition", "price", "availability", "in_stock", "quantity",
            "min_order_quantity", "warranty", "notes", "images", "deal",
        ]

    def get_deal(self, obj):
        """A live offer: the old price to strike through. Nothing about who funds it."""
        if not obj.deal_active:
            return None
        return {"percent": obj.deal_percent, "title": obj.deal_title, "ends_at": obj.deal_ends_at,
                "was_price": str(obj.regular_price(self.context.get("markup")))}

    def get_price(self, obj):
        price = getattr(obj, "customer_price", None)
        return str(price if price is not None else obj.selling_price())

    def get_in_stock(self, obj):
        return obj.availability == L.Availability.IN_STOCK and obj.quantity > 0


class ListingProductSerializer(serializers.ModelSerializer):
    brand = BrandRefSerializer(read_only=True)
    category = CategoryRefSerializer(read_only=True)
    images = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "part_number", "brand", "category", "description", "specifications",
            "compatibility", "status", "images",
        ]

    def get_images(self, obj):
        return ImageSerializer([i for i in obj.images.all() if i.listing_id is None], many=True).data


class ListingEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = ListingEvent
        fields = ["id", "action", "actor_name", "note", "changes", "created_at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return "Marketplace admin" if obj.actor.is_marketplace_admin and not self.context.get("admin") else obj.actor.full_name


class SupplierListingSerializer(serializers.ModelSerializer):
    """The supplier's own listing, including their supplier price."""

    product = ListingProductSerializer(read_only=True)
    images = ImageSerializer(many=True, read_only=True)
    customer_price = serializers.SerializerMethodField()
    is_low_stock = serializers.SerializerMethodField()
    can_edit_product = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    deal = serializers.SerializerMethodField()
    markup_share = serializers.SerializerMethodField()
    you_receive = serializers.SerializerMethodField()

    class Meta:
        model = SupplierListing
        fields = [
            "id", "product", "sku", "condition", "notes", "supplier_price", "markup_share", "you_receive",
            "customer_price", "quantity",
            "min_order_quantity", "low_stock_threshold", "is_low_stock", "warranty", "availability", "status",
            "status_display", "rejection_reason", "submitted_at", "approved_at", "view_count", "images",
            "can_edit_product", "created_at", "updated_at", "deal",
        ]

    def get_customer_price(self, obj):
        """The regular customer price; any offer is shown separately in `deal`."""
        return str(obj.regular_price(self.context.get("markup")))

    def get_markup_share(self, obj):
        """Per unit, today: the supplier's part of the marketplace markup, paid on top of their price."""
        return str(obj.supplier_share(self.context.get("markup")))

    def get_you_receive(self, obj):
        """Per unit, today: what the supplier is paid for each one sold (their price + markup share)."""
        return str(obj.supplier_payout(self.context.get("markup")))

    def get_deal(self, obj):
        if not obj.deal_status:
            return None
        markup = self.context.get("markup")
        regular = obj.regular_price(markup)
        off = lambda amount, places: (amount * (Decimal("100") - obj.deal_percent) / Decimal("100")).quantize(Decimal(places))  # noqa: E731
        expired = obj.deal_ends_at is not None and obj.deal_ends_at <= timezone.now()
        return {
            "percent": obj.deal_percent, "title": obj.deal_title, "ends_at": obj.deal_ends_at,
            "status": "ended" if expired else obj.deal_status,
            "status_display": "Ended" if expired else obj.get_deal_status_display(),
            "note": obj.deal_note, "active": obj.deal_active,
            "customer_price": str(off(regular, "1")), "supplier_price": str(off(obj.supplier_price, "0.01")),
        }

    def get_is_low_stock(self, obj):
        threshold = obj.low_stock_threshold
        if threshold is None:
            threshold = self.context.get("low_stock_default", 5)
        return obj.availability != L.Availability.ON_REQUEST and obj.quantity <= threshold

    def get_can_edit_product(self, obj):
        from .services import can_edit_product

        return can_edit_product(obj.product, obj.supplier)


class ListingWriteSerializer(serializers.ModelSerializer):
    product_id = serializers.PrimaryKeyRelatedField(
        source="product", queryset=Product.objects.exclude(status=Product.Status.INACTIVE), required=False
    )
    product_details = ProductWriteSerializer(required=False, write_only=True)
    quantity = serializers.IntegerField(min_value=0, required=False)

    class Meta:
        model = SupplierListing
        fields = [
            "product_id", "product_details", "sku", "condition", "notes", "supplier_price", "quantity",
            "min_order_quantity", "low_stock_threshold", "warranty", "availability",
        ]

    def validate(self, attrs):
        if not self.partial and "product" not in attrs and "product_details" not in attrs:
            raise serializers.ValidationError({"product_id": "Pick a catalogue product or describe a new part."})
        if "product" in attrs and "product_details" in attrs:
            raise serializers.ValidationError("Send either product_id or product_details, not both.")
        return attrs


class StockMovementSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True, default=None)
    product_name = serializers.CharField(source="listing.product.name", read_only=True)
    sku = serializers.CharField(source="listing.sku", read_only=True)

    class Meta:
        model = StockMovement
        fields = ["id", "listing", "product_name", "sku", "change", "quantity_after", "reason", "note",
                  "user_name", "created_at"]


class BulkStockItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=0, required=False)
    supplier_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), required=False)
    availability = serializers.ChoiceField(choices=L.Availability.choices, required=False)


class BulkStockSerializer(serializers.Serializer):
    items = BulkStockItemSerializer(many=True, allow_empty=False, max_length=1000)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class StockAdjustSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=0)
    reason = serializers.ChoiceField(
        choices=[StockMovement.Reason.MANUAL, StockMovement.Reason.CORRECTION, StockMovement.Reason.RETURN],
        default=StockMovement.Reason.MANUAL,
    )
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class CatalogueMatchSerializer(serializers.ModelSerializer):
    brand = BrandRefSerializer(read_only=True)
    category = CategoryRefSerializer(read_only=True)
    specifications = SpecificationSerializer(many=True, read_only=True)

    class Meta:
        model = Product
        fields = ["id", "name", "part_number", "brand", "category", "description", "specifications", "compatibility"]


# --- Administrator ------------------------------------------------------------


class AdminListingSerializer(SupplierListingSerializer):
    supplier = SupplierBadgeSerializer(read_only=True)
    supplier_status = serializers.CharField(source="supplier.status", read_only=True)
    events = serializers.SerializerMethodField()
    other_offers = serializers.SerializerMethodField()

    class Meta(SupplierListingSerializer.Meta):
        fields = SupplierListingSerializer.Meta.fields + ["supplier", "supplier_status", "price_override",
                                                          "events", "other_offers"]

    def get_events(self, obj):
        if not self.context.get("detail"):
            return None
        return ListingEventSerializer(obj.events.select_related("actor")[:50], many=True, context={"admin": True}).data

    def get_other_offers(self, obj):
        """Other suppliers' offers on the same part, to sanity-check price at approval time."""
        if not self.context.get("detail"):
            return None
        others = obj.product.listings.exclude(pk=obj.pk).exclude(status=L.Status.ARCHIVED).select_related("supplier")
        return [
            {"id": o.id, "supplier": o.supplier.name, "condition": o.condition, "status": o.status,
             "supplier_price": str(o.supplier_price), "customer_price": str(o.selling_price(self.context.get("markup")))}
            for o in others
        ]


class ApproveSerializer(serializers.Serializer):
    price_override = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), required=False,
                                              allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class RejectSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class PriceSerializer(serializers.Serializer):
    price_override = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), allow_null=True)


class DealSerializer(serializers.Serializer):
    percent = serializers.IntegerField(min_value=1, max_value=90)
    title = serializers.CharField(required=False, allow_blank=True, max_length=80)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
