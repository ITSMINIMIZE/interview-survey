// ===== DATA LAYER — Roadside Interview =====

// ---- IndexedDB store: ที่เก็บหลักแทน localStorage (รับข้อมูลได้ระดับ GB) ----
// เก็บ _data ทั้งก้อนเป็น record เดียว ใน object store 'kv' คีย์ 'data'
const IDBStore = {
  DB_NAME: 'is_ri_survey_idb',
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
  KEY:     'is_ri_survey_v1',   // localStorage เดิม (ใช้ migrate ครั้งแรก + สำรอง sync ข้อมูลเล็ก)
  IDB_KEY: 'data',
  _data:   null,
  _ready:  false,

  // เรียกครั้งเดียวตอนเปิดแอป (async) — โหลดจาก IndexedDB; ครั้งแรก migrate จาก localStorage
  async init() {
    if (this._ready) return this._data;
    try {
      let data = await IDBStore.get(this.IDB_KEY);
      if (!data) {
        // ครั้งแรกหลังอัปเดต: ย้ายข้อมูลเดิม localStorage → IndexedDB (ไม่ลบ localStorage ทิ้ง เผื่อ rollback)
        const raw = localStorage.getItem(this.KEY);
        if (raw) { data = JSON.parse(raw); await IDBStore.set(this.IDB_KEY, data); }
      }
      this._data = data || { stations: [] };
    } catch (e) {
      console.warn('[DB] IndexedDB init ล้มเหลว ใช้ localStorage แทน:', e);
      try { const raw = localStorage.getItem(this.KEY); this._data = raw ? JSON.parse(raw) : { stations: [] }; }
      catch { this._data = { stations: [] }; }
    }
    this._ready = true;
    return this._data;
  },

  load() {
    if (this._data) return this._data;
    // fallback (เผื่อ getter ถูกเรียกก่อน init เสร็จ) — อ่าน localStorage แบบ sync
    try {
      const raw = localStorage.getItem(this.KEY);
      this._data = raw ? JSON.parse(raw) : { stations: [] };
    } catch { this._data = { stations: [] }; }
    return this._data;
  },

  save() {
    // ที่เก็บหลัก = IndexedDB (async, background) — ไม่มีเพดาน 5MB
    IDBStore.set(this.IDB_KEY, this._data).catch(e => console.warn('[DB] IndexedDB save ล้มเหลว:', e));
    // สำรอง sync ลง localStorage เฉพาะข้อมูลไม่ใหญ่ (เครื่องผู้สำรวจ) — เต็มก็ข้าม IDB คือหลัก
    try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); } catch {}
  },

  // แทนที่ข้อมูลทั้งก้อน (ใช้ตอน pull จาก cloud) — persist ลง IndexedDB
  async replaceAll(newData) {
    this._data = newData;
    this._ready = true;
    await IDBStore.set(this.IDB_KEY, newData);
    try { localStorage.setItem(this.KEY, JSON.stringify(newData)); } catch {}
  },

  // ล้างข้อมูลในเครื่อง (IndexedDB + localStorage เดิม)
  async clearAll() {
    this._data = { stations: [] };
    try { await IDBStore.del(this.IDB_KEY); } catch {}
    try { localStorage.removeItem(this.KEY); } catch {}
  },

  // ===== STATIONS =====
  // ===== SOFT DELETE (ถังขยะ) =====
  // _deleted:true = admin ลบออกจากระบบแล้ว — ซ่อนทุกที่ที่แสดงผล/นับ/export แต่ยังกู้คืนได้
  // ตัดออกทั้ง station และ interview (ลบจุดสำรวจ = การสำรวจข้างในหายตามไปด้วย)
  _pruneDeleted(sts) {
    // fast path: ไม่มีอะไรถูกลบ → คืน array เดิม ไม่ต้อง copy (เรียกทุก render)
    const hasDeleted = sts.some(s => s._deleted || (s.interviews || []).some(iv => iv._deleted));
    if (!hasDeleted) return sts;
    return sts.filter(s => !s._deleted).map(s => ({
      ...s,
      interviews: (s.interviews || []).filter(iv => !iv._deleted)
    }));
  },

  // ใช้แสดงผล/นับ/export — ไม่รวมที่ลบแล้ว
  getStations() { return this._pruneDeleted(this.load().stations); },
  // ใช้กับถังขยะ + sync (ต้องเห็นของที่ลบแล้วด้วย เพื่อส่ง flag ขึ้น cloud)
  getStationsRaw() { return this.load().stations; },
  // ⚠️ คืน reference จริง (ยังมีรายการที่ลบแล้ว) — ใช้กับการแก้ข้อมูล/ถังขยะเท่านั้น
  getStation(id) { return this.load().stations.find(s => s.id === id) || null; },
  // ใช้ "แสดงผล" หน้าจุดสำรวจ — ตัด interview ที่ลบออกจากระบบแล้วออก
  getStationView(id) {
    const st = this.getStation(id);
    if (!st) return null;
    if (!(st.interviews || []).some(iv => iv._deleted)) return st;   // fast path
    return { ...st, interviews: st.interviews.filter(iv => !iv._deleted) };
  },

  addStation(data) {
    const st = {
      id:              'RS-' + Date.now(),
      surveyDate:      data.surveyDate      || new Date().toISOString().split('T')[0],
      surveyorName:    data.surveyorName    || '',
      supervisorName:  data.supervisorName  || '',
      stationName:     data.stationName     || '',
      stationCode:     data.stationCode     || '',
      road:            data.road            || '',
      direction:       data.direction       || '',
      coordinates:     data.coordinates     || '',
      subdistrict:     data.subdistrict     || '',
      district:        data.district        || '',
      province:        data.province        || '',
      deviceId:        data.deviceId        || '',
      clientIp:        data.clientIp        || '',
      createdAt:       new Date().toISOString(),
      interviews:      []
    };
    this.load().stations.push(st);
    this.save();
    return st;
  },

  updateStation(id, data) {
    const st = this.getStation(id);
    if (!st) return null;
    const { id: _id, createdAt: _ca, interviews: _iv, ...rest } = data;
    Object.assign(st, rest);
    this.save();
    return st;
  },

  deleteStation(id) {
    const d = this.load();
    d.stations = d.stations.filter(s => s.id !== id);
    this.save();
  },

  // ===== INTERVIEWS =====
  getInterview(stId, ivId) {
    const st = this.getStation(stId);
    return st ? st.interviews.find(iv => iv.id === ivId) || null : null;
  },

  addInterview(stId, data) {
    const st = this.getStation(stId);
    if (!st) return null;
    const iv = {
      id:                   data.id || ('IV-' + Date.now()),
      stationId:            stId,
      seq:                  st.interviews.length + 1,
      surveyorName:         data.surveyorName       || '',
      interviewDate:        data.interviewDate      || new Date().toISOString().split('T')[0],
      interviewTime:        data.interviewTime      || '',
      vehicleType:          data.vehicleType        || '',
      passengerCount:       data.passengerCount     || '',
      travelDirection:      data.travelDirection    || '',
      // origin (clean schema)
      originType:           data.originType         || '',
      originTypeOther:      data.originTypeOther     || '',  // ระบุ เมื่อ originType = 'อื่น ๆ'
      originName:           data.originName         || '',
      originCoords:         data.originCoords       || '',
      // destination
      destinationType:      data.destinationType    || '',
      destinationTypeOther: data.destinationTypeOther || '', // ระบุ เมื่อ destinationType = 'อื่น ๆ'
      destinationName:      data.destinationName    || '',
      destinationCoords:    data.destinationCoords  || '',
      // purpose
      purpose:              data.purpose            || '',
      // cargo
      hasCargo:             data.hasCargo           || '',
      cargoType:            data.cargoType          || '',
      cargoTypeOther:       data.cargoTypeOther     || '',  // ระบุ เมื่อ cargoType = 'อื่น ๆ (ระบุ)'
      cargoWeight:          data.cargoWeight        || '',
      // income
      driverIncome:         data.driverIncome       || '',
      createdAt:            data.createdAt || new Date().toISOString()
    };
    st.interviews.push(iv);
    this.save();
    return iv;
  },

  updateInterview(stId, ivId, data) {
    const iv = this.getInterview(stId, ivId);
    if (!iv) return null;
    Object.assign(iv, data);
    this.save();
    return iv;
  },

  deleteInterview(stId, ivId) {
    const st = this.getStation(stId);
    if (!st) return;
    st.interviews = st.interviews.filter(iv => iv.id !== ivId);
    st.interviews.forEach((iv, i) => { iv.seq = i + 1; });
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

  softDeleteStation(id, by)   { return this._mark(this.getStation(id), true,  by); },
  restoreStation(id)          { return this._mark(this.getStation(id), false); },
  softDeleteInterview(stId, ivId, by) { return this._mark(this.getInterview(stId, ivId), true,  by); },
  restoreInterview(stId, ivId)        { return this._mark(this.getInterview(stId, ivId), false); },

  // รายการในถังขยะ — flatten ให้ UI แสดง/กู้คืนได้
  getTrash() {
    const out = [];
    this.load().stations.forEach(st => {
      if (st._deleted) {
        out.push({ kind: 'station', stId: st.id,
                   label: `จุดสำรวจ ${st.stationName || st.id}`,
                   sub: `${(st.interviews||[]).length} การสำรวจ · ${st.road || '—'}`,
                   at: st._deletedAt, by: st._deletedBy });
        return;   // ลบทั้งจุดแล้ว ไม่ต้องแสดงลูกซ้ำ
      }
      (st.interviews || []).forEach(iv => {
        if (iv._deleted) {
          out.push({ kind: 'interview', stId: st.id, ivId: iv.id,
                     label: `การสำรวจที่ ${iv.seq} (${st.stationName || st.id})`,
                     sub: `${iv.originName || '—'} → ${iv.destinationName || '—'} · ผู้สำรวจ ${iv.surveyorName || '—'}`,
                     at: iv._deletedAt, by: iv._deletedBy });
        }
      });
    });
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },

  // ล้างเฉพาะข้อมูลเก่าก่อนรอบเก็บข้อมูลปัจจุบัน — ทั้งจุดสำรวจเก่าและ interview เก่าในจุดใหม่
  clearOlderThan(sinceIso) {
    if (!sinceIso) return 0;
    const d = this.load();
    let removed = 0;
    const keep = [];
    d.stations.forEach(st => {
      if (String(st.createdAt || '') < sinceIso) { removed += 1 + (st.interviews || []).length; return; }
      const before = (st.interviews || []).length;
      st.interviews = (st.interviews || []).filter(iv => String(iv.createdAt || '') >= sinceIso);
      removed += before - st.interviews.length;
      keep.push(st);
    });
    d.stations = keep;
    this.save();
    return removed;
  },

  countOlderThan(sinceIso) {
    if (!sinceIso) return 0;
    let n = 0;
    this.load().stations.forEach(st => {
      if (String(st.createdAt || '') < sinceIso) { n += 1 + (st.interviews || []).length; return; }
      n += (st.interviews || []).filter(iv => String(iv.createdAt || '') < sinceIso).length;
    });
    return n;
  },

  clearMyInterviews(surveyorName) {
    this.load().stations.forEach(st => {
      st.interviews = st.interviews.filter(iv => iv.surveyorName !== surveyorName);
      st.interviews.forEach((iv, i) => { iv.seq = i + 1; });
    });
    this.save();
  },

  stats() {
    const sts = this.getStations();
    const ivs = sts.flatMap(s => s.interviews);
    return { stations: sts.length, interviews: ivs.length };
  },

  // export = ข้อมูลที่ใช้จริง (ไม่รวมที่ลบออกจากระบบแล้ว)
  exportJSON() { return JSON.stringify({ ...this.load(), stations: this.getStations() }, null, 2); }
};

