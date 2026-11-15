"""Notification kinds grouped for email preferences. Kinds not listed are always emailed."""

GROUPS = {
    "orders": {
        "label": "Orders and deliveries",
        "kinds": {"order_placed", "order_confirmed", "order_call_missed", "order_dispatched", "order_delivered", "order_cancelled",
                  "order_changed", "delivery_failed", "refund", "supplier_order_new", "supplier_order_cancelled"},
    },
    "catalogue": {
        "label": "Product approvals and stock alerts",
        "kinds": {"listing_approved", "listing_rejected", "listing_submitted", "low_stock",
                  "deal_submitted", "deal_approved", "deal_rejected"},
    },
    "support": {
        "label": "Replies to help requests",
        "kinds": {"ticket_reply", "ticket_new"},
    },
}


def group_of(kind: str) -> str | None:
    return next((g for g, v in GROUPS.items() if kind in v["kinds"]), None)
