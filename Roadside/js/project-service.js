// ===== PROJECT — ชั้น "โครงการ" ที่คลุมข้อมูลสำรวจทั้งหมด =====
//
// โครงสร้าง Firestore:
//   projects/{projectId}                     ← เอกสารโครงการ
//     ├─ members/{uid}                       ← staff ที่ถูกแต่งตั้งในโครงการนี้
//     ├─ households/{}/members/{}/trips/{}   ← Home Interview
//     ├─ roadside_stations/{}/interviews/{}  ← Roadside Interview
//     ├─ places/{}                           ← คลังสถานที่ (แยกตามโครงการ)
//     └─ config/{zones|zones_c*|supervisors}
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

  // ---------- ตัวเลือกของแบบสอบถาม (ต่างกันได้ตามโครงการ) ----------
  //
  //   projects/{pid}/config/options = {
  //     roadside: { vehicleTypes[], purposeCards[], locationTypeCards[] },
  //     home:     { purposeCards[], locationTypeCards[] }
  //   }
  //
  // ⚠️ เก็บแยกตามแอป เพราะ OPT ของ 2 แอปใช้ชื่อ key เดียวกันแต่คนละโครงสร้าง
  //    (Roadside มี group แบ่งกลุ่มรถ · Home ไม่มี) — ปนกันแล้วฟอร์มพัง
  //
  // ⚠️ purpose/locationType เก็บเป็นรูป "การ์ด" (มีไอคอน) แล้วค่อยแตกเป็น list ธรรมดา
  //    เพราะฟอร์มปกติอ่านจาก OPT.purpose แต่หน้า wizard อ่านจาก OPT.purposeCards
  //    ถ้าเก็บแยกกัน 2 ที่ วันหนึ่งจะไม่ตรงกันแน่นอน
  OPTIONS_KEY: '_is_options',
  _optKey() { return this.OPTIONS_KEY + '__' + (this.id() || 'none'); },

  // อ่านจาก Firestore แล้ว merge ลง OPT ของแอป · ออฟไลน์ใช้ที่ cache ไว้
  // ไม่มี override = ใช้ค่า default ในโค้ดตามเดิม (โครงการผังเมืองไม่ต้องตั้งอะไร)
  async loadOptions(db, app, OPT) {
    let all = null;
    try {
      const snap = await this.cfg(db, 'options').get();
      all = snap.exists ? snap.data() : null;
      if (all) { try { localStorage.setItem(this._optKey(), JSON.stringify(all)); } catch (_) {} }
    } catch (_) {
      try { all = JSON.parse(localStorage.getItem(this._optKey()) || 'null'); } catch (_) {}
    }
    if (!all) {
      try { all = JSON.parse(localStorage.getItem(this._optKey()) || 'null'); } catch (_) {}
    }
    const d = all && all[app];
    if (!d || !OPT) return null;
    this.applyOptions(d, OPT);
    return d;
  },

  applyOptions(d, OPT) {
    if (Array.isArray(d.vehicleTypes) && d.vehicleTypes.length) {
      OPT.vehicleTypes = d.vehicleTypes;
    }
    if (Array.isArray(d.purposeCards) && d.purposeCards.length) {
      OPT.purposeCards = d.purposeCards;
      OPT.purpose      = d.purposeCards.map(c => c.val);      // ต้องมาจากที่เดียวกันเสมอ
    }
    if (Array.isArray(d.locationTypeCards) && d.locationTypeCards.length) {
      OPT.locationTypeCards = d.locationTypeCards;
      OPT.locationType      = d.locationTypeCards.map(c => c.val);
    }
  },

  // ต่อ ?project= ให้ลิงก์ (ใช้ตอนสร้างลิงก์ข้ามแอป)
  withId(url) {
    const id = this.id();
    if (!id) return url;
    return url + (url.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(id);
  }
};


