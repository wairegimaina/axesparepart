from rest_framework import viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit
from apps.core.models import MarketplaceSettings
from apps.core.permissions import IsAdmin

from .counties import COUNTIES
from .towns import TOWNS
from .models import DeliveryRate
from .serializers import DeliveryRateSerializer


class CountyListView(APIView):
    """Every county with its delivery fee, time and main towns, for the address form and checkout."""

    permission_classes = [AllowAny]

    def get(self, request):
        s = MarketplaceSettings.load()
        rates = {r.county: r for r in DeliveryRate.objects.all()}
        rows = []
        for c in COUNTIES:
            r = rates.get(c)
            rows.append({
                "county": c,
                "fee": str(r.fee if r else s.delivery_fee),
                "days_min": r.days_min if r else None,
                "days_max": r.days_max if r else None,
                "available": r.is_active if r else True,
                "towns": sorted(TOWNS.get(c, [])),
            })
        return Response(rows)


class AdminDeliveryRateViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = DeliveryRateSerializer
    queryset = DeliveryRate.objects.all()
    pagination_class = None
    filter_backends = []
    http_method_names = ["get", "post", "patch", "delete"]

    def perform_create(self, serializer):
        rate = serializer.save()
        audit(self.request, "delivery_rate.created", rate, rate.county, fee=str(rate.fee))

    def perform_update(self, serializer):
        rate = serializer.save()
        audit(self.request, "delivery_rate.updated", rate, rate.county, fee=str(rate.fee), active=rate.is_active)

    def perform_destroy(self, instance):
        audit(self.request, "delivery_rate.deleted", instance, instance.county)
        instance.delete()
