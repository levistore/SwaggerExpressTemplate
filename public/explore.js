/* Lcode Api — explore.js
   Request builder. Tiap "Kirim" itu fetch sungguhan ke API yang sama dari
   origin yang sama — nggak ada mock, nggak ada contoh palsu. */
(function () {
  'use strict';
  var L = window.Lcode;

  /* ------------------------------------------------------------------ *
   * Sumber kebenaran endpoint. Deskripsi di bawah ini dicocokkan dengan
   * perilaku handler yang sebenarnya, termasuk yang bikin kaget:
   * PUT butuh name DAN email sekaligus (bukan update sebagian).
   * ------------------------------------------------------------------ */
  var ENDPOINTS = [
    {
      method: 'POST', path: '/api/auth/register', access: 'publik',
      desc: 'Daftar akun baru. Balikannya langsung token yang bisa dipakai.',
      body: { name: 'Levi', email: '', password: '' },
      hint: 'name wajib, password minimal 8 karakter'
    },
    {
      method: 'POST', path: '/api/auth/login', access: 'publik',
      desc: 'Tukar email dan password jadi token.',
      body: { email: '', password: '' }
    },
    {
      method: 'GET', path: '/api/auth/me', access: 'bearer',
      desc: 'Profil milik token yang dikirim.', auth: true
    },
    {
      method: 'GET', path: '/api/users', access: 'publik',
      desc: 'Daftar semua user. Tanpa token.'
    },
    {
      method: 'GET', path: '/api/users/:id', access: 'publik',
      desc: 'Satu user berdasarkan id. Tanpa token.',
      fill: '1'
    },
    {
      method: 'POST', path: '/api/users', access: 'bearer',
      desc: 'Bikin user langsung. password opsional — kalau diisi minimal 8 karakter.',
      auth: true, writes: true,
      body: { name: '', email: '', password: '' }
    },
    {
      method: 'PUT', path: '/api/users/:id', access: 'bearer',
      desc: 'Ganti nama dan email user. name dan email dua-duanya wajib dikirim.',
      auth: true, writes: true, fill: '1',
      body: { name: '', email: '' }
    },
    {
      method: 'DELETE', path: '/api/users/:id', access: 'bearer',
      desc: 'Hapus user secara permanen. Nggak ada undo.',
      auth: true, writes: true, fill: '1'
    }
  ];

  var METHOD_CLASS = {
    GET: 'method--get', POST: 'method--post',
    PUT: 'method--put', DELETE: 'method--del'
  };

  function methodChip(m) {
    var s = document.createElement('span');
    s.className = 'method ' + (METHOD_CLASS[m] || 'method--get');
    s.textContent = m;
    return s;
  }

  var current = null;

  function init() {
    var list = L.$('playList');
    if (!list) return;

    ENDPOINTS.forEach(function (ep, i) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'play__item';
      item.setAttribute('role', 'listitem');
      item.appendChild(methodChip(ep.method));
      var sp = document.createElement('span');
      sp.textContent = ep.path;
      item.appendChild(sp);
      item.addEventListener('click', function () { select(i); });
      list.appendChild(item);
    });

    // pulihkan token dari halaman lain (profile / sesi sebelumnya)
    var saved = L.getToken();
    if (saved) L.$('playToken').value = saved;

    L.$('playToken').addEventListener('input', function () {
      L.setToken(this.value.trim(), false);
    });

    L.$('playSend').addEventListener('click', send);
    L.$('playBody').addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });

    select(3); // GET /api/users
  }

  function select(idx) {
    current = ENDPOINTS[idx];

    var items = document.querySelectorAll('.play__item');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('is-active', i === idx);

    var m = L.$('playMethod');
    m.className = 'method ' + (METHOD_CLASS[current.method] || '');
    m.textContent = current.method;
    L.$('playPath').value = current.path;
    L.$('playDesc').textContent = current.desc;

    L.$('playTokenWrap').hidden = !current.auth;
    L.$('playWarn').hidden = !current.writes;

    var hasBody = !!current.body;
    L.$('playBodyWrap').hidden = !hasBody;
    if (hasBody) {
      var tpl = JSON.parse(JSON.stringify(current.body));
      if (tpl.email === '') tpl.email = 'levi+' + Date.now() + '@contoh.com';
      if (tpl.password === '') tpl.password = 'rahasia12345';
      if (tpl.name === '') tpl.name = 'Levi';
      L.$('playBody').value = JSON.stringify(tpl, null, 2);
    }

    var hint = L.$('playHint');
    if (hint) {
      hint.hidden = !current.hint;
      hint.textContent = current.hint || '';
    }

    resetStatus();
    L.$('playOut').firstElementChild.textContent = 'Belum ada request. Tekan "Kirim".';
  }

  function resetStatus() {
    var status = L.$('playStatus');
    status.className = 'chip chip--muted';
    status.textContent = '—';
    L.$('playTime').textContent = '—';
  }

  function send() {
    if (!current) return;

    var path = L.$('playPath').value.trim();
    if (!path) { resetStatus(); L.toast('Path masih kosong'); return; }
    if (path.charAt(0) !== '/') path = '/' + path;

    var opts = { method: current.method };

    if (current.auth) {
      var tok = L.$('playToken').value.trim();
      if (!tok) {
        resetStatus();
        L.toast('Endpoint ini butuh bearer token');
        L.$('playToken').focus();
        return;
      }
      opts.token = tok;
    }

    if (current.body && !L.$('playBodyWrap').hidden) {
      var raw = L.$('playBody').value.trim();
      if (raw) {
        try { JSON.parse(raw); }
        catch (e) { resetStatus(); L.toast('JSON body nggak valid'); return; }
        opts.body = raw;
      }
    }

    var btn = L.$('playSend');
    var status = L.$('playStatus'), time = L.$('playTime'), out = L.$('playOut');
    btn.disabled = true;
    status.className = 'chip chip--muted';
    status.textContent = '…';
    time.textContent = '—';

    L.api(path, opts)
      .then(function (r) {
        time.textContent = r.ms + ' ms';
        status.className = 'chip ' + (r.ok ? 'chip--ok' : 'chip--err');
        status.textContent = r.status + (r.statusText ? ' ' + r.statusText : '');

        var pretty = r.raw;
        if (r.isJson) pretty = JSON.stringify(r.data, null, 2);
        out.firstElementChild.textContent = pretty || '(body kosong)';

        // register/login sukses -> token-nya langsung dipakai
        if (r.ok && current.path.indexOf('/api/auth/') === 0 && r.data && r.data.token) {
          L.$('playToken').value = r.data.token;
          L.setToken(r.data.token, false);
          L.toast('Token tersimpan — siap dipakai endpoint bearer');
        }
      })
      .catch(function (err) {
        time.textContent = '—';
        status.className = 'chip chip--err';
        status.textContent = 'gagal';
        out.firstElementChild.textContent = 'Request nggak sampai: ' + err.message;
      })
      .then(function () { btn.disabled = false; });
  }

  init();
})();
