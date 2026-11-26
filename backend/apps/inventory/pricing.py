"""
Marketplace markups: the default from Admin → Settings, overridden per category.

A category without its own markup uses its parent's, then its grandparent's, and so on;
a tree with none set anywhere uses the default. Load once per request with Markups.load()
and pass the result to the price helpers, so pricing a page doesn't query per item.
"""

from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True)
class Markups:
    default: Decimal
    # Effective markup for every category whose markup differs from the default.
    by_category: dict[int, Decimal] = field(default_factory=dict)

    @classmethod
    def load(cls) -> "Markups":
        from apps.catalogue.models import Category
        from apps.core.models import MarketplaceSettings

        default = MarketplaceSettings.load().default_markup_percent
        rows = {c["id"]: (c["parent_id"], c["markup_percent"])
                for c in Category.objects.values("id", "parent_id", "markup_percent")}
        effective: dict[int, Decimal] = {}

        def resolve(cid: int, seen: frozenset = frozenset()) -> Decimal:
            if cid not in effective:
                parent, own = rows[cid]
                if own is not None:
                    effective[cid] = own
                elif parent in rows and parent not in seen:
                    effective[cid] = resolve(parent, seen | {cid})
                else:
                    effective[cid] = default
            return effective[cid]

        for cid in rows:
            resolve(cid)
        return cls(default, {cid: pct for cid, pct in effective.items() if pct != default})

    def for_category(self, category_id: int | None) -> Decimal:
        return self.by_category.get(category_id, self.default)


def as_markups(value) -> Markups:
    """Accept loaded Markups, a flat percentage (Decimal), or None (load from the database)."""
    if isinstance(value, Markups):
        return value
    if value is None:
        return Markups.load()
    return Markups(Decimal(value))
