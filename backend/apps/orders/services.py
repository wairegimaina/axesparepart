"""
Order lifecycle. Every state change goes through here so stock, timelines and
notifications stay consistent whichever API (customer, supplier, admin) triggered it.
"""

from collections import OrderedDict
from datetime import timedelta
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.core.models import MarketplaceSettings
from apps.inventory.models import StockMovement, SupplierListing
from apps.inventory.queries import published_q
from apps.notifications.service import notify, notify_admins, notify_supplier
from apps.payments.models import Payment, PaymentMethod, Refund
from apps.suppliers.models import SupplierMember

from .models import Order, OrderEvent, OrderItem, SupplierOrder

L = SupplierListing
O = Order.Status
S = SupplierOrder.Status
FULFILMENT_ROLES = [SupplierMember.Role.OWNER, SupplierMember.Role.MANAGER, SupplierMember.Role.SALES]


class PriceChanged(APIException):
    status_code = 409
    default_detail = "Prices or availability changed since you last checked. Review your cart and try again."
    default_code = "price_changed"


# --- Quote (cart validation) ---------------------------------------------------------


@dataclass
class QuoteLine:
    listing: SupplierListing | None
    listing_id: int
    quantity: int
    unit_price: Decimal = Decimal("0")
    error: str = ""

    @property
    def line_total(self):
        return self.unit_price * self.quantity


@dataclass
class Quote:
    lines: list[QuoteLine] = field(default_factory=list)
    subtotal: Decimal = Decimal("0")
    delivery_fee: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    county: str = ""
    delivery_available: bool = True
    delivery_days: tuple[int, int] | None = None

    @property
    def has_errors(self):
        return any(line.error for line in self.lines)


def _merge(items) -> "OrderedDict[int, int]":
    merged: OrderedDict[int, int] = OrderedDict()
    for item in items:
        merged[int(item["listing_id"])] = merged.get(int(item["listing_id"]), 0) + int(item["quantity"])
    return merged


def build_quote(items, lock: bool = False, county: str | None = None) -> Quote:
    """Validate cart lines against live listings and price them. Never trusts client prices."""
    settings = MarketplaceSettings.load()
    merged = _merge(items)
    qs = L.objects.filter(pk__in=merged.keys()).select_related("supplier", "product__brand")
    if lock:
        qs = qs.select_for_update(of=("self",)).order_by("pk")
    listings = {lst.pk: lst for lst in qs}
    published_ids = set(L.objects.filter(published_q(), pk__in=merged.keys()).values_list("pk", flat=True))

    quote = Quote()
    for listing_id, qty in merged.items():
        lst = listings.get(listing_id)
        line = QuoteLine(listing=lst, listing_id=listing_id, quantity=qty)
        if lst is None or listing_id not in published_ids:
            line.error = "This item is no longer available."
        else:
            line.unit_price = lst.selling_price(settings.default_markup_percent)
            if qty < lst.min_order_quantity:
                line.error = f"The minimum order for this item is {lst.min_order_quantity}."
            elif lst.availability == L.Availability.OUT_OF_STOCK:
                line.error = "Out of stock."
            elif lst.availability == L.Availability.IN_STOCK and qty > lst.quantity:
                line.error = f"Only {lst.quantity} available." if lst.quantity else "Out of stock."
        quote.lines.append(line)

    quote.subtotal = sum((ln.line_total for ln in quote.lines if not ln.error), Decimal("0"))
    delivery = settings.delivery_for(quote.subtotal, county)
    quote.county = county or ""
    quote.delivery_available = delivery["available"]
    if delivery["days_min"] is not None:
        quote.delivery_days = (delivery["days_min"], delivery["days_max"])
    # Customers pay for parts at checkout. Delivery is agreed on the confirmation call and added by the admin.
    quote.delivery_fee = Decimal("0.00")
    quote.total = quote.subtotal + quote.delivery_fee
    return quote


# --- Helpers ------------------------------------------------------------------------------


def event(order, kind, message, actor=None, supplier_order=None, customer=False, supplier=False):
    return OrderEvent.objects.create(
        order=order, supplier_order=supplier_order, kind=kind, message=message, actor=actor,
        visible_to_customer=customer, visible_to_supplier=supplier,
    )


