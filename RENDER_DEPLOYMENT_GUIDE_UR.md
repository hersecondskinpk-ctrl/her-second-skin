# Render Testing Setup — Her Second Skin PK v9

## Important: Existing data first
1. Copy the current SQLite DB (`*.sqlite` plus a consistent backup made using SQLite backup API) and uploaded files BEFORE changing your live Render deployment. Preserve existing environment secrets; never paste them into chat or put them in GitHub.
2. This ZIP includes source code only — NO production database, customer details, uploaded product media or API tokens. Deploy to a TEST service first if your existing instance holds orders.

## Code / Runtime
- Install Node.js 22.13+ (recommended Node.js 22 LTS compatible with native `node:sqlite`).
- Start command: `npm start`
- Health check: `/api/health`
- Do not deploy as a Static Site: server and SQLite endpoints require a Web Service.

## Render environment (persistent paid disk recommended)
- Render Paid Web Service + Persistent Disk, mount path: `/var/data`
- `HSS_DATABASE_PATH=/var/data/her-second-skin.sqlite`
- `HSS_UPLOAD_DIR=/var/data/uploads`
- `HSS_DATA_DIR=/var/data`
- `HOST=0.0.0.0`
- `ADMIN_PASSWORD=(your current secret, do not replace without planning admin DB migration)`
- `COOKIE_SECURE=1` (when served over HTTPS)
- `PUBLIC_BASE_URL=https://YOUR-SITE.onrender.com` (replace with actual URL/domain)
- `WHATSAPP_AUTOMATION_ENABLED=0` during the first Render tests until Meta templates, webhook, Flow and phone ID are confirmed.
- Keep any other existing environment variables and user credentials private and unchanged.
- `PORT` is usually provided automatically by Render. Do not set a fixed public port without checking service config.

## Critical data caveat
Persistent Disk stores ONLY files written inside its mount path. By default, Render's ordinary ephemeral filesystem loses writes on restart/redeploy. If existing SQLite and uploads are currently located elsewhere, arrange an explicit one-time migration into the mounted disk. Merely attaching a blank disk does not move existing data!

## Manual acceptance tests after upload
1. Open `/api/health` and verify it says database connected.
2. Open Website and Admin on desktop and Android; verify rounded side menu opens from RIGHT and announcement bar policy text is white.
3. Create test product with Black / 36 / B and Black / 36 / C variants; verify independent stock.
4. Submit test checkout; verify order number appears without opening WhatsApp; verify order is visible in admin.
5. Cancel one test order; verify stock is restored once. Mark separate test as delivered.
6. File exchange within three days via `/exchange.html`; attach photo; approve, inspect, dispatch and check tracking using order number + registered phone.
7. Upload test category image and video Reel; check mobile muted autoplay and full viewer after click.
8. Restart/redeploy; verify orders and media still exist. Create offsite backups and actually test restore.
9. Do not enable live WhatsApp until approved templates and Graph IDs are confirmed; payments/refunds are manual in this build.

## Production hosting considerations
- Easiest migration: stay on Paid Render + Persistent Disk, domain bought independently via Cloudflare Registrar.
- Alternative: Railway Hobby + Persistent Volume (configure same SQLite/upload path correctly and backups).
- Both setups are single-instance SQLite architectures; future growth may need Postgres migration and separate object storage.
- Domain DNS/HTTPS alone does not preserve data: disk/volume or managed DB/object storage is what keeps it safe.
