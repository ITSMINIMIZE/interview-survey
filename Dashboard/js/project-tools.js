// ===== เครื่องมือของ "โครงการ" — เปิดจากปุ่มมุมขวาบนของ Dashboard =====
//
// Dashboard = หน้าแรกของโครงการ → ของที่ผูกกับโครงการต้องอยู่ที่นี่ ไม่ใช่ sidebar ระดับระบบ
//   · ผู้ควบคุม (staff)  — แต่งตั้งบัญชีเข้าโครงการนี้
//   · จุดสำรวจ           — สร้าง/แก้/ลบจุดสำรวจ Roadside (ย้ายมาจากในแอปสำรวจ)
//   · โซน · ข้อมูลทดสอบ  — ลิงก์ไปหน้าเครื่องมือ พร้อม ?project= ให้ทำงานกับโครงการที่เปิดอยู่
//
// ระดับระบบ (สร้าง/ลบโครงการ · บัญชีผู้ใช้ · API key) ยังอยู่ที่ sidebar หน้าแรกเหมือนเดิม

const ProjectTools = {
  _built: false,
  _tab: 'members',
  _members: [],
  _users: [],
  _stations: [],
  _editingSt: null,

  ROAD_AXIS: ['เหนือ–ใต้', 'ตะวันออก–ตะวันตก'],

  _esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  _g(id) { return document.getElementById(id); },

  // ---------- โครง modal ----------
  _build() {
    if (this._built) return;
    const w = document.createElement('div');
    w.id = 'ptModal';
    w.setAttribute('style',
      'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:none;' +
      'align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto');
    w.innerHTML = `
      <div style="background:#2c2c2e;border:1px solid rgba(255,255,255,.12);border-radius:12px;max-width:820px;width:100%;padding:26px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
          <div>
            <div style="font-size:19px;font-weight:700;color:#f5f5f7">🧰 เครื่องมือของโครงการ</div>
            <div style="font-size:13px;color:#8e8e93;margin-top:3px" id="ptProj"></div>
          </div>
          <button id="ptClose" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:8px;cursor:pointer">ปิด</button>
        </div>

        <div style="display:flex;gap:8px;margin:18px 0;flex-wrap:wrap" id="ptTabs">
          <button data-tab="members"  class="pt-tab">👔 ผู้ควบคุม</button>
          <button data-tab="stations" class="pt-tab">🚦 จุดสำรวจ</button>
          <button data-tab="forms"    class="pt-tab">📝 ตัวเลือกแบบสอบถาม</button>
          <button data-tab="more"     class="pt-tab">🗺 โซน &amp; ข้อมูลทดสอบ</button>
        </div>

        <div id="ptBody"></div>
      </div>`;
    document.body.appendChild(w);

    const css = document.createElement('style');
    css.textContent = `
      .pt-tab{background:#1c1c1e;border:1px solid #3a3a3c;color:#98989d;font-family:inherit;
              font-size:13.5px;font-weight:600;padding:8px 15px;border-radius:9px;cursor:pointer}
      .pt-tab:hover{border-color:#48484a;color:#e5e5ea}
      .pt-tab.on{background:rgba(10,132,255,.18);border-color:#0a84ff;color:#64b5ff}
      .pt-lb{display:block;font-size:12px;color:#98989d;font-weight:600;margin-bottom:5px}
      .pt-in{width:100%;padding:9px 12px;background:#2c2c2e;border:1px solid #3a3a3c;
             border-radius:9px;color:#e5e5ea;font-size:14px;font-family:inherit}
      .pt-in:focus{outline:none;border-color:#0a84ff}
      .pt-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .pt-card{background:#1c1c1e;border:1px solid #3a3a3c;border-radius:12px;padding:16px;margin-bottom:12px}
      .pt-row{background:#1c1c1e;border:1px solid #3a3a3c;border-radius:11px;padding:13px 15px;
              margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
      .pt-btn{background:#0a84ff;color:#fff;border:none;font-family:inherit;font-size:14px;
              font-weight:600;padding:9px 17px;border-radius:9px;cursor:pointer}
      .pt-btn-g{background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;
                font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer}
      .pt-btn-d{background:rgba(255,69,58,.15);border:1px solid rgba(255,138,128,.3);color:#ff8a80;
                font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer}
      .pt-empty{color:#8e8e93;font-size:13px;text-align:center;padding:24px;
                background:#1c1c1e;border:1px dashed #48484a;border-radius:12px}
      .pt-msg{padding:10px 13px;border-radius:9px;font-size:13px;margin-top:12px;line-height:1.6;display:none}
      .pt-hint{font-size:12px;color:#8e8e93;line-height:1.7;margin-bottom:14px}
      .pt-link{display:flex;align-items:center;gap:11px;background:#1c1c1e;border:1px solid #3a3a3c;
               border-radius:11px;padding:14px 16px;margin-bottom:10px;text-decoration:none;color:inherit}
      .pt-link:hover{border-color:#48484a}
      @media(max-width:640px){.pt-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(css);

    this._g('ptClose').onclick = () => this.close();
    w.addEventListener('click', e => { if (e.target === w) this.close(); });
    this._g('ptTabs').querySelectorAll('.pt-tab').forEach(b =>
      b.onclick = () => { this._tab = b.dataset.tab; this._render(); });

    this._built = true;
  },

  async open(tab) {
    this._build();
    if (tab) this._tab = tab;
    this._g('ptModal').style.display = 'flex';
    this._g('ptProj').textContent = 'โครงการ: ' + (Project.meta ? Project.meta.name : Project.id());
    // ซิงก์รายชื่อผู้ควบคุมทันทีที่เปิด — โครงการที่เพิ่งสร้างจะได้มี admin ให้เลือกเลย
    // (อ่าน users ได้เฉพาะ admin ตาม rules → staff ข้ามไป ใช้รายชื่อที่มีอยู่)
    if (typeof ME !== 'undefined' && ME && ME.role === 'admin') {
      try { await this._rebuildSupervisors(); } catch (_) {}
    }
    await this._render();
  },

  close() { const m = this._g('ptModal'); if (m) m.style.display = 'none'; },

  _msg(id, text, ok) {
    const el = this._g(id);
    if (!el) return;
    el.style.display = 'block';
    el.textContent = text;
    el.style.background = ok ? 'rgba(48,209,88,.12)' : 'rgba(255,69,58,.12)';
    el.style.color      = ok ? '#63e6a0' : '#ff8a80';
    el.style.border     = '1px solid ' + (ok ? 'rgba(48,209,88,.25)' : 'rgba(255,138,128,.25)');
  },

  async _render() {
    this._g('ptTabs').querySelectorAll('.pt-tab').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === this._tab));
    if (this._tab === 'members')  return this._renderMembers();
    if (this._tab === 'stations') return this._renderStations();
    if (this._tab === 'forms')    return this._renderForms();
    return this._renderMore();
  },

  // ═══════════ ผู้ควบคุม ═══════════
  async _renderMembers() {
    this._g('ptBody').innerHTML = `
      <div class="pt-hint">
        บัญชีระดับ <b>user</b> จะเห็นโครงการนี้ก็ต่อเมื่อถูกแต่งตั้งที่นี่ ·
        แต่งตั้งแล้วเป็น <b>ผู้ควบคุม</b> เห็นและแก้เฉพาะข้อมูลทีมตัวเอง ·
        จุดสำรวจที่เขาสร้างจะมีชื่อเขาเป็นผู้ควบคุมอัตโนมัติ<br>
        (สร้าง/ลบ <b>บัญชี</b> ทำที่หน้าหลัก → จัดการบัญชีผู้ใช้ — ที่นี่คือการมอบหมายเข้าโครงการ)
      </div>
      <div class="pt-card">
        <div class="pt-grid">
          <div>
            <label class="pt-lb" for="ptMUser">เลือกบัญชี</label>
            <select id="ptMUser" class="pt-in"><option value="">— กำลังโหลด —</option></select>
          </div>
          <div>
            <label class="pt-lb" for="ptMName">ชื่อผู้ควบคุมในโครงการนี้ *</label>
            <input id="ptMName" class="pt-in" placeholder="เช่น สมศักดิ์" />
          </div>
        </div>
        <button class="pt-btn" id="ptMAdd" style="margin-top:14px">แต่งตั้งเข้าโครงการ</button>
        <div class="pt-msg" id="ptMMsg"></div>
      </div>
      <div id="ptMList"><div class="pt-empty">กำลังโหลด...</div></div>`;

    this._g('ptMAdd').onclick = () => this._addMember();
    this._g('ptMUser').onchange = () => {
      const u = this._users.find(x => x.uid === this._g('ptMUser').value);
      if (u && !this._g('ptMName').value.trim())
        this._g('ptMName').value = u.displayName || u.username || '';
    };
    await this._loadUsers();      // ต้องมี this._users ก่อน _loadMembers จึงจะแสดง admin ได้
    await this._loadMembers();
  },

  async _loadUsers() {
    try {
      if (!this._users.length) {
        const snap = await db.collection('users').get();
        this._users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      }
      const pick = this._users.filter(u => u.role !== 'admin' && !u.disabled);
      this._g('ptMUser').innerHTML = pick.length
        ? '<option value="">— เลือกบัญชี —</option>' + pick.map(u =>
            `<option value="${this._esc(u.uid)}">${this._esc(u.displayName || u.username || u.email || u.uid)}${u.nickname ? ' (' + this._esc(u.nickname) + ')' : ''}</option>`).join('')
        : '<option value="">— ยังไม่มีบัญชีระดับ user —</option>';
    } catch (_) {
      this._g('ptMUser').innerHTML = '<option value="">— อ่านรายชื่อบัญชีไม่ได้ (ต้องเป็น admin) —</option>';
    }
  },

  async _loadMembers() {
    try {
      const snap = await Project.col(db, 'members').get();
      this._members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

      // admin ขึ้นให้เห็นด้วย แต่ถอดออกไม่ได้ — เป็นผู้ควบคุมทุกโครงการโดยอัตโนมัติ
      const admins = this._users.filter(u => u.role === 'admin' && !u.disabled);
      const adminHTML = admins.length ? `
        <div style="font-size:12.5px;color:#8e8e93;font-weight:700;margin:4px 0 9px">อัตโนมัติ — ผู้ดูแลระบบ</div>
        ${admins.map(u => `
          <div class="pt-row" style="opacity:.85">
            <div>
              <div style="font-size:14.5px;font-weight:700;color:#f5f5f7">${this._esc(this._supName(u))}
                <span style="font-size:11px;font-weight:600;color:#64b5ff;background:rgba(10,132,255,.18);border:1px solid rgba(10,132,255,.35);padding:2px 9px;border-radius:99px;margin-left:7px">admin</span>
              </div>
              <div style="font-size:12px;color:#8e8e93;margin-top:2px">${this._esc(u.email || '')} · เป็นผู้ควบคุมทุกโครงการ</div>
            </div>
          </div>`).join('')}
        <div style="font-size:12.5px;color:#8e8e93;font-weight:700;margin:16px 0 9px">แต่งตั้งในโครงการนี้</div>` : '';

      this._g('ptMList').innerHTML = adminHTML + (this._members.length
        ? this._members.map(m => `
          <div class="pt-row">
            <div>
              <div style="font-size:14.5px;font-weight:700;color:#f5f5f7">${this._esc(m.supervisorName || m.displayName || m.uid)}</div>
              <div style="font-size:12px;color:#8e8e93;margin-top:2px">${this._esc(m.email || '')}${m.phone ? ' · ' + this._esc(m.phone) : ''}</div>
            </div>
            <button class="pt-btn-d" data-rm="${this._esc(m.uid)}">ถอดออก</button>
          </div>`).join('')
        : '<div class="pt-empty">ยังไม่มีผู้ควบคุมที่แต่งตั้งเพิ่ม — admin ใช้ได้อยู่แล้ว</div>');
      this._g('ptMList').querySelectorAll('[data-rm]').forEach(b =>
        b.onclick = () => this._removeMember(b.dataset.rm));
    } catch (e) {
      this._g('ptMList').innerHTML = `<div class="pt-empty">อ่านรายชื่อไม่ได้: ${this._esc(e.message)}</div>`;
    }
  },

  // ชื่อที่ใช้เป็น "ผู้ควบคุม" ของบัญชีหนึ่ง
  _supName(u) {
    return (u.supervisorName || u.displayName || u.username || (u.email || '').split('@')[0] || '').trim();
  },

  // สำเนารายชื่อผู้ควบคุมให้ผู้สำรวจ (anonymous) อ่านได้ — rules ไม่เปิด members ให้เขา
  //
  // admin = ผู้ควบคุมของ "ทุกโครงการ" โดยอัตโนมัติ ไม่ต้องแต่งตั้งรายโครงการ
  // ไม่งั้นโครงการที่เพิ่งสร้าง (ยังไม่มี member) จะไม่มีผู้ควบคุมให้เลือกเลย
  // → สร้างจุดสำรวจไม่ได้ ตันตั้งแต่เริ่ม
  async _rebuildSupervisors() {
    const [memSnap, userSnap] = await Promise.all([
      Project.col(db, 'members').get(),
      db.collection('users').get()
    ]);
    const list = [];
    const seen = new Set();
    const push = (key, name) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({ key, name: name || key });
    };
    // admin ก่อน (อัตโนมัติ) แล้วค่อย staff ที่แต่งตั้งไว้
    userSnap.docs.map(d => d.data())
      .filter(u => u.role === 'admin' && !u.disabled)
      .forEach(u => push(this._supName(u), this._supName(u)));
    memSnap.docs.map(d => d.data())
      .forEach(m => push(m.supervisorName, m.displayName || m.supervisorName));

    await Project.cfg(db, 'supervisors').set({ list, updatedAt: new Date().toISOString() });
    return list;
  },

  async _addMember() {
    const uid  = this._g('ptMUser').value;
    const name = this._g('ptMName').value.trim();
    if (!uid)  return this._msg('ptMMsg', 'เลือกบัญชีก่อน', false);
    if (!name) return this._msg('ptMMsg', 'ใส่ชื่อผู้ควบคุมก่อน', false);
    const u = this._users.find(x => x.uid === uid) || {};
    try {
      await Project.col(db, 'members').doc(uid).set({
        uid, email: u.email || '', phone: u.phone || '',
        displayName: u.displayName || u.username || name,
        supervisorName: name,
        addedAt: new Date().toISOString(),
        addedBy: (firebase.auth().currentUser || {}).email || ''
      });
      // memberUids บน doc โครงการคือตัวที่ rules + หน้าเลือกโครงการใช้ — ต้องอัปเดตคู่กันเสมอ
      await Project.root(db).update({ memberUids: firebase.firestore.FieldValue.arrayUnion(uid) });
      await this._rebuildSupervisors();
      this._msg('ptMMsg', '✅ แต่งตั้ง "' + name + '" เข้าโครงการแล้ว', true);
      this._g('ptMName').value = ''; this._g('ptMUser').value = '';
      await this._loadMembers();
    } catch (e) { this._msg('ptMMsg', 'แต่งตั้งไม่สำเร็จ: ' + e.message, false); }
  },

  async _removeMember(uid) {
    if (!confirm('ถอดบัญชีนี้ออกจากโครงการ?\n\nเขาจะไม่เห็นโครงการนี้อีก\nข้อมูลที่เก็บไว้แล้วยังอยู่ครบ')) return;
    try {
      await Project.col(db, 'members').doc(uid).delete();
      await Project.root(db).update({ memberUids: firebase.firestore.FieldValue.arrayRemove(uid) });
      await this._rebuildSupervisors();
      await this._loadMembers();
    } catch (e) { this._msg('ptMMsg', 'ถอดออกไม่สำเร็จ: ' + e.message, false); }
  },

  // ═══════════ จุดสำรวจ ═══════════
  async _renderStations() {
    const sups = (typeof Supervisors !== 'undefined') ? [] : [];
    this._g('ptBody').innerHTML = `
      <div class="pt-hint">
        จุดสำรวจของ <b>Roadside Interview</b> — ผู้สำรวจเลือกจุดจากรายการนี้แล้วเก็บข้อมูลใต้จุดนั้น<br>
        ต้องสร้างจุดให้ครบ<b>ก่อน</b>ส่งลิงก์ให้ผู้สำรวจ ไม่งั้นเขาเปิดแอปมาแล้วไม่มีจุดให้เลือก
      </div>
      <div class="pt-card">
        <div style="font-size:14px;font-weight:700;color:#f5f5f7;margin-bottom:13px" id="ptStFormTitle">➕ เพิ่มจุดสำรวจ</div>
        <div class="pt-grid">
          <div>
            <label class="pt-lb" for="ptStName">รหัส / ชื่อจุดสำรวจ *</label>
            <input id="ptStName" class="pt-in" placeholder="เช่น MB01" />
          </div>
          <div>
            <label class="pt-lb" for="ptStSup">ผู้ควบคุม *</label>
            <select id="ptStSup" class="pt-in"></select>
          </div>
          <div>
            <label class="pt-lb" for="ptStRoad">ถนน *</label>
            <input id="ptStRoad" class="pt-in" placeholder="เช่น ทล.226" />
          </div>
          <div>
            <label class="pt-lb" for="ptStDir">แกนถนน *</label>
            <select id="ptStDir" class="pt-in">
              <option value="">— เลือก —</option>
              ${this.ROAD_AXIS.map(d => `<option value="${this._esc(d)}">${this._esc(d)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:12px">
          <label class="pt-lb" for="ptStCo">พิกัด GPS (lat, lon) *</label>
          <input id="ptStCo" class="pt-in" placeholder="เช่น 16.0590, 102.7313" />
          <div style="font-size:11.5px;color:#8e8e93;margin-top:5px">คัดลอกจาก Google Maps ได้เลย — คลิกขวาบนแผนที่แล้วกดที่ตัวเลขพิกัด</div>
        </div>
        <div class="pt-grid" style="margin-top:12px">
          <div><label class="pt-lb" for="ptStSub">ตำบล</label><input id="ptStSub" class="pt-in" /></div>
          <div><label class="pt-lb" for="ptStDist">อำเภอ</label><input id="ptStDist" class="pt-in" /></div>
          <div><label class="pt-lb" for="ptStProv">จังหวัด</label><input id="ptStProv" class="pt-in" /></div>
          <div><label class="pt-lb" for="ptStDate">วันที่สำรวจ</label><input id="ptStDate" class="pt-in" type="date" /></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:15px;flex-wrap:wrap">
          <button class="pt-btn" id="ptStSave">บันทึกจุดสำรวจ</button>
          <button class="pt-btn-g" id="ptStCancel" style="display:none;padding:9px 17px;font-size:14px">ยกเลิกการแก้ไข</button>
        </div>
        <div class="pt-msg" id="ptStMsg"></div>
      </div>
      <div id="ptStList"><div class="pt-empty">กำลังโหลด...</div></div>`;

    this._g('ptStDate').value = new Date().toISOString().split('T')[0];
    this._g('ptStSave').onclick   = () => this._saveStation();
    this._g('ptStCancel').onclick = () => this._resetStationForm();
    await Promise.all([this._loadSupOptions(), this._loadStations()]);
  },

  async _loadSupOptions() {
    let list = [];
    try {
      const snap = await Project.cfg(db, 'supervisors').get();
      list = (snap.exists ? snap.data().list : []) || [];
      // โครงการเพิ่งสร้าง / ยังไม่เคยซิงก์ → สร้างรายชื่อให้เลย (อย่างน้อยต้องมี admin)
      if (!list.length && typeof ME !== 'undefined' && ME && ME.role === 'admin') {
        list = await this._rebuildSupervisors();
      }
    } catch (_) {}
    this._g('ptStSup').innerHTML = list.length
      ? '<option value="">— เลือกผู้ควบคุม —</option>' +
        list.map(s => `<option value="${this._esc(s.key)}">${this._esc(s.name || s.key)}</option>`).join('')
      : '<option value="">— ยังไม่มีผู้ควบคุม (แต่งตั้งที่แท็บ 👔) —</option>';
  },

  async _loadStations() {
    try {
      const snap = await Project.col(db, 'roadside_stations').get();
      this._stations = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(st => !st._deleted)
        .sort((a, b) => String(a.stationName || '').localeCompare(String(b.stationName || ''), 'th'));
      this._g('ptStList').innerHTML = this._stations.length
        ? `<div style="font-size:14px;font-weight:700;color:#f5f5f7;margin-bottom:12px">จุดสำรวจในโครงการนี้ (${this._stations.length})</div>`
          + this._stations.map(st => `
          <div class="pt-row">
            <div style="min-width:0">
              <div style="font-size:14.5px;font-weight:700;color:#f5f5f7">🚦 ${this._esc(st.stationName || st.id)}</div>
              <div style="font-size:12px;color:#8e8e93;margin-top:2px">
                ${this._esc(st.road || '—')}${st.direction ? ' · ' + this._esc(st.direction) : ''}${st.supervisorName ? ' · ทีม ' + this._esc(st.supervisorName) : ''}
              </div>
              <div style="font-size:11.5px;color:#48484a;margin-top:2px">${this._esc(st.coordinates || 'ไม่มีพิกัด')}</div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap">
              <button class="pt-btn-g" data-edit="${this._esc(st.id)}">แก้ไข</button>
              <button class="pt-btn-d" data-del="${this._esc(st.id)}">ลบ</button>
            </div>
          </div>`).join('')
        : '<div class="pt-empty">ยังไม่มีจุดสำรวจ — เพิ่มจุดแรกด้านบน</div>';
      this._g('ptStList').querySelectorAll('[data-edit]').forEach(b =>
        b.onclick = () => this._editStation(b.dataset.edit));
      this._g('ptStList').querySelectorAll('[data-del]').forEach(b =>
        b.onclick = () => this._deleteStation(b.dataset.del));
    } catch (e) {
      this._g('ptStList').innerHTML = `<div class="pt-empty">อ่านจุดสำรวจไม่ได้: ${this._esc(e.message)}</div>`;
    }
  },

  _resetStationForm() {
    this._editingSt = null;
    this._g('ptStFormTitle').textContent = '➕ เพิ่มจุดสำรวจ';
    ['ptStName','ptStRoad','ptStCo','ptStSub','ptStDist','ptStProv'].forEach(i => this._g(i).value = '');
    this._g('ptStSup').value = ''; this._g('ptStDir').value = '';
    this._g('ptStDate').value = new Date().toISOString().split('T')[0];
    this._g('ptStCancel').style.display = 'none';
    this._g('ptStMsg').style.display = 'none';
  },

  _editStation(id) {
    const st = this._stations.find(x => x.id === id);
    if (!st) return;
    this._editingSt = id;
    this._g('ptStFormTitle').textContent = '✏️ แก้ไขจุดสำรวจ';
    this._g('ptStName').value = st.stationName || '';
    this._g('ptStSup').value  = st.supervisorName || '';
    this._g('ptStRoad').value = st.road || '';
    this._g('ptStDir').value  = st.direction || '';
    this._g('ptStCo').value   = st.coordinates || '';
    this._g('ptStSub').value  = st.subdistrict || '';
    this._g('ptStDist').value = st.district || '';
    this._g('ptStProv').value = st.province || '';
    this._g('ptStDate').value = st.surveyDate || new Date().toISOString().split('T')[0];
    this._g('ptStCancel').style.display = '';
    this._g('ptModal').scrollTop = 0;
  },

  // พิกัดต้องเป็น "lat, lon" ที่อยู่ในช่วงประเทศไทย — พิมพ์สลับกันเป็นเรื่องที่เกิดบ่อย
  _parseCoords(v) {
    const m = String(v || '').split(',').map(x => parseFloat(x.trim()));
    if (m.length !== 2 || m.some(isNaN)) return null;
    const [lat, lon] = m;
    if (lat < 5 || lat > 21 || lon < 96 || lon > 106) return null;
    return lat + ', ' + lon;
  },

  async _saveStation() {
    const name = this._g('ptStName').value.trim();
    const sup  = this._g('ptStSup').value;
    const road = this._g('ptStRoad').value.trim();
    const dir  = this._g('ptStDir').value;
    const coRaw= this._g('ptStCo').value.trim();
    if (!name) return this._msg('ptStMsg', 'ใส่รหัส/ชื่อจุดสำรวจก่อน', false);
    if (!sup)  return this._msg('ptStMsg', 'เลือกผู้ควบคุมก่อน — ถ้ายังไม่มี ให้แต่งตั้งที่แท็บ 👔 ผู้ควบคุม', false);
    if (!road) return this._msg('ptStMsg', 'ใส่ชื่อถนนก่อน', false);
    if (!dir)  return this._msg('ptStMsg', 'เลือกแกนถนนก่อน', false);
    const co = this._parseCoords(coRaw);
    if (!co) return this._msg('ptStMsg',
      'พิกัดไม่ถูกต้อง — ต้องเป็น "ละติจูด, ลองจิจูด" และอยู่ในประเทศไทย (เช่น 16.0590, 102.7313)', false);

    const data = {
      projectId: Project.id(),   // collectionGroup ของ Dashboard ใช้ field นี้กรอง — ห้ามขาด
      stationName: name, supervisorName: sup, road, direction: dir, coordinates: co,
      subdistrict: this._g('ptStSub').value.trim(),
      district:    this._g('ptStDist').value.trim(),
      province:    this._g('ptStProv').value.trim(),
      surveyDate:  this._g('ptStDate').value || new Date().toISOString().split('T')[0],
      updatedAt:   new Date().toISOString(),
      updatedBy:   (firebase.auth().currentUser || {}).email || ''
    };
    try {
      if (this._editingSt) {
        await Project.col(db, 'roadside_stations').doc(this._editingSt).set(data, { merge: true });
        this._resetStationForm();
        this._msg('ptStMsg', '✅ บันทึกการแก้ไขแล้ว', true);
      } else {
        // id รูปแบบเดียวกับที่แอป Roadside สร้าง เพื่อให้ปนกันได้ไม่มีปัญหา
        const id = 'RS-' + Date.now();
        await Project.col(db, 'roadside_stations').doc(id).set({
          id, ...data, surveyorName: '', createdAt: new Date().toISOString()
        });
        this._resetStationForm();
        this._msg('ptStMsg', `✅ เพิ่มจุดสำรวจ "${name}" แล้ว`, true);
      }
      await this._loadStations();
    } catch (e) { this._msg('ptStMsg', 'บันทึกไม่สำเร็จ: ' + e.message, false); }
  },

  async _deleteStation(id) {
    const st = this._stations.find(x => x.id === id);
    if (!st) return;
    const n = 'จุดสำรวจ "' + (st.stationName || id) + '"';
    // rules ห้ามลบ doc ที่ id ไม่มี SEED → ใช้ flag _deleted แทน (เหมือนที่แอปสำรวจทำ)
    if (!confirm(`ซ่อน ${n} ออกจากระบบ?\n\n`
      + `• ผู้สำรวจจะไม่เห็นจุดนี้อีก\n`
      + `• ข้อมูลสัมภาษณ์ที่เก็บไว้แล้วยังอยู่ครบ (ไม่ถูกลบ)\n`
      + `• ยังนับเข้ารายงานตามเดิม`)) return;
    try {
      await Project.col(db, 'roadside_stations').doc(id).set({
        _deleted: true, _deletedAt: new Date().toISOString(),
        _deletedBy: (firebase.auth().currentUser || {}).email || ''
      }, { merge: true });
      await this._loadStations();
    } catch (e) { this._msg('ptStMsg', 'ลบไม่สำเร็จ: ' + e.message, false); }
  },


  // ═══════════ ตัวเลือกแบบสอบถาม ═══════════
  //
  // ⚠️ ค่าเริ่มต้นข้างล่างคัดลอกมาจาก {Roadside,Home}/js/data.js (ตัวแปร OPT)
  //    Dashboard ไม่ได้โหลด data.js ของแอปสำรวจ จึงต้องมีสำเนาไว้ให้ผู้ใช้เห็นตอนแก้
  //    ถ้าแก้ค่าเริ่มต้นใน data.js ต้องมาแก้ที่นี่ด้วย
  DEFAULTS: {
    roadside: {
      vehicleTypes: [
        { key:'bicycle2',   label:'จักรยาน 2 ล้อ',                          icon:'🚲', group:'personal' },
        { key:'bicycle3',   label:'จักรยาน 3 ล้อ',                          icon:'🚲', group:'personal' },
        { key:'motorcycle', label:'รถจักรยานยนต์',                          icon:'🛵', group:'personal' },
        { key:'tuk3',       label:'รถสามล้อเครื่อง',                        icon:'🛺', group:'personal' },
        { key:'car',        label:'รถยนต์นั่งส่วนบุคคล',                    icon:'🚗', group:'personal' },
        { key:'bus_sm',     label:'รถโดยสารขนาดเล็ก–กลาง',                 icon:'🚐', group:'bus' },
        { key:'bus_lg',     label:'รถโดยสารขนาดใหญ่',                       icon:'🚌', group:'bus' },
        { key:'truck4',     label:'รถบรรทุกขนาดเล็ก (4 ล้อ)',              icon:'🚚', group:'truck' },
        { key:'truck6',     label:'รถบรรทุกขนาดกลางขึ้นไป (6 ล้อขึ้นไป)', icon:'🚛', group:'truck' }
      ],
      purposeCards: [
        { val:'กลับบ้าน', icon:'🏠' }, { val:'ไปทำงาน', icon:'💼' },
        { val:'ไปเรียนหนังสือ', icon:'📚' }, { val:'ติดต่อราชการต่าง ๆ / ธุรกิจ', icon:'🏛️' },
        { val:'ไปโรงพยาบาล / คลินิก / อนามัย', icon:'🏥' }, { val:'รับส่งคน หรือ สินค้า', icon:'📦' },
        { val:'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ', icon:'🛒' }, { val:'รับประทานอาหาร', icon:'🍽️' },
        { val:'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย', icon:'🏖️' },
        { val:'ทำกิจกรรมทางศาสนา', icon:'⛩️' }, { val:'อื่น ๆ', icon:'❓' }
      ],
      locationTypeCards: [
        { val:'ที่พัก / บ้านของตัวเอง', icon:'🏠', short:'บ้านตัวเอง' },
        { val:'โรงเรียน / สถานศึกษา', icon:'🏫', short:'โรงเรียน' },
        { val:'สถานที่ราชการ / โรงพยาบาล', icon:'🏥', short:'ราชการ/รพ.' },
        { val:'บริษัทเอกชน / ห้าง / ธนาคาร', icon:'🏢', short:'บริษัท/ห้าง' },
        { val:'ตลาด / ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ', icon:'🛒', short:'ตลาด/ร้านค้า' },
        { val:'โรงงาน / โกดัง / คลังสินค้า', icon:'🏭', short:'โรงงาน/โกดัง' },
        { val:'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม', icon:'🌾', short:'เกษตร/ไร่นา' },
        { val:'สถานที่ท่องเที่ยว / ออกกำลังกาย', icon:'🏖️', short:'ท่องเที่ยว' },
        { val:'วัด / โบสถ์ / มัสยิด / ศาลเจ้า', icon:'⛩️', short:'ศาสนสถาน' },
        { val:'บ้านที่ไม่ใช่ของตัวเอง', icon:'🏘️', short:'บ้านผู้อื่น' },
        { val:'อื่น ๆ', icon:'📍', short:'อื่น ๆ' }
      ]
    }
  },

  _formsApp: 'roadside',
  _optionsDoc: null,
  _draft: null,          // ชุดที่กำลังแก้อยู่ (ยังไม่บันทึก)

  // ชุดไอคอนให้เลือก — ครอบคลุมของที่ใช้จริงในงานสำรวจ
  ICONS: {
    vehicleTypes:      ['🚲','🛵','🛺','🚗','🛻','🚐','🚌','🚚','🚛','🚜','🚕','🏍️','🚙','🚓','🚑','🚒','🛴','🚈','⛴️','🚘'],
    purposeCards:      ['🏠','💼','📚','🏛️','🏥','📦','🛒','🍽️','🏖️','⛩️','🎓','🏭','🌾','⚽','🎬','🏦','✈️','🚉','💊','❓'],
    locationTypeCards: ['🏠','🏫','🏥','🏢','🛒','🏭','🌾','🏖️','⛩️','🏘️','🏬','🏨','🏦','🚉','✈️','🏟️','🌳','🅿️','🏪','📍']
  },

  KINDS: {
    vehicleTypes:      { title: 'ประเภทรถ',                        label: 'ชื่อประเภทรถ' },
    purposeCards:      { title: 'วัตถุประสงค์การเดินทาง',          label: 'ข้อความ' },
    locationTypeCards: { title: 'ประเภทสถานที่ต้นทาง/ปลายทาง',    label: 'ข้อความ' }
  },

  async _renderForms() {
    const app = this._formsApp;
    this._g('ptBody').innerHTML = `
      <div class="pt-hint">
        แก้ตัวเลือกที่ผู้สำรวจเห็นในแบบสอบถามของ<b>โครงการนี้เท่านั้น</b> —
        โครงการอื่นไม่กระทบ · ไม่แก้ = ใช้ชุดมาตรฐาน (ผังเมือง)<br>
        ใช้ตอนโครงการมีชุดตัวเลือกต่างออกไป เช่น <b>ทางหลวงชนบท</b>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="pt-tab ${app==='roadside'?'on':''}" data-fapp="roadside">🚦 Roadside</button>
        <button class="pt-tab ${app==='home'?'on':''}" data-fapp="home">🏠 Home</button>
      </div>
      <div id="ptFormsBody"><div class="pt-empty">กำลังโหลด...</div></div>`;
    this._g('ptBody').querySelectorAll('[data-fapp]').forEach(b =>
      b.onclick = () => { this._formsApp = b.dataset.fapp; this._draft = null; this._renderForms(); });

    try {
      const snap = await Project.cfg(db, 'options').get();
      this._optionsDoc = snap.exists ? snap.data() : {};
    } catch (_) { this._optionsDoc = {}; }
    this._draft = null;
    this._renderFormsBody();
  },

  _kindsFor(app) {
    // ประเภทรถของ Home แก้ไม่ได้ — ผูกกับกติกา modeRequiresVehicle (โหมดไหนต้องมีรถประเภทนั้นในบ้าน)
    return app === 'roadside'
      ? ['vehicleTypes', 'purposeCards', 'locationTypeCards']
      : ['purposeCards', 'locationTypeCards'];
  },

  _buildDraft() {
    const app = this._formsApp;
    const cur = (this._optionsDoc && this._optionsDoc[app]) || {};
    const def = this.DEFAULTS[app] || this.DEFAULTS.roadside;
    this._draft = {};
    this._kindsFor(app).forEach(k => {
      // clone ลึก — จะได้แก้ draft โดยไม่แตะค่ามาตรฐาน
      this._draft[k] = JSON.parse(JSON.stringify(cur[k] || def[k] || []));
    });
  },

  _renderFormsBody() {
    if (!this._draft) this._buildDraft();
    const app = this._formsApp;
    const cur = (this._optionsDoc && this._optionsDoc[app]) || {};
    this._g('ptFormsBody').innerHTML =
      this._kindsFor(app).map(k => `
        <div class="pt-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
            <div style="font-size:14px;font-weight:700;color:#f5f5f7">${this.KINDS[k].title}
              ${cur[k] ? '<span style="font-size:11px;font-weight:600;color:#ffd60a;background:rgba(255,159,10,.15);border:1px solid rgba(255,159,10,.3);padding:2px 9px;border-radius:99px;margin-left:7px">แก้ไว้แล้ว</span>'
                       : '<span style="font-size:11px;color:#8e8e93;margin-left:7px">ใช้ค่ามาตรฐาน</span>'}
            </div>
            <button class="pt-btn-g" data-reset="${k}">คืนค่ามาตรฐาน</button>
          </div>
          ${k === 'vehicleTypes' ? '<div style="font-size:11.5px;color:#8e8e93;line-height:1.7;margin-bottom:10px">กลุ่ม <b>รถบรรทุก</b> จะถูกถามเรื่องสินค้าที่ขนส่งต่อ · <b>รหัส</b>ของรายการที่มีอยู่แล้วเปลี่ยนไม่ได้ เพราะข้อมูลที่เก็บไปแล้วอ้างถึงรหัสนี้</div>' : ''}
          <div id="ptRows_${k}"></div>
          <button class="pt-btn-g" data-add="${k}" style="margin-top:6px">➕ เพิ่มรายการ</button>
        </div>`).join('') +
      `<button class="pt-btn" id="ptOptSave">บันทึกตัวเลือก</button>
       <div class="pt-msg" id="ptOptMsg"></div>`;

    this._kindsFor(app).forEach(k => this._renderRows(k));
    this._g('ptOptSave').onclick = () => this._saveOptions();
    this._g('ptFormsBody').querySelectorAll('[data-add]').forEach(b =>
      b.onclick = () => this._addRow(b.dataset.add));
    this._g('ptFormsBody').querySelectorAll('[data-reset]').forEach(b =>
      b.onclick = () => {
        if (!confirm('คืน "' + this.KINDS[b.dataset.reset].title + '" กลับเป็นชุดมาตรฐาน?\nรายการที่แก้ไว้จะหายไป')) return;
        const def = this.DEFAULTS[app] || this.DEFAULTS.roadside;
        this._draft[b.dataset.reset] = JSON.parse(JSON.stringify(def[b.dataset.reset] || []));
        this._renderRows(b.dataset.reset);
      });
  },

  _renderRows(kind) {
    const rows = this._draft[kind] || [];
    const isVeh = kind === 'vehicleTypes';
    const saved = ((this._optionsDoc || {})[this._formsApp] || {})[kind] || [];
    const savedKeys = new Set(saved.map(v => v.key));
    const box = this._g('ptRows_' + kind);
    if (!box) return;

    box.innerHTML = rows.length ? rows.map((r, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <button class="pt-btn-g" data-icon="${kind}:${i}" title="เลือกไอคอน"
                style="font-size:18px;padding:5px 10px;min-width:44px">${this._esc(r.icon || '📍')}</button>
        <input class="pt-in" style="flex:1;min-width:170px" data-f="${kind}:${i}:${isVeh?'label':'val'}"
               value="${this._esc(isVeh ? (r.label||'') : (r.val||''))}" placeholder="${this.KINDS[kind].label}" />
        ${isVeh ? `
          <input class="pt-in" style="width:110px" data-f="${kind}:${i}:key" value="${this._esc(r.key||'')}"
                 placeholder="รหัส" ${savedKeys.has(r.key) ? 'readonly title="รหัสนี้ถูกใช้เก็บข้อมูลไปแล้ว เปลี่ยนไม่ได้" style="width:110px;opacity:.6"' : ''} />
          <select class="pt-in" style="width:130px" data-f="${kind}:${i}:group">
            ${[['personal','ส่วนบุคคล'],['bus','รถโดยสาร'],['truck','รถบรรทุก']]
              .map(([v,t]) => `<option value="${v}"${(r.group||'personal')===v?' selected':''}>${t}</option>`).join('')}
          </select>` : ''}
        ${kind === 'locationTypeCards' ? `
          <input class="pt-in" style="width:130px" data-f="${kind}:${i}:short"
                 value="${this._esc(r.short||'')}" placeholder="ชื่อย่อ" />` : ''}
        <button class="pt-btn-g" data-mv="${kind}:${i}:-1" title="เลื่อนขึ้น" ${i===0?'disabled style="opacity:.3"':''}>↑</button>
        <button class="pt-btn-g" data-mv="${kind}:${i}:1" title="เลื่อนลง" ${i===rows.length-1?'disabled style="opacity:.3"':''}>↓</button>
        <button class="pt-btn-d" data-del="${kind}:${i}" title="ลบรายการนี้">ลบ</button>
      </div>`).join('')
      : '<div class="pt-empty">ยังไม่มีรายการ — กด "เพิ่มรายการ"</div>';

    // พิมพ์แล้วเก็บลง draft เลย ไม่ re-render (ไม่งั้นเคอร์เซอร์เด้งทุกตัวอักษร)
    box.querySelectorAll('[data-f]').forEach(el => {
      el.oninput = el.onchange = () => {
        const [k, i, f] = el.dataset.f.split(':');
        this._draft[k][+i][f] = el.value;
      };
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const [k, i] = b.dataset.del.split(':');
      this._draft[k].splice(+i, 1);
      this._renderRows(k);
    });
    box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const [k, i, d] = b.dataset.mv.split(':');
      const a = this._draft[k], from = +i, to = from + (+d);
      if (to < 0 || to >= a.length) return;
      [a[from], a[to]] = [a[to], a[from]];
      this._renderRows(k);
    });
    box.querySelectorAll('[data-icon]').forEach(b => b.onclick = () => {
      const [k, i] = b.dataset.icon.split(':');
      this._pickIcon(k, +i, b);
    });
  },

  // จานไอคอน — เลือกจากที่ให้ หรือพิมพ์เองก็ได้
  _pickIcon(kind, idx, anchor) {
    document.getElementById('ptIconPop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'ptIconPop';
    pop.setAttribute('style',
      'position:fixed;z-index:9500;background:#2c2c2e;border:1px solid rgba(255,255,255,.14);' +
      'border-radius:12px;padding:12px;box-shadow:0 12px 34px rgba(0,0,0,.5);max-width:280px');
    pop.innerHTML =
      `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px">
        ${(this.ICONS[kind] || []).map(ic =>
          `<button data-ic="${ic}" style="font-size:19px;background:#1c1c1e;border:1px solid #3a3a3c;border-radius:8px;padding:6px;cursor:pointer">${ic}</button>`).join('')}
      </div>
      <div style="margin-top:9px;display:flex;gap:6px;align-items:center">
        <input id="ptIconCustom" class="pt-in" style="width:70px;text-align:center" maxlength="4" placeholder="อื่นๆ" />
        <button class="pt-btn-g" id="ptIconOk">ใช้อันนี้</button>
      </div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 300) + 'px';
    pop.style.top  = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 10) + 'px';

    const set = ic => { this._draft[kind][idx].icon = ic; pop.remove(); this._renderRows(kind); };
    pop.querySelectorAll('[data-ic]').forEach(b => b.onclick = () => set(b.dataset.ic));
    pop.querySelector('#ptIconOk').onclick = () => {
      const v = pop.querySelector('#ptIconCustom').value.trim();
      if (v) set(v);
    };
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('click', h); }
    }), 0);
  },

  _addRow(kind) {
    const a = this._draft[kind];
    if (kind === 'vehicleTypes') {
      // รหัสต้องไม่ซ้ำ — ตั้งให้อัตโนมัติแล้วผู้ใช้แก้ได้ (เฉพาะรายการใหม่)
      let n = a.length + 1, key;
      do { key = 'v' + n++; } while (a.some(x => x.key === key));
      a.push({ key, label: '', icon: '🚗', group: 'personal' });
    } else if (kind === 'locationTypeCards') {
      a.push({ val: '', icon: '📍', short: '' });
    } else {
      a.push({ val: '', icon: '❓' });
    }
    this._renderRows(kind);
  },

  // เทียบกับค่ามาตรฐานแบบไม่สนลำดับ key ของ object
  _same(kind, a, b) {
    const norm = arr => JSON.stringify((arr || []).map(r => kind === 'vehicleTypes'
      ? [r.key, r.label, r.icon, r.group]
      : kind === 'locationTypeCards' ? [r.icon, r.val, r.short] : [r.icon, r.val]));
    return norm(a) === norm(b);
  },

  async _saveOptions() {
    const app = this._formsApp;
    const def = this.DEFAULTS[app] || this.DEFAULTS.roadside;
    const out = {};
    for (const kind of this._kindsFor(app)) {
      const arr = (this._draft[kind] || [])
        .map(r => kind === 'vehicleTypes'
          ? { key: (r.key||'').trim(), label: (r.label||'').trim(), icon: r.icon||'🚘', group: r.group||'personal' }
          : kind === 'locationTypeCards'
            ? { val: (r.val||'').trim(), icon: r.icon||'📍', short: (r.short||'').trim() || (r.val||'').trim() }
            : { val: (r.val||'').trim(), icon: r.icon||'❓' });

      const blank = arr.filter(r => kind === 'vehicleTypes' ? (!r.key || !r.label) : !r.val);
      if (blank.length) return this._msg('ptOptMsg',
        '"' + this.KINDS[kind].title + '" มีรายการที่ยังกรอกไม่ครบ ' + blank.length + ' รายการ — กรอกให้ครบหรือกดลบทิ้ง', false);
      if (!arr.length) return this._msg('ptOptMsg',
        '"' + this.KINDS[kind].title + '" ต้องมีอย่างน้อย 1 รายการ', false);

      if (kind === 'vehicleTypes') {
        const keys = arr.map(v => v.key);
        const dup = [...new Set(keys.filter((k,i) => keys.indexOf(k) !== i))];
        if (dup.length) return this._msg('ptOptMsg', 'รหัสประเภทรถซ้ำ: ' + dup.join(', '), false);
        if (!/^[a-zA-Z0-9_]+$/.test(keys.join(''))) return this._msg('ptOptMsg',
          'รหัสประเภทรถใช้ได้เฉพาะ a-z 0-9 และ _ (ห้ามเว้นวรรค/ภาษาไทย)', false);
      }
      const dupName = (() => {
        const names = arr.map(r => kind === 'vehicleTypes' ? r.label : r.val);
        return [...new Set(names.filter((n,i) => names.indexOf(n) !== i))];
      })();
      if (dupName.length) return this._msg('ptOptMsg',
        '"' + this.KINDS[kind].title + '" มีชื่อซ้ำ: ' + dupName.join(', '), false);

      if (!this._same(kind, arr, def[kind])) out[kind] = arr;
    }
    try {
      const doc = { ...(this._optionsDoc || {}) };
      if (Object.keys(out).length) doc[app] = out; else delete doc[app];
      doc.updatedAt = new Date().toISOString();
      await Project.cfg(db, 'options').set(doc);
      this._optionsDoc = doc;
      const okText = Object.keys(out).length
        ? '✅ บันทึกแล้ว — ผู้สำรวจจะเห็นชุดใหม่เมื่อเปิดแอปครั้งถัดไป'
        : '✅ กลับไปใช้ชุดมาตรฐานทั้งหมดแล้ว';
      this._draft = null;
      this._renderFormsBody();
      this._msg('ptOptMsg', okText, true);
    } catch (e) { this._msg('ptOptMsg', 'บันทึกไม่สำเร็จ: ' + e.message, false); }
  },

  // ═══════════ โซน & ข้อมูลทดสอบ ═══════════
  _renderMore() {
    const p = encodeURIComponent(Project.id());
    const t = (href, icon, title, desc, warn) => `
      <a class="pt-link" href="../tools/${href}?project=${p}">
        <span style="font-size:24px">${icon}</span>
        <span style="min-width:0">
          <span style="display:block;font-size:14.5px;font-weight:700;color:#f5f5f7">${title}</span>
          <span style="display:block;font-size:12.5px;color:#8e8e93;line-height:1.6;margin-top:2px">${desc}</span>
          ${warn ? `<span style="display:inline-block;font-size:11px;font-weight:600;color:#ff8a80;background:rgba(255,69,58,.14);border:1px solid rgba(255,138,128,.3);padding:2px 9px;border-radius:99px;margin-top:6px">${warn}</span>` : ''}
        </span>
      </a>`;
    this._g('ptBody').innerHTML = `
      <div class="pt-hint">
        ทุกอย่างในนี้ทำงานกับ<b>โครงการที่เปิดอยู่</b>เท่านั้น — ลิงก์พารหัสโครงการไปให้แล้ว
      </div>
      ${t('import-zones.html', '🗺', 'นำเข้าโซน', 'อัปโหลด shapefile (.zip) หรือ GeoJSON → ใช้ทำ OD matrix และแผนที่ choropleth ของโครงการนี้')}
      ${t('seed-places.html', '📍', 'นำเข้าคลังสถานที่', 'นำเข้าสถานที่จาก Excel/CSV ล่วงหน้า → ผู้สำรวจค้นเจอทันที ไม่ต้องยิง API')}
      <div style="font-size:14px;font-weight:700;color:#f5f5f7;margin:20px 0 12px">ข้อมูลทดสอบ</div>
      ${t('seed-home.html', '🏘', 'สร้างข้อมูลทดสอบ Home', 'สร้างครัวเรือน/สมาชิก/เที่ยวเดินทางจำลอง สำหรับลองระบบ', '⚠ ใช้กับโครงการทดสอบเท่านั้น')}
      ${t('seed-roadside.html', '🚦', 'สร้างข้อมูลทดสอบ Roadside', 'สร้างจุดสำรวจ + การสัมภาษณ์จำลอง', '⚠ ใช้กับโครงการทดสอบเท่านั้น')}
      ${t('cleanup-seed.html', '🧹', 'ลบข้อมูลทดสอบ', 'ลบเฉพาะข้อมูลที่รหัสมีคำว่า SEED — ข้อมูลจริงไม่ถูกแตะ')}`;
  }
};
