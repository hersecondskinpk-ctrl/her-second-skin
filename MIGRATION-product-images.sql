-- Additive migration. The application runs equivalent CREATE TABLE IF NOT EXISTS
-- statements automatically on startup. Run only after taking a verified backup.
CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  image_url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_images_gallery
  ON product_images(product_id, color, sort_order);
