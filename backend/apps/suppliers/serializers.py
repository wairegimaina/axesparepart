from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import BusinessCategory, Supplier, SupplierDocument, SupplierMember

User = get_user_model()


class BusinessCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessCategory
        fields = ["id", "name", "slug", "is_active"]
        read_only_fields = ["slug"]


PUBLIC_FIELDS = [
    "id", "name", "slug", "tagline", "description", "brands_distributed", "warranty_policy",
    "year_established", "business_categories", "county", "town", "business_hours",
    "logo_url", "cover_url", "is_verified", "member_since",
]
PRIVATE_FIELDS = [
    "registration_number", "tax_pin", "physical_address", "website", "business_email", "business_phone",
    "payout_details",
]


class SupplierBadgeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "slug", "logo_url", "is_verified", "county", "town"]


class SupplierProfileSerializer(serializers.ModelSerializer):
    """The supplier's own view and edit form of their company profile."""

    business_categories = BusinessCategorySerializer(many=True, read_only=True)
    business_category_ids = serializers.PrimaryKeyRelatedField(
        source="business_categories", queryset=BusinessCategory.objects.filter(is_active=True),
        many=True, write_only=True, required=False,
    )
    member_since = serializers.DateTimeField(source="created_at", read_only=True, format="%Y")
    # Locked once the company has been approved; admins change these.
    LOCKED_WHEN_APPROVED = ("name", "registration_number", "tax_pin")

    class Meta:
        model = Supplier
        fields = PUBLIC_FIELDS + PRIVATE_FIELDS + [
            "business_category_ids", "status", "status_reason", "reviewed_at", "markup_share_percent",
        ]
        read_only_fields = [
            "slug", "logo_url", "cover_url", "is_verified", "status", "status_reason", "reviewed_at",
            "markup_share_percent",
        ]

    def validate_year_established(self, value):
        from django.utils import timezone

        if value and not (1850 <= value <= timezone.now().year):
            raise serializers.ValidationError("Enter a valid year.")
        return value

    def validate(self, attrs):
        if self.instance and self.instance.is_approved:
            for field in self.LOCKED_WHEN_APPROVED:
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError(
                        {field: "This can't be changed after approval. Contact the marketplace admin."}
                    )
        return attrs


class SupplierDocumentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    doc_type_display = serializers.CharField(source="get_doc_type_display", read_only=True)

    class Meta:
        model = SupplierDocument
        fields = [
            "id", "doc_type", "doc_type_display", "title", "original_name", "file_format", "size_bytes",
            "status", "review_note", "reviewed_at", "created_at", "file",
        ]
        read_only_fields = [
            "original_name", "file_format", "size_bytes", "status", "review_note", "reviewed_at", "created_at",
        ]


class MemberSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    last_login = serializers.DateTimeField(source="user.last_login", read_only=True)

    class Meta:
        model = SupplierMember
        fields = ["id", "email", "full_name", "role", "is_active", "last_login", "created_at"]


class MemberInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=[r for r in SupplierMember.Role.choices if r[0] != "owner"])

    def validate_email(self, value):
        return check_free_for_supplier(value)


def check_free_for_supplier(email: str) -> str:
    """An email can join a supplier if it's new, or belongs to a customer account (which then becomes a supplier login)."""
    email = email.lower()
    user = User.objects.filter(email__iexact=email).first()
    if user is not None and (user.role != User.Role.CUSTOMER or hasattr(user, "supplier_membership")):
        raise serializers.ValidationError("This email is already used by a supplier or admin account.")
    return email


def supplier_login(email: str, full_name: str, phone: str = ""):
    """The login for a new supplier member: a fresh account, or an existing customer account switched over.

    A switched account keeps its password and order history; it signs in to the supplier portal from now on.
    """
    user = User.objects.filter(email__iexact=email, role=User.Role.CUSTOMER).first()
    if user is None:
        user = User.objects.create_user(email=email, full_name=full_name, phone=phone, role=User.Role.SUPPLIER)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        return user, False
    user.role = User.Role.SUPPLIER
    user.is_active = True
    user.full_name = user.full_name or full_name
    user.phone = user.phone or phone
    user.save(update_fields=["role", "is_active", "full_name", "phone"])
    return user, True


class AdminSupplierCreateSerializer(serializers.Serializer):
    """Admin onboards a supplier company and its owner. The owner gets an email to set their password."""

    company_name = serializers.CharField(max_length=160)
    business_phone = serializers.CharField(max_length=20)
    business_email = serializers.EmailField(required=False, allow_blank=True)
    county = serializers.CharField(max_length=60)
    town = serializers.CharField(max_length=60, required=False, allow_blank=True)
    physical_address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    registration_number = serializers.CharField(max_length=60, required=False, allow_blank=True)
    tax_pin = serializers.CharField(max_length=20, required=False, allow_blank=True)
    business_category_ids = serializers.PrimaryKeyRelatedField(
        queryset=BusinessCategory.objects.filter(is_active=True), many=True, required=False)
    owner_name = serializers.CharField(max_length=150)
    owner_email = serializers.EmailField()
    owner_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate_owner_email(self, value):
        return check_free_for_supplier(value)


class AdminSupplierSerializer(SupplierProfileSerializer):
    documents = SupplierDocumentSerializer(many=True, read_only=True)
    members = MemberSerializer(many=True, read_only=True)
    listing_counts = serializers.SerializerMethodField()

    class Meta(SupplierProfileSerializer.Meta):
        fields = SupplierProfileSerializer.Meta.fields + [
            "documents", "members", "listing_counts", "verified_at", "created_at",
        ]
        # Admins set the supplier's markup share; the supplier only sees it.
        read_only_fields = [f for f in SupplierProfileSerializer.Meta.read_only_fields if f != "markup_share_percent"] + [
            "verified_at", "created_at"]

    def validate(self, attrs):
        return attrs  # admins may edit locked fields

    def get_listing_counts(self, obj):
        from django.db.models import Count

        rows = obj.listings.values("status").annotate(n=Count("id"))
        return {r["status"]: r["n"] for r in rows}


class AdminSupplierListSerializer(serializers.ModelSerializer):
    owner_email = serializers.SerializerMethodField()
    document_count = serializers.IntegerField(read_only=True)
    pending_documents = serializers.IntegerField(read_only=True)

    class Meta:
        model = Supplier
        fields = [
            "id", "name", "slug", "status", "is_verified", "county", "town", "business_phone",
            "owner_email", "document_count", "pending_documents", "created_at", "markup_share_percent",
        ]

    def get_owner_email(self, obj):
        owner = next((m for m in obj.members.all() if m.role == SupplierMember.Role.OWNER), None)
        return owner.user.email if owner else None


class StatusChangeSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class DocumentReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["accepted", "rejected"])
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
