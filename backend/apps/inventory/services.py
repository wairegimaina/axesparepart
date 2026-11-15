"""
Listing workflow:

    Draft ──submit──▶ Pending ──approve──▶ Published
      ▲                  │                    │
      └──── Rejected ◀──reject                │ significant change
                 │                            ▼  (condition / product details)
                 └──────resubmit───────▶ Pending again

Stock, price, MOQ, warranty, availability and notes can change at any time without
re-approval. Changes to what the item *is* (the catalogue product or its condition)
send a published listing back for review.
"""

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.catalogue.models import Brand, Product, normalize_part_number
from apps.notifications.service import notify_admins, notify_supplier
from apps.suppliers.models import SupplierMember

from .models import ListingEvent, StockMovement, SupplierListing

L = SupplierListing
PRODUCT_FIELDS = ("name", "category", "brand", "part_number", "description", "specifications", "compatibility")
LISTING_FIELDS = (
    "sku", "condition", "notes", "supplier_price", "min_order_quantity", "low_stock_threshold",
    "warranty", "availability",
)


def _jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "pk"):
        return value.pk
    return value


def log_event(listing, action, actor=None, note="", **changes):
    return ListingEvent.objects.create(
        listing=listing, action=action, actor=actor, note=note,
        changes={k: [_jsonable(a), _jsonable(b)] for k, (a, b) in changes.items()},
    )


def find_existing_product(brand: Brand | None, part_number: str) -> Product | None:
    normalized = normalize_part_number(part_number)
    if not brand or not normalized:
        return None
    return Product.objects.filter(brand=brand, part_number_normalized=normalized).first()


def can_edit_product(product: Product, supplier) -> bool:
    """A supplier may edit catalogue details only for a product they created that nobody else sells."""
    if product.created_by_supplier_id != supplier.id:
        return False
    others = product.listings.exclude(supplier=supplier).exclude(status=L.Status.ARCHIVED)
    return not others.exists()


def _apply_auto_availability(listing):
    if listing.availability == L.Availability.ON_REQUEST:
        return
    if listing.quantity == 0:
        listing.availability = L.Availability.OUT_OF_STOCK
    elif listing.availability == L.Availability.OUT_OF_STOCK:
        listing.availability = L.Availability.IN_STOCK


def set_quantity(listing, quantity: int, reason: str, user=None, note: str = "") -> StockMovement | None:
    if quantity < 0:
        raise ValidationError({"quantity": "Stock can't be negative."})
    change = quantity - listing.quantity
    if change == 0:
        return None
    listing.quantity = quantity
    _apply_auto_availability(listing)
    listing.save(update_fields=["quantity", "availability", "updated_at"])
    return StockMovement.objects.create(
        listing=listing, change=change, quantity_after=quantity, reason=reason, user=user, note=note[:255]
    )


def _save_listing(listing):
    try:
        with transaction.atomic():
            listing.save()
    except IntegrityError as exc:
        msg = str(exc)
        if "unique_sku_per_supplier" in msg:
            raise ValidationError({"sku": "You already use this SKU on another product."})
        if "one_live_listing" in msg:
            raise ValidationError(
                {"product": "You already list this part in this condition. Update that listing instead."}
            )
        raise


@transaction.atomic
def create_listing(supplier, user, data: dict, product_data: dict | None, stock_reason=StockMovement.Reason.INITIAL):
    """
    `data` holds listing fields (+ optional product). `product_data` holds canonical fields
    when the supplier describes a new part. If that brand + part number already exists in the
    catalogue, the listing attaches to the existing product instead of creating a duplicate.
    Returns (listing, matched_existing_product: bool).
    """
    product = data.pop("product", None)
    matched = False
    if product is None:
        if not product_data:
            raise ValidationError({"product": "Pick a catalogue product or describe a new one."})
        product = find_existing_product(product_data.get("brand"), product_data.get("part_number", ""))
        if product:
            matched = True
        else:
            product = Product.objects.create(created_by_supplier=supplier, status=Product.Status.PENDING, **product_data)
    elif product.status == Product.Status.INACTIVE:
        raise ValidationError({"product_id": "This catalogue product is no longer available."})

    quantity = data.pop("quantity", 0) or 0
    listing = L(supplier=supplier, product=product, status=L.Status.DRAFT, quantity=0, **data)
    _save_listing(listing)
    log_event(listing, ListingEvent.Action.CREATED, user, "Matched an existing catalogue product" if matched else "")
    if quantity:
        set_quantity(listing, quantity, stock_reason, user)
    else:
        _apply_auto_availability(listing)
        listing.save(update_fields=["availability"])
    return listing, matched


