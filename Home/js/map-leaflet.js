// ===== MAP PICKER (Leaflet + OSM + PlaceService) — Home theme น้ำเงิน =====
// Interface เดียวกับ map.js (Longdo) — drop-in replacement
// ค้นผ่าน PlaceService (staged): พิมพ์=Local · ปุ่มค้นหา=Longdo · ปุ่มค้นเพิ่ม=Google · auto-learn ตอนกดยืนยัน
const MapPicker = {
  map: null,
  marker: null,
  selectedLat: null,
  selectedLon: null,
  selectedName: null,
  selectedSource: null,   // local | longdo | google | nominatim | manual
  userAdjusted: false,    // ลากหมุดแก้ → true
  _manualPending: false,  // โหมดเพิ่มเอง: คลิกแผนที่ครั้งถัดไปให้คงชื่อที่พิมพ์
  _lastResults: null,
  _lastQuery: null,
  _googleTried: false,
  _pendingQuery: null,
  _mapShown: false,       // lazy-load: แผนที่ (tiles) โหลดเฉพาะตอนเปิดจริง
  searchTimer: null,
  onConfirm: null,

  // default = มุมกว้างทั้งประเทศไทย (ใช้เมื่อไม่มีพิกัดเดิม + GPS ไม่ได้)
  DEFAULT_LAT: 13.5,
  DEFAULT_LON: 100.9,
  DEFAULT_ZOOM: 5,
  MARKER_ZOOM: 16,    // ซูมเมื่อมีพิกัด (เดิม / GPS / เลือกผลค้นหา)
  // จุดอ้างอิงเรียงผลค้นหาตามระยะทาง — fallback = ศูนย์พื้นที่ศึกษา (บ้านไผ่) · อัปเดตเป็นพิกัดเดิม/GPS เมื่อมี
  REF_CENTER: [16.06, 102.73],
  _refLat: 16.06,
  _refLon: 102.73,
  // ธีมน้ำเงิน
  ACCENT: '#2563eb',
  HOVER:  '#dbeafe',

  open(currentCoords, onConfirm) {
    this.onConfirm = onConfirm;
    this.selectedLat = null;
    this.selectedLon = null;
    this.selectedName = null;
    this.selectedSource = null;
    this.userAdjusted = false;
    this._manualPending = false;
    this._lastResults = null;
    this._lastQuery = null;
    this._googleTried = false;
    this._pendingQuery = null;
    this._mapShown = false;
    // จุดอ้างอิงเรียงระยะทาง: พิกัดเดิม > ศูนย์พื้นที่ (จะอัปเดตเป็น GPS เมื่อได้)
    this._refLat = this.REF_CENTER[0];
    this._refLon = this.REF_CENTER[1];
    if (currentCoords) {
      const p = currentCoords.split(',').map(s => parseFloat(s.trim()));
      if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        this.selectedLat = p[0]; this.selectedLon = p[1];
        this._refLat = p[0]; this._refLon = p[1];
      }
    }
    this._refGeolocate();   // ลอง GPS เงียบๆ → ใช้เป็นจุดอ้างอิง "ใกล้ตัว"
    this._renderModal();   // ยังไม่ render แผนที่ — โหลด tiles เฉพาะตอนกดเปิดแผนที่ (_openMapView)
    // อุ่น cache places + config (key) ไว้ล่วงหน้า (ลด latency ตอนค้นครั้งแรก)
    if (typeof PlaceService !== 'undefined') {
      PlaceService.loadConfig();
      PlaceService.loadCache().catch(() => {});
    }
  },

  _renderModal() {
    const old = document.getElementById('mapPickerModal');
    if (old) old.remove();
    const isMobile = window.innerWidth < 768;
    const hint = this.selectedLat
      ? `📍 ${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`
      : 'ค้นหาด้านบน แล้วเลือกผล · หรือเปิดแผนที่เพื่อปักหมุด';
    const confirmOpacity = this.selectedLat ? '1' : '0.4';
    const accent = this.ACCENT;

    const el = document.createElement('div');
    el.id = 'mapPickerModal';
    el.style.cssText = isMobile
      ? 'position:fixed;inset:0;z-index:300;background:#fff;display:flex;flex-direction:column;animation:fadeIn .15s ease;'
      : 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .2s ease;';

    const innerStyle = isMobile
      ? 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;'
      : 'background:#fff;border-radius:16px;width:100%;max-width:680px;height:90vh;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.3);overflow:hidden;';

    el.innerHTML = `
      <div style="${innerStyle}">
        <div style="padding:${isMobile?'12px 16px 10px':'16px 20px 12px'};border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">📍 เลือกพิกัดจากแผนที่ <span style="font-size:11px;color:#94a3b8;font-weight:500;margin-left:6px;">(OpenStreetMap)</span></div>
          <button onclick="MapPicker.close()" style="width:32px;height:32px;border:none;background:#f1f5f9;border-radius:50%;cursor:pointer;font-size:16px;color:#64748b;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <div style="padding:${isMobile?'10px 16px':'12px 20px'};border-bottom:1px solid #f1f5f9;flex-shrink:0;">
          <div style="display:flex;gap:8px;">
            <input id="mapSearchInput" placeholder="ค้นหาสถานที่... เช่น โรงพยาบาลบ้านไผ่"
              style="flex:1;padding:9px 13px;border:1.5px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:16px;color:#1e293b;outline:none;"
              oninput="MapPicker._onSearchInput(this.value)"
              onkeydown="if(event.key==='Enter')MapPicker._search(this.value, 'longdo')"
              onfocus="this.style.borderColor='${accent}'"
              onblur="this.style.borderColor='#e2e8f0'" />
            <button onclick="MapPicker._search(document.getElementById('mapSearchInput').value, 'longdo')"
              style="padding:9px 14px;background:${accent};color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">
              ค้นหา
            </button>
          </div>
          <div id="mapSearchResults" style="margin-top:6px;max-height:${isMobile?'45vh':'50vh'};overflow-y:auto;"></div>
        </div>

        <div id="mapZone" style="flex:1;position:relative;overflow:hidden;background:#eef2f6;display:flex;align-items:center;justify-content:center;">
          <div id="mapPlaceholder" style="text-align:center;padding:24px;max-width:320px;">
            <div style="font-size:34px;margin-bottom:8px;">🗺️</div>
            <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:14px;">ค้นหาสถานที่ด้านบนแล้วเลือกผลได้เลย<br>หรือเปิดแผนที่เพื่อปักหมุดเอง</div>
            <button onclick="MapPicker._openMapView()" style="padding:10px 18px;background:${accent};color:#fff;border:none;border-radius:9px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">🗺 เปิดแผนที่ / ปักหมุดเอง</button>
          </div>
        </div>

        <div style="padding:${isMobile?'10px 16px':'12px 20px'};border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;background:#f8fafc;">
          <div id="mapCoordsDisplay" style="font-size:13px;color:#64748b;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hint}</div>
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <button onclick="MapPicker.close()" style="padding:9px 14px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">ยกเลิก</button>
            <button id="mapConfirmBtn" onclick="MapPicker.confirm()" style="padding:9px 16px;background:#10b981;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;opacity:${confirmOpacity};">✓ ยืนยัน</button>
          </div>
        </div>
      </div>`;
    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.body.appendChild(el);
  },

  // เปิดแผนที่จริง (lazy) — โหลด tiles ตอนนี้เท่านั้น
  _openMapView() {
    if (this._mapShown) return;
    this._mapShown = true;
    const zone = document.getElementById('mapZone');
    if (!zone) return;
    zone.style.display = 'block';
    zone.style.background = '#e5e7eb';
    zone.innerHTML = '<div id="mapContainer" style="position:absolute;inset:0;"></div>';
    setTimeout(() => this._initMap(), 30);
  },

  _initMap() {
    const container = document.getElementById('mapContainer');
    if (!container || typeof L === 'undefined') {
      console.warn('MapPicker: Leaflet not loaded');
      container && (container.innerHTML = '<div style="padding:24px;color:#dc2626;text-align:center;">โหลดแผนที่ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต</div>');
      return;
    }
    const hasCoords = this.selectedLat !== null;
    const lat  = hasCoords ? this.selectedLat : this.DEFAULT_LAT;
    const lon  = hasCoords ? this.selectedLon : this.DEFAULT_LON;
    const zoom = hasCoords ? this.MARKER_ZOOM : this.DEFAULT_ZOOM;

    this.map = L.map(container, { zoomControl: true, attributionControl: true })
      .setView([lat, lon], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    if (hasCoords) {
      this._placeMarker(this.selectedLat, this.selectedLon);
    } else {
      this._tryGeolocate();   // ไม่มีพิกัดเดิม → ลอง GPS เงียบๆ เป็นพื้นหลัง
    }

    this.map.on('click', (e) => {
      this._placeMarker(e.latlng.lat, e.latlng.lng);
      if (this._manualPending && this.selectedName) {
        // โหมดเพิ่มเอง: ปักหมุดให้ชื่อที่พิมพ์ค้นไว้ → คงชื่อ
        this._manualPending = false;
      } else {
        // คลิกแผนที่เปล่า → manual (ไม่ reverse geocode — เลิกใช้ Nominatim · ชื่อพิมพ์/เลือกเอง)
        this.selectedSource = 'manual';
      }
      this._updateCoordsDisplay();
    });

    // force layout recompute หลัง modal mount
    setTimeout(() => this.map && this.map.invalidateSize(), 200);
  },

  // ลอง GPS เงียบๆ เป็นพื้นหลัง — สำเร็จ → เลื่อนแผนที่ไปตำแหน่งผู้ใช้ (ไม่ปักหมุด รอเลือกเอง)
  // ไม่มีหน้าจอ custom · ครั้งแรกเบราว์เซอร์อาจเด้งขออนุญาตเอง (เลี่ยงไม่ได้) · ถ้าปฏิเสธ/ไม่มีสัญญาณ คงมุมประเทศไทย
  _tryGeolocate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // เลื่อนเฉพาะเมื่อผู้ใช้ยังไม่ได้เลือกพิกัด (กันแย่งกับการ search/คลิกระหว่างรอ GPS)
        if (this.map && this.selectedLat === null) {
          this.map.setView([pos.coords.latitude, pos.coords.longitude], this.MARKER_ZOOM);
        }
      },
      () => { /* ปฏิเสธ/ไม่มีสัญญาณ → คงมุมประเทศไทย */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  },

  _placeMarker(lat, lon) {
    if (!this.map) return;   // แผนที่ยังไม่เปิด → ไม่ปักหมุด (พิกัดเก็บไว้ที่ selectedLat แล้ว)
    this.selectedLat = lat;
    this.selectedLon = lon;
    if (!this.marker) {
      this.marker = L.marker([lat, lon], { draggable: true }).addTo(this.map);
      this.marker.on('dragend', () => {
        const p = this.marker.getLatLng();
        this.selectedLat = p.lat; this.selectedLon = p.lng;
        this.userAdjusted = true;   // ลากแก้ → ปรับพิกัด คงชื่อเดิม (ไม่ reverse)
        this._updateCoordsDisplay();
      });
    } else {
      this.marker.setLatLng([lat, lon]);
    }
    this._updateCoordsDisplay();
  },

  _updateCoordsDisplay() {
    const c = document.getElementById('mapCoordsDisplay');
    const b = document.getElementById('mapConfirmBtn');
    if (c && this.selectedLat !== null) c.innerHTML = `📍 ${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}${this.selectedName ? ' · ' + this._esc(this.selectedName) : ''}`;
    if (b) b.style.opacity = this.selectedLat !== null ? '1' : '0.4';
  },

  // ===== Search (staged · ประหยัด API) =====
  // พิมพ์สด → ค้น local เท่านั้น (ไม่ยิง API) · กดปุ่มค้นหา → Longdo · กด "ค้นเพิ่ม Google" → Google
  _onSearchInput(value) {
    clearTimeout(this.searchTimer);
    const v = value.trim();
    const r = document.getElementById('mapSearchResults');
    if (v.length < 2) { if (r) r.innerHTML = ''; return; }
    this.searchTimer = setTimeout(() => this._search(v, 'local'), 300);
  },

  // mode: 'local' (พิมพ์สด) | 'longdo' (กดค้นหา) | 'google' (กดค้นเพิ่ม)
  // GPS เงียบๆ สำหรับจุดอ้างอิงเรียงระยะทาง (cache 10 นาที · ไม่เลื่อนแผนที่)
  _refGeolocate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this._refLat = pos.coords.latitude;
        this._refLon = pos.coords.longitude;
        if (this._lastResults && this._lastResults.length) {
          this._sortByDistance(this._lastResults);
          this._renderResults(this._googleTried);
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  },

  // เรียงผลค้นหา ใกล้ → ไกล (เทียบจุดอ้างอิง) · ไม่มีพิกัด = ไปท้าย
  _sortByDistance(list) {
    if (!Array.isArray(list)) return list;
    const rl = this._refLat, ro = this._refLon;
    list.forEach(r => {
      r._dist = (r.latitude != null && r.longitude != null && !isNaN(+r.latitude) && !isNaN(+r.longitude))
        ? PlaceService._distM(rl, ro, +r.latitude, +r.longitude) : Infinity;
    });
    list.sort((a, b) => a._dist - b._dist);
    return list;
  },

  async _search(query, mode) {
    mode = mode || 'local';
    const q = (query || '').trim();
    const resultsEl = document.getElementById('mapSearchResults');
    if (!q || !resultsEl) return;
    if (typeof PlaceService === 'undefined') {
      resultsEl.innerHTML = '<div style="padding:10px;color:#dc2626;font-size:13px;">ระบบค้นหายังไม่พร้อม</div>';
      return;
    }

    if (mode === 'local') {
      this._lastQuery = q;
      this._googleTried = false;
      this._lastResults = PlaceService.searchLocal(q);
      this._sortByDistance(this._lastResults);
      this._renderResults(false);
      return;
    }

    if (mode === 'longdo') {
      resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:13px;">⌛ กำลังค้นหา...</div>';
      this._lastQuery = q;
      this._googleTried = false;
      try { this._lastResults = await PlaceService.searchLongdo(q); }
      catch (e) { this._lastResults = []; }
      this._sortByDistance(this._lastResults);
      this._renderResults(true);
      return;
    }

    if (mode === 'google') {
      resultsEl.insertAdjacentHTML('beforeend', '<div id="gLoad" style="padding:8px 10px;color:#7e22ce;font-size:13px;">⌛ ค้นเพิ่มใน Google...</div>');
      this._googleTried = true;
      let g = [];
      try { g = await PlaceService.searchGoogle(q); } catch (e) {}
      this._lastResults = PlaceService._dedupeResults([...(this._lastResults || []), ...g]);
      this._sortByDistance(this._lastResults);
      this._renderResults(true);
    }
  },

  // วาดผลลัพธ์ + ปุ่ม escalate Google / เพิ่มสถานที่ใหม่
  _renderResults(externalDone) {
    const resultsEl = document.getElementById('mapSearchResults');
    if (!resultsEl) return;
    const q = this._lastQuery || '';
    const list = this._lastResults || [];

    let html = list.map((r, i) => {
      const cnt  = (r.source === 'local' && r.use_count) ? `<span style="font-size:10px;color:#94a3b8;margin-left:6px;">${r.use_count}× ใช้</span>` : '';
      const dist = (r._dist != null && isFinite(r._dist)) ? `<span style="font-size:11px;color:#0ea5e9;font-weight:600;margin-left:6px;">📍 ${r._dist < 1000 ? Math.round(r._dist) + ' ม.' : (r._dist/1000).toFixed(1) + ' กม.'}</span>` : '';
      const addr = r.address ? `<div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this._esc(r.address)}</div>` : '';
      return `<div onclick="MapPicker._pickResult(${i})"
          style="padding:8px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:13px;color:#1e293b;line-height:1.4;"
          onmouseover="this.style.background='${this.HOVER}'" onmouseout="this.style.background='transparent'">
          <div style="margin-bottom:2px;">${this._badge(r.source)}${cnt}${dist}</div>
          <div style="font-weight:600;">${this._esc(r.place_name)}</div>
          ${addr}
        </div>`;
    }).join('');

    if (!list.length) {
      html = externalDone
        ? `<div style="padding:8px 10px;color:#94a3b8;font-size:13px;">ไม่พบ "${this._esc(q)}"</div>`
        : `<div style="padding:8px 10px;color:#94a3b8;font-size:13px;">พิมพ์แล้วกดปุ่ม “ค้นหา” เพื่อค้นจาก Longdo</div>`;
    }

    if (externalDone) {
      this._pendingQuery = q;
      html += '<div style="display:flex;gap:8px;padding:8px 2px;flex-wrap:wrap;">';
      if (!this._googleTried) {
        html += `<button onclick="MapPicker._search(MapPicker._lastQuery,'google')"
            style="padding:7px 11px;background:#f3e8ff;color:#7e22ce;border:1px solid #d8b4fe;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">🌐 ค้นเพิ่มใน Google</button>`;
      }
      html += `<button onclick="MapPicker._startManualAdd()"
            style="padding:7px 11px;background:${this.ACCENT};color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">➕ เพิ่ม "${this._esc(q)}" เป็นสถานที่ใหม่</button>`;
      html += '</div>';
    }

    resultsEl.innerHTML = html;
  },

  // badge บอกที่มาของผลลัพธ์
  _badge(src) {
    const m = {
      local:     ['📍', 'local',     '#dcfce7', '#166534'],
      longdo:    ['🔍', 'longdo',    '#dbeafe', '#1e40af'],
      google:    ['🌐', 'google',    '#f3e8ff', '#7e22ce'],
      nominatim: ['🗺', 'nominatim', '#f1f5f9', '#475569']
    }[src] || ['•', src || '?', '#f1f5f9', '#475569'];
    return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;background:${m[2]};color:${m[3]};white-space:nowrap;">${m[0]} ${m[1]}</span>`;
  },

  _pickResult(i) {
    const r = this._lastResults && this._lastResults[i];
    if (!r) return;
    this.selectedName = r.place_name;
    this.selectedSource = r.source;
    this.selectedLat = parseFloat(r.latitude);
    this.selectedLon = parseFloat(r.longitude);
    this.userAdjusted = false;
    this._manualPending = false;
    const inp = document.getElementById('mapSearchInput');
    if (inp) inp.value = r.place_name;
    // แผนที่เปิดอยู่ → ปักหมุด+เลื่อนไป · ยังไม่เปิด → แค่เก็บพิกัด (ไม่โหลด tiles)
    if (this.map) {
      this._placeMarker(this.selectedLat, this.selectedLon);
      this.map.setView([this.selectedLat, this.selectedLon], this.MARKER_ZOOM);
    }
    this._updateCoordsDisplay();
    const mapBtn = this._mapShown ? '' :
      `<button onclick="MapPicker._openMapView()" style="margin-top:7px;padding:5px 10px;background:#fff;color:${this.ACCENT};border:1px solid ${this.ACCENT};border-radius:7px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">🗺 ดู/ปรับบนแผนที่</button>`;
    const rEl = document.getElementById('mapSearchResults');
    if (rEl) rEl.innerHTML =
      `<div style="padding:9px 11px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:13px;color:#065f46;line-height:1.5;">
         ✓ เลือก: <b>${this._esc(r.place_name)}</b><br>
         <span style="font-size:11px;color:#047857;">กด “✓ ยืนยัน” ด้านล่างได้เลย</span><br>${mapBtn}
       </div>`;
  },

  // เริ่มโหมดเพิ่มเอง: ชื่อจากที่ค้น → เปิดแผนที่ → แตะปักหมุด → ยืนยัน
  _startManualAdd() {
    const q = this._pendingQuery || '';
    if (!q) return;
    this.selectedName = q;
    this.selectedSource = 'manual';
    this.userAdjusted = false;
    this._manualPending = true;
    const inp = document.getElementById('mapSearchInput');
    if (inp) inp.value = q;
    const rEl = document.getElementById('mapSearchResults');
    if (rEl) rEl.innerHTML = `<div style="padding:8px 10px;color:${this.ACCENT};font-size:13px;font-weight:600;">📌 แตะบนแผนที่เพื่อปักหมุดของ "${this._esc(q)}" แล้วกด ✓ ยืนยัน</div>`;
    this._openMapView();   // เปิดแผนที่ให้ปักหมุด
    if (this.selectedLat !== null) this._updateCoordsDisplay();
  },

  // ===== AUTO-LEARN: บันทึกเข้า shared place DB ตอนกดยืนยัน =====
  confirm() {
    if (this.selectedLat === null) return;
    const coords = `${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`;
    const name = this.selectedName || '';
    // best-effort save — ไม่บล็อก UX (cache อัปเดตทันที, Firestore เขียนเบื้องหลัง)
    if (name && typeof PlaceService !== 'undefined') {
      PlaceService.savePlace({
        place_name: name,
        latitude: this.selectedLat,
        longitude: this.selectedLon,
        source: this.selectedSource || 'manual',
        user_adjusted: this.userAdjusted,
        created_by: this._creator()
      }).catch(e => console.warn('[MapPicker] auto-learn save failed:', e.message));
    }
    if (this.onConfirm) this.onConfirm(coords, name);
    this.close();
  },

  // ผู้บันทึก = บัญชีที่ล็อกอินอยู่ (surveyor หรือ admin)
  _creator() {
    try {
      if (typeof App !== 'undefined') {
        if (App._role === 'admin' && App._adminUsername) return App._adminUsername;
        if (App._surveyorName) return App._surveyorName;
        if (App._adminUsername) return App._adminUsername;
      }
    } catch (_) {}
    return 'unknown';
  },

  _esc(s) {
    return (s || '').toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  },

  close() {
    const el = document.getElementById('mapPickerModal');
    if (el) el.remove();
    if (this.map) { this.map.remove(); this.map = null; }
    this.marker = null;
  }
};
