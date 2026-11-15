from rest_framework import serializers

from .models import Ticket, TicketMessage


class MessageSerializer(serializers.ModelSerializer):
    """Requester view: staff appear as 'Axe Support', internal notes are filtered out before this."""

    author = serializers.SerializerMethodField()

    class Meta:
        model = TicketMessage
        fields = ["id", "author", "from_staff", "body", "created_at"]

    def get_author(self, obj):
        if obj.from_staff:
            return "Axe Support"
        return obj.author.full_name if obj.author else "Deleted user"


class AdminMessageSerializer(serializers.ModelSerializer):
    author = serializers.CharField(source="author.full_name", default="Deleted user")

    class Meta:
        model = TicketMessage
        fields = ["id", "author", "from_staff", "internal", "body", "created_at"]


class TicketListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    order_number = serializers.CharField(source="order.number", default=None, read_only=True)
    supplier_order_number = serializers.CharField(source="supplier_order.number", default=None, read_only=True)

    class Meta:
        model = Ticket
        fields = ["number", "subject", "category", "category_display", "status", "status_display", "order_number",
                  "supplier_order_number", "last_message_at", "created_at"]


class TicketSerializer(TicketListSerializer):
    messages = serializers.SerializerMethodField()

    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + ["messages"]

    def get_messages(self, obj):
        return MessageSerializer([m for m in obj.messages.all() if not m.internal], many=True).data


class TicketCreateSerializer(serializers.Serializer):
    subject = serializers.CharField(max_length=150)
    category = serializers.ChoiceField(choices=Ticket.Category.choices, default=Ticket.Category.OTHER)
    body = serializers.CharField(max_length=5000)
    order_number = serializers.CharField(required=False, allow_blank=True, max_length=24)


class ReplySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)


class AdminReplySerializer(ReplySerializer):
    internal = serializers.BooleanField(default=False)
    resolve = serializers.BooleanField(default=False)


class AdminTicketListSerializer(TicketListSerializer):
    requester = serializers.SerializerMethodField()
    assigned_to = serializers.CharField(source="assigned_to.full_name", default=None, read_only=True)
    assigned_to_id = serializers.IntegerField(read_only=True)
    priority_display = serializers.CharField(source="get_priority_display", read_only=True)

    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + ["requester", "assigned_to", "assigned_to_id", "priority",
                                                     "priority_display"]

    def get_requester(self, obj):
        u = obj.opened_by
        if obj.supplier_id:
            return {"kind": "supplier", "name": obj.supplier.name, "person": u.full_name, "email": u.email,
                    "phone": obj.supplier.business_phone or u.phone, "id": obj.supplier_id}
        return {"kind": "customer", "name": u.full_name, "person": u.full_name, "email": u.email, "phone": u.phone,
                "id": u.id}


class AdminTicketSerializer(AdminTicketListSerializer):
    messages = AdminMessageSerializer(many=True, read_only=True)

    class Meta(AdminTicketListSerializer.Meta):
        fields = AdminTicketListSerializer.Meta.fields + ["messages"]


class AdminTicketUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = ["status", "priority", "assigned_to"]

    def validate_assigned_to(self, user):
        if user is not None and not user.is_marketplace_admin:
            raise serializers.ValidationError("Only administrators can be assigned.")
        return user
