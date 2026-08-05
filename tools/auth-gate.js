/* 🔒 Tools auth gate — บังคับ login + ตรวจ role ว่าเป็น admin จริง
   - กันคนนอกเข้าหน้าเครื่องมือ: ต้องเป็นบัญชีจริง (ไม่ใช่ anonymous) + role admin ใน users/{uid}
   - ความปลอดภัยจริงยังอยู่ที่ Firestore rules — gate นี้บังคับ identity + กัน UI
   - ใช้ร่วมทุกหน้าใน tools/ : <script src="auth-gate.js"></script>
   - ต้องโหลด firebase-app-compat + auth-compat + firestore-compat ไว้ในหน้าด้วย
   - หน้าที่ต้อง bootstrap ระบบบัญชี (users.html) ให้ตั้ง window._AUTH_GATE_ALLOW_BOOTSTRAP = true
     ก่อนโหลดไฟล์นี้ → ผ่านได้ด้วยบัญชีจริงที่ยังไม่มี users doc (สิทธิ์จริงบังคับที่ rules อยู่ดี) */
(function () {
  var EMAIL_DOMAIN = '@interview-survey.local';
  var ALLOW_BOOTSTRAP = !!window._AUTH_GATE_ALLOW_BOOTSTRAP;
  var CFG = {
    apiKey:            'AIzaSyB7uSMVYta28csoka_Kj160U1OuCFHvNWs',
    authDomain:        'interview-survey.firebaseapp.com',
    projectId:         'interview-survey',
    storageBucket:     'interview-survey.firebasestorage.app',
    messagingSenderId: '563577463134',
    appId:             '1:563577463134:web:b55381c292cb5433b7afcf'
  };

  var ov, statusEl;

  // ---- overlay เต็มจอ (บล็อกหน้า) ----
  function injectOverlay() {
    if (ov || !document.body) return;
    ov = document.createElement('div');
    ov.id = '_authgate';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
      'font-family:Sarabun,system-ui,sans-serif;padding:24px;';
    ov.innerHTML =
      '<div style="font-size:40px">🔒</div>' +
      '<div style="color:#f1f5f9;font-size:18px;font-weight:700">เครื่องมือสำหรับผู้ดูแล</div>' +
      '<div id="_agStatus" style="color:#94a3b8;font-size:13px">กำลังเชื่อมต่อ...</div>';
    document.body.appendChild(ov);
    statusEl = ov.querySelector('#_agStatus');
  }

  // ---- ฟอร์ม login (แสดงเมื่อยังไม่ได้ login) ----
  function showLoginForm(auth) {
    if (!ov) return;
    ov.innerHTML =
      '<div style="font-size:40px">🔒</div>' +
      '<div style="color:#f1f5f9;font-size:18px;font-weight:700">เครื่องมือสำหรับผู้ดูแล</div>' +
      '<div style="color:#94a3b8;font-size:13px">เข้าสู่ระบบด้วยบัญชี Admin</div>' +
      '<input id="_agU" type="text" placeholder="ชื่อผู้ใช้" autocomplete="username" ' +
        'style="padding:12px 16px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:15px;width:240px;outline:none" />' +
      '<input id="_agP" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" ' +
        'style="padding:12px 16px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:15px;width:240px;outline:none" />' +
      '<button id="_agB" style="padding:12px 28px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;font-size:15px;cursor:pointer;width:240px">เข้าสู่ระบบ</button>' +
      '<div id="_agE" style="color:#f87171;font-size:13px;height:16px"></div>';
    var u = ov.querySelector('#_agU'), p = ov.querySelector('#_agP'),
        b = ov.querySelector('#_agB'), e = ov.querySelector('#_agE');
    function go() {
      var user = (u.value || '').trim().toLowerCase().replace(/\s+/g, ''), pw = p.value;
      if (!user || !pw) { e.textContent = 'กรุณากรอกให้ครบ'; return; }
      var email = user.indexOf('@') >= 0 ? user : user + EMAIL_DOMAIN;
      b.disabled = true; b.textContent = '⌛ กำลังตรวจสอบ...'; e.textContent = '';
      auth.signInWithEmailAndPassword(email, pw)
        .catch(function () {
          b.disabled = false; b.textContent = 'เข้าสู่ระบบ';
          e.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
          p.value = ''; p.focus();
        });
      // สำเร็จ → onAuthStateChanged จะลบ overlay เอง
    }
    b.onclick = go;
    p.onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
    u.onkeydown = function (ev) { if (ev.key === 'Enter') p.focus(); };
    setTimeout(function () { u.focus(); }, 50);
  }

  // ---- ข้อความปฏิเสธ (login แล้วแต่ไม่ใช่ admin) ----
  function showDenied(auth, text) {
    if (!ov) return;
    ov.innerHTML =
      '<div style="font-size:40px">⛔</div>' +
      '<div style="color:#f1f5f9;font-size:18px;font-weight:700">เครื่องมือนี้สำหรับผู้ดูแลเท่านั้น</div>' +
      '<div style="color:#94a3b8;font-size:13px;text-align:center;max-width:320px;line-height:1.6">' + text + '</div>' +
      '<button id="_agOut" style="padding:10px 24px;border:none;border-radius:10px;background:#334155;color:#cbd5e1;font-weight:600;font-size:14px;cursor:pointer">ออกจากระบบ</button>';
    ov.querySelector('#_agOut').onclick = function () { auth.signOut(); };
  }

  // ---- firebase พร้อมหรือยัง (init ถ้ายังไม่ init) ----
  function getAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CFG);
      return firebase.auth();
    } catch (e) { return null; }
  }

  // ---- อ่าน role จาก users/{uid} ----
  // คืน 'admin' | 'staff' | 'none' | 'error'
  function fetchRole(user) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return Promise.resolve('error');
    return firebase.firestore().collection('users').doc(user.uid).get()
      .then(function (snap) {
        if (!snap.exists) return 'none';
        var d = snap.data();
        return d.disabled === true ? 'none' : (d.role || 'none');
      })
      .catch(function () { return 'error'; });
  }

  function start() {
    injectOverlay();
    var tries = 0;
    (function wait() {
      var auth = getAuth();
      if (auth) {
        auth.onAuthStateChanged(function (user) {
          // ⚠️ ต้องเช็ค isAnonymous ด้วย — session ของผู้สำรวจ (anonymous) ใช้ origin เดียวกัน
          //    ถ้าเช็คแค่ truthy ผู้สำรวจที่เปิดแอป Home มาก่อนจะผ่าน gate นี้ทันที
          if (!user || user.isAnonymous) { showLoginForm(auth); return; }
          if (statusEl) statusEl.textContent = 'กำลังตรวจสอบสิทธิ์...';
          fetchRole(user).then(function (role) {
            if (role === 'admin') { if (ov) { ov.remove(); ov = null; } return; }
            // โหมด bootstrap (users.html): บัญชีจริงที่ยังไม่มี users doc ให้ผ่าน
            // เพื่อสร้าง doc admin คนแรกได้ — การเขียนจริงยังถูกบังคับด้วย Firestore rules
            if (ALLOW_BOOTSTRAP && (role === 'none' || role === 'error')) {
              if (ov) { ov.remove(); ov = null; }
              return;
            }
            var name = (user.email || '').replace(EMAIL_DOMAIN, '');
            showDenied(auth, role === 'staff'
              ? 'บัญชี <b>' + name + '</b> เป็นระดับ staff (ผู้ควบคุม) — ใช้ Dashboard แทน'
              : 'บัญชี <b>' + name + '</b> ยังไม่ได้รับสิทธิ์ — ติดต่อผู้ดูแลระบบ');
          });
        });
        return;
      }
      if (tries++ > 120) { // ~6s — Firebase SDK โหลดไม่สำเร็จ
        if (statusEl) statusEl.textContent = 'โหลด Firebase ไม่สำเร็จ — ต้องการอินเทอร์เน็ต แล้วรีเฟรช';
        return;
      }
      setTimeout(wait, 50);
    })();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
