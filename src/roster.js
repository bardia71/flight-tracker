// Turns roster text (copied/exported from FLICA, or a calendar .ics file) into flight legs.
// FLICA layouts vary by airline, so this is tolerant: it looks for lines with a flight
// number, two airport codes and two times, and remembers the most recent date it saw.
import { airport, localToUtc } from './geo.js';

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n) => String(n).padStart(2, '0');

// opts: { airlineIcao, timeMode: 'local'|'utc'|'base', baseTz, year }
export function parseRoster(text, opts = {}) {
  if (/BEGIN:VCALENDAR/.test(text)) return parseIcs(text, opts);
  const year0 = opts.year || new Date().getUTCFullYear();
  let year = year0, month = null, day = null, yearSeen = false;
  const legs = [], skipped = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!line) continue;

    // FLICA leg lines start with weekday + day, e.g. "FR 02" or "MO26".
    const dd = line.match(/^(MO|TU|WE|TH|FR|SA|SU) ?(\d{1,2})\b/);
    if (dd && month) {
      if (day && +dd[2] < day - 7) { month = month === 12 ? 1 : month + 1; if (month === 1) year++; }
      day = +dd[2];
    }

    // Remember dates as we go: 2026-11-12, 11/12/2026, 12NOV, 12NOV26, NOV 12, "NOVEMBER 2026".
    let m;
    if (dd || /UPDATED|PRINTED/.test(line)) { /* not a schedule date */ }
    else if ((m = line.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]* SCHEDULE\b/))) { month = MONTHS[m[1]]; day = null; }
    else if ((m = line.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/))) { year = +m[1]; month = +m[2]; day = +m[3]; }
    else if ((m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) { month = +m[1]; day = +m[2]; if (m[3]) year = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else if ((m = line.match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})?\b/))) { day = +m[1]; month = MONTHS[m[2]]; if (m[3]) year = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else if ((m = line.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.? (\d{1,2})\b(?!:)/))) { month = MONTHS[m[1]]; day = +m[2]; }
    else if ((m = line.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]* (20\d\d)\b/))) { month = MONTHS[m[1]]; year = +m[2]; }
    if (year !== year0) yearSeen = true;

    // Flight leg: [DH] [XX]1234 ORD[-/ ]LGA 0600 0912   or   1234 ORD 0600 LGA 0912
    const a = line.match(/\b(DH|DHD|D\/H)?\*?\s?(?:([A-Z]{2}|[A-Z]\d|\d[A-Z]) ?)?\*? ?(\d{1,4})\*? ([A-Z]{3}) ?[-\/ ] ?([A-Z]{3}) ?(\d{2}:?\d{2})[LZ]? (\d{2}:?\d{2})/);
    const b = !a && line.match(/\b(DH|DHD|D\/H)?\*?\s?(?:([A-Z]{2}|[A-Z]\d|\d[A-Z]) ?)?\*? ?(\d{1,4})\*? ([A-Z]{3}) (\d{2}:?\d{2})[LZ]? ([A-Z]{3}) (\d{2}:?\d{2})/);
    let leg = null;
    if (a) leg = { dh: !!a[1], carrier: a[2], num: a[3], dep: a[4], arr: a[5], out: a[6], in: a[7] };
    else if (b) leg = { dh: !!b[1], carrier: b[2], num: b[3], dep: b[4], out: b[5], arr: b[6], in: b[7] };
    if (!leg) continue;
    if (/^(MO|TU|WE|TH|FR|SA|SU)$/.test(leg.carrier || '')) leg.carrier = undefined;
    if (leg.carrier === 'DH') { leg.carrier = undefined; leg.dh = true; }
    if (/\bDH\b|DEADHEAD/.test(line)) leg.dh = true;

    if (leg.dep === leg.arr) continue; // ground/positioning events like "NRE YVR-YVR"
    const depA = airport(leg.dep), arrA = airport(leg.arr);
    if (!depA || !arrA) { skipped.push({ line: rawLine.trim(), reason: `Unknown airport ${!depA ? leg.dep : leg.arr}` }); continue; }
    if (!month || !day) { skipped.push({ line: rawLine.trim(), reason: 'No date found before this line' }); continue; }
    let y = year;
    if (!opts.year && !yearSeen) {
      const near = (yy) => Math.abs(Date.UTC(yy, month - 1, day) - Date.now());
      y = [year - 1, year, year + 1].sort((p, q) => near(p) - near(q))[0];
    }
    const date = `${y}-${pad(month)}-${pad(day)}`;
    legs.push(makeLeg(leg, date, depA, arrA, opts));
  }
  return { legs, skipped };
}

function makeLeg(leg, date, depA, arrA, opts) {
  const tzFor = (a) => (opts.timeMode === 'utc' ? null : opts.timeMode === 'base' ? opts.baseTz : a.tz);
  const out = localToUtc(date, leg.out, tzFor(depA));
  let inn = localToUtc(date, leg.in, tzFor(arrA));
  while (Date.parse(inn) <= Date.parse(out)) inn = new Date(Date.parse(inn) + 86400000).toISOString();
  const carrier = leg.carrier && leg.carrier.length === 2 ? null : leg.carrier;
  let icao = opts.airlineIcao || carrier || '';
  // WestJet: 3000-series flights are operated by WestJet Encore (callsign WEN).
  if (icao === 'WJA' && /^3\d{3}$/.test(leg.num)) icao = 'WEN';
  return {
    flight_no: `${leg.carrier ? leg.carrier : ''}${leg.num}`,
    callsign: `${icao}${leg.num.replace(/^0+/, '')}`,
    dep: depA.iata, arr: arrA.iata, sched_out: out, sched_in: inn, deadhead: leg.dh ? 1 : 0,
  };
}

function parseIcs(text, opts) {
  const legs = [], skipped = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  for (const ev of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => (ev.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, 'm')) || [])[1]?.trim();
    const summary = (get('SUMMARY') || '') + ' ' + (get('DESCRIPTION') || '').replace(/\\n/g, '\n');
    const start = get('DTSTART');
    // Events that are a single flight: SUMMARY like "1234 ORD-LGA".
    const m = summary.toUpperCase().match(/(DH)?\s?(?:([A-Z]{2}|[A-Z]\d|\d[A-Z]) ?)?(\d{1,4}) ([A-Z]{3}) ?[-\/ ] ?([A-Z]{3})/);
    const end = get('DTEND');
    if (m && start && end && /T\d{6}Z$/.test(start)) {
      const depA = airport(m[4]), arrA = airport(m[5]);
      if (!depA || !arrA) { skipped.push({ line: summary.trim(), reason: 'Unknown airport' }); continue; }
      const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:00.000Z`;
      const icao = opts.airlineIcao || (m[2] && m[2].length === 3 ? m[2] : '');
      legs.push({ flight_no: `${m[2] || ''}${m[3]}`, callsign: `${icao}${m[3].replace(/^0+/, '')}`, dep: depA.iata, arr: arrA.iata,
        sched_out: iso(start), sched_in: iso(end), deadhead: m[1] ? 1 : 0 });
    } else {
      // Pairing-style event: run the text parser over its description with the event date.
      const date = start ? `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}` : '';
      const r = parseRoster(`${date}\n${summary}`, opts);
      legs.push(...r.legs); skipped.push(...r.skipped);
    }
  }
  return { legs, skipped };
}
