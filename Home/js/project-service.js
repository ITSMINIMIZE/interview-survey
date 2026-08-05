// ===== PROJECT — ชั้น "โครงการ" ที่คลุมข้อมูลสำรวจทั้งหมด =====
//
// โครงสร้าง Firestore:
//   projects/{projectId}                     ← เอกสารโครงการ
//     ├─ members/{uid}                       ← staff ที่ถูกแต่งตั้งในโครงการนี้
//     ├─ households/{}/members/{}/trips/{}   ← Home Interview
//     ├─ roadside_stations/{}/interviews/{}  ← Roadside Interview
//     ├─ places/{}                           ← คลังสถานที่ (แยกตามโครงการ)
//     └─ config/{zones|zones_c*|data_round|supervisors}
//
//   users/{uid}          ← บัญชีระดับระบบ (role: admin | user)
//   config/app           ← API keys (ใช้ร่วมทั้งระบบ)
//
// ⚠️ ไฟล์นี้ copy ไว้ 4 ที่ให้เหมือนกัน: Home/js/ · Roadside/js/ · Dashboard/js/ · tools/
//    (Home/Roadside ต้องอยู่ใน scope ของ service worker ตัวเอง ไม่งั้นใช้ offline ไม่ได้)
//    แก้แล้วรัน ./sync-shared.sh เพื่อ copy ให้ครบ
//
// การเลือกโครงการ (ลำดับความสำคัญ):
//   1) ?project=<id> ใน URL   — ชนะเสมอ (มาจากหน้าแรก / ลิงก์ผู้สำรวจ) แล้วจำลง localStorage
//   2) localStorage            — ที่จำไว้จากครั้งก่อน
//   3) ไม่มี                    — แอปต้องเด้งกลับไปหน้าเลือกโครงการ

const Project = {
  KEY:       '_is_project_id',
  META_KEY:  '_is_project_meta',   // cache ชื่อโครงการ ไว้แสดงตอน offline
  TTL_MS:    24 * 60 * 60 * 1000,

  meta: null,     // { id, name, code, area, status, ... } เมื่อ load() แล้ว

  // ---------- id ----------
  id() {
    try {
      const q = new URLSearchParams(location.search).get('project');
      if (q) { localStorage.setItem(this.KEY, q); return q; }
    } catch (_) {}
    try { return localStorage.getItem(this.KEY) || null; } catch (_) { return null; }
  },

  set(id) {
    if (!id) return;
    try { localStorage.setItem(this.KEY, id); } catch (_) {}
    this.meta = null;
  },

  clear() {
    try { localStorage.removeItem(this.KEY); localStorage.removeItem(this.META_KEY); } catch (_) {}
    this.meta = null;
  },

  // ---------- ref ----------
  // ref รากของโครงการปัจจุบัน — ทุกการอ่าน/เขียนข้อมูลสำรวจต้องผ่านตรงนี้
  // โยน error ถ้ายังไม่ได้เลือกโครงการ (กันเขียนลง projects/undefined)
  root(db) {
    const id = this.id();
    if (!id) throw new Error('ยังไม่ได้เลือกโครงการ');
    return db.collection('projects').doc(id);
  },

  // shorthand ที่ใช้บ่อย
  col(db, name) { return this.root(db).collection(name); },
  cfg(db, docId) { return this.root(db).collection('config').doc(docId); },

  // ---------- โหลดข้อมูลโครงการ ----------
  async load(db, fresh) {
    const id = this.id();
    if (!id) { this.meta = null; return null; }

    if (!fresh) {
      const c = this._cached(id);
      if (c) { this.meta = c; return c; }
    }
    try {
      const snap = await db.collection('projects').doc(id).get();
      if (!snap.exists) {
        // โครงการถูกลบ / ไม่มีสิทธิ์ — ล้างที่จำไว้ ไม่งั้นค้างอยู่แบบนี้ตลอด
        this.clear();
        return null;
      }
      this.meta = { id: snap.id, ...snap.data() };
      try { localStorage.setItem(this.META_KEY, JSON.stringify({ ...this.meta, at: Date.now() })); } catch (_) {}
      return this.meta;
    } catch (e) {
      // ออฟไลน์ → ใช้ cache เดิม (แม้หมดอายุ) ดีกว่าเตะผู้สำรวจออกกลางงาน
      const stale = this._cached(id, true);
      this.meta = stale || null;
      return this.meta;
    }
  },

  _cached(id, allowStale) {
    try {
      const raw = localStorage.getItem(this.META_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.id !== id) return null;
      if (!allowStale && Date.now() - (d.at || 0) > this.TTL_MS) return null;
      delete d.at;
      return d;
    } catch (_) { return null; }
  },

  name() { return (this.meta && this.meta.name) || 'ไม่ทราบชื่อโครงการ'; },

  // ---------- รายการโครงการที่ผู้ใช้เข้าถึงได้ ----------
  // admin → ทุกโครงการ · user → เฉพาะที่ถูกแต่งตั้งเป็น staff
  // (rules บังคับซ้ำอีกชั้น — ตรงนี้แค่ไม่ยิง query ที่รู้อยู่แล้วว่าจะโดนปฏิเสธ)
  async listFor(db, roleObj) {
    const isAdmin = roleObj && roleObj.role === 'admin';
    let snap;
    if (isAdmin) {
      snap = await db.collection('projects').orderBy('createdAt', 'desc').get();
    } else if (roleObj && roleObj.uid) {
      snap = await db.collection('projects')
        .where('memberUids', 'array-contains', roleObj.uid)
        .get();
    } else {
      return [];
    }
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!isAdmin) list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return list;
  },

  // ---------- กันเข้าแอปโดยไม่มีโครงการ ----------
  // เรียกตอนแอปเริ่ม — ไม่มีโครงการ = เด้งกลับหน้าเลือก
  require(homePath) {
    if (this.id()) return true;
    location.replace(homePath || '../');
    return false;
  },

  // ต่อ ?project= ให้ลิงก์ (ใช้ตอนสร้างลิงก์ข้ามแอป)
  withId(url) {
    const id = this.id();
    if (!id) return url;
    return url + (url.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(id);
  }
};
