/* Lcode Api — admin.js
   Panel admin: daftar/cari user, create, edit (role/password), hapus.
   Guard dua lapis: UI menolak non-admin, dan server tetap 403 kalau dilewati.
   Modal create/edit digabung: create = semua field kosong + password wajib;
   edit = password opsional (kosong = nggak diganti).
*/
(function () {
  'use strict';
  var L = window.Lcode;
  var me = null;
  var users = [];
  var editingId = null; // null = mode create

  function q(sel) { return document.querySelector(sel); }

  // ------------------------------------------------------------------
  // guard
  // ------------------------------------------------------------------
  function guard() {
    var tok = L.getToken();
    var payload = L.parseJwt(tok);
    if (!tok || !payload) {
      q('#denyView').hidden = false;
      q('#denyMsg').textContent = 'Lu belum login. Panel ini cuma untuk role admin.';
      return false;
    }
    if (payload.role !== 'admin') {
      q('#denyView').hidden = false;
      q('#denyMsg').textContent = 'Akun lu bukan admin. Panel ini cuma untuk role admin.';
      return false;
    }
    // role di token nggak cukup — cek fresh dari server (server yang memutuskan)
    return true;
  }

  function loadMe() {
    return L.api('GET', '/api/auth/me');
  }

  // ------------------------------------------------------------------
  // data users
  // ------------------------------------------------------------------
  function loadUsers() {
    return L.api('GET', '/api/users')
      .then(function (data) {
        // API balikin array langsung
        users = Array.isArray(data) ? data : (data && data.data) || [];
        renderUsers();
        q('#stUsers').textContent = String(users.length);
      })
      .catch(function (err) {
        if (err.status === 403) {
          q('#denyView').hidden = false;
          q('#denyMsg').textContent = 'Server menolak akses: bukan admin.';
          q('#adminView').hidden = true;
          return;
        }
        L.toast('Gagal memuat user: ' + err.message, 'error');
      });
  }

  function renderUsers() {
    var term = (q('#searchInput').value || '').toLowerCase().trim();
    var roleF = q('#roleFilter').value;
    var rows = users.filter(function (u) {
      if (roleF !== 'ALL' && (u.role || 'user') !== roleF) return false;
      if (term && !((u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term))) return false;
      return true;
    });

    var tbody = q('#userRows');
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--faint);padding:2rem">Nggak ada user yang cocok.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (u) {
        var isMe = me && u.id === me.id;
        var role = u.role || 'user';
        return '<tr>' +
          '<td><div class="user-cell">' +
            '<span class="user-cell__avatar">' + L.esc((u.name || '?').charAt(0)) + '</span>' +
            '<span><span class="user-cell__name">' + L.esc(u.name || '—') + '</span>' +
            (isMe ? ' <span class="user-cell__you">(You)</span>' : '') + '</span>' +
          '</div></td>' +
          '<td><span class="user-cell__email">' + L.esc(u.email || '—') + '</span></td>' +
          '<td><span class="chip ' + (role === 'admin' ? 'chip--green' : 'chip--gray') + '">' + role.toUpperCase() + '</span></td>' +
          '<td><span class="text-xs-mono text-faint">' + (u.created_at ? new Date(u.created_at).toLocaleDateString() : '—') + '</span></td>' +
          '<td><div class="user-table__actions" style="justify-content:flex-end">' +
            '<button class="btn btn--outline" data-act="edit" data-id="' + u.id + '">Edit</button>' +
            (role !== 'admin' ? '<button class="btn btn--danger" data-act="del" data-id="' + u.id + '">Hapus</button>' : '') +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    q('#userTotal').textContent = 'Total: ' + rows.length + ' user' + (term || roleF !== 'ALL' ? ' (terfilter dari ' + users.length + ')' : '') + '. Akun admin nggak bisa dihapus dari panel.';

    tbody.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        if (b.getAttribute('data-act') === 'edit') openModal(id);
        else deleteUser(id);
      });
    });
  }

  // ------------------------------------------------------------------
  // modal create/edit
  // ------------------------------------------------------------------
  function openModal(id) {
    editingId = id === undefined ? null : id;
    var u = editingId === null ? null : users.find(function (x) { return String(x.id) === String(editingId); });
    q('#modalTitle').textContent = editingId === null ? 'Create User' : 'Edit User';
    q('#mName').value = u ? (u.name || '') : '';
    q('#mEmail').value = u ? (u.email || '') : '';
    q('#mPassword').value = '';
    q('#mRole').value = u ? (u.role || 'user') : 'user';
    q('#mPwLabel').textContent = editingId === null ? 'Password' : 'New Password';
    q('#mPwOpt').textContent = editingId === null ? '*wajib' : '(kosong = tetap)';
    q('#modalBack').hidden = false;
    document.body.classList.add('modal-open');
    q('#mName').focus();
  }

  function closeModal() {
    q('#modalBack').hidden = true;
    document.body.classList.remove('modal-open');
    editingId = null;
  }

  function strongPw(pw) {
    return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
  }

  function saveModal(ev) {
    ev.preventDefault();
    var name = q('#mName').value.trim();
    var email = q('#mEmail').value.trim();
    var pw = q('#mPassword').value;
    var role = q('#mRole').value;

    if (!name || !email) { L.toast('Nama dan email wajib diisi', 'error'); return; }

    var btn = q('#mSave');
    btn.disabled = true;

    var req;
    if (editingId === null) {
      if (!strongPw(pw)) { L.toast('Password minimal 8 char, ada huruf besar, kecil, angka', 'error'); btn.disabled = false; return; }
      req = L.api('POST', '/api/users', { name: name, email: email, password: pw, role: role });
    } else {
      var body = { name: name, email: email, role: role };
      if (pw) {
        if (!strongPw(pw)) { L.toast('Password baru belum memenuhi syarat', 'error'); btn.disabled = false; return; }
        body.password = pw;
      }
      req = L.api('PUT', '/api/users/' + editingId, body);
    }

    req.then(function () {
      L.toast(editingId === null ? 'User dibuat' : 'User diperbarui', 'ok');
      closeModal();
      return loadUsers();
    }).catch(function (err) {
      L.toast(err.message || 'Gagal menyimpan', 'error');
    }).finally(function () { btn.disabled = false; });
  }

  function deleteUser(id) {
    var u = users.find(function (x) { return String(x.id) === String(id); });
    if (!u) return;
    if (u.role === 'admin') { L.toast('Akun admin nggak bisa dihapus dari panel', 'error'); return; }
    if (!window.confirm('Hapus permanen akun "' + (u.name || u.email) + '"? Nggak bisa dibatalkan.')) return;
    L.api('DELETE', '/api/users/' + id)
      .then(function () {
        L.toast('User dihapus', 'ok');
        return loadUsers();
      })
      .catch(function (err) { L.toast(err.message || 'Gagal menghapus', 'error'); });
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    if (!guard()) return;

    loadMe().then(function (m) {
      me = m;
      q('#denyView').hidden = true;
      q('#subnav').hidden = false;
      q('#adminView').hidden = false;
      q('#stAdmin').textContent = m.name || m.email || 'admin';
      q('#stAdminSub').textContent = 'Role: ' + (m.role || 'admin').toUpperCase();

      // health nyata dari server
      fetch('/api/health', { accept: 'application/json' })
        .then(function (r) { return r.json(); })
        .then(function (h) {
          var ok = h && h.database === 'connected';
          var el = q('#stDb');
          el.textContent = ok ? 'Connected' : 'Down';
          el.className = 'stat-card__value ' + (ok ? 'is-ok' : 'is-err');
        })
        .catch(function () {
          var el = q('#stDb');
          el.textContent = 'Down'; el.className = 'stat-card__value is-err';
        });

      return loadUsers();
    }).catch(function () {
      q('#denyView').hidden = false;
      q('#denyMsg').textContent = 'Sesi nggak valid. Login ulang pakai akun admin.';
    });

    q('#btnRefresh').addEventListener('click', function () { loadUsers(); L.toast('Telemetri dimuat ulang', 'ok'); });
    q('#btnAdd').addEventListener('click', function () { openModal(); });
    q('#mCancel').addEventListener('click', closeModal);
    q('#modalBack').addEventListener('click', function (ev) { if (ev.target === q('#modalBack')) closeModal(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !q('#modalBack').hidden) closeModal(); });
    q('#modalForm').addEventListener('submit', saveModal);
    q('#searchInput').addEventListener('input', renderUsers);
    q('#roleFilter').addEventListener('change', renderUsers);
  });
})();
