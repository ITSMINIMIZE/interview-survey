// ===== HOME INTERVIEW APP (v2) =====
const App = {
  page: 'home', hhId: null, memberId: null, memberTab: 'info', editingTripId: null,
  _clientIp: '',
  _role: null,          // 'admin' | 'staff' | 'surveyor'
  _surveyorName: '',    // ชื่อ-นามสกุล ผู้สำรวจ
  _adminUsername: '',   // username ผู้ดูแล/ผู้ควบคุม
  _team: '',            // staff: ชื่อผู้ควบคุม = ทีมที่ตัวเองดูแล
  _bootHandled: false,  // กันเข้าแอปซ้ำเมื่อ auth event ยิงหลายครั้ง

  // ---- สิทธิ์ ----
  _isAdmin()   { return this._role === 'admin'; },
  // ครัวเรือนที่บทบาทนี้เห็นได้: admin=ทั้งหมด · staff=ทีมตัวเอง · ผู้สำรวจ=ของตัวเอง
  _visibleHouseholds(list) {
    if (this._isAdmin()) return list;
    if (this._isStaff()) return list.filter(h => this._normName(h.supervisorName) === this._team);
    return list.filter(h => h.surveyorName === this._surveyorName);
  },
  _isStaff()   { return this._role === 'staff'; },
  _canManage() { return this._role === 'admin' || this._role === 'staff'; },  // เห็นเครื่องมือจัดการ
  _canSeeAll() { return this._role === 'admin'; },                            // เห็นข้ามทีม
  _teamName()  { return this._team || ''; },
  // ดึงข้อมูลตามขอบเขตของบทบาท: admin=ทั้งหมด · staff=ทีมตัวเอง · ผู้สำรวจ=ของตัวเอง
  _pullScoped() {
    if (this._isAdmin()) return FB.pullAll();
    if (this._isStaff()) return FB.pullBySupervisor(this._team);
    return FB.pullBySurveyor(this._surveyorName);
  },

  async init() {
    // แสดง loading ก่อน
    document.querySelector('.topbar').style.display = 'none';
    document.getElementById('app').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:#94a3b8;font-size:14px;">กำลังโหลด...</div>';

    // โหลดข้อมูลจาก IndexedDB ก่อน render (+ migrate ครั้งแรกจาก localStorage) — ต้องเสร็จก่อน getter ทำงาน
    await DB.init();

    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => { this._clientIp = d.ip || ''; })
      .catch(() => {});


    // รอ Firebase Auth ตรวจสอบ session
    if (typeof firebase !== 'undefined' && firebase.apps?.length) {
      FB.onAuthStateChanged(async user => {
        // รายชื่อผู้ควบคุมสำหรับ dropdown — ต้องมี token ก่อนถึงอ่าน config ได้ (anonymous ก็พอ)
        if (user) {
          Supervisors.load(FB.db).catch(() => {});
          // ตัวเลือกของแบบสอบถามอาจถูกปรับตามโครงการ (เช่น ทช. ใช้ประเภทรถคนละชุด)
          // โหลดแล้ว render ใหม่ ถ้าฟอร์มถูกวาดไปก่อนด้วยค่า default
          Project.loadOptions(FB.db, 'home', OPT)
            .then(d => { if (d && this.render) this.render(); })
            .catch(() => {});
        }
        if (this._role || this._bootHandled) return; // เข้าระบบแล้ว ไม่ต้องทำซ้ำ
        // anonymous = ผู้สำรวจ/ยังไม่ login → ไปหน้าเลือกบทบาท
        if (!user || user.isAnonymous) { this._showLoginGate(); return; }
        this._bootHandled = true;   // ตั้งก่อน await — กัน event ยิงซ้ำระหว่างรออ่าน role
        const r = await Role.resolve(user, FB.db);
        if (r && (r.role === 'admin' || r.role === 'staff')) {
          this._adminUsername = r.displayName || r.username;
          this._role = r.role;
          this._team = r.supervisorName || '';
          this._enterApp();
        } else {
          // บัญชีจริงแต่ยังไม่ได้รับสิทธิ์ / ถูกปิด → ไม่ให้เข้าในฐานะผู้ดูแล
          this._bootHandled = false;
          this._showLoginGate();
        }
      });
    } else {
      this._showLoginGate();
    }
  },

  // ===================== LOGIN GATE =====================
  _showLoginGate() {
    document.querySelector('.topbar').style.display = 'none';
    document.getElementById('app').innerHTML = this._loginGateHTML();
  },

  _loginGateHTML() {
    return `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;padding:24px;background:var(--bg);">
        <div style="text-align:center;margin-bottom:48px;">
          <div style="font-size:48px;margin-bottom:12px;">🏠</div>
          <div style="font-size:22px;font-weight:700;color:var(--gray-800);">Home Interview</div>
          <div style="font-size:13px;color:var(--gray-500);margin-top:6px;">โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:300px;">
          <button class="btn btn-primary" style="padding:14px;font-size:15px;"
            onclick="App.loginAsSurveyor()">
            📋 เข้าใช้งานเป็นผู้สำรวจ
          </button>
          <button class="btn btn-ghost" style="padding:14px;font-size:15px;"
            onclick="App.loginAsAdmin()">
            🔐 เข้าสู่ระบบ (ผู้ดูแลระบบ)
          </button>
        </div>
      </div>`;
  },

  // ---- ผู้สำรวจ ----
  loginAsSurveyor() {
    this.showModal('📋 เข้าใช้งานเป็นผู้สำรวจ', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-row">
          <label class="form-label req">ชื่อ</label>
          <input id="sv_fname" class="form-input" autocomplete="off" placeholder="ชื่อจริง" />
        </div>
        <div class="form-row">
          <label class="form-label req">นามสกุล</label>
          <input id="sv_lname" class="form-input" autocomplete="off" placeholder="นามสกุล" />
        </div>
      </div>
      <p style="font-size:12px;color:var(--gray-400);margin-top:6px;">ไม่ต้องใส่คำนำหน้า · ต้องพิมพ์ชื่อให้ตรงกันทุกครั้งเพื่อดึงข้อมูลของคุณ</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.doSurveyorLogin()">เข้าใช้งาน</button>`
    );
    setTimeout(() => document.getElementById('sv_fname')?.focus(), 50);
  },

  // รวมชื่อให้เป็นรูปแบบเดียว — NFC + ตัดอักขระล่องหน (zero-width) + ยุบช่องว่างซ้อน
  _normName(s) {
    return String(s ?? '')
      .normalize('NFC')
      .replace(/[​-‏‪-‮⁠﻿]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  },

  doSurveyorLogin() {
    const fname = document.getElementById('sv_fname')?.value.trim();
    const lname = document.getElementById('sv_lname')?.value.trim();
    if (!fname) { this.toast('กรุณากรอกชื่อ', 'error'); return; }
    if (!lname) { this.toast('กรุณากรอกนามสกุล', 'error'); return; }
    this._surveyorName = this._normName(`${fname} ${lname}`);
    this._role = 'surveyor';
    this.closeModal();
    this._enterApp();
  },

  // ---- ผู้ดูแลระบบ / ผู้ควบคุม ----
  loginAsAdmin() {
    this.showModal('🔐 เข้าสู่ระบบ (ผู้ดูแล / ผู้ควบคุม)', `
      <div class="form-row">
        <label class="form-label req">ชื่อผู้ใช้ หรือ อีเมล</label>
        <input id="adm_user" class="form-input" autocomplete="username" placeholder="username หรือ email"
          onkeydown="if(event.key==='Enter')document.getElementById('adm_pass').focus()" />
        <div class="form-hint">ผู้ดูแล = ชื่อผู้ใช้ · ผู้ควบคุม = อีเมลที่ลงทะเบียนไว้</div>
      </div>
      <div class="form-row">
        <label class="form-label req">รหัสผ่าน</label>
        <input id="adm_pass" class="form-input" type="password" placeholder="password"
          onkeydown="if(event.key==='Enter')App.doAdminLogin()" />
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" id="adminLoginBtn" onclick="App.doAdminLogin()">เข้าสู่ระบบ</button>`
    );
    setTimeout(() => document.getElementById('adm_user')?.focus(), 50);
  },

  async doAdminLogin() {
    const username = document.getElementById('adm_user')?.value.trim();
    const password = document.getElementById('adm_pass')?.value;
    if (!username || !password) { this.toast('กรุณากรอกให้ครบ', 'error'); return; }
    const btn = document.getElementById('adminLoginBtn');
    if (btn) { btn.textContent = '⌛ กำลังตรวจสอบ...'; btn.disabled = true; }
    try {
      if (!FB.db) FB.init();
      const user = await FB.loginAdmin(username, password);
      // อ่านสิทธิ์สดจาก users/{uid} (ข้าม cache) — เพิ่งเปลี่ยน role ต้องเห็นผลทันที
      const r = await Role.resolve(user, FB.db, true);
      if (!r || (r.role !== 'admin' && r.role !== 'staff')) {
        await FB.logoutAdmin().catch(() => {});
        Role.clear();
        if (btn) { btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false; }
        this.toast('บัญชีนี้ยังไม่ได้รับสิทธิ์ หรือถูกปิดการใช้งาน — ติดต่อผู้ดูแลระบบ', 'error');
        return;
      }
      this._bootHandled  = true;
      this._adminUsername = r.displayName || r.username;
      this._role = r.role;
      this._team = r.supervisorName || '';
      this.closeModal();
      this._enterApp();
    } catch (e) {
      if (btn) { btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false; }
      this.toast('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
    }
  },

  // ---- เข้าแอปหลังจาก login ----
  _enterApp() {
    document.querySelector('.topbar').style.display = '';
    const right = document.getElementById('topbarRight');
    if (right) {
      // ⚠️ ผู้สำรวจไม่มีลิงก์ "เมนูหลัก" — เขาเข้ามาด้วยลิงก์ที่ได้รับ ไม่มีบัญชี
      //    เผลอกดแล้วจะไปโผล่หน้า login ของระบบ แล้วกลับเข้าแบบสอบถามเองไม่ได้
      right.outerHTML = `<div id="topbarRight" class="tb-right">
        ${this._canManage() ? `<a class="tb-link" href="../index.html">◈ เมนูหลัก</a>
        <span class="tb-sep">|</span>` : ''}
        <span class="tb-user">
          ${this._isAdmin() ? '🔐' : this._isStaff() ? '🧑‍💼' : '👤'} ${this.esc(this._canManage() ? this._adminUsername : this._surveyorName)}${this._isStaff() ? ' · ผู้ควบคุม' : ''}
        </span>
        <button class="tb-logout" onclick="App.logout()">ออก</button>
      </div>`;
    }
    this.navigate('home');
    this._silentPull();
  },

  async _silentPull() {
    const THROTTLE_MS = 5 * 60 * 1000;
    const last = +localStorage.getItem('_is_hi_last_auto_pull') || 0;
    if (Date.now() - last < THROTTLE_MS) return;
    try {
      if (typeof firebase === 'undefined') return;
      if (!FB.db) FB.init();
      if (!FB.db) return;
      const count = await this._pullScoped();
      localStorage.setItem('_is_hi_last_auto_pull', String(Date.now()));
      this.toast(`☁️ โหลดข้อมูลแล้ว ${count} ครัวเรือน`, 'success');
      this.render();
    } catch { /* silent */ }
  },

  // escape free text ก่อนใส่ใน innerHTML — กันชื่อ/สถานที่ที่มี < > " ' & ทำ layout เพี้ยน
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  },

  _relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '';
    const sec = Math.floor(diff / 1000);
    if (sec < 30)  return 'เมื่อกี้นี้';
    if (sec < 60)  return `${sec} วินาทีที่แล้ว`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min} นาทีที่แล้ว`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr} ชม.ที่แล้ว`;
    const day = Math.floor(hr / 24);
    if (day < 7)   return `${day} วันที่แล้ว`;
    return new Date(iso).toLocaleDateString('th-TH');
  },

  _syncBadge() {
    const last = typeof FB !== 'undefined' ? FB.lastSync() : null;
    if (!last) return `<span class="sync-badge sync-badge-none">⚠ ยังไม่เคย sync</span>`;
    return `<span class="sync-badge" title="${new Date(last).toLocaleString('th-TH')}">
              ☁️ sync ล่าสุด: ${this._relativeTime(last)}
            </span>`;
  },

  // เรียก push อัตโนมัติแบบปลอดภัย — ไม่ล้มการบันทึก local ถ้า FB ยังไม่พร้อม
  _autoPush(fn) {
    try { if (typeof FB !== 'undefined' && FB.db) fn(); }
    catch (e) { console.warn('[autosync]', e); }
  },
  // อัปเดต badge sync ล่าสุดในที่ (เรียกจาก FB._pushDoc เมื่อ server ack) — ไม่ re-render ทั้งหน้า
  _refreshSyncBadge() {
    const el = document.querySelector('.sync-badge');
    if (el) el.outerHTML = this._syncBadge();
  },

  // ---- ออกจากระบบ ----
  logout() {
    if (!confirm('ออกจากระบบ?')) return;
    if (this._canManage()) FB.logoutAdmin().catch(() => {});
    Role.clear();
    this._role = null;
    this._surveyorName = '';
    this._adminUsername = '';
    this._team = '';
    this._bootHandled = false;
    // คืน topbar right เป็นลิงก์เมนูหลัก
    const right = document.getElementById('topbarRight');
    if (right) right.outerHTML = `<a class="tb-link" id="topbarRight" href="../index.html">◈ เมนูหลัก</a>`;
    this._showLoginGate();
  },

  navigate(page, hhId, memberId) {
    this.page = page;
    if (hhId !== undefined) this.hhId = hhId;
    if (memberId !== undefined) this.memberId = memberId;
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goBack() {
    if (this.page === 'member') { this.navigate('household'); return; }
    this.navigate('home');
  },

  // บันทึกบ้านปัจจุบัน (บันทึกอัตโนมัติอยู่แล้ว) แล้วเปิดฟอร์มเพิ่มบ้านหลังถัดไป
  saveAndNextHousehold() {
    const hh = DB.getHousehold(this.hhId);
    const complete = hh && hh.members.some(m => m.trips.length > 0);
    this.toast(complete ? 'บันทึกบ้านแล้ว — เพิ่มบ้านหลังถัดไป' : 'บันทึกบ้านแล้ว (ยังไม่มีคนเดินทาง จะขึ้นสีแดง) — เพิ่มบ้านหลังถัดไป', complete ? 'success' : 'error');
    this.navigate('home');
    setTimeout(() => this.openAddHousehold(), 150);
  },

  render() {
    const app = document.getElementById('app');
    const back = document.getElementById('backBtn');
    const bc   = document.getElementById('breadcrumb');
    back.style.display = this.page === 'home' ? 'none' : 'block';

    if (this.page === 'home') {
      bc.className = 'breadcrumb';
      app.innerHTML = this.pageHome();
    } else if (this.page === 'household') {
      const hh = DB.getHousehold(this.hhId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ${hh ? (hh.houseNo ? 'บ้านเลขที่ ' + this.esc(hh.houseNo) : hh.id) : ''}`;
      app.innerHTML = this.pageHousehold();
    } else if (this.page === 'member') {
      const hh = DB.getHousehold(this.hhId);
      const m  = DB.getMember(this.hhId, this.memberId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span>
        <a onclick="App.navigate('household','${this.hhId}')">${hh ? (hh.houseNo ? 'บ้านเลขที่ ' + this.esc(hh.houseNo) : hh.id) : ''}</a>
        <span>›</span> สมาชิกที่ ${m ? m.seq : ''}`;
      app.innerHTML = this.pageMember();
    } else if (this.page === 'trash') {
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ถังขยะ`;
      app.innerHTML = this.pageTrash();
    }
  },

  // ===================== PAGE: ถังขยะ (admin) =====================
  pageTrash() {
    if (!this._isAdmin()) return `<div class="section"><p>เฉพาะผู้ดูแลระบบ</p></div>`;
    const items = DB.getTrash();
    return `
      <div class="section">
        <div class="sec-head">
          <div>
            <div class="sec-title">🗑 ถังขยะ</div>
            <div class="sec-sub">${items.length} รายการที่ลบออกจากระบบ · กู้คืนได้ทุกเมื่อ</div>
          </div>
        </div>
        ${items.length === 0
          ? `<div class="empty"><div class="empty-icon">✨</div><p>ถังขยะว่าง</p></div>`
          : items.map(it => `
            <div class="hh-card" style="border-left:3px solid var(--danger)">
              <div class="hh-card-main">
                <div class="hh-detail-id">${this.esc(it.label)}</div>
                <div class="hh-card-sub">${this.esc(it.sub)}</div>
                <div class="hh-card-sub" style="font-size:12px;color:var(--gray-500)">
                  ลบเมื่อ ${it.at ? new Date(it.at).toLocaleString('th-TH') : '—'}${it.by ? ' · โดย ' + this.esc(it.by) : ''}
                </div>
              </div>
              <button class="btn btn-primary btn-sm"
                onclick="App.restoreItem('${it.kind}','${it.hhId}','${it.mId || ''}','${it.tId || ''}')">↩ กู้คืน</button>
            </div>`).join('')}
      </div>`;
  },

  restoreItem(kind, hhId, mId, tId) {
    let entity = null;
    if (kind === 'household')   entity = DB.restoreHousehold(hhId);
    else if (kind === 'member') entity = DB.restoreMember(hhId, mId);
    else if (kind === 'trip')   entity = DB.restoreTrip(hhId, mId, tId);
    if (!entity) { this.toast('ไม่พบรายการ', 'error'); return; }
    // ส่ง flag กู้คืนขึ้น cloud ทันที
    if (kind === 'household')   this._autoPush(() => FB.pushHousehold(entity));
    else if (kind === 'member') this._autoPush(() => FB.pushMember(hhId, entity));
    else                        this._autoPush(() => FB.pushTrip(hhId, mId, entity));
    this.toast('กู้คืนแล้ว', 'success');
    this.render();
  },




  // ===================== PAGE: HOME =====================
  pageHome() {
    const isAdmin = this._isAdmin();
    const allHhs  = DB.getHouseholds();
    const hhs     = this._visibleHouseholds(allHhs);
    const members = hhs.reduce((s, h) => s + h.members.length, 0);
    const trips   = hhs.reduce((s, h) => h.members.reduce((s2, m) => s2 + m.trips.length, s), 0);
    // ── ตัวกรอง: สถานะ (สมบูรณ์/ไม่สมบูรณ์) + ชื่อผู้สำรวจ + พิกัดไม่ครบ ──
    const status = this._filterStatus || 'all';
    const nameQ  = (this._filterName || '').trim().toLowerCase();
    const noCoordList = hhs.filter(h => this._hhCoordsIncomplete(h));
    let list = hhs;
    // สมบูรณ์ = ไม่มีประเด็นเลย · ไม่สมบูรณ์ = มีประเด็นใดๆ (ไม่มีคนเดินทาง / พิกัดไม่ครบ / พิกัดจากแผนที่)
    if (status === 'complete')        list = list.filter(h => !this._hhHasIssue(h));
    else if (status === 'incomplete') list = list.filter(h => this._hhHasIssue(h));
    if (this._filterNoCoords)         list = list.filter(h => this._hhCoordsIncomplete(h));
    if (nameQ)                        list = list.filter(h => (h.surveyorName || '').toLowerCase().includes(nameQ));
    // ใหม่สุดอยู่บน
    list = list.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return `<div class="page container">
      <div class="dash-hero">
        <div class="dash-hero-text">
          <h1>แบบสำรวจการเดินทาง</h1>
          <p>โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</p>
        </div>
        <div class="dash-stats">
          <div class="dash-stat"><div class="dash-stat-val">${hhs.length}</div><div class="dash-stat-lbl">ครัวเรือน</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${members}</div><div class="dash-stat-lbl">สมาชิก</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${trips}</div><div class="dash-stat-lbl">การเดินทาง</div></div>
        </div>
      </div>


      <div class="sec-header">
        <div>
          <div class="sec-title">รายการครัวเรือน</div>
          <div class="sec-sub">พบ ${hhs.length} ครัวเรือน${isAdmin ? '' : this._isStaff() ? ` (ทีม ${this.esc(this._team)})` : ' (ของคุณ)'} · ${this._syncBadge()}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${this._canManage() && hhs.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="App.exportData()">⬇ Export Excel</button>` : ''}
          ${isAdmin ? (() => { const n = DB.getTrash().length;
            return `<button class="btn btn-ghost btn-sm" onclick="App.navigate('trash')">🗑 ถังขยะ${n ? ` (${n})` : ''}</button>`; })() : ''}
          ${hhs.length > 0 ? `<button class="btn btn-ghost btn-sm" id="syncBtn" onclick="App.syncToCloud()">☁️ Sync</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูล</button>
          ${hhs.length > 0 ? `<button class="btn btn-danger btn-sm" onclick="App.confirmClearAll()">🗑 ล้าง cache</button>` : ''}
          <button class="btn btn-primary" onclick="App.openAddHousehold()">+ เพิ่มครัวเรือน</button>
        </div>
      </div>

      ${hhs.length > 0 ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
        <div style="display:inline-flex;gap:2px;background:var(--gray-100);padding:3px;border-radius:8px;flex-shrink:0;">
          ${this._segBtn('ทั้งหมด','all')}${this._segBtn('✅ สมบูรณ์','complete')}${this._segBtn('⚠️ ไม่สมบูรณ์','incomplete')}
        </div>
        <input id="flt_name" value="${this.esc(this._filterName || '')}" oninput="App.setNameFilter(this.value)"
          placeholder="🔍 ค้นหาชื่อผู้สำรวจ" autocomplete="off"
          style="flex:1;min-width:150px;padding:8px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-family:inherit;font-size:14px;background:var(--white);color:var(--gray-800);" />
        ${noCoordList.length > 0 ? `<button class="btn btn-sm ${this._filterNoCoords ? 'btn-danger' : 'btn-ghost'}" onclick="App.toggleNoCoords()">📍 พิกัดไม่ครบ ${noCoordList.length}</button>` : ''}
      </div>` : ''}

      ${hhs.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🏘️</span>
          <h3>ยังไม่มีครัวเรือน</h3>
          <p>กดปุ่มด้านบนเพื่อเริ่มบันทึกข้อมูล หรือดึงข้อมูลจาก Firebase</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="App.openAddHousehold()">+ เพิ่มครัวเรือนแรก</button>
            <button class="btn btn-ghost" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูลจาก Firebase</button>
          </div>
        </div>` :
        (list.length === 0 ? `
        <div class="empty"><span class="empty-icon">🔍</span><h3>ไม่พบครัวเรือนตามตัวกรอง</h3>
          <p>ลองปรับตัวกรอง หรือล้างตัวกรอง</p>
          <button class="btn btn-ghost" onclick="App.resetFilters()">ล้างตัวกรอง</button></div>` :
        `<div class="hh-list">${list.map(hh => {
          const t    = hh.members.reduce((s, m) => s + m.trips.length, 0);
          const totM = Object.values(hh.memberGrid || {}).reduce((s, v) => s + (+v || 0), 0);
          const addr = [hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '', hh.moo ? 'ม.' + hh.moo : '', hh.road].filter(Boolean).join(' ');
          // แยกประเด็นให้ชัด: ไม่มีคนเดินทาง / บ้านไม่มีพิกัด / เที่ยวไม่มีพิกัด / พิกัดจากแผนที่ (มีพิกัดแต่ควรตรวจ)
          const noTraveler = !this._hhComplete(hh);
          const homeNoCo   = !hh.coordinates;
          const tripNoCo   = !homeNoCo && (hh.members || []).some(m => (m.trips || []).some(t => !t.originCoords || !t.destinationCoords));
          const mapCo      = this._hhMapCoords(hh);
          return `<div class="hh-card${noTraveler ? ' hh-card-incomplete' : ''}" onclick="App.navigate('household','${hh.id}')">
            <div class="hh-card-icon">🏠</div>
            <div class="hh-card-body">
              <div class="hh-card-id">${this.esc(addr) || 'ไม่ระบุที่อยู่'}</div>
              <div class="hh-card-addr">${hh.surveyorName ? 'ผู้สำรวจ: ' + this.esc(hh.surveyorName) : ''}</div>
              <div class="hh-card-tags">
                ${noTraveler ? '<span class="tag" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;">⚠️ ยังไม่สมบูรณ์</span>' : ''}
                ${homeNoCo ? '<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;">📍 บ้านไม่มีพิกัด</span>' : ''}
                ${tripNoCo ? '<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;">📍 เที่ยวไม่มีพิกัด</span>' : ''}
                ${mapCo ? '<span class="tag" style="background:#ffedd5;color:#9a3412;border:1px solid #fdba74;" title="พิกัดจากแผนที่/พิมพ์เอง ไม่ใช่ GPS ที่จุดจริง — ควรสุ่มตรวจ">🗺 พิกัดจากแผนที่</span>' : ''}
                <span class="tag tag-blue">👥 ${totM} คน</span>
                <span class="tag tag-green">🚗 ${t} เที่ยว</span>
                <span class="tag tag-gray">📅 ${hh.surveyDate}</span>
                ${hh.residentialType ? `<span class="tag tag-gray">${hh.residentialType}</span>` : ''}
              </div>
            </div>
            <div class="hh-card-arrow">›</div>
          </div>`;
        }).join('')}</div>`)}
    </div>`;
  },

  // household พิกัดไม่ครบ = บ้านไม่มีพิกัด หรือมีเที่ยวที่ต้นทาง/ปลายทางไม่มีพิกัด
  // (ที่ทำงาน/โรงเรียนไม่นับ)
  _hhCoordsIncomplete(hh) {
    if (!hh.coordinates) return true;
    return (hh.members || []).some(m =>
      (m.trips || []).some(t => !t.originCoords || !t.destinationCoords));
  },

  // เที่ยวนี้พิกัดไม่ครบ (ต้นทางหรือปลายทางขาด) — ใช้ไฮไลต์การ์ดเที่ยวสีแดง
  _tripNoCoords(t) { return !t.originCoords || !t.destinationCoords; },

  // สมาชิกคนนี้มีเที่ยวที่พิกัดไม่ครบ — ใช้ไฮไลต์การ์ดสมาชิกสีแดง
  _memberNoCoords(m) { return (m.trips || []).some(t => this._tripNoCoords(t)); },

  toggleNoCoords() {
    this._filterNoCoords = !this._filterNoCoords;
    this.render();
  },

  // บ้านสมบูรณ์ = มีสมาชิกที่มีข้อมูลการเดินทางอย่างน้อย 1 คน
  _hhComplete(hh) { return (hh.members || []).some(m => (m.trips || []).length > 0); },

  // มีพิกัดแต่มาจากแผนที่/พิมพ์เอง (ไม่ใช่ GPS จุดจริง) — ควรตรวจ
  _hhMapCoords(hh) { return hh.coordsSource === 'manual' && !!hh.coordinates; },

  // มีประเด็นต้องดู = ไม่มีคนเดินทาง หรือ พิกัดไม่ครบ หรือ พิกัดจากแผนที่
  _hhHasIssue(hh) {
    return !this._hhComplete(hh) || this._hhCoordsIncomplete(hh) || this._hhMapCoords(hh);
  },

  // ปุ่มสถานะแบบ segmented
  _segBtn(label, val) {
    const on = (this._filterStatus || 'all') === val;
    return `<button onclick="App.setStatus('${val}')" style="border:none;padding:6px 12px;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;${on ? 'background:var(--primary);color:#fff;' : 'background:transparent;color:var(--gray-600);'}">${label}</button>`;
  },

  setStatus(v) { this._filterStatus = v; this.render(); },

  setNameFilter(v) {
    this._filterName = v;
    this.render();
    const el = document.getElementById('flt_name');
    if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
  },

  resetFilters() {
    this._filterStatus = 'all'; this._filterName = ''; this._filterNoCoords = false;
    this.render();
  },

  // ===================== PAGE: HOUSEHOLD =====================
  pageHousehold() {
    const hh = DB.getHouseholdView(this.hhId);   // view: ไม่รวมสมาชิก/เที่ยวที่ลบออกจากระบบแล้ว
    if (!hh) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';

    const addr = [
      hh.houseNo  ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh.moo      ? 'หมู่ที่ '    + hh.moo      : '',
      hh.alley    ? 'ซอย '        + hh.alley    : '',
      hh.road     ? 'ถ.'          + hh.road     : ''
    ].filter(Boolean).join(' ');

    const totalM        = Object.values(hh.memberGrid || {}).reduce((s, v) => s + (+v || 0), 0);
    // คำนวณอัตโนมัติ: สมาชิกที่มีข้อมูลส่วนที่ 2 และ 3 ครบ
    const surveyableCnt = hh.members.filter(m => m.gender && m.trips.length > 0).length;

    // vehicle summary
    let vehicleSummary = '';
    if (hh.hasVehicle === 'มี' && hh.vehicles) {
      const lines = OPT.vehicleTypes
        .filter(vt => { const v = hh.vehicles[vt.key]; return v && (+v.private||0) + (+v.company||0) + (+v.gov||0) > 0; })
        .map(vt => {
          const v = hh.vehicles[vt.key];
          const total = (+v.private||0) + (+v.company||0) + (+v.gov||0);
          return `<span class="tag tag-gray">${vt.icon} ${vt.label}: ${total} คัน</span>`;
        });
      vehicleSummary = lines.join('');
    }

    return `<div class="page container">
      <div class="hh-detail-header">
        <div class="hh-detail-icon">🏠</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">${this.esc(addr) || 'ไม่ระบุที่อยู่'}</div>
          <div class="hh-detail-addr">${hh.residentialType || ''}</div>
          <div class="hh-detail-tags">
            ${hh.travelDate    ? `<span class="tag tag-blue">🗓 เดินทาง ${hh.travelDate}</span>` : ''}
            <span class="tag tag-gray">📋 บันทึก ${hh.surveyDate}</span>
            ${hh.surveyorName  ? `<span class="tag tag-gray">🧑‍💼 ${this.esc(hh.surveyorName)}</span>`  : ''}
            ${hh.supervisorName? `<span class="tag tag-gray">👔 ${this.esc(hh.supervisorName)}</span>`  : ''}
            ${hh.coordinates   ? `<span class="tag tag-blue">📍 ${hh.coordinates}</span>`     : ''}
            ${hh.coordsSource === 'manual' ? `<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;" title="พิกัดมาจากแผนที่/พิมพ์เอง ไม่ใช่ GPS ที่จุดจริง — ควรสุ่มตรวจ">⚠️ พิกัดจากแผนที่</span>` : ''}
            ${hh.deviceId      ? `<span class="tag tag-gray" title="Device ID: ${hh.deviceId}">💻 ${hh.deviceId.slice(0,8)}…</span>` : ''}
            ${hh.clientIp      ? `<span class="tag tag-gray">🌐 ${hh.clientIp}</span>`          : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openEditHousehold('${hh.id}')">✏️ แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteHousehold('${hh.id}')">ลบ</button>
        </div>
      </div>

      ${totalM > 0 ? `<div class="card-box" style="margin-bottom:20px;">
        <div class="card-box-title">📊 ส่วนที่ 1 — สรุปข้อมูลครัวเรือน</div>
        <div class="member-grid-summary">
          ${OPT.memberGridRows.map(row => {
            const val = +(hh.memberGrid[row.key] || 0);
            const [gender, status] = row.label.split(' — ');
            return `<div class="mg-cell">
              <span style="font-size:20px;line-height:1;">${row.icon}</span>
              <span class="mg-cell-label">${status}</span>
              <span class="mg-cell-val ${val === 0 ? 'zero' : ''}">${val}</span>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--gray-500);">
          <span>👥 รวม ${totalM} คน · รวบรวมข้อมูลได้ ${surveyableCnt} คน</span>
          ${hh.householdIncome ? `<span>💰 ${hh.householdIncome}</span>` : ''}
          ${hh.hasVehicle      ? `<span>🚗 ยานพาหนะ: ${hh.hasVehicle}</span>` : ''}
        </div>
        ${vehicleSummary ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${vehicleSummary}</div>` : ''}
      </div>` : ''}

      <div class="sec-header">
        <div>
          <div class="sec-title">สมาชิก (ส่วนที่ 2 & 3)</div>
          <div class="sec-sub">กดที่สมาชิกเพื่อกรอกข้อมูล</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="App.addMember()" style="white-space:nowrap;">+ เพิ่มสมาชิก</button>
      </div>

      ${hh.members.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">👤</span>
          <h3>ยังไม่มีสมาชิก</h3>
          <p>เพิ่มสมาชิกแต่ละคนเพื่อบันทึกข้อมูลส่วนที่ 2 และ 3</p>
          <button class="btn btn-primary" onclick="App.addMember()">+ เพิ่มสมาชิก</button>
        </div>` :
        `<div class="member-list">${hh.members.map(m => {
          const avCls  = m.gender === 'ชาย' ? 'av-m' : m.gender === 'หญิง' ? 'av-f' : 'av-o';
          const avIcon = m.gender === 'ชาย' ? '👨'   : m.gender === 'หญิง' ? '👩'   : '👤';
          const hasInfo = m.gender && m.occupation;
          const dotCls  = hasInfo && m.trips.length > 0 ? 'dot-green' : (hasInfo || m.trips.length > 0) ? 'dot-amber' : 'dot-gray';
          // มีเที่ยวที่พิกัดไม่ครบ → ไฮไลต์แดง ให้รู้ว่าต้องเข้าไปแก้คนไหน
          const noCo    = this._memberNoCoords(m);
          const badCnt  = (m.trips || []).filter(t => this._tripNoCoords(t)).length;
          return `<div class="member-card" onclick="App.navigate('member','${hh.id}','${m.id}')"
            ${noCo ? 'style="background:#fef2f2;border-color:var(--danger);"' : ''}>
            <div class="member-avatar ${avCls}">${avIcon}</div>
            <div class="member-info">
              <div class="member-name">สมาชิกที่ ${m.seq}${m.gender ? ' · ' + m.gender : ''}${m.age ? ' · ' + m.age + ' ปี' : ''}</div>
              <div class="member-detail">${[m.homeStatus, m.occupation].filter(Boolean).join(' · ') || 'ยังไม่กรอกข้อมูล'}</div>
              ${noCo ? `<div class="member-detail" style="color:var(--danger);font-weight:600;">📍 ${badCnt} เที่ยวไม่มีพิกัด</div>` : ''}
            </div>
            <div class="member-right">
              <span class="tag ${m.trips.length > 0 ? 'tag-green' : 'tag-gray'}">🚗 ${m.trips.length} เที่ยว</span>
              <div class="status-dot ${noCo ? 'dot-red' : dotCls}"></div>
              <span style="color:var(--gray-300)">›</span>
            </div>
          </div>`;
        }).join('')}</div>`}

      <div style="margin-top:24px;display:flex;justify-content:center;">
        <button class="btn btn-primary" onclick="App.saveAndNextHousehold()" style="min-width:260px;">💾 บันทึก & เพิ่มบ้านหลังถัดไป</button>
      </div>
    </div>`;
  },

  // ===================== PAGE: MAP DASHBOARD =====================
  // ===================== PAGE: MEMBER =====================
  pageMember() {
    const hh = DB.getHousehold(this.hhId);
    const m  = DB.getMemberView(this.hhId, this.memberId);   // view: ไม่รวมเที่ยวที่ลบออกจากระบบแล้ว
    if (!m || m._deleted) return '<div class="container"><p>ไม่พบข้อมูล (ถูกลบออกจากระบบแล้ว)</p></div>';
    const infoDone = this._memberInfoComplete(m);
    // ยังกรอกข้อมูลบุคคลไม่ครบ → บังคับอยู่แท็บข้อมูลบุคคล (กันข้ามไปกรอกการเดินทาง)
    const tab = (this.memberTab === 'trips' && !infoDone) ? 'info' : this.memberTab;
    const avCls  = m.gender === 'ชาย' ? 'av-m' : m.gender === 'หญิง' ? 'av-f' : 'av-o';
    const avIcon = m.gender === 'ชาย' ? '👨'   : m.gender === 'หญิง' ? '👩'   : '👤';
    return `<div class="page container">
      <div class="hh-detail-header" style="margin-bottom:20px;">
        <div class="member-avatar ${avCls}" style="width:50px;height:50px;font-size:22px;border-radius:50%;flex-shrink:0;">${avIcon}</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">สมาชิกที่ ${m.seq} — ${hh ? hh.areaCode || hh.id : ''}</div>
          <div class="hh-detail-addr">${[m.gender, m.age ? 'อายุ ' + m.age + ' ปี' : '', m.homeStatus, m.occupation].filter(Boolean).join(' · ') || 'ยังไม่กรอกข้อมูล'}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteMember('${m.id}')">ลบ</button>
      </div>

      <div class="tabs">
        <button class="tab-btn ${tab === 'info'  ? 'active' : ''}" onclick="App.switchTab('info')">👤 ส่วนที่ 2 — ข้อมูลบุคคล</button>
        <button class="tab-btn ${tab === 'trips' ? 'active' : ''} ${infoDone ? '' : 'tab-locked'}" onclick="App.switchTab('trips')">
          ${infoDone ? '🚗' : '🔒'} ส่วนที่ 3 — การเดินทาง
          ${m.trips.length > 0 ? `<span style="background:var(--primary);color:#fff;font-size:11px;padding:1px 7px;border-radius:999px;margin-left:4px;">${m.trips.length}</span>` : ''}
        </button>
      </div>
      ${tab === 'info' ? this.tabPersonalInfo(m) : this.tabTrips(m, hh)}
    </div>`;
  },

  // ข้อมูลบุคคล (ส่วนที่ 2) ครบหรือยัง — ต้องมี เพศ + สถานะการทำงาน (เงื่อนไขเดียวกับ savePersonalInfo)
  _memberInfoComplete(m) {
    const mem = m || DB.getMember(this.hhId, this.memberId);
    return !!(mem && mem.gender && mem.workStatus);
  },

  switchTab(tab) {
    if (tab === 'trips' && !this._memberInfoComplete()) {
      this.toast('กรอกข้อมูลบุคคล (ส่วนที่ 2) ให้ครบและกดบันทึกก่อน', 'error');
      return;
    }
    this.memberTab = tab;
    this.render();
  },

  // ===================== TAB: PERSONAL INFO =====================
  tabPersonalInfo(m) {
    const sel = (list, val, id) =>
      `<select id="${id}" class="form-select" autocomplete="off">
        <option value="">— เลือก —</option>
        ${list.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
      </select>`;
    // ไม่ทำงาน/ว่างงาน → อาชีพ = อยู่บ้านเฉย ๆ (auto) + ซ่อนสถานที่ทำงาน
    const nw = this._isNotWorking(m.workStatus);
    const occVal = nw ? 'อยู่บ้านเฉย ๆ' : (m.occupation || '');

    return `<div class="card-box">
      <div class="card-box-title">👤 ข้อมูลบุคคล (ส่วนที่ 2)</div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">เพศ</label>
          <div class="radio-group">
            ${['ชาย','หญิง'].map(g => `
              <div class="radio-opt ${m.gender === g ? 'sel' : ''}" onclick="App.selectGender('${g}',this)">
                <div class="radio-dot"></div>${g}
              </div>`).join('')}
          </div>
          <input type="hidden" id="f_gender" value="${m.gender}" />
        </div>
        <div class="form-row">
          <label class="form-label">อายุ (ปี)</label>
          <input id="f_age" class="form-input" type="number" min="0" max="120" inputmode="numeric" autocomplete="off" value="${m.age || ''}" />
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">สถานะในบ้าน</label>
          ${sel(OPT.homeStatus, m.homeStatus, 'f_homeStatus')}
        </div>
        <div class="form-row">
          <label class="form-label req">สถานะการทำงาน / เรียน</label>
          <select id="f_workStatus" class="form-select" autocomplete="off" onchange="App._onWorkStatusChange(this.value)">
            <option value="">— เลือก —</option>
            ${OPT.workStatus.map(o => `<option value="${o}" ${o === m.workStatus ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">อาชีพ</label>
          <select id="f_occupation" class="form-select" autocomplete="off" ${nw ? 'disabled' : ''}>
            <option value="">— เลือก —</option>
            ${OPT.occupation.map(o => `<option value="${o}" ${o === occVal ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">ระดับการศึกษา</label>
          ${sel(OPT.education, m.education, 'f_education')}
        </div>
      </div>

      <div class="form-row">
        <label class="form-label req">รายได้บุคคล (บาท/เดือน)</label>
        <div style="display:flex;align-items:center;gap:10px;">
          <input id="f_income" class="form-input" type="number" min="0" inputmode="numeric"
            autocomplete="off" placeholder="เช่น 15000" style="flex:1;"
            value="${m.income === 'ไม่ระบุ' ? '' : (m.income || '')}"
            ${m.income === 'ไม่ระบุ' ? 'disabled' : ''} />
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;cursor:pointer;flex-shrink:0;">
            <input type="checkbox" id="f_income_ns" style="accent-color:var(--primary);width:16px;height:16px;"
              ${m.income === 'ไม่ระบุ' ? 'checked' : ''}
              onchange="const inp=document.getElementById('f_income');inp.disabled=this.checked;if(this.checked)inp.value='';" />
            ไม่ระบุ
          </label>
        </div>
      </div>

      <div id="wpSection" style="display:${nw ? 'none' : 'block'};">
        <hr class="divider" />
        <div class="section-label">ชื่อ / สถานที่ทำงาน หรือ สถานศึกษา</div>
        <div class="form-row">
          <label class="form-label">ชื่อสถานที่ทำงาน / สถานศึกษา</label>
          <div style="display:flex;gap:8px;">
            <input id="f_wpName" class="form-input" autocomplete="off" value="${m.workplaceName || ''}"
              placeholder="ค้นหา / ปักหมุดจากแผนที่" style="flex:1;min-width:0;" />
            <button type="button" onclick="App._openMap('f_wpCoords','f_wpName')"
              style="padding:9px 12px;background:var(--primary-light);color:var(--primary);
                     border:1.5px solid var(--primary);border-radius:var(--radius-sm);
                     font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
          </div>
          <input type="hidden" id="f_wpCoords" value="${m.workplaceCoords || ''}" />
          ${m.workplaceCoords ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;" data-coordshint="f_wpCoords">📍 ${m.workplaceCoords}</div>` : ''}
        </div>
      </div>

      <hr class="divider" />
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" onclick="App.savePersonalInfo()">บันทึก → ไปส่วนที่ 3</button>
      </div>
    </div>`;
  },

  selectGender(val, el) {
    document.querySelectorAll('#f_genderGroup .radio-opt, .card-box .radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('f_gender');
    if (h) h.value = val;
  },

  // ว่างงาน / ไม่ทำงาน → ไม่มีอาชีพ/สถานที่ทำงาน
  _isNotWorking(ws) {
    return ws === 'ว่างงาน (ยังหางานทำไม่ได้)' || ws === 'ไม่ทำงาน (อยู่บ้านเฉย ๆ)';
  },
  _onWorkStatusChange(val) {
    const nw  = this._isNotWorking(val);
    const occ = document.getElementById('f_occupation');
    const wp  = document.getElementById('wpSection');
    if (occ) {
      if (nw) { occ.value = 'อยู่บ้านเฉย ๆ'; occ.disabled = true; }
      else    { occ.disabled = false; }
    }
    if (wp) wp.style.display = nw ? 'none' : 'block';
  },

  savePersonalInfo() {
    const gender    = document.getElementById('f_gender')?.value    || '';
    const workStatus= document.getElementById('f_workStatus')?.value|| '';
    const notSpec   = document.getElementById('f_income_ns')?.checked;
    const incomeRaw = document.getElementById('f_income')?.value    || '';
    const income    = notSpec ? 'ไม่ระบุ' : incomeRaw;

    // --- validate required ---
    if (!gender) { this.toast('กรุณาเลือกเพศ', 'error'); return; }

    // --- gender quota check ---
    const hh   = DB.getHousehold(this.hhId);
    const grid = hh?.memberGrid || {};
    const otherMembers = (hh?.members || []).filter(m => m.id !== this.memberId);
    // เด็กอายุต่ำกว่า 6 ปี (m_child/f_child) ไม่นับเป็นผู้ถูกสัมภาษณ์ → ไม่รวมในเพดาน
    const maleKeys   = ['m_study','m_work','m_notw'];
    const femaleKeys = ['f_study','f_work','f_notw'];
    const maleCap    = maleKeys.reduce((s, k)   => s + (+(grid[k]||0)), 0);
    const femaleCap  = femaleKeys.reduce((s, k) => s + (+(grid[k]||0)), 0);
    const maleUsed   = otherMembers.filter(m => m.gender === 'ชาย').length;
    const femaleUsed = otherMembers.filter(m => m.gender === 'หญิง').length;
    if (gender === 'ชาย'  && maleUsed   >= maleCap)   { this.toast(`ครัวเรือนนี้มีเพศชายครบ ${maleCap} คนแล้ว`,   'error'); return; }
    if (gender === 'หญิง' && femaleUsed >= femaleCap) { this.toast(`ครัวเรือนนี้มีเพศหญิงครบ ${femaleCap} คนแล้ว`, 'error'); return; }

    if (!workStatus) { this.toast('กรุณาเลือกสถานะการทำงาน', 'error'); return; }
    if (!notSpec && !incomeRaw) { this.toast('กรุณากรอกรายได้ หรือเลือก "ไม่ระบุ"', 'error'); return; }

    const savedMember = DB.updateMember(this.hhId, this.memberId, {
      gender,
      age:                  +(document.getElementById('f_age')?.value) || '',
      homeStatus:           document.getElementById('f_homeStatus')?.value || '',
      workStatus,
      occupation:           document.getElementById('f_occupation')?.value || '',
      education:            document.getElementById('f_education')?.value || '',
      income,
      workplaceName:        document.getElementById('f_wpName')?.value.trim()   || '',
      workplaceCoords:      document.getElementById('f_wpCoords')?.value.trim()  || ''
    });
    this._autoPush(() => FB.pushMember(this.hhId, savedMember));

    // --- auto-update household income if sum > current ---
    const updatedHH  = DB.getHousehold(this.hhId);
    const memberSum  = (updatedHH?.members || []).reduce((s, m) => {
      const n = +m.income;
      return (!m.income || m.income === 'ไม่ระบุ' || isNaN(n)) ? s : s + n;
    }, 0);
    if (memberSum > 0 && memberSum > (+(updatedHH?.householdIncome) || 0)) {
      const savedHH = DB.updateHousehold(this.hhId, { householdIncome: memberSum });
      this._autoPush(() => FB.pushHousehold(savedHH));  // บันทึกนี้แตะ 2 doc (member + household)
      this.toast(`บันทึกแล้ว — อัพเดทรายได้ครัวเรือนเป็น ${memberSum.toLocaleString()} บาท`, 'success');
    } else {
      this.toast('บันทึกข้อมูลบุคคลแล้ว', 'success');
    }
    // ไปหน้าการเดินทางต่อเลย + เปิดฟอร์มการเดินทางครั้งแรกให้อัตโนมัติ
    this.memberTab = 'trips';
    this.render();
    const mem = DB.getMember(this.hhId, this.memberId);
    if (mem && mem.trips.length === 0) this.openTripForm(null);
  },

  // ===================== TAB: TRIPS =====================
  tabTrips(m, hh) {
    const travelLabel = hh?.travelDate ? `วันที่ ${hh.travelDate}` : 'วันที่เดินทาง';
    return `<div>
      <div class="sec-header">
        <div>
          <div class="sec-title">การเดินทาง ${travelLabel} (ส่วนที่ 3)</div>
          <div class="sec-sub">ต้องมีอย่างน้อย 2 ครั้ง · ครั้งสุดท้ายต้องเป็น "กลับบ้าน"</div>
        </div>
        <button class="btn btn-primary" onclick="App.openTripForm(null)">+ เพิ่มการเดินทาง</button>
      </div>

      ${m.trips.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🗺️</span>
          <h3>ยังไม่มีข้อมูลการเดินทาง</h3>
          <p>บันทึกการเดินทางทุกครั้งของเมื่อวาน</p>
          <button class="btn btn-primary" onclick="App.openTripForm(null)">+ เพิ่มการเดินทาง</button>
        </div>` :
        `<div class="trip-list">
          ${m.trips.map(t => {
            const segs = (t.segments || []).filter(s => s.mode);
            // พิกัดไม่ครบ → ไฮไลต์แดง + บอกว่าขาดฝั่งไหน (กดแก้ไขได้เลย)
            const noCo = this._tripNoCoords(t);
            const missing = [!t.originCoords ? 'ต้นทาง' : '', !t.destinationCoords ? 'ปลายทาง' : ''].filter(Boolean).join(' + ');
            return `<div class="trip-card"${noCo ? ' style="background:#fef2f2;border-color:var(--danger);"' : ''}>
              <div class="trip-seq"${noCo ? ' style="background:var(--danger);color:#fff;"' : ''}>${t.seq}</div>
              <div class="trip-body">
                <div class="trip-route">
                  <span class="trip-origin">${this.esc(t.origin) || '?'}</span>
                  <span class="trip-arrow">→</span>
                  <span class="trip-dest">${this.esc(t.destination) || '?'}</span>
                </div>
                ${noCo ? `<div style="font-size:12px;color:var(--danger);font-weight:600;margin-top:3px;">📍 ไม่มีพิกัด${missing}</div>` : ''}
                <div class="trip-meta">
                  ${t.purpose      ? `<span>🎯 ${t.purpose}</span>` : ''}
                  ${t.departureTime? `<span>🕐 ${t.departureTime}${t.arrivalTime ? '–' + t.arrivalTime : ''}</span>` : ''}
                </div>
                ${segs.length > 0 ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                  ${segs.map((s, i) => `<span class="tag tag-blue">ช่วง${i+1}: ${s.mode}${s.duration ? ' ' + s.duration + 'นาที' : ''}${s.fare ? ' ฿' + s.fare : ''}</span>`).join('')}
                </div>` : ''}
                ${(t.originCoords || t.destinationCoords) ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">
                  ${t.originCoords ? '📍 ' + t.originCoords : ''}${t.originCoords && t.destinationCoords ? ' → ' : ''}${t.destinationCoords ? '📍 ' + t.destinationCoords : ''}
                </div>` : ''}
                ${t.parkingLocation || t.parkingFee ? `<div style="font-size:12px;color:var(--gray-400);margin-top:4px;">🅿 ${[t.parkingLocation, t.parkingFee ? t.parkingFee + ' บาท' : ''].filter(Boolean).join(' · ')}</div>` : ''}
              </div>
              <div class="trip-actions">
                <button class="icon-btn" onclick="App.openTripForm('${t.id}')" title="แก้ไข">✏️</button>
                <button class="icon-btn del" onclick="App.deleteTrip('${t.id}')" title="ลบ">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" style="flex:1;" onclick="App.openTripForm(null)">+ เพิ่มการเดินทางอีก</button>
          <button class="btn btn-primary" onclick="App.completeMember()">เสร็จสิ้น ✓</button>
        </div>`}
    </div>`;
  },

  // ===================== MODAL: HOUSEHOLD =====================
  _lastFriday() {
    const d = new Date();
    const daysBack = (d.getDay() - 5 + 7) % 7; // วันศุกร์=5; ถ้าวันนี้คือศุกร์ daysBack=0
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split('T')[0];
  },

  // ===== SURVEYOR NAME MEMORY =====
  // identity ของบัญชีที่ login (ใช้ key ค่า default แยกตามคน)
  _identity() {
    return this._canManage() ? (this._adminUsername || 'admin') : (this._surveyorName || 'unknown');
  },
  _loadSurveyorNames() {
    const id = this._identity();
    return {
      surveyor:   localStorage.getItem('_is_surveyor_name') || '',
      // ชื่อผู้ควบคุม: จำแยกตามบัญชี (fallback ค่ารวมเดิมเพื่อ migrate)
      supervisor: localStorage.getItem('_is_supervisor_name__' + id)
                  || localStorage.getItem('_is_supervisor_name') || ''
    };
  },
  _saveSurveyorNames(surveyor, supervisor) {
    const id = this._identity();
    if (surveyor)   localStorage.setItem('_is_surveyor_name', surveyor);
    if (supervisor) localStorage.setItem('_is_supervisor_name__' + id, supervisor);
  },

  // ===== SHARED: HOUSEHOLD FORM HTML =====
  _hhFormHTML(hh) {
    // hh = null for add, existing object for edit
    const names      = this._loadSurveyorNames();
    // ถ้า role = surveyor ใช้ชื่อ login เป็น default ผู้สำรวจ
    const defaultSurveyor = this._role === 'surveyor' ? this._surveyorName : names.surveyor;
    const resOpts    = OPT.residentialType.map(r =>
      `<option value="${r}" ${r === hh?.residentialType ? 'selected' : ''}>${r}</option>`).join('');
    const gridCards  = OPT.memberGridRows.map(row => {
      const [gender, status] = row.label.split(' — ');
      const cur = hh?.memberGrid?.[row.key] || 0;
      return `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:24px;line-height:1;">${row.icon}</span>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.04em;">${gender}</div>
            <div style="font-size:12px;font-weight:600;color:var(--gray-700);">${status}</div>
          </div>
        </div>
        <select id="mg_${row.key}" class="form-select" autocomplete="off">
          ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === +cur ? 'selected' : ''}>${n === 0 ? '' : n + ' คน'}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    const vhRows = OPT.vehicleTypes.map(vt => {
      const v    = hh?.vehicles?.[vt.key];
      const show = v && ((+v.private||0)+(+v.company||0)+(+v.gov||0)) > 0;
      return `<tr id="vrow_${vt.key}" style="${show ? '' : 'display:none'}">
        <td style="font-size:13px;padding:5px 8px;color:var(--gray-700);">${vt.icon} ${vt.label}</td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.private||0}" class="form-input" id="vp_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.company||0}" class="form-input" id="vc_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.gov||0}"     class="form-input" id="vg_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
      </tr>`;
    }).join('');

    return `
      <div class="section-label">ข้อมูลผู้สำรวจ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ชื่อ–สกุลผู้สำรวจ</label>
          <input id="m_sname" class="form-input" autocomplete="off" placeholder="ชื่อ นามสกุล"
            value="${this._role === 'surveyor' ? this._surveyorName : (hh ? (hh.surveyorName||'') : defaultSurveyor)}"
            ${this._role === 'surveyor' ? 'readonly title="ดึงจากบัญชีที่เข้าสู่ระบบ" style="background:var(--gray-100);color:var(--gray-500);cursor:not-allowed;"' : ''} />
          ${this._role === 'surveyor' ? '<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">🔒 จากบัญชีที่เข้าสู่ระบบ</div>' : ''}
        </div>
        <div class="form-row">
          <label class="form-label req">ชื่อผู้ควบคุม</label>
          ${(() => {
            const cur = hh ? (hh.supervisorName || '') : (this._isStaff() ? this._team : names.supervisor);
            // staff = ล็อกเป็นทีมตัวเอง · คนอื่น = เลือกจากรายชื่อที่ผู้ดูแลลงทะเบียนไว้
            if (this._isStaff())
              return `<input id="m_supervisor" class="form-input" value="${this.esc(this._team)}" readonly
                        style="background:var(--gray-100);" />
                      <div style="font-size:11px;color:var(--gray-400);margin-top:3px;">🔒 จากบัญชีที่เข้าสู่ระบบ</div>`;
            const opts = Supervisors.optionsHTML(cur, s => this.esc(s));
            const empty = Supervisors.list().length === 0;
            return `<select id="m_supervisor" class="form-input">${opts}</select>
                    ${empty ? '<div style="font-size:11px;color:var(--danger);margin-top:3px;">⚠ ยังไม่มีรายชื่อผู้ควบคุมในระบบ — ติดต่อผู้ดูแล</div>' : ''}`;
          })()}
        </div>
        <div class="form-row">
          <label class="form-label req">วันที่เดินทาง</label>
          <input id="m_travelDate" class="form-input" type="date" autocomplete="off"
            value="${hh ? (hh.travelDate||this._lastFriday()) : this._lastFriday()}" />
        </div>
      </div>

      <div class="section-label">ที่อยู่</div>
      <div class="form-row">
        <label class="form-label req">พิกัด GPS</label>
        <div style="display:flex;gap:6px;">
          <input id="m_coords" class="form-input" autocomplete="off" placeholder="กด 📍 GPS ที่จุดบ้านจริง"
            style="flex:1;min-width:0;" value="${hh?.coordinates||''}"
            oninput="App._setHhCoordsSource('manual')" />
          <button type="button" id="gpsBtn_m_coords" onclick="App._useGPS('m_coords')"
            style="padding:9px 12px;background:#16a34a;color:#fff;border:1.5px solid #16a34a;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍 GPS</button>
          <button type="button" onclick="App._openHhMap()"
            style="padding:9px 10px;background:#eff6ff;color:#2563eb;border:1.5px solid #93c5fd;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 สำรอง</button>
        </div>
        <input type="hidden" id="m_coordsSource" value="${hh?.coordsSource||''}" />
        <div style="font-size:11px;color:var(--gray-400);margin-top:3px;">แนะนำกด 📍 GPS ที่จุดบ้านจริง · ใช้ 🗺 แผนที่เฉพาะเครื่องที่ไม่มี GPS</div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">บ้านเลขที่</label>
          <input id="m_houseNo" class="form-input" autocomplete="off" placeholder="เช่น 123/4" value="${hh?.houseNo||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">หมู่ที่</label>
          <input id="m_moo" class="form-input" type="number" min="1" inputmode="numeric" autocomplete="off" placeholder="เช่น 5" value="${hh?.moo||''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ตรอก / ซอย</label>
          <input id="m_alley" class="form-input" autocomplete="off" value="${hh?.alley||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">ถนน</label>
          <input id="m_road" class="form-input" autocomplete="off" value="${hh?.road||''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ตำบล</label>
          <input id="m_subdistrict" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.subdistrict||''}" />
        </div>
        <div class="form-row">
          <label class="form-label req">อำเภอ</label>
          <input id="m_district" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.district||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">จังหวัด</label>
          <input id="m_province" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.province||''}" />
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">โทรศัพท์</label>
        <input id="m_phone" class="form-input" type="tel" inputmode="numeric"
          maxlength="12" placeholder="08x-xxx-xxxx" autocomplete="off"
          oninput="App._formatPhone(this)"
          value="${App._displayPhone(hh?.phone||'')}" />
      </div>

      <div class="section-label">ประเภทที่อยู่อาศัย</div>
      <div class="form-row">
        <select id="m_restype" class="form-select" autocomplete="off">
          <option value="">— เลือกประเภท —</option>${resOpts}
        </select>
      </div>

      <div class="section-label">จำนวนผู้อยู่อาศัยในครัวเรือน</div>
      <div class="mg-input-grid">${gridCards}</div>

      <div class="section-label">รายได้และยานพาหนะ</div>
      <div class="form-row">
        <label class="form-label req">รายได้ทั้งหมดของครัวเรือน (บาท/เดือน)</label>
        <input id="m_income" class="form-input" type="number" min="0" inputmode="numeric"
          autocomplete="off" placeholder="เช่น 25000" value="${hh?.householdIncome||''}" />
      </div>
      <div class="form-row">
        <label class="form-label req">การครอบครองยานพาหนะ</label>
        <div class="radio-group" id="m_vehicleGrp">
          <div class="radio-opt ${hh?.hasVehicle==='ไม่มี'?'sel':''}" onclick="App._pickVehicle('ไม่มี',this)"><div class="radio-dot"></div>ไม่มียานพาหนะ</div>
          <div class="radio-opt ${hh?.hasVehicle==='มี'?'sel':''}" onclick="App._pickVehicle('มี',this)"><div class="radio-dot"></div>มียานพาหนะ</div>
        </div>
        <input type="hidden" id="m_vehicle" value="${hh?.hasVehicle||''}" />
      </div>
      <div id="vehicleDetail" style="display:${hh?.hasVehicle==='มี'?'block':'none'};margin-top:10px;overflow-x:auto;border:1px solid var(--gray-200);border-radius:var(--radius-sm);">
        <div style="padding:8px 12px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:12px;font-weight:600;color:var(--gray-500);">เลือกประเภทยานพาหนะที่มี → ระบุจำนวนคัน</div>
        <div style="padding:10px 12px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--gray-100);">
          ${OPT.vehicleTypes.map(vt => {
            const v = hh?.vehicles?.[vt.key];
            const checked = v && ((+v.private||0)+(+v.company||0)+(+v.gov||0)) > 0;
            return `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;white-space:nowrap;">
              <input type="checkbox" ${checked?'checked':''} style="accent-color:var(--primary);" onchange="App._toggleVehicleRow('${vt.key}',this.checked)" />
              ${vt.icon} ${vt.label}</label>`;
          }).join('')}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--gray-50);">
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:left;font-weight:600;">ประเภท</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">ส่วนตัว</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">บริษัท</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">ราชการ/รัฐ</th>
          </tr></thead>
          <tbody>${vhRows}</tbody>
        </table>
      </div>`;
  },

  // ===== SHARED: HOUSEHOLD SAVE DATA =====
  _readHhForm() {
    const memberGrid = {};
    OPT.memberGridRows.forEach(row => {
      memberGrid[row.key] = +(document.getElementById('mg_' + row.key)?.value || 0);
    });
    const vehicle = document.getElementById('m_vehicle')?.value;
    const vehicles = {};
    if (vehicle === 'มี') {
      OPT.vehicleTypes.forEach(vt => {
        const p = +(document.getElementById('vp_' + vt.key)?.value || 0);
        const c = +(document.getElementById('vc_' + vt.key)?.value || 0);
        const g = +(document.getElementById('vg_' + vt.key)?.value || 0);
        if (p || c || g) vehicles[vt.key] = { private: p, company: c, gov: g };
      });
    }
    return {
      surveyorName:    this._normName(document.getElementById('m_sname')?.value)       || '',
      supervisorName:  this._normName(document.getElementById('m_supervisor')?.value)  || '',
      travelDate:      document.getElementById('m_travelDate')?.value         || '',
      coordinates:     document.getElementById('m_coords')?.value.trim()      || '',
      coordsSource:    document.getElementById('m_coordsSource')?.value       || '',
      houseNo:         document.getElementById('m_houseNo')?.value.trim()     || '',
      moo:             document.getElementById('m_moo')?.value.trim()         || '',
      alley:           document.getElementById('m_alley')?.value.trim()       || '',
      road:            document.getElementById('m_road')?.value.trim()        || '',
      subdistrict:     document.getElementById('m_subdistrict')?.value.trim() || '',
      district:        document.getElementById('m_district')?.value.trim()    || '',
      province:        document.getElementById('m_province')?.value.trim()    || '',
      phone:           (document.getElementById('m_phone')?.value || '').replace(/-/g,'').trim(),
      residentialType: document.getElementById('m_restype')?.value            || '',
      memberGrid,
      householdIncome: +(document.getElementById('m_income')?.value)          || 0,
      hasVehicle:      vehicle                                                 || '',
      vehicles
    };
  },

  // ===== SHARED: HOUSEHOLD VALIDATION =====
  _validateHhForm(data) {
    const errs = [];
    if (!data.surveyorName)    errs.push('ชื่อผู้สำรวจ');
    if (!data.supervisorName)  errs.push('ชื่อผู้ควบคุม');
    if (!data.travelDate)      errs.push('วันที่เดินทาง');
    if (!data.coordinates)     errs.push('พิกัด GPS');
    if (!data.houseNo)         errs.push('บ้านเลขที่');
    if (!data.subdistrict)     errs.push('ตำบล');
    if (!data.district)        errs.push('อำเภอ');
    if (!data.residentialType) errs.push('ประเภทที่อยู่อาศัย');
    const gridTotal = Object.values(data.memberGrid).reduce((s, v) => s + (+v||0), 0);
    if (gridTotal === 0)       errs.push('จำนวนสมาชิก (ต้องมีอย่างน้อย 1 คน)');
    if (!data.householdIncome) errs.push('รายได้ครัวเรือน');
    if (!data.hasVehicle)      errs.push('การครอบครองยานพาหนะ');
    return errs;
  },

  openAddHousehold() {
    this.showModal('🏠 เพิ่มครัวเรือนใหม่', this._hhFormHTML(null),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveHousehold()">บันทึก</button>`
    );
    setTimeout(() => document.getElementById('m_sname')?.focus(), 50);
  },

  _pickVehicle(val, el) {
    document.querySelectorAll('#m_vehicleGrp .radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById('m_vehicle').value = val;
    document.getElementById('vehicleDetail').style.display = val === 'มี' ? 'block' : 'none';
  },

  _toggleVehicleRow(key, show) {
    const row = document.getElementById('vrow_' + key);
    if (row) row.style.display = show ? '' : 'none';
  },

  saveHousehold() {
    const data = this._readHhForm();
    const errs = this._validateHhForm(data);
    if (errs.length) { this.toast('กรุณากรอก: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    const hh = DB.addHousehold({
      ...data,
      surveyDate: new Date().toISOString().split('T')[0],
      deviceId:   (typeof FB !== 'undefined' ? FB.deviceId() : null) || localStorage.getItem('_is_device_id') || '',
      clientIp:   this._clientIp || ''
    });
    this._autoPush(() => FB.pushHousehold(hh));
    this.closeModal();
    this.toast('บันทึกครัวเรือนแล้ว — กรอกสมาชิกอย่างน้อย 1 คน (ถ้าไม่มีคนเดินทางจะขึ้นสีแดง)', 'success');
    this.navigate('household', hh.id);
  },

  openEditHousehold(id) {
    const hh = DB.getHousehold(id);
    if (!hh) return;
    this.showModal('✏️ แก้ไขข้อมูลบ้าน', this._hhFormHTML(hh),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveEditHousehold('${id}')">บันทึก</button>`
    );
  },

  saveEditHousehold(id) {
    const data = this._readHhForm();
    const errs = this._validateHhForm(data);
    if (errs.length) { this.toast('กรุณากรอก: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    const hh = DB.updateHousehold(id, data);
    this._autoPush(() => FB.pushHousehold(hh));
    this.closeModal();
    this.toast('บันทึกข้อมูลบ้านแล้ว', 'success');
    this.render();
  },

  confirmDeleteHousehold(id) {
    const hh = DB.getHousehold(id);
    const isAdmin = this._isAdmin();
    const label = `<strong>[${hh?.houseNo || hh?.id}]</strong> พร้อมสมาชิก ${hh?.members.length || 0} คน`;
    this.showModal('🗑 ลบครัวเรือน',
      `<p style="color:var(--gray-600)">จะลบครัวเรือน ${label}</p>
       <div style="margin-top:14px;padding:12px;background:var(--gray-100);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;">🖥 ลบจากเครื่องนี้</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">ล้างแคชในเครื่อง · ข้อมูลบนระบบยังอยู่ ดึงกลับได้</div>
       </div>
       ${isAdmin ? `
       <div style="margin-top:10px;padding:12px;background:rgba(239,68,68,.08);border:1px solid var(--danger);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;color:var(--danger);">☁️ ลบออกจากระบบ</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">
           หายจากรายการ · กราฟ · Export ทุกที่ทันที (ทุกเครื่อง)<br>
           <b>เก็บไว้ในถังขยะ — กู้คืนได้ภายหลัง</b>
         </div>
       </div>` : ''}`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-ghost" style="color:var(--gray-700)" onclick="App.deleteHousehold('${id}')">🖥 ลบจากเครื่องนี้</button>
       ${isAdmin ? `<button class="btn btn-danger" onclick="App.systemDeleteHousehold('${id}')">☁️ ลบออกจากระบบ</button>` : ''}`
    );
  },

  // ลบออกจากระบบ (soft delete) — ซ่อนทุกที่ + ส่งขึ้น cloud ทันที · กู้คืนได้จากถังขยะ
  systemDeleteHousehold(id) {
    if (!this._isAdmin()) { this.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }
    const hh = DB.softDeleteHousehold(id, this._adminUsername || 'admin');
    if (!hh) { this.toast('ไม่พบครัวเรือน', 'error'); return; }
    this._autoPush(() => FB.pushHousehold(hh));
    this.closeModal();
    this.toast('ลบออกจากระบบแล้ว · กู้คืนได้จากถังขยะ', 'success');
    this.navigate('home');
  },

  deleteHousehold(id) {
    DB.deleteHousehold(id);
    this.closeModal();
    this.toast('ลบจากเครื่องนี้แล้ว · Cloud ยังอยู่', 'success');
    this.navigate('home');
  },

  // ===================== MEMBER: ไปหน้าสมาชิกเลย ไม่มี modal =====================
  completeMember() {
    const m = DB.getMember(this.hhId, this.memberId);
    if (!m) return this.navigate('household', this.hhId);
    if (m.trips.length < 2) {
      this.toast('ต้องมีการเดินทางอย่างน้อย 2 ครั้ง', 'error'); return;
    }
    const lastTrip = m.trips[m.trips.length - 1];
    if (lastTrip.purpose !== 'กลับบ้าน') {
      this.toast('การเดินทางครั้งสุดท้ายต้องเป็น "กลับบ้าน"', 'error'); return;
    }
    this.toast(`บันทึกสมาชิกที่ ${m.seq} เสร็จสิ้น`, 'success');
    this.navigate('household', this.hhId);
  },

  addMember() {
    const m = DB.addMember(this.hhId, {});
    if (!m) return;
    this._autoPush(() => FB.pushMember(this.hhId, m));
    this.memberTab = 'info';
    this.navigate('member', this.hhId, m.id);
  },

  confirmDeleteMember(mid) {
    const m = DB.getMember(this.hhId, mid);
    this.showModal('🗑 ลบสมาชิกจากเครื่องนี้',
      `<p style="color:var(--gray-600)">จะลบสมาชิกที่ ${m?.seq} พร้อมการเดินทาง ${m?.trips.length || 0} เที่ยว <b>ออกจากเครื่องนี้</b></p>
       <p style="font-size:13px;color:var(--success);font-weight:600;margin-top:8px;">✅ ข้อมูลบน Cloud ยังอยู่ — ดึงกลับได้</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-danger" onclick="App.deleteMember('${mid}')">ลบจากเครื่องนี้</button>`
    );
  },

  deleteMember(mid) {
    DB.deleteMember(this.hhId, mid);
    this.closeModal();
    this.toast('ลบจากเครื่องนี้แล้ว · Cloud ยังอยู่', 'success');
    this.navigate('household', this.hhId);
  },

  // ===================== MODAL: TRIP =====================
  openTripForm(tripId) {
    this.editingTripId = tripId;
    const hh = DB.getHousehold(this.hhId);
    const m  = DB.getMember(this.hhId, this.memberId);
    const t  = tripId ? m?.trips.find(x => x.id === tripId) : null;
    const isEdit = !!t;
    const segs   = t?.segments?.length ? t.segments : [{ mode:'', duration:'', fare:'' }];

    // ——— Trip-chain logic: auto-fill origin ———
    const homeAddr = [
      hh?.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh?.road    ? 'ถ.' + hh.road              : ''
    ].filter(Boolean).join(' ') || 'ที่พักอาศัย';

    let defOrigin       = t?.origin            || '';
    let defOriginCoords = t?.originCoords      || '';
    let defOriginType   = t?.originType        || '';

    if (!isEdit) {
      if (!m || m.trips.length === 0) {
        // การเดินทางแรก: ต้นทาง = บ้าน + ลักษณะสถานที่เป็นบ้าน
        defOrigin       = homeAddr;
        defOriginCoords = hh?.coordinates || '';
        defOriginType   = 'ที่พัก / บ้านของตัวเอง';
      } else {
        // การเดินทางถัดไป: ต้นทาง = ปลายทางของครั้งก่อน
        const last      = m.trips[m.trips.length - 1];
        defOrigin       = last.destination       || '';
        defOriginCoords = last.destinationCoords || '';
        defOriginType   = last.destinationType   || '';
      }
    }

    // ซ่อมกรณีแก้ไข: ต้นทางเที่ยวนี้ไม่มีพิกัด แต่ปลายทางเที่ยวก่อนหน้ามีแล้ว → ดึงมาให้อัตโนมัติ
    if (isEdit && !defOriginCoords && m) {
      const idx = m.trips.findIndex(x => x.id === t.id);
      if (idx === 0) {
        defOriginCoords = hh?.coordinates || '';
        if (!defOrigin) defOrigin = homeAddr;
      } else if (idx > 0) {
        const prev = m.trips[idx - 1];
        defOriginCoords = prev.destinationCoords || defOriginCoords;
        if (!defOrigin) defOrigin = prev.destination || '';
        if (!defOriginType) defOriginType = prev.destinationType || '';
      }
    }

    // default departure = เวลาถึงปลายทางครั้งที่แล้ว
    let defDepart = t?.departureTime || '';
    let prevArrival = '';
    if (!isEdit && m && m.trips.length > 0) {
      prevArrival = m.trips[m.trips.length - 1].arrivalTime || '';
      defDepart   = prevArrival;
    }

    // กรอง tripMode ตามยานพาหนะที่ครัวเรือนมี
    const ownedVehicles = new Set(
      hh?.hasVehicle === 'มี' ? Object.keys(hh.vehicles || {}) : []
    );
    const availModes = OPT.tripMode.filter(mode => {
      const req = OPT.modeRequiresVehicle[mode];
      if (!req) return true; // ไม่ต้องมีรถส่วนตัว → แสดงเสมอ
      return req.some(v => ownedVehicles.has(v));
    });

    const selOpt = (list, val) => list.map(o =>
      `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`
    ).join('');

    const modeOptsStr = `<option value="">— เลือก —</option>` +
      availModes.map(o => `<option value="${o}">${o}</option>`).join('');

    const segHTML = (s, i) => `
      <div class="seg-row" style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="seg-title" style="font-size:12px;font-weight:700;color:var(--primary);">ช่วงที่ ${i+1}</div>
          ${i > 0 ? `<button type="button" onclick="App._removeSeg(this)"
            style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:20px;line-height:1;padding:0 4px;">×</button>` : ''}
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">ประเภทยานพาหนะ</label>
            <select class="form-select seg-mode" autocomplete="off" onchange="App._onSegMode(this)">
              <option value="">— เลือก —</option>${selOpt(availModes, s.mode)}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">เวลาที่ใช้ (นาที)</label>
            <input class="form-input seg-dur" type="number" min="0" inputmode="numeric" autocomplete="off"
              value="${s.duration || ''}" placeholder="นาที" oninput="App._calcArrival()" />
          </div>
          <div class="form-row seg-fare-row" style="display:${this._FARE_MODES.includes(s.mode) ? '' : 'none'};">
            <label class="form-label">ค่าโดยสาร (บาท)</label>
            <input class="form-input seg-fare" type="number" min="0" inputmode="numeric" autocomplete="off" value="${s.fare || ''}" placeholder="บาท" />
          </div>
        </div>
      </div>`;

    this.showModal(isEdit ? '✏️ แก้ไขการเดินทาง' : '🚗 เพิ่มการเดินทาง', `
      <!-- ต้นทาง (auto จากปลายทางก่อนหน้า/บ้าน — แก้ได้ถ้าพิกัดขาด) -->
      <div class="section-label"><span class="od-pill od-pill-from">🟢 ต้นทาง — จุดเริ่มต้น</span></div>
      <div class="form-row">
        <label class="form-label">สถานที่ตั้งต้นทาง
          <span style="font-size:11px;font-weight:400;color:var(--gray-400);margin-left:6px;">ดึงจากปลายทางก่อนหน้า · แก้ได้ถ้าพิกัดขาด</span>
        </label>
        <div style="display:flex;gap:8px;">
          <input id="t_origin" class="form-input" autocomplete="off"
            value="${defOrigin}" placeholder="เช่น ตลาด, โรงเรียน" style="flex:1;min-width:0;" />
          <button type="button" onclick="App._openMap('t_originCoords','t_origin')"
            style="padding:9px 12px;background:var(--primary-light);color:var(--primary);
                   border:1.5px solid var(--primary);border-radius:var(--radius-sm);
                   font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
        </div>
        <input type="hidden" id="t_originCoords" value="${defOriginCoords}" />
        ${defOriginCoords ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">📍 ${defOriginCoords}</div>` : ''}
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ลักษณะสถานที่</label>
          <select id="t_originType" class="form-select" autocomplete="off">
            <option value="">— เลือก —</option>${selOpt(OPT.locationType, defOriginType)}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label req">เวลาที่เริ่มเดินทาง${prevArrival ? ` <span style="font-size:11px;color:var(--gray-400);">(ครั้งที่แล้วถึง ${prevArrival})</span>` : ''}</label>
          <input id="t_depart" class="form-input" type="time" value="${defDepart}"
            oninput="App._calcArrival()" />
        </div>
      </div>

      <!-- วัตถุประสงค์ (ย้ายมาก่อนปลายทาง) -->
      <div class="form-row" style="margin-top:4px;">
        <label class="form-label req">วัตถุประสงค์การเดินทาง</label>
        <select id="t_purpose" class="form-select" autocomplete="off"
          onchange="App._onPurposeChange(this.value)">
          <option value="">— เลือก —</option>${selOpt(OPT.purpose, t?.purpose || '')}
        </select>
      </div>

      <!-- ปลายทาง -->
      <div class="section-label"><span class="od-pill od-pill-to">🔴 ปลายทาง — จุดหมาย</span></div>
      <div class="form-row">
        <label class="form-label">สถานที่ตั้งปลายทาง</label>
        <div style="display:flex;gap:8px;">
          <input id="t_destination" class="form-input" autocomplete="off"
            placeholder="เช่น ตลาด, โรงเรียน" value="${t?.destination || ''}" style="flex:1;min-width:0;" />
          <button type="button" onclick="App._openMap('t_destinationCoords','t_destination')"
            style="padding:9px 12px;background:var(--primary-light);color:var(--primary);
                   border:1.5px solid var(--primary);border-radius:var(--radius-sm);
                   font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
        </div>
        <input type="hidden" id="t_destinationCoords" value="${t?.destinationCoords || ''}" />
        ${t?.destinationCoords ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">📍 ${t.destinationCoords}</div>` : ''}
      </div>
      <div class="form-row">
        <label class="form-label">ลักษณะสถานที่ปลายทาง</label>
        <select id="t_destType" class="form-select" autocomplete="off">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, t?.destinationType || '')}
        </select>
      </div>

      <!-- ช่วงการเดินทาง -->
      <div class="section-label">ยานพาหนะ / รูปแบบการเดินทาง <span style="font-size:11px;font-weight:400;color:var(--danger);">*ต้องมีอย่างน้อย 1 ช่วง</span></div>
      <div id="segContainer">${segs.map((s, i) => segHTML(s, i)).join('')}</div>
      <button type="button" onclick="App._addSeg()"
        style="width:100%;padding:9px;border:1.5px dashed var(--gray-300);background:transparent;
               border-radius:var(--radius-sm);font-family:inherit;font-size:13px;
               color:var(--gray-500);cursor:pointer;margin-bottom:4px;">
        + เพิ่มช่วงการเดินทาง
      </button>

      <!-- จอดรถ -->
      <div class="section-label">สถานที่จอดรถ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">สถานที่จอดรถ</label>
          <input id="t_park" class="form-input" autocomplete="off"
            value="${t?.parkingLocation || ''}" placeholder="เช่น ลานจอดห้าง" />
        </div>
        <div class="form-row">
          <label class="form-label">ค่าจอดรถ (บาท)</label>
          <input id="t_parkFee" class="form-input" type="number" min="0" inputmode="numeric" autocomplete="off"
            value="${t?.parkingFee || ''}" placeholder="0" />
        </div>
      </div>

      <!-- เวลาถึงปลายทาง — ท้ายสุด -->
      <div class="form-row" style="margin-top:4px;">
        <label class="form-label">เวลาถึงปลายทาง (คำนวณอัตโนมัติ)</label>
        <div id="t_arriveDisplay"
          style="padding:10px 14px;background:var(--gray-50);border:1.5px solid var(--gray-200);
                 border-radius:var(--radius-sm);font-size:15px;color:var(--gray-700);font-weight:700;text-align:center;">
          ${t?.arrivalTime || '— กรอกเวลาออก + ระยะเวลาก่อน'}
        </div>
        <input type="hidden" id="t_arrive_hidden" value="${t?.arrivalTime || ''}" />
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveTrip()">${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มการเดินทาง'}</button>`
    );
  },

  // format/display phone helpers
  _formatPhone(el) {
    let v = el.value.replace(/\D/g, '').slice(0, 10);
    if (v.length > 6) v = v.slice(0,3) + '-' + v.slice(3,6) + '-' + v.slice(6);
    else if (v.length > 3) v = v.slice(0,3) + '-' + v.slice(3);
    el.value = v;
  },
  _displayPhone(digits) {
    if (!digits) return '';
    const v = digits.replace(/\D/g,'');
    if (v.length > 6) return v.slice(0,3) + '-' + v.slice(3,6) + '-' + v.slice(6);
    if (v.length > 3) return v.slice(0,3) + '-' + v.slice(3);
    return v;
  },

  // reverse geocode พิกัด → ตำบล/อำเภอ/จังหวัด (Nominatim/OSM — ฟรี ไม่ต้อง key)
  // reverse geocode → Longdo address (ข้อมูลไทยแม่น · ได้ ตำบล ด้วย · ไม่ติด throttle เหมือน Nominatim)
  _reverseGeocode(lat, lon) {
    const key = (typeof PlaceService !== 'undefined' && PlaceService.LONGDO_KEY) || '';
    fetch(`https://api.longdo.com/map/services/address?lon=${lon}&lat=${lat}&key=${key}&locale=th`)
      .then(r => r.json())
      .then(d => {
        const strip = s => (s || '').replace(/^(ต\.|อ\.|จ\.|ตำบล|อำเภอ|จังหวัด)\s*/, '').trim();
        const sub = strip(d.subdistrict), dis = strip(d.district), pro = strip(d.province);
        const subEl = document.getElementById('m_subdistrict');
        const disEl = document.getElementById('m_district');
        const proEl = document.getElementById('m_province');
        if (subEl && sub) subEl.value = sub;
        if (disEl && dis) disEl.value = dis;
        if (proEl && pro) proEl.value = pro;
        if (sub || dis || pro)
          this.toast(`พบที่อยู่: ต.${sub||'?'} อ.${dis||'?'} จ.${pro||'?'}`, 'success');
      })
      .catch(() => {});
  },

  // ใช้ GPS เครื่องอ่านพิกัดปัจจุบัน
  // ใช้ watchPosition เก็บพิกัดที่แม่นขึ้นเรื่อยๆ + นาฬิกากันค้าง (ปุ่มกลับมากดได้เสมอ แม้เบราว์เซอร์เงียบ)
  _useGPS(coordsId) {
    if (!navigator.geolocation) { this.toast('เบราว์เซอร์นี้ไม่รองรับ GPS', 'error'); return; }
    if (!window.isSecureContext) { this.toast('GPS ใช้ได้เฉพาะผ่าน https', 'error'); return; }
    const btn = document.getElementById('gpsBtn_' + coordsId);
    const orig = (btn && btn.dataset.orig) || (btn ? btn.textContent : '') || '📍';
    if (btn) { btn.dataset.orig = orig; btn.textContent = '⌛'; btn.disabled = true; }

    let watchId = null, best = null, done = false;

    const apply = pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lon = pos.coords.longitude.toFixed(6);
      const coords = `${lat}, ${lon}`;
      const el = document.getElementById(coordsId);
      if (el) el.value = coords;
      const hintEl = document.querySelector(`[data-coordshint="${coordsId}"]`);
      if (hintEl) hintEl.textContent = '📍 ' + coords;
      const acc = pos.coords.accuracy ? ` (±${Math.round(pos.coords.accuracy)} ม.)` : '';
      this.toast(`รับพิกัด GPS: ${coords}${acc}`, 'success');
      // ถ้าเป็นฟอร์มครัวเรือน ดึงชื่ออำเภอ/จังหวัดอัตโนมัติ
      if (coordsId === 'm_coords') { this._reverseGeocode(lat, lon); this._setHhCoordsSource('gps'); }
    };
    const cleanup = () => {
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      clearTimeout(hardTimer); clearTimeout(settleTimer);
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    };
    const finish = ok => {
      if (done) return; done = true;
      cleanup();
      if (ok && best) apply(best);
    };
    const fail = err => {
      if (done) return; done = true;
      cleanup();
      let msg;
      if (err && err.code === 1)      msg = 'ถูกบล็อกตำแหน่ง — กด Allow ตอนเด้งถาม + เปิด Location Services ของเครื่อง (Mac: ตั้งค่า→ความเป็นส่วนตัว→บริการหาตำแหน่ง เปิดให้เบราว์เซอร์ด้วย)';
      else if (err && err.code === 2) msg = 'หาตำแหน่งไม่ได้ — เปิด Location Services ของเครื่อง/เบราว์เซอร์ หรือกดปุ่มแผนที่ปักหมุดแทน';
      else                            msg = 'หาตำแหน่งไม่สำเร็จ — ตรวจว่าเปิด Location Services ของเครื่อง/เบราว์เซอร์แล้ว (บนคอมพ์ต้องเปิด WiFi) หรือกดปุ่มแผนที่ปักหมุดแทน';
      this.toast(msg, 'error');
    };

    var settleTimer = null;
    watchId = navigator.geolocation.watchPosition(
      pos => {
        if (!best || (pos.coords.accuracy || 9999) < (best.coords.accuracy || 9999)) best = pos;
        if ((pos.coords.accuracy || 9999) <= 30) { finish(true); return; }   // แม่นระดับ GPS มือถือ → จบทันที
        // ได้พิกัดแล้วแต่ยังไม่แม่นสุด (เช่นคอมพ์ผ่าน WiFi ~50-500 ม.) → รออีก 3 วิเผื่อแม่นขึ้น แล้วจบ ไม่รอครบ 15 วิ
        if (settleTimer == null) settleTimer = setTimeout(() => finish(true), 3000);
      },
      err => { if (err.code === 1) fail(err); },   // permission ถูกบล็อก → เลิกทันที · อื่นๆ รอ hard timeout
      { enableHighAccuracy: true, timeout: 27000, maximumAge: 60000 }   // ยอมใช้พิกัดที่ OS เพิ่งหาไว้ ≤60 วิ → กดแล้วเด้งเร็ว
    );

    // นาฬิกากันค้าง: 15 วิ เอาพิกัดที่ดีที่สุดที่ได้ · ถ้ายังไม่ได้อะไรเลย = แจ้ง error (ปุ่มกลับมากดได้เสมอ)
    var hardTimer = setTimeout(() => { best ? finish(true) : fail({ code: 3 }); }, 15000);
  },

  // เปิด map picker สำหรับ trip (รับ coordsInputId)
  // เปิดแผนที่สำหรับพิกัดครัวเรือน (ฟอร์มสมาชิก/ครัวเรือน — ทั้งบันทึกและแก้ไข)
  _openHhMap() {
    const coordsEl = document.getElementById('m_coords');
    MapPicker.open(coordsEl?.value || '', coords => {
      if (coordsEl) coordsEl.value = coords;
      this._setHhCoordsSource('manual');   // ปักจากแผนที่ = ติดธงให้ admin ตรวจ
      const p = coords.split(',');
      this._reverseGeocode(parseFloat(p[0]), parseFloat(p[1]));  // เติม อำเภอ/จังหวัด
    });
  },

  // ที่มาพิกัดบ้าน: 'gps' = กดจากเครื่องที่จุดจริง · 'manual' = ปักแผนที่/พิมพ์เอง (admin ควรสุ่มตรวจ)
  _setHhCoordsSource(src) {
    const el = document.getElementById('m_coordsSource');
    if (el) el.value = src;
  },

  _openMap(coordsId, nameId) {
    const coordsEl = document.getElementById(coordsId);
    const nameEl   = nameId ? document.getElementById(nameId) : null;
    MapPicker.open(coordsEl?.value || '', (coords, name) => {
      if (coordsEl) {
        coordsEl.value = coords;
        // อัพเดตแสดงพิกัดใต้ input
        const hint = coordsEl.nextElementSibling;
        if (hint && hint.style.fontSize === '11px') {
          hint.textContent = '📍 ' + coords;
        } else {
          const d = document.createElement('div');
          d.style.cssText = 'font-size:11px;color:var(--gray-400);margin-top:3px;';
          d.textContent = '📍 ' + coords;
          coordsEl.insertAdjacentElement('afterend', d);
        }
      }
      // เลือกผลค้นหา/ปักหมุดที่มีชื่อ → ดึงชื่อมาใส่
      if (nameEl && name) nameEl.value = name;
    });
  },

  // ถ้าเลือก "กลับบ้าน" → auto-fill ปลายทาง = บ้าน
  _onPurposeChange(val) {
    if (val !== 'กลับบ้าน') return;
    const hh = DB.getHousehold(this.hhId);
    if (!hh) return;
    const homeAddr = [
      hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh.road    ? 'ถ.' + hh.road              : ''
    ].filter(Boolean).join(' ') || 'ที่พักอาศัย';

    const destEl   = document.getElementById('t_destination');
    const coordsEl = document.getElementById('t_destinationCoords');
    const typeEl   = document.getElementById('t_destType');

    if (destEl)   destEl.value   = homeAddr;
    if (coordsEl) coordsEl.value = hh.coordinates || '';
    if (typeEl)   typeEl.value   = 'ที่พัก / บ้านของตัวเอง';

    // แสดงพิกัดใต้ input
    if (hh.coordinates) {
      const existing = coordsEl?.nextElementSibling;
      if (existing && existing.style.fontSize === '11px') {
        existing.textContent = '📍 ' + hh.coordinates;
      } else if (coordsEl) {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:11px;color:var(--gray-400);margin-top:3px;';
        d.textContent = '📍 ' + hh.coordinates;
        coordsEl.insertAdjacentElement('afterend', d);
      }
    }
  },

  // โหมดที่มีค่าโดยสาร (รถโดยสาร/รับจ้าง) → ช่องค่าโดยสารโผล่เฉพาะตอนเลือกโหมดเหล่านี้
  _FARE_MODES: ['รถจักรยานยนต์รับจ้าง','รถสามล้อเครื่อง / แท็กซี่','รถสองแถว / รถประจำทาง','รถส่วนบุคคลรับจ้าง','รถไฟ'],
  _onSegMode(selectEl) {
    const row = selectEl.closest('.seg-row');
    const fareRow = row && row.querySelector('.seg-fare-row');
    if (fareRow) {
      const show = this._FARE_MODES.includes(selectEl.value);
      fareRow.style.display = show ? '' : 'none';
      if (!show) { const f = fareRow.querySelector('.seg-fare'); if (f) f.value = ''; }
    }
    this._calcArrival();
  },

  _calcArrival() {
    const depart = document.getElementById('t_depart')?.value;
    const display = document.getElementById('t_arriveDisplay');
    const hidden  = document.getElementById('t_arrive_hidden');
    if (!depart) {
      if (display) display.textContent = '— กรอกเวลาออก + ระยะเวลาก่อน';
      if (hidden)  hidden.value = '';
      return;
    }
    const [h, mn] = depart.split(':').map(Number);
    let totalMins = h * 60 + mn;
    document.querySelectorAll('#segContainer .seg-dur').forEach(inp => {
      totalMins += +(inp.value) || 0;
    });
    const arrH = Math.floor(totalMins / 60) % 24;
    const arrM = totalMins % 60;
    const arrStr = `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`;
    if (display) display.textContent = arrStr;
    if (hidden)  hidden.value = arrStr;
  },

  _addSeg() {
    const container = document.getElementById('segContainer');
    if (!container) return;
    const i = container.querySelectorAll('.seg-row').length;
    // ใช้ modeOptsStr ที่ render ไว้ใน segContainer ตัวแรก (clone options)
    const firstSelect = container.querySelector('.seg-mode');
    const modeOpts = firstSelect
      ? Array.from(firstSelect.options).map(o => `<option value="${o.value}">${o.text}</option>`).join('')
      : OPT.tripMode.map(o => `<option value="${o}">${o}</option>`).join('');
    const div = document.createElement('div');
    div.className = 'seg-row';
    div.style.cssText = 'background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div class="seg-title" style="font-size:12px;font-weight:700;color:var(--primary);">ช่วงที่ ${i+1}</div>
        <button type="button" onclick="App._removeSeg(this)"
          style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:20px;line-height:1;padding:0 4px;">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ประเภทยานพาหนะ</label>
          <select class="form-select seg-mode" autocomplete="off" onchange="App._onSegMode(this)">
            ${modeOpts}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">เวลาที่ใช้ (นาที)</label>
          <input class="form-input seg-dur" type="number" min="0" inputmode="numeric" autocomplete="off" placeholder="นาที" oninput="App._calcArrival()" />
        </div>
        <div class="form-row seg-fare-row" style="display:none;">
          <label class="form-label">ค่าโดยสาร (บาท)</label>
          <input class="form-input seg-fare" type="number" min="0" inputmode="numeric" autocomplete="off" placeholder="บาท" />
        </div>
      </div>`;
    container.appendChild(div);
    // renumber
    container.querySelectorAll('.seg-row .seg-title').forEach((t, idx) => {
      t.textContent = `ช่วงที่ ${idx + 1}`;
    });
  },

  _removeSeg(btn) {
    const container = document.getElementById('segContainer');
    if (!container || container.querySelectorAll('.seg-row').length <= 1) return;
    btn.closest('.seg-row').remove();
    container.querySelectorAll('.seg-row .seg-title').forEach((t, idx) => {
      t.textContent = `ช่วงที่ ${idx + 1}`;
    });
  },

  saveTrip() {
    const segRows = document.querySelectorAll('#segContainer .seg-row');
    const segments = [];
    segRows.forEach(row => {
      segments.push({
        mode:     row.querySelector('.seg-mode')?.value  || '',
        duration: row.querySelector('.seg-dur')?.value   || '',
        fare:     row.querySelector('.seg-fare')?.value  || ''
      });
    });

    const purpose       = document.getElementById('t_purpose')?.value   || '';
    const departureTime = document.getElementById('t_depart')?.value    || '';

    // --- validate required ---
    if (!purpose)       { this.toast('กรุณาเลือกวัตถุประสงค์การเดินทาง', 'error'); return; }
    if (!departureTime) { this.toast('กรุณากรอกเวลาออกเดินทาง', 'error'); return; }
    if (!segments.length || !segments[0].mode) {
      this.toast('กรุณาระบุวิธีเดินทางอย่างน้อย 1 ช่วง', 'error'); return;
    }
    // modes ที่บังคับกรอกค่าโดยสาร
    const fareRequired = this._FARE_MODES;
    for (let i = 0; i < segments.length; i++) {
      if (fareRequired.includes(segments[i].mode) && !segments[i].fare) {
        this.toast(`ช่วงที่ ${i+1} (${segments[i].mode}): กรุณากรอกค่าโดยสาร`, 'error'); return;
      }
    }

    // validate เวลาออกต้องมากกว่าครั้งก่อน
    if (!this.editingTripId && departureTime) {
      const m2 = DB.getMember(this.hhId, this.memberId);
      if (m2 && m2.trips.length > 0) {
        const prevArr = m2.trips[m2.trips.length - 1].arrivalTime;
        if (prevArr && departureTime < prevArr) {
          this.toast(`เวลาออก (${departureTime}) ต้องไม่ก่อนเวลาถึงครั้งที่แล้ว (${prevArr})`, 'error');
          return;
        }
      }
    }
    const data = {
      origin:            document.getElementById('t_origin')?.value.trim()       || '',
      originCoords:      document.getElementById('t_originCoords')?.value.trim() || '',
      originType:        document.getElementById('t_originType')?.value           || '',
      departureTime,
      destination:       document.getElementById('t_destination')?.value.trim()   || '',
      destinationCoords: document.getElementById('t_destinationCoords')?.value.trim() || '',
      destinationType:   document.getElementById('t_destType')?.value             || '',
      arrivalTime:       document.getElementById('t_arrive_hidden')?.value        || '',
      purpose,
      segments,
      parkingLocation:   document.getElementById('t_park')?.value.trim()          || '',
      parkingFee:        document.getElementById('t_parkFee')?.value              || ''
    };

    let savedTrip;
    if (this.editingTripId) {
      savedTrip = DB.updateTrip(this.hhId, this.memberId, this.editingTripId, data);
      this.toast('แก้ไขการเดินทางแล้ว', 'success');
    } else {
      savedTrip = DB.addTrip(this.hhId, this.memberId, data);
      this.toast('เพิ่มการเดินทางแล้ว', 'success');
    }
    this._autoPush(() => FB.pushTrip(this.hhId, this.memberId, savedTrip));
    this.editingTripId = null;
    this.closeModal();
    this.memberTab = 'trips';
    this.render();
  },

  deleteTrip(tripId) {
    DB.deleteTrip(this.hhId, this.memberId, tripId);
    this.toast('ลบจากเครื่องนี้แล้ว · Cloud ยังอยู่', 'success');
    this.render();
  },

  // ===================== MODAL ENGINE =====================
  showModal(title, body, footer) {
    const old = document.getElementById('appModal');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'appModal';
    el.innerHTML = `<div class="modal">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">${footer}</div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el) this.closeModal(); });
    document.body.appendChild(el);
  },

  closeModal() {
    const m = document.getElementById('appModal');
    if (m) m.remove();
  },

  // ===================== TOAST =====================
  toast(msg, type = '') {
    const wrap = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = { success:'✓', warning:'⚠', danger:'✕' };
    t.innerHTML = `<span>${icon[type] || 'ℹ'}</span> ${msg}`;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  // ===================== FIREBASE SYNC / PULL =====================
  pullFromCloud() {
    const isAdmin    = this._isAdmin();
    const localCount = DB.getHouseholds().length;
    const scopeName  = this._isStaff() ? `ทีม "${this._team}"` : `"${this._surveyorName}"`;
    const filterNote = isAdmin ? '' :
      `<br><span style="color:var(--primary);font-size:12px;">🔍 จะดึงเฉพาะข้อมูลของ ${this.esc(scopeName)} เท่านั้น</span>`;
    const msg = localCount > 0
      ? `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มา<b>รวม</b>กับข้อมูลในเครื่อง ${localCount} ครัวเรือน<br>ข้อมูลที่ซ้ำ ID กันจะใช้ข้อมูลจาก Firebase แทน${filterNote}</p>`
      : `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มาไว้ในเครื่องนี้${filterNote}</p>`;
    this.showModal('☁️ ดึงข้อมูลจาก Firebase', msg,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.closeModal();App._doPull()">ดึงข้อมูล</button>`
    );
  },

  async _doPull() {
    const btn = document.getElementById('pullBtn');
    if (btn) { btn.textContent = '⌛ กำลังดึง...'; btn.disabled = true; }
    try {
      if (typeof firebase === 'undefined') throw new Error('โหลด Firebase SDK ไม่สำเร็จ — ต้องการอินเทอร์เน็ต');
      if (typeof FB === 'undefined') throw new Error('firebase.js โหลดไม่สำเร็จ');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = await this._pullScoped();
      this.toast(`☁️ ดึงข้อมูลสำเร็จ รวม ${count} ครัวเรือน`, 'success');
      this.navigate('home');
    } catch (e) {
      this.toast('ดึงข้อมูลไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ ดึงข้อมูล'; btn.disabled = false; }
    }
  },

  async syncToCloud() {
    const btn = document.getElementById('syncBtn');
    if (btn) { btn.textContent = '⌛ กำลัง sync...'; btn.disabled = true; }
    try {
      if (typeof firebase === 'undefined') throw new Error('โหลด Firebase SDK ไม่สำเร็จ — ต้องการอินเทอร์เน็ต');
      if (typeof FB === 'undefined') throw new Error('firebase.js โหลดไม่สำเร็จ');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const summary = this._isAdmin() ? await FB.syncAll(null)
                    : this._isStaff() ? await FB.syncAll(this._team, 'supervisorName')
                    :                   await FB.syncAll(this._surveyorName);
      const lastSync = FB.lastSync();
      const timeStr = lastSync ? new Date(lastSync).toLocaleTimeString('th-TH') : '';
      this.toast(`☁️ sync สำเร็จ · ${summary}${timeStr ? ' · ' + timeStr : ''}`, 'success');
    } catch (e) {
      this.toast('sync ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ Sync'; btn.disabled = false; }
    }
  },

  // ===================== EXPORT / CLEAR =====================
  async exportData() {
    if (!this._canManage()) { this.toast('เฉพาะผู้ดูแลระบบ / ผู้ควบคุมเท่านั้น', 'error'); return; }
    if (typeof XLSX === 'undefined') {
      this.toast('โหลด SheetJS ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต', 'error');
      return;
    }
    // โหลดโซนจากระบบเพื่อคำนวณคอลัมน์โซนจากพิกัด (ถ้าโหลดไม่ได้ export ต่อได้ คอลัมน์โซนว่าง)
    try { await ZoneService.load(); }
    catch (e) { this.toast('⚠ โหลดโซนไม่ได้ (' + e.message + ') — export โดยไม่มีโซน', 'warning'); }
    const zone = c => ZoneService.assign(c);

    const data = JSON.parse(DB.exportJSON());
    // staff ได้เฉพาะทีมตัวเอง (admin ได้ทั้งหมด)
    data.households = this._visibleHouseholds(data.households || []);
    if (!data.households.length) { this.toast('ไม่มีข้อมูลให้ export', 'warning'); return; }
    const wb   = XLSX.utils.book_new();

    // ===== Sheet 1: ครัวเรือน =====
    const hhRows = data.households.map(hh => {
      // ยานพาหนะ: เก็บแยก ส่วนตัว/บริษัท/ราชการ ทุกประเภท
      const vcol = {};
      OPT.vehicleTypes.forEach(vt => {
        const v = hh.vehicles?.[vt.key] || {};
        vcol[`${vt.label} (ส่วนตัว)`]   = +(v.private || 0);
        vcol[`${vt.label} (บริษัท)`]    = +(v.company || 0);
        vcol[`${vt.label} (ราชการ)`]   = +(v.gov     || 0);
      });
      return {
        'ID':                        hh.id,
        'วันที่เดินทาง':             hh.travelDate,
        'วันที่บันทึก':              hh.surveyDate,
        'ผู้สำรวจ':                  hh.surveyorName,
        'ผู้ควบคุม':                 hh.supervisorName,
        'บ้านเลขที่':                hh.houseNo,
        'หมู่':                      hh.moo,
        'ซอย':                       hh.alley,
        'ถนน':                       hh.road,
        'โทรศัพท์':                  hh.phone,
        'พิกัด':                     hh.coordinates,
        'โซนบ้าน':                   zone(hh.coordinates),
        'ตำบล':                      hh.subdistrict,
        'อำเภอ':                     hh.district,
        'จังหวัด':                   hh.province,
        'Device ID':                 hh.deviceId,
        'IP เครื่อง':                hh.clientIp,
        'ประเภทที่อยู่อาศัย':        hh.residentialType,
        'สมาชิก ชาย-กำลังศึกษา':    +(hh.memberGrid?.m_study || 0),
        'สมาชิก ชาย-ทำงานแล้ว':     +(hh.memberGrid?.m_work  || 0),
        'สมาชิก ชาย-ไม่ได้ทำงาน':   +(hh.memberGrid?.m_notw  || 0),
        'สมาชิก หญิง-กำลังศึกษา':   +(hh.memberGrid?.f_study || 0),
        'สมาชิก หญิง-ทำงานแล้ว':    +(hh.memberGrid?.f_work  || 0),
        'สมาชิก หญิง-ไม่ได้ทำงาน':  +(hh.memberGrid?.f_notw  || 0),
        'สมาชิก ชาย-ต่ำกว่า6ปี':    +(hh.memberGrid?.m_child || 0),
        'สมาชิก หญิง-ต่ำกว่า6ปี':   +(hh.memberGrid?.f_child || 0),
        'รายได้ครัวเรือน':           hh.householdIncome,
        'มียานพาหนะ':                hh.hasVehicle,
        ...vcol
      };
    });

    // ===== Sheet 2: สมาชิก =====
    const memberRows = data.households.flatMap(hh =>
      hh.members.map(m => ({
        'ID_ครัวเรือน':        hh.id,
        'ID_สมาชิก':          m.id,
        'ลำดับ':              m.seq,
        'เพศ':                m.gender,
        'อายุ':               m.age,
        'สถานะในบ้าน':        m.homeStatus,
        'สถานะการทำงาน':      m.workStatus,
        'อาชีพ':              m.occupation,
        'การศึกษา':           m.education,
        'ชื่อสถานที่ทำงาน':   m.workplaceName,
        'พิกัดที่ทำงาน':      m.workplaceCoords || '',
        'โซนที่ทำงาน':        zone(m.workplaceCoords),
        'รายได้':             m.income,
      }))
    );

    // ===== Sheet 3: การเดินทาง =====
    const tripRows = data.households.flatMap(hh =>
      hh.members.flatMap(m =>
        m.trips.map(t => {
          const segs = t.segments || [];
          return {
            'ID_ครัวเรือน':       hh.id,
            'ID_สมาชิก':         m.id,
            'ลำดับสมาชิก':       m.seq,
            'ID_การเดินทาง':      t.id,
            'ลำดับการเดินทาง':    t.seq,
            'ต้นทาง':            t.origin,
            'พิกัดต้นทาง':       t.originCoords,
            'โซนต้นทาง':         zone(t.originCoords),
            'ประเภทต้นทาง':      t.originType,
            'เวลาออกเดินทาง':     t.departureTime,
            'ปลายทาง':           t.destination,
            'พิกัดปลายทาง':      t.destinationCoords,
            'โซนปลายทาง':        zone(t.destinationCoords),
            'ประเภทปลายทาง':     t.destinationType,
            'เวลาถึงปลายทาง':    t.arrivalTime,
            'วัตถุประสงค์':       t.purpose,
            'รูปแบบ_1':          segs[0]?.mode     || '',
            'ระยะเวลา_1(นาที)':  segs[0]?.duration || '',
            'ค่าโดยสาร_1(บาท)':  segs[0]?.fare     || '',
            'รูปแบบ_2':          segs[1]?.mode     || '',
            'ระยะเวลา_2(นาที)':  segs[1]?.duration || '',
            'ค่าโดยสาร_2(บาท)':  segs[1]?.fare     || '',
            'รูปแบบ_3':          segs[2]?.mode     || '',
            'ระยะเวลา_3(นาที)':  segs[2]?.duration || '',
            'ค่าโดยสาร_3(บาท)':  segs[2]?.fare     || '',
            'สถานที่จอด':         t.parkingLocation,
            'ค่าจอด(บาท)':       t.parkingFee,
          };
        })
      )
    );

    // สร้าง worksheet (ถ้าไม่มีข้อมูลให้สร้าง empty sheet)
    const mkSheet = rows => rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['ไม่มีข้อมูล']]);

    XLSX.utils.book_append_sheet(wb, mkSheet(hhRows),     'ครัวเรือน');
    XLSX.utils.book_append_sheet(wb, mkSheet(memberRows), 'สมาชิก');
    XLSX.utils.book_append_sheet(wb, mkSheet(tripRows),   'การเดินทาง');

    const filename = `home-interview-banphai-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    this.toast('Export Excel สำเร็จ', 'success');
  },

  // ช่องพิมพ์ "delete" เพื่อกันการลบพลาด — ปุ่มลบ (btnId) เริ่มต้น disabled จนกว่าจะพิมพ์ถูก
  _deleteConfirmHTML(btnId) {
    return `<div style="margin-top:14px;">
      <label style="display:block;font-size:13px;color:var(--gray-600);margin-bottom:6px;">
        พิมพ์ <strong style="color:var(--danger);">delete</strong> เพื่อยืนยันการลบ
      </label>
      <input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
        placeholder="delete" oninput="App._armDelete(this,'${btnId}')"
        style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--gray-300);border-radius:8px;font-size:15px;">
    </div>`;
  },
  _armDelete(input, btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = input.value.trim().toLowerCase() !== 'delete';
  },

  confirmClearAll() {
    const isAdmin = this._canManage();   // staff ล้าง cache ในเครื่องได้ (ไม่กระทบ cloud)
    const stats = DB.stats(isAdmin ? null : this._surveyorName);
    const title = isAdmin ? '🗑 ล้างข้อมูลทั้งหมดจากเครื่องนี้' : '🗑 ล้างข้อมูลของฉันจากเครื่องนี้';
    this.showModal(title,
      `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
        <strong style="color:#92400e;">ข้อมูลในเครื่องที่จะหาย:</strong>
        <ul style="margin-top:8px;padding-left:18px;font-size:14px;color:#78350f;line-height:1.8;">
          <li>${stats.households} ครัวเรือน</li>
          <li>${stats.members} สมาชิก</li>
          <li>${stats.trips} การเดินทาง</li>
        </ul>
      </div>
      <p style="font-size:13px;color:var(--success);font-weight:600;">✅ ข้อมูลบน Cloud ยังอยู่ครบ — กด "ดึงข้อมูล" เพื่อโหลดกลับมาได้ทุกเมื่อ</p>
      ${this._deleteConfirmHTML('delCacheBtn')}`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="App.exportData()" style="color:var(--primary);">⬇ Export ก่อน</button>` : ''}
       <button id="delCacheBtn" class="btn btn-danger" disabled onclick="App.${isAdmin ? 'clearAll' : 'clearMyData'}()">ล้าง cache</button>`
    );
  },

  async clearAll() {
    await DB.clearAll();   // ล้างทั้ง IndexedDB + localStorage (ไม่งั้นข้อมูลกลับมาตอน reload)
    this.closeModal();
    this.toast('ล้าง cache แล้ว · Cloud ยังอยู่', 'success');
    this.navigate('home');
  },

  clearMyData() {
    DB.clearMyData(this._surveyorName);
    this.closeModal();
    this.toast('ล้างข้อมูลของฉันแล้ว · Cloud ยังอยู่', 'success');
    this.render();
  },

};

document.addEventListener('DOMContentLoaded', () => App.init());

// ป้ายเวอร์ชันมุมล่างซ้าย (บางๆ ไม่รบกวน) — อ่านจาก Service Worker ไว้เช็ค cache freshness
document.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:5px;bottom:3px;z-index:99999;font-size:10px;line-height:1;color:#94a3b8;opacity:.35;pointer-events:none;font-family:monospace;letter-spacing:.02em;';
  document.body.appendChild(b);
  const swc = navigator.serviceWorker;
  if (swc) {
    swc.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'version') b.textContent = e.data.version;
    });
    swc.ready.then(reg => { if (reg.active) reg.active.postMessage('getVersion'); }).catch(() => {});
  }
});
