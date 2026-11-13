# Fly.io پر مفت ڈیپلائمنٹ گائیڈ (Fly.io Free Deployment Guide)
**Her Second Skin PK (v9)**

Fly.io کا سب سے بڑا فائدہ یہ ہے کہ یہ **مفت 1GB/3GB مستقل ڈسک (Persistent Volume)** دیتا ہے، جس کی وجہ سے SQLite ڈیٹا بیس اور اپ لوڈ کردہ پروڈکٹ فوٹوز کبھی ڈیلیٹ نہیں ہوتیں۔

---

### آسان 3 مراحل (Steps to Deploy):

#### مرحلہ 1: اپنے کمپیوٹر پر Fly CLI انسٹال کریں
PowerShell ونڈو کھولیں اور یہ کمانڈ چلائیں:
```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

#### مرحلہ 2: لاگ اِن کریں (Login)
چونکہ آپ نے پہلے ہی براؤزر میں Fly.io پر لاگ اِن کر رکھا ہے، بس یہ کمانڈ چلائیں:
```powershell
fly auth login
```
یہ آپ کے براؤزر میں ایک ونڈو کھولے گا جس پر آپ "Confirm" دبا دیں گے۔

#### مرحلہ 3: پروجیکٹ فولڈر میں جا کر لانچ کریں
پروجیکٹ کے فولڈر میں جا کر یہ کمانڈ چلائیں:
```powershell
fly launch
```
* یہ آپ سے پوچھے گا: *"An existing fly.toml file was found. Would you like to copy its configuration to the new app?"* -> آپ **Yes (Y)** دبائیں۔
* یہ خود ہی `hss_data` کے نام سے مفت 1GB کی مستقل ڈسک بنا لے گا۔
* آخر میں پوچھے گا: *"Do you want to deploy now?"* -> آپ **Yes (Y)** دبائیں۔

---

### مبارک ہو! 
آپ کو فوراً لائیو لنک مل جائے گا:
`https://her-second-skin-pk.fly.dev`

اس پر:
1. SQLite ڈیٹا بیس ہمیشہ محفوظ رہے گا۔
2. تمام اپ لوڈ کردہ تصاویر پرماننٹ رہیں گی۔
3. کارٹ، چیک آؤٹ اور ایڈمن پینل مکمل کام کریں گے۔
