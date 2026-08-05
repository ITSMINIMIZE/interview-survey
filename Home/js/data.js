// ===== DATA LAYER ===== (v2)

// ---- IndexedDB store: ที่เก็บหลักแทน localStorage (รับข้อมูลได้ระดับ GB) ----
// เก็บ _data ทั้งก้อนเป็น record เดียว ใน object store 'kv' คีย์ 'data'
const IDBStore = {
  DB_NAME: 'is_hi_survey_idb',
  STORE:   'kv',
  _dbp:    null,
  open() {
    if (this._dbp) return this._dbp;
    this._dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return this._dbp;
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE, 'readonly').objectStore(this.STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
  async set(key, val) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  },
  async del(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }
};

const DB = {
  KEY:     'is_hi_survey_v2',   // localStorage เดิม (ใช้ migrate ครั้งแรก + สำรอง sync ข้อมูลเล็ก)
  IDB_KEY: 'data',

  // ---- แยกข้อมูลในเครื่องตามโครงการ ----
  // เครื่องเดียวอาจถูกใช้กับหลายโครงการ (สลับผ่านหน้าแรก/ลิงก์ผู้สำรวจ)
  // ถ้าไม่แยก key ข้อมูลสำรวจของคนละโครงการจะทับกันใน IndexedDB
  _pid()  { return (typeof Project !== 'undefined' && Project.id()) || 'none'; },
  _key()  { return this.KEY + '__' + this._pid(); },
  _ikey() { return this.IDB_KEY + '__' + this._pid(); },
  _data:   null,
  _ready:  false,

  // เรียกครั้งเดียวตอนเปิดแอป (async) — โหลดจาก IndexedDB; ครั้งแรก migrate จาก localStorage
  async init() {
    if (this._ready) return this._data;
    try {
      let data = await IDBStore.get(this._ikey());
      if (!data) {
        // ครั้งแรกหลังอัปเดต: ย้ายข้อมูลเดิม localStorage → IndexedDB (ไม่ลบ localStorage ทิ้ง เผื่อ rollback)
        const raw = localStorage.getItem(this._key());
        if (raw) { data = JSON.parse(raw); await IDBStore.set(this._ikey(), data); }
      }
      this._data = data || { households: [] };
    } catch (e) {
      console.warn('[DB] IndexedDB init ล้มเหลว ใช้ localStorage แทน:', e);
      try { const raw = localStorage.getItem(this._key()); this._data = raw ? JSON.parse(raw) : { households: [] }; }
      catch { this._data = { households: [] }; }
    }
    this._ready = true;
    return this._data;
  },

  load() {
    if (this._data) return this._data;
    // fallback (เผื่อ getter ถูกเรียกก่อน init เสร็จ) — อ่าน localStorage แบบ sync
    try {
      const raw = localStorage.getItem(this._key());
      this._data = raw ? JSON.parse(raw) : { households: [] };
    } catch { this._data = { households: [] }; }
    return this._data;
  },

  save() {
    // ที่เก็บหลัก = IndexedDB (async, background) — ไม่มีเพดาน 5MB
    IDBStore.set(this._ikey(), this._data).catch(e => console.warn('[DB] IndexedDB save ล้มเหลว:', e));
    // สำรอง sync ลง localStorage เฉพาะข้อมูลไม่ใหญ่ (เครื่องผู้สำรวจ) — เต็มก็ข้าม IDB คือหลัก
    try { localStorage.setItem(this._key(), JSON.stringify(this._data)); } catch {}
  },

  // แทนที่ข้อมูลทั้งก้อน (ใช้ตอน pull จาก cloud) — persist ลง IndexedDB
  async replaceAll(newData) {
    this._data = newData;
    this._ready = true;
    await IDBStore.set(this._ikey(), newData);
    try { localStorage.setItem(this._key(), JSON.stringify(newData)); } catch {}
  },

  // ล้างข้อมูลในเครื่อง (IndexedDB + localStorage เดิม)
  async clearAll() {
    this._data = { households: [] };
    try { await IDBStore.del(this._ikey()); } catch {}
    try { localStorage.removeItem(this._key()); } catch {}
  },

  // ===== HOUSEHOLDS =====
  // ===== SOFT DELETE (ถังขยะ) =====
  // _deleted:true = admin ลบออกจากระบบแล้ว — ซ่อนทุกที่ที่แสดงผล/นับ/export แต่ยังกู้คืนได้
  // ตัดออกทั้ง household, member, trip (ลบบ้าน = สมาชิก+เที่ยวข้างในหายตามไปด้วย)
  _pruneDeleted(hhs) {
    // fast path: ไม่มีอะไรถูกลบ → คืน array เดิม ไม่ต้อง copy (เรียกทุก render)
    const hasDeleted = hhs.some(h =>
      h._deleted ||
      (h.members || []).some(m => m._deleted || (m.trips || []).some(t => t._deleted))
    );
    if (!hasDeleted) return hhs;
    return hhs.filter(h => !h._deleted).map(h => ({
      ...h,
      members: (h.members || []).filter(m => !m._deleted).map(m => ({
        ...m,
        trips: (m.trips || []).filter(t => !t._deleted)
      }))
    }));
  },

  // ใช้แสดงผล/นับ/export — ไม่รวมที่ลบแล้ว
  getHouseholds() { return this._pruneDeleted(this.load().households); },
  // ใช้กับถังขยะ + sync (ต้องเห็นของที่ลบแล้วด้วย เพื่อส่ง flag ขึ้น cloud)
  getHouseholdsRaw() { return this.load().households; },
  // ⚠️ คืน reference จริง (ยังมีรายการที่ลบแล้ว) — ใช้กับการแก้ข้อมูล/ถังขยะเท่านั้น
  getHousehold(id) { return this.load().households.find(h => h.id === id) || null; },
  // ใช้ "แสดงผล" หน้าบ้าน — ตัดสมาชิก/เที่ยวที่ลบออกจากระบบแล้วออก
  getHouseholdView(id) {
    const hh = this.getHousehold(id);
    if (!hh) return null;
    const dirty = (hh.members || []).some(m => m._deleted || (m.trips || []).some(t => t._deleted));
    if (!dirty) return hh;   // fast path
    return { ...hh, members: hh.members.filter(m => !m._deleted)
      .map(m => ({ ...m, trips: (m.trips || []).filter(t => !t._deleted) })) };
  },
  // ใช้ "แสดงผล" หน้าสมาชิก — ตัดเที่ยวที่ลบออกจากระบบแล้วออก
  getMemberView(hhId, mid) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    if (!(m.trips || []).some(t => t._deleted)) return m;   // fast path
    return { ...m, trips: m.trips.filter(t => !t._deleted) };
  },

  addHousehold(data) {
    const hh = {
      id: 'HH-' + Date.now(),
      surveyDate:      data.surveyDate      || new Date().toISOString().split('T')[0],
      travelDate:      data.travelDate      || '',
      surveyorName:    data.surveyorName    || '',
      supervisorName:  data.supervisorName  || '',
      subdistrict:     data.subdistrict     || '',
      district:        data.district        || 'บ้านไผ่',
      province:        data.province        || 'ขอนแก่น',
      areaCode:        data.areaCode        || '',
      houseNo:         data.houseNo         || '',
      moo:             data.moo             || '',
      alley:           data.alley           || '',
      road:            data.road            || '',
      phone:           data.phone           || '',
      coordinates:     data.coordinates     || '',
      residentialType: data.residentialType || '',
      memberGrid:      data.memberGrid      || {},
      householdIncome: data.householdIncome || '',
      hasVehicle:      data.hasVehicle      || '',
      vehicles:        data.vehicles        || {},
      deviceId:        data.deviceId        || '',
      clientIp:        data.clientIp        || '',
      createdAt: new Date().toISOString(),
      members: []
    };
    this.load().households.push(hh);
    this.save();
    return hh;
  },

  updateHousehold(id, data) {
    const hh = this.getHousehold(id);
    if (!hh) return null;
    // ไม่อัพเดต id, createdAt, members
    const { id: _id, createdAt: _ca, members: _m, ...rest } = data;
    Object.assign(hh, rest);
    this.save();
    return hh;
  },

  deleteHousehold(id) {
    const d = this.load();
    d.households = d.households.filter(h => h.id !== id);
    this.save();
  },

  // ===== MEMBERS =====
  getMember(hhId, mid) {
    const hh = this.getHousehold(hhId);
    return hh ? hh.members.find(m => m.id === mid) || null : null;
  },

  addMember(hhId, data) {
    const hh = this.getHousehold(hhId);
    if (!hh) return null;
    const m = {
      id: 'M-' + Date.now(),
      seq: hh.members.length + 1,
      gender:               data.gender               || '',
      age:                  data.age                  || '',
      homeStatus:           data.homeStatus           || '',
      workStatus:           data.workStatus           || '',
      occupation:           data.occupation           || '',
      education:            data.education            || '',
      workplaceName:        data.workplaceName        || '',
      workplaceCoords:      data.workplaceCoords      || '',
      workplaceAlley:       data.workplaceAlley       || '',
      workplaceRoad:        data.workplaceRoad        || '',
      workplaceSubdistrict: data.workplaceSubdistrict || '',
      workplaceDistrict:    data.workplaceDistrict    || '',
      workplaceProvince:    data.workplaceProvince    || '',
      income:               data.income               || '',
      trips: []
    };
    hh.members.push(m);
    this.save();
    return m;
  },

  updateMember(hhId, mid, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    Object.assign(m, data);
    this.save();
    return m;
  },

  deleteMember(hhId, mid) {
    const hh = this.getHousehold(hhId);
    if (!hh) return;
    hh.members = hh.members.filter(m => m.id !== mid);
    hh.members.forEach((m, i) => { m.seq = i + 1; });
    this.save();
  },

  // ===== TRIPS =====
  addTrip(hhId, mid, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    const trip = {
      id: 'T-' + Date.now(),
      seq: m.trips.length + 1,
      origin:            data.origin            || '',
      originCoords:      data.originCoords      || '',
      originType:        data.originType        || '',
      departureTime:     data.departureTime     || '',
      destination:       data.destination       || '',
      destinationCoords: data.destinationCoords || '',
      destinationType:   data.destinationType   || '',
      arrivalTime:       data.arrivalTime       || '',
      purpose:           data.purpose           || '',
      segments:          data.segments          || [{ mode:'', duration:'', fare:'' }],
      parkingLocation:   data.parkingLocation   || '',
      parkingFee:        data.parkingFee        || ''
    };
    m.trips.push(trip);
    this.save();
    return trip;
  },

  updateTrip(hhId, mid, tripId, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    const trip = m.trips.find(t => t.id === tripId);
    if (!trip) return null;
    Object.assign(trip, data);
    this.save();
    return trip;
  },

  deleteTrip(hhId, mid, tripId) {
    const m = this.getMember(hhId, mid);
    if (!m) return;
    m.trips = m.trips.filter(t => t.id !== tripId);
    m.trips.forEach((t, i) => { t.seq = i + 1; });
    this.save();
  },

  // ===== ถังขยะ: ลบออกจากระบบ (soft) / กู้คืน =====
  // คืน entity ที่เปลี่ยน เพื่อให้ App push ขึ้น cloud ต่อได้
  _mark(obj, deleted, by) {
    if (!obj) return null;
    if (deleted) {
      obj._deleted   = true;
      obj._deletedAt = new Date().toISOString();
      obj._deletedBy = by || '';
    } else {
      obj._deleted   = false;   // false ไม่ใช่ delete field — ให้ merge:true ทับค่าเดิมบน cloud ได้
      obj._deletedAt = '';
      obj._deletedBy = '';
    }
    this.save();
    return obj;
  },

  softDeleteHousehold(id, by)  { return this._mark(this.getHousehold(id), true,  by); },
  restoreHousehold(id)         { return this._mark(this.getHousehold(id), false); },
  softDeleteMember(hhId, mid, by) { return this._mark(this.getMember(hhId, mid), true,  by); },
  restoreMember(hhId, mid)        { return this._mark(this.getMember(hhId, mid), false); },
  softDeleteTrip(hhId, mid, tid, by) {
    const m = this.getMember(hhId, mid);
    return this._mark(m && m.trips.find(t => t.id === tid), true, by);
  },
  restoreTrip(hhId, mid, tid) {
    const m = this.getMember(hhId, mid);
    return this._mark(m && m.trips.find(t => t.id === tid), false);
  },

  // รายการในถังขยะ — flatten ทุกระดับให้ UI แสดง/กู้คืนได้
  getTrash() {
    const out = [];
    this.load().households.forEach(hh => {
      if (hh._deleted) {
        out.push({ kind: 'household', hhId: hh.id, label: `บ้าน ${hh.houseNo || hh.id}`,
                   sub: `${(hh.members||[]).length} สมาชิก · ผู้สำรวจ ${hh.surveyorName || '—'}`,
                   at: hh._deletedAt, by: hh._deletedBy });
        return;   // ลบทั้งบ้านแล้ว ไม่ต้องแสดงลูกซ้ำ
      }
      (hh.members || []).forEach(m => {
        if (m._deleted) {
          out.push({ kind: 'member', hhId: hh.id, mId: m.id,
                     label: `สมาชิกที่ ${m.seq} (บ้าน ${hh.houseNo || hh.id})`,
                     sub: `${(m.trips||[]).length} เที่ยว`, at: m._deletedAt, by: m._deletedBy });
          return;
        }
        (m.trips || []).forEach(t => {
          if (t._deleted) {
            out.push({ kind: 'trip', hhId: hh.id, mId: m.id, tId: t.id,
                       label: `เที่ยวที่ ${t.seq} — สมาชิกที่ ${m.seq} (บ้าน ${hh.houseNo || hh.id})`,
                       sub: `${t.origin || '—'} → ${t.destination || '—'}`,
                       at: t._deletedAt, by: t._deletedBy });
          }
        });
      });
    });
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },



  clearMyData(surveyorName) {
    const d = this.load();
    d.households = d.households.filter(h => h.surveyorName !== surveyorName);
    this.save();
  },

  stats(surveyorName) {
    let hhs = this.getHouseholds();
    if (surveyorName) hhs = hhs.filter(h => h.surveyorName === surveyorName);
    const members = hhs.flatMap(h => h.members || []);
    const trips = members.flatMap(m => m.trips || []);
    return { households: hhs.length, members: members.length, trips: trips.length };
  },

  // export = ข้อมูลที่ใช้จริง (ไม่รวมที่ลบออกจากระบบแล้ว)
  exportJSON() { return JSON.stringify({ ...this.load(), households: this.getHouseholds() }, null, 2); }
};

