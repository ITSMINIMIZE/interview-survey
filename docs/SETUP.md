# SETUP — ติดตั้งระบบใหม่ (interview-survey)

> ระบบนี้โคลนมาจาก `INTERVIEW` (banphai-survey) ที่ **ยังใช้งานจริงอยู่**
> เป้าหมาย: แยกขาด 100% — คนละ GitHub repo, คนละ Firebase project, คนละพื้นที่เก็บข้อมูลในเบราว์เซอร์

---

## ⚠️ อ่านก่อน — ทำไมต้องแยกให้ครบ

ระบบเดิม deploy ที่ `itsminimize.github.io/banphai-survey/`
ระบบใหม่จะอยู่ที่ `itsminimize.github.io/interview-survey/`

**สอง URL นี้เป็น origin เดียวกัน** (`itsminimize.github.io`) ในสายตาเบราว์เซอร์
→ `localStorage`, `IndexedDB`, `Cache Storage` **ใช้พื้นที่ร่วมกัน**

ถ้าไม่แยก key จะเกิด:
- ข้อมูลสำรวจของ 2 ระบบปนกัน
- Service Worker ของระบบใหม่ไป **ลบ cache ของระบบเดิม** (โค้ดเดิม `activate` ลบทุก cache ที่ไม่ใช่ของตัวเอง) → ผู้สำรวจที่ใช้ระบบเดิมอยู่ offline ไม่ได้

**แก้แล้วในโคลนนี้:**

| สิ่งที่แยก | ระบบเดิม | ระบบใหม่ |
|---|---|---|
| IndexedDB | `hi_survey_idb` / `ri_survey_idb` | `is_hi_survey_idb` / `is_ri_survey_idb` |
| localStorage หลัก | `hi_survey_v2` / `ri_survey_v1` | `is_hi_survey_v2` / `is_ri_survey_v1` |
| cache สถานที่ | `bp_places_*` | `is_bp_places_*` |
| ชื่อผู้สำรวจ/sync/device | `_surveyor_name`, `_device_id`, `_hi_last_sync` … | `_is_*` ทั้งหมด |
| role / รอบเก็บข้อมูล | `_role_cache_v1`, `_data_round_v1`, `_supervisors_v1` | `_is_*` |
| SW cache | `hi-v47-round` / `ri-v44-round` | `is-hi-v1` / `is-ri-v1` |
| SW ลบ cache เก่า | ลบ**ทุก** cache ที่ไม่ใช่ของตัวเอง | ลบเฉพาะที่ขึ้นต้นด้วย `is-hi-` / `is-ri-` |
| Email domain | `@banphai.local` | `@interview-survey.local` |

> 🚫 **ห้ามแก้ `CACHE_PREFIX` ใน `sw.js` ให้ตรงกับระบบเดิม** และห้ามเอา filter `startsWith(CACHE_PREFIX)` ออก — จะไปลบ cache ของระบบที่ใช้งานจริง

---

## 1. สร้าง Firebase project ใหม่

1. เปิด https://console.firebase.google.com/
2. **Add project** → ตั้งชื่อ `interview-survey`
   - Firebase จะสร้าง project ID ให้ อาจได้ `interview-survey` หรือ `interview-survey-xxxxx` ถ้าชื่อซ้ำ — **จดไว้** ต้องใช้ในข้อ 3
3. Google Analytics — ปิดได้ (ไม่ได้ใช้)
4. รอสร้างเสร็จ → **Continue**

## 2. เปิด Firestore + Authentication

