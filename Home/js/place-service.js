// ===== PLACE SERVICE — Self-Growing Place Search (Banphai Survey) =====
// Multi-provider orchestrator + auto-learn (Firestore `places` collection).
// แหล่งค้น (staged ประหยัด API): พิมพ์=Local · กดค้นหา=Longdo · กดค้นเพิ่ม=Google
// ทำ 1 ชุด แล้ว copy ไป Roadside/js/ และ Home/js/ (drop-in, ไม่แตะ signature MapPicker)
//
// Output shape (ทุก provider คืนรูปนี้):
//   { place_name, latitude, longitude, source, confidence }
//   source = 'local' | 'longdo' | 'google' | 'nominatim'
const PlaceService = {
  // ---- in-memory cache ของ places (mirror localStorage) ----
  // เปิดแอป/cache ว่าง = full read (สมบูรณ์ = safety net) · หลังจากนั้นทุก 15 นาที = delta
  // (อ่านเฉพาะ updated_at ใหม่ → base ที่นิ่งไม่ถูกดึงซ้ำ ลด read มาก) · error = ใช้ cache เดิม
  _cache: [],
  _cacheLoadedAt: 0,
  _lastSync: '',
  _loadingPromise: null,

  CACHE_KEY:      'is_bp_places_cache',
  CACHE_TS_KEY:   'is_bp_places_cache_ts',
  CACHE_SYNC_KEY: 'is_bp_places_lastsync',
  CACHE_TTL:      15 * 60 * 1000,   // 15 นาที
  SYNC_BUFFER_MS: 30 * 60 * 1000,   // อ่าน delta เผื่อย้อนหลัง กัน clock เพี้ยน

  // ---- API key config (Firestore config/app · แก้ผ่าน tools/config.html) ----
  // อ่าน "ครั้งเดียวต่อเซสชัน" เช่นกัน — key แทบไม่เปลี่ยน (เปลี่ยนได้แต่มีผลตอนเปิดเว็บใหม่)
  CONFIG_COLLECTION: 'config',
  CONFIG_DOC:    'app',
  CONFIG_KEY:    'is_bp_config_cache',   // cache ไว้ใช้ตอน offline
  _configApplied: false,
  _configLoading: false,
  _configFetchedThisSession: false,

  COLLECTION:   'places',
  // ค่า default (fallback) — ถ้า config/app มี key จะถูก override ตอน loadConfig()
  LONGDO_KEY:   '4ffd5bcaa8a5941163c24dbe2a4401e8',
  // Google Places API (New) key — fallback ในโค้ด
  // ⚠️ key ฝั่ง browser เปิดเผยได้เสมอ — ป้องกันด้วย HTTP referrer restriction ใน Google Cloud
  //    (อนุญาตเฉพาะ itsminimize.github.io/* + localhost:5500/*) + จำกัด API = Places API (New)
  GOOGLE_KEY:   'AIzaSyAJzTlYmUTDCspYgcZ3ceebnAHeaHhbe0w',

  // บ้านไผ่ center — ใช้ bias ผล Longdo/Nominatim
  CENTER_LAT: 16.0590,
  CENTER_LON: 102.7313,
  SPAN_M:     50000,              // 50 km

  CONFIDENCE: { local: 1.0, longdo: 0.9, google: 0.95, manual: 1.0, nominatim: 0.5 },
  DEDUPE_M:   150,               // ชื่อตรง + ใกล้กว่านี้ = ที่เดียวกัน

  // ===================== helpers =====================
  _db() {
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        return firebase.firestore();
      }
    } catch (_) {}
    return null;
  },

  _norm(s) {
    return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  },

  // ระยะทาง (เมตร) แบบ haversine
  _distM(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  // ===================== cache =====================
  _readLocal() {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      const ts  = parseInt(localStorage.getItem(this.CACHE_TS_KEY) || '0', 10);
      if (raw) { this._cache = JSON.parse(raw) || []; this._cacheLoadedAt = ts || 0; }
      this._lastSync = localStorage.getItem(this.CACHE_SYNC_KEY) || '';
    } catch (_) {}
  },

  _writeLocal() {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(this._cache));
      localStorage.setItem(this.CACHE_TS_KEY, String(this._cacheLoadedAt));
      localStorage.setItem(this.CACHE_SYNC_KEY, this._lastSync || '');
    } catch (_) {}
  },

  _upsertCache(doc) {
    if (!doc || !doc.id) return;
    const i = this._cache.findIndex(p => p.id === doc.id);
    if (i >= 0) this._cache[i] = doc; else this._cache.push(doc);
  },

  _maxUpdatedAt() {
    let m = this._lastSync || '';
    for (const p of this._cache) { if (p.updated_at && p.updated_at > m) m = p.updated_at; }
    return m;
  },

  // โหลด places (delta + full-read safety net) — error = คง cache เดิม (search ไม่พัง)
  async loadCache(force = false) {
    if (!this._cacheLoadedAt) this._readLocal();           // instant จาก localStorage ก่อน
    const fresh = (Date.now() - this._cacheLoadedAt) < this.CACHE_TTL;
    if (!force && fresh && this._cache.length) return this._cache;  // ยัง fresh → ไม่ยิงซ้ำ
    if (this._loadingPromise) return this._loadingPromise;

    const db = this._db();
    if (!db) return this._cache; // offline / firebase ไม่พร้อม → ใช้ของเดิมไปก่อน

    this._loadingPromise = (async () => {
      try {
        if (this._cache.length && this._lastSync) {
          // DELTA: อ่านเฉพาะ doc ที่ updated_at ใหม่ (เผื่อย้อนหลังกัน clock เพี้ยน) → base ที่นิ่งไม่ถูกดึงซ้ำ
          const since = new Date(Date.parse(this._lastSync) - this.SYNC_BUFFER_MS).toISOString();
          const snap = await db.collection(this.COLLECTION).where('updated_at', '>', since).get();
          snap.docs.forEach(d => this._upsertCache(d.data()));
        } else {
          // FULL READ: ครั้งแรก/cache ว่าง → snapshot สมบูรณ์ (safety net · self-heal ทุกครั้งเปิดแอป)
          const snap = await db.collection(this.COLLECTION).get();
          this._cache = snap.docs.map(d => d.data());
        }
        this._lastSync = this._maxUpdatedAt();
        this._cacheLoadedAt = Date.now();
        this._writeLocal();
      } catch (e) {
        console.warn('[PlaceService] loadCache failed (ใช้ cache เดิม):', e.message);
      } finally {
        this._loadingPromise = null;
      }
      return this._cache;
    })();
    return this._loadingPromise;
  },

  // ===================== API KEY CONFIG =====================
  // อ่าน key จาก Firestore config/app → override GOOGLE_KEY/LONGDO_KEY (fallback = ค่าในโค้ด)
  // apply จาก localStorage ทันที (ไม่บล็อก) + refresh จาก Firestore เบื้องหลังเมื่อ TTL หมด
  loadConfig() {
    // 1) apply ค่าที่ cache ไว้ทันที (instant + ใช้ได้ offline)
    if (!this._configApplied) {
      try {
        const raw = localStorage.getItem(this.CONFIG_KEY);
        if (raw) this._applyConfig(JSON.parse(raw));
      } catch (_) {}
    }
    // 2) อ่านสดจาก Firestore "ครั้งเดียวต่อเซสชัน" (key เปลี่ยนได้ แต่มีผลตอนเปิดเว็บใหม่)
    if (this._configFetchedThisSession || this._configLoading) return;
    const db = this._db();
    if (!db) return;                     // offline → ใช้ค่า cache/โค้ด ไปก่อน
    this._configLoading = true;
    db.collection(this.CONFIG_COLLECTION).doc(this.CONFIG_DOC).get()
      .then(doc => {
        const cfg = doc.exists ? doc.data() : {};
        localStorage.setItem(this.CONFIG_KEY, JSON.stringify(cfg));
        this._applyConfig(cfg);
        this._configFetchedThisSession = true;
      })
      .catch(e => console.warn('[PlaceService] loadConfig failed:', e.message))
      .finally(() => { this._configLoading = false; });
  },

  _applyConfig(cfg) {
    if (cfg && cfg.google_places_key) this.GOOGLE_KEY = cfg.google_places_key;
    if (cfg && cfg.longdo_key)        this.LONGDO_KEY = cfg.longdo_key;
    this._configApplied = true;
  },

  // ===================== SEARCH (staged เพื่อประหยัด API) =====================
  // [พิมพ์สด] → local เท่านั้น ไม่ยิง API
  searchLocal(query) {
    const q = (query || '').trim();
    return q ? this._searchLocal(q) : [];
  },

  // [กดปุ่ม "ค้นหา"] → local + Longdo (ยังไม่แตะ Google)
  async searchLongdo(query) {
    const q = (query || '').trim();
    if (!q) return [];
    this.loadConfig();
    await this.loadCache();
    const local = this._searchLocal(q);
    let longdo = [];
    try { longdo = await this._searchLongdo(q); }
    catch (e) { console.warn('[PlaceService] Longdo failed:', e.message); }
    return this._dedupeResults([...local, ...longdo]);
  },

  // [กด "ค้นเพิ่มใน Google"] → Google เท่านั้น (เรียกเมื่อ Longdo ไม่เจอที่ต้องการ — ประหยัด cost)
  async searchGoogle(query) {
    const q = (query || '').trim();
    if (!q) return [];
    this.loadConfig();
    try { return await this._searchGoogle(q); }
    catch (e) { console.warn('[PlaceService] Google failed:', e.message); return []; }
  },

  // รวมผลจากหลายแหล่ง · ตัดซ้ำ (ชื่อตรง + ใกล้ < 80m) · คงอันแรกตามลำดับความสำคัญ
  _dedupeResults(list) {
    const out = [];
    for (const r of list) {
      if (r.latitude == null || r.longitude == null) continue;
      const dup = out.find(o =>
        this._norm(o.place_name) === this._norm(r.place_name) &&
        this._distM(o.latitude, o.longitude, r.latitude, r.longitude) < 80
      );
      if (!dup) out.push(r);
    }
    return out.slice(0, 12);
  },

  // ---- [1] Local: substring/keyword match, เรียง use_count ----
  _searchLocal(query) {
    const q = this._norm(query);
    if (!q) return [];
    const hits = this._cache.filter(p => {
      const name = p.name_lower || this._norm(p.place_name);
      if (name.includes(q)) return true;
      if (Array.isArray(p.keywords)) {
        return p.keywords.some(k => this._norm(k).includes(q));
      }
      return false;
    });
    hits.sort((a, b) => (b.use_count || 0) - (a.use_count || 0));
    return hits.slice(0, 8).map(p => ({
      place_name: p.place_name,
      latitude:   p.latitude,
      longitude:  p.longitude,
      source:     'local',
      confidence: p.confidence || this.CONFIDENCE.local,
      use_count:  p.use_count || 0,
      _id:        p.id
    }));
  },

  // ---- [2] Longdo POI search (search.longdo.com — เรียกผ่าน fetch ได้ ไม่ติด CORS) ----
  async _searchLongdo(query) {
    const url = `https://search.longdo.com/mapsearch/json/search` +
                `?keyword=${encodeURIComponent(query)}` +
                `&lat=${this.CENTER_LAT}&lon=${this.CENTER_LON}` +
                `&span=${this.SPAN_M}&limit=8&key=${this.LONGDO_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const items = json.data || [];
    return items
      .filter(it => it.lat != null && it.lon != null)
      .map(it => ({
        place_name: it.name || it.address || '(ไม่มีชื่อ)',
        latitude:   parseFloat(it.lat),
        longitude:  parseFloat(it.lon),
        source:     'longdo',
        confidence: this.CONFIDENCE.longdo,
        address:    it.address || ''
      }));
  },

  // ---- [3] Google Places (New) — Text Search (รองรับ CORS เรียกจาก browser ได้) ----
  // ต้องเปิด "Places API (New)" ใน Google Cloud + ใส่ GOOGLE_KEY
  async _searchGoogle(query) {
    if (!this.GOOGLE_KEY) return [];   // ไม่มี key → ข้ามเงียบๆ
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   this.GOOGLE_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify({
        textQuery:    query,
        languageCode: 'th',
        regionCode:   'TH',
        maxResultCount: 8,
        locationBias: { circle: {
          center: { latitude: this.CENTER_LAT, longitude: this.CENTER_LON },
          radius: this.SPAN_M
        }}
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return (json.places || [])
      .filter(p => p.location)
      .map(p => ({
        place_name: (p.displayName && p.displayName.text) || p.formattedAddress || '(ไม่มีชื่อ)',
        latitude:   p.location.latitude,
        longitude:  p.location.longitude,
        source:     'google',
        confidence: this.CONFIDENCE.google,
        address:    p.formattedAddress || ''
      }));
  },


  // ===================== AUTO-LEARN =====================
  // เรียกตอนกดยืนยันหมุด → upsert เข้า Firestore places + อัปเดต cache ทันที
  // คืน { action: 'increment'|'create'|'update', place }
  async savePlace({ place_name, latitude, longitude, source, user_adjusted, created_by }) {
    place_name = (place_name || '').trim();
    latitude   = parseFloat(latitude);
    longitude  = parseFloat(longitude);
    if (!place_name || isNaN(latitude) || isNaN(longitude)) {
      throw new Error('savePlace: ต้องมี place_name + พิกัดที่ถูกต้อง');
    }
    source = source || 'manual';
    const nowISO = new Date().toISOString();
    const nameLower = this._norm(place_name);
    const db = this._db();

    await this.loadCache();

    // หา place เดิม: name_lower ตรง + พิกัดใกล้ (< DEDUPE_M)
    const existing = this._cache.find(p => {
      const pn = p.name_lower || this._norm(p.place_name);
      if (pn !== nameLower) return false;
      return this._distM(latitude, longitude, p.latitude, p.longitude) < this.DEDUPE_M;
    });

    // ---- กรณีมีอยู่แล้ว → use_count++ (+ อัปเดตพิกัดถ้าผู้ใช้ลากแก้) ----
    if (existing) {
      existing.use_count = (existing.use_count || 0) + 1;
      existing.updated_at = nowISO;
      const patch = { use_count: existing.use_count, updated_at: nowISO };
      // ถ้าเลือกจาก local อยู่แล้ว → แค่นับ ไม่ขยับพิกัด
      if (source !== 'local' && user_adjusted) {
        existing.latitude  = latitude;
        existing.longitude = longitude;
        existing.user_adjusted = true;
        patch.latitude = latitude;
        patch.longitude = longitude;
        patch.user_adjusted = true;
      }
      this._writeLocal();
      if (db) {
        try { await db.collection(this.COLLECTION).doc(existing.id).set(patch, { merge: true }); }
        catch (e) { console.warn('[PlaceService] update failed:', e.message); }
      }
      return { action: 'increment', place: existing };
    }

    // ---- ไม่มี → create ใหม่ ----
    const place = {
      id:           'PL-' + Date.now(),
      place_name,
      name_lower:   nameLower,
      keywords:     [],
      latitude,
      longitude,
      source,
      confidence:   this.CONFIDENCE[source] != null ? this.CONFIDENCE[source] : this.CONFIDENCE.manual,
      user_adjusted: !!user_adjusted,
      use_count:    1,
      created_at:   nowISO,
      created_by:   created_by || 'unknown',
      updated_at:   nowISO
    };
    this._cache.push(place);
    this._writeLocal();
    if (db) {
      try { await db.collection(this.COLLECTION).doc(place.id).set(place); }
      catch (e) { console.warn('[PlaceService] create failed:', e.message); }
    }
    return { action: 'create', place };
  }
};

if (typeof window !== 'undefined') window.PlaceService = PlaceService;