// ===== OPTION LISTS =====
const OPT = {

  subdistricts: [
    'เทศบาลเมืองบ้านไผ่',
    'องค์การบริหารส่วนตำบลในเมือง',
    'องค์การบริหารส่วนตำบลเมืองเพีย',
    'องค์การบริหารส่วนตำบลบ้านลาน',
    'องค์การบริหารส่วนตำบลแคนเหนือ',
    'องค์การบริหารส่วนตำบลภูเหล็ก',
    'องค์การบริหารส่วนตำบลป่าปอ',
    'องค์การบริหารส่วนตำบลหินตั้ง',
    'องค์การบริหารส่วนตำบลหนองน้ำใส',
    'องค์การบริหารส่วนตำบลขามเรียง'
  ],

  residentialType: [
    'บ้านเดี่ยว', 'ตึกแถว', 'ทาวน์เฮ้าส์', 'คอนโดมิเนียม / แฟลต', 'อื่น ๆ'
  ],

  // icon + label สำหรับ grid จำนวนสมาชิก
  memberGridRows: [
    { key: 'm_study', label: 'ชาย — กำลังศึกษา',        icon: '👨‍🎓' },
    { key: 'm_work',  label: 'ชาย — ทำงานแล้ว',         icon: '👨‍💼' },
    { key: 'm_notw',  label: 'ชาย — ไม่ได้ทำงาน',       icon: '👨' },
    { key: 'f_study', label: 'หญิง — กำลังศึกษา',       icon: '👩‍🎓' },
    { key: 'f_work',  label: 'หญิง — ทำงานแล้ว',        icon: '👩‍💼' },
    { key: 'f_notw',  label: 'หญิง — ไม่ได้ทำงาน',      icon: '👩' },
    { key: 'm_child', label: 'ชาย — อายุต่ำกว่า 6 ปี',  icon: '👦' },
    { key: 'f_child', label: 'หญิง — อายุต่ำกว่า 6 ปี', icon: '👧' }
  ],

  // (เลิกใช้ income แบบชั้น — รายได้สมาชิก/ครัวเรือนเป็นช่องกรอกตัวเลข)

  // icon + label สำหรับยานพาหนะ
  vehicleTypes: [
    { key: 'bicycle2',   label: 'รถจักรยานสองล้อ',       icon: '🚲' },
    { key: 'bicycle3',   label: 'รถจักรยานสามล้อ',       icon: '🚲' },
    { key: 'motorcycle', label: 'รถจักรยานยนต์',          icon: '🛵' },
    { key: 'tuk3',       label: 'รถสามล้อเครื่อง',        icon: '🛺' },
    { key: 'car',        label: 'รถยนต์นั่งส่วนบุคคล',     icon: '🚗' },
    { key: 'minibus',    label: 'รถโดยสารขนาดเล็ก–กลาง', icon: '🚐' },
    { key: 'bus',        label: 'รถโดยสารขนาดใหญ่',       icon: '🚌' },
    { key: 'pickup',     label: 'รถปิ๊กอัพ',              icon: '🛻' },
    { key: 'truck6',     label: 'รถบรรทุก 6 ล้อขึ้นไป',  icon: '🚛' },
    { key: 'other',      label: 'อื่น ๆ',                 icon: '🚘' }
  ],

  homeStatus: [
    'เจ้าบ้านผู้ชาย', 'เจ้าบ้านผู้หญิง', 'ลูก', 'ญาติ', 'ผู้อยู่อาศัย / ลูกจ้าง', 'อื่น ๆ'
  ],

  workStatus: [
    'ทำงาน',
    'เรียนหนังสือ',
    'ว่างงาน (ยังหางานทำไม่ได้)',
    'ไม่ทำงาน (อยู่บ้านเฉย ๆ)',
    'อื่น ๆ'
  ],

  occupation: [
    'นักเรียน / นักศึกษา',
    'ครู / อาจารย์',
    'ข้าราชการ / รัฐวิสาหกิจ',
    'เจ้าของกิจการ / บริษัท',
    'พนักงานบริษัท / ห้างร้าน / ธนาคาร',
    'ลูกจ้าง / คนงาน / พนักงานโรงงาน',
    'พนักงานขับรถ',
    'เกษตรกร / ประมง / เลี้ยงสัตว์',
    'ช่างฝีมือ / ช่างผลิต',
    'ผู้ปฏิบัติงานวิชาชีพ',
    'แม่บ้าน / พ่อบ้าน',
    'ข้าราชการบำนาญ',
    'อยู่บ้านเฉย ๆ',
    'อื่น ๆ'
  ],

  education: [
    'ต่ำกว่าประถมศึกษา / ไม่ได้เรียน',
    'ประถมศึกษา (ป.1–ป.6)',
    'มัธยมศึกษา (ม.1–ม.6)',
    'อนุปริญญา / ปวช. / ปวส.',
    'ปริญญาตรี',
    'สูงกว่าปริญญาตรี'
  ],

  // ใช้ชุดเดียวกับ Roadside (11 ประเภท) เพื่อให้ aggregate ข้ามแอปได้
  locationType: [
    'ที่พัก / บ้านของตัวเอง',
    'โรงเรียน / สถานศึกษา',
    'สถานที่ราชการ / โรงพยาบาล',
    'บริษัทเอกชน / ห้าง / ธนาคาร',
    'ตลาด / ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ',
    'โรงงาน / โกดัง / คลังสินค้า',
    'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',
    'สถานที่ท่องเที่ยว / ออกกำลังกาย',
    'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',
    'บ้านที่ไม่ใช่ของตัวเอง',
    'อื่น ๆ'
  ],

  // ใช้ชุดเดียวกับ Roadside (11 วัตถุประสงค์) — คง 'กลับบ้าน' ไว้ (logic trip สุดท้ายใช้)
  purpose: [
    'กลับบ้าน',
    'ไปทำงาน',
    'ไปเรียนหนังสือ',
    'ติดต่อราชการต่าง ๆ / ธุรกิจ',
    'ไปโรงพยาบาล / คลินิก / อนามัย',
    'รับส่งคน หรือ สินค้า',
    'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ',
    'รับประทานอาหาร',
    'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย',
    'ทำกิจกรรมทางศาสนา',
    'อื่น ๆ'
  ],

  // modes ที่ต้องมียานพาหนะประเภทนั้นในครัวเรือนจึงจะใช้ได้
  modeRequiresVehicle: {
    'รถจักรยานสองล้อถีบ':                        ['bicycle2'],
    'รถสามล้อถีบ':                                ['bicycle3'],
    'รถจักรยานยนต์ส่วนตัว':                       ['motorcycle'],
    'ซ้อนรถจักรยาน':                              ['bicycle2'],
    'ซ้อนรถจักรยานยนต์':                          ['motorcycle'],
    'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)':    ['car', 'pickup'],
    'รถส่วนบุคคล 6 ล้อขึ้นไป':                    ['truck6'],
  },

  tripMode: [
    'เดิน',
    'รถจักรยานสองล้อถีบ',
    'รถสามล้อถีบ',
    'รถจักรยานยนต์ส่วนตัว',
    'รถจักรยานยนต์รับจ้าง',
    'รถสามล้อเครื่อง / แท็กซี่',
    'รถสองแถว / รถประจำทาง',
    'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)',
    'ซ้อนรถจักรยาน',
    'ซ้อนรถจักรยานยนต์',
    'อาศัยไปกับรถยนต์ของผู้อื่น',
    'รถส่วนบุคคลรับจ้าง',
    'รถโรงเรียน',
    'รถบริษัท / ที่ทำงาน / ราชการ',
    'รถส่วนบุคคล 6 ล้อขึ้นไป',
    'รถไฟ',
    'อื่น ๆ'
  ]
};
