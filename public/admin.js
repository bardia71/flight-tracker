(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pw = '';
  try { pw = localStorage.getItem('ft_admin') || ''; } catch (_) {}
  let parsed = [];

  async function api(path, method = 'GET', body) {
    const res = await fetch(`/api/admin/${path}`, {
      method, headers: { Authorization: `Bearer ${pw}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
  const utc = (iso) => iso.slice(0, 16).replace('T', ' ');
  const statusText = { scheduled: 'Upcoming', airborne: '✈️ Flying', landed: 'Landed', no_data: 'Flown (no track recorded)', cancelled: 'Cancelled' };

  async function signIn() {
    try {
      const r = await api('check');
      try { localStorage.setItem('ft_admin', pw); } catch (_) {}
      $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden'); $('#logout').classList.remove('hidden');
      const link = `${location.origin}/f/${r.family_key}`;
      $('#familyLink').value = link; $('#openLink').href = link;
      loadFlights();
    } catch (e) {
      $('#loginMsg').textContent = pw ? e.message : '';
    }
  }

  async function loadFlights() {
    const { flights } = await api('flights');
    const tb = $('#flights tbody');
    tb.innerHTML = flights.length ? '' : '<tr><td colspan="6" class="note">No flights yet. Import your schedule above.</td></tr>';
    for (const f of flights) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(utc(f.sched_out).slice(0, 10))}</td><td>${esc(f.flight_no)}${f.deadhead ? ' <span class="note">DH</span>' : ''}</td>
        <td>${esc(f.dep?.iata)}→${esc(f.raw.arr)}${f.raw.actual_arr && f.raw.actual_arr !== f.raw.arr ? ' (landed ' + esc(f.raw.actual_arr) + ')' : ''}</td>
        <td>${esc(statusText[f.status] || f.status)}</td>
        <td><input value="${esc(f.callsign)}" size="8" data-cs="${f.id}"></td>
        <td><button class="danger" data-del="${f.id}">Delete</button></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this flight and its recorded track?')) return;
      await api(`flights/${b.dataset.del}`, 'DELETE'); loadFlights();
    });
    tb.querySelectorAll('[data-cs]').forEach((i) => i.onchange = () => api(`flights/${i.dataset.cs}`, 'PATCH', { callsign: i.value.toUpperCase().trim() }));
  }

  function showPreview(r) {
    parsed = r.legs;
    const tb = $('#preview tbody');
    tb.innerHTML = '';
    r.legs.forEach((l, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input type="checkbox" checked data-i="${i}"></td><td>${esc(utc(l.sched_out).slice(0, 10))}</td>
        <td>${esc(l.flight_no)}${l.deadhead ? ' <span class="note">DH</span>' : ''}</td><td>${esc(l.dep)}→${esc(l.arr)}</td>
        <td>${esc(utc(l.sched_out).slice(11))}</td><td>${esc(utc(l.sched_in).slice(11))}</td>
        <td><input value="${esc(l.callsign)}" size="8" data-c="${i}"></td>`;
      tb.appendChild(tr);
    });
    $('#skipped').innerHTML = r.skipped.length ? `Couldn't read ${r.skipped.length} line(s):<br>` + r.skipped.map((s) => `${esc(s.reason)}: <code>${esc(s.line)}</code>`).join('<br>') : '';
    $('#preview').classList.remove('hidden');
    $('#saveMsg').textContent = r.legs.length ? `Found ${r.legs.length} flights.` : 'No flights found. Check that you copied the whole page.';
  }

  $('#signin').onclick = () => { pw = $('#pw').value; signIn(); };
  $('#pw').onkeydown = (e) => { if (e.key === 'Enter') $('#signin').click(); };
  $('#logout').onclick = () => { try { localStorage.removeItem('ft_admin'); } catch (_) {} location.reload(); };
  $('#copyLink').onclick = () => { navigator.clipboard?.writeText($('#familyLink').value); $('#copyLink').textContent = 'Copied'; };
  $('#parse').onclick = async () => {
    try { showPreview(await api('roster/parse', 'POST', { text: $('#roster').value, timeMode: $('#timeMode').value })); }
    catch (e) { $('#saveMsg').textContent = e.message; }
  };
  $('#save').onclick = async () => {
    const chosen = parsed.filter((_, i) => $(`[data-i="${i}"]`).checked)
      .map((l, _, __) => ({ ...l, callsign: $(`[data-c="${parsed.indexOf(l)}"]`).value.toUpperCase().trim() }));
    const r = await api('flights', 'POST', { flights: chosen });
    $('#saveMsg').textContent = `Saved. ${r.added} new, ${r.updated} updated.`;
    loadFlights();
  };
  $('#addOne').onclick = async () => {
    const t = (v) => v.replace(':', '');
    const line = `${$('#mDh').checked ? 'DH ' : ''}${$('#mNum').value.trim()} ${$('#mDep').value.trim().toUpperCase()}-${$('#mArr').value.trim().toUpperCase()} ${t($('#mOut').value)} ${t($('#mIn').value)}`;
    if (!$('#mDate').value) { $('#addMsg').textContent = 'Pick a date first.'; return; }
    const r = await api('roster/parse', 'POST', { text: `${$('#mDate').value}\n${line}` });
    if (!r.legs.length) { $('#addMsg').textContent = r.skipped[0]?.reason || 'Check the airport codes and times (like 1620).'; return; }
    await api('flights', 'POST', { flights: r.legs });
    $('#addMsg').textContent = `Added ${r.legs[0].flight_no} ${r.legs[0].dep}→${r.legs[0].arr}.`;
    loadFlights();
  };
  $('#pollNow').onclick = async () => {
    const r = await api('poll', 'POST');
    $('#pollMsg').textContent = r.tracked ? `Checked ${r.tracked} flight(s) that should be in the air.` : 'No flights in the air window right now.';
    loadFlights();
  };
  $('#reload').onclick = loadFlights;
  if (pw) signIn();
})();
