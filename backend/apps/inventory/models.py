from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import MarketplaceSettings, TimeStampedModel

from .pricing import as_markups


class SupplierListing(TimeStampedModel):
    """One supplier's offer of one product: their SKU, condition, price, stock and terms."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PENDING = "pending", "Pending approval"
        APPROVED = "approved", "Published"
        REJECTED = "rejected", "Rejected"
        ARCHIVED = "archived", "Archived"

    class Condition(models.TextChoices):
        NEW = "new", "New"
        REFURBISHED = "refurbished", "Refurbished"
        USED = "used", "Used"

    class Availability(models.TextChoices):
        IN_STOCK = "in_stock", "In stock"
        OUT_OF_STOCK = "out_of_stock", "Out of stock"
        ON_REQUEST = "on_request", "On request"

    class DealStatus(models.TextChoices):
        NONE = "", "No offer"
        PENDING = "pending", "Waiting for approval"
        APPROVED = "approved", "Live"
        REJECTED = "rejected", "Not approved"

    # Fields whose change on a published listing sends it back for approval.
    SIGNIFICANT_FIELDS = ("product_id", "condition")

    supplier = models.ForeignKey("suppliers.Supplier", on_delete=models.CASCADE, related_name="listings")
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT, related_name="listings")
    sku = models.CharField("supplier SKU", max_length=60, blank=True)
    condition = models.CharField(max_length=12, choices=Condition.choices, default=Condition.NEW)
    notes = models.TextField(blank=True, help_text="Anything specific to this supplier's offer.")

    supplier_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    price_override = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="Admin-set customer price. Empty means supplier price + marketplace markup.",
    )
    quantity = models.PositiveIntegerField(default=0)
    min_order_quantity = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    low_stock_threshold = models.PositiveIntegerField(null=True, blank=True)
    warranty = models.CharField(max_length=120, blank=True, help_text="e.g. 6 months")
    availability = models.CharField(max_length=14, choices=Availability.choices, default=Availability.IN_STOCK)

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    rejection_reason = models.TextField(blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    view_count = models.PositiveIntegerField(default=0)

    # A supplier's offer: a percentage off this part, shown to customers once an admin approves it.
    # The supplier funds it (their price drops by the same percentage), so the marketplace margin is unchanged.
    deal_percent = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(90)])
    deal_title = models.CharField(max_length=80, blank=True, help_text="e.g. Rainy season brake sale")
    deal_ends_at = models.DateTimeField(null=True, blank=True)
    deal_status = models.CharField(max_length=10, choices=DealStatus.choices, blank=True, default="", db_index=True)
    deal_note = models.CharField(max_length=255, blank=True, help_text="Why the offer wasn't approved.")

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["supplier", "product", "condition"],
                condition=~Q(status="archived"),
                name="one_live_listing_per_supplier_product_condition",
            ),
            models.UniqueConstraint(
                fields=["supplier", "sku"], condition=~Q(sku=""), name="unique_sku_per_supplier"
            ),
        ]

    def markup_percent(self, markups=None) -> Decimal:
        """The markup for this part's category. `markups`: Markups, a flat Decimal, or None to load."""
        return as_markups(markups).for_category(self.product.category_id)

    def regular_price(self, markups=None) -> Decimal:
        """Customer price without any offer. Never expose supplier_price outside the admin and the owning supplier."""
        if self.price_override is not None:
            return self.price_override
        price = self.supplier_price * (Decimal("1") + self.markup_percent(markups) / Decimal("100"))
        return price.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    @property
    def deal_active(self) -> bool:
        return bool(self.deal_status == self.DealStatus.APPROVED and self.deal_percent
                    and (self.deal_ends_at is None or self.deal_ends_at > timezone.now()))

    def _off(self, amount: Decimal, places: str) -> Decimal:
        return (amount * (Decimal("100") - self.deal_percent) / Decimal("100")).quantize(Decimal(places), rounding=ROUND_HALF_UP)

    def selling_price(self, markups=None) -> Decimal:
        """What the customer pays today: the regular price, less any live offer."""
        price = self.regular_price(markups)
        return self._off(price, "1") if self.deal_active else price

    @property
    def current_supplier_price(self) -> Decimal:
        """The supplier's own price per unit today. A live offer lowers it by the same percentage."""
        return self._off(self.supplier_price, "0.01") if self.deal_active else self.supplier_price

    def supplier_share(self, markups=None) -> Decimal:
        """Per unit: the part of the markup this supplier gets on top of their price.

        The supplier's share % (Admin → Suppliers) is a percentage of their price, capped at the
        category's markup, and never more than the customer actually pays above their price
        (an admin price override or an offer can leave less room). Parts whose markup is below
        the minimum in Settings pay no share at all.
        """
        markups = as_markups(markups)
        markup = self.markup_percent(markups)
        if markup < markups.share_min:
            return Decimal("0.00")
        pct = min(self.supplier.markup_share_percent, markup)
        if pct <= 0:
            return Decimal("0.00")
        base = self.current_supplier_price
        share = (base * pct / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        room = self.selling_price(markups) - base
        return max(Decimal("0.00"), min(share, room)).quantize(Decimal("0.01"))

    def supplier_payout(self, markups=None) -> Decimal:
        """What we owe the supplier per unit today: their price plus their markup share."""
        return self.current_supplier_price + self.supplier_share(markups)

    @property
    def effective_low_stock_threshold(self) -> int:
        if self.low_stock_threshold is not None:
            return self.low_stock_threshold
        return MarketplaceSettings.load().default_low_stock_threshold

    @property
    def is_published(self) -> bool:
        return self.status == self.Status.APPROVED

    def __str__(self):
        return f"{self.supplier} — {self.product} ({self.condition})"


class StockMovement(models.Model):
    class Reason(models.TextChoices):
        INITIAL = "initial", "Initial stock"
        MANUAL = "manual", "Manual update"
        BULK = "bulk", "Bulk update"
        IMPORT = "import", "Bulk import"
        ORDER = "order", "Customer order"
        RELEASE = "release", "Order cancelled, stock released"
        RETURN = "return", "Return"
        CORRECTION = "correction", "Stock count correction"

    listing = models.ForeignKey(SupplierListing, on_delete=models.CASCADE, related_name="stock_movements")
    change = models.IntegerField()
    quantity_after = models.PositiveIntegerField()
    reason = models.CharField(max_length=12, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]


class ListingEvent(models.Model):
    """Approval history: every submission, decision and significant edit of a listing."""

    class Action(models.TextChoices):
        CREATED = "created", "Created"
        SUBMITTED = "submitted", "Submitted for approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REAPPROVAL = "reapproval", "Significant change, sent for re-approval"
        UPDATED = "updated", "Updated"
        ARCHIVED = "archived", "Archived"
        PRICE_SET = "price_set", "Customer price set by admin"
        OFFER = "offer", "Offer"

    listing = models.ForeignKey(SupplierListing, on_delete=models.CASCADE, related_name="events")
    action = models.CharField(max_length=12, choices=Action.choices)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.TextField(blank=True)
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