**Firestore Database**
1. เมนูซ้าย → **Build → Firestore Database** → **Create database**
2. เลือก **Production mode**
3. Location: **asia-southeast1 (Singapore)** ← เร็วสุดสำหรับไทย · **เลือกแล้วเปลี่ยนไม่ได้**
4. เสร็จแล้วไปแท็บ **Rules** → ลบของเดิมทิ้ง → วาง rules → **Publish**

   มี 2 ไฟล์ให้เลือกตามช่วงงาน:

   | ช่วง | ไฟล์ | ทำอะไร |
   |---|---|---|
   | 🔧 กำลังพัฒนา / ทดลองคนเดียว | [`firestore.rules.dev`](../firestore.rules.dev) | บัญชีที่ login แล้วทำได้ทุกอย่าง · **หมดอายุ 30 ก.ย. 2026 เอง** |
   | 🚀 ก่อนเก็บข้อมูลจริง | [`firestore.rules`](../firestore.rules) | ตัวเต็ม — delete ปิด · `users/` + `config/` เขียนได้เฉพาะ admin |

   > ⚠️ เว็บเป็น public บน GitHub Pages และ API key อยู่ในโค้ดฝั่ง client (ปกติของ Firebase)
   > → ตอนใช้ dev rules ใครเจอ URL ก็เขียน/ลบ DB ได้ **ห้ามใช้ตอนมีข้อมูลจริง**
   > วันหมดอายุคือตัวกันลืม พ้นวันนั้นระบบจะเขียนไม่ได้จนกว่าจะ publish `firestore.rules`

**Authentication**
1. เมนูซ้าย → **Build → Authentication** → **Get started**
2. แท็บ **Sign-in method** → เปิด 2 อัน:
   - **Email/Password** → Enable → Save
   - **Anonymous** → Enable → Save
   > ⚠️ ต้องเปิด Anonymous ด้วย — แอปผู้สำรวจ sign-in anonymous เพื่อเขียน Firestore โดยไม่ต้อง login

## 3. สร้าง Web app แล้วเอา config มาใส่

1. หน้า Project Overview → กดไอคอน **`</>`** (Web)
2. App nickname: `interview-survey` → **Register app** (ไม่ต้องติ๊ก Firebase Hosting)
3. จะได้โค้ดหน้าตาแบบนี้:
   ```js
   const firebaseConfig = {
     apiKey: "AIza........",
     authDomain: "interview-survey-xxxxx.firebaseapp.com",
     projectId: "interview-survey-xxxxx",
     storageBucket: "interview-survey-xxxxx.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```
4. เปิดไฟล์ [`set-firebase-config.sh`](../set-firebase-config.sh) แก้ 4 บรรทัดบนสุดตามค่าที่ได้:
   ```bash
   API_KEY="AIza........"
   PROJECT_ID="interview-survey-xxxxx"
   SENDER_ID="123456789012"
   APP_ID="1:123456789012:web:abcdef123456"
   ```
5. รัน:
   ```bash
   cd "/Users/cmmcbook/Desktop/Claude/New Interview" && ./set-firebase-config.sh
   ```
6. ตรวจว่าไม่เหลือ placeholder:
   ```bash
   grep -rn "PASTE_" --include="*.js" --include="*.html" "/Users/cmmcbook/Desktop/Claude/New Interview"
   ```
   ต้องไม่มีผลลัพธ์

## 4. สร้างบัญชี admin

1. Firebase Console → **Authentication → Users → Add user**
2. Email: ใส่**อีเมลจริง**ของคุณ (แนะนำ — กู้รหัสผ่านเองได้)
   หรือจะใช้ `admin@interview-survey.local` ก็ได้ แต่ส่งเมลกู้รหัสไม่ได้
3. ตั้งรหัสผ่าน → **Add user** → **ก๊อป `User UID` ที่ได้เก็บไว้**

4. บันทึกบทบาทลง Firestore ด้วย — ไม่งั้น login ได้แต่ไม่มีสิทธิ์ admin
   (`js/auth-role.js` และ `tools/auth-gate.js` อ่านสิทธิ์จาก **`users/{uid}`**)

   **admin คนแรกต้องสร้างใน Console เอง** — สร้างผ่าน `tools/users.html` ไม่ได้
   เพราะกฎข้อ "เขียน users ได้เฉพาะ admin" ยังไม่มีใครผ่าน (ปัญหา bootstrap)

   - **Firestore Database → Start collection** → Collection ID: **`users`**
   - Document ID: **วาง User UID จากข้อ 3**
   - ใส่ field:

     | field | type | value |
     |---|---|---|
     | `role` | string | `admin` |
     | `username` | string | ชื่อผู้ใช้ เช่น `admin` |
     | `displayName` | string | ชื่อที่แสดง |
     | `email` | string | อีเมลเดียวกับข้อ 2 |
     | `disabled` | boolean | `false` |

   - **Save**

