import re
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel
from apps.suppliers.models import unique_slug


def normalize_part_number(value: str) -> str:
    """'AB-12 34/x' -> 'AB1234X'. Used to spot the same part listed by different suppliers."""
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


class Category(models.Model):
    """Product classification, two or more levels deep (e.g. Engine > Filters)."""

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=110, unique=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    position = models.PositiveIntegerField(default=0)
    markup_percent = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("500"))],
        help_text="Marketplace markup for parts in this category. Empty: use the parent's, else the default.",
    )

    class Meta:
        ordering = ["position", "name"]
        verbose_name_plural = "categories"
        constraints = [models.UniqueConstraint(fields=["parent", "name"], name="unique_category_name_per_parent")]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Category, self.name, self.pk)
        super().save(*args, **kwargs)

    def descendant_ids(self) -> list[int]:
        ids, frontier = [self.pk], [self.pk]
        while frontier:
            frontier = list(Category.objects.filter(parent_id__in=frontier).values_list("pk", flat=True))
            ids.extend(frontier)
        return ids

    def __str__(self):
        return f"{self.parent} > {self.name}" if self.parent_id else self.name


class Brand(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=110, unique=True)
    logo_url = models.URLField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Brand, self.name, self.pk)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Product(TimeStampedModel):
    """
    The canonical spare part, shared by every supplier who sells it.

    What a particular supplier offers (price, stock, condition, warranty) lives in
    inventory.SupplierListing, so two suppliers selling the same part number
    produce one Product with two listings rather than two duplicate products.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting first approval"
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=90, unique=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    brand = models.ForeignKey(Brand, on_delete=models.PROTECT, related_name="products")
    part_number = models.CharField("manufacturer part number", max_length=80, blank=True)
    part_number_normalized = models.CharField(max_length=80, blank=True, db_index=True, editable=False)
    description = models.TextField(blank=True)
    specifications = models.JSONField(default=list, blank=True, help_text='[{"name": "Voltage", "value": "24V"}]')
    compatibility = models.TextField(blank=True, help_text="Motorbike models it fits, one per line.")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    created_by_supplier = models.ForeignKey(
        "suppliers.Supplier", null=True, blank=True, on_delete=models.SET_NULL, related_name="created_products"
    )
    view_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["brand", "part_number_normalized"],
                condition=~Q(part_number_normalized=""),
                name="unique_part_number_per_brand",
            )
        ]

    def save(self, *args, **kwargs):
        self.part_number_normalized = normalize_part_number(self.part_number)
        if not self.slug:
            label = f"{self.brand.name} {self.name} {self.part_number}" if self.brand_id else self.name
            self.slug = unique_slug(Product, label, self.pk)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.part_number})" if self.part_number else self.name


class ProductImage(models.Model):
    """Catalogue photo (listing is null) or a supplier's own photo of what they're selling."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    listing = models.ForeignKey(
        "inventory.SupplierListing", null=True, blank=True, on_delete=models.CASCADE, related_name="images"
    )
    url = models.URLField(max_length=500)
    public_id = models.CharField(max_length=255)
    alt_text = models.CharField(max_length=200, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]
