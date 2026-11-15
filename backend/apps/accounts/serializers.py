from django.contrib.auth import password_validation
from django.db import transaction
from rest_framework import serializers


from .models import User


class MeSerializer(serializers.ModelSerializer):
    supplier = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "role", "admin_scope", "supplier"]
        read_only_fields = ["id", "email", "role", "admin_scope", "supplier"]

    def get_supplier(self, user):
        m = getattr(user, "supplier_membership", None)
        if not m or not m.is_active:
            return None
        s = m.supplier
        return {
            "id": s.id, "name": s.name, "slug": s.slug, "status": s.status,
            "is_verified": s.is_verified, "member_role": m.role, "logo_url": s.logo_url,
        }


def _validate_new_password(password, user_data):
    from django.core.exceptions import ValidationError as DjangoValidationError

    user = User(email=user_data.get("email", ""), full_name=user_data.get("full_name", ""))
    try:
        password_validation.validate_password(password, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": list(exc.messages)})


class CustomerRegisterSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        _validate_new_password(attrs["password"], attrs)
        return attrs

    def create(self, data):
        return User.objects.create_user(
            email=data["email"], password=data["password"], full_name=data["full_name"],
            phone=data.get("phone", ""), role=User.Role.CUSTOMER,
        )


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class GoogleLoginSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=4096)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            password_validation.validate_password(value, self.context["request"].user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)


class AdminTeamSerializer(serializers.ModelSerializer):
    """Marketplace admin accounts, managed by full admins."""

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "admin_scope", "is_active", "last_login", "date_joined"]
        read_only_fields = ["id", "last_login", "date_joined"]

    def validate_email(self, value):
        value = value.lower()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        request = self.context["request"]
        if self.instance is not None and self.instance == request.user and (
                attrs.get("admin_scope", User.AdminScope.FULL) != User.AdminScope.FULL
                or attrs.get("is_active") is False):
            raise serializers.ValidationError("You can't limit or disable your own account.")
        return attrs
