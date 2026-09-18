/* Lcode Api — shell.js
   Kerangka UI: header sticky, menu, footer, state login, toast.
   Nggak ada framework — vanilla, kecil, tanpa dependency.
*/
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // State auth (satu sumber: sessionStorage 'lcode.token')
  // ------------------------------------------------------------------
  var TOKEN_KEY = 'lcode.token';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage bisa diblokir — abaikan */ }
  }

  // decode payload JWT tanpa verifikasi (cuma buat UI; server tetap cek asli)
  function parseJwt(tok) {
    if (!tok) return null;
    try {
      var p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // fetch helper dengan bearer otomatis
  function api(method, path, body) {
    var headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    var tok = getToken();
    if (tok) headers.authorization = 'Bearer ' + tok;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  var toastEl = null;
  var toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (kind ? ' is-' + kind : '');
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3500);
  }

  // ------------------------------------------------------------------
  // Ikon (lucide-style, inline SVG)
  // ------------------------------------------------------------------
  var ICO = {
    menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    terminal: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
    book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    layout: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'
  };
  function icon(name, cls) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="' + (cls || '') + '" aria-hidden="true">' + (ICO[name] || '') + '</svg>';
  }

  // ------------------------------------------------------------------
  // Header
  // ------------------------------------------------------------------
  function buildHeader() {
    var el = document.getElementById('siteHeader');
    if (!el) return;
    var payload = parseJwt(getToken());
    var logged = !!payload;
    var isAdmin = payload && payload.role === 'admin';
    el.innerHTML =
      '<div class="wrap site-header__inner">' +
        '<a class="brand" href="/"><img class="brand__logo" src="/maskot.png" alt="Lcode Api mascot">' +
          '<span class="brand__name">Lcode</span><span class="brand__tag">API</span></a>' +
        '<nav class="main-nav" aria-label="Utama">' +
          '<a href="/#features">Features</a>' +
          '<a href="/#architecture">Architecture</a>' +
          '<a href="/explore">Playground</a>' +
          '<a href="/docs">Documentation</a>' +
        '</nav>' +
        '<div class="header-actions">' +
          (logged
            ? '<div class="header-user is-in">' +
                '<span class="header-user__avatar">' + esc((payload.name || payload.email || '?').charAt(0)) + '</span>' +
                '<span>' + esc(payload.name || payload.email || '') + '</span>' +
                '<span class="header-user__role' + (isAdmin ? '' : ' is-user') + '">' + (isAdmin ? 'ADMIN' : 'USER') + '</span>' +
              '</div>' +
              '<button class="btn btn--ghost" data-action="logout">Sign out</button>' +
              '<a href="/profile"><button class="btn btn--primary">Profile</button></a>'
            : '<a href="/profile"><button class="btn btn--ghost">Sign in</button></a>' +
              '<a href="/profile?mode=register"><button class="btn btn--primary">Get Started</button></a>') +
        '</div>' +
        '<button class="mobile-toggle" data-action="toggle-menu" aria-label="Toggle menu">' + icon('menu', 'w-5 h-5') + '</button>' +
      '</div>' +
      '<div class="mobile-menu" data-el="mobileMenu">' +
        '<a href="/#features">Features</a><a href="/#architecture">Architecture</a>' +
        '<a href="/explore">Playground</a><a href="/docs">Documentation</a>' +
        (logged
          ? '<a href="/profile">Profile</a>' + (isAdmin ? '<a href="/admin">Admin Panel</a>' : '') + '<a href="#" data-action="logout">Sign out</a>'
          : '<a href="/profile">Sign in</a><a href="/profile?mode=register">Get Started</a>') +
      '</div>';

    el.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-action]');
      if (!t) return;
      if (t.getAttribute('data-action') === 'toggle-menu') {
        var mm = el.querySelector('[data-el="mobileMenu"]');
        if (mm) mm.classList.toggle('is-open');
      }
      if (t.getAttribute('data-action') === 'logout') {
        ev.preventDefault();
        setToken('');
        window.location.href = '/';
      }
    });
  }

  // ------------------------------------------------------------------
  // Footer
  // ------------------------------------------------------------------
  function buildFooter() {
    var el = document.getElementById('siteFooter');
    if (!el) return;
    el.innerHTML =
      '<div class="wrap">' +
        '<div class="site-footer__grid">' +
          '<div class="site-footer__brand">' +
            '<div class="site-footer__brandrow">' +
              '<img class="site-footer__logo" src="/maskot.png" alt="Lcode Api">' +
              '<span class="site-footer__name">Lcode Api</span>' +
              '<span class="site-footer__op"><span class="dot dot--green"></span>Operational</span>' +
            '</div>' +
            '<p class="site-footer__desc">REST API platform gratis dengan autentikasi JWT, database PostgreSQL, role-based access control, dan dokumentasi OpenAPI. Katalog downloader media siap pakai.</p>' +
            '<div class="site-footer__tech">' +
              '<span>' + icon('server', 'w-3.5 h-3.5') + ' Node.js</span>' +
              '<span>' + icon('db', 'w-3.5 h-3.5') + ' PostgreSQL</span>' +
              '<span style="color:var(--green)">' + icon('shieldCheck', 'w-3.5 h-3.5') + ' JWT RBAC</span>' +
            '</div>' +
          '</div>' +
          '<div class="site-footer__col"><h4>Resources</h4><ul>' +
            '<li><a href="/docs">API Documentation</a></li>' +
            '<li><a href="/explore">API Playground</a></li>' +
            '<li><a href="/profile">System Health</a></li>' +
          '</ul></div>' +
          '<div class="site-footer__col"><h4>Technology</h4><ul>' +
            '<li><a href="/#features">Features</a></li>' +
            '<li><a href="/#architecture">Architecture</a></li>' +
            '<li><a href="/profile#pricing">Pricing</a></li>' +
          '</ul></div>' +
        '</div>' +
        '<div class="site-footer__bottom">' +
          '<span>&copy; ' + new Date().getFullYear() + ' Lcode Api. Engineered for Developer Infrastructure.</span>' +
          '<span>REST API Architecture v1.0.0</span>' +
        '</div>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // Sub-nav (tab dalam) — dipakai halaman app: explore/docs/profile/admin
  // ------------------------------------------------------------------
  function buildSubnav() {
    var el = document.getElementById('subnav');
    if (!el) return;
    var active = el.getAttribute('data-active') || '';
    var payload = parseJwt(getToken());
    var isAdmin = payload && payload.role === 'admin';
    el.innerHTML =
      '<div class="wrap subnav__inner">' +
        '<div class="subnav__tabs">' +
          tab('/profile', 'layout', 'Overview', active === 'overview') +
          tab('/explore', 'terminal', 'API Playground', active === 'playground') +
          tab('/docs', 'book', 'Documentation', active === 'docs') +
          tab('/profile?tab=account', 'user', 'Profile', active === 'profile') +
          (isAdmin
            ? '<div class="subnav__divider"></div><span class="subnav__label">Admin:</span>' +
              tab('/admin', 'shield', 'Admin Overview', active === 'admin') +
              tab('/admin?tab=users', 'users', 'Users Management', active === 'admin-users') +
              tab('/admin?tab=db', 'db', 'Database Master', active === 'admin-db')
            : '') +
        '</div>' +
        '<div class="subnav__status">' +
          '<div class="status-pill">' + icon('activity', 'w-3.5 h-3.5') +
            '<span>DB:</span><span class="status-pill__value" data-el="dbStatus"><span class="dot dot--green"></span> Checking…</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    function tab(href, ic, label, isActive) {
      return '<a class="subnav__tab' + (isActive ? ' is-active' : '') + '" href="' + href + '">' + icon(ic, 'w-3.5 h-3.5') + '<span>' + label + '</span></a>';
    }

    // status DB real: ping endpoint publik (nggak karangan — respons server asli)
    fetch('/api/health', { accept: 'application/json' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var v = el.querySelector('[data-el="dbStatus"]');
        if (!v) return;
        var dbOk = res.ok && res.j && (res.j.database === 'connected' || res.j.status === 'ok' || res.j.status === 'healthy');
        v.className = 'status-pill__value' + (dbOk ? '' : ' is-down');
        v.innerHTML = '<span class="dot dot--' + (dbOk ? 'green' : '') + '" style="' + (dbOk ? '' : 'background:var(--red)') + '"></span>' + (dbOk ? 'Connected' : 'Down');
      })
      .catch(function () {
        var v = el.querySelector('[data-el="dbStatus"]');
        if (v) { v.className = 'status-pill__value is-down'; v.innerHTML = '<span class="dot" style="background:var(--red)"></span> Down'; }
      });
  }

  // ------------------------------------------------------------------
  // Reveal on scroll (ringan, opacity/transform saja)
  // ------------------------------------------------------------------
  function initReveal() {
    var els = document.querySelectorAll('.rv');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  // ------------------------------------------------------------------
  // Bottom nav (mobile) — floating pill: Home, Docs, API, Profil
  // ------------------------------------------------------------------
  function buildBottomNav() {
    var el = document.getElementById('bottomNav');
    if (!el) return;
    var active = el.getAttribute('data-active') || '';
    var items = [
      { id: 'home', href: '/', ic: 'layout', label: 'Home' },
      { id: 'docs', href: '/docs', ic: 'book', label: 'Docs' },
      { id: 'api', href: '/explore', ic: 'terminal', label: 'API' },
      { id: 'profile', href: '/profile', ic: 'user', label: 'Profil' }
    ];
    el.innerHTML = items.map(function (it) {
      return '<a class="bottom-nav__item' + (active === it.id ? ' is-active' : '') + '" href="' + it.href + '" aria-label="' + it.label + '">' +
        icon(it.ic) + '<span>' + it.label + '</span></a>';
    }).join('');
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    buildHeader();
    buildFooter();
    buildSubnav();
    buildBottomNav();
    initReveal();
  });

  // expose untuk halaman lain
  window.Lcode = {
    getToken: getToken,
    setToken: setToken,
    parseJwt: parseJwt,
    api: api,
    toast: toast,
    esc: esc,
    icon: icon,
    ICO: ICO
  };
})();