// ===== SURVEY LINK — ลิงก์ที่แจกให้ผู้สำรวจ =====
//
//   surveyLinks/{token} = { token, projectId, app:'home'|'roadside', label,
//                           supervisorName, enabled, expiresAt, createdAt, createdBy }
//
// รูปแบบ URL:  .../Home/?project=<pid>&k=<token>
//
// ⚠️ จงใจใส่ project ใน URL ด้วย ไม่ได้ให้ token เป็นตัวบอกโครงการอย่างเดียว
//    เพราะแอปต้องรู้โครงการ "ทันทีตอนบูต" (แบบ sync) ไม่งั้นต้องรอ Firestore
//    ก่อนจะเริ่มโหลดข้อมูลได้ — ช้าและพังตอนออฟไลน์
//    token ใช้สำหรับ (1) ตรวจว่าลิงก์ยังเปิดอยู่ (2) เติมชื่อผู้ควบคุมให้อัตโนมัติ
//
// ⚠️ ลิงก์คือ bearer token — ใครได้ไปก็ส่งข้อมูลได้ ปิด/ตั้งวันหมดอายุได้จากหน้า Dashboard
const SurveyLink = {
  KEY: '_is_survey_link',

  // token จาก URL (ชนะ) → ที่จำไว้ (เปิดแอปซ้ำ/ติดตั้ง PWA แล้วไม่มี query)
  token() {
    try {
      const q = new URLSearchParams(location.search).get('k');
      if (q) return q;
      const c = this._cached();
      return c ? c.token : null;
    } catch (_) { return null; }
  },

  _cached() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (_) { return null; }
  },

  // ข้อมูลลิงก์ล่าสุดที่ตรวจผ่าน (ใช้ตอนออฟไลน์ได้)
  info() {
    const c = this._cached();
    return (c && c.projectId === Project.id()) ? c : null;
  },

  // ตรวจว่าลิงก์ยังใช้ได้ — คืน { ok, reason, link }
  // ออฟไลน์/อ่านไม่ได้ = ไม่บล็อก (หน้างานต้องทำงานต่อได้) ใช้ข้อมูลที่จำไว้แทน
  async check(db) {
    const t = this.token();
    if (!t) return { ok: true, reason: 'no-token' };   // เข้าตรงโดยไม่ผ่านลิงก์
    let snap;
    try {
      snap = await db.collection('surveyLinks').doc(t).get();
    } catch (_) {
      return { ok: true, reason: 'offline', link: this._cached() };
    }
    if (!snap.exists)             return { ok: false, reason: 'ไม่พบลิงก์นี้ในระบบ (อาจถูกลบไปแล้ว)' };
    const d = snap.data();
    if (d.enabled === false)      return { ok: false, reason: 'ลิงก์นี้ถูกปิดการใช้งานแล้ว' };
    if (d.expiresAt && new Date(d.expiresAt) < new Date())
                                  return { ok: false, reason: 'ลิงก์นี้หมดอายุแล้ว (' + d.expiresAt.slice(0,10) + ')' };
    if (d.projectId && Project.id() && d.projectId !== Project.id())
                                  return { ok: false, reason: 'ลิงก์ไม่ตรงกับโครงการที่เปิดอยู่' };

    const link = { token: t, ...d };
    try { localStorage.setItem(this.KEY, JSON.stringify(link)); } catch (_) {}
    return { ok: true, link };
  },

  // แสดงหน้ากั้นเมื่อลิงก์ใช้ไม่ได้ — ผู้สำรวจไม่ควรกรอกข้อมูลต่อ
  block(reason) {
    const el = document.createElement('div');
    el.setAttribute('style',
      'position:fixed;inset:0;z-index:99999;background:#0f172a;color:#f1f5f9;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      "font-family:'Sarabun',sans-serif;text-align:center;line-height:1.8");
    el.innerHTML =
      '<div style="max-width:380px">' +
        '<div style="font-size:44px;margin-bottom:14px">🔒</div>' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px">ใช้ลิงก์นี้ไม่ได้</div>' +
        '<div style="color:#94a3b8;font-size:14px">' + reason + '</div>' +
        '<div style="color:#64748b;font-size:13px;margin-top:18px">ติดต่อผู้ควบคุมเพื่อขอลิงก์ใหม่</div>' +
      '</div>';
    document.body.appendChild(el);
  }
};
