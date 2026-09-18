/* Lcode Api — dashboard.js
   Developer dashboard: overview, API keys, usage, requests.
   Semua angka dari backend asli (api_usage/audit_logs/api_keys) — nol data demo.
   API key raw cuma lewat modal sekali-lihat; tidak pernah disimpan di mana pun.
*/
(function () {
  'use strict';
  var L = window.Lcode;
  var esc = L.esc;

  function q(sel) { return document.querySelector(sel); }
  function fmtTime(s) {
    var d = new Date(s);
    return isNaN(d) ? '—' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function statusChip(code) {
    var cls = code < 300 ? 'chip--green' : code < 400 ? 'chip--gray' : 'chip--red';
    return '<span class="chip ' + cls + '">' + code + '</span>';
  }
  function empty(msg) { return '<p class="muted empty-state">' + esc(msg) + '</p>'; }

  // Pesan error ramah — tanpa detail backend mentah.
  function humanMsg(err) {
    var s = err && err.status;
    if (s === 401) return 'Sesi lu sudah berakhir — login ulang dulu.';
    if (s === 429) return 'Terlalu banyak permintaan — tunggu sebentar lalu coba lagi.';
    if (s >= 500) return 'Server sedang bermasalah — coba lagi beberapa saat.';
    return (err && err.message) || 'Terjadi kesalahan.';
  }


  // ------------------------------------------------------------------
  // tabs (?tab=overview|keys|usage|requests)
  // ------------------------------------------------------------------
  var currentTab = 'overview';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.dash-tab').forEach(function (s) {
      s.hidden = s.getAttribute('data-tab') !== name;
    });
    if (window.history.replaceState) {
      window.history.replaceState(null, '', '/dashboard?tab=' + name);
    }
    var loaders = { overview: loadOverview, keys: loadKeys, usage: loadUsage, requests: loadRequests, ops: loadOps };
    var fn = loaders[name] || loadOverview;
    fn();
  }

  // ------------------------------------------------------------------
  // Overview
  // ------------------------------------------------------------------
  function maybeRedirect(err) {
    if (err && err.status === 401) {
      L.setToken(''); L.setRefresh(''); L.setSessionId('');
      window.location.href = '/profile';
      return true;
    }
    return false;
  }

  function loadOverview() {
    L.api('GET', '/api/v1/dashboard/overview').then(function (o) {
      var t = o.totals || {};
      var map = { total: t.requests, today: t.requests_today, quota: t.daily_quota, keys: t.active_api_keys };
      document.querySelectorAll('#ovStats [data-v]').forEach(function (el) {
        var v = map[el.getAttribute('data-v')];
        el.textContent = v === undefined || v === null ? '0' : String(v);
      });
      var reqEl = q('#ovRequests');
      if (!o.recent_requests || !o.recent_requests.length) {
        reqEl.innerHTML = empty('Belum ada request. Kirim request pertama dari playground!');
      } else {
        reqEl.innerHTML = o.recent_requests.map(function (r) {
          return '<div class="mini-row"><span class="mono">' + esc(r.method) + ' ' + esc(r.route) + '</span>' +
            statusChip(r.status_code) + '<span class="muted">' + esc(fmtTime(r.created_at)) + '</span></div>';
        }).join('');
      }
      var actEl = q('#ovActivity');
      if (!o.recent_activity || !o.recent_activity.length) {
        actEl.innerHTML = empty('Belum ada aktivitas tercatat.');
      } else {
        actEl.innerHTML = o.recent_activity.map(function (a) {
          return '<div class="mini-row"><span>' + esc(a.action) + '</span><span class="muted">' + esc(fmtTime(a.created_at)) + '</span></div>';
        }).join('');
      }
    }).catch(function (err) { if (!maybeRedirect(err)) L.toast(humanMsg(err), 'error'); });
  }

  // ------------------------------------------------------------------
  function loadKeys() {
    L.api('GET', '/api/keys').then(function (keys) {
      var el = q('#keyList');
      if (!keys.length) { el.innerHTML = empty('Belum ada API key. Klik “+ New Key” untuk buat pertama.'); return; }
      el.innerHTML = keys.map(function (k) {
        var scopes = (k.scopes || []).map(function (s) { return '<span class="chip chip--blue mono">' + esc(s) + '</span>'; }).join(' ');
        var exp = k.expires_at ? '<span class="chip chip--gray">exp ' + esc(new Date(k.expires_at).toLocaleDateString('id-ID')) + '</span>' : '';
        return '<div class="card card--pad key-item">' +
          '<div class="key-item__head"><strong>' + esc(k.name) + '</strong>' +
            '<code class="mono muted">' + esc(k.prefix) + '…</code>' + exp + '</div>' +
          '<div class="key-item__scopes">' + scopes + '</div>' +
          '<div class="key-item__foot"><span class="muted">Dibuat ' + esc(fmtTime(k.created_at)) + '</span>' +
            '<div class="row-gap">' +
              '<button class="btn btn--ghost btn--sm" data-act="rotate" data-id="' + k.id + '">Rotate</button>' +
              '<button class="btn btn--danger btn--sm" data-act="revoke" data-id="' + k.id + '">Revoke</button>' +
            '</div></div></div>';
      }).join('');
    }).catch(function (err) { if (!maybeRedirect(err)) L.toast(humanMsg(err), 'error'); });
  }

  function openKeyModal(raw) {
    q('#kmKey').textContent = raw;
    q('#keyModal').hidden = false;
    q('#kmCopy').focus();
  }
  function closeKeyModal() {
    // Raw key hilang dari DOM — tidak bisa diminta ulang.
    q('#kmKey').textContent = '';
    q('#keyModal').hidden = true;
    loadKeys();
  }

  function createKey(ev) {
    ev.preventDefault();
    var scopes = Array.prototype.slice.call(document.querySelectorAll('input[name="scope"]:checked')).map(function (c) { return c.value; });
    if (!scopes.length) { L.toast('Pilih minimal satu scope', 'error'); return; }
    var daysRaw = q('#nkDays').value;
    var body = { name: q('#nkName').value.trim(), scopes: scopes };
    if (daysRaw) body.expiresInDays = parseInt(daysRaw, 10);
    L.api('POST', '/api/keys', body).then(function (k) {
      q('#newKeyModal').hidden = true;
      q('#nkForm').reset();
      openKeyModal(k.key);
    }).catch(function (err) { L.toast(humanMsg(err), 'error'); });
  }

  // ------------------------------------------------------------------
  // Usage
  // ------------------------------------------------------------------
  var usageRange = '24h';
  function loadUsage() {
    L.api('GET', '/api/v1/dashboard/usage?range=' + usageRange).then(function (u) {
      var s = q('#usStats');
      s.querySelector('[data-v="total"]').textContent = String(u.total || 0);
      s.querySelector('[data-v="fail"]').textContent = String(u.failures || 0);
      s.querySelector('[data-v="avg"]').textContent = (u.avg_duration_ms || 0) + ' ms';

      // bars harian — SVG/CSS murni, tanpa library
      var daily = u.daily || [];
      var max = Math.max.apply(null, daily.map(function (d) { return d.n; }).concat([1]));
      q('#usDaily').innerHTML = daily.length
        ? daily.map(function (d) {
            var h = Math.max(Math.round(d.n / max * 100), 4);
            return '<div class="bar" title="' + esc(d.day) + ': ' + d.n + ' requests">' +
              '<span class="bar__fill" style="height:' + h + '%"></span>' +
              '<span class="bar__label">' + esc(d.day.slice(5)) + '</span></div>';
          }).join('')
        : empty('Belum ada data pada rentang ini.');

      var sd = u.status_distribution || [];
      var tot = sd.reduce(function (a, b) { return a + b.n; }, 0) || 1;
      q('#usStatus').innerHTML = sd.length
        ? sd.map(function (r) {
            var pct = Math.round(r.n / tot * 100);
            return '<div class="mini-row"><span class="mono">' + r.status_code + '</span>' +
              '<span class="bar-inline"><span style="width:' + pct + '%"></span></span>' +
              '<span class="muted">' + r.n + ' (' + pct + '%)</span></div>';
          }).join('')
        : empty('Belum ada data.');

      var ep = u.top_endpoints || [];
      q('#usEndpoints').innerHTML = ep.length
        ? ep.map(function (r) {
            return '<div class="mini-row"><span class="mono">' + esc(r.route) + '</span>' +
              '<span class="muted">' + r.n + '× · ' + r.avg_ms + ' ms</span></div>';
          }).join('')
        : empty('Belum ada data.');
    }).catch(function (err) { if (!maybeRedirect(err)) L.toast(humanMsg(err), 'error'); });
  }

  // ------------------------------------------------------------------
  // Requests
  // ------------------------------------------------------------------
  var reqOffset = 0;
  function loadRequests() {
    var status = q('#rfStatus').value;
    var endpoint = q('#rfEndpoint').value.trim();
    var range = q('#rfRange').value;
    var qs = '?limit=25&offset=' + reqOffset + '&range=' + encodeURIComponent(range) +
      (status ? '&status=' + status : '') +
      (endpoint ? '&endpoint=' + encodeURIComponent(endpoint) : '');
    L.api('GET', '/api/v1/dashboard/requests' + qs).then(function (r) {
      var tb = q('#reqTable tbody');
      if (!r.requests.length) {
        tb.innerHTML = '<tr><td colspan="6">' + empty('Tidak ada request cocok dengan filter ini.') + '</td></tr>';
      } else {
        tb.innerHTML = r.requests.map(function (x) {
          return '<tr><td>' + esc(fmtTime(x.created_at)) + '</td><td class="mono">' + esc(x.method) + '</td>' +
            '<td class="mono">' + esc(x.route) + '</td><td>' + statusChip(x.status_code) + '</td>' +
            '<td>' + x.duration_ms + ' ms</td><td class="mono muted">' + esc(x.request_id || '—') + '</td></tr>';
        }).join('');
      }
      q('#reqTotal').textContent = 'Total ' + r.total + ' request';
      q('#reqPrev').disabled = reqOffset <= 0;
      q('#reqNext').disabled = reqOffset + r.limit >= r.total;
    }).catch(function (err) { L.toast(humanMsg(err), 'error'); });
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Ops (Phase 7)
  // ------------------------------------------------------------------
  var opsRange = '24h';
  function renderOps(m) {
    var b = q('#opsBody');
    var t = m.traffic || {};
    var w = m.webhooks || {};
    var prov = m.providers || {};
    var rt = m.realtime || {};
    function stat(label, val) {
      return '<div class="ov-stat"><span class="ov-stat__label">' + esc(label) + '</span>' +
             '<strong class="ov-stat__value">' + esc(String(val === undefined || val === null ? '-' : val)) + '</strong></div>';
    }
    var provRows = Object.keys(prov).length
      ? Object.keys(prov).map(function (n) {
          var p = prov[n];
          return '<tr><td>' + esc(n) + '</td><td>' + p.total + '</td><td>' + p.success + '</td><td>' + p.failures + '</td><td>' + (p.avg_ms === null ? '-' : p.avg_ms + ' ms') + '</td><td>' + esc(p.circuit) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="6" class="muted">Belum ada aktivitas provider di instance ini.</td></tr>';
    b.innerHTML =
      '<div class="stat-grid">' +
        stat('Requests', t.total) +
        stat('Success rate', t.success_rate === null || t.success_rate === undefined ? '-' : t.success_rate + '%') +
        stat('Avg latency', t.latency && t.latency.avg_ms ? t.latency.avg_ms + ' ms' : '-') +
        stat('p95 latency', t.latency && t.latency.p95_ms ? t.latency.p95_ms + ' ms' : '-') +
      '</div>' +
      '<div class="card"><h3>Status distribution</h3>' +
        (Object.keys(t.by_status || {}).length
          ? Object.keys(t.by_status).map(function (s) { return '<p><strong>' + esc(s) + '</strong> ' + t.by_status[s] + '</p>'; }).join('')
          : '<p class="muted empty-state">Belum ada request.</p>') + '</div>' +
      '<div class="card"><h3>Top endpoints</h3>' +
        ((t.top_endpoints || []).length
          ? '<table class="table"><thead><tr><th>Route</th><th>Requests</th><th>Avg</th></tr></thead><tbody>' +
            t.top_endpoints.map(function (r) { return '<tr><td>' + esc(r.route) + '</td><td>' + r.n + '</td><td>' + (r.avg_ms === null ? '-' : r.avg_ms + ' ms') + '</td></tr>'; }).join('') + '</tbody></table>'
          : '<p class="muted empty-state">Belum ada data.</p>') + '</div>' +
      '<div class="card"><h3>Providers (instance-local)</h3>' +
        '<table class="table"><thead><tr><th>Provider</th><th>Total</th><th>Success</th><th>Fail</th><th>Avg</th><th>Circuit</th></tr></thead><tbody>' + provRows + '</tbody></table>' +
        '<p class="muted">State provider bersifat per-instance serverless — bukan monitoring global.</p></div>' +
      '<div class="card"><h3>Webhooks</h3>' +
        '<div class="stat-grid">' +
          stat('Total deliveries', w.total) +
          stat('Success', w.success) +
          stat('Failed', w.failed) +
          stat('Avg', w.avg_ms ? w.avg_ms + ' ms' : '-') +
        '</div></div>';
  }
  function loadOps() {
    L.api('GET', '/api/v1/ops/summary?range=' + opsRange).then(function (m) {
      renderOps(m);
    }).catch(function (err) { if (!maybeRedirect(err)) q('#opsBody').innerHTML = empty(humanMsg(err)); });
  }
  q('#opsBody') && document.querySelectorAll('#opsRange [data-opsrange]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#opsRange [data-opsrange]').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      opsRange = btn.getAttribute('data-opsrange');
      loadOps();
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    var logged = !!L.parseJwt(L.getToken());
    if (!logged) {
      q('#dashAuth').hidden = false;
      q('#subnav').hidden = true;
      return;
    }
    q('#subnav').hidden = false;
    q('#dashContent').hidden = false;
    q('#dashAuth').hidden = true;

    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab') || 'overview';
    if (['overview', 'keys', 'usage', 'requests', 'ops'].indexOf(tab) < 0) tab = 'overview';
    showTab(tab);

    // header subnav tambah tab Dashboard (injeksi ringan tanpa ubah shell.js)
    var subnavTabs = document.querySelector('#subnav .subnav__tabs');
    if (subnavTabs && !subnavTabs.querySelector('[data-nav="dashboard"]')) {
      var a = document.createElement('a');
      a.className = 'subnav__tab' + (currentTab ? ' is-active' : '');
      a.href = '/dashboard'; a.setAttribute('data-nav', 'dashboard');
      a.innerHTML = L.icon('layout', 'w-3.5 h-3.5') + '<span>Dashboard</span>';
      subnavTabs.insertBefore(a, subnavTabs.firstChild);
      var opsLink = document.createElement('a');
      opsLink.className = 'subnav__tab';
      opsLink.href = '/dashboard?tab=ops'; opsLink.setAttribute('data-nav', 'dashboard-ops');
      opsLink.innerHTML = L.icon('activity', 'w-3.5 h-3.5') + '<span>Ops</span>';
      subnavTabs.insertBefore(opsLink, subnavTabs.firstChild.nextSibling);
    }

    // keys events
    q('#btnNewKey').addEventListener('click', function () { q('#newKeyModal').hidden = false; q('#nkName').focus(); });
    q('#nkForm').addEventListener('submit', createKey);
    q('#nkCancel').addEventListener('click', function () { q('#newKeyModal').hidden = true; });
    q('#kmClose').addEventListener('click', closeKeyModal);
    q('#kmCopy').addEventListener('click', function () {
      var txt = q('#kmKey').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { L.toast('Key dicopy', 'ok'); });
    });
    q('#keyList').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'revoke') {
        if (!confirm('Revoke API key ini? Request pakai key ini akan langsung ditolak.')) return;
        L.api('DELETE', '/api/keys/' + id).then(function () {
          L.toast('Key revoked', 'ok'); loadKeys();
        }).catch(function (err) { L.toast(err.message, 'error'); });
      } else {
        L.api('POST', '/api/keys/' + id + '/rotate').then(function (k) {
          openKeyModal(k.key); L.toast('Key lama revoked, key baru dibuat', 'ok');
        }).catch(function (err) { L.toast(err.message, 'error'); });
      }
    });

    // usage events
    document.querySelectorAll('.seg__btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg__btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        usageRange = b.getAttribute('data-range');
        loadUsage();
      });
    });

    // requests events (debounce untuk search)
    var deb = null;
    q('#reqFilters').addEventListener('submit', function (ev) { ev.preventDefault(); reqOffset = 0; loadRequests(); });
    q('#rfEndpoint').addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { reqOffset = 0; loadRequests(); }, 400);
    });
    q('#reqPrev').addEventListener('click', function () { reqOffset = Math.max(reqOffset - 25, 0); loadRequests(); });
    q('#reqNext').addEventListener('click', function () { reqOffset += 25; loadRequests(); });
  });
})();

