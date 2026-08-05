# interview-survey

โคลนจากระบบ `banphai-survey` (โฟลเดอร์ `/Users/cmmcbook/Desktop/Claude/INTERVIEW`)

## 🚨 กฎเหล็ก

1. **ห้ามแก้ไฟล์ใดๆ ใน `/Users/cmmcbook/Desktop/Claude/INTERVIEW`** — ระบบนั้นใช้งานจริงอยู่ (production)
2. **ห้ามชี้ config กลับไปที่ Firebase project `banphai-survey`**
3. **ห้ามแก้ `CACHE_PREFIX` / เอา filter `startsWith(CACHE_PREFIX)` ออกจาก `sw.js`**
   repo นี้ deploy บน origin `itsminimize.github.io` เดียวกับระบบเดิม → Cache Storage ใช้ร่วมกัน
   ถ้าเอา filter ออก SW จะไปลบ cache ของระบบเดิม = ผู้สำรวจที่ใช้งานอยู่ offline ไม่ได้
4. **storage key ทุกตัวต้องมี prefix `is_` / `_is_` / `is-`** — localStorage, IndexedDB, Cache Storage
   ใช้ร่วมกันทั้ง origin ถ้าชื่อชนกับระบบเดิม ข้อมูลสำรวจจะปนกัน

รายละเอียด: [`docs/SETUP.md`](docs/SETUP.md) · ภาพรวมระบบ: [`docs/HANDOFF.md`](docs/HANDOFF.md)

## รันบนเครื่อง

```bash
open "เปิด Server.command"   # → http://localhost:5502
```

ระบบเดิมใช้พอร์ต 5500 — เปิดพร้อมกันได้

## ก่อนใช้งานจริง

โค้ดยังมี `PASTE_API_KEY` / `PASTE_PROJECT_ID` / `PASTE_SENDER_ID` / `PASTE_APP_ID` อยู่
→ สร้าง Firebase project ใหม่แล้วรัน `./set-firebase-config.sh` (ดู `docs/SETUP.md`)