def _reserve(item: OrderItem, actor):
    listing = L.objects.select_for_update().get(pk=item.listing_id)
    if item.on_request:
        return
    if listing.quantity < item.quantity:
        raise ValidationError({"items": f"Only {listing.quantity} of {item.product_name} available."})
    listing.quantity -= item.quantity
    if listing.quantity == 0 and listing.availability == L.Availability.IN_STOCK:
        listing.availability = L.Availability.OUT_OF_STOCK
    listing.save(update_fields=["quantity", "availability", "updated_at"])
    StockMovement.objects.create(
        listing=listing, change=-item.quantity, quantity_after=listing.quantity,
        reason=StockMovement.Reason.ORDER, note=f"Order {item.order.number}", user=actor,
    )
    item.stock_reserved = True
    item.save(update_fields=["stock_reserved"])


def _release(item: OrderItem, actor, why: str):
    if not item.stock_reserved:
        return
    listing = L.objects.select_for_update().get(pk=item.listing_id)
    listing.quantity += item.quantity
    if listing.availability == L.Availability.OUT_OF_STOCK and listing.quantity > 0:
        listing.availability = L.Availability.IN_STOCK
    listing.save(update_fields=["quantity", "availability", "updated_at"])
    StockMovement.objects.create(
        listing=listing, change=item.quantity, quantity_after=listing.quantity,
        reason=StockMovement.Reason.RELEASE, note=f"Order {item.order.number}: {why}"[:255], user=actor,
    )
    item.stock_reserved = False
    item.save(update_fields=["stock_reserved"])


def recalculate(order: Order, delivery_fee: Decimal | None = None):
    active = order.items.filter(status=OrderItem.Status.ACTIVE)
    order.subtotal = sum((i.line_total for i in active), Decimal("0"))
    if delivery_fee is not None:
        order.delivery_fee = delivery_fee
    if not order.subtotal:
        order.delivery_fee = Decimal("0")
    order.total = order.subtotal + order.delivery_fee
    _refresh_payment_status(order)
    order.save()


def _refresh_payment_status(order: Order):
    net = order.amount_paid - order.amount_refunded
    if order.amount_refunded > 0 and net <= 0:
        order.payment_status = Order.PaymentStatus.REFUNDED
    elif net <= 0:
        order.payment_status = Order.PaymentStatus.UNPAID
    elif net < order.total:
        order.payment_status = Order.PaymentStatus.PARTIAL
    else:
        order.payment_status = Order.PaymentStatus.PAID


def _lock(order: Order) -> Order:
    return Order.objects.select_for_update().get(pk=order.pk)


def _lock_so(so: SupplierOrder) -> SupplierOrder:
    return SupplierOrder.objects.select_for_update().select_related("order", "supplier").get(pk=so.pk)


def _require(obj, allowed, action):
    if obj.status not in allowed:
        raise ValidationError(f"Can't {action} while the order is {obj.get_status_display().lower()}.")


# --- Checkout -----------------------------------------------------------------------------


@transaction.atomic
def place_order(customer, items, address: dict, notes: str = "", expected_total=None) -> Order:
    # Customers don't choose how to pay at checkout: it's agreed on the confirmation call, and the
    # admin records the actual payment (cash, bank) when the money comes in.
    quote = build_quote(items, lock=True, county=address.get("county"))
    if not quote.delivery_available:
        raise ValidationError({"address": f"Sorry, we don't deliver to {address.get('county')} yet."})
    if not quote.lines:
        raise ValidationError({"items": "Your cart is empty."})
    if quote.has_errors:
        raise ValidationError({
            "detail": "Some items in your cart need attention.",
            "item_errors": {str(ln.listing_id): ln.error for ln in quote.lines if ln.error},
        })
    if expected_total is not None and Decimal(str(expected_total)) != quote.total:
        raise PriceChanged()

    order = Order.objects.create(
        customer=customer, subtotal=quote.subtotal, delivery_fee=quote.delivery_fee, total=quote.total,
        payment_method=PaymentMethod.TO_BE_AGREED, customer_notes=notes,
        **{k: address.get(k, "") for k in ("recipient_name", "phone", "county", "town", "street_address", "delivery_notes")},
    )
    by_supplier: dict[int, SupplierOrder] = {}
    for ln in quote.lines:
        lst = ln.listing
        so = by_supplier.get(lst.supplier_id)
        if so is None:
            so = by_supplier[lst.supplier_id] = SupplierOrder.objects.create(order=order, supplier=lst.supplier)
        item = OrderItem.objects.create(
            order=order, supplier_order=so, listing=lst, product_name=lst.product.name, product_slug=lst.product.slug,
            part_number=lst.product.part_number, brand_name=lst.product.brand.name, condition=lst.condition,
            sku=lst.sku, warranty=lst.warranty, on_request=lst.availability == L.Availability.ON_REQUEST,
            quantity=ln.quantity, unit_price=ln.unit_price, supplier_unit_price=lst.current_supplier_price,
        )
        _reserve(item, customer)

    event(order, "placed", "Order placed. We'll call you to confirm it.", customer, customer=True)
    transaction.on_commit(lambda: _notify_placed(order))
    return order


