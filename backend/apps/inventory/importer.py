"""
Excel bulk import for supplier listings.

Each row either creates a new draft listing or, when the SKU matches one of the
supplier's existing listings, updates that listing's price, stock and terms.
Rows are processed independently: one bad row doesn't stop the rest.
"""

from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.db import transaction
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from rest_framework.exceptions import ValidationError

from apps.catalogue.models import Brand, Category

from . import services
from .models import StockMovement, SupplierListing

L = SupplierListing
MAX_ROWS = 2000

COLUMNS = [
    ("product_name", True, "Name of the spare part"),
    ("category", True, "Category slug from the Categories sheet"),
    ("brand", True, "Manufacturer"),
    ("part_number", False, "Manufacturer part number"),
    ("sku", False, "Your internal code. Re-importing the same SKU updates that product"),
    ("condition", False, "new / refurbished / used (default new)"),
    ("supplier_price", True, "Your price in KES"),
    ("quantity", False, "Stock on hand (default 0)"),
    ("min_order_quantity", False, "Default 1"),
    ("warranty", False, "e.g. 6 months"),
    ("availability", False, "in_stock / out_of_stock / on_request"),
    ("description", False, "Product description"),
    ("compatibility", False, "Motorbike models it fits, separated by ;"),
    ("specifications", False, "Name: value; Name: value"),
]


def build_template() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"
    header_fill = PatternFill("solid", fgColor="1F2937")
    for i, (name, required, hint) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=i, value=name + (" *" if required else ""))
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        ws.cell(row=2, column=i, value=hint).font = Font(italic=True, color="6B7280")
        ws.column_dimensions[cell.column_letter].width = max(16, len(name) + 6)
    example = ["Oil filter", "", "Bosch", "0 451 103 316", "OF-316", "new", "850", "40", "1", "3 months",
               "in_stock", "Spin-on oil filter", "Toyota Corolla 2008-2014", "Thread: M20x1.5; Height: 86mm"]
    for i, value in enumerate(example, start=1):
        ws.cell(row=3, column=i, value=value).font = Font(color="9CA3AF")
    ws.freeze_panes = "A4"

    for col, choices in (("F", "new,refurbished,used"), ("K", "in_stock,out_of_stock,on_request")):
        dv = DataValidation(type="list", formula1=f'"{choices}"', allow_blank=True)
        dv.add(f"{col}4:{col}{MAX_ROWS + 3}")
        ws.add_data_validation(dv)

    cats = wb.create_sheet("Categories")
    cats.append(["slug", "category"])
    for c in Category.objects.filter(is_active=True).select_related("parent"):
        cats.append([c.slug, str(c)])
    cats.column_dimensions["A"].width = 30
    cats.column_dimensions["B"].width = 50

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _clean(value) -> str:
    return "" if value is None else str(value).strip()


def _decimal(value, field):
    try:
        d = Decimal(_clean(value).replace(",", ""))
    except InvalidOperation:
        raise ValidationError({field: "must be a number"})
    if d <= 0:
        raise ValidationError({field: "must be more than 0"})
    return d


def _int(value, field, default):
    text = _clean(value)
    if not text:
        return default
    try:
        n = int(float(text))
    except ValueError:
        raise ValidationError({field: "must be a whole number"})
    if n < 0:
        raise ValidationError({field: "can't be negative"})
    return n


def _specs(text: str) -> list[dict]:
    specs = []
    for part in text.split(";"):
        if ":" in part:
            name, value = part.split(":", 1)
            if name.strip() and value.strip():
                specs.append({"name": name.strip()[:80], "value": value.strip()[:200]})
    return specs


