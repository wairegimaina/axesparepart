from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """
    Marketplace admins. Orders staff (a limited admin) only get views marked `orders_staff = True`,
    minus any actions listed in `orders_staff_denied`.
    """

    message = "Administrator access required."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.is_marketplace_admin):
            return False
        if user.is_orders_staff:
            allowed = getattr(view, "orders_staff", False) and getattr(view, "action", None) not in getattr(
                view, "orders_staff_denied", ())
            if not allowed:
                self.message = "Only full admins can do this."
            return allowed
        return True


COST_KEYS = {"supplier_cost", "supplier_unit_price", "supplier_line_total", "margin", "parts_margin", "supplier_price"}


def strip_costs(data):
    """Removes supplier prices and margins from a response, for orders staff."""
    if isinstance(data, dict):
        return {k: strip_costs(v) for k, v in data.items() if k not in COST_KEYS}
    if isinstance(data, list):
        return [strip_costs(v) for v in data]
    return data


class OrdersStaffView:
    """Mixin: orders staff may use this view, and never see supplier costs in its responses."""

    orders_staff = True

    def finalize_response(self, request, response, *args, **kwargs):
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_orders_staff", False) and hasattr(response, "data"):
            response.data = strip_costs(response.data)
        return super().finalize_response(request, response, *args, **kwargs)


class IsCustomer(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == user.Role.CUSTOMER)


class IsSupplierMember(BasePermission):
    """The user belongs to a supplier company. Sets request.supplier and request.membership."""

    message = "Supplier account required."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        membership = getattr(user, "supplier_membership", None)
        if membership is None or not membership.is_active:
            return False
        request.membership = membership
        request.supplier = membership.supplier
        return True


class SupplierRolePermission(IsSupplierMember):
    """Restrict a supplier view to some member roles. Set `allowed_roles` on the view per action."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        roles_by_action = getattr(view, "member_roles", None) or {}
        allowed = roles_by_action.get(getattr(view, "action", None), roles_by_action.get("*"))
        if allowed is None:
            return True
        if request.membership.role in allowed:
            return True
        self.message = "Your role in this company cannot perform this action."
        return False


class IsApprovedSupplier(IsSupplierMember):
    message = "Your company must be approved by the marketplace before doing this."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.supplier.is_approved
