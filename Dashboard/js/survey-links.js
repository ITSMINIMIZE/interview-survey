// ===== ระบบออกลิงก์แบบสอบถาม (เปิดจากปุ่มมุมขวาบนของ Dashboard) =====
//
// แทนที่การให้ผู้สำรวจเข้าหน้าเว็บแล้วเลือกโครงการ/แบบสอบถามเอง —
// ผู้ดูแลออกลิงก์ให้ 1 ใบต่อทีม/ต่อแบบสอบถาม แล้วส่งทาง LINE/QR
//
// เก็บที่ surveyLinks/{token} (ระดับระบบ ไม่ใช่ใต้โครงการ) เพื่อให้ resolve
// ได้จาก token อย่างเดียว · rules: get เปิด (token คือความลับ) · list ปิด
const SurveyLinks = {
  _links: [],
  _built: false,

  APPS: {
    home:     { name: 'Home Interview',     icon: '🏠', path: 'Home',     color: '#409cff' },
    roadside: { name: 'Roadside Interview', icon: '🚦', path: 'Roadside', color: '#ff9f0a' }
  },

  // ---------- utils ----------
  _esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  // token 16 ตัว จาก crypto (เดาไม่ได้) — คือตัวความลับของลิงก์
  _newToken() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด 0/O/1/l/I ออก กันอ่านผิด
    const a = new Uint32Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, n => abc[n % abc.length]).join('');
  },

  // URL เต็มของลิงก์ — ../ ออกจาก Dashboard/ ไปที่รากของเว็บ
  url(link) {
    const base = new URL('../', location.href).href.replace(/\/$/, '');
    const app  = this.APPS[link.app] || this.APPS.home;
    return `${base}/${app.path}/?project=${encodeURIComponent(link.projectId)}&k=${encodeURIComponent(link.token)}`;
  },

  // ลิงก์ดูตัวอย่าง — ไม่มี token เพราะไม่ได้ให้เก็บข้อมูล (โหมดนี้เขียนอะไรไม่ได้เลย)
  // ไม่ต้องออกใหม่ทีละใบ ไม่ต้องปิด ไม่มีวันหมดอายุ — เป็นแค่ที่อยู่ตายตัวของโครงการ
  previewUrl(app) {
    const base = new URL('../', location.href).href.replace(/\/$/, '');
    const a    = this.APPS[app] || this.APPS.home;
    return `${base}/${a.path}/?project=${encodeURIComponent(Project.id())}&preview=1`;
  },

  // ---------- modal ----------
  _build() {
    if (this._built) return;
    const wrap = document.createElement('div');
    wrap.id = 'slModal';
    wrap.setAttribute('style',
      'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:none;' +
      'align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto');
    wrap.innerHTML = `
      <div style="background:#2c2c2e;border:1px solid rgba(255,255,255,.12);border-radius:12px;max-width:760px;width:100%;padding:26px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:6px">
          <div>
            <div style="font-size:19px;font-weight:700;color:#f5f5f7">🔗 ลิงก์แบบสอบถาม</div>
            <div style="font-size:13px;color:#8e8e93;margin-top:3px" id="slProj"></div>
          </div>
          <button id="slClose" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:8px;cursor:pointer">ปิด</button>
        </div>

        <div style="font-size:12.5px;color:#8e8e93;line-height:1.75;margin:12px 0 18px">
          ผู้สำรวจไม่ต้องมีบัญชี — เปิดลิงก์แล้วเข้าแบบสอบถามของโครงการนี้ได้เลย<br>
          <b style="color:#ff8a80">ใครถือลิงก์ก็ส่งข้อมูลได้</b> — ปิดลิงก์ได้ทุกเมื่อจากรายการด้านล่าง
        </div>

        <div style="background:rgba(255,214,10,.06);border:1px solid rgba(255,214,10,.28);border-radius:12px;padding:18px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:700;color:#ffd60a;margin-bottom:6px">👁 ลิงก์ดูตัวอย่าง (สำหรับผู้ตรวจ)</div>
          <div style="font-size:12.5px;color:#98989d;line-height:1.75;margin-bottom:14px">
            เปิดดูได้ทุกหน้าโดยไม่ต้องมีบัญชี · มีข้อมูลสมมติให้ดู · สลับมุมมองผู้สำรวจ/ผู้ควบคุม/ผู้ดูแลได้<br>
            <b style="color:#63e6a0">กรอกอะไรลงไปก็ไม่ถูกบันทึกและไม่ขึ้นระบบ</b> — ใช้ลิงก์เดิมได้ตลอด ไม่ต้องออกใหม่
          </div>
          <div id="slPreview" style="display:grid;gap:10px"></div>
        </div>

        <div style="background:#1c1c1e;border:1px solid #3a3a3c;border-radius:12px;padding:18px;margin-bottom:20px">
          <div style="font-size:14px;font-weight:700;color:#f5f5f7;margin-bottom:14px">ออกลิงก์ใหม่ (สำหรับผู้สำรวจ — เก็บข้อมูลจริง)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" id="slFormGrid">
            <div>
              <label style="display:block;font-size:12px;color:#98989d;font-weight:600;margin-bottom:5px">แบบสอบถาม *</label>
              <select id="slApp" style="width:100%;padding:10px 12px;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:9px;color:#e5e5ea;font-size:14px;font-family:inherit">
                <option value="home">🏠 Home Interview — สัมภาษณ์ในบ้าน</option>
                <option value="roadside">🚦 Roadside Interview — สัมภาษณ์ริมทาง</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#98989d;font-weight:600;margin-bottom:5px">ผู้ควบคุม / ทีม</label>
              <select id="slSup" style="width:100%;padding:10px 12px;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:9px;color:#e5e5ea;font-size:14px;font-family:inherit"></select>
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#98989d;font-weight:600;margin-bottom:5px">ป้ายกำกับ (ไว้จำว่าให้ใคร)</label>
              <input id="slLabel" placeholder="เช่น ทีมสมชาย รอบเช้า" style="width:100%;padding:10px 12px;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:9px;color:#e5e5ea;font-size:14px;font-family:inherit" />
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#98989d;font-weight:600;margin-bottom:5px">วันหมดอายุ (ว่าง = ไม่หมด)</label>
              <input id="slExp" type="date" style="width:100%;padding:10px 12px;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:9px;color:#e5e5ea;font-size:14px;font-family:inherit" />
            </div>
          </div>
          <button id="slCreate" style="margin-top:14px;background:#0a84ff;color:#fff;border:none;font-family:inherit;font-size:14px;font-weight:600;padding:10px 18px;border-radius:9px;cursor:pointer">ออกลิงก์</button>
          <div id="slMsg" style="display:none;margin-top:12px;padding:10px 13px;border-radius:9px;font-size:13px;line-height:1.6"></div>
        </div>

        <div style="font-size:14px;font-weight:700;color:#f5f5f7;margin-bottom:12px">ลิงก์ของโครงการนี้</div>
        <div id="slList"></div>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById('slClose').onclick = () => this.close();
    wrap.addEventListener('click', e => { if (e.target === wrap) this.close(); });
    document.getElementById('slCreate').onclick = () => this.create();
    this._built = true;
  },

  _msg(text, ok) {
    const el = document.getElementById('slMsg');
    el.style.display = 'block';
    el.textContent = text;
    el.style.background = ok ? 'rgba(48,209,88,.12)' : 'rgba(255,69,58,.12)';
    el.style.color      = ok ? '#63e6a0' : '#ff8a80';
    el.style.border     = '1px solid ' + (ok ? 'rgba(48,209,88,.25)' : 'rgba(255,138,128,.25)');
  },

  async open() {
    this._build();
    document.getElementById('slModal').style.display = 'flex';
    document.getElementById('slProj').textContent =
      'โครงการ: ' + (Project.meta ? Project.meta.name : Project.id());
    document.getElementById('slMsg').style.display = 'none';
    // ออกลิงก์ได้เฉพาะแบบสอบถามที่โครงการเปิดใช้ — ไม่งั้นแจกลิงก์ไปแล้วผู้สำรวจเปิดมาเจอหน้าเปล่า
    const a = (Project.meta && Project.meta.apps) || {};
    const sel = document.getElementById('slApp');
    const opts = [];
    if (a.home     !== false) opts.push('<option value="home">🏠 Home Interview — สัมภาษณ์ในบ้าน</option>');
    if (a.roadside !== false) opts.push('<option value="roadside">🚦 Roadside Interview — สัมภาษณ์ริมทาง</option>');
    sel.innerHTML = opts.join('');
    document.getElementById('slCreate').disabled = !opts.length;
    this._renderPreview(a);
    await Promise.all([this._loadSupervisors(), this.refresh()]);
  },

  // ลิงก์ดูตัวอย่าง — ขึ้นเฉพาะแบบสอบถามที่โครงการนี้เปิดใช้ (เหมือนลิงก์จริง)
  _renderPreview(apps) {
    const box = document.getElementById('slPreview');
    if (!box) return;
    const rows = ['home', 'roadside']
      .filter(k => apps[k] !== false)
      .map(k => {
        const a   = this.APPS[k];
        const url = this.previewUrl(k);
        return `<div style="background:#1c1c1e;border:1px solid #3a3a3c;border-radius:10px;padding:13px 15px">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
            <div style="font-size:14px;font-weight:700;color:#f5f5f7">${a.icon} ${this._esc(a.name)}</div>
            <div style="display:flex;gap:7px;flex-wrap:wrap">
              <button data-pvcopy="${k}" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer">📋 คัดลอก</button>
              <a href="${this._esc(url)}" target="_blank" rel="noopener" style="background:rgba(255,214,10,.15);border:1px solid rgba(255,214,10,.32);color:#ffd60a;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;text-decoration:none">↗ เปิดดู</a>
            </div>
          </div>
          <div style="margin-top:9px;font-size:11.5px;color:#8e8e93;word-break:break-all;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:8px;padding:8px 11px">${this._esc(url)}</div>
        </div>`;
      });
    box.innerHTML = rows.join('') ||
      '<div style="color:#8e8e93;font-size:13px">โครงการนี้ยังไม่ได้เปิดใช้แบบสอบถามใด</div>';
    box.querySelectorAll('[data-pvcopy]').forEach(b =>
      b.onclick = () => this._copyText(this.previewUrl(b.dataset.pvcopy), b));
  },

  async _copyText(url, btn) {
    try {
      await navigator.clipboard.writeText(url);
      const old = btn.textContent;
      btn.textContent = '✓ คัดลอกแล้ว';
      setTimeout(() => { btn.textContent = old; }, 1600);
    } catch (_) {
      prompt('คัดลอกลิงก์นี้:', url);   // clipboard ถูกบล็อก (บางเบราว์เซอร์ต้อง https)
    }
  },

  close() { const m = document.getElementById('slModal'); if (m) m.style.display = 'none'; },

  // รายชื่อผู้ควบคุมของโครงการ — ให้ลิงก์ผูกทีมได้ตั้งแต่แรก
  async _loadSupervisors() {
    const sel = document.getElementById('slSup');
    try {
      const snap = await Project.cfg(db, 'supervisors').get();
      const list = (snap.exists ? snap.data().list : []) || [];
      sel.innerHTML = '<option value="">— ให้ผู้สำรวจเลือกเอง —</option>' +
        list.map(s => `<option value="${this._esc(s.key)}">${this._esc(s.name || s.key)}</option>`).join('');
    } catch (_) {
      sel.innerHTML = '<option value="">— ให้ผู้สำรวจเลือกเอง —</option>';
    }
  },

  async refresh() {
    const box = document.getElementById('slList');
    try {
      const snap = await db.collection('surveyLinks')
                           .where('projectId', '==', Project.id()).get();
      this._links = snap.docs.map(d => ({ token: d.id, ...d.data() }))
                             .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (e) {
      box.innerHTML = `<div style="color:#ff8a80;font-size:13px;padding:14px">อ่านรายการลิงก์ไม่ได้: ${this._esc(e.message)}</div>`;
      return;
    }
    if (!this._links.length) {
      box.innerHTML = '<div style="color:#8e8e93;font-size:13px;text-align:center;padding:26px;background:#1c1c1e;border:1px dashed #48484a;border-radius:12px">ยังไม่มีลิงก์ — ออกลิงก์แรกด้านบน</div>';
      return;
    }
    box.innerHTML = this._links.map(l => {
      const app = this.APPS[l.app] || this.APPS.home;
      const off = l.enabled === false;
      const expired = l.expiresAt && new Date(l.expiresAt) < new Date();
      const dead = off || expired;
      return `<div style="background:#1c1c1e;border:1px solid ${dead ? '#3a3a3c' : '#48484a'};border-radius:12px;padding:15px;margin-bottom:11px;opacity:${dead ? '.55' : '1'}">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div style="min-width:0">
            <div style="font-size:14.5px;font-weight:700;color:#f5f5f7">
              ${app.icon} ${this._esc(l.label || app.name)}
              ${dead ? `<span style="font-size:11px;font-weight:600;color:#98989d;background:rgba(142,142,147,.2);padding:2px 9px;border-radius:99px;margin-left:7px">${expired ? 'หมดอายุ' : 'ปิดอยู่'}</span>` : ''}
            </div>
            <div style="font-size:12px;color:#8e8e93;margin-top:3px">
              ${this._esc(app.name)}${l.supervisorName ? ' · ทีม ' + this._esc(l.supervisorName) : ''}${l.expiresAt ? ' · ถึง ' + this._esc(l.expiresAt.slice(0,10)) : ''}
            </div>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button data-copy="${this._esc(l.token)}" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer">📋 คัดลอก</button>
            <button data-qr="${this._esc(l.token)}" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer">⬜ QR</button>
            <button data-toggle="${this._esc(l.token)}" style="background:#3a3a3c;border:1px solid #48484a;color:#d1d1d6;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer">${off ? 'เปิด' : 'ปิด'}</button>
            <button data-del="${this._esc(l.token)}" style="background:rgba(255,69,58,.15);border:1px solid rgba(255,138,128,.3);color:#ff8a80;font-family:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer">ลบ</button>
          </div>
        </div>
        <div style="margin-top:10px;font-size:11.5px;color:#8e8e93;word-break:break-all;background:#2c2c2e;border:1px solid #3a3a3c;border-radius:8px;padding:8px 11px">${this._esc(this.url(l))}</div>
        <div data-qrbox="${this._esc(l.token)}" style="display:none;margin-top:12px;text-align:center"></div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => this.copy(b.dataset.copy, b));
    box.querySelectorAll('[data-qr]').forEach(b    => b.onclick = () => this.qr(b.dataset.qr));
    box.querySelectorAll('[data-toggle]').forEach(b=> b.onclick = () => this.toggle(b.dataset.toggle));
    box.querySelectorAll('[data-del]').forEach(b   => b.onclick = () => this.remove(b.dataset.del));
  },

  async create() {
    const app   = document.getElementById('slApp').value;
    const sup   = document.getElementById('slSup').value;
    const label = document.getElementById('slLabel').value.trim();
    const exp   = document.getElementById('slExp').value;
    const token = this._newToken();
    try {
      await db.collection('surveyLinks').doc(token).set({
        token,
        projectId:      Project.id(),
        app,
        label:          label || (this.APPS[app] || {}).name || '',
        supervisorName: sup || '',
        enabled:        true,
        expiresAt:      exp ? new Date(exp + 'T23:59:59').toISOString() : '',
        createdAt:      new Date().toISOString(),
        createdBy:      (firebase.auth().currentUser || {}).email || ''
      });
      document.getElementById('slLabel').value = '';
      document.getElementById('slExp').value = '';
      this._msg('✅ ออกลิงก์แล้ว — กด "คัดลอก" แล้วส่งให้ผู้สำรวจได้เลย', true);
      await this.refresh();
    } catch (e) {
      this._msg('ออกลิงก์ไม่สำเร็จ: ' + e.message, false);
    }
  },

  async copy(token, btn) {
    const l = this._links.find(x => x.token === token);
    if (!l) return;
    const url = this.url(l);
    try {
      await navigator.clipboard.writeText(url);
      const old = btn.textContent;
      btn.textContent = '✓ คัดลอกแล้ว';
      setTimeout(() => { btn.textContent = old; }, 1600);
    } catch (_) {
      // clipboard ถูกบล็อก (บางเบราว์เซอร์ต้อง https) → ให้เลือกเองด้วยมือ
      prompt('คัดลอกลิงก์นี้:', url);
    }
  },

  qr(token) {
    const l = this._links.find(x => x.token === token);
    const box = document.querySelector(`[data-qrbox="${token}"]`);
    if (!l || !box) return;
    if (box.style.display === 'block') { box.style.display = 'none'; return; }
    box.style.display = 'block';
    if (box.dataset.done) return;
    try {
      const q = qrcode(0, 'M');
      q.addData(this.url(l));
      q.make();
      box.innerHTML = `<div style="display:inline-block;background:#fff;padding:12px;border-radius:12px">${q.createImgTag(5, 8)}</div>
        <div style="font-size:11.5px;color:#8e8e93;margin-top:8px">ให้ผู้สำรวจสแกนด้วยกล้องมือถือ</div>`;
      box.dataset.done = '1';
    } catch (e) {
      box.innerHTML = `<div style="color:#ff8a80;font-size:12.5px">สร้าง QR ไม่ได้ (ต้องต่ออินเทอร์เน็ตครั้งแรกเพื่อโหลดตัวสร้าง QR)</div>`;
    }
  },

  async toggle(token) {
    const l = this._links.find(x => x.token === token);
    if (!l) return;
    try {
      await db.collection('surveyLinks').doc(token).update({ enabled: l.enabled === false });
      await this.refresh();
    } catch (e) { this._msg('เปลี่ยนสถานะไม่สำเร็จ: ' + e.message, false); }
  },

  async remove(token) {
    if (!confirm('ลบลิงก์นี้?\n\nผู้ที่ถือลิงก์จะเข้าไม่ได้อีกทันที\nข้อมูลที่เก็บมาแล้วยังอยู่ครบ')) return;
    try {
      await db.collection('surveyLinks').doc(token).delete();
      await this.refresh();
    } catch (e) { this._msg('ลบไม่สำเร็จ: ' + e.message, false); }
  }
};
