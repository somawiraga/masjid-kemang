(function () {
  // ---------- Prayer schedule ----------
  var CITY_ID = 1221; // KOTA BEKASI
  var LIVE_API = 'https://api.myquran.com/v2/sholat/jadwal/' + CITY_ID + '/';
  var FIELDS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  var TIME_RE = /^\d{2}:\d{2}$/;
  var ORDER = [
    { key: 'imsak', label: 'Imsak' },
    { key: 'subuh', label: 'Subuh' },
    { key: 'terbit', label: 'Syuruq' },
    { key: 'dzuhur', label: 'Dzuhur' },
    { key: 'ashar', label: 'Ashar' },
    { key: 'maghrib', label: 'Maghrib' },
    { key: 'isya', label: 'Isya' }
  ];

  var card = document.getElementById('prayer-card');
  var miniSlots = document.querySelectorAll('[data-mini]');
  if (!card && !miniSlots.length) return;

  var $ = function (id) { return document.getElementById(id); };
  var slots = document.querySelectorAll('[data-prayer]');
  var monthCache = {};   // "YYYY-MM" -> Promise<{date: day}>
  var today = null;      // { date, times }
  var tomorrow = null;   // same shape or null
  var loadedDate = null;
  var tick = null;
  var currentKey = null;

  // ----- time helpers (WIB = UTC+7, independent of the visitor's timezone) -----
  function pad(n) { return String(n).padStart(2, '0'); }
  function nowWIB() {
    var d = new Date(Date.now() + 7 * 3600000);
    return {
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      seconds: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(),
      utc: d
    };
  }
  function dateStr(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function addDays(y, m, d, n) {
    var t = new Date(Date.UTC(y, m - 1, d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function toSeconds(hhmm) { var p = hhmm.split(':'); return +p[0] * 3600 + +p[1] * 60; }

  // ----- data loading -----
  function validDay(day) {
    return day && FIELDS.every(function (f) { return TIME_RE.test(day[f] || ''); });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // Month file produced by scripts/fetch-jadwal.mjs
  function loadMonth(y, m) {
    var key = y + '-' + pad(m);
    if (!monthCache[key]) {
      monthCache[key] = fetchJson('data/jadwal-' + key + '.json').then(function (json) {
        var map = {};
        (json.days || []).forEach(function (day) { if (validDay(day)) map[day.date] = day; });
        return map;
      }).catch(function () { return {}; });
    }
    return monthCache[key];
  }

  // Live MyQuran call, used only when the local file is missing the day
  function loadLive(y, m, d) {
    return fetchJson(LIVE_API + y + '/' + pad(m) + '/' + pad(d)).then(function (json) {
      var day = json && json.status === true && json.data && json.data.jadwal;
      if (!validDay(day)) throw new Error('Bad response');
      return day;
    });
  }

  function getDay(y, m, d) {
    var key = dateStr(y, m, d);
    return loadMonth(y, m).then(function (map) {
      return map[key] || loadLive(y, m, d);
    });
  }

  // ----- UI state -----
  function setState(state) {
    if (card) card.dataset.state = state; // loading | ready | error
  }

  function setMini(times) {
    miniSlots.forEach(function (el) {
      var key = el.dataset.mini;
      el.querySelector('span').textContent = times ? times[key] + ' WIB' : '--:--';
    });
  }

  function renderDate(now) {
    var el = $('date-line');
    if (!el) return;
    var fmt = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    el.textContent = fmt.format(new Date(Date.UTC(now.y, now.m - 1, now.d))) + ' • Waktu Indonesia Barat (WIB)';
  }

  function renderTimes() {
    slots.forEach(function (el) {
      el.querySelector('.slot-time').textContent = today.times[el.dataset.prayer];
    });
    setMini(today.times);
  }

  // Next prayer relative to now; after Isya it rolls over to tomorrow's Imsak
  function findNext(now) {
    for (var i = 0; i < ORDER.length; i++) {
      var t = toSeconds(today.times[ORDER[i].key]);
      if (t > now.seconds) return { item: ORDER[i], time: today.times[ORDER[i].key], remaining: t - now.seconds };
    }
    var src = (tomorrow || today).times.imsak;
    return { item: ORDER[0], time: src, remaining: 86400 - now.seconds + toSeconds(src) };
  }

  function render() {
    var now = nowWIB();
    if (loadedDate !== dateStr(now.y, now.m, now.d)) { load(); return; } // day rolled over
    if (!today || !card) return;

    var next = findNext(now);
    $('cd-h').textContent = pad(Math.floor(next.remaining / 3600));
    $('cd-m').textContent = pad(Math.floor((next.remaining % 3600) / 60));
    $('cd-s').textContent = pad(next.remaining % 60);
    $('next-name').textContent = next.item.label + ' — ' + next.time + ' WIB';

    if (next.item.key !== currentKey) {
      currentKey = next.item.key;
      slots.forEach(function (el) { el.classList.toggle('active', el.dataset.prayer === currentKey); });
      miniSlots.forEach(function (el) {
        var active = el.dataset.mini === currentKey;
        el.classList.toggle('active', active);
        el.querySelector('small').textContent = el.dataset.label + (active ? ' (Berikutnya)' : '');
      });
    }
  }

  function fail() {
    today = null;
    clearInterval(tick);
    tick = null;
    setState('error');
    setMini(null);
    miniSlots.forEach(function (el) {
      el.classList.remove('active');
      el.querySelector('small').textContent = el.dataset.label;
    });
  }

  function load() {
    var now = nowWIB();
    var date = dateStr(now.y, now.m, now.d);
    var next = addDays(now.y, now.m, now.d, 1);
    setState('loading');
    renderDate(now);
    clearInterval(tick);

    getDay(now.y, now.m, now.d).then(function (day) {
      today = { date: date, times: day };
      loadedDate = date;
      currentKey = null;
      renderTimes();
      setState('ready');
      render();
      tick = setInterval(render, 1000);
      // Tomorrow is only needed after Isya, so a failure here is not fatal
      return getDay(next.y, next.m, next.d).then(function (d) { tomorrow = { times: d }; }, function () { tomorrow = null; });
    }).catch(fail);
  }

  var retry = $('prayer-retry');
  if (retry) {
    retry.addEventListener('click', function () {
      monthCache = {};
      load();
    });
  }

  load();
})();
