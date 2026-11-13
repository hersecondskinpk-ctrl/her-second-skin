# Her Second Skin PK — v9 Stable Implementation Scope
Updated: 2026-10-27
Status: Approved scope; not a claim that every feature is implemented.
Delivery instruction: Do not deliver a ZIP until the owner requests the final file.

## Protect existing operations
- Before migration/backfill: copy SQLite database and uploads; verify restore.
- Incremental additive migrations; do not drop existing tables or lose order/stock history.
- Preserve admin login, existing product IDs/SKUs, orders, checkout, inventory audit, and homepage branding.
- All stock-changing paths run in transactions and leave auditable adjustments.

## 1. Smart Size and Cup Selector — P0
- Admin numeric sizes: 22, 31, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 58.
- Alpha sizes: S, M, L, XL, XXL, XXXL (display-friendly Small/Medium/Large/etc.).
- Cup sizes: A, B, C, D, FF; optional/not-applicable for products without cups.
- Admin bulk create: choose colour, multi-select band sizes and cup sizes, preview cross product, edit each SKU/quantity before save; reject duplicate colour-size-cup triplets and duplicate SKU.
- Database: variant cup_size column with backward-compatible migration; preserve original variants (nullable cup) and unambiguous selection/IDs.
- PDP: show colour, band/alpha size, cup selectors as applicable; disable unavailable combinations and show remaining stock; include contextual size guide. Cart/order snapshots preserve selected cup and variant ID.
- Test: e.g. Black/36/B vs Black/36/C subtract separate stock; existing products load; restock works.

## 2. Low Stock & Order Management — P0
- Variant-level threshold configurable per SKU or global fallback; admin alerts and filter out-of-stock.
- Order statuses: pending, confirmed, processing/packed, shipped, delivered, cancelled, with timestamped transitions and permissions.
- Admin order detail view, history, optional tracking number, inventory adjustment once per event. Never double deduct.
- Test cancelled order restocks exactly once and shipped-to-delivered reporting correct.

## 3. Mobile Checkout Improvements — P0
- Guest checkout without forced account, COD option, delivery fee calculation clearly shown before confirmation.
- Validation for recipient, Pakistani phone, address/city; large tap targets, keyboard-friendly fields and accessible errors.
- Stock verified again server-side on submit, idempotent order creation, explicit order number and confirmation.
- Display only verified operational promises: shipping timings, delivery areas, returns/exchange rules must match business policy.

## 4. Returns & Exchanges — P1
- Returns/exchanges records: order item and quantity, reason, status, replacement SKU/variant, refund/adjustment where applicable, staff timestamps.
- Admin workflows: request -> review -> receive/inspect -> exchange/refund/decline.
- Stock actions depend on inspect/restock eligibility; no automatic resale of damaged/hygiene-sensitive items.
- Ensure replacement stock is checked and deducted exactly once and finance totals avoid double counting.

## 5. Sales & Profit Dashboard — P1
- Date filters (day/week/month/custom), gross/net merchandise, discounts, delivery collected, COD outstanding, returns/refunds, COGS and estimated profit.
- Orders by status; best-selling SKUs, colours, sizes and cups; export CSV.
- Label profit as estimate; exclude unrecovered fees/marketing costs unless explicitly tracked; adjust for returned items.
- Reconcile dashboard totals to transactional orders/sales data.

## 6. Reviews & Wishlist — P2
- Wishlists: guest local browser storage; optionally account-linked later; persist and indicate unavailable items.
- Reviews: moderated verified-purchase tagging only with actual order match; 1-5 stars, text, spam limits, admin approve/reject.
- Avoid publishing sensitive phone/email; sanitize review fields and images.

## 7. Homepage Section Builder — P2
- Admin can rearrange predefined homepage sections using drag/drop AND keyboard/up-down controls.
- Persist section order, visibility and content settings; offer Preview, Publish, Restore Defaults.
- Manage homepage reels/deals, second-screen banner and tagline `Comfort, Confident, and Elegance.`
- Validate banner aspect ratios, upload sizes and allowed media types; limit active reels and avoid broken placeholders.
- Preserve stable mobile section rendering.

## Implementation order / gates
1. Inspect existing code and snapshot DB; define migrations and tests.
2. P0: variant model, admin bulk add, PDP/cart/checkout, inventory + order flow.
3. P1: returns/exchanges and reconciled reporting.
4. P2: review/wishlist validation, homepage ordering, responsive UX.
5. Regression: add/edit archive product, concurrent orders, low stock, cancellation, uploads, admin auth, malformed URL, mobile viewport, payment wording, restart/migration, backups.

## Current code audit notes (working copy at 2026-10-27)
- Present: size guide on product page, local-storage wishlist, review APIs, low-stock dashboard API, order statuses, sales/profit metrics, homepage settings/reel/banner interface.
- Not yet established as complete: separate cup_size database field and end-to-end cup selection, exchange ledger, homepage SECTION reordering, comprehensive guest/COD mobile regression.
- Do not advertise all seven features as built until each passes end-to-end tests.
