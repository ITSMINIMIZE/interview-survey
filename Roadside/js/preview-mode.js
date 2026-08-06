// ===== โหมดดูตัวอย่างแบบสอบถาม (observe) =====
//
//   .../Home/?project=<pid>&preview=1
//   .../Roadside/?project=<pid>&preview=1
//
// ไว้ให้ผู้ตรวจ (กรม / ผู้ว่าจ้าง) เปิดดูว่าแบบสอบถามหน้าตาเป็นยังไง มีองค์ประกอบอะไรบ้าง
// โดยไม่ต้องมีบัญชี ไม่ต้องขอลิงก์ผู้สำรวจ และต้องไม่ทิ้งขยะไว้ในระบบ
//
// หลักการ 3 ข้อ:
//   1) ไม่เขียนอะไรทั้งสิ้น — patch DB.save / IDBStore / FB._pushDoc ให้เป็น no-op
//      ข้อมูลตัวอย่างอยู่ใน RAM อย่างเดียว ปิดแท็บแล้วหายเกลี้ยง
//      (สำคัญมาก: เครื่องเดียวอาจถูกใช้สำรวจจริงด้วย ห้ามให้ตัวอย่างปนเข้า IndexedDB ของโครงการ)
//   2) ไม่แตะข้อมูลจริง — ไม่ pull จาก cloud, ไม่อ่านรายชื่อผู้ควบคุมจริง (ใช้ชื่อสมมติ)
//      สิ่งเดียวที่อ่านของจริงคือ "ตัวเลือกของแบบสอบถาม" ของโครงการนั้น เพราะนั่นคือสิ่งที่เขามาตรวจ
//   3) ไม่ต้อง login — ข้ามหน้าเลือกบทบาทไปเลย แล้วให้สลับดูได้ครบทั้ง 3 มุมมอง
//
// ⚠️ ไฟล์นี้ถูก copy ให้เหมือนกันทั้ง Home/js/ และ Roadside/js/ (แก้ที่ Home แล้วรัน ./sync-shared.sh)
//    ตัวไฟล์รู้เองว่าอยู่แอปไหนจาก DB.KEY — ข้อมูลตัวอย่างจึงต่างกันได้ในไฟล์เดียว
const Preview = {
  _on:   null,
  _role: 'surveyor',
  _min:  false,  // แถบถูกพับเก็บอยู่ไหม
  _ids:  {},     // id ของข้อมูลตัวอย่าง — ปุ่มลัดใช้กระโดดเข้าหน้าลึกๆ

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

    // 6) บูตเอง — ข้ามหน้า login ทั้งหมด
    App._bootHandled = true;         // กัน onAuthStateChanged ของ App เข้ามาแย่ง
    App.init = async () => { await DB.init(); Preview._enter(); };
    App.logout      = () => Preview.exit();
    App._silentPull = async () => {};
    App.pullFromCloud = () => App.toast('โหมดดูตัวอย่าง — ไม่ดึงข้อมูลจริงมาแสดง', 'error');
    App.syncToCloud   = async () => App.toast('โหมดดูตัวอย่าง — ข้อมูลจะไม่ถูกบันทึก', 'error');
  },

  // ---------- เข้าแอป ----------
  _enter() {
    this.setRole(this._role, true);
    this._mountBar();

    // ตัวเลือกจริงของโครงการ (ประเภทรถ / วัตถุประสงค์ ที่โครงการนี้ตั้งไว้) — คือของที่เขามาตรวจ
    // มาช้ากว่าข้อมูลตัวอย่างที่สร้างไว้แล้ว → สร้างใหม่ให้ตรงชุดตัวเลือก แล้ววาดหน้าใหม่
    //
    // ⚠️ ต้องรอ token ก่อน — ยิงอ่านตั้งแต่ยังไม่มี anonymous user จะโดนปฏิเสธเงียบๆ
    //    แล้วได้ชื่อโครงการ/ตัวเลือกเป็นค่า default โดยไม่มี error ให้เห็น
    this._whenSignedIn(() => {
      Project.load(FB.db).then(m => {
        this._paintProjectName();
        // โครงการที่เก็บแค่ริมทาง ไม่ควรมีใครเปิดตัวอย่างของ Home ได้ (พิมพ์ URL เอง/ลิงก์เก่า)
        // — ผู้ตรวจจะเข้าใจผิดว่าโครงการนี้เก็บด้วย
        const apps = (m && m.apps) || {};
        if (apps[this.app()] === false) {
          SurveyLink.block(`โครงการ "${(m && m.name) || Project.id()}" ไม่ได้เปิดใช้แบบสอบถามนี้`);
        }
      }).catch(() => {});
      Project.loadOptions(FB.db, this.app(), OPT)
        .then(d => { if (d) { DB._data = this.demoData(); App.render(); } })
        .catch(() => {});
    });
  },

  _whenSignedIn(fn) {
    if (typeof FB === 'undefined' || !FB.db || !FB.auth) return;
    if (FB.auth.currentUser) { fn(); return; }
    const stop = FB.auth.onAuthStateChanged(u => { if (u) { stop(); fn(); } });
  },

  exit() { location.href = '../index.html'; },

  // ---------- สลับมุมมองบทบาท ----------
  // แบบสอบถามหน้าตาไม่เหมือนกันในแต่ละบทบาท (ผู้สำรวจเห็นเฉพาะของตัวเอง ผู้ดูแลเห็นถังขยะ ฯลฯ)
  // ผู้ตรวจควรได้เห็นครบทั้งสามมุม ไม่ใช่มุมเดียว
  setRole(role, quiet) {
    this._role = role;
    App._surveyorName  = this.SURVEYOR;
    App._team          = '';
    App._adminUsername = '';
    if (role === 'surveyor') {
      App._role = 'surveyor';
    } else if (role === 'staff') {
      App._role = 'staff';
      App._team = this.TEAM;
      App._adminUsername = 'ผู้ควบคุม (ตัวอย่าง)';
    } else {
      App._role = 'admin';
      App._adminUsername = 'ผู้ดูแลระบบ (ตัวอย่าง)';
    }
    App.closeModal();
    App._enterApp();
    // "เมนูหลัก" พาไปหน้า login ของระบบ — ผู้ตรวจไม่มีบัญชี กดไปก็ตัน เอาออก
    document.querySelectorAll('#topbarRight .tb-link, #topbarRight .tb-sep').forEach(el => el.remove());
    this._paintBar();
    if (!quiet) App.toast('มุมมอง: ' + this._roleLabel(role), 'success');
  },

  _roleLabel(r) {
    return r === 'surveyor' ? 'ผู้สำรวจ' : r === 'staff' ? 'ผู้ควบคุม' : 'ผู้ดูแลระบบ';
  },

  // เริ่มตัวอย่างใหม่ — กรอกมั่วไว้แล้วอยากได้ของสะอาดกลับมา
  reset() {
    DB._data = this.demoData();
    App.closeModal();
    App.navigate('home');
    App.toast('เริ่มตัวอย่างใหม่แล้ว', 'success');
  },

  // ---------- ปุ่มลัดไปแต่ละหน้า ----------
  // จุดขายของโหมดนี้: ผู้ตรวจไม่ต้องรู้ว่าต้องกดอะไรถึงจะเห็นหน้าลึกๆ กดจากแถบล่างได้เลย
  _pages() {
    const id = this._ids;
    if (this.app() === 'roadside') {
      return [
        { t: 'หน้าหลัก',            go: () => App.navigate('home') },
        { t: 'ฟอร์มเพิ่มจุดสำรวจ',  go: () => { this._need('staff'); App.navigate('home'); App.openAddStation(); } },
        { t: 'หน้าจุดสำรวจ',        go: () => App.navigate('station', id.st) },
        { t: 'สัมภาษณ์ทีละคำถาม',   go: () => { App.navigate('station', id.st); App.openWizard(); } },
        { t: 'ฟอร์มเต็ม (แก้ไข)',   go: () => { App.navigate('station', id.st); App.openInterviewForm(id.iv); } },
        { t: 'รายละเอียดที่บันทึก', go: () => App.navigate('interview', id.st, id.iv) },
        { t: 'ถังขยะ',              go: () => { this._need('admin'); App.navigate('trash'); } }
      ];
    }
    return [
      { t: 'หน้าหลัก',            go: () => App.navigate('home') },
      { t: 'ฟอร์มเพิ่มครัวเรือน', go: () => { App.navigate('home'); App.openAddHousehold(); } },
      { t: 'หน้าครัวเรือน',       go: () => App.navigate('household', id.hh) },
      { t: 'ข้อมูลสมาชิก',        go: () => { App.navigate('member', id.hh, id.m); App.switchTab('info'); } },
      { t: 'รายการเดินทาง',       go: () => { App.navigate('member', id.hh, id.m); App.switchTab('trips'); } },
      { t: 'ฟอร์มการเดินทาง',     go: () => { App.navigate('member', id.hh, id.m); App.switchTab('trips'); App.openTripForm(id.t); } },
      { t: 'ถังขยะ',              go: () => { this._need('admin'); App.navigate('trash'); } }
    ];
  },

  // บางหน้าเปิดได้เฉพาะบางบทบาท — สลับบทบาทให้เองแทนที่จะขึ้น "ไม่มีสิทธิ์" ใส่หน้าผู้ตรวจ
  _need(role) {
    const rank = { surveyor: 0, staff: 1, admin: 2 };
    if (rank[this._role] < rank[role]) this.setRole(role, true);
  },

  jump(i) {
    const p = this._pages()[i];
    if (!p) return;
    App.closeModal();   // กระโดดหน้าใหม่ทั้งที popup เดิมยังค้าง = ซ้อนกันมั่ว
    try { p.go(); } catch (e) { App.toast('เปิดหน้านี้ไม่ได้: ' + e.message, 'error'); }
  },

  // ---------- แถบเครื่องมือล่างจอ ----------
  _mountBar() {
    if (document.getElementById('pvBar')) return;

    // แถบต้องอยู่บนสุดเสมอ (แม้ตอนเปิด popup) ผู้ตรวจจะได้กระโดดหน้าถัดไปได้ตลอด
    // → ต้องดัน popup กับ toast ขึ้นมาไม่ให้มุดอยู่ใต้แถบ ไม่งั้นปุ่ม "บันทึก" ของฟอร์มจะถูกบัง
    const st = document.createElement('style');
    st.textContent =
      '.modal-overlay { padding-bottom: 150px !important; }' +
      '.toast-wrap { bottom: 150px !important; }' +
      // ปุ่มทั้งหมดอยู่บรรทัดเดียวแล้วเลื่อนเอา — ปล่อยให้ตกบรรทัดจะกินจอมือถือไปครึ่งหนึ่ง
      '#pvBar .pv-scroll { display:flex;align-items:center;gap:6px;flex-wrap:nowrap;' +
      'overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:3px }' +
      '#pvBar .pv-scroll::-webkit-scrollbar { height:4px }' +
      '#pvBar .pv-scroll::-webkit-scrollbar-thumb { background:#48484a;border-radius:2px }' +
      '@media (max-width:640px){ #pvBar .pv-note { display:none } }';
    document.head.appendChild(st);

    const bar = document.createElement('div');
    bar.id = 'pvBar';
    bar.setAttribute('style',
      'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1c1c1e;' +
      'border-top:1px solid rgba(255,255,255,.12);color:#f5f5f7;' +
      "font-family:'Sarabun',sans-serif;padding:10px 14px;box-shadow:0 -6px 22px rgba(0,0,0,.28)");
    document.body.appendChild(bar);
    this._paintBar();
    // แถบสูงไม่เท่ากันตามจำนวนปุ่ม/ความกว้างจอ → วัดจริงทุกครั้ง ไม่ตั้งค่าตายตัว
    addEventListener('resize', () => this._fitBar());
  },

  // เว้นที่ท้ายหน้าเท่าความสูงแถบ ไม่งั้นแถบบังปุ่มบรรทัดสุดท้าย
  _fitBar() {
    const bar = document.getElementById('pvBar');
    if (bar) document.body.style.paddingBottom = (bar.offsetHeight + 22) + 'px';
  },

  _btn(label, onclick, on) {
    return `<button onclick="${onclick}" style="background:${on ? '#0a84ff' : '#3a3a3c'};
      border:1px solid ${on ? '#0a84ff' : '#48484a'};color:${on ? '#fff' : '#d1d1d6'};
      font-family:inherit;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;
      cursor:pointer;white-space:nowrap;flex:none">${label}</button>`;
  },

  // ย่อแถบ — บนมือถือฟอร์มบางหน้ายาว ผู้ตรวจควรพับแถบเก็บได้แล้วค่อยเรียกกลับมา
  toggleMin() { this._min = !this._min; this._paintBar(); },

  _paintBar() {
    const bar = document.getElementById('pvBar');
    if (!bar) return;

    if (this._min) {
      bar.style.background = 'transparent';
      bar.style.borderTop  = 'none';
      bar.style.boxShadow  = 'none';
      bar.style.pointerEvents = 'none';
      bar.innerHTML = `<div style="display:flex;justify-content:flex-end;pointer-events:auto">
        <button onclick="Preview.toggleMin()" style="background:#1c1c1e;border:1px solid rgba(255,214,10,.4);
          color:#ffd60a;font-family:inherit;font-size:12px;font-weight:700;padding:8px 14px;border-radius:99px;
          cursor:pointer;box-shadow:0 3px 14px rgba(0,0,0,.4)">👁 โหมดดูตัวอย่าง</button></div>`;
      this._fitBar();
      return;
    }

    bar.style.background = '#1c1c1e';
    bar.style.borderTop  = '1px solid rgba(255,255,255,.12)';
    bar.style.boxShadow  = '0 -6px 22px rgba(0,0,0,.28)';
    bar.style.pointerEvents = '';

    const roles = [['surveyor','👤 ผู้สำรวจ'], ['staff','🧑‍💼 ผู้ควบคุม'], ['admin','🔐 ผู้ดูแลระบบ']];
    const sep   = '<span style="width:1px;height:18px;background:#48484a;margin:0 5px;flex:none"></span>';
    const cap   = t => `<span style="font-size:11.5px;color:#98989d;font-weight:600;flex:none">${t}</span>`;
    bar.innerHTML = `
      <div style="max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:7px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span style="font-size:12.5px;font-weight:700;color:#ffd60a">👁 โหมดดูตัวอย่าง</span>
            <span style="font-size:11.5px;color:#8e8e93" id="pvProj"></span>
            <span class="pv-note" style="font-size:11.5px;color:#8e8e93">· ข้อมูลที่กรอกจะไม่ถูกบันทึกและไม่ส่งขึ้นระบบ</span>
          </div>
          ${this._btn('↻ เริ่มใหม่', 'Preview.reset()')}
          ${this._btn('▾ ย่อ', 'Preview.toggleMin()')}
          ${this._btn('✕ ออก', 'Preview.exit()')}
        </div>
        <div class="pv-scroll">
          ${cap('มุมมอง')}
          ${roles.map(([r, l]) => this._btn(l, `Preview.setRole('${r}')`, this._role === r)).join('')}
          ${sep}${cap('ไปที่หน้า')}
          ${this._pages().map((p, i) => this._btn(p.t, `Preview.jump(${i})`)).join('')}
        </div>
      </div>`;
    this._paintProjectName();
    this._fitBar();
  },

  _paintProjectName() {
    const el = document.getElementById('pvProj');
    if (el) el.textContent = '· ' + ((Project.meta && Project.meta.name) || Project.id() || '');
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