def _parse_row(row: dict, categories: dict) -> tuple[dict, dict]:
    missing = [n for n, req, _ in COLUMNS if req and not _clean(row.get(n))]
    if missing:
        raise ValidationError({m: "is required" for m in missing})
    cat_key = _clean(row["category"]).lower()
    category = categories.get(cat_key)
    if category is None:
        raise ValidationError({"category": f"'{row['category']}' isn't a category slug (see the Categories sheet)"})
    brand_name = _clean(row["brand"])[:100]
    brand = Brand.objects.filter(name__iexact=brand_name).first() or Brand.objects.create(name=brand_name)
    condition = _clean(row.get("condition")).lower() or L.Condition.NEW
    if condition not in L.Condition.values:
        raise ValidationError({"condition": "use new, refurbished or used"})
    availability = _clean(row.get("availability")).lower() or L.Availability.IN_STOCK
    if availability not in L.Availability.values:
        raise ValidationError({"availability": "use in_stock, out_of_stock or on_request"})

    product = {
        "name": _clean(row["product_name"])[:200],
        "category": category,
        "brand": brand,
        "part_number": _clean(row.get("part_number"))[:80],
        "description": _clean(row.get("description")),
        "compatibility": "\n".join(p.strip() for p in _clean(row.get("compatibility")).split(";") if p.strip()),
        "specifications": _specs(_clean(row.get("specifications"))),
    }
    listing = {
        "sku": _clean(row.get("sku"))[:60],
        "condition": condition,
        "supplier_price": _decimal(row["supplier_price"], "supplier_price"),
        "quantity": _int(row.get("quantity"), "quantity", 0),
        "min_order_quantity": max(1, _int(row.get("min_order_quantity"), "min_order_quantity", 1)),
        "warranty": _clean(row.get("warranty"))[:120],
        "availability": availability,
    }
    return product, listing


def _error_text(exc: ValidationError) -> str:
    detail = exc.detail
    if isinstance(detail, dict):
        return "; ".join(f"{k}: {v[0] if isinstance(v, list) else v}" for k, v in detail.items())
    if isinstance(detail, list):
        return "; ".join(str(d) for d in detail)
    return str(detail)


def run_import(supplier, user, upload, dry_run: bool = False) -> dict:
    try:
        wb = load_workbook(upload, read_only=True, data_only=True)
    except Exception:
        raise ValidationError({"file": "Couldn't read this file. Upload the .xlsx template."})
    ws = wb["Products"] if "Products" in wb.sheetnames else wb.active
    rows = ws.iter_rows(values_only=True)
    header = [(_clean(h).replace("*", "").strip().lower()) for h in next(rows, [])]
    if "product_name" not in header:
        raise ValidationError({"file": "The first row must be the template's column headers."})

    categories = {}
    for c in Category.objects.filter(is_active=True):
        categories[c.slug.lower()] = c
        categories.setdefault(c.name.lower(), c)

    result = {"created": 0, "updated": 0, "matched_catalogue": 0, "skipped": 0, "errors": [], "dry_run": dry_run}
    for index, values in enumerate(rows, start=2):
        row = dict(zip(header, values))
        if not any(_clean(v) for v in values):
            continue
        name = _clean(row.get("product_name"))
        is_template_row = (index == 2 and name == COLUMNS[0][2]) or (
            index == 3 and name == "Oil filter" and _clean(row.get("sku")) == "OF-316" and not _clean(row.get("category"))
        )
        if is_template_row:
            result["skipped"] += 1
            continue
        if index > MAX_ROWS + 3:
            result["errors"].append({"row": index, "error": f"Only {MAX_ROWS} rows per import."})
            break
        try:
            with transaction.atomic():
                product_data, listing_data = _parse_row(row, categories)
                existing = (
                    supplier.listings.exclude(status=L.Status.ARCHIVED).filter(sku=listing_data["sku"]).first()
                    if listing_data["sku"] else None
                )
                if existing:
                    qty = listing_data.pop("quantity")
                    listing_data.pop("condition")  # condition changes go through the form (re-approval)
                    services.update_listing(existing, user, listing_data, None)
                    services.set_quantity(existing, qty, StockMovement.Reason.IMPORT, user, "Bulk import")
                    result["updated"] += 1
                else:
                    _, matched = services.create_listing(
                        supplier, user, listing_data, product_data, stock_reason=StockMovement.Reason.IMPORT
                    )
                    result["created"] += 1
                    result["matched_catalogue"] += int(matched)
                if dry_run:
                    transaction.set_rollback(True)
        except ValidationError as exc:
            result["errors"].append({"row": index, "error": _error_text(exc)})
        except Exception as exc:  # keep going; report the row
            result["errors"].append({"row": index, "error": str(exc)[:200]})
    return result
