// ===== FIREBASE SYNC — Roadside Interview =====
// Schema (cloud):
//   roadside_stations/{stId}                      ← station document
//   roadside_stations/{stId}/interviews/{ivId}    ← one doc per interview
//
// Delete: ไม่มีการลบจากเว็บเลย (rules: allow delete: if false)
// ปุ่ม "ลบ" ในเว็บลบเฉพาะ local cache เท่านั้น

const FB = {
  db:   null,
  auth: null,
  COLLECTION:   'roadside_stations',
  EMAIL_DOMAIN: '@interview-survey.local',

  init() {
    try {
      const cfg = {
        apiKey:            'AIzaSyB7uSMVYta28csoka_Kj160U1OuCFHvNWs',
        authDomain:        'interview-survey.firebaseapp.com',
        projectId:         'interview-survey',
        storageBucket:     'interview-survey.firebasestorage.app',
        messagingSenderId: '563577463134',
        appId:             '1:563577463134:web:b55381c292cb5433b7afcf'
      };
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      this.db   = firebase.firestore();
      this.auth = firebase.auth();
      // เปิด offline persistence — Firebase จัด queue offline writes ให้
      this.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      // ทุกเครื่องได้ token อัตโนมัติแบบ anonymous (ผู้สำรวจไม่ต้องสมัคร/ไม่รู้สึกอะไร)
      // ถ้ายังไม่มีใคร login → เซ็นชื่อ anonymous ไว้เขียน Firestore (curl ภายนอกไม่มี token → เขียนไม่ได้)
      this.auth.onAuthStateChanged(u => {
        if (!u) this.auth.signInAnonymously().catch(e => console.warn('[FB] anon signin:', e.code || e));
      });
    } catch (e) {
      console.error('[FB] init error:', e);
    }
  },

  // ===== AUTH =====
  // รับได้ทั้ง username (admin — ต่อ @interview-survey.local ให้) และอีเมลจริง (staff/ผู้ควบคุม)
  async loginAdmin(username, password) {
    if (!this.auth) throw new Error('Firebase Auth ไม่พร้อม');
    const u     = username.trim().toLowerCase().replace(/\s+/g,'');
    const email = u.includes('@') ? u : u + this.EMAIL_DOMAIN;
    const cred  = await this.auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async logoutAdmin() {
    if (this.auth) await this.auth.signOut();
  },

  onAuthStateChanged(cb) {
    if (!this.auth) { cb(null); return; }
    return this.auth.onAuthStateChanged(cb);
  },

  // ===== ขอบเขตโครงการ =====
  // ข้อมูลสำรวจทั้งหมดอยู่ใต้ projects/{pid} — ทุก read/write ต้องผ่าน _col()
  // โยน error ถ้ายังไม่ได้เลือกโครงการ (ดีกว่าเขียนหลงไปที่อื่นเงียบๆ)
  _col() { return Project.col(this.db, this.COLLECTION); },

  deviceId() {
    let id = localStorage.getItem('_is_device_id');
    if (!id) { id = 'DEV-' + Date.now(); localStorage.setItem('_is_device_id', id); }
    return id;
  },

  lastSync() { return localStorage.getItem('_is_ri_last_sync') || null; },

  _withTimeout(promise, ms = 20000) {
    return Promise.race([
      promise,
      new Promise((_,reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s)`)), ms)
      )
    ]);
  },

  // strip Firestore internal fields from doc data
  _stripInternal(d) {
    delete d._device; delete d._syncedAt;
    return d;
  },

  // ===== AUTO-PUSH (per-doc, บันทึกทีละรายการ) =====
  // เขียน doc เดียวแบบ fire-and-forget — ไม่มี _withTimeout เพื่อให้ offline persistence
  // คิวงานเองตอนเน็ตหลุด (promise ค้าง ส่งเมื่อออนไลน์) แล้ว badge อัปเดตเมื่อ server ack จริง
  _stData(st) { const { interviews, ...d } = st; return d; },

  _pushDoc(ref, data) {
    if (!this.db) return;
    const syncedAt = new Date().toISOString();
    ref.set({ ...data, _device: this.deviceId(), _syncedAt: syncedAt }, { merge: true })
      .then(() => {
        localStorage.setItem('_is_ri_last_sync', syncedAt);
        if (typeof App !== 'undefined' && App._refreshSyncBadge) App._refreshSyncBadge();
      })
      .catch(e => console.warn('[FB] auto-push:', e.code || e));  // console เท่านั้น — ไม่ toast
  },

  pushStation(st)         { if (st) this._pushDoc(this._col().doc(st.id), this._stData(st)); },
  pushInterview(stId, iv) { if (iv) this._pushDoc(this._col().doc(stId).collection('interviews').doc(iv.id), iv); },

  // ===== SYNC =====
  // admin: sync ทุก station + interview ที่อยู่ใน local
  // surveyor: sync เฉพาะ interview ของตัวเอง (ไม่แตะ station)
  // surveyorName = null → admin (ทั้งหมด)
  // supervisorName ระบุ → staff: เขียน station+interview เฉพาะจุดของทีมตัวเอง
  async syncAll(surveyorName, supervisorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    let sts = DB.getStationsRaw();   // raw: ต้องส่ง flag _deleted ขึ้น cloud ด้วย
    if (supervisorName) sts = sts.filter(st => st.supervisorName === supervisorName);
    if (!sts.length) throw new Error('ไม่มีข้อมูลในเครื่อง');
    const device   = this.deviceId();
    const syncedAt = new Date().toISOString();
    const isStaff  = !!supervisorName;
    const isAdmin  = !surveyorName && !supervisorName;
    const CHUNK    = 400;

    let stCount = 0;
    let ivCount = 0;
    let skippedGone = 0;    // จุดสำรวจถูกลบออกจากระบบแล้ว

    // ผู้สำรวจเขียน station ไม่ได้ → ถ้า parent ไม่มีบน cloud การเขียน interview
    // จะกลายเป็น "ข้อมูลผี" ใต้ doc ที่ไม่มีตัวตน (Dashboard/แอปมองไม่เห็น)
    let liveStationIds = null;
    if (!isAdmin && !isStaff) {
      try {
        const snap = await this._withTimeout(this._col().get({ source: 'server' }));
        liveStationIds = new Set(snap.docs.map(d => d.id));
      } catch (_) { liveStationIds = null; }   // เช็คไม่ได้ → ไม่บล็อก (ดีกว่าหยุดงานหน้างาน)
    }

    const batches = [];
    let batch    = this.db.batch();
    let ops      = 0;
    const flush = () => {
      if (ops > 0) batches.push(batch);
      batch = this.db.batch();
      ops   = 0;
    };
    const addOp = (ref, payload) => {
      batch.set(ref, payload, { merge: true });
      ops++;
      if (ops >= CHUNK) flush();
    };

    for (const st of sts) {
      const stRef = this._col().doc(st.id);

      // จุดสำรวจถูกลบออกจากระบบแล้ว → ข้ามทั้งจุด (กันเขียนเป็นข้อมูลผี)
      if (liveStationIds && !liveStationIds.has(st.id)) {
        skippedGone += (st.interviews || []).filter(iv => iv.surveyorName === surveyorName).length;
        continue;
      }

      // 1) เขียน station (admin ทั้งหมด · staff เฉพาะจุดของทีมตัวเอง)
      if (isAdmin || isStaff) {
        const { interviews, ...stData } = st;
        addOp(stRef, { ...stData, _device: device, _syncedAt: syncedAt });
        stCount++;
      }

      // 2) เขียน interviews (idempotent — doc id = iv.id)
      for (const iv of (st.interviews || [])) {
        if (!isAdmin && !isStaff && iv.surveyorName !== surveyorName) continue;
        const ivRef = stRef.collection('interviews').doc(iv.id);
        addOp(ivRef, { ...iv, _device: device, _syncedAt: syncedAt });
        ivCount++;
      }
    }
    flush();

    if (stCount === 0 && ivCount === 0) {
      if (skippedGone) throw new Error(`จุดสำรวจของข้อมูลในเครื่องถูกลบออกจากระบบแล้ว (${skippedGone} ราย) — ให้ผู้ดูแลสร้างจุดใหม่แล้วบันทึกใหม่`);
      throw new Error('ไม่มีข้อมูลใหม่ที่จะ sync');
    }

    for (const b of batches) {
      await this._withTimeout(b.commit());
    }

    localStorage.setItem('_is_ri_last_sync', syncedAt);
    return (isAdmin ? `${stCount} จุด · ${ivCount} ราย` : `${ivCount} ราย`)
         + (skippedGone ? ` · ข้ามจุดที่ถูกลบ ${skippedGone}` : '');
  },

  // ===== PULL: admin =====
  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    // 1) ดึง stations
    const stSnap = await this._withTimeout(
      this._col().get({ source: 'server' })
    );
    if (stSnap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');

    const stationMap = {};
    stSnap.docs.forEach(doc => {
      const d = this._stripInternal(doc.data());
      d.interviews = [];
      stationMap[doc.id] = d;
    });

    // 2) ดึง interview ของแต่ละ station แบบ parallel (ไม่ใช้ collectionGroup กัน index)
    const ivSnaps = await Promise.all(stSnap.docs.map(doc =>
      this._withTimeout(doc.ref.collection('interviews').get({ source: 'server' }))
    ));
    ivSnaps.forEach((snap, i) => {
      const stId = stSnap.docs[i].id;
      snap.docs.forEach(d => {
        stationMap[stId].interviews.push(this._stripInternal(d.data()));
      });
    });

    Object.values(stationMap).forEach(st => {
      st.interviews.sort((a,b) => (a.seq||0) - (b.seq||0));
    });

    const stations = Object.values(stationMap);
    const newData  = { stations };
    await DB.replaceAll(newData);
    return stations.length;
  },

  // ===== PULL: staff (ผู้ควบคุม) =====
  // เฉพาะจุดสำรวจของทีมตัวเอง แต่ได้ interview ครบทุกคนในจุดนั้น (ต้องคุมงานลูกทีมทั้งทีม)
  async pullBySupervisor(supervisorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const stSnap = await this._withTimeout(
      this._col()
        .where('supervisorName', '==', supervisorName)
        .get({ source: 'server' })
    );
    if (stSnap.empty) throw new Error('ยังไม่มีจุดสำรวจของทีมนี้ใน Firestore');

    const stationMap = {};
    stSnap.docs.forEach(doc => {
      const d = this._stripInternal(doc.data());
      d.interviews = [];
      stationMap[doc.id] = d;
    });
    const ivSnaps = await Promise.all(stSnap.docs.map(doc =>
      this._withTimeout(doc.ref.collection('interviews').get({ source: 'server' }))
    ));
    ivSnaps.forEach((snap, i) => {
      const stId = stSnap.docs[i].id;
      snap.docs.forEach(d => stationMap[stId].interviews.push(this._stripInternal(d.data())));
    });

    // merge: เก็บ interview ใน local ที่ยังไม่ได้ sync (ของจุดในทีมเดียวกัน) ไว้
    const local = DB.load();
    local.stations.forEach(ls => {
      const remote = stationMap[ls.id];
      // จุดที่มีเฉพาะในเครื่อง (ยังไม่ sync / ถูกลบบน cloud) → เก็บไว้ ห้ามทิ้ง
      if (!remote) {
        if (ls.supervisorName === supervisorName) stationMap[ls.id] = ls;
        return;
      }
      const ids = new Set(remote.interviews.map(iv => iv.id));
      const localOnly = (ls.interviews || []).filter(iv => !ids.has(iv.id));
      if (localOnly.length) remote.interviews = [...remote.interviews, ...localOnly];
    });
    Object.values(stationMap).forEach(st => st.interviews.sort((a,b) => (a.seq||0) - (b.seq||0)));

    const stations = Object.values(stationMap);
    await DB.replaceAll({ stations });
    return stations.length;
  },

  // ===== PULL: surveyor =====
  // เห็นทุก station แต่ดึง interview เฉพาะของตัวเอง (where ที่ subcollection ไม่ต้อง index)
  async pullBySurveyor(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');

    const stSnap = await this._withTimeout(
      this._col().get({ source: 'server' })
    );
    if (stSnap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');

    const stationMap = {};
    stSnap.docs.forEach(doc => {
      const d = this._stripInternal(doc.data());
      d.interviews = [];
      stationMap[doc.id] = d;
    });

    // ดึง interview subcollection ของแต่ละ station แบบ parallel
    // ใช้ where ที่ระดับ subcollection (single-collection query — ไม่ต้องสร้าง composite index)
    const ivSnaps = await Promise.all(stSnap.docs.map(doc =>
      this._withTimeout(
        doc.ref.collection('interviews')
          .where('surveyorName', '==', surveyorName)
          .get({ source: 'server' })
      )
    ));
    ivSnaps.forEach((snap, i) => {
      const stId = stSnap.docs[i].id;
      snap.docs.forEach(d => {
        stationMap[stId].interviews.push(this._stripInternal(d.data()));
      });
    });

    Object.values(stationMap).forEach(st => {
      st.interviews.sort((a,b) => (a.seq||0) - (b.seq||0));
    });

    // merge: เก็บ interview ของฉันใน local ที่ยังไม่ได้ sync เพิ่มเข้าไป
    const local = DB.load();
    local.stations.forEach(ls => {
      const remote = stationMap[ls.id];
      // จุดที่มีเฉพาะในเครื่อง (ถูกลบบน cloud แล้ว) → เก็บไว้ถ้ายังมีงานของเราค้างอยู่
      // ไม่งั้นกด "ดึงข้อมูล" ครั้งเดียวข้อมูลที่ยังไม่ sync หายหมด
      if (!remote) {
        const mine = (ls.interviews || []).filter(iv => iv.surveyorName === surveyorName);
        if (mine.length) stationMap[ls.id] = { ...ls, interviews: mine };
        return;
      }
      const remoteIds = new Set(remote.interviews.map(iv => iv.id));
      const localOnly = (ls.interviews || []).filter(iv =>
        iv.surveyorName === surveyorName && !remoteIds.has(iv.id)
      );
      if (localOnly.length) {
        remote.interviews = [...remote.interviews, ...localOnly]
          .sort((a,b) => (a.seq||0) - (b.seq||0));
      }
    });

    const stations = Object.values(stationMap);
    const newData  = { stations };
    await DB.replaceAll(newData);
    return stations.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