// ===== OPTION LISTS =====
const OPT = {

  // แกนถนนของจุดสำรวจ → ใช้เลือกทิศทางจริงในการสำรวจแต่ละคัน
  roadAxis: ['เหนือ–ใต้', 'ตะวันออก–ตะวันตก'],

  // ทิศทางจริงแต่ละคัน — กำหนดตามแกนถนน
  directionsByAxis: {
    'เหนือ–ใต้':          ['มุ่งทิศเหนือ', 'มุ่งทิศใต้'],
    'ตะวันออก–ตะวันตก': ['มุ่งทิศตะวันออก', 'มุ่งทิศตะวันตก']
  },

  // ตรงตามแบบฟอร์ม RS — 9 ประเภท แบ่ง 3 กลุ่ม
  vehicleTypes: [
    // กลุ่มรถส่วนบุคคล (1–5)
    { key: 'bicycle2',   label: 'จักรยาน 2 ล้อ',                          icon: '🚲', group: 'personal' },
    { key: 'bicycle3',   label: 'จักรยาน 3 ล้อ',                          icon: '🚲', group: 'personal' },
    { key: 'motorcycle', label: 'รถจักรยานยนต์',                          icon: '🛵', group: 'personal' },
    { key: 'tuk3',       label: 'รถสามล้อเครื่อง',                        icon: '🛺', group: 'personal' },
    { key: 'car',        label: 'รถยนต์นั่งส่วนบุคคล',                    icon: '🚗', group: 'personal' },
    // กลุ่มรถโดยสาร (6–7)
    { key: 'bus_sm',     label: 'รถโดยสารขนาดเล็ก–กลาง',                 icon: '🚐', group: 'bus' },
    { key: 'bus_lg',     label: 'รถโดยสารขนาดใหญ่',                       icon: '🚌', group: 'bus' },
    // กลุ่มรถบรรทุก (8–9)
    { key: 'truck4',     label: 'รถบรรทุกขนาดเล็ก (4 ล้อ)',              icon: '🚚', group: 'truck' },
    { key: 'truck6',     label: 'รถบรรทุกขนาดกลางขึ้นไป (6 ล้อขึ้นไป)', icon: '🚛', group: 'truck' }
  ],

  // ตรงตามแบบฟอร์ม RS — 11 ประเภทสถานที่
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

  // ตรงตามแบบฟอร์ม RS — 11 วัตถุประสงค์
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

  // (เลิกใช้ในฟอร์ม RS แล้ว: occupation/tripFrequency/income แบบชั้น — รายได้ผู้ขับเป็นช่องกรอกตัวเลข)

  // ชนิดสินค้า 34 ชนิด แบ่ง 6 กลุ่ม (สีพื้นต่อกลุ่ม — กวาดตาหาเร็ว)
  // cargoTypes (flat) + cargoColor (map สี) สร้างจากนี้ ท้ายไฟล์
  cargoGroups: [
    { name: 'เกษตร / ปศุสัตว์', bg: '#dcfce7', items: [
      'สัตว์มีชีวิต','อาหารสัตว์','ปุ๋ย','ข้าว','ข้าวเปลือก','ข้าวโพด','อ้อย',
      'มันสำปะหลังและผลิตภัณฑ์','ยางพาราและผลิตภัณฑ์ยาง','ผลไม้','ผลผลิตเกษตรอื่น ๆ'
    ]},
    { name: 'อาหาร / เครื่องดื่ม', bg: '#fef9c3', items: [
      'น้ำตาล','เครื่องดื่ม','ผลิตภัณฑ์อาหาร','เครื่องบริโภคอื่น ๆ'
    ]},
    { name: 'วัสดุก่อสร้าง', bg: '#e2e8f0', items: [
      'ไม้','ยางมะตอย','วัสดุก่อสร้าง','ซีเมนต์','โลหะก่อสร้าง','ดิน/หิน/ทราย'
    ]},
    { name: 'พลังงาน / แร่ / เคมี', bg: '#ede9fe', items: [
      'แร่เชื้อเพลิง (ถ่านหิน)','ผลิตภัณฑ์ปิโตรเลียม','แร่ธาตุ','เคมีภัณฑ์ (สารเคมี)','พลาสติก'
    ]},
    { name: 'อุตสาหกรรม / ยานยนต์', bg: '#dbeafe', items: [
      'ยานยนต์','เครื่องจักร','เครื่องมือ/อุปกรณ์/เครื่องใช้ครัวเรือน',
      'เครื่องใช้ไฟฟ้า/อิเล็กทรอนิกส์/คอมพิวเตอร์','โลหะอื่น ๆ'
    ]},
    { name: 'อุปโภค / อื่น ๆ', bg: '#ffe4e6', items: [
      'เสื้อผ้า สิ่งทอ','สินค้าเบ็ดเตล็ด','อื่น ๆ (ระบุ)'
    ]},
  ],

  // การ์ดสถานที่ + ไอคอน (สำหรับ wizard)
  locationTypeCards: [
    { val: 'ที่พัก / บ้านของตัวเอง',                            icon: '🏠', short: 'บ้านตัวเอง' },
    { val: 'โรงเรียน / สถานศึกษา',                              icon: '🏫', short: 'โรงเรียน' },
    { val: 'สถานที่ราชการ / โรงพยาบาล',                         icon: '🏥', short: 'ราชการ/รพ.' },
    { val: 'บริษัทเอกชน / ห้าง / ธนาคาร',                       icon: '🏢', short: 'บริษัท/ห้าง' },
    { val: 'ตลาด / ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ', icon: '🛒', short: 'ตลาด/ร้านค้า' },
    { val: 'โรงงาน / โกดัง / คลังสินค้า',                       icon: '🏭', short: 'โรงงาน/โกดัง' },
    { val: 'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',    icon: '🌾', short: 'เกษตร/ไร่นา' },
    { val: 'สถานที่ท่องเที่ยว / ออกกำลังกาย',                   icon: '🏖️', short: 'ท่องเที่ยว' },
    { val: 'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',                    icon: '⛩️', short: 'ศาสนสถาน' },
    { val: 'บ้านที่ไม่ใช่ของตัวเอง',                             icon: '🏘️', short: 'บ้านผู้อื่น' },
    { val: 'อื่น ๆ',                                             icon: '📍', short: 'อื่น ๆ' }
  ],

  // การ์ดวัตถุประสงค์ + ไอคอน
  purposeCards: [
    { val: 'กลับบ้าน',                               icon: '🏠' },
    { val: 'ไปทำงาน',                                icon: '💼' },
    { val: 'ไปเรียนหนังสือ',                         icon: '📚' },
    { val: 'ติดต่อราชการต่าง ๆ / ธุรกิจ',           icon: '🏛️' },
    { val: 'ไปโรงพยาบาล / คลินิก / อนามัย',        icon: '🏥' },
    { val: 'รับส่งคน หรือ สินค้า',                   icon: '📦' },
    { val: 'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ',           icon: '🛒' },
    { val: 'รับประทานอาหาร',                         icon: '🍽️' },
    { val: 'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย',   icon: '🏖️' },
    { val: 'ทำกิจกรรมทางศาสนา',                     icon: '⛩️' },
    { val: 'อื่น ๆ',                                 icon: '❓' }
  ],

  provinces: [
    'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร',
    'ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ',
    'ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก',
    'นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์',
    'นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี',
    'ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา',
    'พะเยา','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์',
    'แพร่','พัทลุง','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน',
    'ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี',
    'ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล',
    'สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี',
    'สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์',
    'หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี',
    'อุตรดิตถ์','อุทัยธานี','อุบลราชธานี','อื่น ๆ (ต่างประเทศ)'
  ]
};

// flat list ของชนิดสินค้า (ใช้ใน dropdown/validation/seed) + map สีตามกลุ่ม — สร้างจาก cargoGroups
OPT.cargoTypes = OPT.cargoGroups.flatMap(g => g.items);
OPT.cargoColor = {};
OPT.cargoGroups.forEach(g => g.items.forEach(it => { OPT.cargoColor[it] = g.bg; }));
