from rest_framework import serializers

from .models import Brand, Category, Product, ProductImage


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "parent", "description", "is_active", "position"]
        read_only_fields = ["slug"]


class CategoryTreeSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "children"]

    def get_children(self, obj):
        kids = [c for c in self.context["by_parent"].get(obj.id, [])]
        return CategoryTreeSerializer(kids, many=True, context=self.context).data


class BrandSerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Brand
        fields = ["id", "name", "slug", "logo_url", "is_active", "product_count"]
        read_only_fields = ["slug"]


class CategoryRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug"]


class BrandRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = ["id", "name", "slug"]


class ImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "url", "alt_text", "position"]


class SpecificationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80)
    value = serializers.CharField(max_length=200)


class ProductCardSerializer(serializers.ModelSerializer):
    """Marketplace grid item. Prices are customer prices aggregated over published offers."""

    brand = BrandRefSerializer(read_only=True)
    category = CategoryRefSerializer(read_only=True)
    image = serializers.SerializerMethodField()
    min_price = serializers.DecimalField(max_digits=12, decimal_places=0, read_only=True)
    offer_count = serializers.IntegerField(read_only=True)
    in_stock = serializers.BooleanField(read_only=True)
    conditions = serializers.SerializerMethodField()
    fits = serializers.SerializerMethodField()
    quick_add = serializers.SerializerMethodField()
    deal_percent = serializers.IntegerField(read_only=True, allow_null=True)
    was_price = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "part_number", "brand", "category", "image",
            "min_price", "offer_count", "in_stock", "conditions", "fits", "quick_add", "deal_percent", "was_price",
        ]

    def get_was_price(self, obj):
        """The lowest regular price, when an offer brings the price below it."""
        regular, now = getattr(obj, "regular_min_price", None), getattr(obj, "min_price", None)
        return str(regular) if regular is not None and now is not None and regular > now else None

    def get_fits(self, obj):
        """First few bike models, for the card."""
        return [line.strip() for line in obj.compatibility.splitlines() if line.strip()][:3]

    def get_quick_add(self, obj):
        """The cheapest in-stock offer, so the grid can add to cart without opening the product."""
        offers = getattr(obj, "published_offers", None)
        if not offers:
            return None
        if "markup" not in self.context:
            from apps.core.models import MarketplaceSettings

            self.context["markup"] = MarketplaceSettings.load().default_markup_percent
        markup = self.context["markup"]
        stocked = [o for o in offers if o.availability == "in_stock" and o.quantity >= o.min_order_quantity]
        if not stocked:
            return None
        best = min(stocked, key=lambda o: o.selling_price(markup))
        return {"listing_id": best.id, "quantity": best.min_order_quantity}

    def get_image(self, obj):
        imgs = getattr(obj, "catalogue_images", None)
        if imgs is None:
            imgs = [i for i in obj.images.all() if i.listing_id is None]
        if imgs:
            return imgs[0].url
        listing_imgs = getattr(obj, "offer_images", None) or []
        return listing_imgs[0].url if listing_imgs else None

    def get_conditions(self, obj):
        return sorted({lst.condition for lst in getattr(obj, "published_offers", [])})


class ProductDetailSerializer(serializers.ModelSerializer):
    brand = BrandRefSerializer(read_only=True)
    category = CategoryRefSerializer(read_only=True)
    breadcrumbs = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    offers = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "part_number", "brand", "category", "breadcrumbs", "description",
            "specifications", "compatibility", "images", "offers",
        ]

    def get_breadcrumbs(self, obj):
        trail, node = [], obj.category
        while node is not None:
            trail.insert(0, {"name": node.name, "slug": node.slug})
            node = node.parent
        return trail

    def get_images(self, obj):
        return ImageSerializer([i for i in obj.images.all() if i.listing_id is None], many=True).data

    def get_offers(self, obj):
        from apps.inventory.serializers import PublicOfferSerializer

        return PublicOfferSerializer(self.context["offers"], many=True, context=self.context).data


class ProductWriteSerializer(serializers.ModelSerializer):
    """Canonical product fields, used by suppliers (when allowed) and admins."""

    category_id = serializers.PrimaryKeyRelatedField(source="category", queryset=Category.objects.filter(is_active=True))
    brand_id = serializers.PrimaryKeyRelatedField(
        source="brand", queryset=Brand.objects.filter(is_active=True), required=False
    )
    brand_name = serializers.CharField(max_length=100, required=False, write_only=True)
    specifications = SpecificationSerializer(many=True, required=False)

    class Meta:
        model = Product
        fields = [
            "name", "category_id", "brand_id", "brand_name", "part_number", "description",
            "specifications", "compatibility",
        ]

    def validate(self, attrs):
        name = attrs.pop("brand_name", "").strip()
        if "brand" not in attrs and name:
            attrs["brand"] = Brand.objects.filter(name__iexact=name).first() or Brand.objects.create(name=name)
        if not self.root.partial and "brand" not in attrs:
            raise serializers.ValidationError({"brand_id": "Choose a brand or type a new brand name."})
        return attrs


class AdminProductSerializer(serializers.ModelSerializer):
    brand = BrandRefSerializer(read_only=True)
    category = CategoryRefSerializer(read_only=True)
    images = serializers.SerializerMethodField()
    listing_count = serializers.IntegerField(read_only=True, default=0)
    created_by_supplier_name = serializers.CharField(source="created_by_supplier.name", read_only=True, default=None)

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "part_number", "brand", "category", "description", "specifications",
            "compatibility", "status", "images", "listing_count", "created_by_supplier_name", "view_count",
            "created_at", "updated_at",
        ]

    def get_images(self, obj):
        return ImageSerializer([i for i in obj.images.all() if i.listing_id is None], many=True).data
