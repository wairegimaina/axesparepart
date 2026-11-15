from datetime import datetime, time, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError


def parse_period(params):
    """?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, local dates). Defaults to the last 30 days."""
    today = timezone.localdate()
    try:
        end = datetime.strptime(params["to"], "%Y-%m-%d").date() if params.get("to") else today
        start = datetime.strptime(params["from"], "%Y-%m-%d").date() if params.get("from") else end - timedelta(days=29)
    except ValueError:
        raise ValidationError({"from": "Use dates like 2026-11-01."})
    if start > end:
        raise ValidationError({"from": "The start date is after the end date."})
    if (end - start).days > 3660:
        raise ValidationError({"from": "Pick a period of 10 years or less."})
    tz = timezone.get_current_timezone()
    return start, end, datetime.combine(start, time.min, tz), datetime.combine(end + timedelta(days=1), time.min, tz)
