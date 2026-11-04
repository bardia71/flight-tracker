/* Sample data for the demo link (/f/demo), so the page can be previewed with no backend. */
(function () {
  const AP = {
    YVR: [49.1939, -123.1844, 'Vancouver', 'Vancouver International Airport', 'Canada'],
    YYZ: [43.6772, -79.6306, 'Toronto', 'Toronto Pearson International Airport', 'Canada'],
    YYC: [51.1139, -114.0203, 'Calgary', 'Calgary International Airport', 'Canada'],
    YWG: [49.9100, -97.2399, 'Winnipeg', 'Winnipeg James Armstrong Richardson Airport', 'Canada'],
    YEG: [53.3097, -113.5800, 'Edmonton', 'Edmonton International Airport', 'Canada'],
    YOW: [45.3225, -75.6692, 'Ottawa', 'Ottawa Macdonald-Cartier International Airport', 'Canada'],
    YQT: [48.3719, -89.3239, 'Thunder Bay', 'Thunder Bay Airport', 'Canada'],
    YYJ: [48.6469, -123.4258, 'Victoria', 'Victoria International Airport', 'Canada'],
    YQR: [50.4319, -104.6658, 'Regina', 'Regina International Airport', 'Canada'],
    CUN: [21.0365, -86.8771, 'Cancun', 'Cancún International Airport', 'Mexico'],
  };
  const ap = (c) => ({ iata: c, lat: AP[c][0], lon: AP[c][1], city: AP[c][2], name: AP[c][3], country: AP[c][4] });
  const R = 3440.065, rad = (d) => d * Math.PI / 180;
  const dist = (a, b) => { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); };
  const H = 3600000, now = Date.now();
  // [flight, dep, arr, hours ago it departed, block minutes, deadhead]
  const legs = [
    ['2051', 'CUN', 'YVR', 30, 383], ['2412', 'YQR', 'CUN', 64, 320], ['3404', 'YEG', 'YQR', 77, 83, 1],
    ['506', 'YYJ', 'YEG', 80, 97], ['505', 'YEG', 'YYJ', 83, 111], ['170', 'YVR', 'YEG', 86, 92],
    ['222', 'YYC', 'YWG', 230, 146, 1], ['221', 'YWG', 'YYC', 235, 145], ['317', 'YEG', 'YVR', 400, 108],
    ['154', 'YYC', 'YEG', 418, 51], ['783', 'YQT', 'YYC', 424, 177], ['782', 'YYC', 'YQT', 428, 152],
    ['235', 'YWG', 'YYC', 446, 141], ['232', 'YYC', 'YWG', 449, 127], ['114', 'YVR', 'YYC', 453, 87],
    ['617', 'YOW', 'YYC', 580, 282], ['892', 'YYZ', 'YOW', 597, 56], ['386', 'YWG', 'YYZ', 600, 131, 1],
    ['383', 'YYZ', 'YWG', 727, 161, 1], ['712', 'YVR', 'YYZ', 744, 241],
  ];
  const flights = legs.map(([n, d, a, h, m, dh], i) => {
    const off = new Date(now - h * H).toISOString(), on = new Date(now - h * H + m * 60000).toISOString();
    return { id: i + 1, flight_no: n, status: 'landed', deadhead: !!dh, dep: ap(d), arr: ap(a), landed_at: null,
      sched_out: off, sched_in: on, actual_off: off, actual_on: on, distance_nm: dist(ap(d), ap(a)), minutes: m, aircraft_type: 'B38M' };
  });
  // A flight in progress: YVR -> YYZ, about 60% done.
  const dep = ap('YVR'), arr = ap('YYZ'), dur = 241 * 60000, start = now - dur * 0.6;
  const track = [];
  for (let i = 0; i <= 60; i++) {
    const f = (i / 100), t = start + (dur * i) / 100;
    // simple great-circle-ish interpolation with a gentle curve
    const lat = dep.lat + (arr.lat - dep.lat) * f + Math.sin(Math.PI * f) * 3.2, lon = dep.lon + (arr.lon - dep.lon) * f;
    track.push({ ts: new Date(Math.min(t, now - 90000)).toISOString(), lat, lon, alt: i < 4 ? 4000 + i * 8000 : 37000, gs: i < 4 ? 300 : 468, trk: 88 });
  }
  const live = { id: 99, flight_no: '702', status: 'airborne', deadhead: false, dep, arr, landed_at: null,
    sched_out: new Date(start - 15 * 60000).toISOString(), sched_in: new Date(start + dur).toISOString(),
    actual_off: new Date(start).toISOString(), actual_on: null, aircraft_type: 'B38M', reg: 'C-FNWD', minutes: 241, track };
  const showLive = !/idle/.test(location.search);

  window.FT_DEMO_API = async (path) => {
    if (path.startsWith('status')) {
      const n = +(new URLSearchParams(path.split('?')[1]).get('recent') || 10);
      return { name: 'Bardia', airline: 'WS', now: new Date().toISOString(), ntfy_topic: 'demo-topic', live: showLive ? live : null, recent: flights.slice(0, n) };
    }
    if (path.startsWith('track/')) {
      const id = +path.split('/')[1];
      return { track: id === 99 ? track : null };
    }
    if (path.startsWith('flights')) {
      const q = new URLSearchParams(path.split('?')[1]);
      const from = q.get('from') ? Date.parse(q.get('from')) : 0;
      return { flights: flights.filter((f) => Date.parse(f.sched_out) >= from) };
    }
  };
})();