5. หลังจากนี้ login เข้า `tools/users.html` แล้วเพิ่ม/แก้/ลบบัญชีคนอื่นผ่าน UI ได้เลย

## 5. อัปเกรดเป็น Blaze + ตั้ง budget alert

ระบบเดิมใช้ Blaze (จ่ายตามใช้ ~$1-3 ต่องาน) เพราะ Spark จำกัด read/write ต่อวัน

1. Console → ⚙️ **Usage and billing → Details & settings → Modify plan → Blaze**
2. **ตั้ง budget alert ทันที** (เช่น $10/เดือน) — Console → Budgets & alerts

---

## 6. สร้าง GitHub repo + เปิด Pages

```bash
cd "/Users/cmmcbook/Desktop/Claude/New Interview"
gh repo create interview-survey --public --source=. --remote=origin --push
gh api -X POST repos/ITSMINIMIZE/interview-survey/pages -f 'source[branch]=main' -f 'source[path]=/'
```

รอ ~1-2 นาที แล้วเปิด: `https://itsminimize.github.io/interview-survey/`

> deploy ครั้งต่อไป = `git push` เฉยๆ (เหมือนระบบเดิม)

---

## 7. Google Places / Longdo API key

ตอนนี้โคลนยัง**ใช้ key ชุดเดียวกับระบบเดิม** (ฝังในโค้ด `js/place-service.js`)

- ✅ **ไม่กระทบระบบเดิม** — คนละ referrer path แต่ key เดิม restrict ที่ `itsminimize.github.io/*` ซึ่งครอบคลุม repo ใหม่อยู่แล้ว → ค้นหาสถานที่ใช้งานได้ทันที
- ⚠️ **แต่ใช้โควตา/บิลร่วมกัน** และถ้าวันหนึ่ง rotate key ของระบบเดิม ระบบใหม่จะพังตาม

**ถ้าอยากแยก 100% จริง ๆ** ให้สร้าง key ใหม่:
1. https://console.cloud.google.com/ → APIs & Services → Credentials → **Create credentials → API key**
2. Restrict: **Websites** → `itsminimize.github.io/*` และ `localhost:5502/*`
3. API restrictions → เลือกเฉพาะ **Places API (New)**
4. เอา key ใหม่ไปใส่ที่ `tools/config.html` (บันทึกลง Firestore `config/app` → มีผลทั้งระบบ) หรือแก้ `GOOGLE_KEY` ใน `{Home,Roadside}/js/place-service.js`

**local dev:** key เดิม restrict ที่ `localhost:5500` เท่านั้น — ระบบใหม่รันที่ **5502** → การค้นหา Google บนเครื่องจะไม่ทำงานจนกว่าจะเพิ่ม `localhost:5502/*` เข้า referrer list

---

## 8. รันบนเครื่อง

```bash
open "/Users/cmmcbook/Desktop/Claude/New Interview/เปิด Server.command"
```

- ระบบใหม่: http://localhost:5502
- ระบบเดิม: http://localhost:5500 (พอร์ตต่างกัน → **เปิดพร้อมกันได้**)

---

## ✅ เช็กลิสต์ก่อนใช้งานจริง

- [ ] Firebase project ใหม่สร้างแล้ว · project ID ไม่ใช่ `banphai-survey`
- [ ] Firestore สร้างแล้ว + publish rules แล้ว (dev ตอนพัฒนา → **firestore.rules ตัวเต็มก่อนเก็บข้อมูลจริง**)
- [ ] Auth เปิด Email/Password **และ** Anonymous
- [ ] รัน `set-firebase-config.sh` แล้ว · `grep -rn "PASTE_"` ไม่เจออะไร
- [ ] `grep -rn "banphai" --include="*.js" --include="*.html" .` ไม่เจอ config ของระบบเดิม
- [ ] มีบัญชี admin: doc `users/{uid}` role=admin สร้างใน Console แล้ว · login `tools/` ผ่าน
- [ ] Blaze + budget alert
- [ ] GitHub repo ใหม่ + Pages ขึ้นแล้ว
- [ ] เปิดระบบเดิมเช็กว่ายังทำงานปกติ (login ได้ · ข้อมูลครบ · offline ได้)
