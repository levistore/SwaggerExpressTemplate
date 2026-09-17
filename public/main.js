/* ==========================================================================
   Lcode Api — main.js
   Tanpa dependency. Semua angka yang tampil diambil dari API yang sama.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ *
   * Sumber kebenaran endpoint — dipakai tabel referensi + playground
   * ------------------------------------------------------------------ */
  var ENDPOINTS = [
    {
      method: 'POST', path: '/api/auth/register', access: 'publik',
      desc: 'Daftar akun baru, langsung balikin token.',
      body: { name: 'Levi', email: '', password: '' },
      bodyHint: 'email + password min 8 karakter'
    },
    {
      method: 'POST', path: '/api/auth/login', access: 'publik',
      desc: 'Tukar email dan password jadi token.',
      body: { email: '', password: '' },
      bodyHint: 'email + password'
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
      desc: 'Bikin user. Password opsional, tapi kalau diisi minimal 8 karakter.',
      auth: true, writes: true,
      body: { name: '', email: '', password: '' }
    },
    {
      method: 'PUT', path: '/api/users/:id', access: 'bearer',
      desc: 'Update user. Field yang nggak dikirim dibiarkan apa adanya.',
      auth: true, writes: true, fill: '1',
      body: { name: '', email: '' }
    },
    {
      method: 'DELETE', path: '/api/users/:id', access: 'bearer',
      desc: 'Hapus user secara permanen.',
      auth: true, writes: true, fill: '1'
    }
  ];

  var METHOD_CLASS = {
    GET: 'method--get', POST: 'method--post',
    PUT: 'method--put', DELETE: 'method--del'
  };

  /* ------------------------------------------------------------------ *
   * Util
   * ------------------------------------------------------------------ */
  function methodChip(m) {
    var s = document.createElement('span');
    s.className = 'method ' + (METHOD_CLASS[m] || 'method--get');
    s.textContent = m;
    return s;
  }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove('is-on');
      setTimeout(function () { t.hidden = true; }, 260);
    }, 2200);
  }

  function copyText(text, label) {
    var done = function () { toast(label || 'Tersalin'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('Gagal menyalin'); }
      document.body.removeChild(ta);
    }
  }

  /* ------------------------------------------------------------------ *
   * Reveal saat masuk viewport — stagger dari data-delay
   * ------------------------------------------------------------------ */
  function initReveal() {
    var nodes = document.querySelectorAll('[data-reveal]');
    if (reduced || !('IntersectionObserver' in window)) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('is-in');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var d = parseInt(en.target.getAttribute('data-delay') || '0', 10);
        en.target.style.transitionDelay = (d * 70) + 'ms';
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (var j = 0; j < nodes.length; j++) io.observe(nodes[j]);
  }

  /* ------------------------------------------------------------------ *
   * Navigasi mobile
   * ------------------------------------------------------------------ */
  function initNav() {
    var btn = $('navToggle'), panel = $('navMobile');
    if (!btn || !panel) return;

    function close(returnFocus) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-open');
      if (returnFocus) btn.focus();
    }

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      if (open) { close(false); return; }
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-open');
    });

    panel.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') close(false);
    });

    // Escape menutup drawer + kembalikan fokus ke tombol
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close(true);
    });

    // klik di luar drawer menutup (toggle dikecualikan, biar nggak dobel)
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      close(false);
    });

    // kembali ke desktop: drawer yang masih terbuka jangan sampai nempel
    var wide = window.matchMedia('(min-width: 821px)');
    var onChange = function (m) { if (m.matches) close(false); };
    if (wide.addEventListener) wide.addEventListener('change', onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }

  /* ------------------------------------------------------------------ *
   * Header menyusut saat discroll
   * ------------------------------------------------------------------ */
  function initScrollState() {
    var nav = $('nav');
    if (!nav) return;
    var last = 0;
    var onScroll = function () {
      var y = window.scrollY || window.pageYOffset;
      if ((y > 12) !== (last > 12)) nav.classList.toggle('is-stuck', y > 12);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------ *
   * Live: jumlah user + latensi GET /api/users
   * ------------------------------------------------------------------ */
  function setLive(state, text) {
    var wrap = $('liveStatus');
    if (wrap) {
      // Pakai classList, JANGAN timpa className — menimpa akan menghapus
      // kelas 'is-in' yang dipasang observer reveal, dan elemen ini
      // selamanya tetap opacity:0 (nggak pernah kelihatan).
      wrap.classList.add('live');
      wrap.classList.remove('is-ok', 'is-err');
      if (state) wrap.classList.add('is-' + state);
    }
    var t = $('liveText');
    if (t) t.textContent = text;
  }

  function initLive() {
    var started = performance.now();
    fetch('/api/users', { headers: { accept: 'application/json' } })
      .then(function (res) {
        var ms = Math.round(performance.now() - started);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().then(function (data) {
          var list = Array.isArray(data) ? data
            : (data && Array.isArray(data.data)) ? data.data
            : (data && Array.isArray(data.users)) ? data.users : [];
          var n = list.length;

          var su = $('statUsers'), sb = $('statBigUsers');
          if (su) su.textContent = n;
          if (sb) sb.textContent = n;
          var sl = $('statLatency');
          if (sl) sl.textContent = ms + ' ms';

          setLive('ok', 'API online — ' + n + ' user terbaca dalam ' + ms + ' ms');
        });
      })
      .catch(function () {
        var su = $('statUsers'), sb = $('statBigUsers'), sl = $('statLatency');
        if (su) su.textContent = '—';
        if (sb) sb.textContent = '—';
        if (sl) sl.textContent = '—';
        setLive('err', 'Nggak bisa menghubungi API dari browser ini');
      });
  }

  /* ------------------------------------------------------------------ *
   * Tabel referensi endpoint
   * ------------------------------------------------------------------ */
  function initTable() {
    var body = $('tableBody');
    if (!body) return;
    var base = $('baseUrl');
    if (base) base.textContent = location.origin;

    ENDPOINTS.forEach(function (ep) {
      var row = document.createElement('div');
      row.className = 'table__row';

      var m = document.createElement('span');
      m.appendChild(methodChip(ep.method));

      var p = document.createElement('span');
      var c = document.createElement('code');
      c.textContent = ep.path;
      p.appendChild(c);

      var a = document.createElement('span');
      a.className = 'access';
      a.textContent = ep.access;

      var d = document.createElement('span');
      d.className = 'desc';
      d.textContent = ep.desc;

      row.appendChild(m); row.appendChild(p); row.appendChild(a); row.appendChild(d);
      body.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ *
   * Playground — fetch sungguhan ke API yang sama
   * ------------------------------------------------------------------ */
  var current = null;
  var TOKEN_KEY = 'lcode.token';

  function initPlayground() {
    var list = $('playList');
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

    // pulihkan token dari sesi sebelumnya
    try {
      var saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved) $('playToken').value = saved;
    } catch (e) { /* mode privat — abaikan */ }

    $('playToken').addEventListener('input', function () {
      try { sessionStorage.setItem(TOKEN_KEY, this.value); } catch (e) {}
    });

    $('playSend').addEventListener('click', send);
    $('playBody').addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });

    select(3); // GET /api/users
  }

  function select(idx) {
    current = ENDPOINTS[idx];
    var items = document.querySelectorAll('.play__item');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('is-active', i === idx);

    $('playMethod').className = 'method ' + (METHOD_CLASS[current.method] || '');
    $('playMethod').textContent = current.method;
    $('playPath').value = current.path;
    $('playDesc').textContent = current.desc;

    $('playTokenWrap').hidden = !current.auth;
    $('playWarn').hidden = !current.writes;

    var hasBody = !!current.body;
    $('playBodyWrap').hidden = !hasBody;
    if (hasBody) {
      var tpl = JSON.parse(JSON.stringify(current.body));
      if (tpl.email === '') tpl.email = 'levi+' + Date.now() + '@contoh.com';
      if (tpl.password === '') tpl.password = 'rahasia12345';
      if (tpl.name === '') tpl.name = 'Levi';
      $('playBody').value = JSON.stringify(tpl, null, 2);
    }
  }

  function resetStatus() {
    var status = $('playStatus');
    status.className = 'chip chip--muted';
    status.textContent = '—';
    $('playTime').textContent = '—';
  }

  function send() {
    if (!current) return;

    var path = $('playPath').value.trim();
    if (!path) { resetStatus(); toast('Path masih kosong'); return; }
    if (path.charAt(0) !== '/') path = '/' + path;

    var opts = { method: current.method, headers: { accept: 'application/json' } };

    if (current.auth) {
      var tok = $('playToken').value.trim();
      if (!tok) {
        resetStatus();
        toast('Endpoint ini butuh bearer token');
        $('playToken').focus();
        return;
      }
      opts.headers.Authorization = /^Bearer\s/i.test(tok) ? tok : 'Bearer ' + tok;
    }

    if (current.body && !$('playBodyWrap').hidden) {
      var raw = $('playBody').value.trim();
      if (raw) {
        try { JSON.parse(raw); }
        catch (e) { resetStatus(); toast('JSON body nggak valid'); return; }
        opts.headers['Content-Type'] = 'application/json';
        opts.body = raw;
      }
    }

    var btn = $('playSend');
    btn.disabled = true;
    var status = $('playStatus'), time = $('playTime'), out = $('playOut');
    status.className = 'chip chip--muted';
    status.textContent = '…';
    time.textContent = '—';

    var t0 = performance.now();
    fetch(path, opts)
      .then(function (res) {
        var ms = Math.round(performance.now() - t0);
        time.textContent = ms + ' ms';
        status.className = 'chip ' + (res.ok ? 'chip--ok' : 'chip--err');
        status.textContent = res.status + ' ' + (res.statusText || '');
        return res.text().then(function (txt) {
          var pretty = txt;
          try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch (e) {}
          out.firstElementChild.textContent = pretty || '(body kosong)';

          // auto-isi token kalau register/login berhasil
          if (res.ok && current.path.indexOf('/api/auth/') === 0) {
            try {
              var obj = JSON.parse(txt);
              if (obj && obj.token) {
                $('playToken').value = obj.token;
                try { sessionStorage.setItem(TOKEN_KEY, obj.token); } catch (e) {}
                toast('Token tersimpan — siap dipakai endpoint bearer');
              }
            } catch (e) {}
          }
        });
      })
      .catch(function (err) {
        var ms = Math.round(performance.now() - t0);
        time.textContent = ms + ' ms';
        status.className = 'chip chip--err';
        status.textContent = 'gagal';
        out.firstElementChild.textContent = 'Request nggak sampai: ' + err.message;
      })
      .then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------------ *
   * Quickstart — kode dibangun dari origin sebenarnya
   * ------------------------------------------------------------------ */
  function initQuickstart() {
    var pre = $('quickCode');
    if (!pre) return;
    var code = pre.firstElementChild;
    var origin = location.origin;

    var SNIPPETS = {
      curl: [
        '# 1. daftar akun -> langsung dapat token',
        'curl -s -X POST ' + origin + '/api/auth/register \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"name":"Levi","email":"levi@contoh.com","password":"rahasia12345"}\'',
        '',
        '# 2. pakai token-nya untuk request yang butuh auth',
        'curl -s ' + origin + '/api/auth/me \\',
        '  -H "Authorization: Bearer $TOKEN"'
      ].join('\n'),
      js: [
        'const base = "' + origin + '";',
        '',
        'const res = await fetch(`${base}/api/auth/register`, {',
        '  method: "POST",',
        '  headers: { "Content-Type": "application/json" },',
        '  body: JSON.stringify({',
        '    name: "Levi",',
        '    email: "levi@contoh.com",',
        '    password: "rahasia12345"',
        '  })',
        '});',
        '',
        'const { token } = await res.json();',
        '',
        '// request yang butuh autentikasi',
        'const me = await fetch(`${base}/api/auth/me`, {',
        '  headers: { Authorization: `Bearer ${token}` }',
        '}).then(r => r.json());',
        '',
        'console.log(me);'
      ].join('\n'),
      node: [
        'const BASE = "' + origin + '";',
        '',
        'const res = await fetch(`${BASE}/api/auth/register`, {',
        '  method: "POST",',
        '  headers: { "Content-Type": "application/json" },',
        '  body: JSON.stringify({',
        '    name: "Levi",',
        '    email: "levi@contoh.com",',
        '    password: "rahasia12345"',
        '  })',
        '});',
        '',
        'if (!res.ok) throw new Error(`HTTP ${res.status}`);',
        'const { token } = await res.json();',
        '',
        '// daftar user (publik, tanpa token)',
        'const users = await fetch(`${BASE}/api/users`).then(r => r.json());',
        'console.log(users.length, "user");',
        '',
        '// hapus user yang baru dibuat',
        'await fetch(`${BASE}/api/users/${me.user.id}`, {',
        '  method: "DELETE",',
        '  headers: { Authorization: `Bearer ${token}` }',
        '});'
      ].join('\n')
    };

    var render = function (key) {
      code.textContent = SNIPPETS[key] || '';
    };

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        for (var j = 0; j < tabs.length; j++) {
          var on = tabs[j] === this;
          tabs[j].classList.toggle('is-active', on);
          tabs[j].setAttribute('aria-selected', String(on));
        }
        render(this.getAttribute('data-tab'));
      });
    }
    render('curl');
  }

  /* ------------------------------------------------------------------ *
   * Tombol salin
   * ------------------------------------------------------------------ */
  function initCopy() {
    var btns = document.querySelectorAll('[data-copy-target]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var el = $(this.getAttribute('data-copy-target'));
        if (el) copyText(el.textContent.trim(), 'Kode tersalin');
      });
    }
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    initReveal();
    initNav();
    initScrollState();
    initTable();
    initPlayground();
    initQuickstart();
    initCopy();
    initLive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
