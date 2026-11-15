from html import escape

from django.conf import settings

BRAND_NAVY = "#0b1b3f"
BRAND_BLUE = "#1d4fd8"
BRAND_YELLOW = "#facc15"


def render_html(title: str, body: str, link: str = "", button: str = "Open") -> str:
    """Simple branded email that renders in common clients (inline styles, table layout)."""
    paragraphs = "".join(
        f'<p style="margin:0 0 12px;line-height:1.5">{escape(p).replace(chr(10), "<br>")}</p>'
        for p in body.split("\n\n") if p.strip()
    )
    url = f"{settings.FRONTEND_URL}{link}" if link and link.startswith("/") else link
    cta = (
        f'<p style="margin:20px 0 0"><a href="{escape(url)}" style="display:inline-block;background:{BRAND_BLUE};'
        f'color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">{escape(button)}</a></p>'
        if url else ""
    )
    return f"""<!doctype html><html><body style="margin:0;background:#f1f5fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:{BRAND_NAVY};padding:18px 24px;border-bottom:4px solid {BRAND_YELLOW}">
<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px">AXE</span>
<span style="color:{BRAND_YELLOW};font-size:11px;font-weight:700;letter-spacing:2px;margin-left:8px">GENUINE SPARE PARTS</span></td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 14px;font-size:19px">{escape(title)}</h1>{paragraphs}{cta}</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">Axe Genuine Spare Parts · You can choose which emails you get in your account settings.</td></tr>
</table></td></tr></table></body></html>"""
