from django.conf import settings
from django.contrib.auth import get_user_model

from .emails import render_html
from .groups import group_of
from .models import Notification
from .tasks import send_email


def wants_email(user, kind: str) -> bool:
    group = group_of(kind)
    return not (group and group in (user.email_opt_out or []))


def notify(user, kind: str, title: str, body: str = "", link: str = "", email: bool = True) -> Notification:
    n = Notification.objects.create(user=user, kind=kind, title=title, body=body, link=link)
    if email and user.email and wants_email(user, kind):
        url = f"{settings.FRONTEND_URL}{link}" if link else settings.FRONTEND_URL
        send_email.delay(user.email, title, f"{body}\n\n{url}".strip(), render_html(title, body, link, "View details"))
    return n


def notify_supplier(supplier, kind, title, body="", link="", roles=None, email=True):
    members = supplier.members.filter(is_active=True, user__is_active=True).select_related("user")
    if roles:
        members = members.filter(role__in=roles)
    for m in members:
        notify(m.user, kind, title, body, link, email=email)


def notify_admins(kind, title, body="", link="", email=True):
    User = get_user_model()
    for user in User.objects.filter(role=User.Role.ADMIN, is_active=True):
        notify(user, kind, title, body, link, email=email)
