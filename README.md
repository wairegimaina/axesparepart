# Axe Spare Parts

Multi-vendor motorcycle spare parts marketplace (boda boda and other motorbikes). Suppliers manage their own catalogue and stock behind the scenes; customers only ever see the Axe store and part brands, never supplier names;
the marketplace verifies suppliers, approves listings, sets customer prices and owns the
customer relationship.

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui (Base UI), React Router, TanStack Query, React Hook Form + Zod, Recharts |
| Backend | Django 6.1, Django REST Framework, PostgreSQL, Celery (Redis optional) |
| Files | Cloudinary: public images, and supplier documents as *authenticated* assets behind short-lived signed URLs |
| Hosting | Render (see `render.yaml`) |

## What's built (phases 1–13 of the plan)

- **Auth & roles**: customers, suppliers (owner / manager / inventory / sales), admins. Session cookies + CSRF; login history; password reset; team invites.
- **Supplier onboarding**: suppliers don't sign themselves up. Admins add them (Admin → Suppliers → Add supplier); the owner gets an email to set a password. Admins can suspend/re-approve, resend the invite, and award the verified badge once a document is accepted.
- **Company profile** (admin-only; there are no public storefronts): Markdown "about", brands, warranty, logo/cover, industries, private verification documents.
- **Catalogue & listings**: one canonical `Product` per part (dedupe by brand + normalised part number), many `SupplierListing`s. Draft → pending → published / rejected, with full approval history. Stock, price, MOQ, warranty and availability change without re-approval; condition or catalogue-detail changes need re-approval.
- **Pricing**: customer price = supplier price + marketplace markup (set in the admin panel) or an admin override. Supplier prices never leave the admin and supplier APIs.
- **Inventory**: inline bulk stock/price editing, low-stock alerts, stock movement log, Excel import (template download, dry run, per-row errors, upsert by SKU).
- **Customer browsing**: search by name, part number (any formatting) or bike model; category tree, brand, condition, in-stock filters; product page comparing every supplier's offer.
- **Admin portal**: supplier review & documents, approval queue with price check against other suppliers, catalogue/categories/brands, settings, audit log.

- **Cart & checkout**: cart kept in the browser (prices always re-quoted by the server), saved addresses, free-delivery threshold. Stock is reserved at checkout with row locks, so the last unit can't be sold twice.
- **Orders**: one customer `Order` splits into one `SupplierOrder` per supplier. Admin confirms each order by phone (and can adjust the delivery fee); only then do suppliers see it. Suppliers accept → process → mark ready, or reject with a reason. Admin marks each collected, can move rejected items to another supplier's offer of the same part (customer keeps their price) or remove them, then dispatches (courier + tracking), marks delivered, records payments and completes. Every step lands on a timeline with per-audience visibility.
- **Customer account**: order list, order tracking with progress steps, cancel while unconfirmed, addresses.
- **Supplier analytics**: sales at supplier prices, open order value, fulfilment rate, monthly chart.