def _notify_placed(order):
    notify(order.customer, "order_placed", f"Order {order.number} received",
           "We'll call you shortly to confirm your order and delivery details.", f"/account/orders/{order.number}")
    notify_admins("order_placed", f"New order {order.number} to verify", f"Total KES {order.total:,.0f}",
                  f"/admin/orders/{order.number}", email=False)


# --- Customer / admin: order level -------------------------------------------------------


@transaction.atomic
def cancel_order(order: Order, actor, reason: str, by_customer: bool = False) -> Order:
    order = _lock(order)
    if by_customer:
        if order.customer_id != actor.pk:
            raise PermissionDenied()
        _require(order, [O.PENDING], "cancel online. Contact us to cancel this order")
    else:
        _require(order, [O.PENDING, O.CONFIRMED], "cancel")
        if not reason.strip():
            raise ValidationError({"reason": "Give a reason. The customer will see it."})
    for item in order.items.filter(status=OrderItem.Status.ACTIVE):
        _release(item, actor, "order cancelled")
    released = list(order.supplier_orders.filter(status__in=SupplierOrder.ACTIVE).exclude(released_at=None))
    order.supplier_orders.filter(status__in=SupplierOrder.ACTIVE).update(status=S.CANCELLED, updated_at=timezone.now())
    order.status, order.cancelled_at = O.CANCELLED, timezone.now()
    order.cancel_reason = reason or ("Cancelled by customer" if by_customer else "")
    order.save()
    event(order, "cancelled", f"Order cancelled. {order.cancel_reason}".strip(), actor, customer=True)
    for so in released:
        event(order, "cancelled", "The customer order was cancelled. Don't ship these items.", actor, so, supplier=True)
        notify_supplier(so.supplier, "supplier_order_cancelled", f"Order {so.number} cancelled",
                        "Please don't prepare or ship it.", f"/supplier/orders/{so.number}", roles=FULFILMENT_ROLES)
    if not by_customer:
        notify(order.customer, "order_cancelled", f"Order {order.number} was cancelled", order.cancel_reason,
               f"/account/orders/{order.number}")
    else:
        notify_admins("order_cancelled", f"{order.number} cancelled by customer", link=f"/admin/orders/{order.number}",
                      email=False)
    return order


@transaction.atomic
def verify_order(order: Order, admin, delivery_fee: Decimal | None = None, note: str = "") -> Order:
    """Admin has confirmed the order with the customer. Release fulfilment orders to suppliers."""
    order = _lock(order)
    _require(order, [O.PENDING], "confirm")
    if delivery_fee is None:  # nothing agreed on the call: use the county's standard fee
        delivery_fee = MarketplaceSettings.load().delivery_fee_for(order.subtotal, order.county)
    if delivery_fee != order.delivery_fee:
        event(order, "delivery_fee", f"Delivery fee: {delivery_fee:,.0f}.", admin, customer=True)
    recalculate(order, delivery_fee)
    now = timezone.now()
    order.status, order.verified_by, order.verified_at = O.CONFIRMED, admin, now
    order.save()
    event(order, "confirmed", "Order confirmed. Your parts are being prepared.", admin, customer=True)
    if note:
        event(order, "note", note, admin)
    for so in order.supplier_orders.filter(status=S.ON_HOLD).select_related("supplier"):
        so.status, so.released_at = S.INCOMING, now
        so.save(update_fields=["status", "released_at", "updated_at"])
        _announce_to_supplier(so, admin)
    notify(order.customer, "order_confirmed", f"Order {order.number} confirmed",
           f"Total KES {order.total:,.0f}. We'll let you know when it's on the way.", f"/account/orders/{order.number}")
    return order


