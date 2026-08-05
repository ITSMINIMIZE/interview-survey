// ===== FIREBASE SYNC — Home Interview (v2) =====
// Schema (cloud):
//   households/{hhId}                                ← household document
//   households/{hhId}/members/{mId}                  ← one doc per member
//   households/{hhId}/members/{mId}/trips/{tId}      ← one doc per trip
//
// Delete: rules forbid — ปุ่มลบในเว็บลบเฉพาะ local cache เท่านั้น
// Surveyor: เห็นเฉพาะข้อมูลของตัวเอง (where surveyorName == name ที่ root)
// Admin: เห็นทุก household
const FB = {
  db:   null,
  auth: null,
  COLLECTION:   'households',
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
      // เปิด offline persistence — Firebase queue offline writes ให้
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
    const u     = username.trim().toLowerCase().replace(/\s+/g, '');
    const email = u.includes('@') ? u : u + this.EMAIL_DOMAIN;
    const cred  = await this.auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },
  async logoutAdmin() { if (this.auth) await this.auth.signOut(); },
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
  lastSync() { return localStorage.getItem('_is_hi_last_sync') || null; },

  _withTimeout(promise, ms = 20000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s)`)), ms)
      )
    ]);
  },

  _strip(d) { delete d._device; delete d._syncedAt; return d; },

  // ===== AUTO-PUSH (per-doc, บันทึกทีละรายการ) =====
  // เขียน doc เดียวแบบ fire-and-forget — ไม่มี _withTimeout เพื่อให้ offline persistence
  // คิวงานเองตอนเน็ตหลุด (promise ค้าง ส่งเมื่อออนไลน์) แล้ว badge อัปเดตเมื่อ server ack จริง
  _hhData(hh)    { const { members, ...d } = hh; return d; },
  _memberData(m) { const { trips, ...d }  = m;  return d; },

  // projectId ติดไปกับทุก doc — collectionGroup ของ Dashboard ใช้ field นี้กรองโครงการ
  // (collectionGroup มองข้ามโครงสร้าง path จึงต้องมี field บอกว่า doc นี้ของโครงการไหน)
  // ⚠️ doc ที่ไม่มี projectId จะไม่ขึ้นในรายงานเลย — ห้ามถอดออก
  _pushDoc(ref, data) {
    if (!this.db) return;
    const syncedAt = new Date().toISOString();
    ref.set({ ...data, projectId: Project.id(), _device: this.deviceId(), _syncedAt: syncedAt }, { merge: true })
      .then(() => {
        localStorage.setItem('_is_hi_last_sync', syncedAt);
        if (typeof App !== 'undefined' && App._refreshSyncBadge) App._refreshSyncBadge();
      })
      .catch(e => console.warn('[FB] auto-push:', e.code || e));  // console เท่านั้น — ไม่ toast
  },

  pushHousehold(hh)      { if (hh) this._pushDoc(this._col().doc(hh.id), this._hhData(hh)); },
  pushMember(hhId, m)    { if (m)  this._pushDoc(this._col().doc(hhId).collection('members').doc(m.id), this._memberData(m)); },
  pushTrip(hhId, mId, t) { if (t)  this._pushDoc(this._col().doc(hhId).collection('members').doc(mId).collection('trips').doc(t.id), t); },

  // ===== SYNC =====
  // admin: sync ทุก household ใน local (รวม nested) ขึ้น cloud
  // surveyor: sync เฉพาะ household ของตัวเอง
  // value = null → ทั้งหมด (admin) · field: 'surveyorName' (ผู้สำรวจ) | 'supervisorName' (ผู้ควบคุม)
  async syncAll(value, field = 'surveyorName') {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    let hhs = DB.getHouseholdsRaw();   // raw: ต้องส่ง flag _deleted ขึ้น cloud ด้วย
    if (value) hhs = hhs.filter(h => h[field] === value);
    if (!hhs.length) throw new Error('ไม่มีข้อมูลที่จะ sync');

    const device   = this.deviceId();
    const pid      = Project.id();
    const syncedAt = new Date().toISOString();
    const CHUNK    = 400;

    const batches = [];
    let batch = this.db.batch();
    let ops   = 0;
    const flush = () => { if (ops > 0) batches.push(batch); batch = this.db.batch(); ops = 0; };
    const addOp = (ref, payload) => {
      batch.set(ref, payload, { merge: true });
      ops++;
      if (ops >= CHUNK) flush();
    };

    let hhCount = 0, mCount = 0, tCount = 0;

    for (const hh of hhs) {
      const hhRef = this._col().doc(hh.id);
      // เขียน household เฉพาะ field ของมัน (ไม่รวม members ใน array)
      const { members, ...hhData } = hh;
      addOp(hhRef, { ...hhData, projectId: pid, _device: device, _syncedAt: syncedAt });
      hhCount++;

      for (const m of (members || [])) {
        const mRef = hhRef.collection('members').doc(m.id);
        const { trips, ...mData } = m;
        addOp(mRef, { ...mData, projectId: pid, _device: device, _syncedAt: syncedAt });
        mCount++;

        for (const t of (trips || [])) {
          const tRef = mRef.collection('trips').doc(t.id);
          addOp(tRef, { ...t, projectId: pid, _device: device, _syncedAt: syncedAt });
          tCount++;
        }
      }
    }
    flush();

    for (const b of batches) {
      await this._withTimeout(b.commit());
    }
    localStorage.setItem('_is_hi_last_sync', syncedAt);
    return `${hhCount} ครัวเรือน · ${mCount} สมาชิก · ${tCount} เที่ยว`;
  },

  // ===== PULL =====
  // โหลด household + nested members + nested trips
  async _loadNested(hhDocs) {
    const hhMap = {};
    hhDocs.forEach(doc => {
      const d = this._strip(doc.data());
      d.members = [];
      hhMap[doc.id] = d;
    });

    // pull members ของแต่ละ household แบบ parallel
    const memberSnaps = await Promise.all(hhDocs.map(doc =>
      this._withTimeout(doc.ref.collection('members').get({ source: 'server' }))
    ));

    // จัดเก็บ member doc refs + reset trips
    const allMemberDocs = [];
    memberSnaps.forEach((snap, i) => {
      const hhId = hhDocs[i].id;
      snap.docs.forEach(mDoc => {
        const m = this._strip(mDoc.data());
        m.trips = [];
        hhMap[hhId].members.push(m);
        allMemberDocs.push({ hhId, mId: mDoc.id, ref: mDoc.ref, mRef: m });
      });
    });

    // pull trips ของแต่ละ member แบบ parallel
    const tripSnaps = await Promise.all(allMemberDocs.map(({ ref }) =>
      this._withTimeout(ref.collection('trips').get({ source: 'server' }))
    ));
    tripSnaps.forEach((snap, i) => {
      snap.docs.forEach(tDoc => {
        allMemberDocs[i].mRef.trips.push(this._strip(tDoc.data()));
      });
    });

    // sort
    Object.values(hhMap).forEach(hh => {
      hh.members.sort((a,b) => (a.seq||0) - (b.seq||0));
      hh.members.forEach(m => m.trips.sort((a,b) => (a.seq||0) - (b.seq||0)));
    });
    return Object.values(hhMap);
  },

  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this._col().get({ source: 'server' })
    );
    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');
    const households = await this._loadNested(snap.docs);
    const newData = { households };
    await DB.replaceAll(newData);
    return households.length;
  },

  // surveyor: pull เฉพาะ household ของตัวเอง (where ที่ root)
  pullBySurveyor(surveyorName) { return this._pullByField('surveyorName', surveyorName); },
  // staff (ผู้ควบคุม): pull เฉพาะ household ของทีมตัวเอง
  pullBySupervisor(supervisorName) { return this._pullByField('supervisorName', supervisorName); },

  async _pullByField(field, value) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this._col()
        .where(field, '==', value)
        .get({ source: 'server' })
    );
    const remote = await this._loadNested(snap.docs);
    const remoteMap = {};
    remote.forEach(h => { remoteMap[h.id] = h; });

    // merge: เก็บ local household/member/trip ที่ยังไม่ sync เพิ่มเข้า
    const local = DB.load();
    local.households.forEach(lh => {
      if (lh[field] !== value) return; // นอกขอบเขตของบทบาทนี้ — ไม่ต้องเอามาด้วย
      const r = remoteMap[lh.id];
      if (!r) { remoteMap[lh.id] = lh; return; }
      // merge members
      const rmIds = new Set(r.members.map(m => m.id));
      (lh.members || []).forEach(lm => {
        if (!rmIds.has(lm.id)) { r.members.push(lm); return; }
        // merge trips ของ member ที่มีทั้งสองข้าง
        const rm = r.members.find(x => x.id === lm.id);
        const rtIds = new Set(rm.trips.map(t => t.id));
        (lm.trips || []).forEach(lt => {
          if (!rtIds.has(lt.id)) rm.trips.push(lt);
        });
      });
      r.members.sort((a,b) => (a.seq||0) - (b.seq||0));
      r.members.forEach(m => m.trips.sort((a,b) => (a.seq||0) - (b.seq||0)));
    });

    const households = Object.values(remoteMap);
    const newData = { households };
    await DB.replaceAll(newData);
    return households.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