- **Deliveries**: fee and delivery time per county (admin → Settings → Delivery by county; other counties use the standard fee, and a county can be switched off). Addresses pick from Kenya's 47 counties. Dispatch records courier/rider, phone, tracking number and expected date; a failed delivery sends the order back to "ready to dispatch". Admin → Deliveries lists orders ready to go and out for delivery (late ones flagged).
- **Payments & refunds**: admins record payments and refunds (cash, bank). Orders show refund due when we hold more than the order costs (cancelled after payment, item removed). Admin → Payments shows money received, refunded, still to collect, and refunds due. Customers can print a receipt/invoice from their order.
- **Sign in with Google**: "Continue with Google" on sign-in and create-account. Set the OAuth Web client ID in Admin → Settings (empty hides the button); add the site URL (and http://localhost:5173 for dev) under Authorised JavaScript origins in Google Cloud Console. New emails become customer accounts; existing customers and supplier staff sign straight in; admin accounts must use their password. The backend checks the Google ID token with `google-auth` (`POST /api/auth/google/`).
- **Team & orders staff**: Admin → Team adds admin accounts (set-password email). *Orders staff* (callers) only see Dashboard, Orders, Deliveries, Payments (no supplier payouts), Help requests and Customers; the API also blocks everything else, never returns supplier costs or margins to them, and keeps refunds with full admins.
- **Confirmation calls**: the dashboard's "Call these customers" list puts never-called orders first, then the longest-ago attempt. On an order, "No answer" logs a missed call (customer is told we'll call again); "Confirm order" needs a five-point call checklist ticked.
- **Help & support**: customers and supplier teams open help requests (optionally linked to their own order), chat with admins, and get notified of replies. Supplier requests are shared by the whole team. Admin → Help requests: inbox by status, assign, priority, internal notes, reply-and-resolve. Public `/help` page shows phone, WhatsApp, email and hours set in Admin → Settings.
- **Notifications**: in-app bell for customers, suppliers and admins; branded HTML emails; each user can turn email groups off (orders, product approvals, help replies) in Account settings.
- **Reports** (Admin → Reports): sales (revenue, parts margin, delivery fees, average order, cancellation rate, by day/month, payment method, county), top products and categories, supplier performance (fulfilment rate, time to accept/ready, sales, margin, balance owed), top customers. Any period; every table exports to CSV (Excel-safe).
- **Supplier payouts**: suppliers earn their price once an order is collected from them. Admin → Payments → Supplier payouts lists what's owed; each supplier has a statement where admins record payouts (suppliers add bank details in their profile). Suppliers see the same statement under Earnings, with CSV export.
- **Offers**: a supplier opens a published product and clicks *Run an offer* (percentage off, optional name and end date). It waits in Admin → Product approvals → Offers; once approved, customers see it on the home page (Offers banner), on product cards (−% badge, old price crossed out) and under the *On offer* filter. The supplier funds the discount (their price drops by the same percentage), so the marketplace margin is unchanged. Customers still never see which supplier it is.
- **Checkout**: customers don't choose a payment method; new orders are *To be agreed* and how they pay is settled on the confirmation call (the admin then records the actual payment, cash or bank). Customer pages, receipts and the product page never mention cash on delivery. Customers pick county and town (with *Other* for unlisted places, list in `backend/apps/deliveries/towns.py`). Checkout charges the parts only; the delivery fee is agreed on the confirmation call and set when the order is confirmed (defaults to the county rate).
- **Product photo backgrounds**: product photos (supplier and admin uploads) are cut out of their background on the server with the open-source rembg ISNet model (`apps/core/background.py`), trimmed to the part and saved as transparent WebP, so parts sit cleanly in cards and the gallery. If a cut-out looks unreliable (busy scene, faded scan) or the model fails, the original photo is kept. Uploaders can untick *Remove backgrounds*. The ~170 MB model is fetched by `python manage.py download_background_model` (Render runs it at build time; locally it downloads on first use into `backend/.models`). Each worker that handles uploads uses ~600 MB, so the API runs on Render's Standard plan. Turn it off with `BACKGROUND_REMOVAL=false`.
- **Branding**: blue theme from the client's AXE artwork. Full logo `frontend/public/logo.webp`; the site uses the side-by-side version (`logo-mark.webp` + `logo-word.webp`).

Payments are recorded by an admin for now (no gateway). M-Pesa can be added later as a provider in `apps/payments` that records `Payment` rows.

Not built yet: online payment gateway, SMS, returns, reviews.

## Privacy rules (enforced in the API, covered by tests)

Customers never see supplier price, contact details, registration numbers or documents. Suppliers
only see their own listings, documents and team. Documents are downloadable only by the owning
supplier's team and admins, and every admin view is written to the audit log.

## Local development

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # set SECRET_KEY; CLOUDINARY_URL optional locally
createdb axespareparts
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed --admin you@example.com   # add --demo for sample suppliers
.venv/bin/python manage.py runserver

# Frontend (proxies /api to :8000)
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Without `CLOUDINARY_URL`, uploads go to `backend/media` and `backend/private_media`.
Without `REDIS_URL`, Celery tasks (emails) run inline and dev emails print to the console.

API docs: http://localhost:8000/api/docs/

Tests: `cd backend && .venv/bin/python manage.py test apps`

## Deploying to Render

1. Push to GitHub, then **New → Blueprint** and pick this repo.
2. Set `CLOUDINARY_URL` on `axespareparts-api` (and Brevo SMTP vars when ready).
3. If Render assigns different hostnames, update the rewrite destinations and URL env vars in `render.yaml`.
4. Create the first admin from the API service shell: `python manage.py seed --admin you@example.com`.