@transaction.atomic
def record_no_answer(order: Order, admin, note: str = "") -> Order:
    """A confirmation call went unanswered. The order stays in the call list; the customer is told we tried."""
    order = _lock(order)
    _require(order, [O.PENDING], "log a call for")
    order.call_attempts += 1
    order.last_call_at = timezone.now()
    order.save(update_fields=["call_attempts", "last_call_at", "updated_at"])
    event(order, "call_no_answer", f"No answer (call {order.call_attempts}).{' ' + note if note else ''}", admin)
    event(order, "call_missed", "We called to confirm your order but couldn't reach you. We'll try again.", admin,
          customer=True)
    notify(order.customer, "order_call_missed", f"We tried to call you about {order.number}",
           "We'll call again to confirm your order. Keep your phone close.", f"/account/orders/{order.number}")
    return order


def _announce_to_supplier(so: SupplierOrder, actor):
    count = so.items.filter(status=OrderItem.Status.ACTIVE).count()
    event(so.order, "released", "New order. Please accept it or tell us if you can't fulfil it.", actor, so, supplier=True)
    notify_supplier(so.supplier, "supplier_order_new", f"New order {so.number}",
                    f"{count} item{'s' if count != 1 else ''} to prepare.", f"/supplier/orders/{so.number}",
                    roles=FULFILMENT_ROLES)


@transaction.atomic
def dispatch_order(order: Order, admin, courier: str, tracking_number: str = "", note: str = "",
                   courier_phone: str = "", expected_delivery_date=None) -> Order:
    order = _lock(order)
    _require(order, [O.CONFIRMED], "dispatch")
    waiting = order.supplier_orders.filter(status__in=[S.ON_HOLD, S.INCOMING, S.ACCEPTED, S.PROCESSING, S.READY])
    if waiting.exists():
        raise ValidationError(f"Collect from every supplier first. Waiting on: {', '.join(so.number for so in waiting)}.")
    if order.supplier_orders.filter(status=S.REJECTED, items__status=OrderItem.Status.ACTIVE).exists():
        raise ValidationError("Reassign or remove the items a supplier rejected first.")
    if not courier.strip():
        raise ValidationError({"courier": "Who is delivering it?"})
    order.status, order.dispatched_at = O.DISPATCHED, timezone.now()
    order.courier, order.tracking_number = courier.strip(), tracking_number.strip()
    order.courier_phone = courier_phone.strip()
    if expected_delivery_date is None:
        days = MarketplaceSettings.load().delivery_for(order.subtotal, order.county)["days_max"]
        expected_delivery_date = timezone.localdate() + timedelta(days=days) if days is not None else None
    order.expected_delivery_date = expected_delivery_date
    order.save()
    msg = f"On the way with {order.courier}" + (f", tracking {order.tracking_number}" if order.tracking_number else "") + "."
    if order.expected_delivery_date:
        msg += f" Expected by {order.expected_delivery_date:%a %d %b}."
    event(order, "dispatched", msg + (f" {note}" if note else ""), admin, customer=True)
    notify(order.customer, "order_dispatched", f"Order {order.number} is on the way", msg, f"/account/orders/{order.number}")
    return order


@transaction.atomic
def mark_delivered(order: Order, admin, note: str = "") -> Order:
    order = _lock(order)
    _require(order, [O.DISPATCHED], "mark as delivered")
    order.status, order.delivered_at = O.DELIVERED, timezone.now()
    order.save()
    event(order, "delivered", "Delivered." + (f" {note}" if note else ""), admin, customer=True)
    notify(order.customer, "order_delivered", f"Order {order.number} delivered", "Thank you for shopping with us.",
           f"/account/orders/{order.number}")
    return order


@transaction.atomic
def delivery_failed(order: Order, admin, reason: str) -> Order:
    """The courier couldn't hand it over. The order goes back to 'ready to dispatch' for another try."""
    order = _lock(order)
    _require(order, [O.DISPATCHED], "record a failed delivery")
    if not reason.strip():
        raise ValidationError({"reason": "What happened? The customer will see it."})
    order.status, order.dispatched_at, order.expected_delivery_date = O.CONFIRMED, None, None
    order.delivery_attempts += 1
    order.save()
    event(order, "delivery_failed", f"Delivery attempt failed: {reason.strip()} We'll call you to arrange another.",
          admin, customer=True)
    notify(order.customer, "delivery_failed", f"We couldn't deliver order {order.number}", reason.strip(),
           f"/account/orders/{order.number}")
    return order