@transaction.atomic
def update_listing(listing, user, data: dict, product_data: dict | None):
    if listing.status == L.Status.ARCHIVED:
        raise ValidationError("Archived listings can't be edited.")
    changes = {}
    significant = False

    if product_data:
        product = listing.product
        if not can_edit_product(product, listing.supplier):
            raise PermissionDenied(
                "This part is in the shared catalogue. Contact the marketplace admin to change its details."
            )
        for field, value in product_data.items():
            old = getattr(product, field)
            if old != value:
                changes[f"product.{field}"] = (old, value)
                setattr(product, field, value)
        if changes:
            existing = find_existing_product(product.brand, product.part_number)
            if existing and existing.pk != product.pk:
                raise ValidationError({"part_number": "Another catalogue product already has this brand and part number."})
            if product.status == Product.Status.ACTIVE:
                product.status = Product.Status.PENDING
            product.save()
            significant = True

    new_product = data.pop("product", None)
    if new_product is not None and new_product.pk != listing.product_id:
        changes["product"] = (listing.product_id, new_product.pk)
        listing.product = new_product
        significant = True

    quantity = data.pop("quantity", None)
    for field, value in data.items():
        old = getattr(listing, field)
        if old != value:
            changes[field] = (old, value)
            setattr(listing, field, value)
            if field == "condition":
                significant = True

    if significant and listing.status == L.Status.APPROVED:
        listing.status = L.Status.PENDING
        listing.submitted_at = timezone.now()
        _save_listing(listing)
        log_event(listing, ListingEvent.Action.REAPPROVAL, user, **changes)
        notify_admins("listing_reapproval", f"Re-approval needed: {listing.product.name}",
                      f"{listing.supplier.name} changed a published listing.", f"/admin/listings/{listing.id}",
                      email=False)
    elif changes:
        _save_listing(listing)
        log_event(listing, ListingEvent.Action.UPDATED, user, **changes)

    if quantity is not None:
        set_quantity(listing, quantity, StockMovement.Reason.MANUAL, user)
    return listing


def submit_listing(listing, user):
    if not listing.supplier.is_approved:
        raise ValidationError("Your company must be approved before you can publish products.")
    if listing.status not in (L.Status.DRAFT, L.Status.REJECTED):
        raise ValidationError(f"A {listing.get_status_display().lower()} listing can't be submitted.")
    was_rejected = listing.status == L.Status.REJECTED
    listing.status, listing.submitted_at, listing.rejection_reason = L.Status.PENDING, timezone.now(), ""
    listing.save(update_fields=["status", "submitted_at", "rejection_reason", "updated_at"])
    log_event(listing, ListingEvent.Action.SUBMITTED, user, "Resubmitted after rejection" if was_rejected else "")
    notify_admins("listing_submitted", f"Product awaiting approval: {listing.product.name}",
                  f"Submitted by {listing.supplier.name}", f"/admin/listings/{listing.id}", email=False)
    return listing


@transaction.atomic
def approve_listing(listing, admin, price_override=None, note=""):
    if listing.status != L.Status.PENDING:
        raise ValidationError("Only pending listings can be approved.")
    if not listing.supplier.is_approved:
        raise ValidationError("The supplier isn't approved yet.")
    product = listing.product
    if product.status == Product.Status.INACTIVE:
        raise ValidationError("The catalogue product is inactive. Reactivate it first.")
    if product.status == Product.Status.PENDING:
        product.status = Product.Status.ACTIVE
        product.save(update_fields=["status", "updated_at"])
    changes = {}
    if price_override is not None and price_override != listing.price_override:
        changes["price_override"] = (listing.price_override, price_override)
        listing.price_override = price_override
    listing.status, listing.approved_at, listing.approved_by = L.Status.APPROVED, timezone.now(), admin
    listing.rejection_reason = ""
    listing.save()
    log_event(listing, ListingEvent.Action.APPROVED, admin, note, **changes)
    notify_supplier(listing.supplier, "listing_approved", f"Published: {product.name}",
                    note, f"/supplier/products/{listing.id}",
                    roles=[SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER, SupplierMember.Role.INVENTORY])
    return listing


