// Converts the UTM Zone 47N GeoJSON (Bahn Phai.geojson) to WGS84
// and writes out js/zones.js with `const ZONES_GEOJSON = {...}`.
//
// Run: node tools/convert-zones.js

const fs = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, '..', 'map', 'Bahn Phai.geojson');
const OUTPUT = path.join(__dirname, '..', 'js', 'zones.js');

// ---- UTM (WGS84 ellipsoid) → WGS84 lat/lon ----
// Zone 47N: central meridian 99°E, false easting 500000, k0 0.9996.
function utmToLatLon(easting, northing, zone, isNorth) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const k0 = 0.9996;

  const x = easting - 500000;
  const y = isNorth ? northing : northing - 10000000;

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  const phi1 = mu +
    (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
    (21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const ep2 = e2 / (1 - e2);
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2 -
    (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24 +
    (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720
  );

  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const lon = lonOrigin + (
    D -
    (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
    (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120
  ) / cosPhi1;

  return [
    +(lon * 180 / Math.PI).toFixed(6),
    +(lat * 180 / Math.PI).toFixed(6)
  ];
}

function convertRing(ring) {
  return ring.map(([e, n]) => utmToLatLon(e, n, 47, true));
}

function convertGeometry(geom) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(convertRing) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map(poly => poly.map(convertRing))
    };
  }
  return geom;
}

console.log('Reading', INPUT);
const raw = fs.readFileSync(INPUT, 'utf8');
const gj = JSON.parse(raw);
console.log(`Found ${gj.features.length} features`);

const converted = {
  type: 'FeatureCollection',
  name: gj.name || 'zones',
  features: gj.features.map((f, idx) => ({
    type: 'Feature',
    properties: {
      id:   idx + 1,
      srcId: f.properties.id,
      name: 'โซน ' + (idx + 1)
    },
    geometry: convertGeometry(f.geometry)
  }))
};

// Sanity: log centroid of feature 1
const firstCoords = converted.features[0].geometry.type === 'MultiPolygon'
  ? converted.features[0].geometry.coordinates[0][0]
  : converted.features[0].geometry.coordinates[0];
const cLon = firstCoords.reduce((s, c) => s + c[0], 0) / firstCoords.length;
const cLat = firstCoords.reduce((s, c) => s + c[1], 0) / firstCoords.length;
console.log(`Feature 1 centroid: lon=${cLon.toFixed(6)}, lat=${cLat.toFixed(6)}`);

const banner = '// ===== ZONES GEOJSON =====\n' +
               '// Auto-generated from map/Bahn Phai.geojson (EPSG:32647 → WGS84)\n' +
               '// To regenerate: node tools/convert-zones.js\n\n';

fs.writeFileSync(OUTPUT, banner + 'const ZONES_GEOJSON = ' + JSON.stringify(converted) + ';\n');
console.log('Wrote', OUTPUT, '(' + (fs.statSync(OUTPUT).size / 1024).toFixed(1) + ' KB)');
