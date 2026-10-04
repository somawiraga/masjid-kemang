// Fills the "Kajian Sunnah Ilmiah" cards from data/youtube.json
// (written by scripts/fetch-youtube.mjs via the scheduled GitHub Action).
(function () {
  var cards = document.querySelectorAll('.kajian-card[data-slot]');
  if (!cards.length) return;

  function timeAgo(iso) {
    var diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    var units = [[31536000, 'tahun'], [2592000, 'bulan'], [604800, 'minggu'], [86400, 'hari'], [3600, 'jam'], [60, 'menit']];
    for (var i = 0; i < units.length; i++) {
      if (diff >= units[i][0]) return Math.floor(diff / units[i][0]) + ' ' + units[i][1] + ' lalu';
    }
    return 'baru saja';
  }

  function fill(card, v) {
    var f = function (name) { return card.querySelector('[data-field="' + name + '"]'); };
    var thumbLink = card.querySelector('.video-thumb');
    var img = f('thumb');
    img.src = v.thumbnail;
    img.alt = v.title;
    img.onerror = function () { img.onerror = null; img.src = 'assets/images/kajian-sabtu.jpg'; };
    thumbLink.href = v.url;
    thumbLink.setAttribute('aria-label', 'Tonton: ' + v.title);
    f('title').textContent = v.title;
    f('views').textContent = 'Ditonton ' + (v.views || 0).toLocaleString('id-ID') + ' kali';
    f('meta').textContent = 'Dipublikasikan ' + timeAgo(v.published);
    card.querySelector('.kajian-body').dataset.state = 'ready';
  }

  fetch('data/youtube.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (data) {
      cards.forEach(function (card) {
        var v = data.slots && data.slots[card.dataset.slot];
        if (v && v.id && v.title && v.url && v.published) fill(card, v);
      });
    })
    .catch(function () { /* keep the static fallback (link to the channel) */ });
})();
