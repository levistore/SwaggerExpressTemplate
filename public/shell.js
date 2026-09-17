/* ==========================================================================
   Lcode Api — shell.js
   Perilaku bersama SEMUA halaman: nav, drawer, reveal, toast, salin, sorot
   kartu, penyimpanan token, dan pembungkus fetch ke API.

   Tanpa dependency. Nggak ada yang dijalankan di sini yang bikin halaman
   error kalau elemennya nggak ada — tiap init() keluar sendiri kalau
   targetnya nggak ketemu.
   ========================================================================== */
(function () {
  'use strict';

  var TOKEN_KEY = 'lcode.token';

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ *
   * Salin ke clipboard (dengan fallback untuk konteks nggak aman)
   * ------------------------------------------------------------------ */
  function copyText(text, label) {
    var done = function () { toast(label || 'Tersalin'); };

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

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
  }

  function initCopy() {
    var btns = document.querySelectorAll('[data-copy-target]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var el = $(this.getAttribute('data-copy-target'));
        if (el) copyText(el.textContent.trim(), this.getAttribute('data-copy-label') || 'Tersalin');
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Reveal saat masuk viewport — stagger dari data-delay
   * ------------------------------------------------------------------ */
  function initReveal() {
    var nodes = document.querySelectorAll('[data-reveal]');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // pindah halaman dari drawer: tutup dulu, jangan biarkan kebuka
    panel.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') close(false);
    });

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
   * Sorot kartu mengikuti kursor (dipakai ::after di .card)
   * ------------------------------------------------------------------ */
  function initCardGlow() {
    if (!window.matchMedia('(hover: hover)').matches) return;
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('pointermove', function (e) {
        var r = this.getBoundingClientRect();
        this.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        this.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Token — sessionStorage default, localStorage kalau "ingat saya"
   * ------------------------------------------------------------------ */
  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) { return ''; }
  }

  function setToken(token, persist) {
    try {
      if (persist) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) { /* mode privat — token tetap ada di memori halaman ini */ }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* abaikan */ }
  }

  /* Di mana token-nya sekarang disimpan? Dipakai halaman profile buat
     nunjukin ke pengguna seberapa lama sesinya bertahan. */
  function tokenWhere() {
    try {
      if (localStorage.getItem(TOKEN_KEY)) return 'local';
      if (sessionStorage.getItem(TOKEN_KEY)) return 'session';
    } catch (e) { /* mode privat */ }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * Baca payload JWT TANPA verifikasi.
   * Cuma buat nampilin info ke pemilik token — server tetap yang
   * memutuskan valid atau nggak. Jangan pakai ini buat otorisasi.
   * ------------------------------------------------------------------ */
  function decodeJwt(token) {
    try {
      var part = String(token).split('.')[1];
      if (!part) return null;
      part = part.replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      var bin = atob(part);
      var bytes = [];
      for (var i = 0; i < bin.length; i++) {
        bytes.push('%' + ('00' + bin.charCodeAt(i).toString(16)).slice(-2));
      }
      return JSON.parse(decodeURIComponent(bytes.join('')));
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * Pembungkus fetch — selalu balikin objek yang bentuknya sama,
   * jadi pemanggil nggak perlu mikirin res.json() gagal atau nggak.
   * ------------------------------------------------------------------ */
  function api(path, opts) {
    opts = opts || {};
    var headers = { accept: 'application/json' };
    if (opts.headers) {
      for (var k in opts.headers) {
        if (Object.prototype.hasOwnProperty.call(opts.headers, k)) headers[k] = opts.headers[k];
      }
    }
    if (opts.token) {
      headers.Authorization = /^Bearer\s/i.test(opts.token) ? opts.token : 'Bearer ' + opts.token;
    }

    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body !== undefined && opts.body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }

    var t0 = performance.now();
    return fetch(path, init).then(function (res) {
      var ms = Math.round(performance.now() - t0);
      return res.text().then(function (txt) {
        var data = null, isJson = true;
        try { data = txt ? JSON.parse(txt) : null; }
        catch (e) { isJson = false; data = txt; }
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          ms: ms,
          data: data,
          isJson: isJson,
          raw: txt
        };
      });
    });
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    initReveal();
    initNav();
    initScrollState();
    initCopy();
    initCardGlow();
  }

  window.Lcode = {
    $: $,
    toast: toast,
    copy: copyText,
    api: api,
    decodeJwt: decodeJwt,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    tokenWhere: tokenWhere,
    boot: boot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
