# HANDOFF — Interview Survey (โคลนจาก banphai-survey)

> 🚨 **ระบบเดิม (`banphai-survey`) ยังใช้งานจริงอยู่ — ห้ามแตะ ห้ามผูกอะไรกลับไปหามัน**
> โปรเจกต์นี้แยกขาด: คนละ repo · คนละ Firebase project · คนละ key ใน localStorage/IndexedDB/Cache
> **ก่อนแก้อะไรที่เกี่ยวกับ storage key หรือ `sw.js` → อ่าน [`SETUP.md`](SETUP.md) หัวข้อ "ทำไมต้องแยกให้ครบ" ก่อน**
> (repo ใหม่อยู่บน origin `itsminimize.github.io` เดียวกับระบบเดิม → storage ใช้ร่วมกันทั้ง origin)

> ส่งต่อให้ session ใหม่ · โคลน 2026-08-05 · เนื้อหาเดิมอัปเดต 2026-06-16
> ระบบ: 2 แอปสำรวจ (Roadside/Home) + Dashboard analytics + เครื่องมือ admin · ค้นหาสถานที่ multi-provider + auto-learn · รองรับ 40-100 คนพร้อมกัน
> 🔎 ดู log งานทั้งหมดได้ที่ `git log` (ทุก commit มีคำอธิบาย) · สรุปอัปเดตล่าสุดดูข้อ 12

---

