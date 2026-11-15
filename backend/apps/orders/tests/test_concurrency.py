import threading
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.catalogue.models import Brand, Category, Product
from apps.inventory.models import SupplierListing
from apps.orders import services
from apps.orders.models import Order
from apps.suppliers.models import Supplier

ADDRESS = {"recipient_name": "A", "phone": "1", "county": "N", "town": "N", "street_address": "x"}


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class LastUnitRaceTest(TransactionTestCase):
    def test_two_customers_racing_for_the_last_unit(self):
        s = Supplier.objects.create(name="Solo", status="approved")
        p = Product.objects.create(name="Pump", category=Category.objects.create(name="Pumps"),
                                   brand=Brand.objects.create(name="Grundfos"), status="active")
        listing = SupplierListing.objects.create(supplier=s, product=p, supplier_price=Decimal("100"), quantity=1,
                                                 status="approved")
        buyers = [User.objects.create_user(email=f"b{i}@t.ke", password="x-pass-12345", full_name="B") for i in range(2)]
        results, barrier = [], threading.Barrier(2)

        def buy(user):
            try:
                barrier.wait()
                services.place_order(user, [{"listing_id": listing.id, "quantity": 1}], ADDRESS)
                results.append("ok")
            except ValidationError:
                results.append("rejected")
            finally:
                connection.close()

        threads = [threading.Thread(target=buy, args=(u,)) for u in buyers]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        listing.refresh_from_db()
        self.assertEqual(sorted(results), ["ok", "rejected"])
        self.assertEqual(listing.quantity, 0)
        self.assertEqual(Order.objects.count(), 1)
