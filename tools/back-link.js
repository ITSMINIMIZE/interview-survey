/* ปุ่มย้อนกลับของหน้าเครื่องมือ
 *
 * หน้าเครื่องมือถูกเปิดจากได้หลายที่ — จาก Dashboard ของโครงการ หรือจาก sidebar หน้าหลัก
 * ถ้า hardcode ให้ไป ../index.html จะพาผู้ใช้กระเด็นออกจากโครงการที่กำลังทำงานอยู่
 * เลยให้ย้อนกลับ "หน้าเดียว" ตามที่มาจริง และเหลือ href เดิมไว้เป็นทางออกสำรอง
 *
 * ใช้: <a class="back" href="../index.html" data-back>← ย้อนกลับ</a>
 *      <script src="back-link.js"></script>
 */
(function () {
  function cameFromThisSite() {
    // ไม่มีประวัติในแท็บนี้ (เปิดลิงก์ตรง / แท็บใหม่) → ย้อนกลับไม่ได้
    if (history.length <= 1) return false;
    if (!document.referrer) return false;
    try {
      // ย้อนกลับเฉพาะเมื่อหน้าก่อนหน้าเป็นเว็บเราเอง — ไม่งั้นอาจเด้งไป Google
      if (new URL(document.referrer).origin !== location.origin) return false;
    } catch (_) { return false; }
    // มาจากหน้าเดิมซ้ำ (reload / submit ตัวเอง) → ย้อนกลับแล้ววนอยู่ที่เดิม
    return document.referrer.split('#')[0] !== location.href.split('#')[0];
  }

  function wire() {
    document.querySelectorAll('a[data-back]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (!cameFromThisSite()) return;   // ปล่อยให้ href เดิมทำงาน
        e.preventDefault();
        history.back();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