def reject_listing(listing, admin, reason):
    if listing.status != L.Status.PENDING:
        raise ValidationError("Only pending listings can be rejected.")
    if not reason.strip():
        raise ValidationError({"reason": "Tell the supplier what to fix."})
    listing.status, listing.rejection_reason = L.Status.REJECTED, reason
    listing.save(update_fields=["status", "rejection_reason", "updated_at"])
    log_event(listing, ListingEvent.Action.REJECTED, admin, reason)
    notify_supplier(listing.supplier, "listing_rejected", f"Changes needed: {listing.product.name}",
                    reason, f"/supplier/products/{listing.id}",
                    roles=[SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER, SupplierMember.Role.INVENTORY])
    return listing


def set_price_override(listing, admin, price):
    old = listing.price_override
    listing.price_override = price
    listing.save(update_fields=["price_override", "updated_at"])
    log_event(listing, ListingEvent.Action.PRICE_SET, admin, price_override=(old, price))
    return listing


def archive_listing(listing, user):
    listing.status = L.Status.ARCHIVED
    listing.save(update_fields=["status", "updated_at"])
    log_event(listing, ListingEvent.Action.ARCHIVED, user)
    return listing


# --- Offers -----------------------------------------------------------------------------------

OFFER_ROLES = [SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER, SupplierMember.Role.INVENTORY]


def start_deal(listing, user, percent: int, title: str = "", ends_at=None):
    """Supplier proposes an offer. It goes live once an admin approves it."""
    if listing.status != L.Status.APPROVED:
        raise ValidationError("Offers can only run on published products.")
    if ends_at is not None and ends_at <= timezone.now():
        raise ValidationError({"ends_at": "Choose a date in the future."})
    listing.deal_percent, listing.deal_title, listing.deal_ends_at = percent, title.strip(), ends_at
    listing.deal_status, listing.deal_note = L.DealStatus.PENDING, ""
    listing.save(update_fields=["deal_percent", "deal_title", "deal_ends_at", "deal_status", "deal_note", "updated_at"])
    log_event(listing, ListingEvent.Action.OFFER, user, f"{percent}% off submitted for approval")
    notify_admins("deal_submitted", f"Offer to approve: {percent}% off {listing.product.name}",
                  f"From {listing.supplier.name}", f"/admin/listings/{listing.id}", email=False)
    return listing


def end_deal(listing, user):
    if not listing.deal_status:
        raise ValidationError("There's no offer on this product.")
    listing.deal_percent, listing.deal_title, listing.deal_ends_at = None, "", None
    listing.deal_status, listing.deal_note = L.DealStatus.NONE, ""
    listing.save(update_fields=["deal_percent", "deal_title", "deal_ends_at", "deal_status", "deal_note", "updated_at"])
    log_event(listing, ListingEvent.Action.OFFER, user, "Offer ended")
    return listing


def approve_deal(listing, admin):
    if listing.deal_status != L.DealStatus.PENDING:
        raise ValidationError("There's no offer waiting for approval.")
    listing.deal_status, listing.deal_note = L.DealStatus.APPROVED, ""
    listing.save(update_fields=["deal_status", "deal_note", "updated_at"])
    log_event(listing, ListingEvent.Action.OFFER, admin, f"{listing.deal_percent}% off approved")
    notify_supplier(listing.supplier, "deal_approved", f"Offer live: {listing.deal_percent}% off {listing.product.name}",
                    "Customers can see it now.", f"/supplier/products/{listing.id}", roles=OFFER_ROLES)
    return listing


def reject_deal(listing, admin, reason):
    if listing.deal_status != L.DealStatus.PENDING:
        raise ValidationError("There's no offer waiting for approval.")
    if not reason.strip():
        raise ValidationError({"reason": "Tell the supplier why."})
    listing.deal_status, listing.deal_note = L.DealStatus.REJECTED, reason.strip()[:255]
    listing.save(update_fields=["deal_status", "deal_note", "updated_at"])
    log_event(listing, ListingEvent.Action.OFFER, admin, f"Offer not approved: {reason}")
    notify_supplier(listing.supplier, "deal_rejected", f"Offer not approved: {listing.product.name}",
                    reason, f"/supplier/products/{listing.id}", roles=OFFER_ROLES)
    return listing
