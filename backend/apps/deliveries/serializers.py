from rest_framework import serializers

from .models import DeliveryRate


class DeliveryRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryRate
        fields = ["id", "county", "fee", "days_min", "days_max", "is_active", "updated_at"]

    def validate(self, attrs):
        lo = attrs.get("days_min", getattr(self.instance, "days_min", 1))
        hi = attrs.get("days_max", getattr(self.instance, "days_max", 3))
        if hi < lo:
            raise serializers.ValidationError({"days_max": "Must be at least the minimum days."})
        if attrs.get("fee") is not None and attrs["fee"] < 0:
            raise serializers.ValidationError({"fee": "Can't be negative."})
        return attrs
