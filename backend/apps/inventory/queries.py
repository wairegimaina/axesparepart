from decimal import Decimal

from django.db.models import Case, DecimalField, ExpressionWrapper, F, Q, Value, When
from django.db.models.functions import Coalesce, Round
from django.utils import timezone

from .models import SupplierListing
from .pricing import as_markups


def deal_active_q(prefix: str = "") -> Q:
    """A live offer. Mirrors SupplierListing.deal_active."""
    return Q(**{f"{prefix}deal_status": SupplierListing.DealStatus.APPROVED, f"{prefix}deal_percent__isnull": False}) & (
        Q(**{f"{prefix}deal_ends_at__isnull": True}) | Q(**{f"{prefix}deal_ends_at__gt": timezone.now()})
    )


def selling_price_expr(markups=None, prefix: str = "", category_field: str | None = None):
    """SQL for what the customer pays today. Mirrors SupplierListing.selling_price()."""
    base = regular_price_expr(markups, prefix, category_field)
    money = DecimalField(max_digits=12, decimal_places=0)
    discounted = Round(ExpressionWrapper(
        base * (Value(100) - F(f"{prefix}deal_percent")) / Value(100), output_field=DecimalField(max_digits=14, decimal_places=4)))
    return Case(When(deal_active_q(prefix), then=discounted), default=base, output_field=money)


def regular_price_expr(markups=None, prefix: str = "", category_field: str | None = None):
    """SQL for the customer price without offers. Mirrors SupplierListing.regular_price().

    `category_field` is the path to the part's category id; defaults to the listing's product.
    """
    markups = as_markups(markups)
    category_field = category_field or f"{prefix}product__category_id"
    factor_field = DecimalField(max_digits=8, decimal_places=4)

    def factor_of(pct: Decimal):
        return Value(Decimal("1") + pct / Decimal("100"), output_field=factor_field)

    factor = factor_of(markups.default)
    if markups.by_category:
        groups: dict[Decimal, list[int]] = {}
        for cid, pct in markups.by_category.items():
            groups.setdefault(pct, []).append(cid)
        factor = Case(*[When(**{f"{category_field}__in": ids}, then=factor_of(pct)) for pct, ids in groups.items()],
                      default=factor, output_field=factor_field)
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
