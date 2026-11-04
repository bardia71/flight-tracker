/* Family view: shows the live flight, the last arrival, recent flights and stats. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const parts = location.pathname.split('/').filter(Boolean);
  const KEY = parts[0] === 'f' ? parts[1] : new URLSearchParams(location.search).get('k');
  const DEMO = KEY === 'demo' || window.FT_DEMO;
  if (!KEY && !DEMO) return invalid();

  // ---------- data ----------
  async function api(path) {
    if (DEMO) return window.FT_DEMO_API(path);
    const res = await fetch(`/api/f/${encodeURIComponent(KEY)}/${path}`, { cache: 'no-store' });
    if (res.status === 404 && path === 'status') { invalid(); throw new Error('invalid'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ---------- helpers ----------
  const R_NM = 3440.065, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  function distNm(a, b) {
    const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Points along the great circle between a and b (what a long-haul route really looks like).
  function greatCircle(a, b, n = 64) {
    const [la1, lo1, la2, lo2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
    const d = distNm(a, b) / R_NM;
    if (d < 1e-6) return [a, b];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      pts.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
    }
    return unwrap(pts);
  }
  // Keep longitudes continuous so lines crossing the date line don't streak across the map.
  function unwrap(pts) {
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
      while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
    }
    return pts;
  }
  function pointAlong(a, b, nm) {
    const total = distNm(a, b);
    if (total < 1) return b;
    const pts = greatCircle(a, b, 200);
    return pts[Math.min(200, Math.max(0, Math.round((nm / total) * 200)))];
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDateYear = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  function ago(iso) {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  const dur = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const miles = (nm) => Math.round(nm * 1.15078);
  const km = (nm) => Math.round(nm * 1.852);
  const num = (n) => n.toLocaleString();
  let airline = '';
  const flightName = (f) => `${/^\d/.test(f.flight_no) && airline ? airline + ' ' : ''}${f.flight_no}`;
  const arrOf = (f) => f.landed_at || f.arr;

  // ---------- map ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const theme = document.documentElement.dataset.theme;
  const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const map = L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([50, -100], 3);
  // Simple country outlines first, so there's always a map even if tiles can't load.
  fetch((window.FT_BASE || '/vendor/') + 'countries.json').then((r) => r.json()).then((geo) => {
    L.geoJSON(geo, { interactive: false, style: { color: css('--border-land'), weight: 0.6, fillColor: css('--land'), fillOpacity: 1 } }).addTo(map).bringToBack();
  }).catch(() => {});
  if (!window.FT_NO_TILES) L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`, {
    subdomains: 'abcd', maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · positions: adsb.lol, airplanes.live',
  }).addTo(map);
  let layer = L.layerGroup().addTo(map);

  const planeSvg = (rot, color, hollow) => L.divIcon({
    className: '', iconSize: [34, 34], iconAnchor: [17, 17],
    html: `<svg class="plane-icon" width="34" height="34" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
        fill="${hollow ? 'none' : color}" stroke="${hollow ? color : '#fff'}" stroke-width="${hollow ? 1.6 : 1}" stroke-dasharray="${hollow ? '2 1.5' : ''}"/></svg>`,
  });
  function airportMarker(a, label) {
    L.circleMarker([a.lat, a.lon], { radius: 5, color: '#fff', weight: 2, fillColor: css('--accent'), fillOpacity: 1 })
      .bindTooltip(label || a.iata, { permanent: !!label, direction: 'top', className: 'ap-label', offset: [0, -4] })
      .bindPopup(`<b>${esc(a.iata)}</b> · ${esc(a.name)}<br>${esc(a.city)}, ${esc(a.country)}`).addTo(layer);
  }
  function fit(points) {
    if (!points.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 7 });
  }

  // Draw one flight: real track if we recorded it, otherwise the great-circle route.
  function drawFlight(f, track, opts = {}) {
    const a = [f.dep.lat, f.dep.lon], b = [arrOf(f).lat, arrOf(f).lon];
    const accent = css('--accent');
    let pts;
    if (track && track.length > 1) {
      pts = unwrap(track.map((p) => [p.lat, p.lon]));
      L.polyline(pts, { color: accent, weight: opts.thin ? 2 : 3.5, opacity: opts.thin ? 0.55 : 0.95 }).addTo(layer);
    } else {
      pts = greatCircle(a, b);
      L.polyline(pts, { color: accent, weight: opts.thin ? 1.5 : 3, opacity: opts.thin ? 0.45 : 0.8, dashArray: opts.thin ? null : '6 6' }).addTo(layer);
    }
    return pts;
  }

  // ---------- rendering ----------
  let state = null, selected = null;

  function renderLive(s) {
    const f = s.live, dep = f.dep, arr = arrOf(f);
    const track = f.track || [];
    const last = track[track.length - 1];
    const now = Date.now();
    layer.clearLayers();
    airportMarker(dep, dep.iata); airportMarker(arr, arr.iata);

    if (f.status !== 'airborne') {
      L.polyline(greatCircle([dep.lat, dep.lon], [arr.lat, arr.lon]), { color: css('--accent'), weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(layer);
      fit([[dep.lat, dep.lon], [arr.lat, arr.lon]]);
      $('#now').innerHTML = `<h2>Right now</h2>
        <span class="status-pill soon"><span class="dot"></span>Getting ready to depart</span>
        <div class="route">${esc(dep.city)} → ${esc(arr.city)}<small>${esc(flightName(f))} · ${esc(dep.iata)} → ${esc(arr.iata)}</small></div>
        <div class="facts"><div>Scheduled departure<b>${fmtTime(f.sched_out)}</b></div><div>Scheduled arrival<b>${fmtTime(f.sched_in)}</b></div></div>
        <div class="note">Times are shown in your own time zone. The map goes live once the plane is moving.</div>`;
      return;
    }

    const flown = drawFlight(f, track);
    let pos = last ? [last.lat, last.lon] : [dep.lat, dep.lon];
    let estimated = false, heading = last ? last.trk : bearing(pos, [arr.lat, arr.lon]);
    const lastAge = last ? (now - Date.parse(last.ts)) / 60000 : 0;
    // Free ADS-B networks rely on ground receivers, so coverage drops over oceans and remote areas.
    if (last && lastAge > 8 && last.gs > 100) {
      const travelled = Math.min(distNm(pos, [arr.lat, arr.lon]) - 5, (last.gs * lastAge) / 60);
      if (travelled > 0) {
        const est = pointAlong(pos, [arr.lat, arr.lon], travelled);
        L.polyline(unwrap([pos, ...greatCircle(pos, est, 24).slice(1)]), { color: css('--accent'), weight: 2.5, opacity: .6, dashArray: '2 6' }).addTo(layer);
        heading = bearing(pos, [arr.lat, arr.lon]);
        pos = est; estimated = true;
      }
    }
    L.polyline(greatCircle(pos, [arr.lat, arr.lon]), { color: css('--muted'), weight: 2, opacity: 0.6, dashArray: '6 7' }).addTo(layer);
    L.marker(pos, { icon: planeSvg(heading, css('--accent'), estimated), zIndexOffset: 1000 }).addTo(layer);

    const total = distNm([dep.lat, dep.lon], [arr.lat, arr.lon]);
    const left = distNm(pos, [arr.lat, arr.lon]);
    const pct = Math.max(2, Math.min(100, Math.round((1 - left / Math.max(total, 1)) * 100)));
    const gs = last?.gs || 0;
    const eta = gs > 120 ? new Date(now + (left / gs) * 3600000 + 10 * 60000).toISOString() : f.sched_in;
    fit([...flown, pos, [arr.lat, arr.lon]]);

    $('#now').innerHTML = `<h2>Right now</h2>
      <span class="status-pill live"><span class="dot"></span>Flying now</span>
      <div class="route">${esc(dep.city)} → ${esc(arr.city)}<small>${esc(flightName(f))} · ${esc(dep.iata)} → ${esc(arr.iata)}${f.aircraft_type ? ' · ' + esc(f.aircraft_type) : ''}${f.reg ? ' · ' + esc(f.reg) : ''}</small></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="row between note" style="margin:0"><span>${num(miles(total - left))} mi flown</span><span>${num(miles(left))} mi to go</span></div>
      <div class="facts">
        <div>Altitude<b>${last ? num(last.alt) + ' ft' : '—'}</b></div>
        <div>Speed<b>${gs ? num(Math.round(gs * 1.15078)) + ' mph' : '—'}</b></div>
        <div>Took off<b>${fmtTime(f.actual_off || f.sched_out)}</b></div>
        <div>Expected arrival<b>${fmtTime(eta)}</b></div>
      </div>
      ${estimated ? `<div class="note warn">Out of range of ground receivers since ${fmtTime(last.ts)} (common over oceans and remote areas). The outlined plane is an estimate based on speed and route.</div>`
        : `<div class="note">Last position ${last ? ago(last.ts) : 'not received yet'}. Times are in your time zone.</div>`}`;
  }

  function renderIdle(s) {
    const last = s.recent.find((f) => f.status === 'landed') || s.recent[0];
    if (!last) {
      $('#now').innerHTML = `<h2>Right now</h2><span class="status-pill idle"><span class="dot"></span>Not flying</span><div class="note">No flights yet.</div>`;
      layer.clearLayers();
      return;
    }
    const a = arrOf(last);
    $('#now').innerHTML = `<h2>Right now</h2>
      <span class="status-pill idle"><span class="dot"></span>Not flying right now</span>
      <div class="route">Last landed in ${esc(a.city)}<small>${esc(a.name)} (${esc(a.iata)}) · ${ago(last.actual_on || last.sched_in)}</small></div>
      <div class="row" style="margin-top:12px"><button class="ghost" id="showLast">Show on map</button></div>`;
    $('#showLast').onclick = () => showFlight(last);
    if (!selected) showRecent(s.recent);
  }

  function li(f) {
    const a = arrOf(f);
    const el = document.createElement('li');
    el.innerHTML = `<div><div class="r">${esc(f.dep.iata)} → ${esc(a.iata)}${f.deadhead ? '<span class="badge">passenger</span>' : ''}${f.landed_at ? '<span class="badge">diverted</span>' : ''}</div>
      <div class="m">${esc(f.dep.city)} to ${esc(a.city)}</div></div>
      <div style="text-align:right"><div class="m">${fmtDate(f.actual_off || f.sched_out)}</div><div class="m">${esc(flightName(f))} · ${dur(f.minutes)}</div></div>`;
    el.onclick = () => { document.querySelectorAll('.list li.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); showFlight(f); };
    return el;
  }

  function showRecent(list) {
    layer.clearLayers();
    const pts = [];
    const seen = new Set();
    for (const f of list) {
      pts.push(...drawFlight(f, null, { thin: true }));
      for (const a of [f.dep, arrOf(f)]) if (!seen.has(a.iata)) { seen.add(a.iata); airportMarker(a); }
    }
    if (list[0]) {
      const a = arrOf(list[0]);
      L.circleMarker([a.lat, a.lon], { radius: 9, color: css('--good'), weight: 3, fill: false }).bindTooltip(`Last arrival: ${a.iata}`, { permanent: true, direction: 'right', className: 'ap-label', offset: [8, 0] }).addTo(layer);
    }
    fit(pts);
  }

  async function showFlight(f) {
    selected = f.id;
    if (window.innerWidth < 900) $('#map').scrollIntoView({ behavior: 'smooth' });
    let track = null;
    try { track = (await api(`track/${f.id}`)).track; } catch (_) {}
    layer.clearLayers();
    const pts = drawFlight(f, track);
    airportMarker(f.dep, f.dep.iata); airportMarker(arrOf(f), arrOf(f).iata);
    fit(pts);
  }

  function renderList(el, flights) {
    el.innerHTML = '';
    if (!flights.length) { el.innerHTML = '<li class="m" style="cursor:default">No flights in this period.</li>'; return; }
    flights.forEach((f) => el.appendChild(li(f)));
  }

  function renderStats(flights) {
    const flown = flights.filter((f) => f.status === 'landed' || f.status === 'no_data');
    const nm = flown.reduce((t, f) => t + (f.distance_nm || 0), 0);
    const min = flown.reduce((t, f) => t + (f.minutes || 0), 0);
    const airports = new Set(), countries = new Set();
    flown.forEach((f) => [f.dep, arrOf(f)].forEach((a) => { airports.add(a.iata); countries.add(a.country); }));
    const longest = flown.reduce((m, f) => (f.distance_nm > (m?.distance_nm || 0) ? f : m), null);
    $('#stats').innerHTML = `
      <div class="stat"><b>${num(flown.length)}</b><span>flights</span></div>
      <div class="stat"><b>${num(miles(nm))}</b><span>miles (${num(km(nm))} km)</span></div>
      <div class="stat"><b>${num(Math.round(min / 60))}</b><span>hours in the air</span></div>
      <div class="stat"><b>${airports.size}</b><span>airports</span></div>
      <div class="stat"><b>${countries.size}</b><span>countr${countries.size === 1 ? 'y' : 'ies'}</span></div>
      <div class="stat"><b>${(nm / 21639).toFixed(1)}×</b><span>around the Earth</span></div>
      ${longest ? `<div class="note" style="grid-column:1/-1">Longest: ${esc(longest.dep.city)} → ${esc(arrOf(longest).city)}, ${num(miles(longest.distance_nm))} mi</div>` : ''}`;
  }

  async function loadRange(from, to) {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const { flights } = await api(`flights?${q}`);
    renderStats(flights);
    renderList($('#history'), flights);
    selected = null;
    showRecent(flights);
  }

  async function refresh() {
    try {
      const s = await api(`status?recent=${$('#recentN').value}`);
      state = s; airline = s.airline || '';
      document.title = `Where's ${s.name}?`;
      $('#title').textContent = `Where's ${s.name}?`;
      $('#updated').textContent = `Updated ${fmtTime(s.now)} · refreshes automatically`;
      if (s.live) { selected = null; renderLive(s); } else renderIdle(s);
      renderList($('#recent'), s.recent);
      if (s.ntfy_topic) { $('#alerts').classList.remove('hidden'); $('#topic').textContent = s.ntfy_topic; }
      clearTimeout(refresh.t);
      refresh.t = setTimeout(refresh, s.live ? 30000 : 120000);
    } catch (e) {
      if (e.message === 'invalid') return;
      $('#updated').textContent = 'Having trouble connecting, retrying…';
      clearTimeout(refresh.t);
      refresh.t = setTimeout(refresh, 30000);
    }
  }

  function invalid() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('invalid').classList.remove('hidden');
    document.getElementById('updated').textContent = '';
  }

  // ---------- wiring ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
    if (b.dataset.tab === 'history' && !$('#stats').innerHTML) document.querySelector('[data-range="90"]').click();
    if (b.dataset.tab === 'recent' && state) { selected = null; state.live ? renderLive(state) : showRecent(state.recent); }
  });
  document.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = b.dataset.range === 'all' ? '' : new Date(Date.now() - b.dataset.range * 86400000).toISOString().slice(0, 10);
    $('#from').value = from; $('#to').value = to;
    loadRange(from, to);
  });
  $('#loadRange').onclick = () => loadRange($('#from').value, $('#to').value);
  $('#recentN').onchange = () => { selected = null; refresh(); };
  $('#copyTopic').onclick = () => navigator.clipboard?.writeText($('#topic').textContent);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();
