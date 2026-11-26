from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from apps.core.models import TimeStampedModel


class BusinessCategory(models.Model):
    """Type of motorbike business, e.g. spare parts dealer, tyres, oils. A supplier can belong to several."""

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=90, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "business categories"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


def unique_slug(model, value: str, instance_pk=None, field="slug") -> str:
    base = slugify(value)[:80] or "item"
    slug, n = base, 2
    qs = model.objects.all()
    if instance_pk:
        qs = qs.exclude(pk=instance_pk)
    while qs.filter(**{field: slug}).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


class Supplier(TimeStampedModel):
    """The supplier's company profile and public storefront."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended"

    # Public profile
    name = models.CharField("company name", max_length=160)
    slug = models.SlugField(max_length=90, unique=True)
    tagline = models.CharField(max_length=160, blank=True)
    description = models.TextField(blank=True, help_text="Markdown: background, specialities, industries, services.")
    brands_distributed = models.CharField(max_length=500, blank=True)
    warranty_policy = models.TextField(blank=True)
    year_established = models.PositiveSmallIntegerField(null=True, blank=True)
    business_categories = models.ManyToManyField(BusinessCategory, blank=True, related_name="suppliers")
    county = models.CharField(max_length=60, blank=True)
    town = models.CharField(max_length=60, blank=True)
    business_hours = models.CharField(max_length=160, blank=True)
    logo_url = models.URLField(max_length=500, blank=True)
    logo_public_id = models.CharField(max_length=255, blank=True)
    cover_url = models.URLField(max_length=500, blank=True)
    cover_public_id = models.CharField(max_length=255, blank=True)

    # Private: administrators and the supplier's own team only
    registration_number = models.CharField(max_length=60, blank=True)
    tax_pin = models.CharField("KRA PIN", max_length=20, blank=True)
    physical_address = models.CharField(max_length=255, blank=True)
    website = models.URLField(blank=True)
    business_email = models.EmailField(blank=True)
    business_phone = models.CharField(max_length=20, blank=True)
    payout_details = models.TextField(blank=True, help_text="Bank name, account name and number we pay you to.")

    # Marketplace control
    markup_share_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
        help_text="Part of the markup paid to this supplier, as a % of their price (never more than the markup).",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True)
    status_reason = models.TextField(blank=True)
    is_verified = models.BooleanField(default=False, help_text="Shows the Verified Supplier badge.")
    verified_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Supplier, self.name, self.pk)
        super().save(*args, **kwargs)

    @property
    def is_approved(self) -> bool:
        return self.status == self.Status.APPROVED

    def set_status(self, status, by, reason=""):
        self.status = status
        self.status_reason = reason
        self.reviewed_by = by
        self.reviewed_at = timezone.now()
        if status != self.Status.APPROVED:
            self.is_verified = False

    def __str__(self):
        return self.name


class SupplierMember(TimeStampedModel):
    """A user who works for a supplier. One company per user."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"
        SALES = "sales", "Sales"
        INVENTORY = "inventory", "Inventory manager"

    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="members")
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="supplier_membership")
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.SALES)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["supplier", "role"]

    def __str__(self):
        return f"{self.user} @ {self.supplier} ({self.role})"


class SupplierDocument(TimeStampedModel):
    """Verification paperwork. Never public: admins and the supplier's own team only."""

    class DocType(models.TextChoices):
        REGISTRATION = "registration", "Business registration certificate"
        TAX = "tax", "Tax registration (KRA PIN)"
        DISTRIBUTION = "distribution", "Distribution authorization"
        OTHER = "other", "Other supporting document"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"

    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=16, choices=DocType.choices)
    title = models.CharField(max_length=160, blank=True)
    original_name = models.CharField(max_length=255)
    public_id = models.CharField(max_length=255)
    file_format = models.CharField(max_length=10)
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_doc_type_display()} — {self.supplier}"
