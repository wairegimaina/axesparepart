from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .groups import GROUPS
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "body", "link", "read_at", "created_at"]


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer
    filter_backends = []

    def get_queryset(self):
        qs = self.request.user.notifications.all()
        if self.request.query_params.get("unread") in ("1", "true"):
            qs = qs.filter(read_at__isnull=True)
        return qs

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        return Response({"count": request.user.notifications.filter(read_at__isnull=True).count()})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        self.get_queryset().filter(pk=pk, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=False, methods=["post"])
    def read_all(self, request):
        request.user.notifications.filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=False, methods=["get", "patch"])
    def preferences(self, request):
        """Which notification groups are emailed. In-app notifications always appear."""
        user = request.user
        if request.method == "PATCH":
            off = set(user.email_opt_out or [])
            for group, on in (request.data or {}).items():
                if group in GROUPS and isinstance(on, bool):
                    (off.discard if on else off.add)(group)
            user.email_opt_out = sorted(off)
            user.save(update_fields=["email_opt_out"])
        relevant = {"customer": ["orders", "support"], "supplier": ["orders", "catalogue", "support"],
                    "admin": ["orders", "catalogue", "support"]}[user.role]
        return Response([{"group": g, "label": GROUPS[g]["label"], "email": g not in (user.email_opt_out or [])}
                         for g in relevant])
