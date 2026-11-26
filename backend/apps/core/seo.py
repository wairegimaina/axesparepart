"""robots.txt and sitemap.xml for search engines. Caddy routes both paths to Django."""

from xml.sax.saxutils import escape

from django.conf import settings
from django.db.models import Exists, Max, OuterRef
from django.http import HttpResponse
from django.utils.http import urlencode
from django.views.decorators.cache import cache_page

# /api/ stays crawlable: product pages load their name, price and photos from it when Google renders them.
PRIVATE_PATHS = ["/admin", "/supplier", "/account", "/cart", "/checkout", "/login", "/register",
                 "/forgot-password", "/reset-password", "/django-admin/"]


def _base() -> str:
    return settings.FRONTEND_URL.rstrip("/")


@cache_page(60 * 60)
def robots_txt(request):
    lines = ["User-agent: *", "Allow: /", *[f"Disallow: {p}" for p in PRIVATE_PATHS], "",
             f"Sitemap: {_base()}/sitemap.xml", ""]
    return HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")


@cache_page(60 * 60)
def sitemap_xml(request):
    """Shop pages, every category, and every part customers can currently buy."""
    from apps.catalogue.models import Category, Product
    from apps.inventory.queries import published_q
    from apps.inventory.models import SupplierListing

    base = _base()
    sellable = SupplierListing.objects.filter(published_q(), product=OuterRef("pk"))
    products = (Product.objects.filter(status=Product.Status.ACTIVE)
                .filter(Exists(sellable)).values("slug", "updated_at").order_by("name"))
    newest = Product.objects.filter(status=Product.Status.ACTIVE).aggregate(m=Max("updated_at"))["m"]

    urls = [(f"{base}/", newest, "daily", "1.0"), (f"{base}/products", newest, "daily", "0.9"),
            (f"{base}/brands", None, "weekly", "0.5"), (f"{base}/help", None, "monthly", "0.3")]
    for slug in Category.objects.filter(is_active=True).values_list("slug", flat=True):
        urls.append((f"{base}/products?{urlencode({'category': slug})}", None, "weekly", "0.7"))
    for p in products:
        urls.append((f"{base}/products/{p['slug']}", p["updated_at"], "weekly", "0.8"))

    body = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod, freq, priority in urls:
        body.append("  <url>")
        body.append(f"    <loc>{escape(loc)}</loc>")
        if lastmod:
            body.append(f"    <lastmod>{lastmod.date().isoformat()}</lastmod>")
        body.append(f"    <changefreq>{freq}</changefreq><priority>{priority}</priority>")
        body.append("  </url>")
    body.append("</urlset>")
    return HttpResponse("\n".join(body) + "\n", content_type="application/xml; charset=utf-8")
