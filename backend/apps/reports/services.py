"""
Report figures. Definitions used everywhere:

- Orders placed: orders created in the period (any status).
- Sales: orders *completed* in the period (delivered and paid). Revenue = their totals.
- Parts margin: customer parts price minus supplier price, on active items.
- Supplier earnings: supplier price × quantity for items in fulfilment orders the marketplace
  has collected (collected/completed). Balance owed = earnings - payouts.
"""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum
from django.db.models.functions import Coalesce, TruncDay, TruncMonth

from apps.orders.models import Order, OrderItem, SupplierOrder
from apps.payments.models import SupplierPayout
from apps.suppliers.models import Supplier

O = Order.Status
S = SupplierOrder.Status
ZERO = Decimal("0")
MONEY = DecimalField(max_digits=14, decimal_places=2)
LINE = ExpressionWrapper(F("unit_price") * F("quantity"), output_field=MONEY)
COST = ExpressionWrapper(F("supplier_unit_price") * F("quantity"), output_field=MONEY)
EARNED_STATUSES = [S.COLLECTED, S.COMPLETED]


def _sum(qs, expr):
    return qs.aggregate(v=Coalesce(Sum(expr), ZERO, output_field=MONEY))["v"]


def _completed(start, end):
    return Order.objects.filter(status=O.COMPLETED, completed_at__gte=start, completed_at__lt=end)


def sales_report(start, end, days):
    placed = Order.objects.filter(created_at__gte=start, created_at__lt=end)
    done = _completed(start, end)
    items = OrderItem.objects.filter(order__in=done, status="active")
    revenue = _sum(done, "total")
    parts = _sum(items, LINE)
    cost = _sum(items, COST)
    count = done.count()
    by_status = {r["status"]: r["n"] for r in placed.values("status").annotate(n=Count("id"))}
    trunc = TruncDay if days <= 62 else TruncMonth
    series = defaultdict(lambda: {"revenue": ZERO, "margin": ZERO, "orders": 0, "placed": 0})
    for r in done.annotate(p=trunc("completed_at")).values("p").annotate(rev=Sum("total"), n=Count("id")):
        series[r["p"].date()].update(revenue=r["rev"], orders=r["n"])
    for r in items.annotate(p=trunc("order__completed_at")).values("p").annotate(m=Sum(LINE) - Sum(COST)):
        series[r["p"].date()]["margin"] = r["m"]
    for r in placed.annotate(p=trunc("created_at")).values("p").annotate(n=Count("id")):
        series[r["p"].date()]["placed"] = r["n"]
    total_placed = sum(by_status.values())
    return {
        "granularity": "day" if trunc is TruncDay else "month",
        "orders_placed": total_placed,
        "orders_by_status": by_status,
        "cancellation_rate": round(100 * by_status.get(O.CANCELLED, 0) / total_placed) if total_placed else None,
        "completed_orders": count,
        "revenue": revenue,
        "parts_sales": parts,
        "delivery_fees": _sum(done, "delivery_fee"),
        "supplier_cost": cost,
        "parts_margin": parts - cost,
        "margin_percent": round(100 * (parts - cost) / parts, 1) if parts else None,
        "average_order": (revenue / count).quantize(Decimal("1")) if count else None,
        "by_payment_method": [
            {"method": r["payment_method"], "orders": r["n"], "revenue": r["rev"]}
            for r in done.values("payment_method").annotate(n=Count("id"), rev=Sum("total")).order_by("-rev")
        ],
        "by_county": [
            {"county": r["county"], "orders": r["n"], "revenue": r["rev"]}
            for r in done.values("county").annotate(n=Count("id"), rev=Sum("total")).order_by("-rev")[:15]
        ],
        "series": [{"period": k.isoformat(), **v} for k, v in sorted(series.items())],
    }


def products_report(start, end):
    items = OrderItem.objects.filter(order__in=_completed(start, end), status="active")
    products = (
        items.values("listing__product_id", "product_name", "brand_name", "part_number", "product_slug")
        .annotate(units=Sum("quantity"), revenue=Sum(LINE), cost=Sum(COST), orders=Count("order", distinct=True))
        .order_by("-revenue")[:50]
    )
    categories = (
        items.values("listing__product__category__name")
        .annotate(units=Sum("quantity"), revenue=Sum(LINE), cost=Sum(COST))
        .order_by("-revenue")[:20]
    )
    return {
        "products": [
            {"product_id": r["listing__product_id"], "name": r["product_name"], "brand": r["brand_name"],
             "part_number": r["part_number"], "slug": r["product_slug"], "units": r["units"], "orders": r["orders"],
             "revenue": r["revenue"], "margin": r["revenue"] - r["cost"]}
            for r in products
        ],
        "categories": [
            {"category": r["listing__product__category__name"] or "Uncategorised", "units": r["units"],
             "revenue": r["revenue"], "margin": r["revenue"] - r["cost"]}
            for r in categories
        ],
    }


def supplier_balances(supplier_ids=None):
    """All-time earnings, payouts and balance per supplier."""
    items = OrderItem.objects.filter(status="active", supplier_order__status__in=EARNED_STATUSES)
    payouts = SupplierPayout.objects.all()
    if supplier_ids is not None:
        items = items.filter(supplier_order__supplier_id__in=supplier_ids)
        payouts = payouts.filter(supplier_id__in=supplier_ids)
    earned = {r["supplier_order__supplier_id"]: r["v"] for r in
              items.values("supplier_order__supplier_id").annotate(v=Sum(COST))}
    paid = {r["supplier_id"]: r["v"] for r in payouts.values("supplier_id").annotate(v=Sum("amount"))}
    ids = set(earned) | set(paid)
    return {i: {"earned": earned.get(i, ZERO), "paid": paid.get(i, ZERO),
                "balance": earned.get(i, ZERO) - paid.get(i, ZERO)} for i in ids}