@transaction.atomic
def complete_order(order: Order, admin) -> Order:
    order = _lock(order)
    _require(order, [O.DELIVERED], "complete")
    if order.payment_status != Order.PaymentStatus.PAID:
        raise ValidationError(f"Record the payment first. KES {order.balance_due:,.0f} is still due.")
    now = timezone.now()
    order.status, order.completed_at = O.COMPLETED, now
    order.save()
    for so in order.supplier_orders.filter(status=S.COLLECTED):
        so.status = S.COMPLETED
        so.save(update_fields=["status", "updated_at"])
        event(order, "completed", "Delivered to the customer. Order complete.", admin, so, supplier=True)
    event(order, "completed", "Order complete.", admin)
    return order


@transaction.atomic
def record_payment(order: Order, admin, amount: Decimal, method: str, reference: str = "", note: str = "",
                   received_at=None) -> Payment:
    order = _lock(order)
    if order.status == O.CANCELLED:
        raise ValidationError("This order is cancelled.")
    if amount <= 0:
        raise ValidationError({"amount": "Enter the amount received."})
    payment = Payment.objects.create(
        order=order, method=method, amount=amount, reference=reference, note=note,
        received_at=received_at or timezone.now(), recorded_by=admin,
    )
    order.amount_paid = F("amount_paid") + amount
    order.save(update_fields=["amount_paid", "updated_at"])
    order.refresh_from_db()
    _refresh_payment_status(order)
    order.save(update_fields=["payment_status"])
    event(order, "payment", f"Payment of KES {amount:,.0f} received" + (f" (ref {reference})" if reference else "") + ".",
          admin, customer=True)
    return payment


@transaction.atomic
def record_refund(order: Order, admin, amount: Decimal, method: str, reason: str, reference: str = "",
                  refunded_at=None) -> Refund:
    order = _lock(order)
    if amount <= 0:
        raise ValidationError({"amount": "Enter the amount refunded."})
    if amount > order.net_paid:
        raise ValidationError({"amount": f"We've only received KES {order.net_paid:,.0f} for this order."})
    if not reason.strip():
        raise ValidationError({"reason": "Give a reason. The customer will see it."})
    refund = Refund.objects.create(
        order=order, amount=amount, method=method, reference=reference, reason=reason.strip(),
        refunded_at=refunded_at or timezone.now(), recorded_by=admin,
    )
    order.amount_refunded = F("amount_refunded") + amount
    order.save(update_fields=["amount_refunded", "updated_at"])
    order.refresh_from_db()
    _refresh_payment_status(order)
    order.save(update_fields=["payment_status"])
    event(order, "refund", f"Refund of KES {amount:,.0f} sent" + (f" (ref {reference})" if reference else "")
          + f". {reason.strip()}", admin, customer=True)
    notify(order.customer, "refund", f"Refund for order {order.number}", f"KES {amount:,.0f} refunded.",
           f"/account/orders/{order.number}")
    return refund


# --- Supplier fulfilment -------------------------------------------------------------------


@transaction.atomic
def supplier_accept(so: SupplierOrder, user) -> SupplierOrder:
    so = _lock_so(so)
    _require(so, [S.INCOMING], "accept")
    so.status, so.accepted_at = S.ACCEPTED, timezone.now()
    so.save()
    event(so.order, "supplier_accepted", f"{so.supplier.name} accepted {so.number}.", user, so, supplier=True)
    return so


@transaction.atomic
def supplier_start(so: SupplierOrder, user) -> SupplierOrder:
    so = _lock_so(so)
    _require(so, [S.ACCEPTED], "start processing")
    so.status = S.PROCESSING
    so.save()
    event(so.order, "supplier_processing", f"{so.supplier.name} is preparing {so.number}.", user, so, supplier=True)
    return so


@transaction.atomic
def supplier_ready(so: SupplierOrder, user) -> SupplierOrder:
    so = _lock_so(so)
    _require(so, [S.ACCEPTED, S.PROCESSING], "mark ready")
    so.status, so.ready_at = S.READY, timezone.now()
    so.save()
    event(so.order, "supplier_ready", f"{so.number} is packed and ready for pickup.", user, so, supplier=True)
    notify_admins("supplier_order_ready", f"{so.number} ready for pickup", f"{so.supplier.name}, {so.supplier.town}",
                  f"/admin/orders/{so.order.number}", email=False)
    return so


