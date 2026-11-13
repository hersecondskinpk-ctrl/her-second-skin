# ہوسٹنگ، ڈیٹا پرسیٹنس اور بیک اپ گائیڈ (Hosting, Persistence & Backup Guide)
**Her Second Skin PK (v9)**

---

### 1. رینڈر سرور پر ڈیٹا لوس کا مسئلہ اور مستقل حل (Ephemeral Storage vs Persistent Disk)

* **مسئلہ:**  
  Render کے مفت ٹائر (Free Tier) پر جو بھی ڈیٹا یا تصاویر اپ لوڈ کی جاتی ہیں، وہ عارضی (Ephemeral) ہوتی ہیں۔ سرور کے ری سٹارٹ یا دوبارہ ڈیپلائی ہونے پر `data/` اور `uploads/` کا سارا ڈیٹا ضائع ہو جاتا ہے۔
* **مستقل حل (Persistent Disk Mount):**  
  Render کی پیڈ سروس میں ایک **Persistent Disk** بنا کر اسے `/var/data` پر ماؤنٹ کیا جاتا ہے، اور ماحولیاتی متغیرات (Environment Variables) میں درج ذیل سیٹنگز رکھی جاتی ہیں:
  ```env
  HSS_DATA_DIR=/var/data
  HSS_DATABASE_PATH=/var/data/her-second-skin.sqlite
  HSS_UPLOAD_DIR=/var/data/uploads
  ```
  اس طرح سرور کے ری سٹارٹ یا کوڈ اپ ڈیٹ ہونے پر بھی SQLite ڈیٹا بیس اور پروڈکٹ کی تمام تصاویر اور ویڈیوز 100% محفوظ رہتی ہیں۔

---

### 2. ہوسٹنگ لاگت اور موازنہ (12-Month Hosting Cost Comparison)

| حل (Option) | تفصیل | ماہانہ لاگت | سالانہ لاگت (PKR تخمینہ) | ڈیٹا کا تحفظ |
| :--- | :--- | :---: | :---: | :--- |
| **Render Paid Instance + Disk** | 512MB RAM + 1GB Persistent Disk | ~$7.25 / ماہ | ~24,500 PKR / سال | مکمل محفوظ، آٹو سلیپ ختم |
| **سستا Cloud VPS (Hetzner / Hostinger)** | 1 vCPU, 2GB RAM, 20GB NVMe SSD | ~$4.50 / ماہ | ~15,500 PKR / سال | بہترین کارکردگی، مستقل ڈسک |

> [!NOTE]  
> ٹیسٹنگ کے دوران آپ موجودہ لوکل کمپیوٹر یا رینڈر کا فری ٹیسٹ ماحول استعمال کر سکتے ہیں، جبکہ پروڈکشن میں لائیو جاتے وقت ہی اوپر دی گئی پیڈ آپشنز کا انتخاب کیا جائے۔

---

### 3. ڈیٹا بیس کا خودکار بیک اپ اور بحالی (Backup & Restore Drill)

* **لوکل بیک اپ اسکرپٹ:**  
  `node scripts/backup_restore_drill.js`
* یہ اسکرپٹ:
  1. SQLite ڈیٹا بیس کا WAL-safe بیک اپ لیتا ہے۔
  2. تمام پروڈکٹ تصاویر اور میڈیا کو `backups/` فولڈر میں کاپی کرتا ہے۔
  3. الگ ٹیسٹ ڈیٹا بیس میں ڈیٹا بحال کر کے `PRAGMA integrity_check` چلاتا ہے اور تصدیق کرتا ہے۔
