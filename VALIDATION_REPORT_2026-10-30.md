# Her Second Skin PK v9 — Render Testing Release Validation
Date: 2026-10-30
Release status: **LOCAL TEST RELEASE / RELEASE CANDIDATE; NOT PRODUCTION-CERTIFIED**
Source: last saved development working copy with right-hand menu and white announcement ticker.

## Automated verification
- **110 PASS** API, SQLite, inventory, authentication, order, exchanges, privacy, uploads, persistence and restart checks (isolated synthetic SQLite database).
- **52 PASS** static inline JavaScript syntax, Desktop/Mobile local mocked UI interactions, rounded right-side menu, wishlist/cart, and silent reel thumbnails with full click-to-play player. Browser checks used an HTML `set_content` mock because Chromium navigation to local HTTP was blocked by environment policy; live server/browser E2E was NOT performed.
- **0 test assertion failures in the final rerun**. A passing check confirms the tested route or interaction, not all possible user journeys or security properties.

## Problems found and fixed during this audit
1. **Security: supplier cost exposed in public product listing API.** Public `/api/products` now omits `costPrice` and `cost_price`, retaining those fields for authenticated admin.
2. **Order quantity validation: decimal numbers silently rounded down.** Public order API now rejects fractional quantities and duplicate-line aggregate quantities exceeding 99.
3. **Public checkout request body too permissive.** `/api/orders` JSON body reduced to 64 KiB limit.
4. **Demo item checkout redirect** is not enabled: home page and inventory manager refuse outdated demo checkout where no live variant can be booked. Site checkout of inventory-managed variants saves directly to SQLite and shows an order number; no customer WhatsApp redirect.
5. **Wrong drawer side / ticker colour**, corrected in saved source prior to this audit. Desktop and mobile mock UI tests verify RIGHT-side menu, all 3 rounded drawers and reel interactions.

## Tests checked
- All 12 public HTML entry points & assets; blocked private backend source/DB paths.
- Authentication required for orders, exchange management, dashboard, sales and private evidence; wrong password fails; logout invalidates session; cross-site Origin rejected.
- Admin product creation; two cup sizes in separate SKU/stock; internal cost privacy.
- Invalid phone, invalid promo, fractional quantity, excess quantity and insufficient stock rejected.
- Accurate coupon totals and shipping calculation; idempotency key prevents duplicate order; cancelling restocks exactly once; delivered order final; sales row recorded.
- All 24 Urdu-English exchange policy entries, eligibility proof, 3-day deadline workflow, duplicate claim prevention, admin-only evidence and privacy-safe customer tracking.
- Exchange stages: initial review, returned, inspected, replacement reserved once, shipped, completed; invalid transitions rejected.
- Exchange modification, complaint, management response, pre-collection cancellation, tracking reference.
- Admin image upload stored at customised persistent upload path; saved SQLite and image survive app restart; SQLite integrity check `ok`.
- Frontend JavaScript syntax across all HTML pages; right-hand drawer placement, corner radius, close buttons, 9:16 mute/loop reels, player click enables sound/controls, Escape closes.

## NOT VERIFIED / still open (must not represent as working live)
1. **No production deployment, live browser E2E, physical Android/iPhone testing, real courier scan or payment processing.** Verify after controlled Render deployment.
2. **WhatsApp 5-step automation:** Meta message template acceptance, approved template names/parameters, webhook signature, opted-in recipient, 1-hour scheduler, published Flow, correct production phone ID and sender-vs-admin number all require live verification. The current automation's default template names do not match all submitted `*_v1` Meta templates. Set `WHATSAPP_AUTOMATION_ENABLED=0` until verified; this release must not claim automatic customer/admin WhatsApp messaging works.
3. **Courier tracking is not GPS or courier API polling.** Exchange/order milestones are locally stored and refreshed; only a manually supplied courier URL is available.
4. **Refunds are recorded in admin but are not actually paid by software.** Process JazzCash/Easypaisa/bank payout externally and record confirmation accurately.
5. **OTP for sensitive refund/payment changes has no connected SMS/verification provider.** Keep sensitive changes admin-controlled and independently verified before payment.
6. **Homepage drag-and-drop section reordering** and additional wishlist/review/mobile refinements were requested but not delivered as proven, production-ready modules.
7. **Category concept art is not verified inventory imagery**; upload real authorised product/category pictures via admin, remove sample listings before launch.
8. **Data preservation only works if persistent disk/volume and exact path environment variables are configured.** Without them Render free instance redeploy/restart loses SQLite files and uploads. External offsite backup/restore drill not verified.
9. **Backup existing database and uploads and test restore** BEFORE using this code on an existing production/test instance containing orders. Do not blindly overwrite or delete existing persistent data. Migrations are designed to add data structures but cannot substitute for a backup.
10. **Full security assessment (external penetration, performance/load, abuse/rate limits, accessibility, cross-device browsers, live domain HTTPS, user acceptance)** still requires real deployment testing and further specialist review.

## Release instructions
- Treat ZIP as a GitHub/Render **testing candidate**, NOT a claim of final live readiness.
- `npm start` runs Node 22.13+ with native `node:sqlite`; no npm package install is needed for the backend.
- Set `ADMIN_PASSWORD` (strong), `COOKIE_SECURE=1` for HTTPS, `HOST=0.0.0.0`, `PUBLIC_BASE_URL`, `WHATSAPP_AUTOMATION_ENABLED=0` for initial tests; `HSS_DATABASE_PATH` and `HSS_UPLOAD_DIR` should point inside persistent mounted storage.
- After deploy: check `/api/health`, login, create a fake test product, checkout, cancel/restock, exchange submit/track, upload photo, redeploy, verify persistence. NEVER test live payment/refund without real accounting review.
