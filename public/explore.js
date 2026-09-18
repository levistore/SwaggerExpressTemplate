/* Lcode Api — explore.js
   API Playground: katalog endpoint terkategori → detail → kirim request nyata.
   Semua data respons berasal dari server asli. Nggak ada nilai karangan.
*/
(function () {
  'use strict';
  var L = window.Lcode;
  var esc = L.esc;

  // ------------------------------------------------------------------
  // Katalog — hanya endpoint yang benar-benar ada di backend
  // ------------------------------------------------------------------
  var CATALOG = [
    {
      id: 'downloader',
      name: 'Downloader',
      desc: 'Ekstrak tautan unduhan langsung (video/gambar/audio) dari konten publik TikTok, YouTube, Facebook, dan Instagram.',
      icon: 'image',
      color: '#8a38f5',
      endpoints: [
        {
          method: 'GET', path: '/api/download/tiktok', name: 'TikTok Downloader',
          desc: 'Unduh video TikTok (with-watermark & tanpa watermark) plus audio MP3 dari URL publik.',
          auth: 'required',
          fields: [{ key: 'url', label: 'URL TikTok', type: 'url', required: true, ph: 'https://www.tiktok.com/@user/video/...', hint: 'URL video TikTok publik' }]
        },
        {
          method: 'GET', path: '/api/download/youtube', name: 'YouTube Downloader',
          desc: 'Unduh video YouTube (sampai 4K, tergantung sumber) atau audionya saja. Shorts kadang diminta login oleh sumber — fluktuatif per IP.',
          auth: 'required',
          fields: [
            { key: 'url', label: 'URL YouTube', type: 'url', required: true, ph: 'https://www.youtube.com/watch?v=...', hint: 'URL video / shorts YouTube publik' },
            { key: 'mode', label: 'Mode', type: 'select', required: false, options: [['video', 'Video'], ['audio', 'Audio (MP3)']], def: 'video', hint: 'audio = link MP3 saja' }
          ]
        },
        {
          method: 'GET', path: '/api/download/facebook', name: 'Facebook Downloader',
          desc: 'Unduh video Facebook publik (HD/SD bila tersedia) dari URL postingan atau watch.',
          auth: 'required',
          fields: [{ key: 'url', label: 'URL Facebook', type: 'url', required: true, ph: 'https://www.facebook.com/watch?v=...', hint: 'URL video Facebook publik' }]
        },
        {
          method: 'GET', path: '/api/download/instagram', name: 'Instagram Downloader',
          desc: 'Unduh reel/post/gambar Instagram publik. Catatan jujur: dari IP server (datacenter) Instagram hampir selalu menolak dengan login_required — endpoint ini bisa gagal 502. Itu keterbatasan sumber, bukan bug.',
          auth: 'required',
          fields: [{ key: 'url', label: 'URL Instagram', type: 'url', required: true, ph: 'https://www.instagram.com/reel/...', hint: 'URL post / reel Instagram publik' }]
        }
      ]
    },
    {
      id: 'auth',
      name: 'Authentication',
      desc: 'Daftar akun baru, login, dan cek profil sesi yang sedang aktif. Token JWT dipakai untuk endpoint terproteksi.',
      icon: 'shield',
      color: '#1060ff',
      endpoints: [
        {
          method: 'POST', path: '/api/auth/register', name: 'Register Akun Baru',
          desc: 'Buat akun developer baru. Respons berisi token yang bisa langsung dipakai.',
          auth: 'public',
          fields: [
            { key: 'name', label: 'Nama', type: 'text', required: true, ph: 'Nama lu', body: true },
            { key: 'email', label: 'Email', type: 'email', required: true, ph: 'nama@email.com', body: true },
            { key: 'password', label: 'Password', type: 'password', required: true, ph: 'Minimal 8 karakter', body: true }
          ]
        },
        {
          method: 'POST', path: '/api/auth/login', name: 'Login Pengguna',
          desc: 'Autentikasi kredensial dan dapatkan Bearer token.',
          auth: 'public',
          fields: [
            { key: 'email', label: 'Email', type: 'email', required: true, ph: 'nama@email.com', body: true },
            { key: 'password', label: 'Password', type: 'password', required: true, ph: '••••••••', body: true }
          ]
        },
        {
          method: 'GET', path: '/api/auth/me', name: 'Cek Sesi Login',
          desc: 'Verifikasi Bearer token dan ambil profil akun yang sedang login (role dibaca fresh dari DB).',
          auth: 'required',
          fields: []
        }
      ]
    }
  ];

  var METHOD_LIST = ['ALL', 'GET', 'POST'];
  var state = { method: 'ALL', category: 'ALL', ep: null };

  // ------------------------------------------------------------------
  // util
  // ------------------------------------------------------------------
  function methodChip(m) {
    return '<span class="method-chip method-chip--' + m.toLowerCase() + '">' + esc(m) + '</span>';
  }
  function q(sel) { return document.querySelector(sel); }

  function baseUrl() {
    return window.location.origin;
  }

  // ------------------------------------------------------------------
  // render katalog
  // ------------------------------------------------------------------
  function renderFilters() {
    var mf = q('#methodFilter');
    mf.innerHTML = METHOD_LIST.map(function (m) {
      return '<button type="button" class="method-btn' + (state.method === m ? ' is-active' : '') + '" data-m="' + m + '">' + m + '</button>';
    }).join('');
    mf.querySelectorAll('.method-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.method = b.getAttribute('data-m');
        renderFilters();
        renderCatalog();
      });
    });

    var cats = CATALOG.map(function (c) { return c.name; });
    var cf = q('#categoryFilter');
    cf.innerHTML = '<option value="ALL">All Categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    cf.onchange = function () { state.category = cf.value; renderCatalog(); };
  }

  function totalEndpoints() {
    return CATALOG.reduce(function (n, c) { return n + c.endpoints.length; }, 0);
  }

  function renderCatalog() {
    var list = q('#catalogList');
    var visible = CATALOG.filter(function (c) { return state.category === 'ALL' || c.name === state.category; });

    list.innerHTML = visible.map(function (cat) {
      var eps = cat.endpoints.filter(function (e) { return state.method === 'ALL' || e.method === state.method; });
      if (eps.length === 0) return '';
      var cards = eps.map(function (ep, i) {
        return '<button type="button" class="ep-btn" data-cat="' + esc(cat.id) + '" data-i="' + cat.endpoints.indexOf(ep) + '">' +
          '<span class="ep-btn__left">' + methodChip(ep.method) +
            '<span style="min-width:0;flex:1">' +
              '<span class="ep-btn__name"><b>' + esc(ep.name) + '</b>' +
                '<code class="ep-btn__path mono">' + esc(ep.path) + '</code></span>' +
              '<span class="ep-btn__desc" style="display:block">' + esc(ep.desc) + '</span>' +
            '</span></span>' +
          '<span class="ep-btn__arrow">' + L.icon('chevronRight', 'w-4 h-4') + '</span>' +
        '</button>';
      }).join('');

      return '<div class="cat-card">' +
        '<button type="button" class="cat-card__btn" aria-expanded="false">' +
          '<span style="display:flex;align-items:center;gap:0.75rem;min-width:0">' +
            '<span class="cat-card__icon" style="width:2rem;height:2rem">' + L.icon(cat.icon, 'w-4 h-4') + '</span>' +
            '<span class="cat-card__meta">' +
              '<span class="cat-card__title"><h2>' + esc(cat.name) + '</h2>' +
                '<span class="cat-card__count">' + eps.length + ' endpoints</span></span>' +
              '<span class="cat-card__desc" style="display:block">' + esc(cat.desc) + '</span>' +
            '</span></span>' +
          '<span class="cat-card__toggle">' + L.icon('plus', 'w-3.5 h-3.5') + '</span>' +
        '</button>' +
        '<div class="cat-card__body" hidden>' + cards + '</div>' +
      '</div>';
    }).join('');

    q('#catalogTotal').textContent = 'Menampilkan ' + totalEndpoints() + ' endpoint dalam ' + CATALOG.length + ' kategori. Request dikirim beneran ke server — respons yang tampil apa adanya.';

    // interaksi expand
    list.querySelectorAll('.cat-card__btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var body = b.parentElement.querySelector('.cat-card__body');
        var open = body.hidden;
        body.hidden = !open;
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.querySelector('.cat-card__toggle').innerHTML = L.icon(open ? 'minus' : 'plus', 'w-3.5 h-3.5');
      });
    });
    list.querySelectorAll('.ep-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var catId = b.getAttribute('data-cat');
        var i = parseInt(b.getAttribute('data-i'), 10);
        var cat = CATALOG.find(function (c) { return c.id === catId; });
        openDetail(cat.endpoints[i]);
      });
    });
  }

  // ------------------------------------------------------------------
  // detail endpoint
  // ------------------------------------------------------------------
  function openDetail(ep) {
    state.ep = ep;
    q('#catalogView').hidden = true;
    q('#detailView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    q('#dMethod').className = 'method-chip method-chip--' + ep.method.toLowerCase();
    q('#dMethod').textContent = ep.method;
    q('#dPath').textContent = ep.path;
    q('#dName').textContent = ep.name;
    q('#dDesc').textContent = ep.desc;

    var authEl = q('#dAuth');
    if (ep.auth === 'required') {
      authEl.textContent = 'Bearer Auth';
      q('#authNote').className = 'auth-note is-required';
      q('#authNote').innerHTML = L.icon('lock', 'w-3.5 h-3.5') + '<span>Endpoint terproteksi — Bearer token dari session login lu dipakai otomatis. Belum login? <a href="/profile" style="color:var(--blue);font-weight:600">Sign in dulu</a>.</span>';
    } else {
      authEl.textContent = 'Public Endpoint';
      q('#authNote').className = 'auth-note';
      q('#authNote').innerHTML = L.icon('info', 'w-3.5 h-3.5') + '<span>Endpoint publik — dapat dieksekusi tanpa token autentikasi.</span>';
    }

    renderFields(ep);
    updatePreview();
    resetResponse();
  }

  function backToCatalog() {
    q('#detailView').hidden = true;
    q('#catalogView').hidden = false;
    state.ep = null;
  }

  function renderFields(ep) {
    var wrap = q('#fieldsWrap');
    if (!ep.fields.length) {
      wrap.innerHTML = '';
      return;
    }
    var hasBody = ep.fields.some(function (f) { return f.body; });
    var hasQuery = ep.fields.some(function (f) { return !f.body; });
    var html = '';
    if (hasBody) {
      html += '<div class="field-group-title" style="border-top:0;padding-top:0">Request Body (JSON)</div><div class="fields-grid">';
      html += ep.fields.filter(function (f) { return f.body; }).map(fieldHtml).join('');
      html += '</div>';
    }
    if (hasQuery) {
      html += '<div class="field-group-title">Query Parameters</div><div class="fields-grid">';
      html += ep.fields.filter(function (f) { return !f.body; }).map(fieldHtml).join('');
      html += '</div>';
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
    });

    function fieldHtml(f) {
      var req = f.required ? '' : '<span class="opt">(Optional)</span>';
      var inp;
      if (f.type === 'select') {
        inp = '<select class="field__select" id="f-' + f.key + '" data-key="' + f.key + '">' +
          f.options.map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (f.def === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select>';
      } else {
        inp = '<input id="f-' + f.key + '" data-key="' + f.key + '" type="' + f.type + '" placeholder="' + esc(f.ph || '') + '"' + (f.required ? ' required' : '') + '>';
      }
      return '<div class="field"><label for="f-' + f.key + '">' + esc(f.label) + req + '</label>' + inp +
        (f.hint ? '<p class="field__hint">' + esc(f.hint) + '</p>' : '') + '</div>';
    }
  }

  function collect(ep) {
    var body = {}, query = {};
    ep.fields.forEach(function (f) {
      var el = q('#f-' + f.key);
      if (!el) return;
      var v = (el.value || '').trim();
      if (!v) return;
      if (f.body) body[f.key] = v; else query[f.key] = v;
    });
    return { body: body, query: query };
  }

  function buildUrl(ep, query) {
    var qs = Object.keys(query).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
    }).join('&');
    return baseUrl() + ep.path + (qs ? '?' + qs : '');
  }

  function updatePreview() {
    var ep = state.ep;
    if (!ep) return;
    var c = collect(ep);
    var url = buildUrl(ep, c.query);
    q('#pvMethod').className = 'request-preview__method' + (ep.method === 'GET' ? ' is-get' : '');
    q('#pvMethod').textContent = ep.method;
    q('#pvUrl').textContent = ep.method === 'GET' ? url : baseUrl() + ep.path;
  }

  function curlText(ep) {
    var c = collect(ep);
    var url = buildUrl(ep, c.query);
    var parts = ['curl -X ' + ep.method + ' "' + url + '"'];
    if (L.getToken()) parts.push('-H "Authorization: Bearer <token>"');
    if (ep.method !== 'GET' && Object.keys(c.body).length) {
      parts.push('-H "Content-Type: application/json"');
      parts.push('-d \'' + JSON.stringify(c.body) + '\'');
    }
    return parts.join(' \\\n  ');
  }

  // ------------------------------------------------------------------
  // eksekusi
  // ------------------------------------------------------------------
  function resetResponse() {
    q('#respEmpty').hidden = false;
    q('#respBox').hidden = true;
    q('#respTime').textContent = '';
  }

  function showResponse(status, data, ms, ep, reqId) {
    q('#respEmpty').hidden = true;
    q('#respBox').hidden = false;
    q('#respTime').textContent = ms + ' ms';

    var st = q('#respStatus');
    st.className = 'resp-box__status ' + (status >= 200 && status < 300 ? 'is-ok' : 'is-err');
    st.textContent = 'HTTP ' + status;
    q('#respMeta').textContent = (ep ? ep.path : '') + (reqId ? '  ·  request_id: ' + reqId : '');

    // media links (respons downloader)
    var media = q('#respMedia');
    if (data && Array.isArray(data.media) && data.media.length) {
      media.hidden = false;
      media.innerHTML = data.media.map(function (m) {
        var u = typeof m === 'string' ? m : (m.url || '');
        var label = (m && (m.label || m.type || m.quality)) || 'media';
        if (!u) return '';
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label) + ' — ' + esc(u.length > 90 ? u.slice(0, 90) + '…' : u) + '</a>';
      }).join('');
    } else {
      media.hidden = true;
      media.innerHTML = '';
    }

    q('#respBody').textContent = JSON.stringify(data, null, 2);
  }

  function execute(ev) {
    ev.preventDefault();
    var ep = state.ep;
    if (!ep) return;
    var c = collect(ep);

    // validasi required di sisi UI
    for (var i = 0; i < ep.fields.length; i++) {
      var f = ep.fields[i];
      if (f.required && !c.body[f.key] && !c.query[f.key]) {
        L.toast('Field "' + f.label + '" wajib diisi', 'error');
        return;
      }
    }

    if (ep.auth === 'required' && !L.getToken()) {
      L.toast('Endpoint ini butuh login dulu — token nggak ada.', 'error');
      return;
    }

    var btn = q('#btnExec');
    btn.disabled = true;
    var t0 = performance.now();

    var opts = { method: ep.method, headers: { accept: 'application/json' } };
    var tok = L.getToken();
    if (tok) opts.headers.authorization = 'Bearer ' + tok;
    if (ep.method !== 'GET') {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(c.body);
    }

    fetch(buildUrl(ep, c.query), opts)
      .then(function (res) {
        var reqId = res.headers.get('x-request-id') || '';
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
          showResponse(res.status, data, Math.round(performance.now() - t0), ep, reqId);
          if (!res.ok) L.toast('Request selesai dengan status ' + res.status, res.status >= 500 ? 'error' : '');
        });
      })
      .catch(function (err) {
        showResponse(0, { ok: false, message: String(err && err.message || err) }, Math.round(performance.now() - t0), ep, '');
        L.toast('Request gagal: jaringan/server nggak bisa dihubungi', 'error');
      })
      .finally(function () { btn.disabled = false; });
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    renderFilters();
    renderCatalog();
    q('#btnBack').addEventListener('click', backToCatalog);
    q('#reqForm').addEventListener('submit', execute);
    q('#btnCopy').addEventListener('click', function () {
      var txt = curlText(state.ep || { method: 'GET', path: '', fields: [] });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { L.toast('cURL disalin ke clipboard', 'ok'); });
      } else {
        L.toast('Clipboard nggak tersedia di browser ini', 'error');
      }
    });
  });
})();
