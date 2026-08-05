# Firestore index ที่ต้องสร้าง (ทำครั้งเดียว)

> ✅ **สร้างครบแล้วในโปรเจกต์ interview-survey** (5 ส.ค. 2569) — เอกสารนี้เก็บไว้เผื่อ
> ต้องตั้งโปรเจกต์ใหม่ หรือย้าย Firebase

## ผลวัดจริงหลังสร้าง index

| ขนาดข้อมูล | วิธีเดิม (ยิงทีละ doc) | วิธีใหม่ (collectionGroup) | |
|---|---|---|---|
| 2,600 doc · 801 คำขอ | 1,620 ms | 1,841 ms | พอๆ กัน |
| 6,500 doc · 2,001 คำขอ | **57,848 ms** | **~2,500 ms** | **เร็วขึ้น ~23 เท่า** |

วิธีเดิมไม่ได้ช้าลงเป็นเส้นตรง — ข้อมูลน้อยเร็วพอกัน แต่พอเกินระดับหนึ่งแล้ว
ตกหน้าผา (2.5 เท่าของข้อมูล → ช้าลง 35 เท่า) งานจริงที่คาดไว้ ~3,000 ครัวเรือน
(ราว 30,000 doc) วิธีเดิมจะใช้ไม่ได้เลย


Dashboard ดึง `members` / `trips` / `interviews` ของทั้งโครงการด้วย **collectionGroup query**
แทนการยิงทีละ doc — แต่ Firestore ต้องมี index แบบ **collection group scope** ก่อนถึงจะ query ได้

> ⚠️ index แบบ single-field ที่ Firestore สร้างให้อัตโนมัติเป็น **collection scope** เท่านั้น
> ไม่ครอบคลุม collection group จึงต้องสร้างเองครั้งเดียว

## ยังไม่สร้างก็ใช้งานได้

Dashboard จับ error `failed-precondition` แล้ว**ถอยไปใช้วิธีเดิม**อัตโนมัติ (ยิงทีละ doc)
→ ข้อมูลครบเหมือนกัน แค่ช้ากว่า · ดูใน console จะเห็น
`[Dashboard] collectionGroup ใช้ไม่ได้ ใช้วิธีเดิมแทน: failed-precondition`

## วิธีสร้าง — กด 3 ลิงก์นี้แล้วกด "Create index"

สร้างเสร็จใช้เวลาสักครู่ (สถานะ Building → Enabled) ระหว่างนั้น Dashboard ยังใช้วิธีเดิมไปก่อน

| collection | ลิงก์ |
|---|---|
| `members` | https://console.firebase.google.com/v1/r/project/interview-survey/firestore/indexes?create_exemption=Cldwcm9qZWN0cy9pbnRlcnZpZXctc3VydmV5L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9tZW1iZXJzL2ZpZWxkcy9wcm9qZWN0SWQQAhoNCglwcm9qZWN0SWQQAQ |
| `trips` | https://console.firebase.google.com/v1/r/project/interview-survey/firestore/indexes?create_exemption=ClVwcm9qZWN0cy9pbnRlcnZpZXctc3VydmV5L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy90cmlwcy9maWVsZHMvcHJvamVjdElkEAIaDQoJcHJvamVjdElkEAE |
| `interviews` | https://console.firebase.google.com/v1/r/project/interview-survey/firestore/indexes?create_exemption=Clpwcm9qZWN0cy9pbnRlcnZpZXctc3VydmV5L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9pbnRlcnZpZXdzL2ZpZWxkcy9wcm9qZWN0SWQQAhoNCglwcm9qZWN0SWQQAQ

### หรือทำเองในหน้า Console

Firestore Database → **Indexes** → แท็บ **Single field** → **Add exemption**
- Collection ID: `members` (แล้วทำซ้ำกับ `trips`, `interviews`)
- Field path: `projectId`
- ติ๊ก **Collection group** → Ascending

## วิธีเช็กว่าสร้างครบแล้ว

เปิด Dashboard ของโครงการที่มีข้อมูล → เปิด console → ถ้า**ไม่มี**ข้อความ
`collectionGroup ใช้ไม่ได้` แปลว่าใช้ทางเร็วอยู่แล้ว

---

## ทำไมต้องมี `projectId` ในทุก doc

collectionGroup query มองข้ามโครงสร้าง path — ถาม `trips` ทั้งฐานข้อมูลได้
แต่ไม่รู้ว่า doc ไหนอยู่ใต้โครงการไหน จึงต้องมี field `projectId` ติดไว้เป็นตัวกรอง

ฝั่งเขียนติดให้อัตโนมัติแล้วทุกทาง (แอปสำรวจทั้ง 2 · sync ทั้งก้อน · เครื่องมือ seed ·
สร้างจุดสำรวจจาก Dashboard)

**⚠️ doc ที่ไม่มี `projectId` จะไม่ขึ้นในรายงานเลยเมื่อใช้ทางเร็ว** — ถ้าเคยมีข้อมูลที่เขียน
ด้วยโค้ดเวอร์ชันเก่า ต้องเติม field นี้ย้อนหลังก่อน (ตอนเปลี่ยนมาใช้ระบบนี้ฐานข้อมูลว่างอยู่
จึงไม่ต้องทำ)