def suppliers_report(start, end):
    released = SupplierOrder.objects.filter(released_at__gte=start, released_at__lt=end)
    stats = {r["supplier_id"]: r for r in released.values("supplier_id").annotate(
        received=Count("id"),
        fulfilled=Count("id", filter=Q(status__in=EARNED_STATUSES)),
        rejected=Count("id", filter=Q(status=S.REJECTED)),
    )}
    # Timing, in hours, averaged in Python (portable across databases).
    timing = defaultdict(lambda: {"accept": [], "ready": []})
    for so in released.exclude(accepted_at=None).values("supplier_id", "released_at", "accepted_at", "ready_at"):
        timing[so["supplier_id"]]["accept"].append((so["accepted_at"] - so["released_at"]).total_seconds() / 3600)
        if so["ready_at"]:
            timing[so["supplier_id"]]["ready"].append((so["ready_at"] - so["released_at"]).total_seconds() / 3600)
    sales = {r["supplier_order__supplier_id"]: r for r in OrderItem.objects.filter(
        status="active", supplier_order__status__in=EARNED_STATUSES,
        supplier_order__collected_at__gte=start, supplier_order__collected_at__lt=end,
    ).values("supplier_order__supplier_id").annotate(revenue=Sum(LINE), cost=Sum(COST), units=Sum("quantity"))}
    ids = set(stats) | set(sales)
    balances = supplier_balances(ids)
    names = {s.id: s for s in Supplier.objects.filter(id__in=ids)}
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
    rows = []
    for i in ids:
        st, sa, b = stats.get(i, {}), sales.get(i, {}), balances.get(i, {})
        done, rej = st.get("fulfilled", 0), st.get("rejected", 0)
        rows.append({
            "supplier_id": i, "name": names[i].name, "is_verified": names[i].is_verified,
            "orders_received": st.get("received", 0), "orders_fulfilled": done, "orders_rejected": rej,
            "fulfilment_rate": round(100 * done / (done + rej)) if done + rej else None,
            "hours_to_accept": avg(timing[i]["accept"]), "hours_to_ready": avg(timing[i]["ready"]),
            "units": sa.get("units") or 0, "customer_sales": sa.get("revenue") or ZERO,
            "supplier_earnings": sa.get("cost") or ZERO,
            "margin": (sa.get("revenue") or ZERO) - (sa.get("cost") or ZERO),
            "balance_owed": b.get("balance", ZERO),
        })
    rows.sort(key=lambda r: r["customer_sales"], reverse=True)
    return {"suppliers": rows}


def customers_report(start, end):
    done = _completed(start, end)
    rows = (
        done.values("customer_id", "customer__full_name", "customer__email", "customer__phone")
        .annotate(orders=Count("id"), revenue=Sum("total")).order_by("-revenue")[:50]
    )
    new = Order.objects.filter(created_at__gte=start, created_at__lt=end).values("customer_id").distinct()
    first_time = sum(1 for r in new if not Order.objects.filter(customer_id=r["customer_id"], created_at__lt=start).exists())
    return {
        "customers_ordering": new.count(),
        "first_time_customers": first_time,
        "customers": [
            {"customer_id": r["customer_id"], "name": r["customer__full_name"], "email": r["customer__email"],
             "phone": r["customer__phone"], "orders": r["orders"], "revenue": r["revenue"]}
            for r in rows
        ],
    }


def supplier_statement(supplier, start, end):
    """Earnings lines (collected fulfilment orders) and payouts in the period, plus balances."""
    sos = (
        SupplierOrder.objects.filter(supplier=supplier, status__in=EARNED_STATUSES,
                                     collected_at__gte=start, collected_at__lt=end)
        .annotate(amount=Coalesce(Sum(ExpressionWrapper(F("items__supplier_unit_price") * F("items__quantity"),
                                                        output_field=MONEY), filter=Q(items__status="active")),
                                  ZERO, output_field=MONEY),
                  units=Sum("items__quantity", filter=Q(items__status="active")))
        .order_by("collected_at")
    )
    payouts = supplier.payouts.filter(paid_at__gte=start, paid_at__lt=end).order_by("paid_at")
    now = supplier_balances([supplier.id]).get(supplier.id, {"earned": ZERO, "paid": ZERO, "balance": ZERO})
    earned_in = sum((so.amount for so in sos), ZERO)
    paid_in = _sum(payouts, "amount")
    # Opening balance = everything before the period.
    earned_before = _sum(OrderItem.objects.filter(status="active", supplier_order__supplier=supplier,
                                                  supplier_order__status__in=EARNED_STATUSES,
                                                  supplier_order__collected_at__lt=start), COST)
    paid_before = _sum(supplier.payouts.filter(paid_at__lt=start), "amount")
    opening = earned_before - paid_before
    return {
        "opening_balance": opening,
        "earned": earned_in,
        "paid": paid_in,
        "closing_balance": opening + earned_in - paid_in,
        "current_balance": now["balance"],
        "earnings": [{"number": so.number, "collected_at": so.collected_at, "units": so.units or 0, "amount": so.amount}
                     for so in sos],
        "payouts": [{"id": p.id, "amount": p.amount, "method": p.get_method_display(), "reference": p.reference,
                     "note": p.note, "paid_at": p.paid_at} for p in payouts],
    }
