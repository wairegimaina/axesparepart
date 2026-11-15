from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from apps.notifications.emails import render_html
from apps.notifications.tasks import send_email

from .models import User


def set_password_link(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"


def send_password_reset(user):
    link = set_password_link(user)
    send_email.delay(
        user.email,
        "Reset your Axe Spare Parts password",
        f"Hello {user.full_name},\n\nUse this link to set a new password:\n{link}\n\n"
        "If you didn't ask for this, ignore this email.",
        render_html("Reset your password", f"Hello {user.full_name},\n\nUse the button below to set a new password. "
                    "If you didn't ask for this, ignore this email.", link, "Set a new password"),
    )


def send_invite(user, company_name: str, inviter_name: str):
    link = set_password_link(user)
    title = f"You've been added to {company_name} on Axe Spare Parts"
    send_email.delay(
        user.email, title,
        f"Hello {user.full_name},\n\n{inviter_name} added you to {company_name}'s supplier team.\n"
        f"Set your password to sign in:\n{link}",
        render_html(title, f"Hello {user.full_name},\n\n{inviter_name} added you to {company_name}'s supplier team. "
                    "Set your password to sign in.", link, "Set your password"),
    )


def send_staff_invite(user, inviter_name: str):
    link = set_password_link(user)
    role = user.get_admin_scope_display().lower()
    title = "You've been added to the Axe Spare Parts team"
    body = f"Hello {user.full_name},\n\n{inviter_name} added you to the Axe Spare Parts admin team as {role}."
    send_email.delay(user.email, title, f"{body}\nSet your password to sign in:\n{link}",
                     render_html(title, f"{body} Set your password to sign in.", link, "Set your password"))


def user_from_token(uid: str, token: str):
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid)))
    except (User.DoesNotExist, ValueError, TypeError, OverflowError):
        return None
    return user if default_token_generator.check_token(user, token) else None
