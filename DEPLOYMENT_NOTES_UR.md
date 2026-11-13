# Her Second Skin PK — Deployment سے پہلے

یہ Production Release نہیں ہے۔ اصل Render Website میں ابھی کوئی تبدیلی نہیں کی گئی۔ Final ZIP صارف کے کہنے سے پہلے نہ بنائیں اور نہ بھیجیں۔

1. GitHub/Render پر رسائی کی تصدیق کریں۔ کسی سے API Token یا Admin Password چیٹ میں نہ مانگیں۔
2. Production SQLite Database، WAL/SHM (اگر موجود ہوں)، اور تمام Uploads کا محفوظ Backup لیں، Restore Test کریں۔
3. Render پر Persistent Disk یا اس کے مساوی پائیدار Storage یقینی بنائیں۔ `HSS_DATABASE_PATH` اور `HSS_UPLOAD_DIR` اسی Persistent Path میں ہوں۔ `HSS_DATABASE_PATH` استعمال ہو تو Uploaded Images اس کے ساتھ والے uploads فولڈر میں ڈیفالٹ محفوظ ہوتی ہیں۔
4. Production Server Start اور Additive Database Migrations کی Verification کریں۔ پرانے Orders، Stock اور Images کا Audit کریں۔
5. `https://YOUR-EXISTING-DOMAIN/exchange.html` پر English/Urdu Policy، Request، Track اور Complaint Tests کریں۔ Customer کو اپنے Order Number اور Registered Mobile کی تصدیق کرنا ہوگی۔
6. Admin میں Exchanges & Refunds کھولیں اور Status، Notes، Courier Tracking، Refund Record اور Stock Changes Test کریں۔
7. Courier Tracking Link اس کے اپنے سرکاری Webpage پر جائے گا۔ 25-second polling داخلی ویب سائٹ Status کے لیے ہے، GPS نہیں۔
8. Meta Approval اور الگ WhatsApp Tests مکمل ہونے تک WhatsApp Automation Enabled نہ کریں۔
