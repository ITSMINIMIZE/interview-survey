// ===== ROADSIDE INTERVIEW APP =====
const App = {
  page: 'home', stId: null, ivId: null,
  _clientIp: '',
  _role: null,          // 'admin' | 'staff' | 'surveyor'
  _surveyorName: '',
  _adminUsername: '',
  _team: '',            // staff: ชื่อผู้ควบคุม = ทีมที่ตัวเองดูแล
  _bootHandled: false,  // กันเข้าแอปซ้ำเมื่อ auth event ยิงหลายครั้ง

  // ---- สิทธิ์ ----
  _isAdmin()   { return this._role === 'admin'; },
  _isStaff()   { return this._role === 'staff'; },
  _canManage() { return this._role === 'admin' || this._role === 'staff'; },  // สร้างจุดสำรวจ/export
  _canSeeAll() { return this._role === 'admin'; },                            // เห็นข้ามทีม
  _teamName()  { return this._team || ''; },
  // ดึงข้อมูลตามขอบเขตของบทบาท
  _pullScoped() {
    if (this._isAdmin()) return FB.pullAll();
    if (this._isStaff()) return FB.pullBySupervisor(this._team);
    return FB.pullBySurveyor(this._surveyorName);
  },
  // จุดสำรวจที่บทบาทนี้เห็นได้: admin=ทั้งหมด · staff=ทีมตัวเอง · ผู้สำรวจ=ทั้งหมด (ต้องเห็นเพื่อไปลงจุด)
  _visibleStations(list) {
    if (this._isStaff()) return list.filter(st => this._normName(st.supervisorName) === this._team);
    return list;
  },
  // wizard state
  wizardStep: 1,
  wizardData: null,
  _wizardDirection: null,
  _wizardDone: false,
  _paxCustom: false,

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

    if (typeof firebase !== 'undefined' && firebase.apps?.length) {
      FB.onAuthStateChanged(async user => {
        // รายชื่อผู้ควบคุมสำหรับ dropdown — ต้องมี token ก่อนถึงอ่าน config ได้ (anonymous ก็พอ)
        if (user) Supervisors.load(FB.db).catch(() => {});
        if (this._role || this._bootHandled) return;
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
                  justify-content:center;padding:24px;
                  background:linear-gradient(160deg,#fff7e6 0%,#fef3c7 40%,#f8fafc 100%);">
        <div style="width:100%;max-width:340px;">
          <div style="text-align:center;margin-bottom:36px;">
            <div style="font-size:56px;margin-bottom:16px;filter:drop-shadow(0 4px 8px rgba(217,119,6,.25));">🚦</div>
            <div style="font-size:24px;font-weight:800;color:var(--gray-900);letter-spacing:-.01em;">Roadside Interview</div>
            <div style="font-size:13px;color:var(--gray-500);margin-top:6px;line-height:1.5;">
              โครงการวางผังเมืองรวม<br>อำเภอบ้านไผ่ จ.ขอนแก่น
            </div>
          </div>
          <div style="background:var(--white);border-radius:var(--radius-lg);padding:24px;
                      box-shadow:0 8px 40px rgba(0,0,0,.1),0 1px 0 rgba(255,255,255,.8);
                      border:1px solid rgba(217,119,6,.15);">
            <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;
                        letter-spacing:.06em;margin-bottom:14px;">เลือกบทบาทของคุณ</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn btn-primary" style="padding:14px 20px;font-size:15px;justify-content:flex-start;gap:12px;border-radius:var(--radius);"
                onclick="App.loginAsSurveyor()">
                <span style="font-size:20px;">📋</span>
                <span>เข้าใช้งานเป็นผู้สำรวจ</span>
              </button>
              <button class="btn btn-ghost" style="padding:14px 20px;font-size:15px;justify-content:flex-start;gap:12px;border-radius:var(--radius);"
                onclick="App.loginAsAdmin()">
                <span style="font-size:20px;">🔐</span>
                <span>เข้าสู่ระบบ (ผู้ดูแล / ผู้ควบคุม)</span>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },

  loginAsSurveyor() {
    this.showModal('📋 เข้าใช้งานเป็นผู้สำรวจ', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-row">
          <label class="form-label">ชื่อ</label>
          <input id="sv_fname" class="form-input" autocomplete="off" placeholder="ชื่อจริง" />
        </div>
        <div class="form-row">
          <label class="form-label">นามสกุล</label>
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
    this._enterApp(true);
  },

  loginAsAdmin() {
    this.showModal('🔐 เข้าสู่ระบบ (ผู้ดูแล / ผู้ควบคุม)', `
      <div class="form-row">
        <label class="form-label">ชื่อผู้ใช้ หรือ อีเมล</label>
        <input id="adm_user" class="form-input" autocomplete="username" placeholder="username หรือ email"
          onkeydown="if(event.key==='Enter')document.getElementById('adm_pass').focus()" />
        <div style="font-size:11px;color:var(--gray-500);margin-top:3px;">ผู้ดูแล = ชื่อผู้ใช้ · ผู้ควบคุม = อีเมลที่ลงทะเบียนไว้</div>
      </div>
      <div class="form-row">
        <label class="form-label">รหัสผ่าน</label>
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
      this._bootHandled   = true;
      this._team          = r.supervisorName || '';
      this._role          = r.role;
      this._adminUsername = r.displayName || r.username;
      this.closeModal();
      this._enterApp();
    } catch {
      if (btn) { btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false; }
      this.toast('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
    }
  },

  _enterApp(autoPull = false) {
    document.querySelector('.topbar').style.display = '';
    const right = document.getElementById('topbarRight');
    if (right) {
      right.outerHTML = `<div id="topbarRight" class="tb-right">
        <a class="tb-link" href="../index.html">◈ เมนูหลัก</a>
        <span class="tb-sep">|</span>
        <span class="tb-user">
          ${this._isAdmin() ? '🔐' : this._isStaff() ? '🧑‍💼' : '👤'} ${this.esc(this._canManage() ? this._adminUsername : this._surveyorName)}${this._isStaff() ? ' · ผู้ควบคุม' : ''}
        </span>
        <button class="tb-logout" onclick="App.logout()">ออก</button>
      </div>`;
    }
    this.navigate('home');
    if (autoPull) this._silentPull();
  },

  async _silentPull() {
    // throttle: ไม่ดึงซ้ำถ้าเพิ่งดึงไปภายใน 5 นาที (กัน Firestore quota)
    const THROTTLE_MS = 5 * 60 * 1000;
    const last = +localStorage.getItem('_is_ri_last_auto_pull') || 0;
    if (Date.now() - last < THROTTLE_MS) return;
    try {
      if (typeof firebase === 'undefined') return;
      if (!FB.db) FB.init();
      if (!FB.db) return;
      const count = await this._pullScoped();
      localStorage.setItem('_is_ri_last_auto_pull', String(Date.now()));
      this.toast(`☁️ โหลดจุดสำรวจแล้ว ${count} จุด`, 'success');
      this.render();
    } catch { /* silent — ไม่แสดง error ถ้า offline */ }
  },

  logout() {
    if (!confirm('ออกจากระบบ?')) return;
    if (this._canManage()) FB.logoutAdmin().catch(() => {});
    Role.clear();
    this._team = '';
    this._bootHandled = false;
    this._role = null;
    this._surveyorName = '';
    this._adminUsername = '';
    const right = document.getElementById('topbarRight');
    if (right) right.outerHTML = `<a class="tb-link" id="topbarRight" href="../index.html">◈ เมนูหลัก</a>`;
    this._showLoginGate();
  },

  navigate(page, stId, ivId) {
    // เปลี่ยนจุดสำรวจ → รีเซ็ตตัวกรองหน้ารายการสำรวจ (แต่ละจุดเริ่มใหม่)
    if (stId !== undefined && stId !== this.stId) { this._filterStatus = 'all'; this._filterName = ''; }
    this.page = page;
    if (stId !== undefined) this.stId = stId;
    if (ivId !== undefined) this.ivId = ivId;
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goBack() {
    if (this.page === 'wizard') { this._wizardPrev(); }
    else if (this.page === 'interview') this.navigate('station');
    else this.navigate('home');
  },

  render() {
    const app  = document.getElementById('app');
    const back = document.getElementById('backBtn');
    const bc   = document.getElementById('breadcrumb');
    back.style.display = this.page === 'home' ? 'none' : 'block';

    if (this.page === 'wizard') {
      bc.className = 'breadcrumb';
      const _firstStep = this._wizardDirection ? 2 : 1;
      back.style.display = (!this._wizardDone && this.wizardStep > _firstStep) ? 'block' : 'none';
      app.innerHTML = this._wizardDone ? this._wDoneScreen() : this.pageWizard();
      return;
    }

    if (this.page === 'home') {
      bc.className = 'breadcrumb';
      app.innerHTML = this.pageHome();
    } else if (this.page === 'station') {
      const st = DB.getStation(this.stId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ${st ? (this.esc(st.stationName) || st.id) : ''}`;
      app.innerHTML = this.pageStation();
    } else if (this.page === 'interview') {
      const st = DB.getStation(this.stId);
      const iv = DB.getInterview(this.stId, this.ivId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span>
        <a onclick="App.navigate('station','${this.stId}')">${st ? (this.esc(st.stationName) || st.id) : ''}</a>
        <span>›</span> การสำรวจที่ ${iv ? iv.seq : ''}`;
      app.innerHTML = this.pageInterview();
    } else if (this.page === 'trash') {
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ถังขยะ`;
      app.innerHTML = this.pageTrash();
    }
  },

  // ===================== PAGE: ถังขยะ (admin) =====================
  pageTrash() {
    if (!this._isAdmin()) return `<div class="page container"><p>เฉพาะผู้ดูแลระบบ</p></div>`;
    const items = DB.getTrash();
    return `<div class="page container">
      <div class="sec-header">
        <div>
          <div class="sec-title">🗑 ถังขยะ</div>
          <div class="sec-sub">${items.length} รายการที่ลบออกจากระบบ · กู้คืนได้ทุกเมื่อ</div>
        </div>
      </div>
      ${items.length === 0
        ? `<div class="empty"><div class="empty-icon">✨</div><p>ถังขยะว่าง</p></div>`
        : items.map(it => `
          <div class="st-card" style="border-left:3px solid var(--danger)">
            <div class="st-card-main">
              <div class="st-card-title">${this.esc(it.label)}</div>
              <div class="st-card-sub">${this.esc(it.sub)}</div>
              <div class="st-card-sub" style="font-size:12px;color:var(--gray-500)">
                ลบเมื่อ ${it.at ? new Date(it.at).toLocaleString('th-TH') : '—'}${it.by ? ' · โดย ' + this.esc(it.by) : ''}
              </div>
            </div>
            <button class="btn btn-primary btn-sm"
              onclick="App.restoreItem('${it.kind}','${it.stId}','${it.ivId || ''}')">↩ กู้คืน</button>
          </div>`).join('')}
    </div>`;
  },

  restoreItem(kind, stId, ivId) {
    const entity = kind === 'station' ? DB.restoreStation(stId) : DB.restoreInterview(stId, ivId);
    if (!entity) { this.toast('ไม่พบรายการ', 'error'); return; }
    // ส่ง flag กู้คืนขึ้น cloud ทันที
    if (kind === 'station') this._autoPush(() => FB.pushStation(entity));
    else                    this._autoPush(() => FB.pushInterview(stId, entity));
    this.toast('กู้คืนแล้ว', 'success');
    this.render();
  },

  // ===================== UTIL =====================
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
    if (sec < 30)        return 'เมื่อกี้นี้';
    if (sec < 60)        return `${sec} วินาทีที่แล้ว`;
    const min = Math.floor(sec / 60);
    if (min < 60)        return `${min} นาทีที่แล้ว`;
    const hr = Math.floor(min / 60);
    if (hr < 24)         return `${hr} ชม.ที่แล้ว`;
    const day = Math.floor(hr / 24);
    if (day < 7)         return `${day} วันที่แล้ว`;
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

  // interview นี้พิมพ์ชื่อสถานที่เองโดยไม่มีพิกัด (ไม่ได้เลือกหมุด/ค้นหาจนพบ) หรือไม่
  _ivPlaceManual(iv) {
    if (!iv) return false;
    const originManual = !!iv.originName      && !iv.originCoords;
    const destManual   = !!iv.destinationName && !iv.destinationCoords;
    return originManual || destManual;
  },




  // ===================== PAGE: HOME =====================
  pageHome() {
    const isAdmin  = this._isAdmin();
    const seesAll  = this._canManage();   // admin + staff เห็นงานของทุกคนในขอบเขตตัวเอง
    const allSts   = this._visibleStations(DB.getStations());
    const mySts    = seesAll ? allSts : allSts.filter(s => s.surveyorName === this._surveyorName);
    const otherSts = seesAll ? [] : allSts.filter(s => s.surveyorName !== this._surveyorName);
    const ivCount  = seesAll
      ? allSts.reduce((s, st) => s + st.interviews.length, 0)
      : allSts.reduce((s, st) => s + st.interviews.filter(iv => iv.surveyorName === this._surveyorName).length, 0);

    // กรอง "พิกัดไม่ครบ" — จุดที่มี interview ต้นทาง/ปลายทางไม่มีพิกัด (รอไปแก้)
    const stNoCoord = st => (seesAll ? st.interviews : st.interviews.filter(iv => iv.surveyorName === this._surveyorName))
      .some(iv => !iv.originCoords || !iv.destinationCoords);
    const noCoordSts = mySts.filter(stNoCoord);
    const shownMy    = this._filterNoCoords ? noCoordSts : mySts;

    const stationCard = (st, isMine) => {
      const dirTag  = st.direction ? `<span class="tag tag-orange">↔ ${st.direction}</span>` : '';
      // นับเฉพาะ interview ของตัวเอง (ไม่นับของคนอื่น)
      const relIvs  = seesAll ? st.interviews : st.interviews.filter(iv => iv.surveyorName === this._surveyorName);
      const myCount = relIvs.length;
      // มี interview ที่พิมพ์ชื่อสถานที่เอง (ไม่ได้เลือกหมุด/ค้นหาจนพบ → ไม่มีพิกัด) → การ์ดขึ้นสีแดง
      const manualPlace = relIvs.some(iv => this._ivPlaceManual(iv));
      if (isMine) {
        return `<div class="hh-card${manualPlace ? ' hh-card-incomplete' : ''}" onclick="App.navigate('station','${st.id}')">
          <div class="hh-card-icon">🚦</div>
          <div class="hh-card-body">
            <div class="hh-card-id">${this.esc(st.stationName) || 'ไม่ระบุชื่อจุด'}</div>
            <div class="hh-card-addr">${this.esc([st.road, st.district, st.province].filter(Boolean).join(' · ')) || 'ไม่ระบุสถานที่'}</div>
            <div class="hh-card-tags">
              ${manualPlace ? '<span class="tag" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;">⚠️ พิกัดไม่ครบ (พิมพ์เอง)</span>' : ''}
              <span class="tag tag-green">📋 ${myCount} ราย</span>
              ${dirTag}
              <span class="tag tag-gray">📅 ${st.surveyDate}</span>
            </div>
          </div>
          <div class="hh-card-arrow">›</div>
        </div>`;
      } else {
        return `<div class="hh-card" onclick="App.navigate('station','${st.id}')"
          style="opacity:.75;">
          <div class="hh-card-icon" style="background:var(--gray-100);border-color:var(--gray-200);">🚦</div>
          <div class="hh-card-body">
            <div class="hh-card-id">${this.esc(st.stationName) || 'ไม่ระบุชื่อจุด'}</div>
            <div class="hh-card-addr">${this.esc([st.road, st.district, st.province].filter(Boolean).join(' · ')) || 'ไม่ระบุสถานที่'}</div>
            <div class="hh-card-tags">
              ${dirTag}
              <span class="tag tag-gray">📅 ${st.surveyDate}</span>
              <span class="tag tag-gray">👤 ${this.esc(st.surveyorName) || 'ไม่ระบุ'}</span>
            </div>
          </div>
          <div class="hh-card-arrow" style="font-size:12px;color:var(--gray-400);">ดู</div>
        </div>`;
      }
    };

    return `<div class="page container">
      <div class="dash-hero">
        <div class="dash-hero-text">
          <h1>🚦 Roadside Interview</h1>
          <p>โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</p>
        </div>
        <div class="dash-stats">
          <div class="dash-stat"><div class="dash-stat-val">${mySts.length}</div><div class="dash-stat-lbl">${seesAll ? 'จุดสำรวจ' : 'จุดของฉัน'}</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${ivCount}</div><div class="dash-stat-lbl">การสำรวจ</div></div>
          ${!isAdmin && otherSts.length > 0 ? `<div class="dash-stat"><div class="dash-stat-val">${otherSts.length}</div><div class="dash-stat-lbl">จุดอื่น</div></div>` : ''}
        </div>
      </div>


      <div class="sec-header">
        <div>
          <div class="sec-title">รายการจุดสำรวจ</div>
          <div class="sec-sub">พบ ${allSts.length} จุดสำรวจ${this._isStaff() ? ` (ทีม ${this.esc(this._team)})` : !isAdmin ? ` · ของฉัน ${mySts.length} จุด` : ''} · ${this._syncBadge()}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${noCoordSts.length > 0 ? `<button class="btn btn-sm ${this._filterNoCoords ? 'btn-danger' : 'btn-ghost'}" onclick="App.toggleNoCoords()">📍 พิกัดไม่ครบ ${noCoordSts.length}</button>` : ''}
          ${this._canManage() && allSts.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="App.exportData()">⬇ Export Excel</button>` : ''}
          ${isAdmin ? (() => { const n = DB.getTrash().length;
            return `<button class="btn btn-ghost btn-sm" onclick="App.navigate('trash')">🗑 ถังขยะ${n ? ` (${n})` : ''}</button>`; })() : ''}
          ${allSts.length > 0 ? `<button class="btn btn-ghost btn-sm" id="syncBtn" onclick="App.syncToCloud()">☁️ Sync</button>` : ''}
          ${isAdmin && allSts.length > 0 ? `<button class="btn btn-danger btn-sm" onclick="App.confirmClearAll()">🗑 ล้างข้อมูล</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูล</button>
          ${this._canManage() ? `<button class="btn btn-primary" onclick="App.goProjectTools()">🧰 จัดการจุดสำรวจ</button>` : ''}
        </div>
      </div>

      ${allSts.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🚦</span>
          <h3>ยังไม่มีจุดสำรวจ</h3>
          <p>${this._canManage() ? 'สร้างจุดสำรวจได้ที่หน้า Dashboard ของโครงการ → เครื่องมือโครงการ → จุดสำรวจ' : 'กด "ดึงข้อมูล" เพื่อโหลดจุดสำรวจที่ผู้ดูแลสร้างไว้'}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            ${this._canManage() ? `<button class="btn btn-primary" onclick="App.goProjectTools()">🧰 ไปเพิ่มจุดสำรวจ</button>` : ''}
            <button class="btn btn-ghost" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูลจาก Firebase</button>
          </div>
        </div>` :
        (this._filterNoCoords && shownMy.length === 0 ? `
        <div class="empty"><span class="empty-icon">✅</span><h3>พิกัดครบทุกจุดแล้ว</h3>
          <p>ไม่มีจุดที่พิกัดไม่ครบ</p>
          <button class="btn btn-ghost" onclick="App.toggleNoCoords()">← กลับไปดูทั้งหมด</button></div>` : `
        <div class="hh-list">
          ${shownMy.map(st => stationCard(st, true)).join('')}
          ${!this._filterNoCoords && otherSts.length > 0 ? `
            <div class="section-label" style="margin-top:18px;">จุดสำรวจอื่น (ดูได้อย่างเดียว)</div>
            ${otherSts.map(st => stationCard(st, false)).join('')}
          ` : ''}
        </div>`)}
    </div>`;
  },

  toggleNoCoords() {
    this._filterNoCoords = !this._filterNoCoords;
    this.render();
  },

  // ปุ่มสถานะแบบ segmented (ใช้ในหน้ารายการสำรวจ)
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

  // ===================== PAGE: STATION =====================
  pageStation() {
    const st = DB.getStationView(this.stId);   // view: ไม่รวมรายการที่ลบออกจากระบบแล้ว
    if (!st) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';
    const isAdmin = this._isAdmin();
    // surveyor เห็นเฉพาะ interview ของตัวเอง (กรองตาม surveyorName ระดับ interview)
    const myIvs   = isAdmin
      ? st.interviews
      : st.interviews.filter(iv => iv.surveyorName === this._surveyorName);

    // ── ตัวกรอง: สถานะ (สมบูรณ์=มีพิกัดต้นทาง+ปลายทางครบ) + ชื่อผู้สำรวจ ──
    const status = this._filterStatus || 'all';
    const nameQ  = (this._filterName || '').trim().toLowerCase();
    let ivs = myIvs;
    if (status === 'complete')        ivs = ivs.filter(iv => iv.originCoords && iv.destinationCoords);
    else if (status === 'incomplete') ivs = ivs.filter(iv => !iv.originCoords || !iv.destinationCoords);
    if (nameQ)                        ivs = ivs.filter(iv => (iv.surveyorName || '').toLowerCase().includes(nameQ));
    // ใหม่สุดอยู่บน
    ivs = ivs.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return `<div class="page container">
      <div class="hh-detail-header">
        <div class="hh-detail-icon">🚦</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">${this.esc(st.stationName) || 'ไม่ระบุชื่อจุด'}</div>
          <div class="hh-detail-addr">${this.esc([st.road, st.district, st.province].filter(Boolean).join(' · '))}</div>
          <div class="hh-detail-tags">
            ${st.direction     ? `<span class="tag tag-orange">↔ ${st.direction}</span>`              : ''}
            ${st.stationCode   ? `<span class="tag tag-gray">รหัส: ${st.stationCode}</span>`           : ''}
            <span class="tag tag-gray">📅 ${st.surveyDate}</span>
            ${st.surveyorName  ? `<span class="tag tag-gray">🧑‍💼 ${this.esc(st.surveyorName)}</span>`          : ''}
            ${st.supervisorName? `<span class="tag tag-gray">👔 ${this.esc(st.supervisorName)}</span>`           : ''}
            ${st.coordinates   ? `<span class="tag tag-blue">📍 ${st.coordinates}</span>`              : ''}
          </div>
        </div>
        ${isAdmin ? `<div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openEditStation('${st.id}')">✏️ แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteStation('${st.id}')">ลบ</button>
        </div>` : ''}
      </div>

      <div class="sec-header">
        <div>
          <div class="sec-title">รายการการสำรวจ${!isAdmin ? ' (ของฉัน)' : ''}</div>
          <div class="sec-sub">บันทึกทุกคัน/ทุกคนที่หยุดสำรวจ · พบ ${myIvs.length} ราย · ${this._syncBadge()}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูล</button>
          <button class="btn btn-ghost btn-sm" id="syncBtn" onclick="App.syncToCloud()">☁️ Sync</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmClearAll()">🗑 ล้างข้อมูล</button>
          <button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มการสำรวจ</button>
        </div>
      </div>

      ${myIvs.length > 0 ? `
      <div style="background:#fefce8;border:1.5px solid #d97706;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;color:#92400e;font-weight:600;">✅ บันทึกแล้ว ${myIvs.length} ราย</div>
        <button class="btn btn-primary btn-sm" onclick="App.openWizard()" style="white-space:nowrap;">+ เพิ่มรายถัดไป</button>
      </div>` : ''}

      ${myIvs.length > 0 ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
        <div style="display:inline-flex;gap:2px;background:var(--gray-100);padding:3px;border-radius:8px;flex-shrink:0;">
          ${this._segBtn('ทั้งหมด','all')}${this._segBtn('✅ สมบูรณ์','complete')}${this._segBtn('⚠️ ไม่สมบูรณ์','incomplete')}
        </div>
        ${isAdmin ? `<input id="flt_name" value="${this.esc(this._filterName || '')}" oninput="App.setNameFilter(this.value)"
          placeholder="🔍 ค้นหาชื่อผู้สำรวจ" autocomplete="off"
          style="flex:1;min-width:150px;padding:8px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-family:inherit;font-size:14px;background:var(--white);color:var(--gray-800);" />` : ''}
      </div>` : ''}

      ${myIvs.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">📋</span>
          <h3>ยังไม่มีข้อมูลการสำรวจ${!isAdmin ? 'ของคุณ' : ''}</h3>
          <p>เพิ่มข้อมูลยานพาหนะ / ผู้เดินทางที่ถูกสัมภาษณ์</p>
          <button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มการสำรวจ</button>
        </div>` :
        (ivs.length === 0 ? `
        <div class="empty"><span class="empty-icon">🔍</span><h3>ไม่พบรายการตามตัวกรอง</h3>
          <p>ลองปรับตัวกรอง หรือล้างตัวกรอง</p>
          <button class="btn btn-ghost" onclick="App.resetFilters()">ล้างตัวกรอง</button></div>` :
        `<div class="member-list">${ivs.map(iv => {
          const vt = OPT.vehicleTypes.find(v => v.key === iv.vehicleType) || { icon: '🚘', label: iv.vehicleType || 'ไม่ระบุ' };
          const dotCls = (iv.originName && iv.destinationName && iv.purpose) ? 'dot-green' : (iv.originName || iv.destinationName) ? 'dot-amber' : 'dot-gray';
          return `<div class="member-card" onclick="App.navigate('interview','${st.id}','${iv.id}')">
            <div class="member-avatar av-o" style="font-size:20px;">${vt.icon}</div>
            <div class="member-info">
              <div class="member-name">รายที่ ${iv.seq} · ${vt.label}</div>
              <div class="member-detail">${iv.originName && iv.destinationName ? this.esc(iv.originName) + ' → ' + this.esc(iv.destinationName) : 'ยังไม่กรอกข้อมูล'}</div>
              <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">👤 ผู้สำรวจ: ${this.esc(iv.surveyorName) || 'ไม่ระบุ'}</div>
            </div>
            <div class="member-right">
              ${iv.interviewDate ? `<span class="tag tag-gray">📅 ${iv.interviewDate}</span>` : ''}
              ${iv.interviewTime ? `<span class="tag tag-gray">🕐 ${iv.interviewTime}</span>` : ''}
              <div class="status-dot ${dotCls}"></div>
              <span style="color:var(--gray-300)">›</span>
            </div>
          </div>`;
        }).join('')}</div>`)}
    </div>`;
  },

  // ===================== PAGE: INTERVIEW DETAIL =====================
  pageInterview() {
    const st = DB.getStation(this.stId);
    const iv = DB.getInterview(this.stId, this.ivId);
    if (!iv || iv._deleted) return '<div class="container"><p>ไม่พบข้อมูล (ถูกลบออกจากระบบแล้ว)</p></div>';
    const vt = OPT.vehicleTypes.find(v => v.key === iv.vehicleType) || { icon: '🚘', label: iv.vehicleType || '—' };
    const canEdit = this._canManage() || iv.surveyorName === this._surveyorName;

    const row = (label, val) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value ${val ? '' : 'info-empty'}">${this.esc(val) || '—'}</div>
      </div>`;

    return `<div class="page container">
      <div class="hh-detail-header" style="margin-bottom:20px;">
        <div class="member-avatar av-o" style="width:50px;height:50px;font-size:22px;border-radius:50%;flex-shrink:0;">${vt.icon}</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">รายที่ ${iv.seq} — ${vt.label}</div>
          <div class="hh-detail-addr">
            ${iv.interviewDate ? '📅 ' + iv.interviewDate : ''}
            ${iv.interviewTime ? ' · 🕐 ' + iv.interviewTime : ''}
            ${iv.travelDirection ? ' · ' + iv.travelDirection : ''}
            ${iv.surveyorName ? ' · 👤 ' + this.esc(iv.surveyorName) : ''}
          </div>
        </div>
        ${canEdit ? `<div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openInterviewForm('${iv.id}')">✏️ แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteInterview('${iv.id}')">ลบ</button>
        </div>` : ''}
      </div>

      <div class="card-box">
        <div class="card-box-title">🚗 ข้อมูลยานพาหนะ</div>
        <div class="info-grid">
          ${row('ประเภทยานพาหนะ', vt.icon + ' ' + vt.label)}
          ${iv.travelDirection ? row('ทิศทาง', iv.travelDirection) : ''}
          ${row('จำนวนผู้โดยสาร (รวมคนขับ)', iv.passengerCount ? iv.passengerCount + ' คน' : '')}
          ${row('เวลาสำรวจ', iv.interviewTime)}
        </div>
      </div>

      <div class="card-box">
        <div class="card-box-title">🗺️ ต้นทาง–ปลายทาง</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px;">
          <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;">
            <div style="font-size:11px;font-weight:700;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">▶ ต้นทาง</div>
            <div class="info-label">ประเภทสถานที่</div><div class="info-value ${iv.originType?'':'info-empty'}" style="margin-bottom:6px;">${iv.originType === 'อื่น ๆ' && iv.originTypeOther ? 'อื่น ๆ: ' + this.esc(iv.originTypeOther) : (iv.originType||'—')}</div>
            <div class="info-label">ชื่อสถานที่</div><div class="info-value ${iv.originName?'':'info-empty'}" style="margin-bottom:6px;">${this.esc(iv.originName)||'—'}</div>
            ${iv.originCoords ? `<div style="font-size:11px;color:var(--gray-400);">📍 ${iv.originCoords}</div>` : ''}
          </div>
          <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;">
            <div style="font-size:11px;font-weight:700;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">▶ ปลายทาง</div>
            <div class="info-label">ประเภทสถานที่</div><div class="info-value ${iv.destinationType?'':'info-empty'}" style="margin-bottom:6px;">${iv.destinationType === 'อื่น ๆ' && iv.destinationTypeOther ? 'อื่น ๆ: ' + this.esc(iv.destinationTypeOther) : (iv.destinationType||'—')}</div>
            <div class="info-label">ชื่อสถานที่</div><div class="info-value ${iv.destinationName?'':'info-empty'}" style="margin-bottom:6px;">${this.esc(iv.destinationName)||'—'}</div>
            ${iv.destinationCoords ? `<div style="font-size:11px;color:var(--gray-400);">📍 ${iv.destinationCoords}</div>` : ''}
          </div>
        </div>
        <div class="info-grid">
          ${row('วัตถุประสงค์', iv.purpose)}
        </div>
      </div>

      ${(iv.hasCargo || OPT.vehicleTypes.find(v=>v.key===iv.vehicleType)?.group==='truck') ? `
      <div class="card-box">
        <div class="card-box-title">📦 สินค้าที่บรรทุก</div>
        <div class="info-grid">
          ${row('มีสินค้า', iv.hasCargo)}
          ${iv.hasCargo === 'มีสินค้า' ? row('ชนิดสินค้า', iv.cargoType === 'อื่น ๆ (ระบุ)' && iv.cargoTypeOther ? 'อื่น ๆ: ' + iv.cargoTypeOther : iv.cargoType) : ''}
          ${iv.hasCargo === 'มีสินค้า' && iv.cargoWeight ? row('น้ำหนัก', iv.cargoWeight + ' กก.') : ''}
        </div>
      </div>` : ''}

      ${iv.driverIncome ? `
      <div class="card-box">
        <div class="card-box-title">💰 รายได้</div>
        <div class="info-grid">
          ${row('รายได้ผู้ขับ (บาท/เดือน)', iv.driverIncome)}
        </div>
      </div>` : ''}

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-ghost" onclick="App.navigate('station','${this.stId}')">← กลับจุดสำรวจ</button>
        <button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มรายถัดไป</button>
      </div>
    </div>`;
  },

  // ===================== STATION FORM =====================
  _loadSurveyorNames() {
    return {
      surveyor:   localStorage.getItem('_is_ri_surveyor_name')   || '',
      supervisor: localStorage.getItem('_is_ri_supervisor_name') || ''
    };
  },
  _saveSurveyorNames(s, sv) {
    if (s)  localStorage.setItem('_is_ri_surveyor_name',   s);
    if (sv) localStorage.setItem('_is_ri_supervisor_name', sv);
  },

  _stationFormHTML(st) {
    const dirOpts = OPT.roadAxis.map(d =>
      `<option value="${d}" ${d === st?.direction ? 'selected' : ''}>${d}</option>`).join('');
    const names = this._loadSurveyorNames();

    return `
      <div class="section-label">ข้อมูลจุดสำรวจ</div>
      <div class="form-row">
        <label class="form-label req">รหัส / ชื่อจุดสำรวจ</label>
        <input id="s_stName" class="form-input" autocomplete="off" placeholder="เช่น MB01, MB02..."
          value="${st?.stationName||''}" />
      </div>
      <div class="form-row">
        <label class="form-label req">ผู้ควบคุม</label>
        ${(() => {
          const cur = st?.supervisorName || (this._isStaff() ? this._team : (names.supervisor || ''));
          if (this._isStaff())
            return `<input id="s_supervisor" class="form-input" value="${this.esc(this._team)}" readonly
                      style="background:var(--gray-100);" />
                    <div style="font-size:11px;color:var(--gray-400);margin-top:3px;">🔒 จากบัญชีที่เข้าสู่ระบบ</div>`;
          const empty = Supervisors.list().length === 0;
          return `<select id="s_supervisor" class="form-input">${Supervisors.optionsHTML(cur, x => this.esc(x))}</select>
                  ${empty ? '<div style="font-size:11px;color:var(--danger);margin-top:3px;">⚠ ยังไม่มีรายชื่อผู้ควบคุมในระบบ — ติดต่อผู้ดูแล</div>' : ''}`;
        })()}
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ถนน / ทางหลวง</label>
          <input id="s_road" class="form-input" autocomplete="off" placeholder="เช่น ทล.226"
            value="${st?.road||''}" />
        </div>
        <div class="form-row">
          <label class="form-label req">แกนถนน</label>
          <select id="s_direction" class="form-select">
            <option value="">— เลือก —</option>${dirOpts}
          </select>
        </div>
      </div>

      <div class="section-label">ตำแหน่งจุดสำรวจ</div>
      <div class="form-row">
        <label class="form-label req">พิกัด GPS</label>
        <div style="display:flex;gap:6px;">
          <input id="s_coords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${st?.coordinates||''}" />
          <button type="button" onclick="App._openStationMap()"
            style="padding:9px 12px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
          <button type="button" id="gpsBtn_s_coords" onclick="App._useGPS('s_coords')"
            style="padding:9px 10px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ตำบล</label>
          <input id="s_subdistrict" class="form-input" autocomplete="off" value="${st?.subdistrict||''}" placeholder="กด GPS เพื่อดึงอัตโนมัติ" />
        </div>
        <div class="form-row">
          <label class="form-label req">อำเภอ</label>
          <input id="s_district" class="form-input" autocomplete="off" value="${st?.district||''}" placeholder="กด GPS เพื่อดึงอัตโนมัติ" />
        </div>
        <div class="form-row">
          <label class="form-label req">จังหวัด</label>
          <input id="s_province" class="form-input" autocomplete="off" value="${st?.province||''}" placeholder="ขอนแก่น" />
        </div>
      </div>`;
  },

  _openStationMap() {
    const coordsEl = document.getElementById('s_coords');
    MapPicker.open(coordsEl?.value || '', coords => {
      if (coordsEl) coordsEl.value = coords;
      this._reverseGeocode(
        parseFloat(coords.split(',')[0]),
        parseFloat(coords.split(',')[1])
      );
    });
  },

  // เลือกประเภทสถานที่ = 'อื่น ๆ' → โชว์ช่อง "ระบุ" (ฟอร์ม interview)
  _onIvTypeOther(which) {
    const sel   = document.getElementById(which === 'origin' ? 'iv_originType' : 'iv_destType');
    const other = document.getElementById(which === 'origin' ? 'iv_originTypeOther' : 'iv_destTypeOther');
    if (!sel || !other) return;
    const show = sel.value === 'อื่น ๆ';
    other.style.display = show ? 'block' : 'none';
    if (show) other.focus(); else other.value = '';
  },

  // เลือกชนิดสินค้า = 'อื่น ๆ (ระบุ)' → โชว์ช่อง "ระบุ" (ฟอร์ม interview)
  _onIvCargoOther() {
    const sel   = document.getElementById('iv_cargoType');
    const other = document.getElementById('iv_cargoTypeOther');
    if (!sel || !other) return;
    const show = sel.value === 'อื่น ๆ (ระบุ)';
    other.style.display = show ? 'block' : 'none';
    if (show) other.focus(); else other.value = '';
  },

  // เปิดแผนที่สำหรับช่องพิกัดต้นทาง/ปลายทาง (ฟอร์ม interview — ทั้งบันทึกและแก้ไข)
  _openIvMap(coordsId, nameId) {
    const coordsEl = document.getElementById(coordsId);
    const nameEl = document.getElementById(nameId);
    MapPicker.open(coordsEl?.value || '', (coords, name) => {
      if (coordsEl) coordsEl.value = coords;
      // เติมชื่อสถานที่ให้ถ้าช่องยังว่าง (ไม่ทับชื่อที่กรอกไว้)
      if (nameEl && name && !nameEl.value.trim()) nameEl.value = name;
    });
  },

  _today() { return new Date().toISOString().split('T')[0]; },

  _readStationForm(existing) {
    return {
      surveyDate:     (existing && existing.surveyDate) || this._today(),
      stationName:    document.getElementById('s_stName')?.value.trim()      || '',
      stationCode:    document.getElementById('s_stName')?.value.trim()      || '',
      supervisorName: this._normName(document.getElementById('s_supervisor')?.value)  || '',
      road:           document.getElementById('s_road')?.value.trim()        || '',
      direction:      document.getElementById('s_direction')?.value          || '',
      coordinates:    document.getElementById('s_coords')?.value.trim()      || '',
      subdistrict:    document.getElementById('s_subdistrict')?.value.trim() || '',
      district:       document.getElementById('s_district')?.value.trim()    || '',
      province:       document.getElementById('s_province')?.value.trim()    || ''
    };
  },

  _validateStationForm(data) {
    const errs = [];
    if (!data.stationName) errs.push('รหัส/ชื่อจุดสำรวจ');
    if (!data.supervisorName) errs.push('ผู้ควบคุม');
    if (!data.road)        errs.push('ถนน/ทางหลวง');
    if (!data.direction)   errs.push('แกนถนน');
    if (!data.coordinates) errs.push('พิกัด GPS');
    if (!data.subdistrict) errs.push('ตำบล');
    if (!data.district)    errs.push('อำเภอ');
    if (!data.province)    errs.push('จังหวัด');
    return errs;
  },

  // จัดการจุดสำรวจย้ายไปอยู่ที่ Dashboard ของโครงการแล้ว (เป็นงานตั้งค่า ไม่ใช่งานหน้างาน)
  goProjectTools() {
    const pid = Project.id();
    location.href = '../Dashboard/' + (pid ? '?project=' + encodeURIComponent(pid) : '');
  },

  openAddStation() {
    // guard จริง — เดิมซ่อนแค่ปุ่ม เรียกจาก console ได้
    if (!this._canManage()) { this.toast('เฉพาะผู้ดูแลระบบ / ผู้ควบคุมเท่านั้น', 'error'); return; }
    this.showModal('🚦 เพิ่มจุดสำรวจใหม่', this._stationFormHTML(null),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveStation()">บันทึก</button>`
    );
    setTimeout(() => document.getElementById('s_sname')?.focus(), 50);
  },

  saveStation() {
    if (!this._canManage()) { this.toast('เฉพาะผู้ดูแลระบบ / ผู้ควบคุมเท่านั้น', 'error'); return; }
    const data = this._readStationForm();
    const errs = this._validateStationForm(data);
    if (errs.length) { this.toast('กรอกข้อมูลให้ครบ: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(null, data.supervisorName);
    const st = DB.addStation({
      ...data,
      deviceId: (typeof FB !== 'undefined' ? FB.deviceId() : null) || localStorage.getItem('_is_device_id') || '',
      clientIp: this._clientIp || ''
    });
    if (this._canManage()) this._autoPush(() => FB.pushStation(st));  // rules: ผู้สำรวจเขียน station ไม่ได้
    this.closeModal();
    this.toast('เพิ่มจุดสำรวจแล้ว', 'success');
    this.navigate('station', st.id);
  },

  openEditStation(id) {
    const st = DB.getStation(id);
    if (!st) return;
    this.showModal('✏️ แก้ไขข้อมูลจุดสำรวจ', this._stationFormHTML(st),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveEditStation('${id}')">บันทึก</button>`
    );
  },

  saveEditStation(id) {
    if (!this._canManage()) { this.toast('เฉพาะผู้ดูแลระบบ / ผู้ควบคุมเท่านั้น', 'error'); return; }
    const old = DB.getStation(id);
    const data = this._readStationForm(old);
    const errs = this._validateStationForm(data);
    if (errs.length) { this.toast('กรอกข้อมูลให้ครบ: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(null, data.supervisorName);
    const st = DB.updateStation(id, data);
    if (this._canManage()) this._autoPush(() => FB.pushStation(st));  // rules: ผู้สำรวจเขียน station ไม่ได้
    this.closeModal();
    this.toast('บันทึกข้อมูลจุดสำรวจแล้ว', 'success');
    this.render();
  },

  confirmDeleteStation(id) {
    const st = DB.getStation(id);
    this.showModal('🗑 ลบจุดสำรวจ',
      `<p style="color:var(--gray-600);">จะลบจุดสำรวจ <strong>${st?.stationName || st?.id}</strong>
       พร้อมข้อมูลการสำรวจ ${st?.interviews.length || 0} ราย</p>
       <div style="margin-top:14px;padding:12px;background:var(--gray-100);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;">🖥 ลบจากเครื่องนี้</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">ล้างแคชในเครื่อง · ข้อมูลบนระบบยังอยู่ ดึงกลับได้</div>
       </div>
       ${this._isAdmin() ? `
       <div style="margin-top:10px;padding:12px;background:rgba(239,68,68,.08);border:1px solid var(--danger);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;color:var(--danger);">☁️ ลบออกจากระบบ</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">
           จุดสำรวจและการสำรวจข้างในหายจากทุกที่ทันที<br>
           <b>เก็บไว้ในถังขยะ — กู้คืนได้ภายหลัง</b>
         </div>
       </div>` : ''}`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-ghost" style="color:var(--gray-700)" onclick="App.deleteStation('${id}')">🖥 ลบจากเครื่องนี้</button>
       ${this._isAdmin() ? `<button class="btn btn-danger" onclick="App.systemDeleteStation('${id}')">☁️ ลบออกจากระบบ</button>` : ''}`
    );
  },

  // ลบออกจากระบบ (soft delete) — ซ่อนทุกที่ + ส่งขึ้น cloud ทันที · กู้คืนได้จากถังขยะ
  systemDeleteStation(id) {
    if (!this._isAdmin()) { this.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }
    const st = DB.softDeleteStation(id, this._adminUsername || 'admin');
    if (!st) { this.toast('ไม่พบจุดสำรวจ', 'error'); return; }
    this._autoPush(() => FB.pushStation(st));
    this.closeModal();
    this.toast('ลบออกจากระบบแล้ว · กู้คืนได้จากถังขยะ', 'success');
    this.navigate('home');
  },

  deleteStation(id) {
    DB.deleteStation(id);
    this.closeModal();
    this.toast('ลบจุดสำรวจจากเครื่องนี้แล้ว · Cloud ยังอยู่', 'success');
    this.navigate('home');
  },

  // ===================== INTERVIEW FORM =====================
  openInterviewForm(ivId) {
    const st    = DB.getStation(this.stId);
    const iv    = ivId ? st?.interviews.find(x => x.id === ivId) : null;
    const isEdit = !!iv;

    const selOpt = (list, val) => list.map(o =>
      `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');

    const vtGroups = {
      personal: OPT.vehicleTypes.filter(v => v.group === 'personal'),
      bus:      OPT.vehicleTypes.filter(v => v.group === 'bus'),
      truck:    OPT.vehicleTypes.filter(v => v.group === 'truck')
    };
    const mkVtOpts = (arr) => arr.map(vt =>
      `<option value="${vt.key}" ${vt.key === iv?.vehicleType ? 'selected' : ''}>${vt.icon} ${vt.label}</option>`
    ).join('');
    const vtOpts = `
      <optgroup label="รถส่วนบุคคล (1–5)">${mkVtOpts(vtGroups.personal)}</optgroup>
      <optgroup label="รถโดยสาร (6–7)">${mkVtOpts(vtGroups.bus)}</optgroup>
      <optgroup label="รถบรรทุก (8–9)">${mkVtOpts(vtGroups.truck)}</optgroup>`;

    this.showModal('✏️ แก้ไขการสำรวจ', `
      <div class="section-label">ข้อมูลยานพาหนะ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ประเภทยานพาหนะ</label>
          <select id="iv_vtype" class="form-select">
            <option value="">— เลือก —</option>${vtOpts}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">เวลาสำรวจ</label>
          <input id="iv_time" class="form-input" type="time" value="${iv?.interviewTime||''}" />
        </div>
        <div class="form-row">
          <label class="form-label req">ผู้โดยสาร (รวมคนขับ)</label>
          <input id="iv_pax" class="form-input" type="number" min="1" inputmode="numeric"
            autocomplete="off" placeholder="เช่น 2" value="${iv?.passengerCount||''}" />
        </div>
      </div>

      ${(() => {
        const axis = st?.direction;
        const opts = OPT.directionsByAxis[axis];
        if (!opts) return '';
        return `<div class="section-label">ทิศทางของยานพาหนะคันนี้</div>
        <div class="form-row">
          <div class="radio-group">
            ${opts.map(d => `
              <div class="radio-opt ${iv?.travelDirection === d ? 'sel' : ''}"
                onclick="App._pickTravelDir('${d}',this)">
                <div class="radio-dot"></div>${d}
              </div>`).join('')}
          </div>
          <input type="hidden" id="iv_travelDir" value="${iv?.travelDirection||''}" />
        </div>`;
      })()}

      <div class="section-label">จุดต้นทาง</div>
      <div class="form-row">
        <label class="form-label req">ประเภทสถานที่ต้นทาง</label>
        <select id="iv_originType" class="form-select" onchange="App._onIvTypeOther('origin')">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, iv?.originType||'')}
        </select>
        <input id="iv_originTypeOther" class="form-input" autocomplete="off" placeholder="ระบุประเภทสถานที่ต้นทาง"
          style="margin-top:6px;display:${iv?.originType==='อื่น ๆ'?'block':'none'};" value="${iv?.originTypeOther||''}" />
      </div>
      <div class="form-row">
        <label class="form-label req">ชื่อสถานที่ต้นทาง</label>
        <input id="iv_origin" class="form-input" autocomplete="off"
          placeholder="ชื่อสถานที่หรือหมู่บ้าน" value="${iv?.originName||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">พิกัด GPS ต้นทาง</label>
        <div style="display:flex;gap:6px;">
          <input id="iv_originCoords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${iv?.originCoords||''}" />
          <button type="button" onclick="App._openIvMap('iv_originCoords','iv_origin')"
            style="padding:9px 12px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
        </div>
      </div>

      <div class="section-label">จุดปลายทาง</div>
      <div class="form-row">
        <label class="form-label req">ประเภทสถานที่ปลายทาง</label>
        <select id="iv_destType" class="form-select" onchange="App._onIvTypeOther('dest')">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, iv?.destinationType||'')}
        </select>
        <input id="iv_destTypeOther" class="form-input" autocomplete="off" placeholder="ระบุประเภทสถานที่ปลายทาง"
          style="margin-top:6px;display:${iv?.destinationType==='อื่น ๆ'?'block':'none'};" value="${iv?.destinationTypeOther||''}" />
      </div>
      <div class="form-row">
        <label class="form-label req">ชื่อสถานที่ปลายทาง</label>
        <input id="iv_dest" class="form-input" autocomplete="off"
          placeholder="ชื่อสถานที่หรือหมู่บ้าน" value="${iv?.destinationName||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">พิกัด GPS ปลายทาง</label>
        <div style="display:flex;gap:6px;">
          <input id="iv_destCoords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${iv?.destinationCoords||''}" />
          <button type="button" onclick="App._openIvMap('iv_destCoords','iv_dest')"
            style="padding:9px 12px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
        </div>
      </div>

      <div class="form-row">
        <label class="form-label req">วัตถุประสงค์การเดินทาง</label>
        <select id="iv_purpose" class="form-select">
          <option value="">— เลือก —</option>${selOpt(OPT.purpose, iv?.purpose||'')}
        </select>
      </div>

      <div class="section-label">สินค้าที่บรรทุก <span style="font-size:11px;font-weight:400;color:var(--gray-400);">(สำหรับรถบรรทุก)</span></div>
      <div class="form-row">
        <label class="form-label">มีสินค้า</label>
        <div class="radio-group" id="iv_cargoGrp">
          ${['ไม่มีสินค้า','มีสินค้า'].map(v => `
            <div class="radio-opt ${iv?.hasCargo === v ? 'sel' : ''}" onclick="App._pickCargo('${v}',this)">
              <div class="radio-dot"></div>${v}
            </div>`).join('')}
        </div>
        <input type="hidden" id="iv_hasCargo" value="${iv?.hasCargo||''}" />
      </div>
      <div id="iv_cargoDetail" style="display:${iv?.hasCargo==='มีสินค้า'?'block':'none'};">
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">ชนิดสินค้า</label>
            <select id="iv_cargoType" class="form-select" onchange="App._onIvCargoOther()">
              <option value="">— เลือก —</option>${selOpt(OPT.cargoTypes, iv?.cargoType||'')}
            </select>
            <input id="iv_cargoTypeOther" class="form-input" autocomplete="off" placeholder="ระบุชนิดสินค้า"
              style="margin-top:6px;display:${iv?.cargoType==='อื่น ๆ (ระบุ)'?'block':'none'};" value="${iv?.cargoTypeOther||''}" />
          </div>
          <div class="form-row">
            <label class="form-label">น้ำหนัก (กก.)</label>
            <input id="iv_cargoWeight" class="form-input" type="number" min="0"
              inputmode="numeric" autocomplete="off" placeholder="เช่น 5000"
              value="${iv?.cargoWeight||''}" />
          </div>
        </div>
      </div>

      <div class="section-label">รายได้ผู้ขับ (บาท/เดือน)</div>
      <div class="form-row">
        <input id="iv_income" class="form-input" type="number" min="0" inputmode="numeric"
          placeholder="เช่น 15000 (เว้นว่างได้)" value="${iv?.driverIncome||''}" />
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveInterview('${iv.id}')">บันทึกการแก้ไข</button>`
    );
    setTimeout(() => document.getElementById('iv_vtype')?.focus(), 50);
  },

  _pickTravelDir(val, el) {
    el.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('iv_travelDir');
    if (h) h.value = val;
  },

  _pickCargo(val, el) {
    document.getElementById('iv_cargoGrp').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('iv_hasCargo');
    if (h) h.value = val;
    const detail = document.getElementById('iv_cargoDetail');
    if (detail) detail.style.display = val === 'มีสินค้า' ? 'block' : 'none';
  },

  saveInterview(ivId) {
    if (!ivId) { this.toast('การเพิ่มใหม่ทำผ่าน wizard เท่านั้น', 'error'); return; }
    const data = {
      vehicleType:          document.getElementById('iv_vtype')?.value         || '',
      interviewTime:        document.getElementById('iv_time')?.value          || '',
      passengerCount:       +(document.getElementById('iv_pax')?.value)        || '',
      travelDirection:      document.getElementById('iv_travelDir')?.value     || '',
      originType:           document.getElementById('iv_originType')?.value    || '',
      originTypeOther:      document.getElementById('iv_originTypeOther')?.value.trim() || '',
      originName:           document.getElementById('iv_origin')?.value.trim() || '',
      originCoords:         document.getElementById('iv_originCoords')?.value.trim() || '',
      destinationType:      document.getElementById('iv_destType')?.value      || '',
      destinationTypeOther: document.getElementById('iv_destTypeOther')?.value.trim() || '',
      destinationName:      document.getElementById('iv_dest')?.value.trim()   || '',
      destinationCoords:    document.getElementById('iv_destCoords')?.value.trim() || '',
      purpose:              document.getElementById('iv_purpose')?.value       || '',
      hasCargo:             document.getElementById('iv_hasCargo')?.value      || '',
      cargoType:            document.getElementById('iv_cargoType')?.value     || '',
      cargoTypeOther:       document.getElementById('iv_cargoTypeOther')?.value.trim() || '',
      cargoWeight:          document.getElementById('iv_cargoWeight')?.value   || '',
      driverIncome:         document.getElementById('iv_income')?.value        || ''
    };
    // validation
    const errs = [];
    if (!data.vehicleType)     errs.push('ประเภทยานพาหนะ');
    if (!data.passengerCount)  errs.push('ผู้โดยสาร');
    if (!data.originType)      errs.push('ประเภทต้นทาง');
    if (data.originType === 'อื่น ๆ' && !data.originTypeOther) errs.push('ระบุประเภทต้นทาง (อื่น ๆ)');
    if (!data.originName)      errs.push('ชื่อต้นทาง');
    if (!data.destinationType) errs.push('ประเภทปลายทาง');
    if (data.destinationType === 'อื่น ๆ' && !data.destinationTypeOther) errs.push('ระบุประเภทปลายทาง (อื่น ๆ)');
    if (!data.destinationName) errs.push('ชื่อปลายทาง');
    if (!data.purpose)         errs.push('วัตถุประสงค์');
    if (data.hasCargo === 'มีสินค้า' && data.cargoType === 'อื่น ๆ (ระบุ)' && !data.cargoTypeOther) errs.push('ระบุชนิดสินค้า (อื่น ๆ)');
    if (errs.length) { this.toast('กรอกข้อมูลให้ครบ: ' + errs.join(', '), 'error'); return; }

    const iv = DB.updateInterview(this.stId, ivId, data);
    this._autoPush(() => FB.pushInterview(this.stId, iv));
    this.toast('แก้ไขการสำรวจแล้ว', 'success');
    this.closeModal();
    this.navigate('station', this.stId);
  },

  confirmDeleteInterview(ivId) {
    const iv = DB.getInterview(this.stId, ivId);
    this.showModal('🗑 ลบการสำรวจจากเครื่องนี้',
      `<p style="color:var(--gray-600);">จะลบการสำรวจรายที่ ${iv?.seq}</p>
       <div style="margin-top:14px;padding:12px;background:var(--gray-100);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;">🖥 ลบจากเครื่องนี้</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">ล้างแคชในเครื่อง · ข้อมูลบนระบบยังอยู่ ดึงกลับได้</div>
       </div>
       ${this._isAdmin() ? `
       <div style="margin-top:10px;padding:12px;background:rgba(239,68,68,.08);border:1px solid var(--danger);border-radius:8px;">
         <div style="font-weight:700;font-size:13px;color:var(--danger);">☁️ ลบออกจากระบบ</div>
         <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">
           หายจากรายการ · กราฟ · Export ทุกที่ทันที (ทุกเครื่อง)<br>
           <b>เก็บไว้ในถังขยะ — กู้คืนได้ภายหลัง</b>
         </div>
       </div>` : ''}`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-ghost" style="color:var(--gray-700)" onclick="App.deleteInterview('${ivId}')">🖥 ลบจากเครื่องนี้</button>
       ${this._isAdmin() ? `<button class="btn btn-danger" onclick="App.systemDeleteInterview('${ivId}')">☁️ ลบออกจากระบบ</button>` : ''}`
    );
  },

  deleteInterview(ivId) {
    DB.deleteInterview(this.stId, ivId);
    this.closeModal();
    this.toast('ลบจากเครื่องนี้แล้ว · Cloud ยังอยู่', 'success');
    this.navigate('station', this.stId);
  },

  // ลบออกจากระบบ (soft delete) — ซ่อนทุกที่ + ส่งขึ้น cloud ทันที · กู้คืนได้จากถังขยะ
  systemDeleteInterview(ivId) {
    if (!this._isAdmin()) { this.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }
    const iv = DB.softDeleteInterview(this.stId, ivId, this._adminUsername || 'admin');
    if (!iv) { this.toast('ไม่พบการสำรวจ', 'error'); return; }
    this._autoPush(() => FB.pushInterview(this.stId, iv));
    this.closeModal();
    this.toast('ลบออกจากระบบแล้ว · กู้คืนได้จากถังขยะ', 'success');
    this.navigate('station', this.stId);
  },

  // ===================== WIZARD =====================
  openWizard() {
    this._wizardDone = false;
    this._paxCustom = false;
    // กดเพิ่มจากหน้าจุดสำรวจ → ถามทิศใหม่เสมอ
    // (เฉพาะปุ่ม "รถคันถัดไป" บน done screen ที่จะใช้ทิศเดิมผ่าน _wizardNextCar)
    this._wizardDirection = null;
    this.wizardData = { originType:'', originTypeOther:'', originCoords:'', originLandmark:'', destType:'', destTypeOther:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoTypeOther:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = 1;
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wizardCancel() {
    // ถ้ายังไม่ได้บันทึก + มีข้อมูลที่กรอกแล้ว → confirm ก่อน
    if (!this._wizardDone && this._wizardHasInput()) {
      if (!confirm('ข้อมูลที่กรอกจะหายไป ต้องการออกจาก wizard ใช่หรือไม่?')) return;
    }
    this.navigate('station', this.stId);
  },

  _wizardHasInput() {
    const wd = this.wizardData || {};
    return !!(wd.vehicleType || wd.passengerCount || wd.originType ||
      wd.originLandmark || wd.originCoords || wd.destType ||
      wd.destLandmark || wd.destCoords || wd.purpose || wd.hasCargo);
  },

  _wIsTruck() {
    return OPT.vehicleTypes.find(v => v.key === this.wizardData?.vehicleType)?.group === 'truck';
  },
  // total steps ไม่นับ step ทิศถ้าทิศถูกตั้งแล้ว
  _wTotalSteps() { return (this._wizardDirection ? 0 : 1) + (this._wIsTruck() ? 7 : 6); },
  // step ที่แสดงให้ user เห็น (ไม่นับ step ทิศถ้าข้ามไปแล้ว)
  _wStepDisplay() { return this._wizardDirection ? this.wizardStep - 1 : this.wizardStep; },

  _wizardNext() {
    // purpose(6) + non-truck → ข้าม cargo ไป income(8)
    if (this.wizardStep === 6 && !this._wIsTruck()) { this.wizardStep = 8; }
    else { this.wizardStep++; }
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wizardPrev() {
    if (this._wizardDone) { this._wizardCancel(); return; }
    // income(8) + non-truck → ย้อนไป purpose(6) ข้าม cargo
    if (this.wizardStep === 8 && !this._wIsTruck()) { this.wizardStep = 6; }
    // vehicle(2) + direction ตั้งแล้ว → cancel (ไม่ย้อนกลับไป direction อีก)
    else if (this.wizardStep <= 1 || (this.wizardStep === 2 && this._wizardDirection)) { this._wizardCancel(); return; }
    else { this.wizardStep--; }
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wHeader(title, sub) {
    const step = this._wStepDisplay();
    const total = this._wTotalSteps();
    const pct = Math.round(step / total * 100);
    return `
      <div class="wiz-progress"><div class="wiz-progress-fill" style="width:${pct}%"></div></div>
      <div class="wiz-body">
        <div class="wiz-meta">
          <span class="wiz-step-label">คำถาม ${step} / ${total}</span>
          <button class="wiz-cancel-btn" onclick="App._wizardCancel()">ยกเลิก</button>
        </div>
        <div class="wiz-question">${title}</div>
        ${sub ? `<div class="wiz-sub">${sub}</div>` : ''}`;
  },
  _wFooter() { return `</div>`; },

  pageWizard() {
    switch (this.wizardStep) {
      case 1: return this._wStep1Direction();
      case 2: return this._wStep2Vehicle();
      case 3: return this._wStep3Passengers();
      case 4: return this._wStep4Origin();
      case 5: return this._wStep5Dest();
      case 6: return this._wStep6Purpose();
      case 7: return this._wStep7Cargo();
      case 8: return this._wStep8Income();
      default: return '';
    }
  },

  // Step 1: ทิศทาง (แสดงเฉพาะตอนยังไม่ตั้ง)
  _wStep1Direction() {
    const st = DB.getStation(this.stId);
    const opts = OPT.directionsByAxis[st?.direction] || ['มุ่งทิศเหนือ','มุ่งทิศใต้','มุ่งทิศตะวันออก','มุ่งทิศตะวันตก'];
    const icons = { 'มุ่งทิศเหนือ':'⬆️','มุ่งทิศใต้':'⬇️','มุ่งทิศตะวันออก':'➡️','มุ่งทิศตะวันตก':'⬅️' };
    const cards = opts.map(d => `
      <div class="wiz-card dir" onclick="App._wPickDirection('${d}', this)">
        <div class="wiz-card-icon">${icons[d]||'↕'}</div>
        <div class="wiz-card-label">${d}</div>
      </div>`).join('');
    return this._wHeader('คุณประจำฝั่งไหน?', 'ระบบจะจำไว้ใช้กับทุกคันถัดไป') +
      `<div class="wiz-grid wiz-grid-2">${cards}</div>` + this._wFooter();
  },
  _wPickDirection(val, el) {
    this._confirmPick(el, () => { this._wizardDirection = val; this._wizardNext(); });
  },

  // animate การเลือก: zoom 450ms ก่อนเปลี่ยน step
  _confirmPick(el, action) {
    if (!el) { action(); return; }
    el.classList.add('confirming');
    setTimeout(action, 450);
  },

  // Step 2: ประเภทรถ
  _wStep2Vehicle() {
    const cards = OPT.vehicleTypes.map(vt => `
      <div class="wiz-card veh ${this.wizardData.vehicleType === vt.key ? 'sel' : ''}"
        onclick="App._wPickVehicle('${vt.key}', this)">
        <div class="wiz-card-icon">${vt.icon}</div>
        <div class="wiz-card-label">${vt.label}</div>
      </div>`).join('');
    return this._wHeader('ประเภทยานพาหนะ') +
      `<div class="wiz-grid wiz-grid-3">${cards}</div>` + this._wFooter();
  },
  _wPickVehicle(key, el) {
    this._confirmPick(el, () => { this.wizardData.vehicleType = key; this._wizardNext(); });
  },

  // Step 2: จำนวนคน
  _wStep3Passengers() {
    const nums = [1,2,3,4,5,6,7,8,9,10];
    const pc = this.wizardData.passengerCount;
    const isCustom = this._paxCustom || (pc !== '' && +pc > 10);
    const btns = nums.map(n => `
      <button class="wiz-num-btn ${pc === n ? 'sel' : ''}"
        onclick="App._wPickPax(${n}, this)">${n}</button>`).join('');
    return this._wHeader('จำนวนคนในรถ', 'รวมคนขับ') +
      `<div class="wiz-num-grid">${btns}</div>
       <button class="wiz-num-btn ${isCustom ? 'sel' : ''}"
         onclick="App._wPaxMore()" style="width:100%;font-size:18px;">มากกว่า 10 คน</button>
       ${isCustom ? `
         <div style="margin-top:14px;">
           <label class="form-label">ระบุจำนวนคน (มากกว่า 10)</label>
           <input id="wiz_paxCustom" class="form-input" type="number" min="11" inputmode="numeric"
             placeholder="เช่น 15" value="${(pc !== '' && +pc > 10) ? pc : ''}"
             style="font-size:22px;padding:18px;text-align:center;" />
           <div class="wiz-bottom"><div class="wiz-bottom-row">
             <button class="btn btn-primary btn-block" onclick="App._wPaxCustomNext()">ถัดไป →</button>
           </div></div>
         </div>` : ''}` +
      this._wFooter();
  },
  _wPickPax(n, el) {
    this._paxCustom = false;
    this._confirmPick(el, () => { this.wizardData.passengerCount = n; this._wizardNext(); });
  },
  _wPaxMore() {
    this._paxCustom = true;
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },
  _wPaxCustomNext() {
    const val = +(document.getElementById('wiz_paxCustom')?.value);
    if (!val || val < 11) { this.toast('กรุณาระบุจำนวนมากกว่า 10', 'error'); return; }
    this.wizardData.passengerCount = val;
    this._wizardNext();
  },

  // Step 3: ต้นทาง
  _wStep4Origin() {
    const wd = this.wizardData;
    const cards = OPT.locationTypeCards.map(lt => `
      <div class="wiz-card ${wd.originType === lt.val ? 'sel' : ''}"
        onclick="App._wPickLocType('origin','${lt.val}')">
        <div class="wiz-card-icon">${lt.icon}</div>
        <div class="wiz-card-label">${lt.short}</div>
      </div>`).join('');
    return this._wHeader(
      `<span class="od-pill od-pill-from">🟢 จากที่ไหน?</span><br>ต้นทาง — จุดเริ่มต้น`,
      'สถานที่ที่ผู้เดินทาง<b style="color:#059669">เริ่มออกเดินทาง</b>'
    ) + `
      <button class="wiz-map-btn wiz-map-from ${wd.originCoords ? 'picked' : ''}" onclick="App._wOpenOriginMap()">
        ${wd.originCoords ? '📍 ' + wd.originCoords : '🗺 เลือกจุดต้นทางจากแผนที่'}
      </button>
      <input id="wiz_originLandmark" class="form-input" style="margin-top:10px;"
        placeholder="ชื่อสถานที่ / หมู่บ้านต้นทาง" value="${wd.originLandmark||''}"
        oninput="App.wizardData.originLandmark=this.value" />
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin:16px 0 8px;">ประเภทสถานที่ต้นทาง</div>
      <div class="wiz-grid wiz-grid-3" style="margin-bottom:14px;">${cards}</div>
      ${wd.originType === 'อื่น ๆ' ? `<input id="wiz_originTypeOther" class="form-input" style="margin-bottom:14px;"
        placeholder="ระบุประเภทสถานที่ต้นทาง" value="${wd.originTypeOther||''}"
        oninput="App.wizardData.originTypeOther=this.value" />` : ''}
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-primary btn-block" onclick="App._wOriginNext()">ถัดไป → ปลายทาง</button>
      </div></div>` + this._wFooter();
  },
  _wOriginNext() {
    const inp = document.getElementById('wiz_originLandmark');
    if (inp) this.wizardData.originLandmark = inp.value;
    const oth = document.getElementById('wiz_originTypeOther');
    if (oth) this.wizardData.originTypeOther = oth.value;
    const wd = this.wizardData;
    if (!wd.originType) { this.toast('กรุณาเลือกประเภทสถานที่ต้นทาง', 'error'); return; }
    if (wd.originType === 'อื่น ๆ' && !(wd.originTypeOther||'').trim()) { this.toast('กรุณาระบุประเภทสถานที่ต้นทาง (อื่น ๆ)', 'error'); return; }
    if (!wd.originLandmark && !wd.originCoords) { this.toast('กรุณาระบุชื่อสถานที่หรือเลือกจากแผนที่', 'error'); return; }
    this._wizardNext();
  },

  // Step 4: ปลายทาง
  _wStep5Dest() {
    const wd = this.wizardData;
    const fromShort = wd.originLandmark || wd.originType || 'ต้นทาง';
    const cards = OPT.locationTypeCards.map(lt => `
      <div class="wiz-card ${wd.destType === lt.val ? 'sel' : ''}"
        onclick="App._wPickLocType('dest','${lt.val}')">
        <div class="wiz-card-icon">${lt.icon}</div>
        <div class="wiz-card-label">${lt.short}</div>
      </div>`).join('');
    return this._wHeader(
      `<span class="od-pill od-pill-to">🔴 ไปที่ไหน?</span><br>ปลายทาง — จุดหมาย`,
      `จาก <b>${fromShort}</b> → กำลังจะ<b style="color:#dc2626">ไปที่ไหน?</b>`
    ) + `
      <button class="wiz-map-btn wiz-map-to ${wd.destCoords ? 'picked' : ''}" onclick="App._wOpenDestMap()">
        ${wd.destCoords ? '📍 ' + wd.destCoords : '🗺 เลือกจุดปลายทางจากแผนที่'}
      </button>
      <input id="wiz_destLandmark" class="form-input" style="margin-top:10px;"
        placeholder="ชื่อสถานที่ / หมู่บ้านปลายทาง" value="${wd.destLandmark||''}"
        oninput="App.wizardData.destLandmark=this.value" />
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin:16px 0 8px;">ประเภทสถานที่ปลายทาง</div>
      <div class="wiz-grid wiz-grid-3" style="margin-bottom:14px;">${cards}</div>
      ${wd.destType === 'อื่น ๆ' ? `<input id="wiz_destTypeOther" class="form-input" style="margin-bottom:14px;"
        placeholder="ระบุประเภทสถานที่ปลายทาง" value="${wd.destTypeOther||''}"
        oninput="App.wizardData.destTypeOther=this.value" />` : ''}
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-primary btn-block" onclick="App._wDestNext()">ถัดไป →</button>
      </div></div>` + this._wFooter();
  },
  _wDestNext() {
    const inp = document.getElementById('wiz_destLandmark');
    if (inp) this.wizardData.destLandmark = inp.value;
    const oth = document.getElementById('wiz_destTypeOther');
    if (oth) this.wizardData.destTypeOther = oth.value;
    const wd = this.wizardData;
    if (!wd.destType) { this.toast('กรุณาเลือกประเภทสถานที่ปลายทาง', 'error'); return; }
    if (wd.destType === 'อื่น ๆ' && !(wd.destTypeOther||'').trim()) { this.toast('กรุณาระบุประเภทสถานที่ปลายทาง (อื่น ๆ)', 'error'); return; }
    if (!wd.destLandmark && !wd.destCoords) { this.toast('กรุณาระบุชื่อสถานที่หรือเลือกจากแผนที่', 'error'); return; }
    this._wizardNext();
  },

  _wPickLocType(prefix, val) {
    const dKey = prefix === 'origin' ? 'originLandmark' : 'destLandmark';
    const inp  = document.getElementById('wiz_' + dKey);
    if (inp) this.wizardData[dKey] = inp.value;
    this.wizardData[prefix + 'Type'] = val;
    this.page = 'wizard'; this.render();
  },
  _wOpenOriginMap() {
    const inp = document.getElementById('wiz_originLandmark');
    if (inp) this.wizardData.originLandmark = inp.value;
    MapPicker.open(this.wizardData.originCoords || '', (coords, name) => {
      this.wizardData.originCoords = coords;
      if (name && !this.wizardData.originLandmark) this.wizardData.originLandmark = name;
      this.page = 'wizard'; this.render();
    });
  },
  _wOpenDestMap() {
    const inp = document.getElementById('wiz_destLandmark');
    if (inp) this.wizardData.destLandmark = inp.value;
    MapPicker.open(this.wizardData.destCoords || '', (coords, name) => {
      this.wizardData.destCoords = coords;
      if (name && !this.wizardData.destLandmark) this.wizardData.destLandmark = name;
      this.page = 'wizard'; this.render();
    });
  },

  // Step 5: วัตถุประสงค์
  _wStep6Purpose() {
    const cards = OPT.purposeCards.map(p => `
      <div class="wiz-card ${this.wizardData.purpose === p.val ? 'sel' : ''}"
        onclick="App._wPickPurpose('${p.val.replace(/'/g, "\\'")}', this)">
        <div class="wiz-card-icon">${p.icon}</div>
        <div class="wiz-card-label">${p.val}</div>
      </div>`).join('');
    return this._wHeader('วัตถุประสงค์การเดินทาง') +
      `<div class="wiz-grid wiz-grid-3">${cards}</div>` + this._wFooter();
  },
  _wPickPurpose(val, el) {
    this._confirmPick(el, () => { this.wizardData.purpose = val; this._wizardNext(); });
  },

  // Step 6: สินค้า (รถบรรทุกเท่านั้น)
  _wStep7Cargo() {
    const wd = this.wizardData;
    // จัดกลุ่ม + สีพื้นต่อกลุ่ม (กวาดตาหาเร็ว)
    const cargoCards = OPT.cargoGroups.map(g => `
      <div class="wiz-cargo-group" data-cgroup="${g.name}">
        <div style="font-size:11px;font-weight:700;color:var(--gray-600);margin:12px 2px 6px;display:flex;align-items:center;gap:6px;">
          <span style="width:12px;height:12px;border-radius:3px;background:${g.bg};border:1px solid rgba(0,0,0,.12);flex-shrink:0;"></span>${g.name}
        </div>
        <div class="wiz-grid wiz-grid-3">
          ${g.items.map(c => `
            <div class="wiz-card wiz-cargo-item ${wd.cargoType === c ? 'sel' : ''}"
              data-label="${c}" data-cgroup="${g.name}" style="background:${g.bg};"
              onclick="App._wPickCargoType('${c.replace(/'/g,"\\'")}')">
              <div class="wiz-card-label" style="font-size:12px;">${c}</div>
            </div>`).join('')}
        </div>
      </div>`).join('');
    return this._wHeader('สินค้าที่บรรทุก') + `
      <div class="wiz-grid wiz-grid-2" style="margin-bottom:16px;">
        <div class="wiz-card ${wd.hasCargo==='ไม่มีสินค้า'?'sel':''}" onclick="App._wPickHasCargo('ไม่มีสินค้า')">
          <div class="wiz-card-icon">🚫</div><div class="wiz-card-label">ไม่มีสินค้า</div>
        </div>
        <div class="wiz-card ${wd.hasCargo==='มีสินค้า'?'sel':''}" onclick="App._wPickHasCargo('มีสินค้า')">
          <div class="wiz-card-icon">📦</div><div class="wiz-card-label">มีสินค้า</div>
        </div>
      </div>
      ${wd.hasCargo === 'ไม่มีสินค้า' ? `<div class="wiz-bottom"><div class="wiz-bottom-row"><button class="btn btn-primary btn-block" onclick="App._wizardNext()">ถัดไป →</button></div></div>` : ''}
      ${wd.hasCargo === 'มีสินค้า' ? `
        <div style="margin-top:6px;">${cargoCards}</div>
        ${wd.cargoType === 'อื่น ๆ (ระบุ)' ? `
          <input id="wiz_cargoTypeOther" class="form-input" style="margin-top:10px;"
            placeholder="ระบุชนิดสินค้า" value="${wd.cargoTypeOther||''}"
            oninput="App.wizardData.cargoTypeOther=this.value" />` : ''}
        ${wd.cargoType ? `
          <div style="margin-top:14px;">
            <label class="form-label">น้ำหนักสินค้า (กก.)</label>
            <input id="wiz_cargoWeight" class="form-input" type="number" inputmode="numeric"
              placeholder="เช่น 5000" value="${wd.cargoWeight||''}" oninput="App.wizardData.cargoWeight=this.value" />
          </div>
          <div class="wiz-bottom"><div class="wiz-bottom-row"><button class="btn btn-primary btn-block" onclick="App._wCargoNext()">ถัดไป →</button></div></div>
        ` : ''}
      ` : ''}` + this._wFooter();
  },
  _wPickHasCargo(val) { this.wizardData.hasCargo = val; this.wizardData.cargoType = ''; this.wizardData.cargoTypeOther = ''; this.wizardData.cargoWeight = ''; this.page='wizard'; this.render(); window.scrollTo(0,0); },
  _wPickCargoType(val) { this.wizardData.cargoType = val; this.page='wizard'; this.render(); },
  _wCargoNext() {
    const w = document.getElementById('wiz_cargoWeight'); if (w) this.wizardData.cargoWeight = w.value;
    const oth = document.getElementById('wiz_cargoTypeOther'); if (oth) this.wizardData.cargoTypeOther = oth.value;
    const wd = this.wizardData;
    if (!wd.cargoType)   { this.toast('กรุณาเลือกชนิดสินค้า', 'error'); return; }
    if (wd.cargoType === 'อื่น ๆ (ระบุ)' && !(wd.cargoTypeOther||'').trim()) { this.toast('กรุณาระบุชนิดสินค้า (อื่น ๆ)', 'error'); return; }
    if (!wd.cargoWeight) { this.toast('กรุณากรอกน้ำหนักสินค้า', 'error'); return; }
    this._wizardNext();
  },

  // Step 7: รายได้
  _wStep8Income() {
    return this._wHeader('รายได้ต่อเดือน (บาท)', 'ของผู้ขับขี่หรือตัวแทน') + `
      <input id="wiz_income" class="form-input" type="number" inputmode="numeric"
        placeholder="เช่น 15000 (กรอก 0 ถ้าไม่มีรายได้)"
        style="font-size:22px;padding:20px;text-align:center;"
        value="${this.wizardData.driverIncome||''}" />
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-ghost" onclick="App._wSave()" style="flex:1;">ข้าม</button>
        <button class="btn btn-primary" onclick="App._wSave()" style="flex:2;">บันทึก ✓</button>
      </div></div>` + this._wFooter();
  },

  _wSave() {
    const incEl = document.getElementById('wiz_income');
    if (incEl) this.wizardData.driverIncome = incEl.value;
    const wd = this.wizardData;
    const iv = DB.addInterview(this.stId, {
      surveyorName:      this._canManage() ? this._adminUsername : this._surveyorName,
      interviewTime:     new Date().toTimeString().slice(0,5),
      vehicleType:       wd.vehicleType,
      passengerCount:    wd.passengerCount,
      travelDirection:   this._wizardDirection || '',
      originType:        wd.originType,
      originTypeOther:   wd.originType === 'อื่น ๆ' ? (wd.originTypeOther || '') : '',
      originName:        wd.originLandmark || '',
      originCoords:      wd.originCoords || '',
      destinationType:   wd.destType,
      destinationTypeOther: wd.destType === 'อื่น ๆ' ? (wd.destTypeOther || '') : '',
      destinationName:   wd.destLandmark || '',
      destinationCoords: wd.destCoords || '',
      purpose:           wd.purpose,
      hasCargo:          wd.hasCargo,
      cargoType:         wd.cargoType,
      cargoTypeOther:    wd.cargoType === 'อื่น ๆ (ระบุ)' ? (wd.cargoTypeOther || '') : '',
      cargoWeight:       wd.cargoWeight,
      driverIncome:      wd.driverIncome
    });
    this._autoPush(() => FB.pushInterview(this.stId, iv));
    this._wizardDone = true;
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },

  _wDoneScreen() {
    const vt = OPT.vehicleTypes.find(v => v.key === this.wizardData.vehicleType);
    const st = DB.getStation(this.stId);
    const dir = this._wizardDirection || '';
    return `<div class="wiz-done">
      <span class="wiz-done-icon">✅</span>
      <div class="wiz-done-badge">บันทึกสำเร็จ</div>
      <div class="wiz-done-title">รับทราบแล้ว!</div>
      <div class="wiz-done-sub">${vt?.icon||''} ${vt?.label||''}${dir ? ' · ' + dir : ''}</div>
      <div class="wiz-done-count">รายที่ ${st?.interviews.length||''} · จุด ${st?.stationName||''}</div>
      <div class="wiz-done-actions">
        <button class="btn btn-primary btn-lg btn-block" onclick="App._wizardNextCar()" style="font-size:16px;padding:16px;">
          🚗 รถคันถัดไป${dir ? ' — ' + dir : ''}
        </button>
        <button class="btn btn-outline btn-block" onclick="App._wizardChangeDir()">↔ เปลี่ยนทิศทาง</button>
        <button class="btn btn-ghost btn-block" onclick="App.navigate('station',App.stId)">← กลับหน้าจุดสำรวจ</button>
      </div>
    </div>`;
  },

  _wizardNextCar() {
    this._wizardDone = false;
    this._paxCustom = false;
    this.wizardData = { originType:'', originTypeOther:'', originCoords:'', originLandmark:'', destType:'', destTypeOther:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoTypeOther:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = 2; // ข้ามทิศ เริ่มที่รถ
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },
  _wizardChangeDir() {
    this._wizardDirection = null;
    this._wizardDone = false;
    this._paxCustom = false;
    this.wizardData = { originType:'', originTypeOther:'', originCoords:'', originLandmark:'', destType:'', destTypeOther:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoTypeOther:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = 1; // ถามทิศใหม่
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },

  // ===================== GPS =====================
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
      const acc = pos.coords.accuracy ? ` (±${Math.round(pos.coords.accuracy)} ม.)` : '';
      this.toast(`รับพิกัด GPS: ${coords}${acc}`, 'success');
      if (coordsId === 's_coords') this._reverseGeocode(lat, lon);
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

  // reverse geocode → Longdo address (ข้อมูลไทยแม่น · ได้ ตำบล ด้วย · ไม่ติด throttle เหมือน Nominatim)
  _reverseGeocode(lat, lon) {
    const key = (typeof PlaceService !== 'undefined' && PlaceService.LONGDO_KEY) || '';
    fetch(`https://api.longdo.com/map/services/address?lon=${lon}&lat=${lat}&key=${key}&locale=th`)
      .then(r => r.json())
      .then(d => {
        const strip = s => (s || '').replace(/^(ต\.|อ\.|จ\.|ตำบล|อำเภอ|จังหวัด)\s*/, '').trim();
        const sub = strip(d.subdistrict), dis = strip(d.district), pro = strip(d.province);
        const subEl = document.getElementById('s_subdistrict');
        const disEl = document.getElementById('s_district');
        const proEl = document.getElementById('s_province');
        if (subEl && sub) subEl.value = sub;
        if (disEl && dis) disEl.value = dis;
        if (proEl && pro) proEl.value = pro;
        if (sub || dis || pro)
          this.toast(`พบที่อยู่: ต.${sub||'?'} อ.${dis||'?'} จ.${pro||'?'}`, 'success');
      })
      .catch(() => {});
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
    const icon = { success: '✓', warning: '⚠', danger: '✕' };
    t.innerHTML = `<span>${icon[type] || 'ℹ'}</span> ${msg}`;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  // ===================== FIREBASE SYNC / PULL =====================
  pullFromCloud() {
    const isAdmin    = this._isAdmin();
    const localCount = DB.getStations().length;
    const filterNote = isAdmin ? '' :
      `<br><span style="color:var(--primary);font-size:12px;">🔍 จะดึงเฉพาะข้อมูลของ "${this._surveyorName}" เท่านั้น</span>`;
    const msg = localCount > 0
      ? `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มา<b>รวม</b>กับข้อมูลในเครื่อง ${localCount} จุดสำรวจ${filterNote}</p>`
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
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = await this._pullScoped();
      this.toast(`☁️ ดึงข้อมูลสำเร็จ รวม ${count} จุดสำรวจ`, 'success');
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
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const isAdmin  = this._isAdmin();
      const count    = this._isAdmin() ? await FB.syncAll(null)
                     : this._isStaff() ? await FB.syncAll(null, this._team)
                     :                   await FB.syncAll(this._surveyorName);
      const lastSync = FB.lastSync();
      const timeStr  = lastSync ? new Date(lastSync).toLocaleTimeString('th-TH') : '';
      const unit     = isAdmin ? 'จุดสำรวจ' : 'การสำรวจ';
      this.toast(`☁️ sync สำเร็จ ${count} ${unit}${timeStr ? ' · ' + timeStr : ''}`, 'success');
    } catch (e) {
      this.toast('sync ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ Sync'; btn.disabled = false; }
    }
  },

  // ===================== EXPORT / CLEAR =====================
  exportData() {
    if (!this._canManage()) { this.toast('เฉพาะผู้ดูแลระบบ / ผู้ควบคุมเท่านั้น', 'error'); return; }
    if (typeof XLSX === 'undefined') { this.toast('โหลด SheetJS ไม่สำเร็จ', 'error'); return; }
    // เปิด modal ตัวกรองก่อน
    this._openExportFilter();
  },

  _openExportFilter() {
    const all = DB.getStations();
    const surveyors = [...new Set(
      all.flatMap(st => st.interviews.map(iv => iv.surveyorName).filter(Boolean))
    )].sort();
    const totalIv = all.reduce((s, st) => s + st.interviews.length, 0);

    this.showModal('⬇ Export Excel — ตัวกรอง', `
      <div class="form-row">
        <label class="form-label">ผู้สำรวจ</label>
        <select id="ex_surveyor" class="form-select">
          <option value="">— ทั้งหมด —</option>
          ${surveyors.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">วันที่เริ่ม</label>
          <input id="ex_from" class="form-input" type="date" />
        </div>
        <div class="form-row">
          <label class="form-label">วันที่สิ้นสุด</label>
          <input id="ex_to" class="form-input" type="date" />
        </div>
      </div>
      <p style="font-size:13px;color:var(--gray-500);margin-top:8px;">
        เว้นว่าง = ไม่กรอง · ทั้งหมดในเครื่อง: ${all.length} จุด · ${totalIv} ราย
      </p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App._doExport()">⬇ Export</button>`
    );
  },

  async _doExport() {
    const fSurveyor = document.getElementById('ex_surveyor')?.value || '';
    const fFrom     = document.getElementById('ex_from')?.value     || '';
    const fTo       = document.getElementById('ex_to')?.value       || '';
    this.closeModal();

    // โหลดโซนจากระบบเพื่อคำนวณคอลัมน์โซนจากพิกัด (ถ้าโหลดไม่ได้ export ต่อได้ คอลัมน์โซนว่าง)
    try { await ZoneService.load(); }
    catch (e) { this.toast('⚠ โหลดโซนไม่ได้ (' + e.message + ') — export โดยไม่มีโซน', 'warning'); }
    const zone = c => ZoneService.assign(c);

    const data = JSON.parse(DB.exportJSON());
    data.stations = this._visibleStations(data.stations || []);   // staff = เฉพาะทีมตัวเอง
    // กรอง interview ตาม filter
    let totalKept = 0;
    data.stations = data.stations.map(st => {
      const filtered = st.interviews.filter(iv => {
        if (fSurveyor && iv.surveyorName !== fSurveyor) return false;
        if (fFrom && (iv.interviewDate || '') < fFrom)  return false;
        if (fTo   && (iv.interviewDate || '') > fTo)    return false;
        return true;
      });
      totalKept += filtered.length;
      return { ...st, interviews: filtered };
    });

    if (totalKept === 0) { this.toast('ไม่มีข้อมูลตรงกับตัวกรอง', 'warning'); return; }

    const wb = XLSX.utils.book_new();

    const groupLabel = { personal:'รถส่วนบุคคล', bus:'รถโดยสาร', truck:'รถบรรทุก' };
    const vtInfo = key => {
      const v = OPT.vehicleTypes.find(x => x.key === key);
      return { label: v?.label || key || '', group: groupLabel[v?.group] || '' };
    };
    const coordsLat = c => (c||'').split(',')[0]?.trim() || '';
    const coordsLon = c => (c||'').split(',')[1]?.trim() || '';

    // ===== Sheet 1: จุดสำรวจ =====
    const stRows = data.stations.map((st, i) => ({
      'ลำดับ':              i + 1,
      'รหัสจุดสำรวจ':       st.stationCode || st.stationName,
      'ชื่อจุดสำรวจ':       st.stationName,
      'ถนน/ทางหลวง':        st.road,
      'แกนถนน':             st.direction,
      'ตำบล':               st.subdistrict,
      'อำเภอ':              st.district,
      'จังหวัด':            st.province,
      'พิกัด (lat,lon)':    st.coordinates,
      'Latitude':           coordsLat(st.coordinates),
      'Longitude':          coordsLon(st.coordinates),
      'โซนจุดสำรวจ':        zone(st.coordinates),
      'ผู้สำรวจ (สร้าง)':  st.surveyorName,
      'วันที่สร้าง':         st.surveyDate,
      'จำนวนการสำรวจ':      st.interviews.length,
      'ID':                 st.id,
      'Device ID':          st.deviceId || '',
      'IP':                 st.clientIp || ''
    }));

    // ===== Sheet 2: การสำรวจ =====
    const ivRows = data.stations.flatMap(st =>
      // renumber ลำดับใหม่ต่อจุด (1..n) ตอน export — กัน seq ซ้ำข้ามผู้สำรวจ
      st.interviews.map((iv, idx) => {
        const v = vtInfo(iv.vehicleType);
        return {
          // ระบุจุดสำรวจ
          'รหัสจุดสำรวจ':         st.stationCode || st.stationName,
          'ชื่อจุดสำรวจ':         st.stationName,
          'ตำบล':                 st.subdistrict,
          'อำเภอ':                st.district,
          'จังหวัด':              st.province,
          'แกนถนน':               st.direction,
          // ข้อมูลการสำรวจ
          'ลำดับ':                idx + 1,
          'วันที่สำรวจ':          iv.interviewDate || '',
          'เวลาสำรวจ':            iv.interviewTime || '',
          'ผู้สำรวจ':             iv.surveyorName || '',
          'ทิศการเดินทาง':        iv.travelDirection || '',
          // ยานพาหนะ
          'ประเภทยานพาหนะ':       v.label,
          'กลุ่มยานพาหนะ':        v.group,
          'จำนวนผู้โดยสาร':       iv.passengerCount || '',
          // ต้นทาง
          'ประเภทสถานที่ต้นทาง':  iv.originType === 'อื่น ๆ' && iv.originTypeOther ? 'อื่น ๆ: ' + iv.originTypeOther : (iv.originType || ''),
          'ชื่อสถานที่ต้นทาง':    iv.originName || '',
          'พิกัดต้นทาง':          iv.originCoords || '',
          'Lat ต้นทาง':           coordsLat(iv.originCoords),
          'Lon ต้นทาง':           coordsLon(iv.originCoords),
          'โซนต้นทาง':            zone(iv.originCoords),
          // ปลายทาง
          'ประเภทสถานที่ปลายทาง': iv.destinationType === 'อื่น ๆ' && iv.destinationTypeOther ? 'อื่น ๆ: ' + iv.destinationTypeOther : (iv.destinationType || ''),
          'ชื่อสถานที่ปลายทาง':   iv.destinationName || '',
          'พิกัดปลายทาง':         iv.destinationCoords || '',
          'Lat ปลายทาง':          coordsLat(iv.destinationCoords),
          'Lon ปลายทาง':          coordsLon(iv.destinationCoords),
          'โซนปลายทาง':           zone(iv.destinationCoords),
          // วัตถุประสงค์
          'วัตถุประสงค์':         iv.purpose || '',
          // สินค้า
          'มีสินค้า':             iv.hasCargo || '',
          'ชนิดสินค้า':           iv.cargoType === 'อื่น ๆ (ระบุ)' && iv.cargoTypeOther ? 'อื่น ๆ: ' + iv.cargoTypeOther : (iv.cargoType || ''),
          'น้ำหนักสินค้า (กก.)':  iv.cargoWeight || '',
          // รายได้
          'รายได้ผู้ขับ (บาท/เดือน)': iv.driverIncome || '',
          // อ้างอิง
          'ID จุดสำรวจ':          st.id,
          'ID การสำรวจ':          iv.id
        };
      })
    );

    // ===== Sheet 3: สรุปตามจุดสำรวจ — แยกทุกประเภทยานพาหนะ =====
    const summaryRows = data.stations.map((st, i) => {
      const ivs = st.interviews;
      // นับแยกทุกประเภท (9 ประเภทตามแบบฟอร์ม RS)
      const vcol = {};
      OPT.vehicleTypes.forEach(vt => {
        vcol[vt.label] = ivs.filter(iv => iv.vehicleType === vt.key).length;
      });
      return {
        'ลำดับ':           i + 1,
        'รหัสจุดสำรวจ':    st.stationCode || st.stationName,
        'ชื่อจุดสำรวจ':    st.stationName,
        'แกนถนน':          st.direction,
        'รวมทั้งหมด':       ivs.length,
        ...vcol,
        'มีสินค้า':        ivs.filter(iv => iv.hasCargo === 'มีสินค้า').length,
        'ไม่มีสินค้า':     ivs.filter(iv => iv.hasCargo === 'ไม่มีสินค้า').length
      };
    });

    const mkSheet = rows => rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['ไม่มีข้อมูล']]);

    // กำหนดความกว้างคอลัมน์ ~ พอดีตามชื่อหัว (อ่านง่าย)
    const autoWidth = (rows) => {
      if (!rows.length) return [];
      return Object.keys(rows[0]).map(k => {
        const max = Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length));
        return { wch: Math.min(Math.max(max + 2, 10), 40) };
      });
    };

    const s1 = mkSheet(stRows);      s1['!cols'] = autoWidth(stRows);
    const s2 = mkSheet(ivRows);      s2['!cols'] = autoWidth(ivRows);
    const s3 = mkSheet(summaryRows); s3['!cols'] = autoWidth(summaryRows);

    XLSX.utils.book_append_sheet(wb, s1, 'จุดสำรวจ');
    XLSX.utils.book_append_sheet(wb, s2, 'การสำรวจ');
    XLSX.utils.book_append_sheet(wb, s3, 'สรุปตามจุด');

    const today = new Date().toISOString().split('T')[0];
    const parts = ['roadside-banphai', today];
    if (fSurveyor) parts.push(fSurveyor.replace(/\s+/g, '_'));
    if (fFrom || fTo) parts.push(`${fFrom||'..'}_${fTo||'..'}`);
    XLSX.writeFile(wb, parts.join('-') + '.xlsx');
    this.toast(`Export สำเร็จ · ${totalKept} ราย`, 'success');
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
    const isAdmin = this._canManage();   // staff ล้าง cache ในเครื่องได้
    if (isAdmin) {
      const stats = DB.stats();
      this.showModal('⚠️ ล้างข้อมูลทั้งหมด',
        `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
          <strong style="color:#dc2626;">ข้อมูลที่จะถูกลบ:</strong>
          <ul style="margin-top:8px;padding-left:18px;font-size:14px;color:#7f1d1d;line-height:1.8;">
            <li>${stats.stations} จุดสำรวจ</li>
            <li>${stats.interviews} การสำรวจ</li>
          </ul>
        </div>
        <p style="font-size:14px;color:var(--gray-600);">ไม่สามารถย้อนกลับได้ — แนะนำให้ Export ก่อน</p>
        ${this._deleteConfirmHTML('delAllBtn')}`,
        `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
         <button class="btn btn-ghost btn-sm" onclick="App.exportData()" style="color:var(--primary);">⬇ Export ก่อนลบ</button>
         <button id="delAllBtn" class="btn btn-danger" disabled onclick="App.clearAll()">ล้างข้อมูลทั้งหมด</button>`
      );
    } else {
      const myIvCount = DB.getStations()
        .reduce((s, st) => s + st.interviews.filter(iv => iv.surveyorName === this._surveyorName).length, 0);
      this.showModal('🗑 ล้างข้อมูลของฉัน',
        `<p style="font-size:14px;color:var(--gray-600);margin-bottom:12px;">
          จะลบ <strong>การสำรวจของฉัน ${myIvCount} ราย</strong> ออกจากเครื่องนี้<br>
          <span style="color:var(--success);font-weight:600;">✅ ข้อมูลจุดสำรวจยังคงอยู่</span>
        </p>
        <p style="font-size:13px;color:var(--gray-400);">หากได้ Sync ขึ้น Firebase แล้ว ข้อมูลยังอยู่บน Cloud ดึงกลับมาได้ทุกเมื่อ</p>
        ${this._deleteConfirmHTML('delMineBtn')}`,
        `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
         <button id="delMineBtn" class="btn btn-danger" disabled onclick="App.clearMyData()">ล้างข้อมูลของฉัน</button>`
      );
    }
  },

  async clearAll() {
    await DB.clearAll();   // ล้างทั้ง IndexedDB + localStorage (ไม่งั้นข้อมูลกลับมาตอน reload)
    this.closeModal();
    this.toast('ล้างข้อมูลทั้งหมดแล้ว', 'danger');
    this.navigate('home');
  },

  clearMyData() {
    DB.clearMyInterviews(this._surveyorName);
    this.closeModal();
    this.toast('ล้างข้อมูลของฉันแล้ว · จุดสำรวจยังอยู่', 'success');
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
