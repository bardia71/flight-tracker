import { airport, distanceNm } from './geo.js';
import { poll } from './tracker.js';
import { parseRoster } from './roster.js';
import SCHEMA from '../schema.sql';

// Create the tables on first use, so setup needs no database console steps.
let ready = null;
function ensureSchema(env) {
  ready ||= env.DB.batch(SCHEMA.split(';').map((q) => q.replace(/--.*$/gm, '').trim()).filter(Boolean)
    .map((q) => env.DB.prepare(q))).catch((e) => { ready = null; throw e; });
  return ready;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

// Constant-time string compare so the secret link can't be guessed by timing.
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function view(f) {
  const dep = airport(f.dep), arr = airport(f.arr), real = airport(f.actual_arr || f.arr);
  const off = f.actual_off || f.sched_out, on = f.actual_on || f.sched_in;
  return {
    id: f.id, flight_no: f.flight_no, callsign: f.callsign, status: f.status, deadhead: !!f.deadhead,
    dep: dep && { iata: dep.iata, city: dep.city, country: dep.country, name: dep.name, lat: dep.lat, lon: dep.lon },
    arr: arr && { iata: arr.iata, city: arr.city, country: arr.country, name: arr.name, lat: arr.lat, lon: arr.lon },
    landed_at: real && f.actual_arr && f.actual_arr !== f.arr
      ? { iata: real.iata, city: real.city, country: real.country, name: real.name, lat: real.lat, lon: real.lon } : null,
    sched_out: f.sched_out, sched_in: f.sched_in, actual_off: f.actual_off, actual_on: f.actual_on,
    reg: f.reg, aircraft_type: f.aircraft_type, last_seen: f.last_seen,
    distance_nm: dep && real ? Math.round(distanceNm(dep.lat, dep.lon, real.lat, real.lon)) : null,
    minutes: Math.max(0, Math.round((Date.parse(on) - Date.parse(off)) / 60000)),
  };
}

async function positions(env, id) {
  const { results } = await env.DB.prepare(
    'SELECT ts, lat, lon, alt, gs, trk FROM positions WHERE flight_id = ? ORDER BY ts').bind(id).all();
  return results;
}

// ---------- family (secret link) ----------
const PAST = "status != 'cancelled' AND (status IN ('landed','no_data') OR sched_in < ?1)";

async function familyStatus(env, url) {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 30 * 60000).toISOString();
  const limit = Math.min(50, +url.searchParams.get('recent') || 5);
  const live = await env.DB.prepare(
    `SELECT * FROM flights WHERE status = 'airborne'
       OR (status = 'scheduled' AND sched_out <= ?1 AND sched_in >= ?2)
     ORDER BY (status = 'airborne') DESC, sched_out LIMIT 1`).bind(soon, now).first();
  const { results: recent } = await env.DB.prepare(
    `SELECT * FROM flights WHERE ${PAST} ORDER BY sched_out DESC LIMIT ?2`).bind(now, limit).all();
  return json({
    name: env.DISPLAY_NAME || 'Captain', airline: env.AIRLINE_IATA || '', now, ntfy_topic: env.NTFY_TOPIC || null,
    live: live ? { ...view(live), track: await positions(env, live.id) } : null,
    recent: recent.map(view),
  });
}

async function familyFlights(env, url) {
  const now = new Date().toISOString();
  const from = url.searchParams.get('from') || '1970-01-01';
  const to = url.searchParams.get('to') ? `${url.searchParams.get('to')}T23:59:59Z` : now;
  const { results } = await env.DB.prepare(
    `SELECT * FROM flights WHERE ${PAST} AND sched_out >= ?2 AND sched_out <= ?3 ORDER BY sched_out DESC LIMIT 1000`)
    .bind(now, from, to < now ? to : now).all();
  return json({ flights: results.map(view) });
}

// ---------- admin (Bardia only) ----------
async function admin(env, req, url, path) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!same(auth, env.ADMIN_KEY)) return json({ error: 'Wrong admin password' }, 401);
  const method = req.method;

  if (path === 'check') return json({ ok: true, airline: env.AIRLINE_ICAO || '', family_key: env.FAMILY_KEY });
  if (path === 'flights' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM flights ORDER BY sched_out DESC LIMIT 500').all();
    return json({ flights: results.map((f) => ({ ...view(f), raw: f })) });
  }
  if (path === 'roster/parse' && method === 'POST') {
    const body = await req.json();
    return json(parseRoster(body.text || '', {
      airlineIcao: body.airline || env.AIRLINE_ICAO, timeMode: body.timeMode || 'local', baseTz: body.baseTz,
      year: body.year,
    }));
  }
  if (path === 'flights' && method === 'POST') {
    const { flights = [] } = await req.json();
    let added = 0, updated = 0;
    for (const f of flights) {
      if (!airport(f.dep) || !airport(f.arr) || !f.sched_out || !f.sched_in) continue;
      const callsign = String(f.callsign).toUpperCase().replace(/\s/g, '');
      const sched_out = new Date(f.sched_out).toISOString();
      const exists = await env.DB.prepare('SELECT id FROM flights WHERE callsign = ? AND sched_out = ?').bind(callsign, sched_out).first();
      await env.DB.prepare(
        `INSERT INTO flights (flight_no, callsign, dep, arr, sched_out, sched_in, deadhead) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (callsign, sched_out) DO UPDATE SET dep = excluded.dep, arr = excluded.arr,
           sched_in = excluded.sched_in, deadhead = excluded.deadhead, flight_no = excluded.flight_no`)
        .bind(String(f.flight_no || callsign), callsign, f.dep.toUpperCase(), f.arr.toUpperCase(), sched_out,
          new Date(f.sched_in).toISOString(), f.deadhead ? 1 : 0).run();
      exists ? updated++ : added++;
    }
    return json({ added, updated });
  }
  const m = path.match(/^flights\/(\d+)$/);
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM positions WHERE flight_id = ?').bind(+m[1]).run();
    await env.DB.prepare('DELETE FROM flights WHERE id = ?').bind(+m[1]).run();
    return json({ ok: true });
  }
  if (m && method === 'PATCH') {
    const b = await req.json();
    const allowed = ['callsign', 'status', 'deadhead', 'hex'];
    for (const k of allowed) if (k in b) {
      await env.DB.prepare(`UPDATE flights SET ${k} = ? WHERE id = ?`).bind(b[k], +m[1]).run();
    }
    return json({ ok: true });
  }
  if (path === 'poll' && method === 'POST') return json({ tracked: await poll(env) });
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) await ensureSchema(env);
    const p = url.pathname;
    let m;
    if ((m = p.match(/^\/api\/f\/([^/]+)\/(status|flights|track\/(\d+))$/))) {
      if (!same(m[1], env.FAMILY_KEY)) return json({ error: 'This link is not valid' }, 404);
      if (m[2] === 'status') return familyStatus(env, url);
      if (m[2] === 'flights') return familyFlights(env, url);
      const f = await env.DB.prepare('SELECT * FROM flights WHERE id = ?').bind(+m[3]).first();
      if (!f || (f.status === 'scheduled' && Date.parse(f.sched_out) > Date.now() + 30 * 60000)) return json({ error: 'Not found' }, 404);
      return json({ flight: view(f), track: await positions(env, f.id) });
    }
    if ((m = p.match(/^\/api\/admin\/(.+)$/))) return admin(env, req, url, m[1]);
    if (p.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    // Family page lives at /f/<secret>; admin at /admin. Everything else is static files.
    if (p.startsWith('/f/')) return env.ASSETS.fetch(new Request(new URL('/', url), req));
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(() => poll(env)));
  },
};
