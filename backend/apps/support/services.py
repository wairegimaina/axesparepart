from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.notifications.service import notify, notify_admins, notify_supplier

from .models import Ticket, TicketMessage

T = Ticket.Status


def _requester_link(ticket):
    return f"/supplier/support/{ticket.number}" if ticket.supplier_id else f"/account/support/{ticket.number}"


@transaction.atomic
def open_ticket(user, subject, body, category, supplier=None, order=None, supplier_order=None) -> Ticket:
    if not body.strip():
        raise ValidationError({"body": "Tell us what you need help with."})
    t = Ticket.objects.create(opened_by=user, supplier=supplier, order=order, supplier_order=supplier_order,
                              category=category, subject=subject.strip())
    TicketMessage.objects.create(ticket=t, author=user, body=body.strip())
    who = supplier.name if supplier else user.full_name
    transaction.on_commit(lambda: notify_admins("ticket_new", f"New help request {t.number} from {who}", t.subject,
                                                f"/admin/support/{t.number}", email=False))
    return t


@transaction.atomic
def requester_reply(ticket: Ticket, user, body) -> TicketMessage:
    if not body.strip():
        raise ValidationError({"body": "Write a message."})
    msg = TicketMessage.objects.create(ticket=ticket, author=user, body=body.strip())
    ticket.status, ticket.last_message_at, ticket.resolved_at = T.OPEN, timezone.now(), None
    ticket.save(update_fields=["status", "last_message_at", "resolved_at"])
    title = f"Reply on {ticket.number}"
    link = f"/admin/support/{ticket.number}"
    if ticket.assigned_to_id:
        transaction.on_commit(lambda: notify(ticket.assigned_to, "ticket_reply", title, ticket.subject, link))
    else:
        transaction.on_commit(lambda: notify_admins("ticket_reply", title, ticket.subject, link, email=False))
    return msg


@transaction.atomic
def staff_reply(ticket: Ticket, admin, body, internal=False, resolve=False) -> TicketMessage:
    if not body.strip():
        raise ValidationError({"body": "Write a message."})
    msg = TicketMessage.objects.create(ticket=ticket, author=admin, from_staff=True, internal=internal, body=body.strip())
    if ticket.assigned_to_id is None:
        ticket.assigned_to = admin
    if not internal:
        ticket.status = T.RESOLVED if resolve else T.ANSWERED
        ticket.resolved_at = timezone.now() if resolve else None
        ticket.last_message_at = timezone.now()
        title = f"We replied to {ticket.number}"
        snippet = body.strip()[:300]
        link = _requester_link(ticket)
        if ticket.supplier_id:
            transaction.on_commit(lambda: notify_supplier(ticket.supplier, "ticket_reply", title, snippet, link))
        else:
            transaction.on_commit(lambda: notify(ticket.opened_by, "ticket_reply", title, snippet, link))
    ticket.save()
    return msg


def set_status(ticket: Ticket, status: str) -> Ticket:
    ticket.status = status
    ticket.resolved_at = timezone.now() if status == T.RESOLVED else None
    ticket.save(update_fields=["status", "resolved_at"])
    return ticket
