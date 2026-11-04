// Runs every minute (Cloudflare cron). Looks up any flight that should be in the
// air right now on the free ADS-B networks and records where it is.
import { airport, distanceNm, nearestAirport } from './geo.js';

// Free community ADS-B networks with the same (readsb) JSON format, tried in order.
const SOURCES = [
  'https://api.adsb.lol/v2',
  'https://api.airplanes.live/v2',
  'https://opendata.adsb.fi/api/v2',
];

const MIN = 60_000;
const WINDOW_BEFORE = 60 * MIN;   // start looking an hour before scheduled departure
const WINDOW_AFTER = 4 * 60 * MIN; // keep looking up to 4h after scheduled arrival (delays)
const LOST_AFTER = 25 * MIN;      // no signal this long near destination = landed

async function lookup(env, path) {
  const sources = env.ADSB_SOURCES ? env.ADSB_SOURCES.split(',') : SOURCES;
  for (const base of sources) {
    try {
      const res = await fetch(`${base}/${path}`, {
        headers: { 'User-Agent': 'family-flight-tracker (personal, non-commercial)' },
        cf: { cacheTtl: 20 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      return data.ac || data.aircraft || [];
    } catch (_) { /* try the next network */ }
  }
  return null; // every network failed
}

function pickAircraft(list, flight) {
  const withPos = list.filter((a) => typeof a.lat === 'number');
  if (withPos.length <= 1) return withPos[0] || null;
  // Same callsign on several aircraft (rare): take the one nearest the route.
  const dep = airport(flight.dep), arr = airport(flight.arr);
  const score = (a) => Math.min(
    dep ? distanceNm(a.lat, a.lon, dep.lat, dep.lon) : 1e9,
    arr ? distanceNm(a.lat, a.lon, arr.lat, arr.lon) : 1e9);
  return withPos.sort((a, b) => score(a) - score(b))[0];
}

export async function poll(env, now = Date.now()) {
  const from = new Date(now + WINDOW_BEFORE).toISOString();
  const to = new Date(now - WINDOW_AFTER).toISOString();
  const { results: flights } = await env.DB.prepare(
    `SELECT * FROM flights WHERE status IN ('scheduled','airborne')
       AND sched_out <= ?1 AND sched_in >= ?2`).bind(from, to).all();

  // Give up on flights that are long over and were never seen.
  await env.DB.prepare(
    `UPDATE flights SET status = 'no_data' WHERE status = 'scheduled' AND sched_in < ?1`)
    .bind(to).run();

  for (const f of flights) {
    try { await trackOne(env, f, now); } catch (e) { console.log('track error', f.id, e.message); }
  }
  return flights.length;
}

async function trackOne(env, f, now) {
  const list = f.hex ? await lookup(env, `hex/${f.hex}`) : await lookup(env, `callsign/${f.callsign}`);
  if (list === null) return; // networks unreachable, try again next minute
  let ac = pickAircraft(list, f);
  // An aircraft keeps its hex but changes callsign on the next leg; make sure it's still ours.
  if (ac && f.hex && ac.flight && ac.flight.trim() && ac.flight.trim() !== f.callsign) ac = null;
  const iso = new Date(now).toISOString();

  if (!ac) {
    if (f.status === 'airborne' && f.last_seen && now - Date.parse(f.last_seen) > LOST_AFTER) {
      // Lost signal. If the last position was low and near the destination, call it landed.
      const last = await env.DB.prepare(
        'SELECT * FROM positions WHERE flight_id = ? ORDER BY ts DESC LIMIT 1').bind(f.id).first();
      const arr = airport(f.arr);
      if (last && arr && distanceNm(last.lat, last.lon, arr.lat, arr.lon) < 40 && (last.alt ?? 0) < 10000) {
        await land(env, f, last.ts, f.arr);
      }
    }
    return;
  }

  const onGround = ac.alt_baro === 'ground' || ac.ground === true;
  const alt = onGround ? 0 : Math.round(ac.alt_baro ?? ac.alt_geom ?? 0);
  const gs = Math.round(ac.gs ?? 0);
  const ts = new Date(now - (ac.seen_pos ?? 0) * 1000).toISOString();

  await env.DB.prepare(
    'INSERT OR IGNORE INTO positions (flight_id, ts, lat, lon, alt, gs, trk) VALUES (?,?,?,?,?,?,?)')
    .bind(f.id, ts, ac.lat, ac.lon, alt, gs, Math.round(ac.track ?? ac.true_heading ?? 0)).run();
  await env.DB.prepare(
    'UPDATE flights SET hex = ?, reg = COALESCE(?, reg), aircraft_type = COALESCE(?, aircraft_type), last_seen = ? WHERE id = ?')
    .bind(ac.hex, ac.r || null, ac.t || null, iso, f.id).run();

  const flying = !onGround && gs > 80;
  if (f.status === 'scheduled' && flying) {
    await env.DB.prepare("UPDATE flights SET status = 'airborne', actual_off = ? WHERE id = ?").bind(ts, f.id).run();
    await notify(env, `✈️ Took off from ${placeName(f.dep)}`, `${f.dep} → ${f.arr}. Follow along on the map.`);
  } else if (f.status === 'airborne' && (onGround || (gs < 50 && alt < 1500))) {
    await land(env, f, ts, nearestAirport(ac.lat, ac.lon) || f.arr);
  }
}

async function land(env, f, ts, where) {
  await env.DB.prepare("UPDATE flights SET status = 'landed', actual_on = ?, actual_arr = ? WHERE id = ?")
    .bind(ts, where, f.id).run();
  const diverted = where && where !== f.arr;
  await notify(env, `🛬 Landed in ${placeName(where)}`,
    diverted ? `Diverted from ${f.arr} to ${where}.` : `${f.dep} → ${f.arr} complete.`);
}

function placeName(iata) {
  const a = airport(iata);
  return a ? `${a.city} (${iata})` : iata;
}

// Optional phone alerts through ntfy.sh (free app, works worldwide). Set NTFY_TOPIC to enable.
async function notify(env, title, message) {
  if (!env.NTFY_TOPIC) return;
  try {
    await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: env.NTFY_TOPIC, title, message, click: env.SITE_URL || undefined }),
    });
  } catch (_) {}
}
