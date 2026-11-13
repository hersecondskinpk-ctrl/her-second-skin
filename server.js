'use strict';

// Her Second Skin PK Inventory & Order Management
// Runtime: Node.js 22+ (uses built-in node:sqlite; no npm dependencies).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = process.env.HSS_DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = process.env.HSS_DATABASE_PATH || path.join(DATA_DIR, 'her-second-skin.sqlite');
const UPLOAD_DIR = process.env.HSS_UPLOAD_DIR || ((process.env.HSS_DATABASE_PATH || process.env.HSS_DATA_DIR) ? path.join(path.dirname(DB_PATH), 'uploads') : path.join(ROOT, 'uploads'));
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.FLY_APP_NAME || process.env.RENDER || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const CATEGORIES = new Set(['bras', 'panties', 'sets', 'accessories', 'body-shaper', 'camisole']);
const STATUSES = new Set(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']);
const MAX_BODY_BYTES = 120 * 1024 * 1024; // photos + up to 3 videos in one product save
const MAX_GALLERY_PHOTOS = 20;
const MAX_PRODUCT_VIDEOS = 3;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';

const HOMEPAGE_DEFAULTS = {tagline:'Comfort, Confidence & Elegance',bannerUrl:'',bannerMobileUrl:'',bannerHeading:'',reels:[]};
function homepageSettings(){
  const row=db.prepare('SELECT value FROM site_settings WHERE key=?').get('homepage');
  if(!row)return {...HOMEPAGE_DEFAULTS};
  try {return {...HOMEPAGE_DEFAULTS,...JSON.parse(row.value)};}catch{return {...HOMEPAGE_DEFAULTS};}
}
function saveHomepageMedia(input,kind){
  if(!input)return '';
  const m=/^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm));base64,([a-zA-Z0-9+/=]+)$/.exec(input);
  if(!m || (kind==='banner'?!m[1].startsWith('image/'):!m[1].startsWith('video/')))throw Object.assign(new Error('Unsupported media format.'),{status:400});
  const bytes=Buffer.from(m[2],'base64');const max=kind==='banner'?8*1024*1024:25*1024*1024;
  if(!bytes.length||bytes.length>max)throw Object.assign(new Error('Media file exceeds size limit.'),{status:413});
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'}[m[1]];
  const sig=ext==='jpg'?bytes[0]===255&&bytes[1]===216:ext==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':ext==='mp4'?bytes.toString('ascii',4,8)==='ftyp':bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
  if(!sig)throw Object.assign(new Error('Invalid media file signature.'),{status:400});
  const file=crypto.randomUUID()+'.'+ext;fs.writeFileSync(path.join(UPLOAD_DIR,file),bytes,{flag:'wx'});return '/uploads/'+file;
}
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec('CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id, active);
CREATE TABLE IF NOT EXISTS product_images (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), image_url TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, is_primary INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_images_gallery ON product_images(product_id, color, sort_order);
CREATE TABLE IF NOT EXISTS product_videos (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), video_url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_videos_product ON product_videos(product_id, sort_order);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  delivery_fee INTEGER NOT NULL DEFAULT 350,
  total INTEGER NOT NULL,
  promo_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'website',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  change_qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(created_at);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  order_number TEXT NOT NULL,
  merchandise_gross INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  merchandise_net INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  amount_collected INTEGER NOT NULL,
  estimated_cost INTEGER NOT NULL DEFAULT 0,
  estimated_profit INTEGER NOT NULL DEFAULT 0,
  sold_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);
`);

// --- Customer reviews (moderated; "verified" = phone matches a delivered order for that product) ---
db.exec(`
CREATE TABLE IF NOT EXISTS product_reviews(
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id,status);

