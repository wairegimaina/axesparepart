from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404, redirect
from django.utils import timezone
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.passwords import send_invite
from apps.core import storage
from apps.core.audit import audit
from apps.core.permissions import IsAdmin, IsSupplierMember, SupplierRolePermission
from apps.notifications.service import notify_admins, notify_supplier

from .models import BusinessCategory, Supplier, SupplierDocument, SupplierMember
from .serializers import (
    AdminSupplierCreateSerializer, AdminSupplierListSerializer, AdminSupplierSerializer, BusinessCategorySerializer, DocumentReviewSerializer,
    MemberInviteSerializer, MemberSerializer, SupplierDocumentSerializer,
    SupplierProfileSerializer, StatusChangeSerializer,
)

User = get_user_model()
R = SupplierMember.Role
PROFILE_EDITORS = {R.OWNER, R.MANAGER}


# --- Public -------------------------------------------------------------------


class BusinessCategoryListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = BusinessCategorySerializer
    queryset = BusinessCategory.objects.filter(is_active=True)
    pagination_class = None


# --- Supplier portal ----------------------------------------------------------


class SupplierProfileView(APIView):
    permission_classes = [SupplierRolePermission]

    def get_permissions(self):
        self.member_roles = {"*": PROFILE_EDITORS} if self.request.method in ("PATCH", "PUT") else {}
        self.action = None
        return super().get_permissions()

    def get(self, request):
        return Response(SupplierProfileSerializer(request.supplier).data)

    def patch(self, request):
        s = SupplierProfileSerializer(request.supplier, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class SupplierImageView(APIView):
    """POST multipart `file` to /logo/ or /cover/; DELETE removes it."""

    permission_classes = [SupplierRolePermission]
    member_roles = {"*": PROFILE_EDITORS}
    parser_classes = [MultiPartParser, FormParser]
    kind = "logo"

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose an image to upload."})
        supplier = request.supplier
        old = getattr(supplier, f"{self.kind}_public_id")
        stored = storage.upload_image(upload, f"suppliers/{supplier.id}/{self.kind}")
        setattr(supplier, f"{self.kind}_url", stored.url)
        setattr(supplier, f"{self.kind}_public_id", stored.public_id)
        supplier.save(update_fields=[f"{self.kind}_url", f"{self.kind}_public_id", "updated_at"])
        storage.delete_file(old)
        return Response({"url": stored.url})

    def delete(self, request):
        supplier = request.supplier
        storage.delete_file(getattr(supplier, f"{self.kind}_public_id"))
        setattr(supplier, f"{self.kind}_url", "")
        setattr(supplier, f"{self.kind}_public_id", "")
        supplier.save(update_fields=[f"{self.kind}_url", f"{self.kind}_public_id", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class SupplierDocumentViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    permission_classes = [SupplierRolePermission]
    member_roles = {"create": PROFILE_EDITORS, "destroy": PROFILE_EDITORS}
    serializer_class = SupplierDocumentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    pagination_class = None

    def get_queryset(self):
        return self.request.supplier.documents.all()

    def perform_create(self, serializer):
        upload = serializer.validated_data.pop("file")
        supplier = self.request.supplier
        stored = storage.upload_private_document(upload, f"suppliers/{supplier.id}/documents")
        doc = serializer.save(
            supplier=supplier, original_name=upload.name[:255], public_id=stored.public_id,
            file_format=stored.format, size_bytes=stored.bytes, uploaded_by=self.request.user,
        )
        if supplier.status != Supplier.Status.PENDING:
            notify_admins("document_uploaded", f"{supplier.name} uploaded a document",
                          doc.get_doc_type_display(), f"/admin/suppliers/{supplier.id}", email=False)

    def perform_destroy(self, doc):
        if doc.status == SupplierDocument.Status.ACCEPTED:
            raise ValidationError("Accepted documents can't be deleted. Contact the marketplace admin.")
        storage.delete_file(doc.public_id, doc.file_format, private=True)
        doc.delete()

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        return document_response(self.get_object())


def document_response(doc: SupplierDocument):
    url = storage.private_document_url(doc.public_id, doc.file_format)
    if url:
        return redirect(url)
    path = storage.local_private_path(doc.public_id, doc.file_format)
    if not path.exists():
        return Response({"detail": "File missing."}, status=status.HTTP_404_NOT_FOUND)
    return FileResponse(path.open("rb"), as_attachment=False, filename=doc.original_name)


class SupplierMemberViewSet(viewsets.ModelViewSet):
    """Company team. Owners invite and manage; everyone can see the list."""

    permission_classes = [SupplierRolePermission]
    member_roles = {"create": {R.OWNER}, "update": {R.OWNER}, "partial_update": {R.OWNER}, "destroy": {R.OWNER}}
    serializer_class = MemberSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        return self.request.supplier.members.select_related("user")

    def create(self, request, *args, **kwargs):
        s = MemberInviteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            user = User.objects.create_user(
                email=s.validated_data["email"], full_name=s.validated_data["full_name"], role=User.Role.SUPPLIER,
            )
            user.set_unusable_password()
            user.save(update_fields=["password"])
            member = SupplierMember.objects.create(supplier=request.supplier, user=user, role=s.validated_data["role"])
        send_invite(user, request.supplier.name, request.user.full_name)
        return Response(MemberSerializer(member).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        member = serializer.instance
        if member.role == R.OWNER:
            raise ValidationError("The owner's role can't be changed here.")
        if serializer.validated_data.get("role") == R.OWNER:
            raise ValidationError("There can only be one owner.")
        serializer.save()

    def perform_destroy(self, member):
        if member.role == R.OWNER:
            raise ValidationError("The owner can't be removed.")
        member.is_active = False
        member.save(update_fields=["is_active", "updated_at"])
        member.user.is_active = False
        member.user.save(update_fields=["is_active"])


# --- Administrator ------------------------------------------------------------


class AdminSupplierViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    http_method_names = ["get", "patch", "post"]
    search_fields = ["name", "registration_number", "business_email", "business_phone", "members__user__email"]
    filterset_fields = ["status", "is_verified", "county"]
    ordering_fields = ["created_at", "name"]

    def get_queryset(self):
        qs = Supplier.objects.prefetch_related("members__user", "business_categories", "documents")
        if self.action == "list":
            qs = qs.annotate(
                document_count=Count("documents", distinct=True),
                pending_documents=Count("documents", filter=Q(documents__status="pending"), distinct=True),
            ).order_by("-created_at")
        return qs

    def get_serializer_class(self):
        return AdminSupplierListSerializer if self.action == "list" else AdminSupplierSerializer

    def create(self, request, *args, **kwargs):
        """Onboard a supplier: create the company (approved) and invite its owner by email."""
        s = AdminSupplierCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with transaction.atomic():
            owner = User.objects.create_user(email=d["owner_email"], full_name=d["owner_name"],
                                             phone=d.get("owner_phone", ""), role=User.Role.SUPPLIER)
            owner.set_unusable_password()
            owner.save(update_fields=["password"])
            supplier = Supplier.objects.create(
                name=d["company_name"], business_phone=d["business_phone"],
                business_email=d.get("business_email") or d["owner_email"], county=d["county"],
                town=d.get("town", ""), physical_address=d.get("physical_address", ""),
                registration_number=d.get("registration_number", ""), tax_pin=d.get("tax_pin", ""),
                status=Supplier.Status.APPROVED, reviewed_by=request.user, reviewed_at=timezone.now(),
            )
            supplier.business_categories.set(d.get("business_category_ids", []))
            SupplierMember.objects.create(supplier=supplier, user=owner, role=R.OWNER)
            audit(request, "supplier.onboarded", supplier, owner=owner.email)
        send_invite(owner, supplier.name, request.user.full_name)
        return Response(AdminSupplierSerializer(self.get_queryset().get(pk=supplier.pk)).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="resend-invite")
    def resend_invite(self, request, pk=None):
        """Email the owner a fresh set-password link (e.g. the first one expired)."""
        supplier = self.get_object()
        owner = supplier.members.filter(role=R.OWNER).select_related("user").first()
        if owner is None:
            raise ValidationError("This company has no owner account.")
        send_invite(owner.user, supplier.name, request.user.full_name)
        audit(request, "supplier.invite_resent", supplier, owner=owner.user.email)
        return Response({"sent_to": owner.user.email})

    def perform_update(self, serializer):
        supplier = serializer.save()
        audit(self.request, "supplier.edited", supplier, fields=sorted(self.request.data.keys()))

    def _set_status(self, request, new_status, title, verb):
        supplier = self.get_object()
        s = StatusChangeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        reason = s.validated_data.get("reason", "")
        if new_status in (Supplier.Status.REJECTED, Supplier.Status.SUSPENDED) and not reason:
            raise ValidationError({"reason": "Give the supplier a reason."})
        supplier.set_status(new_status, request.user, reason)
        supplier.save()
        audit(request, f"supplier.{verb}", supplier, reason)
        notify_supplier(supplier, f"supplier_{verb}", title, reason, "/supplier", roles=[R.OWNER, R.MANAGER])
        return Response(AdminSupplierSerializer(supplier).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._set_status(request, Supplier.Status.APPROVED,
                                "Your company has been approved on Axe Spare Parts", "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._set_status(request, Supplier.Status.REJECTED, "Your supplier application was not approved",
                                "rejected")

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        return self._set_status(request, Supplier.Status.SUSPENDED, "Your supplier account has been suspended",
                                "suspended")

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        supplier = self.get_object()
        if not supplier.is_approved:
            raise ValidationError("Approve the supplier before giving the verified badge.")
        if not supplier.documents.filter(status=SupplierDocument.Status.ACCEPTED).exists():
            raise ValidationError("Accept at least one verification document first.")
        supplier.is_verified, supplier.verified_at = True, timezone.now()
        supplier.save(update_fields=["is_verified", "verified_at", "updated_at"])
        audit(request, "supplier.verified", supplier)
        notify_supplier(supplier, "supplier_verified", "You're now a Verified Supplier", link="/supplier",
                        roles=[R.OWNER, R.MANAGER])
        return Response(AdminSupplierSerializer(supplier).data)

    @action(detail=True, methods=["post"])
    def unverify(self, request, pk=None):
        supplier = self.get_object()
        supplier.is_verified, supplier.verified_at = False, None
        supplier.save(update_fields=["is_verified", "verified_at", "updated_at"])
        audit(request, "supplier.unverified", supplier, request.data.get("reason", ""))
        return Response(AdminSupplierSerializer(supplier).data)


class AdminDocumentViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    serializer_class = SupplierDocumentSerializer
    queryset = SupplierDocument.objects.select_related("supplier")

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        doc = self.get_object()
        audit(request, "document.viewed", doc)
        return document_response(doc)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        doc = self.get_object()
        s = DocumentReviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        doc.status, doc.review_note = s.validated_data["status"], s.validated_data.get("note", "")
        doc.reviewed_by, doc.reviewed_at = request.user, timezone.now()
        doc.save()
        audit(request, f"document.{doc.status}", doc, doc.review_note)
        if doc.status == SupplierDocument.Status.REJECTED:
            notify_supplier(doc.supplier, "document_rejected", f"{doc.get_doc_type_display()} was not accepted",
                            doc.review_note, "/supplier/profile/documents", roles=[R.OWNER, R.MANAGER])
        return Response(SupplierDocumentSerializer(doc).data)


class AdminBusinessCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = BusinessCategorySerializer
    queryset = BusinessCategory.objects.all()
    pagination_class = None
    http_method_names = ["get", "post", "patch"]
