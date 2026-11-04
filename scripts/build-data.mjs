// Builds compact data files used by the app:
//  - src/airports.json   (IATA -> [name, city, country, lat, lon, timezone, icao])
//  - public/vendor/*     (Leaflet + low-detail world outline for offline map fallback)
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { feature } from 'topojson-client';

const raw = JSON.parse(readFileSync('node_modules/@nwpr/airport-codes/dist/airports.json', 'utf8'));
const out = {};
for (const a of raw) {
  if (!a.iata || a.iata.length !== 3 || a.iata === '\\N') continue;
  if (a.type && a.type !== 'airport') continue;
  out[a.iata] = [a.name, a.city, a.country, +a.latitude.toFixed(4), +a.longitude.toFixed(4),
    a.tz && a.tz !== '\\N' ? a.tz : null, a.icao && a.icao !== '\\N' ? a.icao : null];
}
writeFileSync('src/airports.json', JSON.stringify(out));
console.log('airports:', Object.keys(out).length);

mkdirSync('public/vendor/images', { recursive: true });
copyFileSync('node_modules/leaflet/dist/leaflet.js', 'public/vendor/leaflet.js');
copyFileSync('node_modules/leaflet/dist/leaflet.css', 'public/vendor/leaflet.css');
const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
const geo = feature(topo, topo.objects.countries);
const r = (c) => typeof c[0] === 'number' ? [+c[0].toFixed(2), +c[1].toFixed(2)] : c.map(r);
for (const f of geo.features) { f.properties = {}; f.geometry.coordinates = r(f.geometry.coordinates); }
writeFileSync('public/vendor/countries.json', JSON.stringify(geo));
console.log('vendor files copied');
