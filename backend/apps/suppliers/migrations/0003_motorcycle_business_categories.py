from django.db import migrations
from django.utils.text import slugify

from apps.catalogue.motorcycle import BUSINESS_CATEGORIES, OLD_BUSINESS_CATEGORIES


def forwards(apps, schema_editor):
    BusinessCategory = apps.get_model("suppliers", "BusinessCategory")
    if not BusinessCategory.objects.filter(name__in=OLD_BUSINESS_CATEGORIES).exists():
        return  # fresh database: `manage.py seed` creates the motorcycle supplier types
    created = {}
    for name in BUSINESS_CATEGORIES:
        created[name] = BusinessCategory.objects.filter(name=name).first() or \
            BusinessCategory.objects.create(name=name, slug=slugify(name))
    dealer = created["Spare parts dealer"]
    for old in BusinessCategory.objects.filter(name__in=OLD_BUSINESS_CATEGORIES):
        for supplier in old.suppliers.all():
            supplier.business_categories.add(dealer)
        old.delete()


class Migration(migrations.Migration):
    dependencies = [("suppliers", "0002_supplier_payout_details")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
