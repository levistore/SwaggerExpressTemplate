/* Lcode Api — profile.js
   Login, register, dan halaman akun. State auth dari shell.js.
   Cek password baru dikirim apa adanya — aturan kuat divalidasi server.
*/
(function () {
  'use strict';
  var L = window.Lcode;

  function q(sel) { return document.querySelector(sel); }

  // ------------------------------------------------------------------
  // tampilan login vs profil
  // ------------------------------------------------------------------
  function showAuth(mode) {
    var register = mode === 'register';
    q('#profileView').hidden = true;
    q('#subnav').hidden = true;
    q('#authView').hidden = false;
    q('#authTitle').textContent = register ? 'Create Developer Account' : 'Sign in to Lcode Api';
    q('#authDesc').textContent = register
      ? 'Dapatkan akses langsung ke REST API dan interactive playground.'
      : 'Akses playground, katalog downloader, dan kelola akun lu.';
    q('#loginForm').hidden = register;
    q('#registerForm').hidden = !register;
    q('#footLink').textContent = register ? 'Sign in' : 'Create developer account';
    q('#footLink').setAttribute('data-mode', register ? 'login' : 'register');
  }

  function showProfile(me) {
    q('#authView').hidden = true;
    q('#subnav').hidden = false;
    q('#profileView').hidden = false;

    q('#pAvatar').textContent = (me.name || me.email || '?').charAt(0);
    q('#pName').textContent = me.name || '—';
    q('#pEmail').textContent = me.email || '—';
    var roleEl = q('#pRole');
    roleEl.textContent = (me.role || 'user').toUpperCase();
    roleEl.className = 'chip ' + (me.role === 'admin' ? 'chip--green' : 'chip--gray');
    q('#pId').textContent = me.id != null ? String(me.id) : '—';
    q('#ufName').value = me.name || '';
    q('#ufEmail').value = me.email || '';
  }

  function loadMe() {
    return L.api('GET', '/api/auth/me')
      .then(function (me) { showProfile(me); return me; })
      .catch(function (err) {
        // token nggak valid/kedaluwarsa → bersihkan & tampil login
        L.setToken('');
        showAuth('login');
        throw err;
      });
  }

  // ------------------------------------------------------------------
  // login / register
  // ------------------------------------------------------------------
  function doLogin(ev) {
    ev.preventDefault();
    var btn = q('#btnLogin');
    btn.disabled = true;
    L.api('POST', '/api/auth/login', {
      email: q('#liEmail').value.trim(),
      password: q('#liPassword').value
    }).then(function (res) {
      L.setToken(res.token);
      if (res.refreshToken) { L.setRefresh(res.refreshToken); L.setSessionId(res.sessionId); }
      L.toast('Login berhasil — selamat datang, ' + (res.user && res.user.name || '') + '!', 'ok');
      return loadMe();
    }).catch(function (err) {
      L.toast(err.message || 'Login gagal', 'error');
    }).finally(function () { btn.disabled = false; });
  }

  function doRegister(ev) {
    ev.preventDefault();
    var btn = q('#btnRegister');
    var pw = q('#rgPassword').value;
    // aturan kuat: cek di UI biar feedback cepat (server tetap cek ulang)
    if (!q('#rgName').value.trim() || !q('#rgEmail').value.trim()) { L.toast('Nama dan email wajib diisi', 'error'); return; }
    if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
      L.toast('Password belum memenuhi syarat: min 8 char, ada huruf besar, kecil, dan angka', 'error');
      return;
    }
    btn.disabled = true;
    L.api('POST', '/api/auth/register', {
      name: q('#rgName').value.trim(),
      email: q('#rgEmail').value.trim(),
      password: pw
    }).then(function (res) {
      L.setToken(res.token);
      if (res.refreshToken) { L.setRefresh(res.refreshToken); L.setSessionId(res.sessionId); }
      L.toast('Akun dibuat — langsung masuk!', 'ok');
      return loadMe();
    }).catch(function (err) {
      L.toast(err.message || 'Register gagal', 'error');
    }).finally(function () { btn.disabled = false; });
  }

  // ------------------------------------------------------------------
  // update profil / password
  // ------------------------------------------------------------------
  function doUpdate(ev) {
    ev.preventDefault();
    var btn = q('#btnUpd');
    btn.disabled = true;
    L.api('PUT', '/api/auth/me', {
      name: q('#ufName').value.trim(),
      email: q('#ufEmail').value.trim()
    }).then(function (me) {
      L.toast('Profil diperbarui', 'ok');
      // refresh token biar nama baru ikut di payload UI
      return loadMe();
    }).catch(function (err) {
      L.toast(err.message || 'Gagal memperbarui profil', 'error');
    }).finally(function () { btn.disabled = false; });
  }

  function doPassword(ev) {
    ev.preventDefault();
    var nw = q('#pwNew').value;
    if (nw !== q('#pwConf').value) { L.toast('Konfirmasi password nggak cocok', 'error'); return; }
    if (nw.length < 8 || !/[A-Z]/.test(nw) || !/[a-z]/.test(nw) || !/[0-9]/.test(nw)) {
      L.toast('Password baru belum memenuhi syarat kekuatan', 'error');
      return;
    }
    var btn = q('#btnPw');
    btn.disabled = true;
    L.api('PUT', '/api/auth/me', {
      currentPassword: q('#pwCur').value,
      password: nw
    }).then(function () {
      L.toast('Password diganti', 'ok');
      q('#pwCur').value = ''; q('#pwNew').value = ''; q('#pwConf').value = '';
    }).catch(function (err) {
      L.toast(err.message || 'Gagal mengganti password', 'error');
    }).finally(function () { btn.disabled = false; });
  }

  // ------------------------------------------------------------------
  // sessions (metadata aman saja dari server)
  // ------------------------------------------------------------------
  function loadSessions() {
    var el = q('#sessList');
    if (!el) return;
    L.api('GET', '/api/auth/sessions').then(function (list) {
      var rows = Array.isArray(list) ? list : (list.sessions || []);
      if (!rows.length) { el.innerHTML = '<p class="muted">Tidak ada session aktif tercatat.</p>'; return; }
      el.innerHTML = rows.map(function (s) {
        var cur = String(s.id) === String(L.getSessionId());
        return '<div class="mini-row"><span class="mono">' + esc(s.user_agent || 'unknown device') + '</span>' +
          '<span class="muted">' + esc(s.ip || '') + '</span>' +
          (cur ? '<span class="chip chip--green">current</span>' : '') +
          (cur ? '' : '<button class="btn btn--ghost btn--sm" data-sid="' + esc(s.id) + '">Revoke</button>') +
          '</div>';
      }).join('');
      el.onclick = function (ev) {
        var b = ev.target.closest('[data-sid]');
        if (!b) return;
        L.api('DELETE', '/api/auth/sessions/' + b.getAttribute('data-sid')).then(function () {
          L.toast('Session revoked', 'ok'); loadSessions();
        }).catch(function (err) { L.toast(err.message, 'error'); });
      };
    }).catch(function () { el.innerHTML = '<p class="muted">Gagal memuat sessions.</p>'; });
  }

  function doLogoutAll() {
    L.api('POST', '/api/auth/logout-all').then(function () {
      L.setToken(''); L.setRefresh(''); L.setSessionId('');
      L.toast('Semua session di-revoke — login ulang.', 'ok');
      setTimeout(function () { window.location.href = '/profile'; }, 800);
    }).catch(function (err) { L.toast(err.message || 'Gagal', 'error'); });
  }

  function doLogout() {
    L.setToken('');
    window.location.href = '/';
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    var hasToken = !!L.getToken();

    if (hasToken) {
      loadMe().catch(function () { /* sudah ditangani loadMe */ });
      loadSessions();
      var bAll = q('#btnLogoutAll');
      if (bAll) bAll.addEventListener('click', doLogoutAll);
    } else {
      showAuth(params.get('mode') === 'register' ? 'register' : 'login');
    }

    q('#loginForm').addEventListener('submit', doLogin);
    q('#registerForm').addEventListener('submit', doRegister);
    q('#updForm').addEventListener('submit', doUpdate);
    q('#pwForm').addEventListener('submit', doPassword);
    q('#btnLogout').addEventListener('click', doLogout);
    q('#footLink').addEventListener('click', function (ev) {
      ev.preventDefault();
      showAuth(q('#footLink').getAttribute('data-mode') || 'register');
    });
  });
})();
