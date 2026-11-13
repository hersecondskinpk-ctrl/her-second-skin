[v8 نوٹ: نیچے کے پرانے نوٹس میں 8 تصاویر اور ویڈیو نہ ہونے کا ذکر پرانا ہے۔ اب 20 تصاویر اور ویڈیو شامل ہیں۔ تازہ ہدایات کے لیے GUIDE-v8-UR.txt دیکھیں۔]

HER SECOND SKIN PK — INVENTORY & ORDER MANAGEMENT
=================================================

یہ پیکج آپ کی موجودہ ویب سائٹ کے ڈیزائن کو برقرار رکھتے ہوئے ایک حقیقی لوکل انوینٹری/آرڈر سسٹم فراہم کرتا ہے۔ ڈیٹا SQLite ڈیٹا بیس میں محفوظ ہوتا ہے؛ یہ صرف براؤزر کی عارضی فہرست نہیں ہے۔

کیا شامل ہے؟
------------
• Admin Panel: /admin پر محفوظ لاگ اِن
• پروڈکٹ بنانا/ایڈٹ کرنا، کیٹیگری، قیمت، لاگت، تفصیل، تصویر اپلوڈ یا امیج URL
• رنگ اور سائز کے ہر امتزاج کے لیے الگ SKU اور اسٹاک
• Stock History: ابتدائی اسٹاک، دستی اضافہ/کمی، آرڈر پر reserve اور منسوخی پر واپسی
• Orders: ویب سائٹ کے آرڈرز اور دستی درج کردہ WhatsApp آرڈرز
• Sales: Delivered آرڈر کی سیلز، وصول شدہ رقم اور درج شدہ لاگت کی بنیاد پر تخمینی منافع
• آرڈر Cancel کرنے پر اسٹاک واپس؛ Delivered کرنے پر Sales Record
• CSV میں سیلز رپورٹ ایکسپورٹ
• Sleepwear شامل نہیں ہے

شروع کرنے کا آسان طریقہ (Windows)
----------------------------------
1. ZIP فائل کو Extract کریں۔ تمام فائلیں اسی فولڈر میں رہنے دیں۔
2. کمپیوٹر پر Node.js کا نیا ورژن (22 یا اس سے اوپر) انسٹال کریں۔ اگر پہلے سے ہے تو دوبارہ انسٹال ضروری نہیں۔
3. START-HER-SECOND-SKIN.bat پر ڈبل کلک کریں۔ اس کی کمانڈ/سرور ونڈو کھلی رہنی چاہیے۔
4. ویب سائٹ عام طور پر خود کھلے گی: http://127.0.0.1:8787/
5. ایڈمن کھولیں: http://127.0.0.1:8787/admin
6. پہلی بار لاگ اِن کے لیے data\INITIAL-ADMIN-LOGIN.txt کھولیں۔ Username عموماً admin ہوگا۔
7. ایڈمن میں Settings جا کر فوراً نیا مضبوط پاس ورڈ رکھیں۔ کامیابی کے بعد ابتدائی پاس ورڈ والی فائل خود حذف ہو جاتی ہے۔
8. Products & Stock میں Add Product منتخب کریں۔ نام، کیٹیگری، فروخت کی قیمت، فی یونٹ لاگت، تصویر، پھر ہر رنگ/سائز کے لیے variant اور اسٹاک درج کریں۔ Save Product دبائیں۔
9. فعال پروڈکٹ ہوم پیج اور متعلقہ کیٹیگری صفحے پر دکھائی دے گی۔ جب بیک اینڈ چل رہا ہو تو نمونہ کیٹیگری پروڈکٹس کی جگہ یہی انوینٹری استعمال ہوگی۔

آرڈر اور اسٹاک کا اصول
--------------------
• گاہک ویب سائٹ پر موجود انوینٹری والی پروڈکٹ کا آرڈر دیتا ہے تو ریکارڈ Pending میں محفوظ ہوتا ہے اور اسٹاک فوراً reserve ہو جاتا ہے۔ WhatsApp کھلنے کے بعد گاہک کو وہاں Send بھی دبانا ہوگا۔
• Pending/Confirmed/Processing/Shipped آرڈر کو Cancel کرنے سے اسٹاک واپس آتا ہے۔ Cancelled آرڈر آخری حالت ہے؛ دوبارہ آرڈر بنائیں۔
• گاہک کا پارسل ملنے پر Orders میں اس آرڈر کو Delivered کریں۔ اسی وقت Sales Record بنتا ہے۔
• WhatsApp پر آنے والے عام چیٹ آرڈرز خود بخود WhatsApp سے نہیں پڑھے جا سکتے۔ انہیں Admin > Orders > Record WhatsApp Order میں دستی درج کریں۔
• سیلز میں Merchandise Net سے مراد item total منفی discount ہے۔ Estimated Profit صرف ریکارڈ شدہ product cost منہا کرتا ہے؛ Meta Ads، اصل courier cost، returns یا دیگر اخراجات شامل نہیں۔

