from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, role=User.Role.ADMIN)
        return self._create_user(email, password, **extra)


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrator"
        SUPPLIER = "supplier", "Supplier"
        CUSTOMER = "customer", "Customer"

    username = None
    first_name = None
    last_name = None
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CUSTOMER, db_index=True)
    email_opt_out = models.JSONField(default=list, blank=True, help_text="Notification groups not to email.")

    class AdminScope(models.TextChoices):
        FULL = "full", "Full admin"
        ORDERS = "orders", "Orders staff"

    admin_scope = models.CharField(
        max_length=10, choices=AdminScope.choices, default=AdminScope.FULL,
        help_text="For admin accounts: orders staff only see orders, deliveries, payments, customers and help requests.",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    objects = UserManager()

    @property
    def is_marketplace_admin(self) -> bool:
        return self.role == self.Role.ADMIN and self.is_active

    @property
    def is_orders_staff(self) -> bool:
        return self.is_marketplace_admin and self.admin_scope == self.AdminScope.ORDERS

    def __str__(self):
        return self.email


class LoginEvent(models.Model):
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="login_events")
    email = models.EmailField()
    success = models.BooleanField()
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
