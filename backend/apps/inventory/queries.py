from decimal import Decimal

from django.db.models import Case, DecimalField, ExpressionWrapper, F, Q, Value, When
from django.db.models.functions import Coalesce, Round
from django.utils import timezone

from apps.core.models import MarketplaceSettings

from .models import SupplierListing


def deal_active_q(prefix: str = "") -> Q:
    """A live offer. Mirrors SupplierListing.deal_active."""
    return Q(**{f"{prefix}deal_status": SupplierListing.DealStatus.APPROVED, f"{prefix}deal_percent__isnull": False}) & (
        Q(**{f"{prefix}deal_ends_at__isnull": True}) | Q(**{f"{prefix}deal_ends_at__gt": timezone.now()})
    )


def selling_price_expr(markup: Decimal | None = None, prefix: str = ""):
    """SQL for what the customer pays today. Mirrors SupplierListing.selling_price()."""
    base = regular_price_expr(markup, prefix)
    money = DecimalField(max_digits=12, decimal_places=0)
    discounted = Round(ExpressionWrapper(
        base * (Value(100) - F(f"{prefix}deal_percent")) / Value(100), output_field=DecimalField(max_digits=14, decimal_places=4)))
    return Case(When(deal_active_q(prefix), then=discounted), default=base, output_field=money)


def regular_price_expr(markup: Decimal | None = None, prefix: str = ""):
    """SQL for the customer price without offers. Mirrors SupplierListing.regular_price()."""
    if markup is None:
        markup = MarketplaceSettings.load().default_markup_percent
    factor = Value(Decimal("1") + markup / Decimal("100"), output_field=DecimalField(max_digits=8, decimal_places=4))
    computed = Round(
        ExpressionWrapper(F(f"{prefix}supplier_price") * factor, output_field=DecimalField(max_digits=14, decimal_places=4))
    )
    return Coalesce(F(f"{prefix}price_override"), computed, output_field=DecimalField(max_digits=12, decimal_places=0))


def published_q(prefix: str = "") -> Q:
    """A listing customers may see: approved, on an active product, from an approved supplier."""
    return Q(
        **{
            f"{prefix}status": SupplierListing.Status.APPROVED,
            f"{prefix}product__status": "active",
            f"{prefix}supplier__status": "approved",
        }
    )


def published_listings():
    return SupplierListing.objects.filter(published_q()).select_related("supplier", "product")
