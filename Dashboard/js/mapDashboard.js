// ===== MAP DASHBOARD (Survey Heatmap) =====
const MapDashboard = {
  _map: null,
  _zonePolygons: null,   // Map<zoneName, { poly, centroid, feature }>
  _zoneCounts: null,
  _resizeHandler: null,
  _activeZone: null,
  _unsubscribe: null,    // Firestore realtime listener disposer

  DEFAULT_LAT: 14.6318,
  DEFAULT_LON: 102.7916,

  // ----- Public -----

  init() {
    const households = DB.getHouseholds();
    const points = households
      .map(hh => ({ coords: this._parseCoords(hh.coordinates), hh }))
      .filter(p => p.coords !== null);

    const features = (typeof ZONES_GEOJSON !== 'undefined' && ZONES_GEOJSON.features)
      ? ZONES_GEOJSON.features
      : [];

    this._zonePolygons = new Map();
    this._activeZone = null;
    this._zoneCounts = this._countHouseholdsPerZone(points, features);

    // Bounds cover BOTH zones and every household marker so nothing is
    // off-screen — e.g. test points captured outside the survey area.
    this._zoneBounds = this._extendBoundsWithPoints(
      this._computeBounds(features),
      points
    );

    this._initLongdoMap();

    setTimeout(() => {
      this._drawZones(this._zoneCounts);
      this._drawHouseholdMarkers(points, features);
      this._renderStatsPanel(this._zoneCounts, points.length, points, features);
      this._fixMapSize();
      this._fitToZones();
      // Start realtime sync after initial render
      this._startRealtimeSync();
    }, 200);

    if (features.length === 0) {
      this._renderNoZonesWarning();
    }
  },

  // Subscribe to Firestore changes — every change refreshes the map.
  _startRealtimeSync() {
    if (typeof FB === 'undefined') return;
    if (!FB.db) FB.init();
    if (!FB.db) {
      this._setLiveStatus('offline', 'Firebase ไม่พร้อม');
      return;
    }

    this._setLiveStatus('connecting', 'กำลังเชื่อมต่อ...');
    this._unsubscribe = FB.subscribe(
      ({ count, syncedAt }) => {
        this.refresh();
        const t = new Date(syncedAt).toLocaleTimeString('th-TH');
        this._setLiveStatus('live', `Live · อัปเดต ${t} · ${count} ครัวเรือน`);
      },
      err => {
        this._setLiveStatus('offline', 'ขาดการเชื่อมต่อ: ' + err.message);
      }
    );
  },

  _setLiveStatus(state, text) {
    const el = document.getElementById('mapLiveStatus');
    if (!el) return;
    const dot = state === 'live' ? '🟢' : state === 'connecting' ? '🟡' : '🔴';
    el.textContent = `${dot} ${text}`;
  },

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch (e) { /* already disposed */ }
      this._unsubscribe = null;
    }
    this._map = null;
    this._zonePolygons = null;
    this._zoneCounts = null;
    this._activeZone = null;
  },

  // Re-read DB, recount zones, and redraw overlays without re-creating the map.
  // Used by App.syncMap() after pulling fresh data from Firebase.
  refresh() {
    const households = DB.getHouseholds();
    const points = households
      .map(hh => ({ coords: this._parseCoords(hh.coordinates), hh }))
      .filter(p => p.coords !== null);

    const features = (typeof ZONES_GEOJSON !== 'undefined' && ZONES_GEOJSON.features)
      ? ZONES_GEOJSON.features
      : [];

    this._zoneCounts = this._countHouseholdsPerZone(points, features);
    this._activeZone = null;

    // clear previous overlays (zones + markers + count labels)
    if (this._map) {
      try { this._map.Overlays.clear(); } catch (e) { /* unsupported */ }
    }
    this._zonePolygons = new Map();

    this._drawZones(this._zoneCounts);
    this._drawHouseholdMarkers(points, features);
    this._renderStatsPanel(this._zoneCounts, points.length, points, features);
  },

  // ----- Map Init -----

  _initLongdoMap() {
    const container = document.getElementById('surveyMapContainer');
    if (!container || !window.longdo) {
      console.warn('MapDashboard: Longdo Maps SDK not ready');
      return;
    }

    this._map = new longdo.Map({
      placeholder: container,
      zoom: 11,
      location: { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT }
    });

    this._fixMapSize();
    setTimeout(() => this._fixMapSize(), 300);
    setTimeout(() => this._fixMapSize(), 800);

    this._resizeHandler = () => this._fixMapSize();
    window.addEventListener('resize', this._resizeHandler);
  },

  _fixMapSize() {
    const container = document.getElementById('surveyMapContainer');
    if (!container) return;

    // Force explicit height — Longdo creates .ldmap_placeholder at 100px default,
    // which prevents height:100% from working correctly.
    const isMobile = window.innerWidth <= 600;
    const targetH = isMobile
      ? Math.max(240, Math.round(window.innerWidth * 0.55))
      : Math.max(300, window.innerHeight - 82);

    container.style.height = targetH + 'px';

    const ph = container.querySelector('.ldmap_placeholder');
    if (ph) {
      ph.style.width  = container.offsetWidth + 'px';
      ph.style.height = targetH + 'px';
    }
  },

  // ----- Geometry -----

  _parseCoords(str) {
    if (!str) return null;
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { lat: parts[0], lon: parts[1] };
    }
    return null;
  },

  // GeoJSON ring: [[lon,lat], [lon,lat], ...]
  _pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1]; // lon, lat
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  _pointInFeature(lat, lon, feature) {
    const geom = feature.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon') {
      return this._pointInPolygon(lat, lon, geom.coordinates[0]);
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some(poly => this._pointInPolygon(lat, lon, poly[0]));
    }
    return false;
  },

  _polygonCentroid(ring) {
    const n = ring.length - 1; // GeoJSON closes ring: first === last
    if (n <= 0) return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
    let sumLon = 0, sumLat = 0;
    for (let i = 0; i < n; i++) {
      sumLon += ring[i][0];
      sumLat += ring[i][1];
    }
    return { lon: sumLon / n, lat: sumLat / n };
  },

  _featureCentroid(feature) {
    const geom = feature.geometry;
    if (!geom) return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
    if (geom.type === 'Polygon') return this._polygonCentroid(geom.coordinates[0]);
    if (geom.type === 'MultiPolygon') return this._polygonCentroid(geom.coordinates[0][0]);
    return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
  },

  _eachRing(feature, fn) {
    const geom = feature.geometry;
    if (!geom) return;
    if (geom.type === 'Polygon') geom.coordinates.forEach(fn);
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(fn));
  },

  _computeBounds(features) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    features.forEach(f => {
      this._eachRing(f, ring => {
        ring.forEach(c => {
          if (c[0] < minLon) minLon = c[0];
          if (c[0] > maxLon) maxLon = c[0];
          if (c[1] < minLat) minLat = c[1];
          if (c[1] > maxLat) maxLat = c[1];
        });
      });
    });
    if (!isFinite(minLat)) return null;
    return { minLat, maxLat, minLon, maxLon };
  },

  // Extend an existing bounds object with all point coordinates.
  // Used so the map view fits zones AND every household marker, even
  // ones that fall outside the survey area.
  _extendBoundsWithPoints(bounds, points) {
    let b = bounds ? { ...bounds } : null;
    points.forEach(({ coords }) => {
      if (!b) b = { minLat: coords.lat, maxLat: coords.lat, minLon: coords.lon, maxLon: coords.lon };
      else {
        if (coords.lat < b.minLat) b.minLat = coords.lat;
        if (coords.lat > b.maxLat) b.maxLat = coords.lat;
        if (coords.lon < b.minLon) b.minLon = coords.lon;
        if (coords.lon > b.maxLon) b.maxLon = coords.lon;
      }
    });
    return b;
  },

  _fitToZones() {
    if (!this._map || !this._zoneBounds) return;
    const b = this._zoneBounds;
    const centerLat = (b.minLat + b.maxLat) / 2;
    const centerLon = (b.minLon + b.maxLon) / 2;
    try {
      this._map.location({ lon: centerLon, lat: centerLat });
      // pick a zoom based on bounds extent
      const span = Math.max(b.maxLat - b.minLat, b.maxLon - b.minLon);
      let zoom = 12;
      if (span > 0.5)  zoom = 9;
      else if (span > 0.25) zoom = 10;
      else if (span > 0.1)  zoom = 11;
      else if (span > 0.05) zoom = 12;
      else if (span > 0.02) zoom = 13;
      else                  zoom = 14;
      this._map.zoom(zoom);
    } catch (e) { /* unsupported */ }
  },

  _featureRing(feature) {
    const geom = feature.geometry;
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    return [];
  },

  _countHouseholdsPerZone(points, features) {
    return features.map(feature => {
      const name = (feature.properties && feature.properties.name) || 'ไม่ระบุ';
      const matched = points.filter(p => this._pointInFeature(p.coords.lat, p.coords.lon, feature));
      return { name, feature, count: matched.length };
    });
  },

  // ----- Drawing -----

  _zoneColor(count) {
    if (count === 0) return { fill: 'rgba(148,163,184,0.15)', line: 'rgba(148,163,184,0.7)' };
    if (count < 5)  return { fill: 'rgba(59,130,246,0.15)',  line: 'rgba(59,130,246,0.8)' };
    if (count < 15) return { fill: 'rgba(59,130,246,0.25)',  line: 'rgba(37,99,235,0.9)' };
    return              { fill: 'rgba(37,99,235,0.35)',       line: 'rgba(30,64,175,1)' };
  },

  _drawZones(zoneCounts) {
    if (!this._map) return;

    zoneCounts.forEach(({ name, feature, count }) => {
      const ring = this._featureRing(feature);
      if (ring.length < 3) return;

      const color = this._zoneColor(count);
      const locs  = ring.map(c => ({ lon: c[0], lat: c[1] }));

      let poly;
      try {
        poly = new longdo.Polygon(locs, {
          lineColor: color.line,
          lineWidth: 2,
          fillColor: color.fill
        });
        this._map.Overlays.add(poly);
      } catch (e) {
        console.warn('MapDashboard: Polygon overlay failed', e);
        poly = null;
      }

      const centroid = this._featureCentroid(feature);
      this._zonePolygons.set(name, { poly, centroid, feature, count });

      // count label at centroid
      try {
        const label = new longdo.Dot(
          { lon: centroid.lon, lat: centroid.lat },
          {
            radius: count > 0 ? 14 : 10,
            weight: 1.5,
            lineColor: '#fff',
            fillColor: count > 0 ? '#2563eb' : '#94a3b8',
            title: String(count)
          }
        );
        this._map.Overlays.add(label);
      } catch (e) { /* Dot not supported — skip label */ }
    });
  },

  // Plot every household marker in red, with the house number as tooltip.
  _drawHouseholdMarkers(points, features) {
    if (!this._map) return;
    points.forEach(({ coords, hh }) => {
      const title = (hh && (hh.houseNo || hh.id)) || '';
      try {
        const dot = new longdo.Dot(
          { lon: coords.lon, lat: coords.lat },
          {
            radius: 6,
            weight: 1.4,
            lineColor: '#fff',
            fillColor: '#ef4444',
            title
          }
        );
        this._map.Overlays.add(dot);
      } catch (e) { /* skip */ }
    });
  },

  // ----- Stats Panel -----

  _renderStatsPanel(zoneCounts, totalPlotted, points, features) {
    const totalEl = document.getElementById('mapTotalCount');
    if (totalEl) {
      let summary = `รวม ${totalPlotted} ครัวเรือนที่มีพิกัด`;
      if (points && features && features.length) {
        const inside = points.filter(p =>
          features.some(f => this._pointInFeature(p.coords.lat, p.coords.lon, f))
        ).length;
        const outside = totalPlotted - inside;
        summary += ` · 🟢 ${inside} ในโซน · 🔴 ${outside} นอกโซน`;
      }
      totalEl.textContent = summary;
    }

    const listEl = document.getElementById('zoneList');
    if (!listEl) return;

    if (zoneCounts.length === 0) {
      listEl.innerHTML = `<div class="zone-empty">ยังไม่มีข้อมูลโซน<br>กรุณาแก้ไข js/zones.js</div>`;
      return;
    }

    const sorted = [...zoneCounts].sort((a, b) => b.count - a.count);
    listEl.innerHTML = sorted.map(({ name, count }) => `
      <div class="zone-row" onclick="MapDashboard._onZoneClick('${name.replace(/'/g, "\\'")}')">
        <div class="zone-row-name">${name}</div>
        <div class="zone-count-badge ${count === 0 ? 'zero' : ''}">${count}</div>
      </div>
    `).join('');
  },

  _renderNoZonesWarning() {
    const listEl = document.getElementById('zoneList');
    if (listEl) {
      listEl.innerHTML = `<div class="zone-empty">ยังไม่มีข้อมูลโซน<br>กรุณาแก้ไขไฟล์ <code>js/zones.js</code><br>ด้วยข้อมูล GeoJSON จริง</div>`;
    }
  },

  // ----- Interaction -----

  _onZoneClick(name) {
    this._highlightZone(name);

    // pan map to zone centroid
    const entry = this._zonePolygons && this._zonePolygons.get(name);
    if (entry && this._map) {
      try {
        this._map.location(entry.centroid);
      } catch (e) { /* pan not supported */ }
    }
  },

  _highlightZone(name) {
    // update sidebar active state
    document.querySelectorAll('.zone-row').forEach(el => {
      el.classList.toggle('active', el.querySelector('.zone-row-name').textContent === name);
    });
    this._activeZone = name;

    if (!this._map || !this._zonePolygons) return;

    // redraw all polygons with updated colors
    this._zonePolygons.forEach((entry, zoneName) => {
      if (!entry.poly) return;
      const isActive = zoneName === name;
      const color = isActive
        ? { fill: 'rgba(245,158,11,0.35)', line: 'rgba(217,119,6,1)' }
        : this._zoneColor(entry.count);
      try {
        this._map.Overlays.remove(entry.poly);
        const ring = this._featureRing(entry.feature);
        const locs = ring.map(c => ({ lon: c[0], lat: c[1] }));
        entry.poly = new longdo.Polygon(locs, {
          lineColor: color.line,
          lineWidth: isActive ? 3 : 2,
          fillColor: color.fill
        });
        this._map.Overlays.add(entry.poly);
      } catch (e) { /* skip */ }
    });
  }
};