-- --- Category 3 Promo / Discount Manager Tables ---
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('percentage', 'fixed')),
  value REAL NOT NULL CHECK(value > 0),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'scheduled', 'active', 'paused', 'expired', 'exhausted', 'revoked')),
  min_subtotal REAL NOT NULL DEFAULT 0,
  max_discount REAL NOT NULL DEFAULT 0,
  usage_limit INTEGER NOT NULL DEFAULT 0,
  per_customer_limit INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY,
  promo_id TEXT NOT NULL REFERENCES promo_codes(id),
  order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),
  customer_phone_hash TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promo_redemptions(promo_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_phone ON promo_redemptions(customer_phone_hash);

CREATE TABLE IF NOT EXISTS promo_audit (
  id TEXT PRIMARY KEY,
  promo_id TEXT NOT NULL,
  admin_user TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_audit_promo ON promo_audit(promo_id);
`);
const reviewAttempts = new Map();
const last10 = v => String(v||'').replace(/\D/g,'').slice(-10);
function isVerifiedBuyer(productId, phone) {
  const p = last10(phone); if (p.length < 10) return false;
  const rows = db.prepare("SELECT DISTINCT o.phone FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.product_id=? AND o.status='delivered'").all(productId);
  return rows.some(r => last10(r.phone) === p);
}
function publicReview(r) { return { id:r.id, name:r.customer_name, rating:Number(r.rating), title:r.title, text:r.body, verified:Boolean(r.verified), date:r.created_at }; }

// --- Sale pricing: optional "original price" shown struck-through on the store ---
try {
  const productCols = db.prepare("PRAGMA table_info(products)").all().map(r => r.name);
  if (!productCols.includes('compare_price')) db.exec("ALTER TABLE products ADD COLUMN compare_price INTEGER NOT NULL DEFAULT 0");
} catch (err) { console.error('compare_price migration failed:', err.message); }

// --- Duplicate-order protection (idempotency) -------------------------------
// Additive migration: safe on existing databases, never drops or rewrites data.
try {
  const variantCols = db.prepare("PRAGMA table_info(variants)").all().map(r => r.name);
  if (!variantCols.includes('cup_size')) db.exec("ALTER TABLE variants ADD COLUMN cup_size TEXT NOT NULL DEFAULT ''");
  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(r => r.name);
  if (!orderCols.includes('idempotency_key')) db.exec("ALTER TABLE orders ADD COLUMN idempotency_key TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL");
} catch (err) { console.error('Idempotency migration failed:', err.message); throw err; }

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const money = n => Math.max(0, Math.round(Number(n) || 0));
const cleanText = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const json = (res, status, data, extraHeaders = {}) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(body);
};
const bad = (res, status, message) => json(res, status, { error: message });
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, digest };
}
function setInitialAdmin() {
  const existing = db.prepare('SELECT username FROM admin_users WHERE username=?').get(ADMIN_USER);
  if (existing) return;
  let password = process.env.ADMIN_PASSWORD;
  let wroteCredentials = false;
  if (!password || password.length < 12) {
    password = crypto.randomBytes(15).toString('base64url');
    const credentialsPath = path.join(DATA_DIR, 'INITIAL-ADMIN-LOGIN.txt');
    fs.writeFileSync(credentialsPath, `Her Second Skin PK — Initial Admin Login\nUsername: ${ADMIN_USER}\nPassword: ${password}\n\nAfter signing in, change this password in Admin → Settings and delete this file.\n`, { mode: 0o600, flag: 'wx' });
    wroteCredentials = true;
  }
  const { salt, digest } = hashPassword(password);
  db.prepare('INSERT INTO admin_users(username,salt,password_hash,updated_at) VALUES(?,?,?,?)').run(ADMIN_USER, salt, digest, nowIso());
  if (wroteCredentials) {
    console.log('\n==============================================');
    console.log('Her Second Skin PK — First-time Admin Login');
    console.log(`Username: ${ADMIN_USER}`);
    console.log(`Password: ${password}`);
    console.log(`Saved in: ${path.join(DATA_DIR, 'INITIAL-ADMIN-LOGIN.txt')}`);
    console.log('Change the password after signing in.');
    console.log('==============================================\n');
  } else {
    console.log(`Admin user '${ADMIN_USER}' initialized from environment settings.`);
  }
}
setInitialAdmin();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > -1) {
      try { out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
      catch { /* Ignore malformed cookie values rather than crashing an API request. */ }
    }
  }
  return out;
}
function getSession(req) {
  const token = parseCookies(req).hss_admin;
  if (!token) return null;
  const item = sessions.get(token);
  if (!item || item.expiresAt < Date.now()) { sessions.delete(token); return null; }
  item.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...item };
}
function requireAdmin(req, res) {
  const s = getSession(req);
  if (!s) { bad(res, 401, 'Please sign in to the admin panel.'); return null; }
  return s;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  try { const u = new URL(origin); return u.host === host; } catch { return false; }
}
async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { const e = new Error('Request body is too large.'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { const e = new Error('Invalid JSON request.'); e.status = 400; throw e; }
}
function skuFor(category) {
  const tag = ({bras:'BRA',panties:'PAN',sets:'SET',accessories:'ACC','body-shaper':'SHP',camisole:'CAM'})[category] || 'HSS';
  return `HSS-${tag}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function productRowToObject(row, includeInactive = false, admin = false) {
  const variants = db.prepare(`SELECT id, product_id AS productId, sku, color, size, cup_size AS cupSize, stock, active FROM variants WHERE product_id=? ${includeInactive ? '' : 'AND active=1'} ORDER BY created_at, color, size`).all(row.id);
  const realTotalStock = variants.reduce((sum, v) => sum + Number(v.stock), 0);
  const images = db.prepare('SELECT id, image_url AS url, color, sort_order AS sortOrder, is_primary AS isPrimary FROM product_images WHERE product_id=? ORDER BY is_primary DESC, sort_order, created_at').all(row.id).map(i=>({...i, isPrimary:Boolean(i.isPrimary)}));
  const videos = db.prepare('SELECT id, video_url AS url, sort_order AS sortOrder FROM product_videos WHERE product_id=? ORDER BY sort_order, created_at').all(row.id);
  // Legacy image_url remains the fallback and first image for older products.
  if (!images.length && row.image_url) images.push({id:'legacy-'+row.id,url:row.image_url,color:'',sortOrder:0,isPrimary:true});
  const galleryColors = [...new Set(images.map(i=>i.color).filter(Boolean))];

  if (admin) {
    return {
      ...row,
      active: Boolean(row.active),
      price: Number(row.price),
      costPrice: Number(row.cost_price),
      comparePrice: Number(row.compare_price || 0),
      totalStock: realTotalStock,
      inStock: realTotalStock > 0,
      images,
      videos,
      galleryColors,
      variants: variants.map(v => ({
        ...v,
        stock: Number(v.stock),
        inStock: Number(v.stock) > 0,
        active: Boolean(v.active)
      }))
    };
  }

  // Public-facing response: omit wholesale costPrice and mask inventory counts to boolean presence
  const publicObj = {
    ...row,
    active: Boolean(row.active),
    price: Number(row.price),
    comparePrice: Number(row.compare_price || 0),
    totalStock: realTotalStock > 0 ? 1 : 0,
    inStock: realTotalStock > 0,
    images,
    videos,
    galleryColors,
    variants: variants.map(v => {
      const isAvail = Number(v.stock) > 0;
      return {
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        color: v.color,
        size: v.size,
        cupSize: v.cupSize,
        stock: isAvail ? 1 : 0,
        inStock: isAvail,
        active: Boolean(v.active)
      };
    })
  };
  delete publicObj.cost_price;
  delete publicObj.costPrice;
  return publicObj;
}
function allProducts({ category = '', admin = false, includeInactive = false } = {}) {
  let sql = `SELECT * FROM products WHERE 1=1`;
  const args = [];
  if (!includeInactive) sql += ' AND active=1';
  if (category) { sql += ' AND category=?'; args.push(category); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...args).map(row => productRowToObject(row, includeInactive && admin, admin));
}
function inventoryCounts() {
  const p = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get().n;
  const units = db.prepare('SELECT COALESCE(SUM(v.stock),0) AS n FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1 AND v.active=1').get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','confirmed','processing','shipped')").get().n;
  const lowStock = db.prepare('SELECT COUNT(*) AS n FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1 AND v.active=1 AND v.stock BETWEEN 1 AND 3').get().n;
  const outOfStock = db.prepare('SELECT COUNT(*) AS n FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1 AND v.active=1 AND v.stock=0').get().n;
  const delivered = db.prepare("SELECT COALESCE(SUM(amount_collected),0) AS collected, COALESCE(SUM(merchandise_net),0) AS net, COALESCE(SUM(estimated_profit),0) AS profit, COUNT(*) AS n FROM sales WHERE substr(sold_at,1,7)=strftime('%Y-%m','now','localtime')").get();
  return { activeProducts:Number(p), unitsInStock:Number(units), openOrders:Number(pending), lowStockVariants:Number(lowStock), outOfStockVariants:Number(outOfStock), monthSales:Number(delivered.net), monthCollected:Number(delivered.collected), monthEstimatedProfit:Number(delivered.profit), monthDeliveredOrders:Number(delivered.n) };
}
function nextOrderNumber() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const prefix = `HSS-${date}-`;
  const last = db.prepare('SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1').get(`${prefix}%`);
  const seq = last ? Number(last.order_number.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(4,'0')}`;
}
function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id=? OR order_number=?').get(id, id);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  return { ...order, subtotal:Number(order.subtotal), discount:Number(order.discount), deliveryFee:Number(order.delivery_fee), total:Number(order.total), items: items.map(i=>({...i,unitPrice:Number(i.unit_price),costPrice:Number(i.cost_price),quantity:Number(i.quantity),lineTotal:Number(i.line_total)})) };
}
function validatePromoCode(rawCode, subtotal, phone = '') {
  const killSwitch = process.env.DISABLE_ALL_PROMOS === '1';
  const settingRow = db.prepare("SELECT value FROM site_settings WHERE key='promos_disabled'").get();
  if (killSwitch || (settingRow && settingRow.value === '1')) {
    const err = new Error('Promotions are currently disabled.');
    err.status = 400;
    throw err;
  }
  const code = cleanText(rawCode, 30).toUpperCase();
  if (!code) return null;

  const promo = db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(code);
  if (!promo) {
    const err = new Error('Invalid promo code.');
    err.status = 400;
    throw err;
  }
  if (promo.status !== 'active') {
    const err = new Error(`Promo code is ${promo.status}.`);
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  if (promo.starts_at && now < promo.starts_at) {
    const err = new Error('Promo code is not active yet.');
    err.status = 400;
    throw err;
  }
  if (promo.expires_at && now > promo.expires_at) {
    db.prepare("UPDATE promo_codes SET status='expired' WHERE id=?").run(promo.id);
    const err = new Error('Promo code has expired.');
    err.status = 400;
    throw err;
  }
  if (promo.min_subtotal > 0 && subtotal < promo.min_subtotal) {
    const err = new Error(`Minimum order subtotal for this code is PKR ${Number(promo.min_subtotal).toLocaleString()}.`);
    err.status = 400;
    throw err;
  }
  if (promo.usage_limit > 0) {
    const usageRow = db.prepare("SELECT COUNT(*) as count FROM promo_redemptions WHERE promo_id=?").get(promo.id);
    const usageCount = usageRow ? usageRow.count : 0;
    if (usageCount >= promo.usage_limit) {
      db.prepare("UPDATE promo_codes SET status='exhausted' WHERE id=?").run(promo.id);
      const err = new Error('Promo code redemption limit reached.');
      err.status = 400;
      throw err;
    }
  }
  if (phone && promo.per_customer_limit > 0) {
    const phoneHash = crypto.createHash('sha256').update(phone).digest('hex');
    const custRow = db.prepare("SELECT COUNT(*) as count FROM promo_redemptions WHERE promo_id=? AND customer_phone_hash=?").get(promo.id, phoneHash);
    const custUsage = custRow ? custRow.count : 0;
    if (custUsage >= promo.per_customer_limit) {
      const err = new Error('You have already used this promo code.');
      err.status = 400;
      throw err;
    }
  }

  let discount = 0;
  if (promo.type === 'percentage') {
    discount = Math.round(subtotal * (Number(promo.value) / 100));
  } else {
    discount = Math.round(Number(promo.value));
  }
  if (promo.max_discount > 0 && discount > promo.max_discount) {
    discount = Number(promo.max_discount);
  }
  if (discount > subtotal) {
    discount = subtotal;
  }
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    value: Number(promo.value),
    discount,
    min_subtotal: Number(promo.min_subtotal),
    max_discount: Number(promo.max_discount)
  };
}

function createOrder(data, source = 'website') {
  const customerName = cleanText(data.customerName || data.name, 120);
  const phone = cleanText(data.phone, 30);
  const address = cleanText(data.address, 1000);
  if (!customerName || !phone || !address) { const e = new Error('Customer name, phone and delivery address are required.'); e.status=400; throw e; }
  if (!/^03\d{9}$/.test(phone)) { const e = new Error('Enter a valid Pakistani mobile number starting with 03.'); e.status=400; throw e; }
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 80) { const e = new Error('Add at least one item to the order.'); e.status=400; throw e; }
  const aggregated = new Map();
  for (const item of data.items) {
    const variantId = cleanText(item.variantId, 80);
    const quantity = Number(item.quantity ?? item.qty);
    if (!variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) { const e=new Error('Each order item needs a valid variant and quantity (1–99).');e.status=400;throw e; }
    const combinedQuantity = (aggregated.get(variantId) || 0) + quantity;
    if (combinedQuantity > 99) { const e=new Error('Maximum quantity for each variant is 99.');e.status=400;throw e; }
    aggregated.set(variantId, combinedQuantity);
  }
  const rawPromo = cleanText(data.promoCode, 30);
  const idemKey = cleanText(data.idempotencyKey, 80);
  if (idemKey && !/^[A-Za-z0-9_-]{16,80}$/.test(idemKey)) { const e = new Error('Invalid request key.'); e.status=400; throw e; }
  if (idemKey) {
    const existing = db.prepare('SELECT id FROM orders WHERE idempotency_key=?').get(idemKey);
    if (existing) { const dup = getOrder(existing.id); dup.duplicate = true; return dup; }
  }
  const orderId = uid();
  const orderNumber = nextOrderNumber();
  const t = nowIso();
  const normalized = [];
  let subtotal = 0; let totalCost = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [variantId, quantity] of aggregated.entries()) {
      const row = db.prepare(`SELECT v.id AS variant_id,v.sku,v.color,v.size,v.stock,v.active AS variant_active,p.id AS product_id,p.name,p.category,p.price,p.cost_price,p.active AS product_active
        FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(variantId);
      if (!row || !row.variant_active || !row.product_active) { const e=new Error('One of the selected products is unavailable. Refresh the page and try again.');e.status=409;throw e; }
      if (row.stock < quantity) { const e=new Error(`${row.name} (${row.color}, ${row.size}) is not available in that quantity.`);e.status=409;throw e; }
      normalized.push({ ...row, quantity, lineTotal:Number(row.price)*quantity });
      subtotal += Number(row.price)*quantity;
      totalCost += Number(row.cost_price)*quantity;
    }
    const validatedPromo = rawPromo ? validatePromoCode(rawPromo, subtotal, phone) : null;
    const discount = validatedPromo ? validatedPromo.discount : 0;
    const deliveryFee = subtotal - discount >= 10000 ? 0 : 350;
    const total = subtotal - discount + deliveryFee;
    db.prepare(`INSERT INTO orders(id,order_number,customer_name,phone,address,subtotal,discount,delivery_fee,total,promo_code,status,source,notes,created_at,updated_at,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)`).run(orderId,orderNumber,customerName,phone,address,subtotal,discount,deliveryFee,total,validatedPromo?validatedPromo.code:'',source,cleanText(data.notes,1000),t,t,idemKey||null);
    if (validatedPromo) {
      const phoneHash = crypto.createHash('sha256').update(phone).digest('hex');
      db.prepare(`INSERT INTO promo_redemptions(id,promo_id,order_id,customer_phone_hash,amount,created_at) VALUES(?,?,?,?,?,?)`)
        .run(uid(), validatedPromo.id, orderId, phoneHash, discount, t);
    }
    for (const item of normalized) {
      db.prepare(`INSERT INTO order_items(id,order_id,product_id,variant_id,product_name,sku,category,color,size,unit_price,cost_price,quantity,line_total)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid(),orderId,item.product_id,item.variant_id,item.name,item.sku,item.category,item.color,item.size,item.price,item.cost_price,item.quantity,item.lineTotal);
      const change = db.prepare('UPDATE variants SET stock=stock-?,updated_at=? WHERE id=? AND stock>=?').run(item.quantity,t,item.variant_id,item.quantity);
      if (change.changes !== 1) { const e=new Error('Stock changed while placing this order. Please try again.');e.status=409;throw e; }
      db.prepare(`INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(uid(),item.variant_id,item.product_id,orderId,-item.quantity,'order_reserved',`Reserved for ${orderNumber}`,t);
    }
    db.exec('COMMIT');
    return getOrder(orderId);
  } catch (e) {
    db.exec('ROLLBACK');
    if (idemKey && /UNIQUE/i.test(String(e.message)) && /idempotency_key/i.test(String(e.message))) {
      const existing = db.prepare('SELECT id FROM orders WHERE idempotency_key=?').get(idemKey);
      if (existing) { const dup = getOrder(existing.id); dup.duplicate = true; return dup; }
    }
    throw e;
  }
}
const wa = require('./whatsapp-automation').initWhatsApp({db,getOrder,setOrderStatus,siteBase:process.env.PUBLIC_BASE_URL||''});
const exchangeSystem = require('./exchange-system').initExchanges({db,requireAdmin,readJson,json,bad,uid,nowIso,uploadRoot:path.dirname(DB_PATH)});
function setOrderStatus(orderId, status, note = '') {
  if (!STATUSES.has(status)) { const e=new Error('Unknown order status.');e.status=400;throw e; }
  const t = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id=? OR order_number=?').get(orderId,orderId);
    if (!order) { const e=new Error('Order not found.');e.status=404;throw e; }
    if (order.status === 'delivered' && status !== 'delivered') { const e=new Error('A delivered order is final and cannot be changed to another status.');e.status=409;throw e; }
    if (order.status === 'cancelled' && status !== 'cancelled') { const e=new Error('Cancelled orders are final. Create a new order if needed.');e.status=409;throw e; }
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
      for (const item of items) {
        db.prepare('UPDATE variants SET stock=stock+?,updated_at=? WHERE id=?').run(item.quantity,t,item.variant_id);
        db.prepare(`INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
          .run(uid(),item.variant_id,item.product_id,order.id,item.quantity,'order_cancelled',`Restocked from ${order.order_number}`,t);
      }
      db.prepare('DELETE FROM sales WHERE order_id=?').run(order.id);
    }
    db.prepare("UPDATE orders SET status=?,notes=CASE WHEN ?<>'' THEN ? ELSE notes END,updated_at=?,delivered_at=CASE WHEN ?='delivered' AND delivered_at IS NULL THEN ? ELSE delivered_at END WHERE id=?")
      .run(status,cleanText(note,1000),cleanText(note,1000),t,status,t,order.id);
    if (status === 'delivered') {
      const sums = db.prepare('SELECT COALESCE(SUM(line_total),0) AS gross,COALESCE(SUM(cost_price*quantity),0) AS cost FROM order_items WHERE order_id=?').get(order.id);
      const net = Number(sums.gross)-Number(order.discount);
      const profit = net-Number(sums.cost);
      db.prepare(`INSERT INTO sales(id,order_id,order_number,merchandise_gross,discount,merchandise_net,delivery_fee,amount_collected,estimated_cost,estimated_profit,sold_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET merchandise_gross=excluded.merchandise_gross,discount=excluded.discount,merchandise_net=excluded.merchandise_net,delivery_fee=excluded.delivery_fee,amount_collected=excluded.amount_collected,estimated_cost=excluded.estimated_cost,estimated_profit=excluded.estimated_profit,sold_at=excluded.sold_at`)
        .run(uid(),order.id,order.order_number,Number(sums.gross),Number(order.discount),net,Number(order.delivery_fee),Number(order.total),Number(sums.cost),profit,t);
    }
    db.exec('COMMIT');
    return getOrder(order.id);
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
function saveProduct(data, productId = null) {
  const name = cleanText(data.name, 180);
  const category = cleanText(data.category, 50);
  const description = cleanText(data.description, 2000);
  let rawImage = String(data.imageUrl || data.image_url || '').trim();
  let imageUrl = rawImage.startsWith('data:') ? rawImage : cleanText(rawImage, 1000);
  const price = money(data.price);
  const costPrice = money(data.costPrice ?? data.cost_price);
  const comparePrice = money(data.comparePrice ?? data.compare_price);
  if (!name || !CATEGORIES.has(category)) { const e=new Error('Product name and a valid category are required.');e.status=400;throw e; }
  if (price < 1) { const e=new Error('Selling price must be at least PKR 1.');e.status=400;throw e; }
  if (costPrice > price) { /* allowed intentionally; can reflect a loss */ }
  if (comparePrice && comparePrice <= price) { const e=new Error('Original price must be higher than the selling price (or leave it 0 for no discount).');e.status=400;throw e; }
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) { const e=new Error('Image must be JPG, PNG or WebP.');e.status=400;throw e; }
    const buffer = Buffer.from(match[2],'base64');
    if (!buffer.length || buffer.length > 3*1024*1024) { const e=new Error('Image must be no larger than 3 MB.');e.status=413;throw e; }
    const ext = match[1]==='image/jpeg'?'jpg':match[1]==='image/png'?'png':'webp';
    const nameOnDisk = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR,nameOnDisk),buffer,{flag:'wx'});
    imageUrl = `/uploads/${nameOnDisk}`;
  } else if (imageUrl && !imageUrl.startsWith('/uploads/') && !/^https?:\/\//i.test(imageUrl)) {
    const e=new Error('Image URL must be an https/http URL or an uploaded image.');e.status=400;throw e;
  }
  if (!Array.isArray(data.variants) || !data.variants.length || data.variants.length > 200) { const e=new Error('Add at least one colour/size stock variant.');e.status=400;throw e; }
  const variants = data.variants.map(v=>({ id:cleanText(v.id,80), color:cleanText(v.color,80), size:cleanText(v.size,80), cupSize:cleanText(v.cupSize||'',12).toUpperCase(), sku:cleanText(v.sku,80), stock:Math.floor(Number(v.stock)) }))
    .map(v=>({...v,sku:v.sku || skuFor(category)}));
  for (const v of variants) {
    if (!v.color || !v.size || !['','A','B','C','D','FF'].includes(v.cupSize) || !Number.isInteger(v.stock) || v.stock < 0) { const e=new Error('Every variant needs a colour, size and stock amount (0 or more).');e.status=400;throw e; }
  }
  if (new Set(variants.map(v=>[v.color.toLowerCase(),v.size.toUpperCase(),v.cupSize].join('|'))).size !== variants.length) { const e=new Error('Duplicate colour / size / cup combination.');e.status=400;throw e; }
  if (new Set(variants.map(v=>v.sku.toLowerCase())).size !== variants.length) { const e=new Error('Each variant SKU must be unique within the product.');e.status=400;throw e; }
  const t=nowIso(); const id=productId || uid();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (productId && !existing) { const e=new Error('Product not found.');e.status=404;throw e; }
    if (existing) {
      db.prepare('UPDATE products SET name=?,category=?,description=?,image_url=?,price=?,cost_price=?,compare_price=?,updated_at=? WHERE id=?')
        .run(name,category,description,imageUrl,price,costPrice,comparePrice,t,id);
    } else {
      db.prepare('INSERT INTO products(id,name,category,description,image_url,price,cost_price,compare_price,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)')
        .run(id,name,category,description,imageUrl,price,costPrice,comparePrice,t,t);
    }
    if (Array.isArray(data.images)) {
      if (data.images.length > MAX_GALLERY_PHOTOS) { const e=new Error(`A product can have up to ${MAX_GALLERY_PHOTOS} gallery images.`);e.status=400;throw e; }
      const normalizedImages=[];
      for (let ix=0; ix<data.images.length; ix++) {
        const item=data.images[ix] || {}; let src=String(item.url || item.imageUrl || '').trim();
        if (!src) continue;
        if (src.startsWith('data:')) {
          const im=src.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
          if(!im){const e=new Error('Gallery images must be JPG, PNG or WebP.');e.status=400;throw e;}
          const buffer=Buffer.from(im[2],'base64'); if(!buffer.length||buffer.length>3*1024*1024){const e=new Error('Each gallery image must be no larger than 3 MB.');e.status=413;throw e;}
          const ext=im[1]==='image/jpeg'?'jpg':im[1]==='image/png'?'png':'webp'; const filename=`${crypto.randomUUID()}.${ext}`;
          fs.writeFileSync(path.join(UPLOAD_DIR,filename),buffer,{flag:'wx'});src=`/uploads/${filename}`;
        } else if (!src.startsWith('/uploads/') && !/^https?:\/\//i.test(src)) {const e=new Error('Gallery image URL must be HTTP(S) or an uploaded image.');e.status=400;throw e;}
        normalizedImages.push({url:src,color:cleanText(item.color,80),sortOrder:ix,isPrimary:Boolean(item.isPrimary)});
      }
      db.prepare('DELETE FROM product_images WHERE product_id=?').run(id);
      normalizedImages.forEach((im,ix)=>db.prepare('INSERT INTO product_images(id,product_id,image_url,color,sort_order,is_primary,created_at) VALUES(?,?,?,?,?,?,?)').run(uid(),id,im.url,im.color,ix,im.isPrimary?1:(ix===0?1:0),t));
      if(normalizedImages.length) { const featured=normalizedImages.find(im=>im.isPrimary)||normalizedImages[0]; imageUrl=featured.url; db.prepare('UPDATE products SET image_url=?,updated_at=? WHERE id=?').run(imageUrl,t,id); }
    }
    if (Array.isArray(data.videos)) {
      if (data.videos.length > MAX_PRODUCT_VIDEOS) { const e=new Error(`A product can have up to ${MAX_PRODUCT_VIDEOS} videos.`);e.status=400;throw e; }
      const normalizedVideos=[];
      for (let vx=0; vx<data.videos.length; vx++) {
        const item=data.videos[vx] || {}; let src=String(item.url || '').trim();
        if (!src) continue;
        if (src.startsWith('data:')) {
          const vm=src.match(/^data:(video\/(?:mp4|quicktime|webm));base64,([A-Za-z0-9+/=]+)$/);
          if(!vm){const e=new Error('Video must be MP4, MOV or WebM.');e.status=400;throw e;}
          const vbuf=Buffer.from(vm[2],'base64'); if(!vbuf.length||vbuf.length>MAX_VIDEO_BYTES){const e=new Error('Each video must be no larger than 25 MB.');e.status=413;throw e;}
          const vext=vm[1]==='video/mp4'?'mp4':vm[1]==='video/quicktime'?'mov':'webm'; const vname=`${crypto.randomUUID()}.${vext}`;
          fs.writeFileSync(path.join(UPLOAD_DIR,vname),vbuf,{flag:'wx'});src=`/uploads/${vname}`;
        } else if (!/^\/uploads\/[A-Za-z0-9._-]+\.(mp4|mov|webm)$/i.test(src)) {const e=new Error('Video must be an uploaded MP4, MOV or WebM file.');e.status=400;throw e;}
        normalizedVideos.push(src);
      }
      db.prepare('DELETE FROM product_videos WHERE product_id=?').run(id);
      normalizedVideos.forEach((u,ix)=>db.prepare('INSERT INTO product_videos(id,product_id,video_url,sort_order,created_at) VALUES(?,?,?,?,?)').run(uid(),id,u,ix,t));
    }
    const keep = new Set();
    for (const v of variants) {
      let variantId=v.id;
      let current=null;
      if (variantId) current = db.prepare('SELECT * FROM variants WHERE id=? AND product_id=?').get(variantId,id);
      if (!current) variantId=uid(); else keep.add(variantId);
      const sku = v.sku;
      const collision = db.prepare('SELECT id FROM variants WHERE sku=? AND id<>?').get(sku,variantId);
      if (collision) { const e=new Error(`SKU ${sku} is already assigned to another variant.`);e.status=409;throw e; }
      if (current) {
        const difference = v.stock-Number(current.stock);
        db.prepare('UPDATE variants SET sku=?,color=?,size=?,cup_size=?,stock=?,active=1,updated_at=? WHERE id=?').run(sku,v.color,v.size,v.cupSize,v.stock,t,variantId);
        if (difference !== 0) db.prepare('INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,\'\',?,?,?,?)')
          .run(uid(),variantId,id,difference,'manual_adjustment',`Stock changed while editing ${name}`,t);
      } else {
        db.prepare('INSERT INTO variants(id,product_id,sku,color,size,cup_size,stock,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)').run(variantId,id,sku,v.color,v.size,v.cupSize,v.stock,t,t);
        if (v.stock !== 0) db.prepare('INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,\'\',?,?,?,?)')
          .run(uid(),variantId,id,v.stock,'initial_stock',`Initial stock for ${name}`,t);
      }
    }
    if (existing) {
      const oldVariants = db.prepare('SELECT id FROM variants WHERE product_id=? AND active=1').all(id);
      for (const v of oldVariants) if (!keep.has(v.id)) db.prepare('UPDATE variants SET active=0,updated_at=? WHERE id=?').run(t,v.id);
    }
    db.exec('COMMIT');
    return productRowToObject(db.prepare('SELECT * FROM products WHERE id=?').get(id),true,true);
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
function staticMime(ext) {
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'})[ext.toLowerCase()] || 'application/octet-stream';
}
function serveFile(req,res,relative) {
  const file = String(relative).startsWith('uploads'+path.sep) ? path.resolve(UPLOAD_DIR, String(relative).slice(('uploads'+path.sep).length)) : path.resolve(ROOT,relative);
  const insideRoot=file.startsWith(path.resolve(ROOT)+path.sep) || file===path.resolve(ROOT,'index.html');
  const insideUploads=file.startsWith(path.resolve(UPLOAD_DIR)+path.sep);
  if (!insideRoot && !insideUploads) return bad(res,403,'Forbidden');
  fs.stat(file,(err,stat)=>{
    if (err || !stat.isFile()) { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return; }
    const ext=path.extname(file).toLowerCase();
    const headers={'Content-Type':staticMime(ext),'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'};
    const isVideo=['.mp4','.mov','.webm'].includes(ext);
    if (isVideo) headers['Accept-Ranges']='bytes';
    const range=isVideo&&req.headers.range?/^bytes=(\d*)-(\d*)$/.exec(req.headers.range):null;
    if (range) {
      let start=range[1]===''?stat.size-Number(range[2]):Number(range[1]);
      let end=range[1]===''||range[2]===''?stat.size-1:Number(range[2]);
      if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=stat.size||end<start) { res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return; }
      end=Math.min(end,stat.size-1);
      res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});
      fs.createReadStream(file,{start,end}).pipe(res);return;
    }
    const compressible = ['.html','.css','.js','.json','.svg','.txt'].includes(ext);
    const acceptEncoding = (req.headers && req.headers['accept-encoding']) || '';
    if (compressible && acceptEncoding.includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
      return;
    }
    res.writeHead(200,{...headers,'Content-Length':stat.size});
    fs.createReadStream(file).pipe(res);
  });
}
function parsePath(req) { const u=new URL(req.url,'http://localhost'); return {url:u,path:decodeURIComponent(u.pathname)}; }
function sendCookie(res, value, maxAge) { res.setHeader('Set-Cookie',`hss_admin=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`); }

const server = http.createServer(async (req,res) => {
  let url, route;
  try { ({url,path:route}=parsePath(req)); }
  catch { return bad(res,400,'Malformed request URL.'); }
  if (req.method === 'OPTIONS') { res.writeHead(204,{'Allow':'GET,POST,PATCH,DELETE,OPTIONS'});res.end();return; }
  try {
    if (route.startsWith('/api/') && !originAllowed(req) && req.method !== 'GET') return bad(res,403,'Request origin was rejected.');
    if (await exchangeSystem.handle(req,res,route)) return;
    if(route==='/api/homepage'&&req.method==='GET') return json(res,200,{homepage:homepageSettings()});
    if(route==='/api/category-images'&&req.method==='GET'){
      const row=db.prepare('SELECT value FROM site_settings WHERE key=?').get('category_images');
      let images={};try{images=row?JSON.parse(row.value):{}}catch{}
      return json(res,200,{images});
    }
    if(route==='/api/admin/category-images'&&req.method==='POST'){
      if(!requireAdmin(req,res))return;
      const b=await readJson(req,12*1024*1024);
      if(!CATEGORIES.has(b.category))return bad(res,400,'Invalid category.');
      const row=db.prepare('SELECT value FROM site_settings WHERE key=?').get('category_images');
      let images={};try{images=row?JSON.parse(row.value):{}}catch{}
      if(b.remove)delete images[b.category];
      else if(b.imageFile) images[b.category]=saveHomepageMedia(b.imageFile,'banner');
      else return bad(res,400,'Select an image or remove the existing one.');
      db.prepare('INSERT INTO site_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('category_images',JSON.stringify(images));
      return json(res,200,{ok:true,images});
    }

    if(route==='/api/admin/homepage'&&req.method==='POST'){
      if(!requireAdmin(req,res))return;
      const b=await readJson(req,42*1024*1024),old=homepageSettings();
      const tagline=cleanText(b.tagline,120)||HOMEPAGE_DEFAULTS.tagline;
      const bannerHeading=cleanText(b.bannerHeading,140);
      let bannerUrl=old.bannerUrl;
      if(b.removeBanner)bannerUrl='';
      if(b.bannerFile)bannerUrl=saveHomepageMedia(b.bannerFile,'banner');
      let bannerMobileUrl=old.bannerMobileUrl||'';
      if(b.removeBannerMobile)bannerMobileUrl='';
      if(b.bannerMobileFile)bannerMobileUrl=saveHomepageMedia(b.bannerMobileFile,'banner');
      let reels=Array.isArray(b.reels)?b.reels:old.reels;
      if(reels.length>6)return bad(res,400,'Maximum six reels.');
      reels=reels.map(r=>({url:String(r.url||''),caption:cleanText(r.caption,100),deal:cleanText(r.deal,140)}));
      if(reels.some(r=>r.url&&!/^\/uploads\/[a-f0-9-]+\.(mp4|webm)$/i.test(r.url)))return bad(res,400,'Invalid reel path.');
      if(b.reelFile){const file=saveHomepageMedia(b.reelFile,'reel');reels.push({url:file,caption:cleanText(b.reelCaption,100),deal:cleanText(b.reelDeal,140)});}
      if(reels.length>6)return bad(res,400,'Maximum six reels.');
      const next={tagline,bannerHeading,bannerUrl,bannerMobileUrl,reels};
      db.prepare('INSERT INTO site_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('homepage',JSON.stringify(next));
      return json(res,200,{ok:true,homepage:next});
    }
    if (route === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,service:'Her Second Skin PK Inventory',database:'connected'});
    if (route === '/api/auth/login' && req.method === 'POST') {
      const ip=req.socket.remoteAddress||'unknown'; const attempts=loginAttempts.get(ip)||{count:0,since:Date.now()};
      if (Date.now()-attempts.since>15*60*1000) {attempts.count=0;attempts.since=Date.now();}
      if (attempts.count>=8) return bad(res,429,'Too many login attempts. Wait 15 minutes and try again.');
      const body=await readJson(req); const username=cleanText(body.username,100); const password=String(body.password||'');
      const admin=db.prepare('SELECT * FROM admin_users WHERE username=?').get(username);
      const candidate=admin?hashPassword(password,admin.salt).digest:'';
      if (!admin || !safeEqual(candidate,admin.password_hash)) { attempts.count++;loginAttempts.set(ip,attempts);return bad(res,401,'Username or password is incorrect.'); }
      loginAttempts.delete(ip);
      const token=crypto.randomBytes(32).toString('base64url'); sessions.set(token,{username,expiresAt:Date.now()+SESSION_TTL_MS});
      sendCookie(res,token,SESSION_TTL_MS/1000);
      return json(res,200,{ok:true,username});
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
      const token=parseCookies(req).hss_admin; if(token)sessions.delete(token);sendCookie(res,'',0);return json(res,200,{ok:true});
    }
    if (route === '/api/auth/me' && req.method === 'GET') {
      const session=getSession(req);if(!session)return bad(res,401,'Not signed in.');return json(res,200,{ok:true,username:session.username});
    }
    if (route === '/api/auth/password' && req.method === 'POST') {
      const session=requireAdmin(req,res);if(!session)return;
      const body=await readJson(req);const oldPassword=String(body.currentPassword||'');const newPassword=String(body.newPassword||'');
      if(newPassword.length<12)return bad(res,400,'New password must have at least 12 characters.');
      const row=db.prepare('SELECT * FROM admin_users WHERE username=?').get(session.username);
      if(!row || !safeEqual(hashPassword(oldPassword,row.salt).digest,row.password_hash))return bad(res,401,'Current password is incorrect.');
      const hashed=hashPassword(newPassword);
      db.prepare('UPDATE admin_users SET salt=?,password_hash=?,updated_at=? WHERE username=?').run(hashed.salt,hashed.digest,nowIso(),session.username);
      sessions.delete(session.token);sendCookie(res,'',0);
      try{fs.unlinkSync(path.join(DATA_DIR,'INITIAL-ADMIN-LOGIN.txt'));}catch{}
      return json(res,200,{ok:true,message:'Password changed. Please sign in again.'});
    }
    if (route === '/api/products' && req.method === 'GET') {
      const category=cleanText(url.searchParams.get('category'),50);
      if(category && !CATEGORIES.has(category))return bad(res,400,'Unknown category.');
      const adminView=url.searchParams.get('admin')==='1';
      if(adminView&&!requireAdmin(req,res))return;
      const products=allProducts({category,admin:adminView,includeInactive:adminView});
      // Supplier purchase cost and internal bookkeeping are never public.
      if(!adminView)for(const p of products){delete p.costPrice;delete p.cost_price;}
      return json(res,200,{products});
    }
    if (route === '/api/products' && req.method === 'POST') {
      if(!requireAdmin(req,res))return;const body=await readJson(req);const product=saveProduct(body);return json(res,201,{product});
    }
    let rv=route.match(/^\/api\/products\/([a-f0-9-]+)\/reviews$/i);
    if(rv && req.method==='GET'){
      const pid=rv[1];
      const rows=db.prepare("SELECT * FROM product_reviews WHERE product_id=? AND status='approved' ORDER BY created_at DESC LIMIT 100").all(pid);
      const stat=db.prepare("SELECT COUNT(*) AS n, COALESCE(AVG(rating),0) AS avg FROM product_reviews WHERE product_id=? AND status='approved'").get(pid);
      const since=new Date(Date.now()-14*24*3600*1000).toISOString();
      const sold=db.prepare("SELECT COALESCE(SUM(i.quantity),0) AS q FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=? AND o.status!='cancelled' AND o.created_at>=?").get(pid,since);
      return json(res,200,{reviews:rows.map(publicReview),count:Number(stat.n),average:Math.round(Number(stat.avg)*10)/10,soldRecent:Number(sold.q)});
    }
    if(rv && req.method==='POST'){
      const pid=rv[1]; const prod=db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(pid); if(!prod)return bad(res,404,'Product not found.');
      const ip=req.socket.remoteAddress||'unknown'; const a=reviewAttempts.get(ip)||{count:0,since:Date.now()};
      if(Date.now()-a.since>3600*1000){a.count=0;a.since=Date.now();}
      if(a.count>=5)return bad(res,429,'Too many reviews from this device. Please try again later.');
      const body=await readJson(req,100*1024);
      if(String(body.website||'').trim()) return json(res,200,{ok:true,message:'Thank you! Your review will appear after approval.'}); // honeypot
      const name=cleanText(body.name,60), text=cleanText(body.text,1000), title=cleanText(body.title,100), rating=Math.round(Number(body.rating));
      if(name.length<2)return bad(res,400,'Please enter your name.');
      if(!(rating>=1&&rating<=5))return bad(res,400,'Please choose a star rating from 1 to 5.');
      if(text.length<3)return bad(res,400,'Please write a few words about the product.');
      const phone=String(body.phone||'').replace(/[^0-9+]/g,'').slice(0,15);
      a.count++;reviewAttempts.set(ip,a);
      db.prepare('INSERT INTO product_reviews(id,product_id,customer_name,rating,title,body,phone,verified,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(uid(),pid,name,rating,title,text,phone,isVerifiedBuyer(pid,phone)?1:0,'pending',nowIso());
      return json(res,201,{ok:true,message:'Thank you! Your review will appear after approval.'});
    }
    if(route==='/api/reviews' && req.method==='GET'){
      if(!requireAdmin(req,res))return;
      const st=cleanText(url.searchParams.get('status'),20);
      const rows=db.prepare(`SELECT r.*,p.name AS product_name FROM product_reviews r JOIN products p ON p.id=r.product_id ${st&&st!=='all'?'WHERE r.status=?':''} ORDER BY r.created_at DESC LIMIT 300`).all(...(st&&st!=='all'?[st]:[]));
      return json(res,200,{reviews:rows.map(r=>({...publicReview(r),status:r.status,phone:r.phone,productId:r.product_id,productName:r.product_name}))});
    }
    if(route==='/api/reviews' && req.method==='POST'){
      if(!requireAdmin(req,res))return;const b=await readJson(req,100*1024);
      const prod=db.prepare('SELECT id FROM products WHERE id=?').get(String(b.productId||'')); if(!prod)return bad(res,400,'Choose a product.');
      const name=cleanText(b.name,60),text=cleanText(b.text,1000),rating=Math.round(Number(b.rating));
      if(name.length<2||text.length<3||!(rating>=1&&rating<=5))return bad(res,400,'Name, a 1-5 rating and review text are required.');
      let when=nowIso(); if(b.date){const d=new Date(b.date); if(!isNaN(d))when=d.toISOString();}
      const id=uid();db.prepare('INSERT INTO product_reviews(id,product_id,customer_name,rating,title,body,phone,verified,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,prod.id,name,rating,cleanText(b.title,100),text,'',b.verified?1:0,'approved',when);
      return json(res,201,{ok:true,id});
    }
    let rm=route.match(/^\/api\/reviews\/([a-f0-9-]+)$/i);
    if(rm && req.method==='PATCH'){
      if(!requireAdmin(req,res))return;const b=await readJson(req,20*1024);
      const row=db.prepare('SELECT id FROM product_reviews WHERE id=?').get(rm[1]); if(!row)return bad(res,404,'Review not found.');
      if(b.status!==undefined){ if(!['pending','approved'].includes(b.status))return bad(res,400,'Invalid status.'); db.prepare('UPDATE product_reviews SET status=? WHERE id=?').run(b.status,rm[1]); }
      if(b.verified!==undefined) db.prepare('UPDATE product_reviews SET verified=? WHERE id=?').run(b.verified?1:0,rm[1]);
      return json(res,200,{ok:true});
    }
    if(rm && req.method==='DELETE'){
      if(!requireAdmin(req,res))return;db.prepare('DELETE FROM product_reviews WHERE id=?').run(rm[1]);return json(res,200,{ok:true});
    }
    let match=route.match(/^\/api\/products\/([a-f0-9-]+)$/i);
    if(match && req.method==='PATCH'){
      if(!requireAdmin(req,res))return;const body=await readJson(req);const product=saveProduct(body,match[1]);return json(res,200,{product});
    }
    if(match && req.method==='DELETE'){
      if(!requireAdmin(req,res))return;const existing=db.prepare('SELECT id FROM products WHERE id=?').get(match[1]);if(!existing)return bad(res,404,'Product not found.');
      const t=nowIso();db.prepare('UPDATE products SET active=0,updated_at=? WHERE id=?').run(t,match[1]);db.prepare('UPDATE variants SET active=0,updated_at=? WHERE product_id=?').run(t,match[1]);return json(res,200,{ok:true});
    }
    if(route==='/api/dashboard'&&req.method==='GET'){
      if(!requireAdmin(req,res))return;
      const recentOrders=db.prepare('SELECT id,order_number,customer_name,phone,total,status,created_at FROM orders ORDER BY created_at DESC LIMIT 8').all().map(o=>({...o,total:Number(o.total)}));
      const lowStock=db.prepare(`SELECT v.id AS variantId,v.sku,v.color,v.size,v.stock,p.id AS productId,p.name AS productName FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1 AND v.active=1 AND v.stock<=3 ORDER BY v.stock ASC,p.name LIMIT 12`).all().map(v=>({...v,stock:Number(v.stock)}));
      return json(res,200,{counts:inventoryCounts(),recentOrders,lowStock});
    }
    if(route==='/api/whatsapp/webhook'&&req.method==='GET'){return wa.webhookGet(url,res);}
    if(route==='/api/whatsapp/webhook'&&req.method==='POST'){return await wa.webhookPost(req,res);}
    let waMatch=route.match(/^\/api\/orders\/([^/]+)\/whatsapp$/);
    if(waMatch&&req.method==='GET'){if(!requireAdmin(req,res))return;const details=wa.detail(waMatch[1]);if(!details)return bad(res,404,'Order not found');return json(res,200,details);}
    waMatch=route.match(/^\/api\/orders\/([^/]+)\/dispatch$/);
    if(waMatch&&req.method==='POST'){if(!requireAdmin(req,res))return;const body=await readJson(req,20*1024);return json(res,200,{dispatch:wa.courierDispatch(waMatch[1],body)});}
    // --- Category 3 Promo API Endpoints ---
    if (route === '/api/promos/validate' && req.method === 'POST') {
      const body = await readJson(req, 16 * 1024);
      const subtotal = Number(body.subtotal || 0);
      const phone = cleanText(body.phone, 30);
      const code = cleanText(body.code || body.promoCode, 30);
      if (!code) return bad(res, 400, 'Please enter a promo code.');
      try {
        const validated = validatePromoCode(code, subtotal, phone);
        return json(res, 200, { ok: true, promo: validated });
      } catch (err) {
        return bad(res, err.status || 400, err.message);
      }
    }
    if (route === '/api/admin/promos' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const promos = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_id = p.id) as redemption_count FROM promo_codes p ORDER BY p.created_at DESC`).all();
      const killSwitchRow = db.prepare("SELECT value FROM site_settings WHERE key='promos_disabled'").get();
      const promosDisabled = process.env.DISABLE_ALL_PROMOS === '1' || (killSwitchRow && killSwitchRow.value === '1');
      return json(res, 200, { promos, promosDisabled: !!promosDisabled });
    }
    if (route === '/api/admin/promos' && req.method === 'POST') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const b = await readJson(req, 32 * 1024);
      const code = cleanText(b.code, 30).toUpperCase();
      if (!code || !/^[A-Z0-9_-]{3,30}$/.test(code)) return bad(res, 400, 'Promo code must be 3-30 alphanumeric characters.');
      const type = b.type === 'fixed' ? 'fixed' : 'percentage';
      const value = Number(b.value);
      if (type === 'percentage' && (value <= 0 || value > 100)) return bad(res, 400, 'Percentage discount must be between 1 and 100.');
      if (type === 'fixed' && value <= 0) return bad(res, 400, 'Fixed PKR discount must be greater than 0.');
      const durationDays = Number(b.duration_days ?? b.durationDays ?? 30);
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) return bad(res, 400, 'Validity duration must be an integer between 1 and 365 days.');
      const startsAt = b.starts_at ? new Date(b.starts_at).toISOString() : new Date().toISOString();
      const expiresAt = new Date(new Date(startsAt).getTime() + durationDays * 86400000).toISOString();
      const minSubtotal = Math.max(0, Number(b.min_subtotal || 0));
      const maxDiscount = Math.max(0, Number(b.max_discount || 0));
      const usageLimit = Math.max(0, Number(b.usage_limit || 0));
      const perCustomerLimit = Math.max(1, Number(b.per_customer_limit || 1));
      const existing = db.prepare('SELECT id FROM promo_codes WHERE code=?').get(code);
      if (existing) return bad(res, 409, `Promo code ${code} already exists.`);
      const id = uid();
      const t = nowIso();
      db.prepare(`INSERT INTO promo_codes(id,code,type,value,starts_at,expires_at,status,min_subtotal,max_discount,usage_limit,per_customer_limit,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,code,type,value,startsAt,expiresAt,'active',minSubtotal,maxDiscount,usageLimit,perCustomerLimit,session.username,t);
      db.prepare(`INSERT INTO promo_audit(id,promo_id,admin_user,action,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(uid(), id, session.username, 'create', null, JSON.stringify({ code, type, value, durationDays, startsAt, expiresAt }), t);
      return json(res, 201, { ok: true, id, code });
    }
    let promoMatch = route.match(/^\/api\/admin\/promos\/([a-f0-9-]+)$/i);
    if (promoMatch && req.method === 'PATCH') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const id = promoMatch[1];
      const promo = db.prepare('SELECT * FROM promo_codes WHERE id=?').get(id);
      if (!promo) return bad(res, 404, 'Promo code not found.');
      const b = await readJson(req, 16 * 1024);
      const action = cleanText(b.action || b.status, 30);
      if (!['paused', 'active', 'revoked'].includes(action)) return bad(res, 400, 'Action must be active, paused, or revoked.');
      const t = nowIso();
      db.prepare('UPDATE promo_codes SET status=? WHERE id=?').run(action, id);
      db.prepare(`INSERT INTO promo_audit(id,promo_id,admin_user,action,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(uid(), id, session.username, action, promo.status, action, t);
      return json(res, 200, { ok: true, id, status: action });
    }
    if (route === '/api/admin/promos/toggle-all' && req.method === 'POST') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const b = await readJson(req, 8 * 1024);
      const disable = b.disable ? '1' : '0';
      db.prepare("INSERT INTO site_settings(key,value) VALUES('promos_disabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(disable);
      return json(res, 200, { ok: true, promosDisabled: disable === '1' });
    }

    if(route==='/api/orders'&&req.method==='POST'){
      // Customer checkout never needs multi-megabyte request bodies.
      const body=await readJson(req,64*1024);const order=createOrder(body,'website');if(!order.duplicate){try{wa.scheduleInitial(order);setImmediate(()=>wa.pump().catch(console.error));}catch(e){console.error('[WhatsApp setup]',e.message)}}return json(res,order.duplicate?200:201,{order,duplicate:!!order.duplicate});
    }
    if(route==='/api/orders/manual'&&req.method==='POST'){
      if(!requireAdmin(req,res))return;const body=await readJson(req);const order=createOrder(body,'whatsapp/manual');return json(res,201,{order});
    }
    if(route==='/api/orders'&&req.method==='GET'){
      if(!requireAdmin(req,res))return;const status=cleanText(url.searchParams.get('status'),30);const query=cleanText(url.searchParams.get('q'),120);
      let sql='SELECT * FROM orders WHERE 1=1';const args=[];if(status&&STATUSES.has(status)){sql+=' AND status=?';args.push(status);}if(query){sql+=' AND (order_number LIKE ? OR customer_name LIKE ? OR phone LIKE ?)';args.push(`%${query}%`,`%${query}%`,`%${query}%`);}sql+=' ORDER BY created_at DESC LIMIT 500';
      const orders=db.prepare(sql).all(...args).map(o=>({...getOrder(o.id),items:getOrder(o.id).items}));return json(res,200,{orders});
    }
    match=route.match(/^\/api\/orders\/([^/]+)\/status$/);
    if(match&&req.method==='PATCH'){
      if(!requireAdmin(req,res))return;const body=await readJson(req);const order=setOrderStatus(match[1],cleanText(body.status,30),cleanText(body.note,1000));return json(res,200,{order});
    }
    if(route==='/api/sales'&&req.method==='GET'){
      if(!requireAdmin(req,res))return;const from=cleanText(url.searchParams.get('from'),20);const to=cleanText(url.searchParams.get('to'),20);
      let sql='SELECT s.*,o.customer_name,o.phone,o.status FROM sales s JOIN orders o ON o.id=s.order_id WHERE 1=1';const args=[];
      if(/^\d{4}-\d{2}-\d{2}$/.test(from)){sql+=' AND substr(s.sold_at,1,10)>=?';args.push(from);}if(/^\d{4}-\d{2}-\d{2}$/.test(to)){sql+=' AND substr(s.sold_at,1,10)<=?';args.push(to);}sql+=' ORDER BY s.sold_at DESC LIMIT 1000';
      const sales=db.prepare(sql).all(...args).map(s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v])));
      const totals=sales.reduce((a,s)=>({orders:a.orders+1,merchandiseNet:a.merchandiseNet+Number(s.merchandise_net),delivery:a.delivery+Number(s.delivery_fee),collected:a.collected+Number(s.amount_collected),profit:a.profit+Number(s.estimated_profit)}),{orders:0,merchandiseNet:0,delivery:0,collected:0,profit:0});
      return json(res,200,{sales,totals});
    }
    if(route==='/api/stock/movements'&&req.method==='GET'){
      if(!requireAdmin(req,res))return;
      const rows=db.prepare(`SELECT m.*,v.sku,v.color,v.size,p.name AS product_name FROM stock_movements m LEFT JOIN variants v ON v.id=m.variant_id LEFT JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC LIMIT 500`).all().map(m=>({...m,changeQty:Number(m.change_qty)}));
      return json(res,200,{movements:rows});
    }
    match=route.match(/^\/api\/variants\/([a-f0-9-]+)\/adjust$/i);
    if(match&&req.method==='POST'){
      if(!requireAdmin(req,res))return;const body=await readJson(req);const variant=db.prepare('SELECT v.*,p.id AS pid,p.name FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(match[1]);if(!variant)return bad(res,404,'Variant not found.');
      let target;if(body.mode==='set')target=Number(body.stock);else target=Number(variant.stock)+Number(body.delta);
      if(!Number.isInteger(target)||target<0||target>1000000)return bad(res,400,'Stock must be a whole number from 0 to 1,000,000.');
      const delta=target-Number(variant.stock);const t=nowIso();db.prepare('UPDATE variants SET stock=?,updated_at=? WHERE id=?').run(target,t,variant.id);
      if(delta)db.prepare(`INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,\'\',?,?,?,?)`).run(uid(),variant.id,variant.pid,delta,'manual_adjustment',cleanText(body.note||'Manual stock adjustment',300),t);
      return json(res,200,{ok:true,stock:target,delta});
    }
    // Clean Page Routing (handles clean URLs and direct .html routes)
    const PAGE_ROUTES = {
      '/': 'index.html',
      '/index': 'index.html',
      '/index.html': 'index.html',
      '/admin': 'admin.html',
      '/admin.html': 'admin.html',
      '/product': 'product.html',
      '/products': 'product.html',
      '/product.html': 'product.html',
      '/bras': 'bras.html',
      '/bras.html': 'bras.html',
      '/panties': 'panties.html',
      '/panties.html': 'panties.html',
      '/sets': 'sets.html',
      '/sets.html': 'sets.html',
      '/accessories': 'accessories.html',
      '/accessories.html': 'accessories.html',
      '/body-shaper': 'body-shaper.html',
      '/body-shaper.html': 'body-shaper.html',
      '/camisole': 'camisole.html',
      '/camisole.html': 'camisole.html',
      '/exchange': 'exchange.html',
      '/exchange.html': 'exchange.html',
      '/reel': 'reel.html',
      '/reels': 'reel.html',
      '/reel.html': 'reel.html'
    };
    const cleanPath = (route.length > 1 && route.endsWith('/')) ? route.slice(0, -1) : route;
    if (PAGE_ROUTES[cleanPath]) {
      return serveFile(req, res, PAGE_ROUTES[cleanPath]);
    }

    if(route.startsWith('/uploads/')) {
      const name=route.slice('/uploads/'.length);if(!/^[a-f0-9-]+\.(?:jpg|png|webp|mp4|mov|webm)$/i.test(name))return bad(res,404,'Not found.');return serveFile(req,res,path.join('uploads',name));
    }
    if(route.startsWith('/videos/')) {
      const name=route.slice('/videos/'.length);if(!/^reel-[1-3]\.mp4$/i.test(name))return bad(res,404,'Not found.');return serveFile(req,res,path.join('videos',name));
    }
    if(route.startsWith('/fonts/')) {
      const name=route.slice('/fonts/'.length);if(!/^[a-zA-Z0-9_.-]+\.(?:woff|woff2|ttf|otf)$/i.test(name))return bad(res,404,'Not found.');return serveFile(req,res,path.join('fonts',name));
    }
    if(route.startsWith('/css/')) {
      const name=route.slice('/css/'.length);if(!/^[a-zA-Z0-9_.-]+\.css$/i.test(name))return bad(res,404,'Not found.');return serveFile(req,res,path.join('css',name));
    }
    if(route.startsWith('/js/')) {
      const name=route.slice('/js/'.length);if(!/^[a-zA-Z0-9_.-]+\.js$/i.test(name))return bad(res,404,'Not found.');return serveFile(req,res,path.join('js',name));
    }
    // Only expose intentional website assets. Never serve server.js, data/, backups, or other files.
    const publicFiles = new Set(['index.html','reel.html','product.html','bras.html','panties.html','sets.html','accessories.html','body-shaper.html','camisole.html','admin.html','inventory-store.js','exchange.html','hss-drawer-redesign.css','hss-fonts.css','fit-assistant-icon.png','brand-logo.jpg','logo.jpg','logo.png','logo.webp','favicon.ico']);
    const requestedFile=route.startsWith('/')?route.slice(1):route;
    if(publicFiles.has(requestedFile)) return serveFile(req,res,requestedFile);
    return bad(res,404,'Not found.');
  } catch (e) {
    if (e.status) return bad(res,e.status,e.message);
    console.error('Request error:',e);
    return bad(res,500,'Unexpected server error. Check the server console for details.');
  }
});
server.listen(PORT,HOST,()=>{
  console.log(`Her Second Skin PK website: http://${HOST}:${PORT}`);
  console.log(`Admin panel: http://${HOST}:${PORT}/admin`);
  console.log(`SQLite database: ${DB_PATH}`);
  if(HOST==='0.0.0.0')console.log('NOTICE: Exposed on all network interfaces. Use HTTPS and set COOKIE_SECURE=1 behind a trusted TLS proxy before public deployment.');
});
process.on('SIGINT',()=>{console.log('\nClosing store database...');try{db.close();}catch{}server.close(()=>process.exit(0));});
process.on('SIGTERM',()=>{try{db.close();}catch{}server.close(()=>process.exit(0));});
