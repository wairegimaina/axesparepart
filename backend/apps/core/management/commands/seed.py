"""
Seed reference data: business categories, the product category tree and settings.

    python manage.py seed                       # reference data only (safe to re-run)
    python manage.py seed --admin you@x.com     # also create an admin (prompts for password)
    python manage.py seed --demo                # plus demo suppliers and listings (development)
"""

import getpass
import os
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalogue.models import Brand, Category
from apps.catalogue.motorcycle import BRANDS, BUSINESS_CATEGORIES, CATEGORY_TREE
from apps.core.models import MarketplaceSettings
from apps.suppliers.models import BusinessCategory, Supplier, SupplierMember

class Command(BaseCommand):
    help = "Seed reference data (and optionally an admin and demo data)."

    def add_arguments(self, parser):
        parser.add_argument("--admin", help="Email of an administrator account to create")
        parser.add_argument("--demo", action="store_true", help="Add demo suppliers and listings")

    @transaction.atomic
    def handle(self, *args, admin=None, demo=False, **opts):
        MarketplaceSettings.load()
        for name in BUSINESS_CATEGORIES:
            BusinessCategory.objects.get_or_create(name=name)
        for position, (parent_name, children) in enumerate(CATEGORY_TREE.items()):
            parent, _ = Category.objects.get_or_create(name=parent_name, parent=None, defaults={"position": position})
            for i, child in enumerate(children):
                Category.objects.get_or_create(name=child, parent=parent, defaults={"position": i})
        for name in BRANDS:
            Brand.objects.get_or_create(name=name)
        self.stdout.write(self.style.SUCCESS("Reference data ready."))

        if admin:
            self._create_admin(admin)
        if demo:
            self._demo()

    def _create_admin(self, email):
        User = get_user_model()
        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(f"Admin {email} already exists.")
            return
        password = os.getenv("ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
        if len(password) < 10:
            raise CommandError("Use at least 10 characters for the admin password.")
        User.objects.create_superuser(email=email, password=password, full_name="Marketplace Admin")
        self.stdout.write(self.style.SUCCESS(f"Admin {email} created."))

    def _demo(self):
        from apps.inventory import services

        User = get_user_model()
        demo = [
            ("Nairobi Moto Spares", "Nairobi", "Kirinyaga Road", "Spare parts dealer",
             [("Rear sprocket 428 43T", "Sprockets", "Haojin", "HJ-428-43T", "650", 60),
              ("Chain 428H 118 links", "Chains", "Daido", "428H-118", "1100", 40),
              ("Spark plug", "Spark plugs & ignition", "NGK", "C7HSA", "250", 200),
              ("Brake shoe set rear", "Brake shoes", "Bajaj", "BS-BOXER-R", "450", 80)]),
            ("Rift Valley Motorbike Parts", "Nakuru", "Nakuru town", "Spare parts dealer",
             [("Rear sprocket 428 43T", "Sprockets", "Haojin", "HJ428-43T", "620", 25),
              ("Oil filter", "Oil filters", "TVS", "TVS-OF-125", "300", 50),
              ("Tyre 3.00-18 rear", "Tyres", "Duro", "DM1012-300-18", "3200", 15),
              ("Battery 12V 5Ah", "Batteries", "Chloride Exide", "12N5-3B", "2400", 10)]),
        ]
        for name, county, town, bcat, items in demo:
            email = f"owner@{name.split()[0].lower()}.demo"
            user = User.objects.filter(email=email).first()
            profile = {"name": name, "county": county, "town": town, "tagline": "Genuine motorcycle spare parts",
                       "description": f"**{name}** supplies genuine motorcycle spare parts for Boxer, TVS, Haojin and more."}
            if user:  # refresh an existing demo supplier instead of duplicating it
                s = user.supplier_membership.supplier
                for k, v in profile.items():
                    setattr(s, k, v)
                s.save()
            else:
                user = User.objects.create_user(email=email, password="demo-pass-123", full_name=f"{name} Owner",
                                                role=User.Role.SUPPLIER)
                s = Supplier.objects.create(**profile, status=Supplier.Status.APPROVED, is_verified=True,
                                            business_phone="+254700000000", business_email=email)
                SupplierMember.objects.create(supplier=s, user=user, role=SupplierMember.Role.OWNER)
            s.business_categories.add(BusinessCategory.objects.get(name=bcat))
            for pname, cat, brand, pn, price, qty in items:
                if s.listings.filter(product__part_number=pn).exists():
                    continue
                listing, _ = services.create_listing(
                    s, user,
                    {"supplier_price": Decimal(price), "quantity": qty, "warranty": "3 months"},
                    {"name": pname, "category": Category.objects.get(name=cat), "brand": Brand.objects.get(name=brand),
                     "part_number": pn, "description": f"Genuine {brand} {pname.lower()}.",
                     "compatibility": "Bajaj Boxer\nTVS HLX\nHaojin CG125"},
                )
                listing.status = listing.Status.PENDING
                listing.save()
                services.approve_listing(listing, None)
        self.stdout.write(self.style.SUCCESS("Demo suppliers created (password: demo-pass-123)."))
