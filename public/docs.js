/* Lcode Api — docs.js
   Halaman referensi. Isi endpoint-nya HTML statis (biar kebaca juga tanpa JS);
   skrip ini cuma nambahin: base URL asli, snippet quickstart per bahasa,
   dan tab-nya. */
(function () {
  'use strict';
  var L = window.Lcode;

  var base = L.$('baseUrl');
  if (base) base.textContent = location.origin;

  /* ------------------------------------------------------------------ *
   * Quickstart — dibangun dari origin sebenarnya, bukan hardcode
   * ------------------------------------------------------------------ */
  var SNIPPETS = null;

  function snippets() {
    if (SNIPPETS) return SNIPPETS;
    var o = location.origin;

    SNIPPETS = {
      curl: [
        '# 1. daftar akun -> langsung dapat token',
        'curl -s -X POST ' + o + '/api/auth/register \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"name":"Levi","email":"levi@contoh.com","password":"rahasia12345"}\'',
        '',
        '# 2. pakai token-nya untuk request yang butuh auth',
        'curl -s ' + o + '/api/auth/me \\',
        '  -H "Authorization: Bearer $TOKEN"'
      ].join('\n'),

      js: [
        'const base = "' + o + '";',
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
        'if (!res.ok) throw new Error(`HTTP ${res.status}`);',
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
        'const BASE = "' + o + '";',
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
        'const { token, user } = await res.json();',
        '',
        '// daftar user (publik, tanpa token)',
        'const users = await fetch(`${BASE}/api/users`).then(r => r.json());',
        'console.log(users.length, "user");',
        '',
        '// hapus user yang baru dibuat',
        'await fetch(`${BASE}/api/users/${user.id}`, {',
        '  method: "DELETE",',
        '  headers: { Authorization: `Bearer ${token}` }',
        '});'
      ].join('\n')
    };
    return SNIPPETS;
  }

  function initQuickstart() {
    var pre = L.$('quickCode');
    if (!pre) return;
    var code = pre.firstElementChild;

    function render(key) {
      code.textContent = snippets()[key] || '';
    }

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

  initQuickstart();
})();
