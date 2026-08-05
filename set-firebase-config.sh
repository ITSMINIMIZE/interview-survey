#!/bin/bash
# ใส่ค่า Firebase config ของโปรเจกต์ใหม่ลงทุกไฟล์ในครั้งเดียว
#
# วิธีใช้:
#   1) สร้าง Firebase project ใหม่ + Web app (ดู docs/SETUP.md ข้อ 1-3)
#   2) ก๊อปค่าจากหน้า "SDK setup and configuration" มาใส่ตัวแปรข้างล่าง
#   3) รัน:  ./set-firebase-config.sh
#
# สคริปต์นี้แทนที่ค่า PASTE_* ในทุกไฟล์ (Home / Roadside / Dashboard / tools)
# รันซ้ำได้ — ถ้าเคยใส่ค่าไปแล้วจะเตือนว่าไม่เจอ PASTE_* เหลืออยู่

set -euo pipefail
cd "$(dirname "$0")"

# ======= แก้ 5 บรรทัดนี้ =======
API_KEY="AIzaSyB7uSMVYta28csoka_Kj160U1OuCFHvNWs"
PROJECT_ID="interview-survey"
SENDER_ID="563577463134"
APP_ID="1:563577463134:web:b55381c292cb5433b7afcf"
# ==============================

if [ "$API_KEY" = "PASTE_API_KEY" ]; then
  echo "❌ ยังไม่ได้แก้ค่าในสคริปต์ — เปิดไฟล์ set-firebase-config.sh แล้วใส่ค่าจริงก่อน"
  exit 1
fi

FILES=$(grep -rl "PASTE_API_KEY\|PASTE_PROJECT_ID\|PASTE_SENDER_ID\|PASTE_APP_ID" \
  --include="*.js" --include="*.html" . | grep -v "tools/vendor" || true)

if [ -z "$FILES" ]; then
  echo "⚠️  ไม่พบ PASTE_* เหลืออยู่ — น่าจะใส่ config ไปแล้ว"
  exit 0
fi

echo "$FILES" | while IFS= read -r f; do
  sed -i '' \
    -e "s/PASTE_API_KEY/${API_KEY}/g" \
    -e "s/PASTE_PROJECT_ID/${PROJECT_ID}/g" \
    -e "s/PASTE_SENDER_ID/${SENDER_ID}/g" \
    -e "s/PASTE_APP_ID/${APP_ID}/g" \
    "$f"
  echo "  ✓ $f"
done

echo ""
echo "✅ ใส่ Firebase config เรียบร้อย"
echo "   ตรวจซ้ำ:  grep -rn 'PASTE_' --include='*.js' --include='*.html' ."