@transaction.atomic
def supplier_reject(so: SupplierOrder, user, reason: str) -> SupplierOrder:
    so = _lock_so(so)
    _require(so, [S.INCOMING, S.ACCEPTED, S.PROCESSING], "reject")
    if not reason.strip():
        raise ValidationError({"reason": "Tell us why, e.g. out of stock."})
    for item in so.items.filter(status=OrderItem.Status.ACTIVE):
        _release(item, user, "rejected by supplier")
    so.status, so.rejection_reason = S.REJECTED, reason
    so.save()
    event(so.order, "supplier_rejected", f"{so.supplier.name} can't fulfil {so.number}: {reason}", user, so, supplier=True)
    notify_admins("supplier_order_rejected", f"{so.supplier.name} rejected {so.number}", reason,
                  f"/admin/orders/{so.order.number}")
    return so


@transaction.atomic
def mark_collected(so: SupplierOrder, admin) -> SupplierOrder:
    so = _lock_so(so)
    _require(so, [S.READY, S.ACCEPTED, S.PROCESSING], "mark collected")
    so.status, so.collected_at = S.COLLECTED, timezone.now()
    so.save()
    event(so.order, "collected", f"Collected {so.number} from {so.supplier.name}.", admin, so, supplier=True)
    return so


# --- Admin recovery when a supplier rejects -----------------------------------------------


@transaction.atomic
def reassign_item(item: OrderItem, admin, new_listing: SupplierListing) -> OrderItem:
    """Move a rejected item to another supplier's offer of the same part. The customer keeps their price."""
    item = OrderItem.objects.select_for_update().select_related("order", "supplier_order").get(pk=item.pk)
    order = item.order
    _require(order, [O.CONFIRMED], "reassign items")
    if item.status != OrderItem.Status.ACTIVE or item.supplier_order.status != S.REJECTED:
        raise ValidationError("Only items from a rejected supplier order can be reassigned.")
    if new_listing.product_id != item.listing.product_id or new_listing.supplier_id == item.supplier_order.supplier_id:
        raise ValidationError({"listing_id": "Pick another supplier's offer of the same part."})
    if not L.objects.filter(published_q(), pk=new_listing.pk).exists():
        raise ValidationError({"listing_id": "That offer isn't published."})

    so = order.supplier_orders.filter(supplier=new_listing.supplier, status__in=[S.INCOMING, S.ACCEPTED]).first()
    created = so is None
    if created:
        so = SupplierOrder.objects.create(order=order, supplier=new_listing.supplier, status=S.INCOMING,
                                          released_at=timezone.now())
    old = item.supplier_order
    item.supplier_order, item.listing = so, new_listing
    item.supplier_unit_price, item.sku, item.warranty = new_listing.current_supplier_price, new_listing.sku, new_listing.warranty
    item.condition = new_listing.condition
    item.on_request = new_listing.availability == L.Availability.ON_REQUEST
    item.save()
    _reserve(item, admin)
    event(order, "reassigned", f"{item.product_name} moved from {old.number} to {so.number} ({new_listing.supplier.name}).",
          admin)
    if created:
        _announce_to_supplier(so, admin)
    else:
        event(order, "item_added", f"Added {item.quantity} × {item.product_name}.", admin, so, supplier=True)
    return item


@transaction.atomic
def remove_item(item: OrderItem, admin, reason: str) -> OrderItem:
    item = OrderItem.objects.select_for_update().select_related("order", "supplier_order").get(pk=item.pk)
    order = item.order
    _require(order, [O.PENDING, O.CONFIRMED], "remove items")
    if item.status != OrderItem.Status.ACTIVE:
        raise ValidationError("Already removed.")
    if not reason.strip():
        raise ValidationError({"reason": "The customer will see why this item was removed."})
    _release(item, admin, "removed from order")
    item.status = OrderItem.Status.CANCELLED
    item.save(update_fields=["status"])
    so = item.supplier_order
    if not so.items.filter(status=OrderItem.Status.ACTIVE).exists() and so.status in SupplierOrder.ACTIVE:
        so.status = S.CANCELLED
        so.save(update_fields=["status", "updated_at"])
        if so.released_at:
            event(order, "cancelled", "Items removed from the order. Don't ship.", admin, so, supplier=True)
    recalculate(order)
    event(order, "item_removed", f"{item.quantity} × {item.product_name} removed: {reason}. New total KES {order.total:,.0f}.",
          admin, customer=True)
    if not order.items.filter(status=OrderItem.Status.ACTIVE).exists():
        cancel_order(order, admin, "No items left to fulfil.")
    else:
        notify(order.customer, "order_changed", f"Order {order.number} changed",
               f"{item.product_name} was removed: {reason}", f"/account/orders/{order.number}")
    return item
