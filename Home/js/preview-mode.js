// ===== โหมดดูตัวอย่างแบบสอบถาม (observe) =====
//
//   .../Home/?project=<pid>&preview=1
//   .../Roadside/?project=<pid>&preview=1
//
// เปิดให้ **เฉพาะผู้ดูแลระบบ (admin)** — ให้ admin เปิดกางให้กรม/ผู้ว่าจ้างดูองค์ประกอบของแบบสอบถาม
// ครบทุกหน้า โดยไม่ต้องไปยุ่งกับข้อมูลจริงและไม่ทิ้งขยะไว้ในระบบ
//
// หลักการ 3 ข้อ:
//   1) ไม่เขียนอะไรทั้งสิ้น — patch DB.save / IDBStore / FB._pushDoc ให้เป็น no-op
//      ข้อมูลตัวอย่างอยู่ใน RAM อย่างเดียว ปิดแท็บแล้วหายเกลี้ยง
//      (สำคัญมาก: เครื่องเดียวอาจถูกใช้สำรวจจริงด้วย ห้ามให้ตัวอย่างปนเข้า IndexedDB ของโครงการ)
//   2) ไม่แตะข้อมูลจริง — ไม่ pull จาก cloud, ไม่อ่านรายชื่อผู้ควบคุมจริง (ใช้ชื่อสมมติ)
//      สิ่งเดียวที่อ่านของจริงคือ "ตัวเลือกของแบบสอบถาม" ของโครงการนั้น เพราะนั่นคือสิ่งที่เขามาตรวจ
//   3) ต้อง login เป็น admin ก่อนเสมอ — ลิงก์หลุดไปถึงใครก็เปิดไม่ได้ถ้าไม่มีสิทธิ์
//
// ⚠️ ไฟล์นี้ถูก copy ให้เหมือนกันทั้ง Home/js/ และ Roadside/js/ (แก้ที่ Home แล้วรัน ./sync-shared.sh)
//    ตัวไฟล์รู้เองว่าอยู่แอปไหนจาก DB.KEY — ข้อมูลตัวอย่างจึงต่างกันได้ในไฟล์เดียว
const Preview = {
  _on:      null,
  _min:     false,  // แผงถูกพับเก็บอยู่ไหม
  _entered: false,  // ผ่านประตูเข้ามาแล้ว (กันทำงานซ้ำเมื่อ auth event ยิงหลายครั้ง)
  _ids:     {},     // id ของข้อมูลตัวอย่าง — ปุ่มลัดใช้กระโดดเข้าหน้าลึกๆ

  // ---------- ตรวจว่าอยู่ในโหมดนี้ไหม ----------
  active() {
    if (this._on === null) {
      try { this._on = new URLSearchParams(location.search).get('preview') === '1'; }
      catch (_) { this._on = false; }
    }
    return this._on;
  },

  app() { return (typeof DB !== 'undefined' && String(DB.KEY || '').includes('_ri_')) ? 'roadside' : 'home'; },

  SURVEYOR: 'สมชาย ตัวอย่าง',
  TEAM:     'ทีมตัวอย่าง',

  // key ของ Firebase SDK เอง (auth token / สถานะข้ามแท็บ) — ไม่ใช่ข้อมูลของระบบเรา ปล่อยให้เขียนได้
  _sdkKey(k) { const s = String(k); return s.startsWith('firebase') || s.startsWith('firestore'); },

  // ---------- ปิดทางเขียนทุกทาง ----------
  // เรียกทันทีที่ไฟล์ถูกโหลด (ก่อน DOMContentLoaded → ก่อน App.init)
  install() {
    if (!this.active()) return;

    // 1) ที่เก็บในเครื่อง — ตัดขาดจาก IndexedDB/localStorage ของจริง
    if (typeof IDBStore !== 'undefined') {
      IDBStore.set = () => Promise.resolve();
      IDBStore.del = () => Promise.resolve();
      IDBStore.get = () => Promise.resolve(null);
    }
    DB.save       = () => {};
    DB.init       = async () => { if (!DB._ready) { DB._data = Preview.demoData(); DB._ready = true; } return DB._data; };
    DB.replaceAll = async (d) => { DB._data = d; };
    DB.clearAll   = async () => { DB._data = Preview.demoData(); };

    // 2) cloud — ไม่ push ไม่ pull
    if (typeof FB !== 'undefined') {
      FB._pushDoc = () => {};
      FB.syncAll  = async () => { throw new Error('โหมดดูตัวอย่าง — ไม่ส่งข้อมูลขึ้นระบบ'); };
      FB.pullAll  = async () => 0;
      FB._pullByField = async () => 0;
    }

    // 3) คลังสถานที่ — เลือกหมุดบนแผนที่แล้วระบบจะจำสถานที่นั้นขึ้น cloud ให้อัตโนมัติ
    //    ผู้ตรวจลองเล่นแผนที่ ไม่ควรกลายเป็นข้อมูลในคลังของโครงการจริง
    if (typeof PlaceService !== 'undefined') {
      PlaceService.savePlace = async () => ({ action: 'preview', place: null });
    }

    // 4) localStorage — กันเขียนทุก key ยกเว้นของ Firebase SDK เอง (ต้องใช้ยืนยันตัวตน/คุยข้ามแท็บ)
    //    เครื่องเดียวอาจเป็นเครื่องผู้สำรวจตัวจริง เปิดดูตัวอย่างแล้วต้องไม่ทับ
    //    ชื่อผู้สำรวจ / โครงการที่จำไว้ / cache สถานที่ ของงานที่ทำค้างอยู่
    const setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && !Preview._sdkKey(k)) return;
      return setItem.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k) {
      if (this === localStorage && !Preview._sdkKey(k)) return;
      return removeItem.call(this, k);
    };

    // 5) รายชื่อผู้ควบคุม — ใช้ชื่อสมมติ ไม่เปิดชื่อทีมจริงให้คนนอก
    if (typeof Supervisors !== 'undefined') {
      Supervisors.load = async () => Supervisors.list();
      Supervisors.list = () => [{ key: 'preview', name: Preview.TEAM }];
    }

    // 6) ประตู — โหมดนี้เปิดให้เฉพาะ admin เท่านั้น
    //    ปิดทางเข้าแบบ "ผู้สำรวจ" ทิ้งไปเลย (หน้าเลือกบทบาทเดิมมีปุ่มนั้นอยู่)
    App.init = async () => { await DB.init(); Preview._boot(); };
    App._showLoginGate = () => Preview._gate();

    // ทุกทางที่เข้าแอปได้ต้องผ่านตรงนี้ — รวมทางที่ผู้ใช้กด login เองจากหน้าประตู
    const enterApp = App._enterApp.bind(App);
    App._enterApp = function (...a) {
      if (App._role !== 'admin') { Preview._gate(Preview.DENY); return; }
      enterApp(...a);
      Preview._afterEnter();
    };

    App.logout      = () => Preview.exit();
    App._silentPull = async () => {};
    App.pullFromCloud = () => App.toast('โหมดดูตัวอย่าง — ไม่ดึงข้อมูลจริงมาแสดง', 'error');
    App.syncToCloud   = async () => App.toast('โหมดดูตัวอย่าง — ข้อมูลจะไม่ถูกบันทึก', 'error');
  },

  DENY: 'บัญชีนี้ไม่ใช่ผู้ดูแลระบบ — โหมดดูตัวอย่างเปิดให้เฉพาะผู้ดูแลระบบ',

  // ---------- ประตู: เฉพาะผู้ดูแลระบบ ----------
  _boot() {
    this._gate(null, true);
    if (typeof FB === 'undefined' || !FB.auth) { this._gate(); return; }
    FB.auth.onAuthStateChanged(async u => {
      if (this._entered) return;
      // anonymous = token ที่ FB.init เซ็นให้อัตโนมัติ ไม่ใช่การ login → ยังไม่ผ่าน
      if (!u || u.isAnonymous) { this._gate(); return; }
      let r = null;
      try { r = await Role.resolve(u, FB.db, true); } catch (_) {}
      if (r && r.role === 'admin') {
        App._role = 'admin';
        App._adminUsername = r.displayName || r.username || '';
        App._enterApp();
      } else {
        this._gate(this.DENY);
      }
    });
  },

  _gate(err, busy) {
    const tb = document.querySelector('.topbar');
    if (tb) tb.style.display = 'none';
    const panel = document.getElementById('pvPanel');
    if (panel) panel.remove();
    document.body.style.paddingRight = '';
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;padding:24px;text-align:center">
        <div style="font-size:46px;margin-bottom:12px">👁</div>
        <div style="font-size:21px;font-weight:700;color:var(--gray-800)">โหมดดูตัวอย่างแบบสอบถาม</div>
        <div style="font-size:13px;color:var(--gray-500);margin-top:7px;max-width:330px;line-height:1.8">
          เปิดดูได้ทุกหน้าโดยไม่กระทบข้อมูลจริง<br><b>เฉพาะผู้ดูแลระบบเท่านั้น</b>
        </div>
        ${err ? `<div style="margin-top:16px;padding:10px 15px;border-radius:9px;max-width:330px;
          background:#fee2e2;color:#b91c1c;font-size:13px;line-height:1.7">${App.esc(err)}</div>` : ''}
        <div style="margin-top:22px;width:100%;max-width:290px">
          ${busy
            ? `<div style="color:var(--gray-400);font-size:14px">กำลังตรวจสิทธิ์…</div>`
            : `<button class="btn btn-primary" style="padding:14px;font-size:15px;width:100%"
                 onclick="App.loginAsAdmin()">🔐 เข้าสู่ระบบผู้ดูแลระบบ</button>`}
        </div>
      </div>`;
  },

  // ---------- เข้าแอปแล้ว ----------
  _afterEnter() {
    App._surveyorName = this.SURVEYOR;   // ชื่อที่ติดกับข้อมูลตัวอย่าง
    App._team         = '';
    // "เมนูหลัก" พาออกจากโหมดนี้ไปหน้าระบบ — ต้องกลับมาเปิดลิงก์ใหม่ ตัดออกให้เหลือทางเดียว
    document.querySelectorAll('#topbarRight .tb-link, #topbarRight .tb-sep').forEach(el => el.remove());
    this._mountPanel();

    if (this._entered) return;
    this._entered = true;

    // ตัวเลือกจริงของโครงการ (ประเภทรถ / วัตถุประสงค์ ที่โครงการนี้ตั้งไว้) — คือของที่เขามาตรวจ
    // มาช้ากว่าข้อมูลตัวอย่างที่สร้างไว้แล้ว → สร้างใหม่ให้ตรงชุดตัวเลือก แล้ววาดหน้าใหม่
    Project.load(FB.db).then(m => {
      this._paintProjectName();
      // โครงการที่เก็บแค่ริมทาง ไม่ควรเปิดตัวอย่างของ Home ได้ (พิมพ์ URL เอง/ลิงก์เก่า)
      // — ผู้ตรวจจะเข้าใจผิดว่าโครงการนี้เก็บด้วย
      const apps = (m && m.apps) || {};
      if (apps[this.app()] === false) {
        SurveyLink.block(`โครงการ "${(m && m.name) || Project.id()}" ไม่ได้เปิดใช้แบบสอบถามนี้`);
      }
    }).catch(() => {});
    Project.loadOptions(FB.db, this.app(), OPT)
      .then(d => { if (d) { DB._data = this.demoData(); App.render(); } })
      .catch(() => {});
  },

  exit() { location.href = '../index.html'; },

  // เริ่มตัวอย่างใหม่ — กรอกมั่วไว้แล้วอยากได้ของสะอาดกลับมา
  reset() {
    DB._data = this.demoData();
    App.closeModal();
    App.navigate('home');
    App.toast('เริ่มตัวอย่างใหม่แล้ว', 'success');
  },

  // ---------- ปุ่มลัดไปแต่ละหน้า ----------
  // จุดขายของโหมดนี้: ไม่ต้องรู้ว่าต้องกดอะไรถึงจะเห็นหน้าลึกๆ กดจากแผงได้เลย
  _pages() {
    const id = this._ids;
    if (this.app() === 'roadside') {
      return [
        { i: '📋', t: 'หน้าหลัก',            go: () => App.navigate('home') },
        { i: '➕', t: 'ฟอร์มเพิ่มจุดสำรวจ',  go: () => { App.navigate('home'); App.openAddStation(); } },
        { i: '🚦', t: 'หน้าจุดสำรวจ',        go: () => App.navigate('station', id.st) },
        { i: '🧭', t: 'สัมภาษณ์ทีละคำถาม',   go: () => { App.navigate('station', id.st); App.openWizard(); } },
        { i: '📝', t: 'ฟอร์มเต็ม (แก้ไข)',   go: () => { App.navigate('station', id.st); App.openInterviewForm(id.iv); } },
        { i: '🔎', t: 'รายละเอียดที่บันทึก', go: () => App.navigate('interview', id.st, id.iv) },
        { i: '🗑', t: 'ถังขยะ',              go: () => App.navigate('trash') }
      ];
    }
    return [
      { i: '📋', t: 'หน้าหลัก',            go: () => App.navigate('home') },
      { i: '➕', t: 'ฟอร์มเพิ่มครัวเรือน', go: () => { App.navigate('home'); App.openAddHousehold(); } },
      { i: '🏠', t: 'หน้าครัวเรือน',       go: () => App.navigate('household', id.hh) },
      { i: '👤', t: 'ข้อมูลสมาชิก',        go: () => { App.navigate('member', id.hh, id.m); App.switchTab('info'); } },
      { i: '🚗', t: 'รายการเดินทาง',       go: () => { App.navigate('member', id.hh, id.m); App.switchTab('trips'); } },
      { i: '📝', t: 'ฟอร์มการเดินทาง',     go: () => { App.navigate('member', id.hh, id.m); App.switchTab('trips'); App.openTripForm(id.t); } },
      { i: '🗑', t: 'ถังขยะ',              go: () => App.navigate('trash') }
    ];
  },

  jump(i) {
    const p = this._pages()[i];
    if (!p) return;
    App.closeModal();   // กระโดดหน้าใหม่ทั้งที popup เดิมยังค้าง = ซ้อนกันมั่ว
    try { p.go(); } catch (e) { App.toast('เปิดหน้านี้ไม่ได้: ' + e.message, 'error'); }
  },

  // ---------- แผงลอยฝั่งขวา ----------
  // จงใจทำเป็นแผงลอยไม่ใช่ส่วนหนึ่งของหน้า — ให้เห็นชัดว่านี่ "ของแถมของโหมดพิเศษ"
  // ไม่ใช่เมนูของแบบสอบถามจริง (ผู้ตรวจจะได้ไม่นึกว่าผู้สำรวจก็เห็นแบบนี้)
  SHELL: "position:fixed;right:14px;z-index:9999;font-family:'Sarabun',sans-serif;",

  _mountPanel() {
    if (document.getElementById('pvPanel')) return;

    const st = document.createElement('style');
    st.textContent =
      // toast เดิมอยู่มุมขวาล่าง ชนกับปุ่มตอนพับแผงพอดี — ยกขึ้นให้พ้น
      '.toast-wrap { bottom: 74px !important; }' +
      '#pvPanel .pv-item { display:flex;align-items:center;gap:9px;width:100%;text-align:left;' +
      'background:#2c2c2e;border:1px solid #3a3a3c;color:#e5e5ea;font-family:inherit;font-size:12.5px;' +
      'font-weight:600;padding:8px 10px;border-radius:9px;cursor:pointer;margin-bottom:5px }' +
      '#pvPanel .pv-item:hover { background:#3a3a3c;border-color:#5a5a5e }' +
      '#pvPanel .pv-mini { background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;' +
      'font-size:11.5px;font-weight:600;padding:6px 9px;border-radius:8px;cursor:pointer;flex:1 }';
    document.head.appendChild(st);

    const el = document.createElement('div');
    el.id = 'pvPanel';
    document.body.appendChild(el);
    // จอแคบ (มือถือ/แท็บเล็ต) แผงจะทับ popup ที่กลางจอ → เริ่มแบบพับไว้ก่อน กดเรียกเอา
    this._min = innerWidth < 1000;
    this._paintPanel();
  },

  toggleMin() { this._min = !this._min; this._paintPanel(); },

  _paintPanel() {
    const el = document.getElementById('pvPanel');
    if (!el) return;

    // แผงลอยทับเนื้อหาฝั่งขวาได้ (ปุ่มแถวบนสุดของบางหน้ายาวเลยไปถึงขอบ) → หลบให้ด้วยการหด body
    document.body.style.paddingRight = this._min ? '' : '238px';

    if (this._min) {
      el.setAttribute('style', this.SHELL + 'bottom:16px');
      el.innerHTML = `<button onclick="Preview.toggleMin()" title="โหมดดูตัวอย่าง — เปิดแผงเครื่องมือ"
        style="background:#1c1c1e;border:1px solid rgba(255,214,10,.45);color:#ffd60a;font-family:inherit;
        font-size:12.5px;font-weight:700;padding:9px 15px;border-radius:99px;cursor:pointer;
        box-shadow:0 4px 18px rgba(0,0,0,.45)">👁 โหมดดูตัวอย่าง</button>`;
      return;
    }

    el.setAttribute('style', this.SHELL +
      'top:78px;width:210px;background:#1c1c1e;border:1px solid rgba(255,214,10,.32);' +
      'border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.45);color:#f5f5f7;padding:12px;' +
      'max-height:calc(100vh - 100px);overflow-y:auto');
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="font-size:12.5px;font-weight:700;color:#ffd60a;flex:1">👁 โหมดดูตัวอย่าง</span>
        <button onclick="Preview.toggleMin()" title="พับแผง"
          style="background:none;border:none;color:#8e8e93;font-family:inherit;font-size:15px;
          line-height:1;padding:2px 4px;cursor:pointer">–</button>
      </div>
      <div id="pvProj" style="font-size:11px;color:#8e8e93;line-height:1.55"></div>
      <div style="font-size:11px;color:#63e6a0;line-height:1.55;margin-bottom:11px">
        ข้อมูลที่กรอกไม่ถูกบันทึกและไม่ขึ้นระบบ
      </div>
      <div style="font-size:10.5px;color:#98989d;font-weight:700;letter-spacing:.4px;margin-bottom:6px">
        ไปที่หน้า
      </div>
      ${this._pages().map((p, i) =>
        `<button class="pv-item" onclick="Preview.jump(${i})"><span>${p.i}</span><span>${p.t}</span></button>`
      ).join('')}
      <div style="display:flex;gap:6px;margin-top:9px;padding-top:10px;border-top:1px solid #3a3a3c">
        <button class="pv-mini" onclick="Preview.reset()">↻ เริ่มใหม่</button>
        <button class="pv-mini" onclick="Preview.exit()">✕ ออก</button>
      </div>`;
    this._paintProjectName();
  },

  _paintProjectName() {
    const el = document.getElementById('pvProj');
    if (el) el.textContent = (Project.meta && Project.meta.name) || Project.id() || '';
  },

  // ---------- ข้อมูลตัวอย่าง ----------
  // สร้างจาก OPT ที่ใช้อยู่จริง ณ ตอนนั้น — โครงการที่ตั้งวัตถุประสงค์/ประเภทรถเอง
  // ตัวอย่างก็จะเป็นชุดของโครงการนั้น ไม่ใช่ชุด default ที่ผู้ตรวจไม่เคยเห็น
  demoData() { return this.app() === 'roadside' ? this._demoRoadside() : this._demoHome(); },

  _pick(arr, i, fallback) {
    if (!Array.isArray(arr) || !arr.length) return fallback || '';
    return arr[Math.min(i, arr.length - 1)];
  },
  _pickVal(arr, i, fallback) {
    const v = this._pick(arr, i, null);
    return v ? (v.val || v.label || v.key || fallback || '') : (fallback || '');
  },
  _today() { return new Date().toISOString().split('T')[0]; },
  _now()   { return new Date().toISOString(); },

  // ---- Home Interview ----
  _demoHome() {
    const today = this._today();
    const base  = { surveyorName: this.SURVEYOR, supervisorName: this.TEAM,
                    district: 'บ้านไผ่', province: 'ขอนแก่น', deviceId: 'PREVIEW' };
    const locT  = (i) => this._pick(OPT.locationType, i, 'ที่พัก / บ้านของตัวเอง');
    const purp  = (i) => this._pick(OPT.purpose, i, 'ไปทำงาน');

    this._ids = { hh: 'PV-HH-1', m: 'PV-M-1', t: 'PV-T-1' };

    const trip1 = {
      id: 'PV-T-1', seq: 1,
      origin: 'บ้านเลขที่ 99/1', originCoords: '16.05610,102.73000', originType: locT(0),
      departureTime: '07:30',
      destination: 'บริษัท ตัวอย่าง จำกัด', destinationCoords: '16.06020,102.73650', destinationType: locT(3),
      arrivalTime: '07:55', purpose: purp(1),
      segments: [{ mode: this._pick(OPT.tripMode, 7, 'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)'), duration: '25', fare: '' }],
      parkingLocation: 'ลานจอดของที่ทำงาน', parkingFee: '0'
    };
    const trip2 = {
      id: 'PV-T-2', seq: 2,
      origin: 'บริษัท ตัวอย่าง จำกัด', originCoords: '16.06020,102.73650', originType: locT(3),
      departureTime: '17:30',
      destination: 'บ้านเลขที่ 99/1', destinationCoords: '16.05610,102.73000', destinationType: locT(0),
      arrivalTime: '18:00', purpose: purp(0),
      segments: [{ mode: this._pick(OPT.tripMode, 7, 'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)'), duration: '30', fare: '' }],
      parkingLocation: 'ในบ้าน', parkingFee: '0'
    };
    const trip3 = {
      id: 'PV-T-3', seq: 1,
      origin: 'บ้านเลขที่ 99/1', originCoords: '16.05610,102.73000', originType: locT(0),
      departureTime: '08:00',
      destination: 'ตลาดสดเทศบาล', destinationCoords: '16.05880,102.73200', destinationType: locT(4),
      arrivalTime: '08:15', purpose: purp(6),
      segments: [{ mode: this._pick(OPT.tripMode, 3, 'รถจักรยานยนต์ส่วนตัว'), duration: '15', fare: '' }],
      parkingLocation: 'ริมถนน', parkingFee: '0'
    };

    const hh1 = {
      ...base, id: 'PV-HH-1', surveyDate: today, travelDate: today,
      subdistrict: this._pick(OPT.subdistricts, 0, ''), areaCode: '01',
      houseNo: '99/1', moo: '3', alley: '-', road: 'มิตรภาพ', phone: '0812345678',
      coordinates: '16.05610,102.73000', coordsSource: 'gps',
      residentialType: this._pick(OPT.residentialType, 0, 'บ้านเดี่ยว'),
      memberGrid: { m_work: 1, f_work: 1, m_study: 1 },
      householdIncome: '35000', hasVehicle: 'มี', vehicles: { car: 1, motorcycle: 2 },
      createdAt: this._now(),
      members: [
        {
          id: 'PV-M-1', seq: 1, gender: 'ชาย', age: '42',
          homeStatus: this._pick(OPT.homeStatus, 0, 'เจ้าบ้านผู้ชาย'),
          workStatus: this._pick(OPT.workStatus, 0, 'ทำงาน'),
          occupation: this._pick(OPT.occupation, 4, 'พนักงานบริษัท / ห้างร้าน / ธนาคาร'),
          education:  this._pick(OPT.education, 4, 'ปริญญาตรี'),
          workplaceName: 'บริษัท ตัวอย่าง จำกัด', workplaceCoords: '16.06020,102.73650',
          workplaceAlley: '', workplaceRoad: 'มิตรภาพ',
          workplaceSubdistrict: 'ในเมือง', workplaceDistrict: 'บ้านไผ่', workplaceProvince: 'ขอนแก่น',
          income: '25000', trips: [trip1, trip2]
        },
        {
          id: 'PV-M-2', seq: 2, gender: 'หญิง', age: '38',
          homeStatus: this._pick(OPT.homeStatus, 1, 'เจ้าบ้านผู้หญิง'),
          workStatus: this._pick(OPT.workStatus, 0, 'ทำงาน'),
          occupation: this._pick(OPT.occupation, 3, 'เจ้าของกิจการ / บริษัท'),
          education:  this._pick(OPT.education, 3, 'อนุปริญญา / ปวช. / ปวส.'),
          workplaceName: 'ร้านค้าในตลาดสด', workplaceCoords: '16.05880,102.73200',
          workplaceAlley: '', workplaceRoad: 'เจนจบทิศ',
          workplaceSubdistrict: 'ในเมือง', workplaceDistrict: 'บ้านไผ่', workplaceProvince: 'ขอนแก่น',
          income: '18000', trips: [trip3]
        }
      ]
    };

    // หลังที่ 2 จงใจให้ยังไม่มีคนเดินทาง — ผู้ตรวจจะได้เห็นว่าระบบเตือนบ้านที่เก็บไม่ครบยังไง
    const hh2 = {
      ...base, id: 'PV-HH-2', surveyDate: today, travelDate: today,
      subdistrict: this._pick(OPT.subdistricts, 1, ''), areaCode: '02',
      houseNo: '12', moo: '5', alley: '', road: 'เจนจบทิศ', phone: '',
      coordinates: '', coordsSource: '',
      residentialType: this._pick(OPT.residentialType, 1, 'ตึกแถว'),
      memberGrid: { m_notw: 1, f_notw: 1 },
      householdIncome: '', hasVehicle: 'ไม่มี', vehicles: {},
      createdAt: this._now(), members: []
    };

    // หลังที่ 3 อยู่ในถังขยะ — ให้มุมมองผู้ดูแลระบบมีของให้ดู
    const hh3 = {
      ...base, id: 'PV-HH-3', surveyDate: today, travelDate: today,
      subdistrict: this._pick(OPT.subdistricts, 2, ''), areaCode: '03',
      houseNo: '7/2', moo: '1', alley: '', road: 'ราษฎร์อุทิศ', phone: '',
      coordinates: '16.05300,102.72800', coordsSource: 'manual',
      residentialType: this._pick(OPT.residentialType, 2, 'ทาวน์เฮ้าส์'),
      memberGrid: {}, householdIncome: '', hasVehicle: '', vehicles: {},
      createdAt: this._now(), members: [],
      _deleted: true, _deletedAt: this._now(), _deletedBy: 'ผู้ดูแลระบบ (ตัวอย่าง)'
    };

    return { households: [hh1, hh2, hh3] };
  },

  // ---- Roadside Interview ----
  _demoRoadside() {
    const today = this._today();
    const veh   = (i) => (this._pick(OPT.vehicleTypes, i, {}) || {}).key || '';
    const locT  = (i) => this._pick(OPT.locationType, i, 'ที่พัก / บ้านของตัวเอง');
    const purp  = (i) => this._pick(OPT.purpose, i, 'ไปทำงาน');
    const axis  = this._pick(OPT.roadAxis, 0, 'เหนือ–ใต้');
    const dirs  = (OPT.directionsByAxis || {})[axis] || ['มุ่งทิศเหนือ', 'มุ่งทิศใต้'];

    this._ids = { st: 'PV-RS-1', iv: 'PV-IV-1' };

    const ivBase = { surveyorName: this.SURVEYOR, interviewDate: today, createdAt: this._now() };

    const st1 = {
      id: 'PV-RS-1', surveyDate: today,
      surveyorName: this.SURVEYOR, supervisorName: this.TEAM,
      stationName: 'จุดสำรวจตัวอย่าง — สี่แยกกลางเมือง', stationCode: 'ST-01',
      road: 'ทางหลวงหมายเลข 2', direction: axis,
      coordinates: '16.05610,102.73000',
      subdistrict: 'ในเมือง', district: 'บ้านไผ่', province: 'ขอนแก่น',
      deviceId: 'PREVIEW', createdAt: this._now(),
      interviews: [
        {
          ...ivBase, id: 'PV-IV-1', stationId: 'PV-RS-1', seq: 1,
          interviewTime: '08:15', vehicleType: veh(4), passengerCount: '2',
          travelDirection: dirs[0],
          originType: locT(0), originTypeOther: '', originName: 'บ้านพักในเขตเทศบาล',
          originCoords: '16.05300,102.72800',
          destinationType: locT(3), destinationTypeOther: '', destinationName: 'สำนักงานกลางเมือง',
          destinationCoords: '16.06020,102.73650',
          purpose: purp(1), hasCargo: 'ไม่มี', cargoType: '', cargoTypeOther: '', cargoWeight: '',
          driverIncome: '25000'
        },
        {
          ...ivBase, id: 'PV-IV-2', stationId: 'PV-RS-1', seq: 2,
          interviewTime: '09:40', vehicleType: veh(8), passengerCount: '1',
          travelDirection: dirs[1] || dirs[0],
          originType: locT(5), originTypeOther: '', originName: 'โกดังสินค้าเขตอุตสาหกรรม',
          originCoords: '16.04900,102.74100',
          destinationType: locT(4), destinationTypeOther: '', destinationName: 'ตลาดสดเทศบาล',
          destinationCoords: '16.05880,102.73200',
          purpose: purp(5), hasCargo: 'มี',
          cargoType: this._pick(OPT.cargoTypes, 3, 'ข้าว'), cargoTypeOther: '', cargoWeight: '8',
          driverIncome: '20000'
        },
        {
          ...ivBase, id: 'PV-IV-3', stationId: 'PV-RS-1', seq: 3,
          interviewTime: '10:05', vehicleType: veh(2), passengerCount: '1',
          travelDirection: dirs[0],
          originType: locT(0), originTypeOther: '', originName: 'บ้านพัก',
          originCoords: '16.05100,102.73400',
          destinationType: locT(1), destinationTypeOther: '', destinationName: 'โรงเรียนประจำอำเภอ',
          destinationCoords: '16.05950,102.73900',
          purpose: purp(2), hasCargo: 'ไม่มี', cargoType: '', cargoTypeOther: '', cargoWeight: '',
          driverIncome: '',
          _deleted: true, _deletedAt: this._now(), _deletedBy: 'ผู้ดูแลระบบ (ตัวอย่าง)'
        }
      ]
    };

    // จุดที่ 2 ยังไม่มีการสำรวจ — ให้เห็นหน้าจุดสำรวจตอนว่าง
    const st2 = {
      id: 'PV-RS-2', surveyDate: today,
      surveyorName: this.SURVEYOR, supervisorName: this.TEAM,
      stationName: 'จุดสำรวจตัวอย่าง — ทางเข้าเมืองด้านใต้', stationCode: 'ST-02',
      road: 'ทางหลวงชนบท ขก.3021', direction: this._pick(OPT.roadAxis, 1, 'ตะวันออก–ตะวันตก'),
      coordinates: '16.04200,102.72500',
      subdistrict: 'ในเมือง', district: 'บ้านไผ่', province: 'ขอนแก่น',
      deviceId: 'PREVIEW', createdAt: this._now(),
      interviews: []
    };

    return { stations: [st1, st2] };
  }
};

Preview.install();
