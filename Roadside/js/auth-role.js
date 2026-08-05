// ===== ROLE — สิทธิ์ 2 ชั้น: ระดับระบบ + ระดับโครงการ =====
//
//   users/{uid}.role          ระดับระบบ: 'admin' (ทั้งระบบ) | 'user' (ทั่วไป)
//   projects/{pid}/members/{uid}   แต่งตั้งเป็น staff (ผู้ควบคุม) ในโครงการนั้น
//
// สิทธิ์ที่ "ใช้จริง" ในโครงการที่เปิดอยู่ (role) คำนวณจาก 2 อันข้างบน:
//   admin ระดับระบบ            → role 'admin'  (ทุกโครงการ)
//   user + เป็น member         → role 'staff'  (เฉพาะโครงการนั้น)
//   user + ไม่ได้เป็น member   → null          (เข้าโครงการนี้ไม่ได้)
//
// ทำแบบนี้เพื่อให้โค้ดแอปเดิมที่เช็ค role === 'admin' / 'staff' ใช้ต่อได้ทั้งหมด
// โดยไม่ต้องแก้ app.js (2,200 บรรทัด × 2 แอป)
//
// ⚠️ cache เป็นแค่เรื่องความเร็ว (UX) ไม่ใช่ความปลอดภัย —
//    สิทธิ์จริงบังคับที่ Firestore rules
//
// หมายเหตุ: ไฟล์นี้ถูก copy ไว้ทั้ง Home/js/ และ Roadside/js/ ให้เหมือนกัน
// (ต้องอยู่ใน scope ของ service worker แต่ละแอป ไม่งั้นใช้งาน offline ไม่ได้)
const Role = {
  CACHE_KEY: '_is_role_cache_v1',
  TTL_MS: 6 * 60 * 60 * 1000,   // 6 ชม. — เปลี่ยน role แล้วมีผลภายในกะงาน
  current: null,                // { uid, email, username, role, globalRole, supervisorName, displayName }

  // สิทธิ์ผูกกับโครงการ → cache ต้องแยกตามโครงการด้วย
  _k() { return this.CACHE_KEY + '__' + (Project.id() || 'none'); },

  // คืน object สิทธิ์ หรือ null ถ้าไม่ใช่บัญชีจริง / ไม่มีสิทธิ์ในโครงการนี้ / ถูกปิด
  // fresh = true → ข้าม cache (ใช้ตอนเพิ่ง login เพื่อให้เห็นสิทธิ์ล่าสุดทันที)
  async resolve(user, db, fresh) {
    if (!user || user.isAnonymous) { this.current = null; return null; }

    if (!fresh) {
      const c = this._cached(user.uid);
      if (c) { this.current = c; return c; }
    }

    let snap;
    try {
      snap = await db.collection('users').doc(user.uid).get();
    } catch (e) {
      // ออฟไลน์/อ่านไม่ได้ → ใช้ cache เดิมถ้ามี (แม้หมดอายุ) ดีกว่าเตะผู้ใช้ออกกลางงาน
      const stale = this._cached(user.uid, true);
      this.current = stale || null;
      return this.current;
    }
    if (!snap.exists) { this.clear(); return null; }         // บัญชีที่ยังไม่ได้รับสิทธิ์
    const d = snap.data();
    if (d.disabled === true) { this.clear(); return null; }  // ถูกปิดบัญชี

    // 'staff' ที่ค้างจากโครงสร้างเดิม = 'user' ในโครงสร้างใหม่
    const globalRole = (d.role === 'staff') ? 'user' : (d.role || '');

    const base = {
      uid:         user.uid,
      email:       user.email || '',
      username:    d.username || (user.email || '').split('@')[0],
      globalRole,
      displayName: d.displayName || d.username || ''
    };

    // ---- admin ระดับระบบ: ผ่านทุกโครงการ ----
    if (globalRole === 'admin') {
      this.current = { ...base, role: 'admin', supervisorName: d.supervisorName || '' };
      this._cache();
      return this.current;
    }

    // ---- user ทั่วไป: ต้องถูกแต่งตั้งใน "โครงการที่เปิดอยู่" ----
    if (globalRole !== 'user') { this.clear(); return null; }
    if (!Project.id()) { this.clear(); return null; }   // ยังไม่ได้เลือกโครงการ

    let m;
    try {
      m = await Project.col(db, 'members').doc(user.uid).get();
    } catch (e) {
      const stale = this._cached(user.uid, true);
      this.current = stale || null;
      return this.current;
    }
    if (!m.exists) { this.clear(); return null; }       // ไม่ได้อยู่ในโครงการนี้

    const md = m.data();
    this.current = {
      ...base,
      role:           'staff',
      // ชื่อผู้ควบคุมใช้จับคู่ข้อมูลกับทีม — ต่างโครงการตั้งชื่อต่างกันได้
      supervisorName: md.supervisorName || base.displayName || base.username,
      displayName:    md.displayName || base.displayName
    };
    this._cache();
    return this.current;
  },

  _cache() {
    try {
      localStorage.setItem(this._k(), JSON.stringify({ ...this.current, at: Date.now() }));
    } catch (_) { /* โควตาเต็ม — ไม่เป็นไร แค่ต้องอ่านใหม่รอบหน้า */ }
  },

  clear() {
    this.current = null;
    try { localStorage.removeItem(this._k()); } catch (_) {}
  },

  isAdmin() { return !!this.current && this.current.role === 'admin'; },
  isStaff() { return !!this.current && this.current.role === 'staff'; },

  _cached(uid, ignoreExpiry) {
    try {
      const raw = localStorage.getItem(this._k());
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c.uid !== uid) return null;
      if (!ignoreExpiry && Date.now() - (c.at || 0) > this.TTL_MS) return null;
      delete c.at;
      return c;
    } catch (_) { return null; }
  }
};

