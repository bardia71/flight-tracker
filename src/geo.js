import AIRPORTS from './airports.json';

export function airport(iata) {
  const a = AIRPORTS[(iata || '').toUpperCase()];
  if (!a) return null;
  return { iata: iata.toUpperCase(), name: a[0], city: a[1], country: a[2], lat: a[3], lon: a[4], tz: a[5], icao: a[6] };
}

const R_NM = 3440.065;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceNm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestAirport(lat, lon, maxNm = 30) {
  let best = null, bestD = maxNm;
  for (const [iata, a] of Object.entries(AIRPORTS)) {
    if (Math.abs(a[3] - lat) > 1 || Math.abs(a[4] - lon) > 1.5) continue;
    const d = distanceNm(lat, lon, a[3], a[4]);
    if (d < bestD) { bestD = d; best = iata; }
  }
  return best;
}

// Convert a wall-clock time at an airport to UTC. date "2026-11-12", time "0630" or "06:30".
export function localToUtc(date, time, tz) {
  const t = String(time).replace(':', '').padStart(4, '0');
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +t.slice(0, 2), +t.slice(2, 4));
  if (!tz) return new Date(guess).toISOString();
  const offset = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let ms = guess - offset(guess);
  ms = guess - offset(ms); // second pass handles DST edges
  return new Date(ms).toISOString();
}
