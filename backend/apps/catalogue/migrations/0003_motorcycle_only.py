"""Switch the catalogue from general industry to motorcycle spare parts.

Products in old categories move to the closest motorcycle category. Ones with no motorcycle
equivalent (pumps, medical, agricultural…) are set inactive in a hidden "Archived" category so
order history stays intact and an admin can review them.
"""

from django.db import migrations
from django.utils.text import slugify

from apps.catalogue.motorcycle import (
    BRANDS, CATEGORY_TREE, OLD_BRANDS_TO_DROP, OLD_TOP_LEVEL, OLD_TO_NEW,
)


def _slug(Model, name):
    base = slugify(name)[:100] or "item"
    slug, n = base, 2
    while Model.objects.filter(slug=slug).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def forwards(apps, schema_editor):
    Category = apps.get_model("catalogue", "Category")
    Product = apps.get_model("catalogue", "Product")
    Brand = apps.get_model("catalogue", "Brand")

    old_roots = list(Category.objects.filter(parent=None, name__in=OLD_TOP_LEVEL))
    old_ids = set()
    frontier = [c.pk for c in old_roots]
    while frontier:
        old_ids.update(frontier)
        frontier = list(Category.objects.filter(parent_id__in=frontier).values_list("pk", flat=True))
    if not old_ids:
        return  # nothing to convert; fresh databases get motorcycle data from `manage.py seed`

    # Free up the old slugs so the new categories get clean URLs.
    for c in Category.objects.filter(pk__in=old_ids):
        c.slug = f"old-{c.pk}-{c.slug}"[:110]
        c.save(update_fields=["slug"])

    new = {}
    for pos, (parent_name, children) in enumerate(CATEGORY_TREE.items()):
        parent = Category.objects.filter(parent=None, name=parent_name).first() or Category.objects.create(
            name=parent_name, parent=None, position=pos, slug=_slug(Category, parent_name))
        new[(parent_name, None)] = parent
        for i, child in enumerate(children):
            new[(parent_name, child)] = Category.objects.filter(parent=parent, name=child).first() or \
                Category.objects.create(name=child, parent=parent, position=i, slug=_slug(Category, child))

    archived = None
    for c in Category.objects.filter(pk__in=old_ids):
        products = Product.objects.filter(category=c)
        if not products.exists():
            continue
        target = OLD_TO_NEW.get(c.name) if c.parent_id else None
        if target:
            products.update(category=new[target])
        else:
            if archived is None:
                archived = Category.objects.create(name="Archived", parent=None, position=999, is_active=False,
                                                   slug=_slug(Category, "archived"),
                                                   description="Products from before Axe became motorcycle-only.")
            products.update(category=archived, status="inactive")

    # Delete old categories, children first.
    remaining = set(old_ids)
    while remaining:
        leaves = [pk for pk in remaining if not Category.objects.filter(parent_id=pk).exists()]
        Category.objects.filter(pk__in=leaves).delete()
        remaining -= set(leaves)

    for name in BRANDS:
        if not Brand.objects.filter(name__iexact=name).exists():
            Brand.objects.create(name=name, slug=_slug(Brand, name))
    Brand.objects.filter(name__in=OLD_BRANDS_TO_DROP, products__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("catalogue", "0002_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
