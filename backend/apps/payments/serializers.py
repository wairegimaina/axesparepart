from rest_framework import serializers

from .models import Payment, Refund


class _OrderRef(serializers.Serializer):
    def to_representation(self, order):
        return {"number": order.number, "customer_name": order.customer.full_name, "total": str(order.total)}


class AdminPaymentRowSerializer(serializers.ModelSerializer):
    order = _OrderRef()
    method_display = serializers.CharField(source="get_method_display")
    recorded_by = serializers.CharField(source="recorded_by.full_name", default=None)

    class Meta:
        model = Payment
        fields = ["id", "order", "method", "method_display", "amount", "reference", "note", "received_at", "recorded_by"]


class AdminRefundRowSerializer(serializers.ModelSerializer):
    order = _OrderRef()
    method_display = serializers.CharField(source="get_method_display")
    recorded_by = serializers.CharField(source="recorded_by.full_name", default=None)

    class Meta:
        model = Refund
        fields = ["id", "order", "method", "method_display", "amount", "reference", "reason", "refunded_at",
                  "recorded_by"]
