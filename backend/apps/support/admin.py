from django.contrib import admin

from .models import Ticket, TicketMessage

admin.site.register(Ticket, list_display=["number", "subject", "status", "opened_by", "supplier", "last_message_at"])
admin.site.register(TicketMessage, list_display=["ticket", "author", "from_staff", "internal", "created_at"])
