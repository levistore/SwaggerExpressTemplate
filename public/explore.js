/* Lcode Api — explore.js
   Playground berkategori. Tiap endpoint punya kartunya sendiri: field,
   tombol Kirim, respons asli, cURL yang dibangun dari nilai yang lu isi,
   dan daftar status yang benar-benar dikembalikan handler-nya.

   Nggak ada mock dan nggak ada respons contoh: kotak respons mulai dari
   kosong dan cuma terisi setelah request sungguhan selesai. */
(function () {
  'use strict';

  var L = window.Lcode;
  var BASE = location.origin;

  /* ------------------------------------------------------------------ *
   * Ikon (SVG, bukan emoji)
   * ------------------------------------------------------------------ */
  var ICO = {
    search: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="m10.6 10.6 3 3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    chev: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    key: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.6" cy="10.4" r="3.1" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="m7.9 8.1 5.5-5.5M11.6 4.4l1.5 1.5M13.4 2.6l1.4 1.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    eye: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.4 8S3.9 3.9 8 3.9 14.6 8 14.6 8 12.1 12.1 8 12.1 1.4 8 1.4 8Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    pen: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.6 13.4 5.4 5.9 12.9 2.6 13.4 3.1 10.1Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="m9.4 3.8 2.8 2.8" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1L8 1.8Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M8 6v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".85" fill="currentColor"/></svg>',
    send: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m9 4.5 3.5 3.5L9 11.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>',
    copy: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    dl: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.2m0 0 3-3m-3 3-3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 12.8h10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
  };

  /* ------------------------------------------------------------------ *
   * Katalog endpoint — satu-satunya sumber kebenaran halaman ini.
   *
   * Kategori dipakai untuk mengelompokkan, bukan hiasan: isinya memang
   * beda akses dan beda akibat. Semua status di bawah ini diambil dari
   * handler aslinya (routes/auth.js, routes/users.js, middleware/auth.js),
   * bukan tebakan.
   * ------------------------------------------------------------------ */
  var TOKEN_MSG = 'Missing bearer token. Kirim header: Authorization: Bearer <token>';

  var CATALOG = [
    {
      id: 'auth',
      name: 'Autentikasi',
      icon: 'key',
      desc: 'Daftar, masuk, dan cek identitas token.',
      endpoints: [
        {
          method: 'POST', path: '/api/auth/register', name: 'Daftar akun',
          desc: 'Bikin akun baru. Responsnya <b>langsung berisi token</b>, jadi nggak perlu login terpisah sesudahnya. Password di-hash scrypt sebelum masuk database.',
          writes: true,
          fields: [
            { name: 'name', in: 'body', label: 'name', value: 'Levi', hint: 'Nama tampilan. Wajib diisi.' },
            { name: 'email', in: 'body', label: 'email', value: '@auto', hint: 'Harus format email yang valid. Tiap kali dipilih, alamatnya diacak supaya nggak bentrok.' },
            { name: 'password', in: 'body', label: 'password', value: 'rahasia12345', type: 'password', hint: 'Minimal <code>8</code> karakter.' }
          ],
          codes: [
            ['201', 'token + data user'],
            ['400', 'Name is required'],
            ['400', 'Valid email is required'],
            ['400', 'Password must be at least 8 characters'],
            ['409', 'Email is already registered']
          ]
        },
        {
          method: 'POST', path: '/api/auth/login', name: 'Masuk',
          desc: 'Tukar email dan password jadi token baru. Bentuk responsnya sama persis dengan register.',
          fields: [
            { name: 'email', in: 'body', label: 'email', value: '', hint: 'Email yang sudah terdaftar.' },
            { name: 'password', in: 'body', label: 'password', value: '', type: 'password', hint: 'Password akun itu.' }
          ],
          codes: [
            ['200', 'token + data user'],
            ['400', 'Email and password are required'],
            ['401', 'Invalid email or password']
          ]
        },
        {
          method: 'GET', path: '/api/auth/me', name: 'Profil dari token',
          desc: 'Profil milik token yang dikirim. Endpoint paling cepat buat ngecek token lu masih hidup atau nggak.',
          auth: true,
          codes: [
            ['200', 'data user'],
            ['401', TOKEN_MSG],
            ['401', 'Invalid or expired token'],
            ['404', 'User not found — akun di token sudah dihapus']
          ]
        }
      ]
    },
    {
      id: 'read',
      name: 'User — Baca',
      icon: 'eye',
      desc: 'Terbuka tanpa token. Perhatikan: email tiap user ikut terkirim.',
      endpoints: [
        {
          method: 'GET', path: '/api/users', name: 'Daftar semua user',
          desc: 'Semua user dalam satu array. <b>Tanpa token</b> — dan <code>email</code> ikut terkirim, bukan cuma nama.',
          codes: [['200', 'array of user']]
        },
        {
          method: 'GET', path: '/api/users/:id', name: 'Satu user',
          desc: 'Satu user berdasarkan id. Id yang bukan angka dibalas sama seperti id yang nggak ada — <code>404</code>, bukan <code>400</code>.',
          fields: [
            { name: 'id', in: 'path', label: 'id (di path)', value: '1', hint: 'Id user. Coba <code>1</code>, atau id punya lu sendiri.' }
          ],
          codes: [
            ['200', 'data user'],
            ['404', 'User not found']
          ]
        }
      ]
    },
    {
      id: 'write',
      name: 'User — Tulis',
      icon: 'pen',
      desc: 'Butuh bearer token. Perubahannya nyata di database production.',
      endpoints: [
        {
          method: 'POST', path: '/api/users', name: 'Bikin user langsung',
          desc: 'Bikin user tanpa lewat alur register. <code>password</code> <b>opsional</b>: boleh nggak dikirim sama sekali, tapi kalau dikirim wajib minimal <code>8</code> karakter. Responsnya nambahin <code>hasPassword</code>.',
          auth: true, writes: true,
          fields: [
            { name: 'name', in: 'body', label: 'name', value: 'Levi', hint: 'Wajib diisi.' },
            { name: 'email', in: 'body', label: 'email', value: '@auto', hint: 'Wajib, harus format email valid.' },
            { name: 'password', in: 'body', label: 'password', value: '', type: 'password', optional: true, hint: 'Kosongkan kalau nggak mau akun ini bisa login. Minimal <code>8</code> karakter kalau diisi.' }
          ],
          codes: [
            ['201', 'user + hasPassword'],
            ['400', 'Name and email are required'],
            ['400', 'Password must be at least 8 characters'],
            ['401', TOKEN_MSG],
            ['409', 'Email is already registered']
          ]
        },
        {
          method: 'PUT', path: '/api/users/:id', name: 'Ganti nama dan email',
          desc: 'Ganti nama dan email. <b>Bukan update sebagian</b> — <code>name</code> dan <code>email</code> dua-duanya wajib dikirim; kalau salah satu hilang dibalas <code>400</code>.',
          auth: true, writes: true,
          fields: [
            { name: 'id', in: 'path', label: 'id (di path)', value: '1', hint: 'Id user yang mau diubah.' },
            { name: 'name', in: 'body', label: 'name', value: 'Levi Diperbarui', hint: 'Wajib.' },
            { name: 'email', in: 'body', label: 'email', value: '@auto', hint: 'Wajib, dan harus unik.' }
          ],
          codes: [
            ['200', 'user yang sudah diperbarui'],
            ['400', 'Name and email are required'],
            ['401', TOKEN_MSG],
            ['401', 'Invalid or expired token'],
            ['404', 'User not found'],
            ['409', 'Email is already registered']
          ]
        },
        {
          method: 'DELETE', path: '/api/users/:id', name: 'Hapus user',
          desc: 'Hapus user secara permanen. Nggak ada soft delete, nggak ada undo.',
          auth: true, writes: true,
          fields: [
            { name: 'id', in: 'path', label: 'id (di path)', value: '1', hint: 'Id user yang mau dihapus.' }
          ],
          codes: [
            ['200', 'User deleted successfully'],
            ['401', TOKEN_MSG],
            ['401', 'Invalid or expired token'],
            ['404', 'User not found']
          ]
        }
      ]
    },
    {
      id: 'download',
      name: 'Downloader',
      icon: 'dl',
      desc: 'Tautan unduhan media dari konten publik. Butuh token.',
      endpoints: [
        {
          method: 'GET', path: '/api/download/tiktok', name: 'TikTok',
          desc: 'Tautan unduhan video TikTok publik: tanpa watermark + MP3. Video privat, foto-only, atau yang dihapus nggak bisa.',
          auth: true,
          fields: [
            { name: 'url', in: 'query', label: 'url', value: 'https://www.tiktok.com/@tiktok/video/7106594312292453675', hint: 'URL video TikTok publik (tiktok.com/@user/video/... atau vt.tiktok.com/...).' }
          ],
          codes: [
            ['200', 'array of media (video, audio)'],
            ['400', 'URL tidak valid'],
            ['401', TOKEN_MSG],
            ['502', 'ssstik tidak mengembalikan tautan — video privat/dihapus']
          ]
        },
        {
          method: 'GET', path: '/api/download/youtube', name: 'YouTube',
          desc: 'Semua format video (MP4/WebM, sampai 4K) + audio (OPUS/M4A) untuk video & Shorts publik.',
          auth: true,
          fields: [
            { name: 'url', in: 'query', label: 'url', value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', hint: 'URL youtube.com/watch?v=... atau youtube.com/shorts/...' }
          ],
          codes: [
            ['200', 'array of media (video + audio, ukuran dalam MB)'],
            ['400', 'URL tidak valid'],
            ['401', TOKEN_MSG],
            ['502', 'vidssave menolak URL — bukan video publik']
          ]
        },
        {
          method: 'GET', path: '/api/download/facebook', name: 'Facebook',
          desc: 'Tautan unduhan video Facebook publik (HD kalau tersedia). Video privat, reel yang butuh login, atau foto nggak didukung.',
          auth: true,
          fields: [
            { name: 'url', in: 'query', label: 'url', value: 'https://www.facebook.com/facebook/videos/10153231379946729/', hint: 'URL video Facebook publik (facebook.com/.../videos/...).' }
          ],
          codes: [
            ['200', 'array of media (video)'],
            ['400', 'URL tidak valid'],
            ['401', TOKEN_MSG],
            ['502', 'video privat / bukan video / dihapus']
          ]
        },
        {
          method: 'GET', path: '/api/download/instagram', name: 'Instagram',
          desc: 'Tautan unduhan post/reel Instagram publik (video + gambar, termasuk carousel). Rate-limit Instagram sering bikin endpoint ini gagal — coba lagi beberapa menit kalau kena.',
          auth: true,
          fields: [
            { name: 'url', in: 'query', label: 'url', value: 'https://www.instagram.com/p/CxKvUxLI0zV/', hint: 'URL instagram.com/p/..., /reel/..., atau /tv/... publik.' }
          ],
          codes: [
            ['200', 'array of media (video/gambar)'],
            ['400', 'URL Instagram tidak dikenali'],
            ['401', TOKEN_MSG],
            ['502', 'rate-limit / login wajib — coba lagi nanti']
          ]
        }
      ]
    }
  ];

  var TOTAL = CATALOG.reduce(function (n, c) { return n + c.endpoints.length; }, 0);
  var METHOD_CLASS = { GET: 'method--get', POST: 'method--post', PUT: 'method--put', DELETE: 'method--del' };

  var filter = 'all';
  var query = '';
  var cards = [];   // { ep, cat, root, ctx }

  /* ------------------------------------------------------------------ *
   * Bantu
   * ------------------------------------------------------------------ */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined && html !== null) n.innerHTML = html;
    return n;
  }

  function autoEmail() {
    return 'levi+' + Date.now() + '@contoh.com';
  }

  function seed(field) {
    if (field.value === '@auto') return autoEmail();
    return field.value || '';
  }

  function needsToken(ep) { return ep.auth === true; }

  /* ------------------------------------------------------------------ *
   * Bangun kartu per endpoint
   * ------------------------------------------------------------------ */
  function buildCard(ep, cat) {
    var ctx = { ep: ep, inputs: {}, last: '' };

    var root = el('article', 'ep');
    ctx.root = root;
    root.setAttribute('data-method', ep.method);
    root.setAttribute('data-path', ep.path);

    var hdr = el('button', 'ep__hdr');
    hdr.type = 'button';
    hdr.setAttribute('aria-expanded', 'false');

    var meth = el('span', 'method ' + (METHOD_CLASS[ep.method] || 'method--get'), ep.method);
    hdr.appendChild(meth);

    var info = el('span', 'ep__info');
    info.appendChild(el('span', 'ep__name', ep.name));
    info.appendChild(el('span', 'ep__path', ep.path));
    hdr.appendChild(info);

    var tags = el('span', 'ep__tags');
    tags.appendChild(el('span', 'tag' + (needsToken(ep) ? ' tag--auth' : ''), needsToken(ep) ? 'bearer' : 'publik'));
    if (ep.writes) tags.appendChild(el('span', 'tag', 'tulis'));
    hdr.appendChild(tags);

    var chev = el('span', 'ep__chev', ICO.chev);
    hdr.appendChild(chev);
    root.appendChild(hdr);

    var body = el('div', 'ep__body');
    body.id = 'epb-' + cat.id + '-' + cards.length;
    body.appendChild(el('p', 'ep__desc', ep.desc));

    /* --- field --- */
    if (ep.fields && ep.fields.length) {
      var fields = el('div', 'ep__fields');
      ep.fields.forEach(function (f) {
        var wrap = el('div', 'ep__field');
        var lab = el('label', null, f.label + (f.optional ? ' <span class="ep__opt">opsional</span>' : ''));
        lab.setAttribute('for', 'f-' + cat.id + '-' + ep.path + '-' + f.name);
        wrap.appendChild(lab);

        var inp = el('input');
        inp.type = f.type === 'password' ? 'password' : 'text';
        inp.id = 'f-' + cat.id + '-' + ep.path + '-' + f.name;
        inp.value = seed(f);
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        wrap.appendChild(inp);

        if (f.hint) wrap.appendChild(el('p', 'ep__hint', f.hint));
        fields.appendChild(wrap);

        ctx.inputs[f.name] = inp;
        inp.addEventListener('input', function () { refresh(ctx); });
      });
      body.appendChild(fields);
    }

    /* --- bearer token (satu field, disinkronkan ke semua kartu) --- */
    if (needsToken(ep)) {
      var tw = el('div', 'ep__field');
      var tl = el('label', null, 'bearer token');
      tw.appendChild(tl);
      var ti = el('input');
      ti.type = 'text';
      ti.className = 'ep__token';
      ti.placeholder = 'eyJhbGciOi…';
      ti.spellcheck = false;
      ti.autocomplete = 'off';
      ti.value = L.getToken() || '';
      tw.appendChild(ti);
      tw.appendChild(el('p', 'ep__hint',
        'Belum punya? Pilih <code>POST /api/auth/register</code> di kategori Autentikasi — ' +
        'token-nya langsung mengisi kolom ini begitu berhasil.'));
      body.appendChild(tw);
      ctx.token = ti;
      ti.addEventListener('input', function () {
        L.setToken(ti.value.trim(), false);
        var all = document.querySelectorAll('.ep__token');
        for (var i = 0; i < all.length; i++) { if (all[i] !== ti) all[i].value = ti.value; }
        refreshAll();
      });
    }

    /* --- body JSON (dirakit dari field, bukan diketik manual) --- */
    var hasBody = !!(ep.fields && ep.fields.some(function (f) { return f.in === 'body'; }));
    if (hasBody) {
      var prev = el('div', 'ep__prev');
      var pbar = el('div', 'ep__bar');
      pbar.appendChild(el('span', 'ep__bar-label', 'Request body'));
      pbar.appendChild(el('span', 'chips', '<span class="chip chip--muted">application/json</span>'));
      prev.appendChild(pbar);
      prev.appendChild(el('pre', null, '<code></code>'));
      body.appendChild(prev);
      ctx.prev = prev.querySelector('code');
    }

    /* --- aksi --- */
    var actions = el('div', 'ep__actions');
    var send = el('button', 'btn btn--primary btn--sm', ICO.send + '<span>Kirim</span>');
    send.type = 'button';
    var clr = el('button', 'btn btn--ghost btn--sm', ICO.x + '<span>Bersihkan</span>');
    clr.type = 'button';
    var flash = el('span', 'ep__flash');
    actions.appendChild(send);
    actions.appendChild(clr);
    actions.appendChild(flash);
    body.appendChild(actions);
    ctx.flash = flash;

    if (ep.writes) {
      var warn = el('p', 'ep__warn', ICO.warn +
        '<span>Endpoint ini <b>menulis</b> ke database production. Datanya nyata — ' +
        'kalau bikin user buat coba-coba, hapus sendiri sesudahnya.</span>');
      warn.hidden = true;
      body.appendChild(warn);
      ctx.warn = warn;
    }

    /* --- respons --- */
    var resp = el('div', 'ep__resp');
    var rbar = el('div', 'ep__bar');
    rbar.appendChild(el('span', 'ep__bar-label', 'Response'));
    var chips = el('span', 'chips');
    var st = el('span', 'chip chip--muted', '—');
    var tm = el('span', 'chip chip--muted', '—');
    var sz = el('span', 'chip chip--muted', '—');
    chips.appendChild(st); chips.appendChild(tm); chips.appendChild(sz);
    rbar.appendChild(chips);
    resp.appendChild(rbar);
    resp.appendChild(el('pre', null, '<code>Belum ada request. Tekan “Kirim”.</code>'));
    body.appendChild(resp);
    ctx.status = st; ctx.time = tm; ctx.size = sz; ctx.out = resp.querySelector('code');
    resp.querySelector('pre').id = 'out-' + cat.id + '-' + cards.length;

    var rcopy = el('button', 'copy', ICO.copy + '<span>Salin</span>');
    rcopy.type = 'button';
    rbar.appendChild(rcopy);
    rcopy.addEventListener('click', function () {
      if (!ctx.last) { L.toast('Belum ada respons buat disalin'); return; }
      L.copy(ctx.last, 'Respons tersalin');
    });

    /* --- cURL --- */
    var curl = el('div', 'ep__curl');
    var cbar = el('div', 'ep__bar');
    cbar.appendChild(el('span', 'ep__bar-label', 'cURL'));
    var ccopy = el('button', 'copy', ICO.copy + '<span>Salin</span>');
    ccopy.type = 'button';
    cbar.appendChild(ccopy);
    curl.appendChild(cbar);
    curl.appendChild(el('pre', null, '<code></code>'));
    body.appendChild(curl);
    ctx.curl = curl.querySelector('code');
    ccopy.addEventListener('click', function () {
      L.copy(ctx.curl.textContent, 'Perintah cURL tersalin');
    });

    /* --- daftar status --- */
    var codes = el('div', 'ep__codes');
    codes.appendChild(el('div', 'ep__codes-hd', 'Status yang bisa dibalas endpoint ini'));
    ep.codes.forEach(function (row) {
      var ok = String(row[0]).charAt(0) === '2';
      var r = el('div', 'ep__codes-row');
      r.appendChild(el('span', 'cd ' + (ok ? 'cd--ok' : 'cd--err'), row[0]));
      r.appendChild(el('span', 'msg', row[1]));
      codes.appendChild(r);
    });
    body.appendChild(codes);

    root.appendChild(body);

    /* --- interaksi kartu --- */
    hdr.setAttribute('aria-controls', body.id);
    hdr.addEventListener('click', function () {
      var open = !root.classList.contains('is-open');
      root.classList.toggle('is-open', open);
      hdr.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && ctx.warn) ctx.warn.hidden = false;
      if (open) refresh(ctx);
    });

    send.addEventListener('click', function () { fire(ctx); });
    clr.addEventListener('click', function () { reset(ctx); });

    body.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); fire(ctx); }
    });

    cards.push({ ep: ep, cat: cat, root: root, ctx: ctx });
    return root;
  }

  /* ------------------------------------------------------------------ *
   * Nilai yang dipakai request
   * ------------------------------------------------------------------ */
  function buildPath(ep, ctx) {
    var p = ep.path;
    var qs = [];
    if (ep.fields) {
      ep.fields.forEach(function (f) {
        var v = ctx.inputs[f.name] ? ctx.inputs[f.name].value.trim() : '';
        if (f.in === 'path') {
          /* Kalau kosong, placeholder-nya DIBIARKAN. Dulu di sini diganti string
             kosong, jadi /api/users/:id berubah jadi /api/users/ — path yang tetap
             "valid" secara sintaks, penjagaan di fire() nggak kena, dan request
             kosong itu beneran terkirim. Placeholder yang dibiarkan bikin cURL
             langsung kelihatan mana yang belum diisi. */
          if (v) p = p.replace(':' + f.name, encodeURIComponent(v));
        } else if (f.in === 'query' && v) {
          qs.push(encodeURIComponent(f.name) + '=' + encodeURIComponent(v));
        }
      });
    }
    if (qs.length) p += '?' + qs.join('&');
    return p;
  }

  function missingPath(ep, ctx) {
    if (!ep.fields) return [];
    return ep.fields.filter(function (f) {
      return f.in === 'path' && !(ctx.inputs[f.name] && ctx.inputs[f.name].value.trim());
    });
  }

  function bodyJSON(ep, ctx) {
    if (!ep.fields) return null;
    var obj = {};
    var any = false;
    ep.fields.forEach(function (f) {
      if (f.in !== 'body') return;
      any = true;
      var v = ctx.inputs[f.name] ? ctx.inputs[f.name].value.trim() : '';
      if (v === '' && f.optional) return;
      obj[f.name] = v;
    });
    if (!any) return null;
    return JSON.stringify(obj, null, 2);
  }

  function curlText(ep, ctx) {
    var tok = ctx.token ? ctx.token.value.trim() : '';
    var lines = ['curl -X ' + ep.method + ' "' + BASE + buildPath(ep, ctx) + '"'];
    lines.push('-H "accept: application/json"');
    if (needsToken(ep)) lines.push('-H "Authorization: Bearer ' + (tok || '<token>') + '"');
    var b = bodyJSON(ep, ctx);
    if (b) {
      lines.push('-H "Content-Type: application/json"');
      lines.push("-d '" + b.replace(/'/g, "'\\''") + "'");
    }
    return lines.join(' \\\n  ');
  }

  /* ------------------------------------------------------------------ *
   * Segarkan tampilan satu kartu
   * ------------------------------------------------------------------ */
  function refresh(ctx) {
    if (ctx.prev) ctx.prev.textContent = bodyJSON(ctx.ep, ctx) || '';
    if (ctx.curl) ctx.curl.textContent = curlText(ctx.ep, ctx);
  }

  function refreshAll() {
    cards.forEach(function (c) { refresh(c.ctx); });
  }

  function reset(ctx) {
    var ep = ctx.ep;
    if (ep.fields) {
      ep.fields.forEach(function (f) {
        if (ctx.inputs[f.name]) ctx.inputs[f.name].value = seed(f);
      });
    }
    setStatus(ctx, '—', 'muted');
    ctx.time.textContent = '—';
    ctx.size.textContent = '—';
    ctx.out.textContent = 'Belum ada request. Tekan “Kirim”.';
    ctx.last = '';
    flash(ctx, '');
    refresh(ctx);
  }

  function setStatus(ctx, text, kind) {
    ctx.status.className = 'chip chip--' + kind;
    ctx.status.textContent = text;
  }

  function flash(ctx, msg, isErr) {
    ctx.flash.textContent = msg || '';
    ctx.flash.className = 'ep__flash' + (isErr ? ' is-err' : '');
  }

  /* ------------------------------------------------------------------ *
   * Kirim request
   * ------------------------------------------------------------------ */
  function fire(ctx) {
    var ep = ctx.ep;

    var kurang = missingPath(ep, ctx);
    if (kurang.length) {
      var nama = kurang.map(function (f) { return f.name; }).join(' dan ');
      flash(ctx, 'Isi dulu ' + nama + ' di path-nya', true);
      if (ctx.inputs[kurang[0].name]) ctx.inputs[kurang[0].name].focus();
      return;
    }

    var path = buildPath(ep, ctx);

    if (path.indexOf(':') >= 0) {
      flash(ctx, 'Isi dulu parameter di path-nya', true);
      return;
    }

    var opts = { method: ep.method };

    if (needsToken(ep)) {
      var tok = ctx.token.value.trim();
      if (!tok) {
        flash(ctx, 'Endpoint ini butuh bearer token', true);
        ctx.token.focus();
        return;
      }
      opts.token = tok;
    }

    var body = bodyJSON(ep, ctx);
    if (body) opts.body = body;

    var btn = ctx.root.querySelector('.btn--primary');
    btn.disabled = true;
    flash(ctx, 'Mengirim…');
    setStatus(ctx, '…', 'muted');
    ctx.time.textContent = '—';
    ctx.size.textContent = '—';

    /* Semua jalur — termasuk galat yang nggak ketangkep — harus tetap
       mengembalikan tombolnya. Kalau enggak, satu error bikin kartu itu
       mati diam-diam dan pengguna nggak tahu kenapa. */
    function done() { btn.disabled = false; }

    try {
      L.api(path, opts)
        .then(function (r) {
          ctx.time.textContent = r.ms + ' ms';
          ctx.size.textContent = r.raw ? r.raw.length + ' B' : '0 B';
          setStatus(ctx, r.status + (r.statusText ? ' ' + r.statusText : ''), r.ok ? 'ok' : 'err');

          var pretty = r.isJson ? JSON.stringify(r.data, null, 2) : r.raw;
          pretty = pretty || '(body kosong)';
          ctx.out.textContent = pretty;
          ctx.last = pretty;

          if (r.ok) {
            flash(ctx, 'Selesai dalam ' + r.ms + ' ms');
          } else if (r.status === 401) {
            flash(ctx, 'Ditolak — cek bearer token-nya', true);
          } else {
            flash(ctx, 'Dibalas ' + r.status, true);
          }

          /* register / login sukses -> token-nya langsung dipakai */
          if (r.ok && ep.path.indexOf('/api/auth/') === 0 && r.data && r.data.token) {
            var all = document.querySelectorAll('.ep__token');
            for (var i = 0; i < all.length; i++) all[i].value = r.data.token;
            L.setToken(r.data.token, false);
            L.toast('Token tersimpan — kolom bearer di kartu lain ikut terisi');
            refreshAll();
          }
        })
        .catch(function (err) {
          ctx.time.textContent = '—';
          setStatus(ctx, 'gagal', 'err');
          ctx.out.textContent = 'Request nggak sampai: ' + err.message;
          ctx.last = '';
          flash(ctx, 'Gagal terhubung', true);
        })
        .then(done, done);
    } catch (err) {
      ctx.out.textContent = 'Halaman ini gagal menyusun request: ' + err.message;
      flash(ctx, 'Gagal menyusun request', true);
      done();
    }
  }

  /* ------------------------------------------------------------------ *
   * Render halaman
   * ------------------------------------------------------------------ */
  function renderNav() {
    var nav = L.$('exNav');
    if (!nav) return;

    function item(id, name, count) {
      var b = el('button', 'ex__nav-item' + (filter === id ? ' is-active' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'ex__dot'));
      b.appendChild(el('span', 'ex__nav-name', name));
      b.appendChild(el('span', 'ex__nav-cnt', String(count)));
      b.addEventListener('click', function () {
        filter = id;
        renderNav();
        apply();
      });
      return b;
    }

    nav.innerHTML = '';
    nav.appendChild(item('all', 'Semua endpoint', TOTAL));
    CATALOG.forEach(function (c) {
      nav.appendChild(item(c.id, c.name, c.endpoints.length));
    });
  }

  function renderFolders() {
    var main = L.$('exFolders');
    if (!main) return;
    main.innerHTML = '';

    CATALOG.forEach(function (cat, ci) {
      var folder = el('section', 'folder');
      folder.setAttribute('data-cat', cat.id);
      folder.id = 'cat-' + cat.id;

      var hdr = el('button', 'folder__hdr');
      hdr.type = 'button';
      hdr.setAttribute('aria-expanded', 'true');
      hdr.setAttribute('aria-controls', 'catbody-' + cat.id);
      hdr.appendChild(el('span', 'folder__icon', ICO[cat.icon] || ICO.eye));

      var title = el('span', 'folder__title');
      title.appendChild(el('span', 'folder__name', cat.name));
      title.appendChild(el('span', 'folder__sub', cat.desc));
      hdr.appendChild(title);

      var meta = el('span', 'folder__meta');
      meta.appendChild(el('span', 'folder__cnt', cat.endpoints.length + ' endpoint'));
      var chev = el('span', 'folder__chev', ICO.down);
      meta.appendChild(chev);
      hdr.appendChild(meta);
      folder.appendChild(hdr);

      var fbody = el('div', 'folder__body');
      fbody.id = 'catbody-' + cat.id;
      cat.endpoints.forEach(function (ep) {
        fbody.appendChild(buildCard(ep, cat));
      });
      folder.appendChild(fbody);

      hdr.addEventListener('click', function () {
        var closed = folder.classList.toggle('is-closed');
        hdr.setAttribute('aria-expanded', closed ? 'false' : 'true');
      });

      main.appendChild(folder);
    });

    /* buka satu kartu pertama biar halaman nggak terlihat kosong */
    if (cards.length) {
      var first = cards[0];
      first.root.classList.add('is-open');
      first.root.querySelector('.ep__hdr').setAttribute('aria-expanded', 'true');
      if (first.ctx.warn) first.ctx.warn.hidden = false;
      refresh(first.ctx);
    }
  }

  function matches(entry, q) {
    if (!q) return true;
    var ep = entry.ep;
    var hay = (ep.method + ' ' + ep.path + ' ' + ep.name + ' ' + ep.desc + ' ' +
               entry.cat.name + ' ' + entry.cat.id).toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function apply() {
    var q = query.trim().toLowerCase();
    var shown = 0;

    CATALOG.forEach(function (cat) {
      var folder = document.querySelector('.folder[data-cat="' + cat.id + '"]');
      if (!folder) return;

      var inFilter = (filter === 'all' || filter === cat.id);
      var visible = 0;

      cards.forEach(function (entry) {
        if (entry.cat.id !== cat.id) return;
        var ok = inFilter && matches(entry, q);
        entry.root.hidden = !ok;
        if (ok) visible++;
      });

      folder.hidden = visible === 0;
      if (visible > 0 && q) folder.classList.remove('is-closed');
      var cnt = folder.querySelector('.folder__cnt');
      if (cnt) {
        cnt.textContent = (q && visible !== cat.endpoints.length)
          ? visible + ' dari ' + cat.endpoints.length + ' endpoint'
          : cat.endpoints.length + ' endpoint';
      }
      shown += visible;
    });

    var info = L.$('exCount');
    if (info) {
      if (q) {
        info.innerHTML = 'Cari <b>' + q.replace(/[<>&]/g, '') + '</b> — <b>' + shown +
          '</b> dari <b>' + TOTAL + '</b> endpoint cocok.';
      } else if (filter !== 'all') {
        var c = CATALOG.filter(function (x) { return x.id === filter; })[0];
        info.innerHTML = 'Kategori <b>' + c.name + '</b> — <b>' + shown + '</b> endpoint. ' +
          'Tekan <b>Semua endpoint</b> buat lihat semuanya.';
      } else {
        info.innerHTML = 'Menampilkan <b>' + TOTAL + '</b> endpoint dalam <b>' + CATALOG.length +
          '</b> kategori. Semua respons di bawah ini asli.';
      }
    }

    var empty = L.$('exEmpty');
    if (empty) empty.hidden = shown !== 0;
  }

  /* ------------------------------------------------------------------ *
   * Mulai
   * ------------------------------------------------------------------ */
  function init() {
    if (!L.$('exFolders')) return;

    var base = L.$('exBase');
    if (base) base.textContent = BASE;

    renderFolders();
    renderNav();
    apply();
    refreshAll();

    var search = L.$('exSearch');
    if (search) {
      search.addEventListener('input', function () {
        query = this.value;
        apply();
      });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { this.value = ''; query = ''; apply(); }
      });
    }
  }

  init();
})();
