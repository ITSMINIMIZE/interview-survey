#!/bin/bash
# ก๊อปไฟล์ที่ใช้ร่วมกันจาก Home/js/ (ต้นฉบับ) ไปที่อื่นให้เหมือนกัน
#
# ทำไมต้อง copy ไม่ใช่ import:
#   Home/ กับ Roadside/ เป็น PWA คนละตัว ไฟล์ต้องอยู่ใน scope ของ service worker
#   ของแต่ละแอป ไม่งั้น cache ไม่ติด → ใช้ offline ไม่ได้
#
# แก้ที่ Home/js/ แล้วรัน:  ./sync-shared.sh

set -euo pipefail
cd "$(dirname "$0")"

# ไฟล์ที่ใช้ร่วมกันทั้ง Home และ Roadside
BOTH_APPS="auth-role.js place-service.js zone-service.js project-service.js preview-mode.js"
for f in $BOTH_APPS; do
  cp "Home/js/$f" "Roadside/js/$f"
  echo "  ✓ Roadside/js/$f"
done

# project-service.js ใช้ที่ Dashboard และ tools ด้วย
cp "Home/js/project-service.js" "Dashboard/js/project-service.js"
echo "  ✓ Dashboard/js/project-service.js"
cp "Home/js/project-service.js" "tools/project-service.js"
echo "  ✓ tools/project-service.js"

echo ""
echo "✅ sync เรียบร้อย"
echo "⚠️  แก้ไฟล์แอปแล้วอย่าลืม bump CACHE_VERSION ใน Home/sw.js และ Roadside/sw.js"
echo "   (ห้ามแก้ CACHE_PREFIX — ดู docs/SETUP.md)"

# หมายเหตุ: map-leaflet.js ต่างกันที่ธีมสี ไม่ sync ที่นี่ — ดูวิธีใน docs/HANDOFF.md ข้อ 2
# data.js ต่างกันตามโครงสร้างข้อมูล (household vs station) — ไม่ sync
