/* Lcode Api — profile.js
   Halaman akun. Semua data di sini datang dari API: nggak ada profil
   contoh yang ditempel. Kalau tokennya nggak valid, halaman balik ke
   formulir masuk dengan pesan yang jelas. */
(function () {
  'use strict';
  var L = window.Lcode;

  var me = null;          // user yang sedang masuk
  var token = '';         // token aktif

  function err(id, msg) {
    var el = L.$(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    // biar pesan error kelihatan merah, bukan abu-abu seperti teks bantuan
    el.classList.toggle('is-err', !!msg);
  }

  function busy(btn, on) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function show(view) {
    var auth = L.$('authView'), prof = L.$('profileView');
    if (auth) auth.hidden = view !== 'auth';
    if (prof) prof.hidden = view !== 'profile';
  }

  /* ------------------------------------------------------------------ *
   * Tampilkan profil
   * ------------------------------------------------------------------ */
  function render() {
    if (!me) return;

    var initial = (me.name || '?').trim().charAt(0).toUpperCase() || '?';
    L.$('identAvatar').textContent = initial;
    L.$('identName').textContent = me.name;
    L.$('identMail').textContent = me.email;

    L.$('kvId').textContent = '#' + me.id;
    L.$('kvEmail').textContent = me.email;
    L.$('kvName').textContent = me.name;

    var payload = L.decodeJwt(token);
    if (payload && payload.exp) {
      var exp = new Date(payload.exp * 1000);
      var sisa = Math.round((exp.getTime() - Date.now()) / 86400000);
      L.$('kvExpires').textContent = exp.toLocaleString('id-ID', {
        dateStyle: 'long', timeStyle: 'short'
      }) + (sisa >= 0 ? '  (' + sisa + ' hari lagi)' : '  (sudah lewat)');
    } else {
      L.$('kvExpires').textContent = 'payload token nggak terbaca';
    }

    if (payload && payload.iat) {
      L.$('kvIssued').textContent = new Date(payload.iat * 1000).toLocaleString('id-ID', {
        dateStyle: 'long', timeStyle: 'short'
      });
    } else {
      L.$('kvIssued').textContent = '—';
    }

    var where = L.tokenWhere();
    L.$('kvStorage').textContent = where === 'local' ? 'localStorage — bertahan setelah tab ditutup'
      : where === 'session' ? 'sessionStorage — hilang saat tab ditutup'
      : 'memori halaman ini saja';

    L.$('tokenPeek').textContent = token.slice(0, 28) + '…' + token.slice(-12);

    L.$('editName').value = me.name;
    L.$('editEmail').value = me.email;

    show('profile');
  }

  /* ------------------------------------------------------------------ *
   * Ambil profil dari token yang tersimpan
   * ------------------------------------------------------------------ */
  function loadMe(opts) {
    opts = opts || {};
    token = L.getToken();

    if (!token) {
      show('auth');
      return Promise.resolve(false);
    }

    return L.api('/api/auth/me', { token: token })
      .then(function (r) {
        if (r.ok && r.data && r.data.id) {
          me = r.data;
          render();
          if (opts.justLoggedIn) L.toast('Masuk sebagai ' + me.name);
          return true;
        }
        // token basi / nggak valid -> jangan biarkan halaman nampilin
        // profil hantu
        L.clearToken();
        me = null;
        show('auth');
        err('authErr', r.status === 401
          ? 'Token-nya nggak valid atau sudah kedaluwarsa. Masuk lagi ya.'
          : 'API balas HTTP ' + r.status + '.');
        return false;
      })
      .catch(function () {
        show('auth');
        err('authErr', 'Nggak bisa menghubungi API dari browser ini.');
        return false;
      });
  }

  /* ------------------------------------------------------------------ *
   * Tab Masuk / Daftar
   * ------------------------------------------------------------------ */
  function initTabs() {
    var tabs = document.querySelectorAll('#authTabs .tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        var target = this.getAttribute('data-auth-tab');
        for (var j = 0; j < tabs.length; j++) {
          var on = tabs[j] === this;
          tabs[j].classList.toggle('is-active', on);
          tabs[j].setAttribute('aria-selected', String(on));
        }
        L.$('loginForm').hidden = target !== 'login';
        L.$('registerForm').hidden = target !== 'register';
        err('authErr', '');
        err('loginErr', '');
        err('registerErr', '');
      });
    }
  }

  function initLogin() {
    var form = L.$('loginForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = L.$('loginSubmit');
      var email = L.$('loginEmail').value.trim();
      var password = L.$('loginPassword').value;

      err('loginErr', '');
      if (!email || !password) { err('loginErr', 'Email dan password dua-duanya wajib diisi.'); return; }

      busy(btn, true);
      L.api('/api/auth/login', { method: 'POST', body: { email: email, password: password } })
        .then(function (r) {
          if (!r.ok || !r.data || !r.data.token) {
            err('loginErr', (r.data && r.data.message) || ('Gagal masuk — HTTP ' + r.status));
            return;
          }
          L.setToken(r.data.token, L.$('loginRemember').checked);
          L.$('loginPassword').value = '';
          return loadMe({ justLoggedIn: true });
        })
        .catch(function (e2) { err('loginErr', 'Request gagal: ' + e2.message); })
        .then(function () { busy(btn, false); });
    });
  }

  function initRegister() {
    var form = L.$('registerForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = L.$('regSubmit');
      var name = L.$('regName').value.trim();
      var email = L.$('regEmail').value.trim();
      var password = L.$('regPassword').value;

      err('registerErr', '');
      if (password.length < 8) {
        err('registerErr', 'Password minimal 8 karakter.');
        return;
      }

      busy(btn, true);
      L.api('/api/auth/register', {
        method: 'POST', body: { name: name, email: email, password: password }
      })
        .then(function (r) {
          if (!r.ok || !r.data || !r.data.token) {
            err('registerErr', (r.data && r.data.message) || ('Gagal mendaftar — HTTP ' + r.status));
            return;
          }
          L.setToken(r.data.token, L.$('regRemember').checked);
          L.$('regPassword').value = '';
          return loadMe({ justLoggedIn: true });
        })
        .catch(function (e2) { err('registerErr', 'Request gagal: ' + e2.message); })
        .then(function () { busy(btn, false); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Tempel token manual
   * ------------------------------------------------------------------ */
  function initManual() {
    var btn = L.$('manualApply');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var v = L.$('manualToken').value.trim();
      err('manualErr', '');
      if (!v) { err('manualErr', 'Token masih kosong.'); return; }
      if (v.split('.').length !== 3) {
        err('manualErr', 'Itu bukan format JWT (harus tiga bagian dipisah titik).');
        return;
      }
      L.setToken(v, L.$('manualRemember') && L.$('manualRemember').checked);
      busy(btn, true);
      loadMe({ justLoggedIn: true }).then(function () { busy(btn, false); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Ubah nama + email
   * ------------------------------------------------------------------ */
  function initEdit() {
    var form = L.$('editForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!me) return;

      var btn = L.$('editSubmit');
      var name = L.$('editName').value.trim();
      var email = L.$('editEmail').value.trim();

      err('editErr', '');
      // API-nya nolak kalau salah satu kosong — kasih tahu sebelum request
      if (!name || !email) {
        err('editErr', 'Nama dan email dua-duanya wajib diisi.');
        return;
      }

      busy(btn, true);
      L.api('/api/users/' + me.id, {
        method: 'PUT', token: token, body: { name: name, email: email }
      })
        .then(function (r) {
          if (!r.ok) {
            err('editErr', (r.data && r.data.message) || ('Gagal menyimpan — HTTP ' + r.status));
            return;
          }
          me.name = r.data.name;
          me.email = r.data.email;
          render();
          L.toast('Profil diperbarui');
        })
        .catch(function (e2) { err('editErr', 'Request gagal: ' + e2.message); })
        .then(function () { busy(btn, false); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Keluar & hapus akun
   * ------------------------------------------------------------------ */
  function initLogout() {
    var btn = L.$('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      L.clearToken();
      token = '';
      me = null;
      L.$('manualToken').value = '';
      L.$('deleteConfirm').value = '';
      err('authErr', '');
      show('auth');
      L.toast('Sudah keluar');
    });
  }

  function initDelete() {
    var form = L.$('deleteForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!me) return;

      var typed = L.$('deleteConfirm').value.trim();
      err('deleteErr', '');

      // konfirmasi ketik email — nggak bisa kepencet karena salah klik
      if (typed.toLowerCase() !== me.email.toLowerCase()) {
        err('deleteErr', 'Ketikan email akun lu persis sama buat konfirmasi.');
        return;
      }

      var btn = L.$('deleteSubmit');
      busy(btn, true);
      L.api('/api/users/' + me.id, { method: 'DELETE', token: token })
        .then(function (r) {
          if (!r.ok) {
            err('deleteErr', (r.data && r.data.message) || ('Gagal menghapus — HTTP ' + r.status));
            return;
          }
          L.clearToken();
          token = '';
          me = null;
          L.$('deleteConfirm').value = '';
          show('auth');
          err('authErr', '');
          L.toast('Akun dihapus');
        })
        .catch(function (e2) { err('deleteErr', 'Request gagal: ' + e2.message); })
        .then(function () { busy(btn, false); });
    });
  }

  /* ------------------------------------------------------------------ */
  initTabs();
  initLogin();
  initRegister();
  initManual();
  initEdit();
  initLogout();
  initDelete();
  loadMe();
})();
