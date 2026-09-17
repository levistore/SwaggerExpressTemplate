/* Lcode Api — home.js
   Satu-satunya angka di halaman ini datang dari API yang sama. Nggak ada
   angka tempelan. Kalau API-nya nggak bisa dihubungi, yang tampil "—". */
(function () {
  'use strict';
  var L = window.Lcode;

  function setLive(state, text) {
    var wrap = L.$('liveStatus');
    if (wrap) {
      // Pakai classList, JANGAN timpa className — menimpa akan menghapus
      // kelas 'is-in' dari observer reveal, dan elemen ini selamanya
      // opacity:0 alias nggak pernah kelihatan.
      wrap.classList.add('live');
      wrap.classList.remove('is-ok', 'is-err');
      if (state) wrap.classList.add('is-' + state);
    }
    var t = L.$('liveText');
    if (t) t.textContent = text;
  }

  function blank() {
    ['statUsers', 'statBigUsers', 'statLatency'].forEach(function (id) {
      var el = L.$(id);
      if (el) el.textContent = '—';
    });
  }

  L.api('/api/users')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);

      var d = r.data;
      var list = Array.isArray(d) ? d
        : (d && Array.isArray(d.data)) ? d.data
        : (d && Array.isArray(d.users)) ? d.users : [];
      var n = list.length;

      var su = L.$('statUsers'), sb = L.$('statBigUsers'), sl = L.$('statLatency');
      if (su) su.textContent = n;
      if (sb) sb.textContent = n;
      if (sl) sl.textContent = r.ms + ' ms';

      setLive('ok', 'API online — ' + n + ' user terbaca dalam ' + r.ms + ' ms');
    })
    .catch(function () {
      blank();
      setLive('err', 'Nggak bisa menghubungi API dari browser ini');
    });
})();
