#!/bin/bash
# ระบบใหม่ (interview-survey) — พอร์ต 5502
# ระบบเดิม (INTERVIEW) ใช้พอร์ต 5500 → เปิดพร้อมกันได้ ไม่ชนกัน
cd /Users/cmmcbook/Desktop/Claude
echo "🚀 กำลังเปิด Server (ระบบใหม่ — interview-survey)..."
echo "──────────────────────────"
echo "เข้าใช้งานได้ที่:"
echo "  http://localhost:5502"
echo ""
echo "ปิด Terminal นี้ = ปิด Server"
echo "──────────────────────────"
# เปิด browser อัตโนมัติหลัง server พร้อม (รอ 2 วินาที)
sleep 2 && open "http://localhost:5502/" &

npx serve -l 5502 "New Interview"
