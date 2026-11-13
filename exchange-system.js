'use strict';
// Approved Her Second Skin PK bilingual exchange policy and auditable workflow.
// No external services; WhatsApp notifications are not claimed sent without approved templates.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const POLICY=require('./exchange-policy.json');
const REASONS=new Set(['wrong_size','wrong_colour','wrong_product','damaged','customer_selection_error']);
const STATUS={submitted:'Request submitted',needs_info:'More information needed',initial_approved:'Initial approval',return_in_transit:'Return in transit',courier_issue:'Courier investigation',received:'Return received',inspection_passed:'Inspection passed',approved:'Final approval',replacement_shipped:'Replacement dispatched',completed:'Exchange completed',rejected:'Request rejected',cancelled:'Request cancelled',refund_pending:'Refund approved',refunded:'Refund processed'};
const TRANSITIONS={
 submitted:['needs_info','initial_approved','rejected','cancelled'],
 needs_info:['submitted','initial_approved','rejected','cancelled'],
 initial_approved:['return_in_transit','received','rejected','cancelled'],
 return_in_transit:['received','courier_issue','rejected','cancelled'],
 courier_issue:['return_in_transit','received','rejected'],
 received:['inspection_passed','rejected'],
 inspection_passed:['approved','refund_pending','rejected'],
 approved:['replacement_shipped','refund_pending','cancelled'],
 replacement_shipped:['completed'],
 refund_pending:['refunded'],
 completed:[],rejected:[],cancelled:[],refunded:[]
};
const courierUrl=(value)=>{let s=String(value||'').trim(); if(!s)return ''; try{let u=new URL(s);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';return u.toString();}catch{return '';}};
module.exports.initExchanges=function({db,requireAdmin,readJson,json,bad,uid,nowIso,uploadRoot}){
 const folder=path.join(uploadRoot,'exchange-evidence-private');fs.mkdirSync(folder,{recursive:true,mode:0o700});
 db.exec(`
 CREATE TABLE IF NOT EXISTS exchange_requests(
  id TEXT PRIMARY KEY, exchange_number TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id), order_item_id TEXT NOT NULL REFERENCES order_items(id),
  reason TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', delivery_date TEXT NOT NULL, quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted', related_exchange_id TEXT NOT NULL DEFAULT '', replacement_variant_id TEXT NOT NULL DEFAULT '',
  replacement_reserved INTEGER NOT NULL DEFAULT 0, replacement_released INTEGER NOT NULL DEFAULT 0, original_restocked INTEGER NOT NULL DEFAULT 0,
  refund_amount INTEGER NOT NULL DEFAULT 0, courier TEXT NOT NULL DEFAULT '', tracking_code TEXT NOT NULL DEFAULT '', tracking_url TEXT NOT NULL DEFAULT '',
  customer_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_exchanges_order ON exchange_requests(order_id,created_at);
 CREATE INDEX IF NOT EXISTS idx_exchanges_status ON exchange_requests(status,updated_at);
 CREATE TABLE IF NOT EXISTS exchange_events(
  id TEXT PRIMARY KEY, exchange_id TEXT NOT NULL REFERENCES exchange_requests(id), status TEXT NOT NULL,
  public_note TEXT NOT NULL DEFAULT '', private_note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_exchange_events ON exchange_events(exchange_id,created_at);
 CREATE TABLE IF NOT EXISTS exchange_complaints(
  id TEXT PRIMARY KEY, exchange_id TEXT NOT NULL REFERENCES exchange_requests(id), details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', response TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, resolved_at TEXT NOT NULL DEFAULT ''
 );
 CREATE INDEX IF NOT EXISTS idx_exchange_complaints ON exchange_complaints(exchange_id,created_at);
 CREATE TABLE IF NOT EXISTS exchange_evidence(
  id TEXT PRIMARY KEY, exchange_id TEXT NOT NULL REFERENCES exchange_requests(id), file_name TEXT NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL
 );
 `);
 // A delivered order needs a frozen delivery timestamp for reliable three-calendar-day enforcement.
 const cols=db.prepare('PRAGMA table_info(orders)').all().map(r=>r.name);
 if(!cols.includes('delivered_at'))db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT');
 db.exec("UPDATE orders SET delivered_at=updated_at WHERE status='delivered' AND delivered_at IS NULL");
 const attempts=new Map();
 const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
 const num=(v)=>Number(v);
 const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
 function normalizePhone(phone){const p=String(phone||'').replace(/[^\d]/g,'');return p.startsWith('92')&&p.length===12?'0'+p.slice(2):p;}
 function dayPk(iso=new Date()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(iso);let o={};for(const p of parts)o[p.type]=p.value;return `${o.year}-${o.month}-${o.day}`;}
 function daysBetween(a,b){return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
 function checkRate(req){const key=req.socket.remoteAddress||'local';const t=Date.now();let v=attempts.get(key)||{time:t,count:0};if(t-v.time>15*60*1000)v={time:t,count:0};if(++v.count>40)fail('Too many requests. Please try later.',429);attempts.set(key,v);if(attempts.size>5000)attempts.clear();}
 function matchOrder(n,p){let number=clean(n,70),phone=normalizePhone(p);if(!number||!/^03\d{9}$/.test(phone))fail('Enter a valid order number and registered phone.');const row=db.prepare('SELECT * FROM orders WHERE order_number=?').get(number);if(!row||normalizePhone(row.phone)!==phone)fail('Order details could not be verified.',404);return row;}
 function rowInfo(r,admin=false){
  const events=db.prepare('SELECT status,public_note,actor,created_at FROM exchange_events WHERE exchange_id=? ORDER BY created_at ASC,id ASC').all(r.id);
  const out={id:r.id,number:r.exchange_number,orderNumber:r.order_number,product:r.product_name,sku:r.sku,size:r.size,color:r.color,reason:r.reason,quantity:r.quantity,description:r.description,deliveryDate:r.delivery_date,status:r.status,statusLabel:STATUS[r.status]||r.status,createdAt:r.created_at,updatedAt:r.updated_at,complaints:db.prepare('SELECT id,details,status,response,created_at,resolved_at FROM exchange_complaints WHERE exchange_id=? ORDER BY created_at DESC').all(r.id),courier:r.courier,trackingCode:r.tracking_code,trackingUrl:r.tracking_url,events};
  if(admin){Object.assign(out,{orderId:r.order_id,orderItemId:r.order_item_id,customerName:r.customer_name,phone:r.phone,address:r.address,refundAmount:r.refund_amount,adminNote:r.admin_note,customerNote:r.customer_note,relatedExchangeId:r.related_exchange_id,replacementVariantId:r.replacement_variant_id,replacementReserved:!!r.replacement_reserved,replacementReleased:!!r.replacement_released,originalRestocked:!!r.original_restocked,evidence:db.prepare('SELECT id,mime FROM exchange_evidence WHERE exchange_id=?').all(r.id).map(x=>({id:x.id,url:`/api/exchanges/${r.id}/evidence/${x.id}`,mime:x.mime}))});}
  return out;
 }
 const join=`SELECT e.*,o.order_number,o.customer_name,o.phone,o.address,i.product_name,i.sku,i.color,i.size,i.variant_id AS original_variant_id,i.product_id,i.quantity AS original_quantity,i.unit_price FROM exchange_requests e JOIN orders o ON e.order_id=o.id JOIN order_items i ON e.order_item_id=i.id`;
 const getRow=id=>db.prepare(join+' WHERE e.id=? OR e.exchange_number=?').get(id,id);
 function verificationItems(order){return db.prepare('SELECT id,product_name,sku,color,size,quantity FROM order_items WHERE order_id=?').all(order.id);}
 function photoBytes(v){
  const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v||''));if(!m)fail('Evidence must be a JPG, PNG or WebP image.');const b=Buffer.from(m[2],'base64');if(!b.length||b.length>2*1024*1024)fail('Each image must be under 2 MB.');
  const mime=m[1],sig=mime==='image/jpeg'?b[0]===255&&b[1]===216:mime==='image/png'?b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';if(!sig)fail('Invalid image contents.');return {b,mime,ext:{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime]};
 }
 function addEvent(id,status,publicNote,privateNote,actor,t){db.prepare('INSERT INTO exchange_events(id,exchange_id,status,public_note,private_note,actor,created_at) VALUES(?,?,?,?,?,?,?)').run(uid(),id,status,publicNote,privateNote,actor,t);}
 async function handle(req,res,route){
  if(route==='/api/exchange-policy'&&req.method==='GET'){json(res,200,{policy:POLICY,version:'2026-10-30',languages:['en','ur']});return true;}
  if(!route.startsWith('/api/exchanges'))return false;
  if(route==='/api/exchanges/verify'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,10*1024);const o=matchOrder(b.orderNumber,b.phone);
   json(res,200,{orderNumber:o.order_number,items:verificationItems(o),exchanges:db.prepare('SELECT exchange_number,status,created_at FROM exchange_requests WHERE order_id=? ORDER BY created_at DESC').all(o.id)});return true;
  }
  if(route==='/api/exchanges/track'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,10*1024);const o=matchOrder(b.orderNumber,b.phone);
   const rows=db.prepare(join+' WHERE e.order_id=? ORDER BY e.created_at DESC').all(o.id);
   const shipping=db.prepare('SELECT courier,tracking,tracking_link,dispatch_date,stage FROM wa_orders WHERE order_id=?').get(o.id);
   json(res,200,{orderNumber:o.order_number,orderStatus:o.status,orderUpdatedAt:o.updated_at,shipping:shipping&&shipping.courier?{courier:shipping.courier,trackingCode:shipping.tracking,trackingUrl:courierUrl(shipping.tracking_link),dispatchDate:shipping.dispatch_date}:null,exchanges:rows.map(r=>rowInfo(r))});return true;
  }
  if(route==='/api/exchanges'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,7*1024*1024);const order=matchOrder(b.orderNumber,b.phone);
   const item=db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(clean(b.orderItemId,80),order.id);if(!item)fail('Choose a valid item from your order.');
   const reason=clean(b.reason,40);if(!REASONS.has(reason))fail('Choose a valid exchange reason.');
   const desc=clean(b.description,1200);if(desc.length<8)fail('Please describe the problem (at least 8 characters).');
   const quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>item.quantity)fail('Invalid quantity.');
   const deliveryDate=clean(b.deliveryDate,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)||!Number.isFinite(Date.parse(deliveryDate+'T00:00:00Z')))fail('Enter a valid delivery date.');
   const today=dayPk(),age=daysBetween(deliveryDate,today);
   if(age<0||age>3)fail('Exchange requests must be submitted within 3 calendar days of delivery.',409);
   if(Date.parse(deliveryDate)<Date.parse(dayPk(new Date(order.created_at))))fail('Delivery date cannot be before the order date.');
   if(order.delivered_at){const actualAge=daysBetween(dayPk(new Date(order.delivered_at)),today);if(actualAge>3)fail('The recorded order delivery date exceeds the 3-day exchange window.',409);}
   const previous=db.prepare("SELECT id,quantity,status FROM exchange_requests WHERE order_item_id=? ORDER BY created_at DESC").all(item.id);
   const active=previous.filter(r=>!['rejected','cancelled','completed','refunded'].includes(r.status));
   if(active.reduce((sum,r)=>sum+r.quantity,0)+quantity>item.quantity)fail('An active request already covers the selected quantity.',409);
   if(previous.some(r=>r.status==='refunded'))fail('A refunded item is not eligible for another exchange.',409);
   const completed=previous.find(r=>r.status==='completed');
   if(completed&&(!b.replacementRelated||reason==='customer_selection_error'))fail('A second exchange is only considered if the replacement itself has a verified company-related issue.',409);
   const photos=Array.isArray(b.photos)?b.photos:[];if(!photos.length||photos.length>3)fail('Attach 1 to 3 clear product photos.');
   const imgs=photos.map(photoBytes);const id=uid(),t=nowIso(),number='EX-'+new Date().getUTCFullYear()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();const written=[];
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('INSERT INTO exchange_requests(id,exchange_number,order_id,order_item_id,reason,description,delivery_date,quantity,related_exchange_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,number,order.id,item.id,reason,desc,deliveryDate,quantity,completed?completed.id:'',t,t);
    for(const img of imgs){const photoId=uid(),name=photoId+'.'+img.ext;fs.writeFileSync(path.join(folder,name),img.b,{flag:'wx',mode:0o600});written.push(name);db.prepare('INSERT INTO exchange_evidence(id,exchange_id,file_name,mime,created_at) VALUES(?,?,?,?,?)').run(photoId,id,name,img.mime,t);}
    addEvent(id,'submitted','Your exchange request has been received. Initial review normally takes up to 48 hours.','','customer',t);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');for(const f of written)try{fs.unlinkSync(path.join(folder,f));}catch{}throw e;}
   json(res,201,{number,orderNumber:order.order_number,status:'submitted',message:'Exchange request recorded. Track progress using your order number and registered phone.'});return true;
  }
  if(route==='/api/exchanges/cancel'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,10*1024),o=matchOrder(b.orderNumber,b.phone),r=getRow(clean(b.exchangeNumber,80));
   if(!r||r.order_id!==o.id)fail('Exchange request not found.',404);
   if(!['submitted','needs_info','initial_approved'].includes(r.status))fail('Courier pickup may already have started. Please contact support for review.',409);
   const t=nowIso();db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE exchange_requests SET status=?,updated_at=? WHERE id=?').run('cancelled',t,r.id);addEvent(r.id,'cancelled','Cancelled at the customer’s request.','','customer',t);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{ok:true,status:'cancelled'});return true;
  }
  if(route==='/api/exchanges/change'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,12*1024),o=matchOrder(b.orderNumber,b.phone),r=getRow(clean(b.exchangeNumber,80));
   if(!r||r.order_id!==o.id)fail('Exchange request not found.',404);
   if(!['submitted','needs_info','initial_approved'].includes(r.status))fail('Pickup has started. Please ask the team to review this change.',409);
   const reason=clean(b.reason,40),description=clean(b.description,1200);if(!REASONS.has(reason)||description.length<8)fail('Provide a valid reason and description.');
   const t=nowIso();db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE exchange_requests SET reason=?,description=?,status=?,updated_at=? WHERE id=?').run(reason,description,'submitted',t,r.id);addEvent(r.id,'submitted','Customer updated the request; pending renewed review.','','customer',t);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{ok:true,status:'submitted'});return true;
  }
  if(route==='/api/exchanges/complaints'&&req.method==='POST'){
   checkRate(req);const b=await readJson(req,10*1024),o=matchOrder(b.orderNumber,b.phone),r=getRow(clean(b.exchangeNumber,80));if(!r||r.order_id!==o.id)fail('Exchange not found.',404);
   const details=clean(b.details,1000);if(details.length<10)fail('Please explain your complaint in at least 10 characters.');
   const t=nowIso(),id=uid();db.prepare('INSERT INTO exchange_complaints(id,exchange_id,details,created_at) VALUES(?,?,?,?)').run(id,r.id,details,t);json(res,201,{ok:true,complaintId:id,message:'Complaint received. Written review response normally within 3 working days.'});return true;
  }
  const comp=route.match(/^\/api\/exchanges\/complaints\/([a-f0-9-]+)$/i);
  if(comp&&req.method==='PATCH'){
   if(!requireAdmin(req,res))return true;const b=await readJson(req,10*1024),text=clean(b.response,1500);if(text.length<5)fail('Provide a written response.');const row=db.prepare('UPDATE exchange_complaints SET status=?,response=?,resolved_at=? WHERE id=?').run('responded',text,nowIso(),comp[1]);if(!row.changes)fail('Complaint not found.',404);json(res,200,{ok:true});return true;
  }
  if(route==='/api/exchanges'&&req.method==='GET'){
   if(!requireAdmin(req,res))return true;
   const rows=db.prepare(join+' ORDER BY e.created_at DESC LIMIT 500').all();json(res,200,{exchanges:rows.map(r=>rowInfo(r,true)),statuses:STATUS,transitions:TRANSITIONS});return true;
  }
  const proof=route.match(/^\/api\/exchanges\/([a-f0-9-]+)\/evidence\/([a-f0-9-]+)$/i);
  if(proof&&req.method==='GET'){
   if(!requireAdmin(req,res))return true;
   const f=db.prepare('SELECT file_name,mime FROM exchange_evidence WHERE exchange_id=? AND id=?').get(proof[1],proof[2]);if(!f){bad(res,404,'Image not found.');return true;}
   res.writeHead(200,{'Content-Type':f.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'"});fs.createReadStream(path.join(folder,f.file_name)).pipe(res);return true;
  }
  const admin=route.match(/^\/api\/exchanges\/([a-f0-9-]+)\/status$/i);
  if(admin&&req.method==='PATCH'){
   if(!requireAdmin(req,res))return true;
   const b=await readJson(req,24*1024);let r=getRow(admin[1]);if(!r){bad(res,404,'Request not found.');return true;}
   const status=clean(b.status,40);if(!STATUS[status]||!(TRANSITIONS[r.status]||[]).includes(status))fail('Invalid status transition: '+r.status+' → '+status,409);
   const note=clean(b.publicNote,500),privateNote=clean(b.privateNote,1500),courier=clean(b.courier,120),trackingCode=clean(b.trackingCode,120),trackingUrl=clean(b.trackingUrl,500);
   if(trackingUrl&&!courierUrl(trackingUrl))fail('Tracking URL must begin with https:// or http://.');
   if(status==='rejected'&&!note)fail('Explain the rejection to the customer.');
   if(status==='replacement_shipped'&&(!courier||!trackingCode))fail('Courier name and tracking code are required before dispatch.');
   const refund=b.refundAmount===undefined?num(r.refund_amount):num(b.refundAmount);if(!Number.isInteger(refund)||refund<0||refund>Number(r.unit_price)*r.quantity)fail('Invalid refund amount.');
   const replacement=clean(b.replacementVariantId,80)||r.replacement_variant_id;
   const newQty=r.quantity;let replacementItem=null;
   if(status==='approved'&&replacement){replacementItem=db.prepare('SELECT v.id,v.product_id,v.stock,v.active,p.active AS product_active FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(replacement);if(!replacementItem||!replacementItem.active||!replacementItem.product_active||replacementItem.stock<newQty)fail('Selected replacement variant does not have sufficient stock.',409);}
   if(status==='approved'&&!replacement)fail('Choose the replacement variant before final approval.');
   if(status==='refund_pending'&&refund<=0)fail('Specify the approved refund amount.');
   if(b.restockOriginal&&!['inspection_passed','approved'].includes(status))fail('Original stock can be restocked only after inspection.');
   const t=nowIso();db.exec('BEGIN IMMEDIATE');try{
    // Reserve a replacement only once, at final approval. All stock changes are audited.
    if(status==='approved'&&replacement&&!r.replacement_reserved){
     const update=db.prepare('UPDATE variants SET stock=stock-?,updated_at=? WHERE id=? AND stock>=?').run(newQty,t,replacement,newQty);if(update.changes!==1)fail('Replacement stock is no longer available.',409);
     db.prepare('INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uid(),replacement,replacementItem.product_id,r.order_id,-newQty,'exchange_replacement','Reserved for '+r.exchange_number,t);
    }
    if((status==='cancelled'||status==='refund_pending')&&r.replacement_reserved&&!r.replacement_released){
     const v=db.prepare('SELECT product_id FROM variants WHERE id=?').get(r.replacement_variant_id);
     if(v){db.prepare('UPDATE variants SET stock=stock+?,updated_at=? WHERE id=?').run(newQty,t,r.replacement_variant_id);db.prepare('INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uid(),r.replacement_variant_id,v.product_id,r.order_id,newQty,'exchange_replacement_released','Released for '+r.exchange_number,t);}
    }
    if(b.restockOriginal&&!r.original_restocked){
     db.prepare('UPDATE variants SET stock=stock+?,updated_at=? WHERE id=?').run(newQty,t,r.original_variant_id);
     db.prepare('INSERT INTO stock_movements(id,variant_id,product_id,order_id,change_qty,reason,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uid(),r.original_variant_id,r.product_id,r.order_id,newQty,'exchange_return_inspected','Inspected suitable return '+r.exchange_number,t);
    }
    db.prepare(`UPDATE exchange_requests SET status=?,replacement_variant_id=?,replacement_reserved=?,replacement_released=?,original_restocked=?,refund_amount=?,courier=?,tracking_code=?,tracking_url=?,admin_note=?,updated_at=? WHERE id=?`).run(status,replacement,(r.replacement_reserved||(status==='approved'&&!!replacement))?1:0,(r.replacement_released||((status==='cancelled'||status==='refund_pending')&&r.replacement_reserved))?1:0,(r.original_restocked||!!b.restockOriginal)?1:0,refund,courier||r.courier,trackingCode||r.tracking_code,trackingUrl?rackingUrlSafe(trackingUrl):r.tracking_url,privateNote||r.admin_note,t,r.id);
    addEvent(r.id,status,note,privateNote,'admin',t);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{exchange:rowInfo(getRow(r.id),true)});return true;
  }
  bad(res,404,'Exchange route not found.');return true;
 }
 function rackingUrlSafe(v){return courierUrl(v);}
 return {handle,statuses:STATUS};
};
