from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.catalogue.models import Brand, Category, Product
from apps.inventory.models import SupplierListing
from apps.suppliers.models import Supplier


@override_settings(FRONTEND_URL="https://axespareparts.com")
class SeoTests(TestCase):
    def setUp(self):
        cache.clear()
        cat = Category.objects.create(name="Brakes")
        brand = Brand.objects.create(name="TVS")
        sup = Supplier.objects.create(name="Alpha", status="approved")
        self.sold = Product.objects.create(name="Brake pad", category=cat, brand=brand, part_number="BP1", status="active")
        self.unsold = Product.objects.create(name="Draft part", category=cat, brand=brand, part_number="DP1", status="active")
        SupplierListing.objects.create(supplier=sup, product=self.sold, supplier_price=Decimal("100"), quantity=1,
                                       status="approved")
        SupplierListing.objects.create(supplier=sup, product=self.unsold, supplier_price=Decimal("100"), quantity=1,
                                       status="pending")

    def test_robots_points_to_sitemap_and_hides_private_pages(self):
        r = self.client.get("/robots.txt")
        self.assertEqual(r["Content-Type"], "text/plain; charset=utf-8")
        body = r.content.decode()
        self.assertIn("Sitemap: https://axespareparts.com/sitemap.xml", body)
        self.assertIn("Disallow: /admin", body)
        self.assertIn("Disallow: /checkout", body)
        self.assertNotIn("Disallow: /api", body)  # Google needs it to render product pages

    def test_sitemap_lists_only_parts_customers_can_buy(self):
        r = self.client.get("/sitemap.xml")
        self.assertEqual(r["Content-Type"], "application/xml; charset=utf-8")
        body = r.content.decode()
        self.assertIn(f"<loc>https://axespareparts.com/products/{self.sold.slug}</loc>", body)
        self.assertNotIn(self.unsold.slug, body)
        self.assertIn("<loc>https://axespareparts.com/products?category=brakes</loc>", body)
