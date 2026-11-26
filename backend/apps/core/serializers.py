from rest_framework import serializers

from .models import AuditLog, MarketplaceSettings


class MarketplaceSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketplaceSettings
        fields = [
            "default_markup_percent", "share_min_markup_percent", "default_low_stock_threshold", "currency", "delivery_fee",
            "free_delivery_threshold", "cash_on_delivery_enabled",
            "support_phone", "support_whatsapp", "support_email", "support_hours",
            "google_client_id",
            "updated_at",
        ]
        read_only_fields = ["currency", "updated_at"]

    def validate_google_client_id(self, value):
        value = value.strip()
        if value and not value.endswith(".apps.googleusercontent.com"):
            raise serializers.ValidationError("A Google client ID ends with .apps.googleusercontent.com")
        return value


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ["id", "actor_email", "action", "target_type", "target_id", "message", "data", "ip_address",
                  "created_at"]