ڈیٹا اور بیک اپ
---------------
• ڈیٹا بیس: data\her-second-skin.sqlite
• اپلوڈ کی گئی تصاویر: uploads\
• بیک اپ لینے کے لیے پہلے server window بند کریں، پھر BACKUP-DATABASE.bat چلائیں۔
• ڈیٹا بیس اور uploads دونوں کا بیک اپ ساتھ رکھیں؛ صرف HTML فائلیں ڈیٹا بیس کا متبادل نہیں۔

اہم: لوکل بمقابلہ Live ویب سائٹ
-------------------------------
ابھی START فائل چلانے سے ویب سائٹ صرف اسی کمپیوٹر پر کھلے گی۔ یہ خود بخود انٹرنیٹ پر Live نہیں ہو جاتی۔ حقیقی گاہکوں سے آن لائن آرڈر لینے کے لیے Node.js چلانے والی ہوسٹنگ، HTTPS، مستقل محفوظ database storage اور بیک اپ درکار ہیں۔ پبلک سرور پر اسے HTTPS کے بغیر یا غیر محفوظ طریقے سے expose نہ کریں۔

پہلی بار ڈیٹا بیس خالی ہوگا — اس میں کوئی فرضی پروڈکٹ یا اسٹاک seed نہیں کیا گیا، تاکہ نمونہ قیمتوں کو حقیقی قیمت یا دستیاب اسٹاک نہ سمجھا جائے۔

اضافی نوٹ
---------
• Inventory سرور فعال ہو تو ہوم پیج/کیٹیگری صفحات کے پرانے نمونہ کارڈز کی جگہ DB میں محفوظ حقیقی پروڈکٹس ظاہر ہوتی ہیں۔ اگر سرور/API دستیاب نہ ہو تو صفحہ sample inventory دکھانے کے بجائے availability پیغام دکھاتا ہے۔ براہِ کرم اس سسٹم میں index.html کو صرف ڈبل کلک کر کے استعمال نہ کریں؛ START-HER-SECOND-SKIN.bat سے چلائیں۔
• پہلے ورژن میں پہلے سے لکھی ہوئی Bundle/Combo آفرز آرڈر کے لیے عارضی طور پر بند رہتی ہیں، جب تک انہیں حقیقی variants کے ساتھ ترتیب نہ دیا جائے۔ یہ غلط stock reservation سے بچاتا ہے۔

2026 GALLERY UPGRADE NOTES
--------------------------
- The SQLite schema now creates a product_images table automatically on startup. This is additive and does not delete or rewrite existing products, variants, orders, or order history.
- Existing image_url values remain supported as legacy fallback images.
- Admin > Products & Stock > Add/Edit Product supports up to 8 gallery images (JPG/PNG/WebP, 3 MB each), previews, remove controls, and an optional color label for newly uploaded images. Leave the color blank for shared images. The first image is featured by default.
- Product APIs return an `images` array with URL, color, order, and primary-image metadata. The product modal shows images assigned to the selected color; when none exist, it shows only shared/legacy images and warns that no dedicated gallery is configured.
- To avoid accidental data loss, back up both `data\her-second-skin.sqlite` and `uploads\` before upgrading. Stop the server first, run BACKUP-DATABASE.bat, and separately copy the uploads folder.
- Node.js 22.13+ is required. Start on Windows using START-HER-SECOND-SKIN.bat. Local default URL: http://127.0.0.1:8787/.
- Product video upload, gallery drag-and-drop reordering, and a separate image gallery for every individual size/color SKU are not included in this upgrade. Color-specific images are assigned by the admin's optional color label.
- Testing performed in this delivery: JavaScript syntax checks and isolated startup/API smoke checks are reported in TEST-REPORT.txt. No live production database or customer checkout environment was supplied in the ZIP, so real customer data preservation and external WhatsApp delivery cannot be independently verified here.