// ===== รายชื่อผู้ควบคุม — ใช้ทำ dropdown ในแบบฟอร์ม =====
// มาจาก config/supervisors ที่ tools/users.html เขียนไว้ (ไม่เปิด users ให้ผู้สำรวจอ่าน)
// cache ลง localStorage เพื่อให้ใช้งานออฟไลน์ได้ — หน้างานต้องเลือกผู้ควบคุมได้เสมอ
const Supervisors = {
  CACHE_KEY: '_is_supervisors_v1',
  _list: null,
  _pid: null,     // โครงการที่ _list ถืออยู่ — สลับโครงการแล้วต้องอ่านใหม่

  // cache แยกตามโครงการ ไม่งั้นรายชื่อผู้ควบคุมข้ามโครงการกัน
  _k() { return this.CACHE_KEY + '__' + (Project.id() || 'none'); },

  // อ่านแบบ sync สำหรับตอน render ฟอร์ม (คืน [] ถ้ายังไม่เคยโหลด)
  list() {
    const pid = Project.id() || 'none';
    if (this._list && this._pid === pid) return this._list;
    try {
      const raw = localStorage.getItem(this._k());
      this._list = raw ? JSON.parse(raw) : [];
    } catch (_) { this._list = []; }
    this._pid = pid;
    return this._list;
  },

  // โหลดสดจาก Firestore แล้ว cache (เรียกตอน boot — ไม่ throw ถ้าออฟไลน์)
  async load(db) {
    try {
      if (!db || !Project.id()) return this.list();
      const snap = await Project.cfg(db, 'supervisors').get();
      if (!snap.exists) return this.list();
      const arr = (snap.data().list || []).filter(x => x && x.name);
      if (!arr.length) return this.list();
      this._list = arr;
      this._pid  = Project.id();
      try { localStorage.setItem(this._k(), JSON.stringify(arr)); } catch (_) {}
    } catch (_) { /* ออฟไลน์ → ใช้ cache เดิม */ }
    return this.list();
  },

  // สร้าง <option> — currentValue ที่ไม่อยู่ในรายชื่อ (ข้อมูลเก่า) จะถูกใส่ไว้ให้ด้วย
  // เพื่อไม่ให้แก้ระเบียนเก่าแล้วชื่อผู้ควบคุมถูกเขียนทับเงียบๆ
  optionsHTML(currentValue, escFn) {
    const esc  = escFn || (s => String(s ?? ''));
    const cur  = String(currentValue || '');
    const list = this.list();
    const has  = list.some(x => x.name === cur);
    let html = `<option value="">— เลือกผู้ควบคุม —</option>`;
    html += list.map(x =>
      `<option value="${esc(x.name)}"${x.name === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    if (cur && !has) html += `<option value="${esc(cur)}" selected>${esc(cur)} (ข้อมูลเดิม)</option>`;
    return html;
  }
};

// ===== รอบเก็บข้อมูล — กันข้อมูลเก่าย้อนกลับเข้าระบบ =====
// admin ตั้ง config/data_round.since (ISO) ผ่าน tools/data-round.html
// ระเบียนที่ createdAt < since = "ข้อมูลเก่าก่อนรอบนี้" → ไม่ส่งขึ้น cloud
// since ว่าง/ไม่มี doc = ไม่กรองอะไรเลย (พฤติกรรมเดิม)
const DataRound = {
  CACHE_KEY: '_is_data_round_v1',
  _r: null,
  _pid: null,     // โครงการที่ _r ถืออยู่ — แต่ละโครงการมีรอบเก็บข้อมูลของตัวเอง

  _k() { return this.CACHE_KEY + '__' + (Project.id() || 'none'); },

  // อ่านแบบ sync (ใช้ตอน render/sync) — คืน { since, label }
  get() {
    const pid = Project.id() || 'none';
    if (this._r && this._pid === pid) return this._r;
    try {
      const raw = localStorage.getItem(this._k());
      this._r = raw ? JSON.parse(raw) : { since: '', label: '' };
    } catch (_) { this._r = { since: '', label: '' }; }
    this._pid = pid;
    return this._r;
  },
  since() { return this.get().since || ''; },
  label() { return this.get().label || ''; },

  async load(db) {
    try {
      if (!db || !Project.id()) return this.get();
      const snap = await Project.cfg(db, 'data_round').get();
      const d = snap.exists ? snap.data() : {};
      this._r = { since: d.since || '', label: d.label || '' };
      this._pid = Project.id();
      try { localStorage.setItem(this._k(), JSON.stringify(this._r)); } catch (_) {}
    } catch (_) { /* ออฟไลน์ → ใช้ cache เดิม */ }
    return this.get();
  },

  // ระเบียนนี้เก่ากว่ารอบปัจจุบันหรือไม่ (ไม่มี createdAt = ถือว่าเก่า)
  isOld(rec) {
    const s = this.since();
    if (!s) return false;
    if (!rec) return false;
    return String(rec.createdAt || '') < s;
  },

  // นาฬิกาเครื่องนี้ผิดหรือเปล่า — ถ้าเวลาปัจจุบันยังไม่ถึงวันเริ่มรอบ
  // ข้อมูลที่บันทึกใหม่จะถูกสแตมป์เป็นเวลาเก่าแล้วโดนกรองทิ้งเงียบๆ
  clockLooksWrong() {
    const s = this.since();
    return !!s && new Date().toISOString() < s;
  }
};
