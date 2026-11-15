from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit, client_ip
from apps.core.permissions import IsAdmin
from apps.notifications.service import notify_admins

from django.contrib.auth import password_validation
from rest_framework.exceptions import ValidationError

from .models import LoginEvent, User
from .passwords import send_password_reset, send_staff_invite, user_from_token
from .serializers import (
    AdminTeamSerializer, PasswordResetConfirmSerializer, PasswordResetRequestSerializer,
    ChangePasswordSerializer, CustomerRegisterSerializer, GoogleLoginSerializer, LoginSerializer, MeSerializer,
)
from apps.core.models import MarketplaceSettings


def verify_google_credential(credential: str, client_id: str) -> dict:
    """Checks the ID token's signature, audience and expiry with Google's public keys."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    return id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """Sets the csrftoken cookie. The SPA calls this once on load."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class CsrfProtectedView(APIView):
    """DRF only checks CSRF for logged-in users. Login/registration need it too (login CSRF)."""


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        s = MeSerializer(request.user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class _RegisterBase(CsrfProtectedView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"
    serializer_class = None

    def post(self, request):
        s = self.serializer_class(data=request.data)
        s.is_valid(raise_exception=True)
        user = s.save()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        self.after_register(user)
        return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED)

    def after_register(self, user):
        pass


class CustomerRegisterView(_RegisterBase):
    serializer_class = CustomerRegisterSerializer


class LoginView(CsrfProtectedView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"].lower()
        user = authenticate(request, email=email, password=s.validated_data["password"])
        LoginEvent.objects.create(
            user=user, email=email, success=user is not None, ip_address=client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        )
        if user is None:
            return Response({"detail": "Incorrect email or password."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(MeSerializer(user).data)


class GoogleLoginView(CsrfProtectedView):
    """
    Sign in (or sign up) with a Google ID token from the "Continue with Google" button.
    New emails become customer accounts. Admin accounts must use their password.
    """

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        s = GoogleLoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        client_id = MarketplaceSettings.load().google_client_id
        if not client_id:
            return Response({"detail": "Google sign-in is not set up."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            info = verify_google_credential(s.validated_data["credential"], client_id)
        except ValueError:
            return Response({"detail": "Google sign-in failed. Please try again."}, status=status.HTTP_400_BAD_REQUEST)
        email = (info.get("email") or "").lower()
        if not email or not info.get("email_verified"):
            return Response({"detail": "Your Google email isn't verified."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if user is None:
            user = User.objects.create_user(
                email=email, full_name=(info.get("name") or email.split("@")[0])[:150], role=User.Role.CUSTOMER,
            )
            created = True
        ok = user.is_active and user.role != User.Role.ADMIN
        LoginEvent.objects.create(
            user=user, email=email, success=ok, ip_address=client_ip(request),
            user_agent=("google " + request.META.get("HTTP_USER_AGENT", ""))[:255],
        )
        if user.role == User.Role.ADMIN:
            return Response({"detail": "Admins sign in with email and password."}, status=status.HTTP_400_BAD_REQUEST)
        if not user.is_active:
            return Response({"detail": "This account is disabled."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class AdminTeamViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin,
                       viewsets.GenericViewSet):
    """Full admins add, limit and disable admin accounts. New members get a set-password email."""

    permission_classes = [IsAdmin]
    serializer_class = AdminTeamSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        return User.objects.filter(role=User.Role.ADMIN).order_by("full_name")

    def perform_create(self, serializer):
        user = serializer.save(role=User.Role.ADMIN)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        audit(self.request, "team.added", user, scope=user.admin_scope)
        send_staff_invite(user, self.request.user.full_name)

    def perform_update(self, serializer):
        user = serializer.save()
        audit(self.request, "team.changed", user, scope=user.admin_scope, active=user.is_active)

    @action(detail=True, methods=["post"], url_path="resend-invite")
    def resend_invite(self, request, pk=None):
        user = self.get_object()
        send_staff_invite(user, request.user.full_name)
        return Response({"sent_to": user.email})


class LogoutView(CsrfProtectedView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    def post(self, request):
        s = ChangePasswordSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        request.user.set_password(s.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestView(CsrfProtectedView):
    """Always answers 204 so it can't be used to discover which emails have accounts."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        s = PasswordResetRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=s.validated_data["email"], is_active=True).first()
        if user:
            send_password_reset(user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(CsrfProtectedView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        s = PasswordResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = user_from_token(s.validated_data["uid"], s.validated_data["token"])
        if user is None:
            raise ValidationError({"token": "This link is invalid or has expired."})
        try:
            password_validation.validate_password(s.validated_data["new_password"], user)
        except Exception as exc:
            raise ValidationError({"new_password": list(getattr(exc, "messages", [str(exc)]))})
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)