## 1. ภาพรวมระบบ
- **Stack:** Vanilla JS · Firebase (Firestore + Auth) · localStorage · PWA (Service Worker)
- **Hosting:** GitHub Pages (static) — `https://itsminimize.github.io/interview-survey/`
- **Repo:** github.com/ITSMINIMIZE/interview-survey · branch `main` (deploy = push main)
- **2 แอป:** `Roadside/` (ธีมส้ม #d97706 · สัมภาษณ์ริมทาง OD) · `Home/` (ธีมน้ำเงิน #2563eb · ครัวเรือน)
- **Dashboard/** = ✅ แอป analytics (ลิงก์จากหน้าแรกแล้ว) — login admin → OD matrix · desire lines · choropleth · peak hour · สถิติ + แผนที่ · อ่าน Firestore ตรง (ดูข้อ 12)
- **ไม่มี backend server ของเราเอง** — แอป static คุยตรงกับ Firebase + Longdo/Google API จากเบราว์เซอร์

### โหลดที่คาดไว้ (งานจริง)
- Roadside: ~50-60 คนพร้อมกัน · ~100 คัน/คน/วัน · 1-3 วัน
- Home: ~100 คนพร้อมกัน · ~15 บ้าน/คน/วัน · 2 วัน
- ทุกคนทำพร้อมกัน (concurrency สูง)

---

## 2. ไฟล์สำคัญ
```
{Roadside,Home}/js/place-service.js   ← เหมือนกันเป๊ะทั้ง 2 (cp ไป Home) · search + auto-learn + config + cache
{Roadside,Home}/js/map-leaflet.js     ← MapPicker · ต่างกันแค่ธีม (ACCENT/HOVER/comment บรรทัด 1)
{Roadside,Home}/js/app.js             ← แอปหลัก · _reverseGeocode/_useGPS/_openIvMap/_openHhMap/ฟอร์ม
{Roadside,Home}/js/firebase.js        ← FB sync + auth · schema NESTED · Home มี login admin/surveyor (ดูข้อ 12)
{Roadside,Home}/js/data.js            ← OPT (ประเภท/วัตถุประสงค์ ฯลฯ) · local DB (members/trips เป็น array ฝังใน household)
{Roadside,Home}/{index.html,sw.js,manifest.json,css/}
index.html (root)                     ← เมนู (Home/Roadside/Dashboard) + ไอคอน ⚙ มุมล่างขวา → tools/
Dashboard/{index.html,js/dashboard.js,js/mapDashboard.js,js/zones.js}  ← analytics · login admin · อ่าน Firestore ตรง
tools/auth-gate.js                    ← gate กลางทุกหน้า tools = บังคับ login Firebase admin (แทนรหัสฝัง client เดิม)
tools/projects.html                   ← จัดการโครงการ + แต่งตั้งผู้ควบคุม (gate = auth-gate.js)
(เมนูเครื่องมือย้ายไป sidebar ในหน้าแรกแล้ว — tools/index.html ถูกลบ)
tools/config.html                     ← admin แก้ API key (login) → Firestore config/app
tools/seed-places.html                ← pre-seed สถานที่ (Excel import)
tools/seed-roadside.html, seed-home.html, cleanup-seed.html  ← สร้าง/ลบ test data (เขียน Firestore แบบ nested)
```
**แก้ไฟล์คู่:** place-service → `cp Roadside/js/place-service.js Home/js/place-service.js`
map-leaflet → แก้ Roadside แล้ว:
```
sed -e 's/Roadside theme ส้ม/Home theme น้ำเงิน/' -e "s/ACCENT: '#d97706'/ACCENT: '#2563eb'/" \
    -e "s/HOVER:  '#fef3c7'/HOVER:  '#dbeafe'/" -e 's/ธีมส้ม/ธีมน้ำเงิน/' \
    Roadside/js/map-leaflet.js > Home/js/map-leaflet.js
```
**ทุกครั้งที่แก้ JS แอป → bump `CACHE_VERSION` ใน sw.js ทั้ง 2** (ปัจจุบัน `is-ri-v1` / `is-hi-v1` — ⚠️ ห้ามแก้ CACHE_PREFIX (ดู docs/SETUP.md))

---

## 3. PlaceService (หัวใจระบบค้นหา) — `place-service.js`
**ค้นหาแบบ staged (ประหยัด API):**
- `searchLocal(q)` → ค้นใน cache เท่านั้น (พิมพ์สด · ไม่ยิง API)
- `searchLongdo(q)` → local + Longdo รวมกัน (กดปุ่ม "ค้นหา"/Enter)
- `searchGoogle(q)` → Google เท่านั้น (กดปุ่ม "🌐 ค้นเพิ่มใน Google" — เรียกเมื่อ Longdo ไม่เจอที่ต้องการ)
- **เลิกใช้ Nominatim ทั้งระบบ** (ติด throttle 1req/s)

**Auto-learn:** `savePlace({place_name,latitude,longitude,source,user_adjusted,created_by})`
- เรียกตอน MapPicker.confirm() → upsert เข้า Firestore `places` (shared ทุกคน)
- dedupe: ชื่อตรง (name_lower) + พิกัดใกล้ <150m → use_count++ · ไม่งั้น create ใหม่ (id=PL-ts)
- อัปเดต `_cache` ในเครื่องทันที (คนเพิ่มเห็นเลย)

**Cache (delta-sync + safety net) — `loadCache()`:**
- เปิดแอป/cache ว่าง (ไม่มี localStorage) → **full read** (snapshot ครบ = safety net)
- หลังจากนั้นทุก 15 นาที (CACHE_TTL) → **delta**: `where('updated_at','>', lastSync - 30min)` อ่านเฉพาะของใหม่
- error/offline → คง cache เดิม (search ไม่พัง) · localStorage เก็บ cache + lastSync (เครื่องเคยเปิด → reload เป็น delta ไม่ใช่ full)
- → read โตตาม "ของใหม่" ไม่ใช่ขนาดทั้งหมด · base ที่ pre-seed ไม่ถูกอ่านซ้ำ

**API key (`loadConfig()`):**
- ฝังในโค้ด: `LONGDO_KEY='4ffd5bcaa8a5941163c24dbe2a4401e8'`, `GOOGLE_KEY='AIzaSyAJzTlYmUTDCspYgcZ3ceebnAHeaHhbe0w'`
- override ได้จาก Firestore `config/app` (อ่าน **ครั้งเดียว/เซสชัน**) — แก้ผ่าน tools/config.html
- Google = Places API (New) `places.googleapis.com/v1/places:searchText` (CORS ได้) · referrer-restricted (itsminimize.github.io/* + localhost:5500/*) + Places API (New) เท่านั้น

---

## 4. MapPicker — `map-leaflet.js`
- **Signature เดิม ห้ามเปลี่ยน:** `MapPicker.open(currentCoords, (coords, name) => {})`
- **Lazy-load แผนที่:** เปิด picker → เห็นช่องค้นหา + ผลลัพธ์ (ยังไม่โหลด tiles) · แผนที่ render เฉพาะตอนกด "เปิดแผนที่/ปักหมุดเอง" / "ดู-ปรับบนแผนที่" (หลังเลือกผล) / "เพิ่มสถานที่ใหม่" → `_openMapView()`
- เลือกผลค้นหา → ได้พิกัดเลย ยืนยันได้โดยไม่ต้องเปิดแผนที่ (ส่วนใหญ่ = 0 tiles)
- tiles = **OSM** (`tile.openstreetmap.org`) — เก็บแยกจาก Longdo (ไม่แย่ง 60/นาที กับ search)
- default view = ประเทศไทย (13.5, 100.9 zoom 5) + ลอง GPS พื้นหลังเงียบๆ · MARKER_ZOOM=16
- confirm() → savePlace (best-effort) ก่อน callback · created_by = App._role==='admin'? _adminUsername : _surveyorName

---

## 5. app.js — GPS / reverse / map buttons
- `_reverseGeocode(lat,lon)` → **Longdo address API** (`api.longdo.com/map/services/address`) เติม ตำบล/อำเภอ/จังหวัด (ตัด prefix ต./อ./จ.) · Home=m_*, Roadside=s_* (station)
- `_useGPS(coordsId)` → high-accuracy ก่อน, timeout/หาไม่เจอ → retry แบบผ่อนปรน (ha:false, 20s, ใช้ค่าล่าสุด) · error message ตรงสาเหตุ (บล็อก/ปิด GPS/timeout)
- ปุ่มแผนที่ในฟอร์ม: Roadside `_openStationMap`(station) + `_openIvMap`(ต้น/ปลายทาง interview) · Home `_openHhMap`(ครัวเรือน) + `_openMap`(trip dest)
- reverse ใช้ตอนสำรวจจริง: **Home ครัวเรือน** (เยอะ) · Roadside แค่ตอน admin ตั้ง station (ไม่กระทบ concurrency)

---

## 6. Firestore
**Collections:** `households/{}/members/{}/trips/{}` · `roadside_stations/{}/interviews/{}` · `places/{}` · `config/{}`

**Rules — ไฟล์จริงอยู่ที่ [`../firestore.rules`](../firestore.rules) (ต้อง publish เข้า Console ของโปรเจกต์ใหม่เอง · ดู SETUP.md ข้อ 2):**
```
rules_version='2';
service cloud.firestore { match /databases/{database}/documents {
  function isSeed(id){ return id.matches('.*SEED.*'); }
  match /households/{hhId} {
    allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId);
    match /members/{mId} {
      allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId)||isSeed(mId);
      match /trips/{tId} { allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId)||isSeed(mId)||isSeed(tId); }
    }
  }
  match /roadside_stations/{stId} {
    allow read:if true; allow create,update:if true; allow delete:if isSeed(stId);
    match /interviews/{ivId} { allow read:if true; allow create,update:if true; allow delete:if isSeed(stId)||isSeed(ivId); }
  }
  match /places/{placeId} { allow read:if true; allow create,update:if true; allow delete:if false; }
  match /config/{docId} { allow read:if true; allow write:if request.auth!=null; }
}}
```
(delete = เฉพาะ doc ที่ id มี "SEED" → tools/cleanup-seed ลบ test ได้โดยไม่ต้องแก้ rule · config เขียนเฉพาะ admin login)

**places schema:** `{id, place_name, name_lower, keywords[], latitude, longitude, source, confidence, user_adjusted, use_count, created_at, created_by, updated_at}`
**config/app:** `{google_places_key, longdo_key, updated_at, updated_by}` (ว่าง = ใช้ key ในโค้ด)

**Firebase config:** ดู `docs/SETUP.md` — โปรเจกต์ใหม่ · EMAIL_DOMAIN `@interview-survey.local` (ค่าในโค้ดเป็น PASTE_* จนกว่าจะรัน `set-firebase-config.sh`)

---

## 7. Quota / scale (จัดการแล้ว)
- **Firestore:** ไป Blaze (ถูกมาก ~$1-3 สำหรับงานนี้) · delta-sync ทำให้ read โตตามของใหม่ · **ต้องตั้ง budget alert**
- **Longdo free:** service 100k/เดือน · **60 req/นาที + 5,000 req/วัน** (ตัวบีบ) · tiles 800k (ไม่ใช้ — เราใช้ OSM)
  → staged search + pre-seed (warm cache) ทำให้อยู่ใต้ limit
- **Google Places:** จ่ายตามใช้ · เรียกเฉพาะกด "ค้นเพิ่ม" → ถูกมาก · referrer-locked
- **OSM tiles:** lazy-load → โหลดน้อยลงมาก (เปิดแผนที่เฉพาะเมื่อจำเป็น)
- **GitHub Pages:** static CDN + SW cache → รับ concurrency สบาย ไม่ใช่คอขวด

---

## 8. Tools (gate = Firebase admin login · `auth-gate.js`)
- **auth-gate.js** — ทุกหน้าใน tools/ include ไฟล์นี้ → บังคับ login ด้วยบัญชี Firebase admin จริง (เลิกใช้รหัสฝัง `adminbanphai` แล้ว เพราะใครเปิด source ก็เห็น) · login ค้างทั้ง browser (เข้าหน้าอื่นไม่ถามซ้ำ) · poll รอ firebase พร้อม + init เอง
  - หมายเหตุ: gate ป้องกันระดับ **UI** · การเขียน Firestore ของ seed ยังเปิด (rule `create:if true`) เพราะแอป surveyor เขียนโดยไม่ login — ถ้าจะล็อกระดับ data ต้องแก้ rules (กระทบแอปสำรวจ)
- **config.html** — admin login แก้ Longdo/Google key (เก็บ config/app = มีผลทั้งระบบ ตอนเปิดแอปใหม่)
- **seed-places.html** — pre-seed สถานที่ก่อนสำรวจ:
  - นำเข้า .xlsx/.csv (SheetJS) · 4 คอลัมน์ (header row): `place_name, latitude, longitude, keywords`(optional) · map ตามชื่อหัว สลับลำดับได้
  - ปุ่มดาวน์โหลด template · พิมพ์เองในกล่องก็ได้
  - ซ้ำ (ชื่อ+ใกล้<150m) = **merge** (คง use_count · รวม keywords · ไม่งอก) · **สลับ lat/lon ให้อัตโนมัติ** (ช่วงไทย lat5-21/lon96-106) · พิกัดนอกไทย = ข้าม
- **cleanup-seed.html** — ลบ doc ที่ id มี SEED (ใช้ rule ใหม่ได้เลย ไม่ต้องแก้ชั่วคราว)
- **seed-roadside/home.html** — สร้าง test data

---

## 9. TODO ฝั่งผู้ใช้
✅ Publish Firestore rules (ข้อ 6) — **ทำแล้ว (ใช้งานอยู่)** · ✅ ลบ test docs เก่า — **ทำแล้ว**

เหลือก่อนสำรวจจริง:
1. **Pre-seed places** สถานที่ยอดฮิตในพื้นที่ (⚙ → Pre-seed Places) → warm cache ลดยิง Longdo/Google
2. **Flip Blaze + ตั้ง budget alert** (กันเงินบานปลาย)

---

## 10. ข้อห้าม / gotchas
- **ห้ามเปลี่ยน signature** `MapPicker.open(coords, cb(coords,name))` — app.js เรียกผ่านนี้
- place-service.js ต้องเหมือนกันเป๊ะ 2 แอป · map-leaflet ต่างแค่ธีม → ใช้ cp/sed (ข้อ 2)
- bump SW version ทุกครั้งที่แก้ JS แอป
- ทุก vanilla JS · ห้ามเพิ่ม lib นอกจาก Leaflet + SheetJS (tools) + Firebase (มีแล้ว)
- key ฝั่ง browser เปิดเผยได้เสมอ — กันด้วย referrer/API restriction ใน Google Cloud (ตั้งแล้ว)
- ทดสอบใน local: `npx serve -l 5500 INTERVIEW` แล้วเปิด `/Roadside/` หรือ `/Home/` (ต้องมี trailing slash) · tools ที่ `/tools/`

## 11. Log การตัดสินใจสำคัญ (ที่ผ่านมา)
- ค้นหา staged (ไม่ยิง Google ทุกครั้ง · พิมพ์ไม่ยิง API) — ประหยัด Longdo/Google
- reverse → Longdo (ไทยแม่น ได้ตำบล) แทน Nominatim (throttle)
- key ฝังโค้ด + override จาก config (ผู้ใช้เลือก "ฝังในโค้ด")
- places: delta-sync (ผู้ใช้กังวลซับซ้อน → ทำ safety net: full read ตอนเปิดแอป + error คง cache)
- lazy-load tiles (เก็บ OSM แยกจาก Longdo ไม่แย่ง rate limit)
- hosting: คง GitHub Pages (ไม่ย้าย Firebase Hosting)

---

## 12. อัปเดตล่าสุด (เซสชัน 2026-06-16)
> งานที่ทำเพิ่ม/แก้ในรอบนี้ (commit ดูได้ใน `git log` · ผู้แก้ ITSMINIMIZE)

- **Dashboard analytics (ใหม่ทั้งแอป · งานเพื่อนร่วมทีม)** — `Dashboard/` login admin → KPI, OD matrix, desire lines, choropleth, peak hour + แผนที่ · อ่าน Firestore ตรง (`db.collection('households').get()` + subcollections, `roadside_stations/interviews`)
- **กู้ระบบ login + schema ของ Home** — ระหว่างทางมี commit เพื่อนร่วมทีมเขียน Home ใหม่เป็น **flat schema** (members/trips ฝังใน doc) + **ลบ login ทิ้ง** · รอบนี้ **กู้กลับเป็นเวอร์ชันเดิม**: login gate (admin/surveyor) + **nested schema** (`households/{}/members/{}/trips/{}`) + delete-confirm guard
  - และแก้ `Dashboard/js/dashboard.js` `pullHouseholds()` ให้อ่าน **nested** (ดึง members+trips subcollection มาประกอบ `hh.members[].trips[]`)
- **tools = Firebase admin login จริง** — เลิก gate รหัสฝัง client · ทุกหน้า tools include `auth-gate.js` (ดูข้อ 8)
- **ปุ่มนำทาง** — Dashboard (header + หน้า login) และ tools/index มีปุ่มกลับเมนูหลัก · หน้า tool ย่อยมีปุ่ม "← กลับไปหน้าเครื่องมือ"
- **seed/mock ตรง OPT** — แก้ `tools/seed-roadside.html` (LOC_TYPES/PURPOSES/CARGO) + `tools/seed-home.html` ให้ค่าตรง `OPT` ใน data.js · กระจายพื้นที่ (Home=ในพื้นที่บ้านไผ่, Roadside=เข้า-ออกหลายจังหวัด) · ลบ `{Roadside,Home}/tools/generate-mock.js` (console snippet ที่ไม่ใช้) ทิ้ง — เหลือ seed-*.html เป็น seed tool เดียว
- **delete-confirm** — ปุ่มล้างข้อมูล local ต้องพิมพ์ "delete" ก่อนกดได้ (ทั้ง Roadside + Home)

**Schema สำคัญ (ปัจจุบัน):** Home = **nested** · Roadside = nested (stations/interviews) · places = flat · local DB (data.js) เก็บ members/trips เป็น array ฝังใน household เสมอ (ต่างกันแค่ตอน sync ขึ้น/ลง Firestore)

---

## 13. โหมดดูตัวอย่างแบบสอบถาม (observe) — `{Home,Roadside}/js/preview-mode.js`

เปิดด้วย `?project=<pid>&preview=1` · **ต้อง login เป็น admin ก่อนเสมอ**
ไว้ให้ admin เปิดกางให้ **กรม / ผู้ว่าจ้าง** ดูองค์ประกอบของแบบสอบถามครบทุกหน้า
ออกลิงก์ได้จาก Dashboard → ปุ่ม 🔗 ลิงก์แบบสอบถาม → กล่อง "👁 ลิงก์ดูตัวอย่าง"
(ลิงก์เป็นที่อยู่ตายตัวของโครงการ ไม่มี token ไม่ต้องออกใหม่ · ลิงก์หลุดก็ไม่เป็นไร ไม่มีสิทธิ์ = เปิดไม่ได้)

**ประตู** (`Preview._boot` / `_gate`) — anonymous หรือ role ที่ไม่ใช่ `admin` เจอหน้ากั้นพร้อมปุ่ม login
ทุกทางที่เข้าแอปได้ถูกบีบให้ผ่าน `App._enterApp` ที่ถูก wrap ไว้ → ไม่ใช่ admin เด้งกลับหน้ากั้นเสมอ
(`App._showLoginGate` ถูกแทนที่ด้วยหน้ากั้นนี้ด้วย — ปุ่ม "เข้าใช้งานเป็นผู้สำรวจ" เดิมจึงหายไปในโหมดนี้)

**สิ่งที่โหมดนี้ทำ**
- มีข้อมูลสมมติให้ดู (สร้างจาก `OPT` ที่ใช้อยู่จริง → โครงการที่ตั้งตัวเลือกเอง ตัวอย่างก็เป็นชุดนั้น)
- **แผงลอยฝั่งขวา** = ปุ่มกระโดดไปทุกหน้า (ฟอร์ม/wizard/ถังขยะ) โดยไม่ต้องรู้ว่าต้องกดอะไร
  จงใจทำเป็นแผงลอยไม่ใช่ส่วนของหน้า ให้เห็นชัดว่าเป็นของโหมดพิเศษ ไม่ใช่เมนูของแบบสอบถามจริง
  · กางอยู่ → หด `body { padding-right }` ให้ ไม่ทับเนื้อหา · จอ < 1000px เริ่มแบบพับไว้ (ไม่งั้นทับ popup กลางจอ)

**สิ่งที่โหมดนี้ห้ามทำ — ทั้งหมด patch ไว้ใน `Preview.install()`**

| ทาง | วิธีปิด |
|---|---|
| IndexedDB ของแอป | `IDBStore.get/set/del` → no-op · `DB.init` คืนข้อมูลสมมติใน RAM |
| Firestore (ข้อมูลสำรวจ) | `FB._pushDoc` → no-op · `syncAll` throw · `pullAll/_pullByField` → 0 |
| Firestore (คลังสถานที่) | `PlaceService.savePlace` → no-op (เลือกหมุดบนแผนที่ = ระบบจำสถานที่ให้อัตโนมัติ) |
| localStorage | บล็อก `setItem/removeItem` ทุก key **ยกเว้น** `firebase*` / `firestore*` (SDK ต้องใช้) |
| Service Worker | ไม่ register (ดู `index.html` ทั้ง 2 แอป) |

⚠️ **เหตุผลที่ต้องบล็อกถึงระดับ localStorage:** เครื่องเดียวอาจเป็นเครื่องผู้สำรวจตัวจริงที่ทำงานค้างอยู่
ถ้าปล่อยให้เขียน โหมดดูตัวอย่างจะทับ `_is_project_id` / ชื่อผู้สำรวจ / cache สถานที่ ของงานจริง
ตรวจแล้วว่าเปิดโหมดนี้จนจบ localStorage เหลือแต่ key ของ Firebase SDK เท่านั้น

⚠️ สิ่งเดียวที่อ่านของจริงคือ **ตัวเลือกของแบบสอบถาม** (`config/options`) เพราะนั่นคือของที่ผู้ตรวจมาดู ·
รายชื่อผู้ควบคุมใช้ชื่อสมมติ ไม่เปิดชื่อทีมจริงให้คนนอก

**แก้ไฟล์นี้แล้ว** → `./sync-shared.sh` (อยู่ในลิสต์ `BOTH_APPS` แล้ว) + bump `CACHE_VERSION` ทั้ง 2 sw.js

---

## 14. ลิงก์ "◈ เมนูหลัก" ในแอปแบบสอบถาม — เห็นเฉพาะ admin/staff

`App._enterApp()` ของทั้ง 2 แอปใส่ลิงก์นี้ให้เฉพาะ `_canManage()`
**ผู้สำรวจไม่มี** — เขาเข้ามาด้วยลิงก์ที่ได้รับ ไม่มีบัญชี เผลอกดแล้วจะไปโผล่หน้า login ของระบบ
แล้วกลับเข้าแบบสอบถามเองไม่ได้ (ต้องไปขอลิงก์ใหม่จากผู้ควบคุม)
