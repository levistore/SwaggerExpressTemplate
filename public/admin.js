/* Lcode Api — admin.js
   Panel manajemen user. Guard dua lapis:
   1. UI: kalau token nggak ada / bukan admin, tampil "akses ditolak".
   2. Server: /api/users menolak 403 untuk non-admin — UI cuma kenyamanan.
   Semua data nyata dari API; nggak ada daftar contoh. */
(function () {
  'use strict';
  var L = window.Lcode;

  var users = [];
  var editingId = null;

  function err(id, msg) {
    var el = L.$(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('is-err', !!msg);
  }

  function busy(btn, on) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function show(view) {
    L.$('denyView').hidden = view !== 'deny';
    L.$('adminView').hidden = view !== 'admin';
  }

  /* ------------------------------------------------------------------ *
   * Muat daftar user
   * ------------------------------------------------------------------ */
  function load() {
    var tok = L.getToken();
    if (!tok) { renderDeny('Belum masuk. Masuk dulu pakai akun admin.'); return; }

    L.api('/api/users', { token: tok }).then(function (r) {
      if (r.status === 401) { renderDeny('Sesi lu sudah habis atau tokennya nggak valid.'); return; }
      if (r.status === 403) { renderDeny('Akun lu bukan admin. Panel ini cuma untuk role admin.'); return; }
      if (!r.ok || !Array.isArray(r.data)) {
        err('listErr', 'Gagal memuat daftar: ' + (r.data && r.data.message || r.status));
        return;
      }
      users = r.data;
      renderList();
      show('admin');
    });
  }

  function renderDeny(msg) {
    L.$('denyMsg').textContent = msg;
    show('deny');
  }

  function renderList() {
    L.$('userCount').textContent = users.length + ' user';
    var wrap = L.$('userTable');
    wrap.textContent = '';

    if (users.length === 0) {
      wrap.appendChild(elNote('Belum ada user.'));
      return;
    }

    users.forEach(function (u) {
      var row = document.createElement('div');
      row.className = 'panel__row';
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;' +
        'border:1px solid var(--line);border-radius:12px;padding:12px 14px';

      var left = document.createElement('div');
      left.style.cssText = 'min-width:0';
      left.innerHTML =
        '<div style="font-weight:600">' + esc(u.name) +
        (u.role === 'admin' ? ' <span class="chip" style="margin-left:6px">admin</span>' : '') +
        '</div>' +
        '<div style="opacity:.65;font-size:.9rem;overflow:hidden;text-overflow:ellipsis">' +
        esc(u.email) + ' · #' + u.id + '</div>';
      row.appendChild(left);

      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0';

      actions.appendChild(btnGhost('Edit', function () { openEdit(u); }));
      actions.appendChild(btnGhost('Hapus', function () { removeUser(u); }));
      row.appendChild(actions);

      wrap.appendChild(row);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function elNote(text) {
    var p = document.createElement('p');
    p.className = 'note note--info';
    p.textContent = text;
    return p;
  }

  function btnGhost(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm';
    var span = document.createElement('span');
    span.textContent = label;
    b.appendChild(span);
    b.addEventListener('click', onClick);
    return b;
  }

  /* ------------------------------------------------------------------ *
   * Bikin user
   * ------------------------------------------------------------------ */
  L.$('createForm').addEventListener('submit', function (e) {
    e.preventDefault();
    err('cErr', '');
    var btn = L.$('cSubmit');

    var name = L.$('cName').value.trim();
    var email = L.$('cEmail').value.trim();
    var password = L.$('cPassword').value;
    var role = L.$('cRole').value;

    if (!name) { err('cErr', 'Nama wajib diisi.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('cErr', 'Email nggak valid.'); return; }
    if (password && password.length < 8) { err('cErr', 'Password minimal 8 karakter.'); return; }

    var body = { name: name, email: email, role: role };
    if (password) body.password = password;

    busy(btn, true);
    L.api('/api/users', { method: 'POST', token: L.getToken(), body: body })
      .then(function (r) {
        busy(btn, false);
        if (r.status === 403) { renderDeny('Akun lu bukan admin.'); return; }
        if (!r.ok) {
          err('cErr', (r.data && r.data.message) || ('Gagal: ' + r.status));
          return;
        }
        L.toast('Akun dibuat: ' + r.data.email);
        L.$('cName').value = ''; L.$('cEmail').value = '';
        L.$('cPassword').value = ''; L.$('cRole').value = 'user';
        load();
      });
  });

  /* ------------------------------------------------------------------ *
   * Edit user
   * ------------------------------------------------------------------ */
  function openEdit(u) {
    editingId = u.id;
    L.$('editPanel').hidden = false;
    L.$('eId').textContent = '#' + u.id;
    L.$('eName').value = u.name;
    L.$('eEmail').value = u.email;
    L.$('eRole').value = u.role === 'admin' ? 'admin' : 'user';
    L.$('ePassword').value = '';
    err('eErr', '');
    L.$('editPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  L.$('eCancel').addEventListener('click', function () {
    L.$('editPanel').hidden = true;
    editingId = null;
  });

  L.$('editForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (editingId == null) return;
    err('eErr', '');
    var btn = L.$('eSubmit');

    var name = L.$('eName').value.trim();
    var email = L.$('eEmail').value.trim();
    var role = L.$('eRole').value;
    var password = L.$('ePassword').value;

    if (!name) { err('eErr', 'Nama wajib diisi.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('eErr', 'Email nggak valid.'); return; }

    var body = { name: name, email: email, role: role };
    if (password) {
      if (password.length < 8) { err('eErr', 'Password baru minimal 8 karakter.'); return; }
      body.password = password;
    }

    busy(btn, true);
    L.api('/api/users/' + editingId, { method: 'PUT', token: L.getToken(), body: body })
      .then(function (r) {
        busy(btn, false);
        if (r.status === 403) { renderDeny('Akun lu bukan admin.'); return; }
        if (!r.ok) {
          err('eErr', (r.data && r.data.message) || ('Gagal: ' + r.status));
          return;
        }
        L.toast('Perubahan disimpan.');
        L.$('editPanel').hidden = true;
        editingId = null;
        load();
      });
  });

  /* ------------------------------------------------------------------ *
   * Hapus user
   * ------------------------------------------------------------------ */
  function removeUser(u) {
    if (u.role === 'admin') {
      L.toast('Akun admin nggak bisa dihapus dari panel ini.', 'err');
      return;
    }
    if (!window.confirm('Hapus ' + u.email + ' (#' + u.id + ')? Nggak ada undo.')) return;

    L.api('/api/users/' + u.id, { method: 'DELETE', token: L.getToken() })
      .then(function (r) {
        if (r.status === 403) { renderDeny('Akun lu bukan admin.'); return; }
        if (!r.ok) {
          L.toast((r.data && r.data.message) || ('Gagal: ' + r.status), 'err');
          return;
        }
        L.toast('User #' + u.id + ' dihapus.');
        load();
      });
  }

  /* ------------------------------------------------------------------ *
   * init
   * ------------------------------------------------------------------ */
  L.$('btnReload').addEventListener('click', load);
  L.$('year').textContent = new Date().getFullYear();

  // Cek role sebelum nyala: /me balikin role fresh dari DB.
  var tok = L.getToken();
  if (!tok) {
    renderDeny('Belum masuk. Masuk dulu pakai akun admin di halaman Profile.');
  } else {
    L.api('/api/auth/me', { token: tok }).then(function (r) {
      if (!r.ok || !r.data || r.data.role !== 'admin') {
        renderDeny(r.status === 401
          ? 'Sesi lu sudah habis atau tokennya nggak valid.'
          : 'Akun lu bukan admin. Panel ini cuma untuk role admin.');
        return;
      }
      show('admin');
      load();
    });
  }
})();
