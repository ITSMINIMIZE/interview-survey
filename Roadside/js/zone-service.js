// ===== ZONE SERVICE =====
// ดึงโซนจากระบบ (Firestore: config/zones ที่อัปโหลดผ่าน tools/import-zones.html)
// แล้วจับพิกัด lat,lon เข้าโซนด้วย point-in-polygon — ใช้ตอน Export Excel
const ZoneService = {
  _features: null,   // cache ต่อ session

  // โหลดโซนจากระบบ (ครั้งเดียว แล้ว cache)
  async load() {
    if (this._features) return this._features;
    if (!FB.db) FB.init();
    if (!FB.db) throw new Error('Firebase ไม่พร้อม');
    const meta = await FB.db.collection('config').doc('zones').get();
    if (!meta.exists || !(meta.data().chunks > 0))
      throw new Error('ยังไม่มีข้อมูลโซนในระบบ (อัปโหลดผ่าน tools → Import Zones)');
    const n = meta.data().chunks;
    const docs = await Promise.all(
      Array.from({ length: n }, (_, i) => FB.db.collection('config').doc('zones_c' + i).get())
    );
    if (docs.some(d => !d.exists)) throw new Error('ข้อมูลโซนในระบบไม่ครบชุด');
    const gj = JSON.parse(docs.map(d => d.data().data).join(''));
    this._features = gj.features || [];
    return this._features;
  },

  // ray casting — ring เป็น GeoJSON [lon,lat]
  _inRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    return inside;
  },

  _inFeature(lat, lon, f) {
    const g = f.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') return this._inRing(lat, lon, g.coordinates[0]);
    if (g.type === 'MultiPolygon') return g.coordinates.some(p => this._inRing(lat, lon, p[0]));
    return false;
  },

  // "16.05, 102.73" → เลขโซน (number เช่น 108) | "(นอกพื้นที่)" | "(ไม่มีพิกัด)"
  // ถ้ายังไม่ได้ load() สำเร็จ → คืน '' (คอลัมน์ว่าง)
  assign(coordStr) {
    if (!this._features) return '';
    const p = String(coordStr || '').split(',').map(s => parseFloat(s.trim()));
    if (p.length !== 2 || isNaN(p[0]) || isNaN(p[1])) return '(ไม่มีพิกัด)';
    for (const f of this._features) {
      if (this._inFeature(p[0], p[1], f)) {
        const pr = f.properties || {};
        const n = +pr.N;
        return isNaN(n) ? (pr.name || 'ไม่ระบุ') : n;   // เลขล้วน — Excel มองเป็น number
      }
    }
    return '(นอกพื้นที่)';
  }
};
