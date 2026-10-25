/* "Minu tööajad": Ilvi's phone page for opening/closing days, hours and short-notice requests. */
(function () {
  'use strict';

  var S = window.PargiSlots;
  var cfg = window.PARGI_BOOKING || {};
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = cfg.apiUrl || (LOCAL ? '/api' : '');
  var KEY = 'pargi-haldus-session';
  var WD = ['', 'E', 'T', 'K', 'N', 'R', 'L', 'P'];
  var WD_LONG = ['', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev', 'Pühapäev'];
  var MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];
  var PRESETS = [
    { label: 'Hommik', ranges: [['09:30', '14:00']] },
    { label: 'Pärastlõuna', ranges: [['14:00', '20:00']] },
  ];

  var state = { session: null, data: null, loadedAt: 0, expanded: {} };

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function hm(t) { return t.replace(/^0/, ''); } // '09:30' -> '9:30'
  function rangesText(ranges) {
    return ranges.length ? ranges.map(function (r) { return hm(r[0]) + '–' + hm(r[1]); }).join(', ') : 'Suletud';
  }
  function dateShort(d) { return Number(d.slice(8)) + '.' + Number(d.slice(5, 7)); }
  function dateLong(d) { return Number(d.slice(8)) + '. ' + MONTHS[Number(d.slice(5, 7)) - 1]; }
  function isoDow(d) { return S.localParts(S.localToUtc(d, '12:00')).isoDow; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
  /** '+37251112222' -> '5111 2222'; foreign numbers stay as they are. */
  function phoneText(p) {
    var m = /^\+372(\d{7,8})$/.exec(String(p || ''));
    if (!m) return String(p || '');
    return m[1].length === 8 ? m[1].slice(0, 4) + ' ' + m[1].slice(4) : m[1].slice(0, 3) + ' ' + m[1].slice(3);
  }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg || '';
    t.className = 'adm-toast' + (kind ? ' is-' + kind : '');
    clearTimeout(toastTimer);
    if (msg && kind === 'ok') toastTimer = setTimeout(function () { t.textContent = ''; t.className = 'adm-toast'; }, 2500);
  }

  function api(params) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 60000);
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(params),
      signal: ctrl && ctrl.signal,
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /** Admin call with the stored session; an expired session sends her back to login. */
  function adminApi(params) {
    params.s = state.session;
    return api(params).then(function (r) {
      if (r.error === 'unauthorized') {
        logout('Palun logi uuesti sisse.');
        throw new Error('unauthorized');
      }
      return r;
    });
  }

  function saveError(err) {
    if (err && err.message === 'unauthorized') return;
    toast('Ei õnnestunud. Kontrolli internetiühendust ja proovi uuesti.', 'error');
  }

  var VIEWS = ['v-login', 'v-request', 'v-main', 'v-offline'];
  function view(id) {
    VIEWS.forEach(function (v) { $(v).hidden = v !== id; });
    $('refresh-btn').hidden = id !== 'v-main';
  }

  // ---------- session ----------

  function loadSession() {
    try { state.session = localStorage.getItem(KEY); } catch (e) { state.session = null; }
  }

  function logout(msg) {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    state.session = null;
    state.data = null;
    view('v-login');
    $('login-sent').hidden = true;
    $('login-btn').disabled = false;
    toast(msg || '', msg ? 'warn' : '');
  }

  $('login-btn').addEventListener('click', function () {
    var btn = $('login-btn');
    btn.disabled = true;
    api({ action: 'admin_login_request' }).then(function () {
      $('login-sent').hidden = false;
      toast('');
    }).catch(function () {
      btn.disabled = false;
      toast('Ühendus katkes. Proovi uuesti.', 'error');
    });
  });

  $('logout-btn').addEventListener('click', function () { logout(''); });

  function exchangeLogin(token) {
    view('v-login');
    toast('Login sisse…');
    return api({ action: 'admin_session', login: token }).then(function (r) {
      if (!r.ok) {
        toast('See link on aegunud või juba kasutatud. Küsi uus link.', 'warn');
        return;
      }
      try { localStorage.setItem(KEY, r.session); } catch (e) { /* private mode: works until the tab closes */ }
      state.session = r.session;
      toast('Oled sisse logitud.', 'ok');
      loadMain();
    }).catch(function () { toast('Ühendus katkes. Ava link uuesti.', 'error'); });
  }

  // ---------- main ----------

  function loadMain() {
    view('v-main');
    if (!state.data) $('days').innerHTML = '<p class="adm-muted">Laen…</p>';
    return adminApi({ action: 'admin_overview' }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      state.data = r;
      state.loadedAt = Date.now();
      render();
    }).catch(function (err) {
      if (err && err.message === 'unauthorized') return;
      toast('Andmeid ei õnnestunud laadida. Vajuta ↻ uuesti.', 'error');
    });
  }

  $('refresh-btn').addEventListener('click', function () { toast(''); loadMain(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.session && !$('v-main').hidden && Date.now() - state.loadedAt > 120000) loadMain();
  });

  function render() {
    renderPending();
    renderDays();
    renderWeekly();
    var today = state.data.today;
    var last = state.data.days[state.data.days.length - 1].date;
    ['vac-from', 'vac-to'].forEach(function (id) { $(id).min = today; $(id).max = last; });
  }

  function dayByDate(date) {
    return state.data.days.filter(function (d) { return d.date === date; })[0];
  }

  /** Default hours for a weekday, or the "open a closed day" hours. */
  function openHoursFor(date) {
    var w = state.data.weekly[isoDow(date)];
    return w && w.length ? w : state.data.openDefault;
  }

  // ---------- pending requests ----------

  function bookingLines(b) {
    return [
      el('div', { class: 'adm-req-when', text: WD_LONG[isoDow(b.date)] + ', ' + dateLong(b.date) + ' kell ' + hm(b.time) + '–' + hm(b.end) }),
      el('div', { class: 'adm-req-what', text: b.service }),
      el('div', {}, [b.name, ' · ', el('a', { href: telHref(b.phone), text: phoneText(b.phone) })]),
      el('div', { class: 'adm-muted', text: b.email }),
      b.comment ? el('div', { class: 'adm-req-comment', text: '„' + b.comment + '“' }) : null,
    ];
  }

  function decide(b, decision, params, onDone) {
    if (decision === 'decline' && !confirm('Lükkan soovi tagasi? ' + b.name + ' saab e-kirja, et see aeg ei sobi.')) return Promise.resolve();
    toast(decision === 'approve' ? 'Kinnitan…' : 'Lükkan tagasi…');
    var call = params.t ? api(Object.assign({ action: 'admin_decide', id: b.id, decision: decision }, params))
      : adminApi({ action: 'admin_decide', id: b.id, decision: decision });
    return call.then(function (r) {
      if (r.ok) {
        toast(decision === 'approve' ? 'Kinnitatud. Klient sai kinnituse e-postile.' : 'Tagasi lükatud. Klient sai teate.', 'ok');
        onDone(decision);
      } else if (r.error === 'not_pending' || r.error === 'not_found') {
        toast('Seda soovi enam pole (juba otsustatud, tagasi võetud või aegunud).', 'warn');
        onDone(null);
      } else {
        toast('Ei õnnestunud. Proovi uuesti.', 'error');
      }
    }).catch(saveError);
  }

  function renderPending() {
    var box = $('pending');
    box.innerHTML = '';
    var list = state.data.pending;
    if (!list.length) return;
    box.appendChild(el('h2', { class: 'adm-pending-h', text: plural(list.length, 'soov ootab', 'soovi ootavad') + ' kinnitust' }));
    list.forEach(function (b) {
      var card = el('div', { class: 'adm-card adm-req' }, bookingLines(b));
      card.appendChild(el('div', { class: 'adm-actions' }, [
        el('button', { type: 'button', class: 'adm-btn primary', text: 'Kinnita', onclick: function () { decide(b, 'approve', {}, applyDecision(b)); } }),
        el('button', { type: 'button', class: 'adm-btn', text: 'Lükka tagasi', onclick: function () { decide(b, 'decline', {}, applyDecision(b)); } }),
      ]));
      box.appendChild(card);
    });
  }

  function applyDecision(b) {
    return function (decision) {
      state.data.pending = state.data.pending.filter(function (p) { return p.id !== b.id; });
      var day = dayByDate(b.date);
      if (day) {
        day.bookings = day.bookings.filter(function (x) { return x.id !== b.id || decision === 'approve'; });
        day.bookings.forEach(function (x) { if (x.id === b.id) x.pending = false; });
      }
      render();
    };
  }

  // ---------- days ----------

  function weekLabel(monday, today) {
    var thisMonday = S.addDays(today, 1 - isoDow(today));
    if (monday === thisMonday) return 'See nädal';
    if (monday === S.addDays(thisMonday, 7)) return 'Järgmine nädal';
    var sunday = S.addDays(monday, 6);
    var sameMonth = monday.slice(5, 7) === sunday.slice(5, 7);
    return (sameMonth ? Number(monday.slice(8)) + '.' : dateLong(monday)) + '–' + dateLong(sunday);
  }

  function renderDays() {
    var box = $('days');
    box.innerHTML = '';
    var today = state.data.today;
    var currentWeek = null;
    var list = null;
    state.data.days.forEach(function (day) {
      var monday = S.addDays(day.date, 1 - day.isoDow);
      if (monday !== currentWeek) {
        currentWeek = monday;
        box.appendChild(el('h3', { class: 'adm-week', text: weekLabel(monday, today) }));
        list = el('ul', { class: 'adm-days' });
        box.appendChild(list);
      }
      list.appendChild(dayRow(day, today));
    });
  }

  function dayRow(day, today) {
    var open = day.ranges.length > 0;
    var blocked = day.allDay.length > 0;
    var n = day.bookings.length;
    var label = WD[day.isoDow] + ' ' + dateShort(day.date);
    var meta = [];
    if (n) meta.push(plural(n, 'broneering', 'broneeringut'));
    if (day.bookings.some(function (b) { return b.pending; })) meta.push('ootab kinnitust');
    if (day.other.length) meta.push(plural(day.other.length, 'muu sündmus', 'muud sündmust'));
    if (blocked) meta.push('kalendris terve päev: ' + day.allDay.join(', '));
    if (day.holiday && day.source !== 'override') meta.push('riigipüha');
    else if (day.source === 'override') meta.push('muudetud');

    var li = el('li', { class: 'adm-day' + (open && !blocked ? ' is-open' : ' is-closed') + (day.date === today ? ' is-today' : '') });
    var expanded = !!state.expanded[day.date];
    var main = el('button', { type: 'button', class: 'adm-day-main', 'aria-expanded': expanded ? 'true' : 'false',
      onclick: function () { state.expanded[day.date] = !state.expanded[day.date]; renderDays(); } }, [
      el('span', { class: 'adm-day-date' }, [el('b', { text: WD[day.isoDow] }), ' ' + dateShort(day.date)]),
      el('span', { class: 'adm-day-info' }, [
        el('span', { class: 'adm-day-hours', text: blocked && open ? 'Kinni' : rangesText(day.ranges) }),
        meta.length ? el('span', { class: 'adm-day-meta', text: meta.join(' · ') }) : null,
      ]),
    ]);
    var sw = el('button', { type: 'button', role: 'switch', class: 'adm-switch', 'aria-checked': open ? 'true' : 'false',
      'aria-label': label + (open ? ' avatud' : ' suletud'),
      onclick: function () { setDay(day, open ? [] : openHoursFor(day.date)); } }, [el('span', { class: 'adm-switch-knob' })]);
    li.appendChild(el('div', { class: 'adm-day-top' }, [main, sw]));
    if (expanded) li.appendChild(dayDetail(day));
    return li;
  }

  function timeOptions(select, value) {
    for (var m = 7 * 60; m <= 22 * 60; m += 15) {
      var t = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
      select.appendChild(el('option', { value: t, text: hm(t), selected: t === value }));
    }
  }

  function hoursEditor(ranges, onSave, extraButtons) {
    var r = ranges[0] || ['09:30', '20:00'];
    var from = el('select', { 'aria-label': 'Algus' });
    var to = el('select', { 'aria-label': 'Lõpp' });
    timeOptions(from, r[0]);
    timeOptions(to, r[1]);
    var wrap = el('div', { class: 'adm-hours' }, [
      el('div', { class: 'adm-hours-row' }, [el('label', {}, ['Algus ', from]), el('label', {}, ['Viimane klient lõpetab ', to])]),
    ]);
    var chips = el('div', { class: 'adm-chips' });
    PRESETS.concat([{ label: 'Terve päev', ranges: state.data.openDefault }]).forEach(function (p) {
      chips.appendChild(el('button', { type: 'button', class: 'adm-chip', text: p.label + ' ' + rangesText(p.ranges),
        onclick: function () { from.value = p.ranges[0][0]; to.value = p.ranges[0][1]; } }));
    });
    wrap.appendChild(chips);
    var actions = el('div', { class: 'adm-actions' }, [
      el('button', { type: 'button', class: 'adm-btn primary', text: 'Salvesta kellaajad', onclick: function () {
        if (from.value >= to.value) { toast('Algus peab olema enne lõppu.', 'warn'); return; }
        onSave([[from.value, to.value]]);
      } }),
    ].concat(extraButtons || []));
    wrap.appendChild(actions);
    return wrap;
  }

  function dayDetail(day) {
    var box = el('div', { class: 'adm-day-detail' });
    var extra = [];
    if (day.source === 'override') {
      var def = (state.data.weekly[day.isoDow] || []);
      extra.push(el('button', { type: 'button', class: 'adm-btn', text: 'Taasta tavaline (' + rangesText(def).toLowerCase() + ')',
        onclick: function () { setDay(day, null); } }));
    }
    if (day.allDay.length) {
      box.appendChild(el('p', { class: 'adm-note', text: 'Sinu kalendris on terve päeva sündmus (' + day.allDay.join(', ') +
        '), seega on päev veebis kinni. Ava päev, kustutades selle sündmuse kalendrist.' }));
    }
    var items = day.bookings.map(function (b) {
      return el('li', { class: b.pending ? 'is-pending' : '' }, [
        el('span', { class: 'adm-time', text: hm(b.time) + '–' + hm(b.end) }),
        el('span', {}, [b.service + ' · ' + b.name + ' · ', el('a', { href: telHref(b.phone), text: phoneText(b.phone) }),
          b.pending ? el('em', { text: ' (ootab kinnitust)' }) : null]),
      ]);
    }).concat(day.other.map(function (o) {
      return el('li', { class: 'is-other' }, [el('span', { class: 'adm-time', text: hm(o.time) + '–' + hm(o.end) }), el('span', { text: o.summary })]);
    }));
    items.sort(function (a, b) { return a.firstChild.textContent.localeCompare(b.firstChild.textContent, 'et', { numeric: true }); });
    box.appendChild(items.length ? el('ul', { class: 'adm-events' }, items) : el('p', { class: 'adm-muted', text: 'Sel päeval broneeringuid pole.' }));
    box.appendChild(hoursEditor(day.ranges, function (ranges) { setDay(day, ranges); }, extra));
    return box;
  }

  function confirmClose(days) {
    var bookings = [];
    days.forEach(function (d) { d.bookings.forEach(function (b) { bookings.push(dateShort(d.date) + ' ' + hm(b.time) + ' ' + b.name + ' (' + phoneText(b.phone) + ')'); }); });
    if (!bookings.length) return true;
    return confirm('Neil päevil on ' + plural(bookings.length, 'broneering', 'broneeringut') + ':\n' + bookings.join('\n') +
      '\n\nNeed jäävad alles, uusi broneeringuid enam ei tule. Kui ka need jäävad ära, helista palun klientidele.\n\nSulgen?');
  }

  function setDay(day, ranges) {
    if (ranges && !ranges.length && !confirmClose([day])) return;
    toast('Salvestan…');
    adminApi({ action: 'admin_set_days', dates: [day.date], ranges: ranges }).then(function (r) {
      if (!r.ok) { toast('Ei õnnestunud salvestada.', 'error'); return; }
      if (ranges === null) {
        day.ranges = day.holiday ? [] : (state.data.weekly[day.isoDow] || []);
        day.source = day.holiday ? 'closed' : 'weekly';
      } else {
        day.ranges = ranges;
        day.source = 'override';
      }
      renderDays();
      toast(WD[day.isoDow] + ' ' + dateShort(day.date) + ': ' + (day.ranges.length ? 'avatud ' + rangesText(day.ranges) : 'suletud') + ' ✓', 'ok');
    }).catch(saveError);
  }

  // ---------- vacation ----------

  $('vac-btn').addEventListener('click', function () {
    var from = $('vac-from').value, to = $('vac-to').value;
    if (!from || !to || to < from) { toast('Vali algus- ja lõppkuupäev.', 'warn'); return; }
    var dates = [];
    for (var d = from; d <= to && dates.length < 120; d = S.addDays(d, 1)) dates.push(d);
    var inRange = state.data.days.filter(function (x) { return x.date >= from && x.date <= to; });
    if (!confirmClose(inRange)) return;
    toast('Salvestan…');
    adminApi({ action: 'admin_set_days', dates: dates, ranges: [] }).then(function (r) {
      if (!r.ok) { toast('Ei õnnestunud salvestada.', 'error'); return; }
      toast(dateLong(from) + ' – ' + dateLong(to) + ' suletud ✓', 'ok');
      $('vac-from').value = '';
      $('vac-to').value = '';
      loadMain();
    }).catch(saveError);
  });

  // ---------- weekly defaults ----------

  function renderWeekly() {
    var box = $('weekly');
    box.innerHTML = '';
    for (var dow = 1; dow <= 7; dow++) {
      var ranges = state.data.weekly[dow] || [];
      var r = ranges[0] || state.data.openDefault[0];
      var on = ranges.length > 0;
      var from = el('select', { 'aria-label': WD_LONG[dow] + ' algus', disabled: !on, 'data-part': 'from' });
      var to = el('select', { 'aria-label': WD_LONG[dow] + ' lõpp', disabled: !on, 'data-part': 'to' });
      timeOptions(from, r[0]);
      timeOptions(to, r[1]);
      var sw = el('button', { type: 'button', role: 'switch', class: 'adm-switch', 'aria-checked': on ? 'true' : 'false',
        'aria-label': WD_LONG[dow] + (on ? ' avatud' : ' suletud') }, [el('span', { class: 'adm-switch-knob' })]);
      sw.addEventListener('click', (function (sw, from, to, dow) {
        return function () {
          var now = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', now ? 'true' : 'false');
          sw.setAttribute('aria-label', WD_LONG[dow] + (now ? ' avatud' : ' suletud'));
          from.disabled = to.disabled = !now;
        };
      })(sw, from, to, dow));
      box.appendChild(el('div', { class: 'adm-week-row', 'data-dow': String(dow) }, [
        el('span', { class: 'adm-week-day', text: WD_LONG[dow] }), sw, from, el('span', { text: '–' }), to,
      ]));
    }
  }

  $('weekly-btn').addEventListener('click', function () {
    var weekly = {};
    var bad = false;
    Array.prototype.forEach.call(document.querySelectorAll('.adm-week-row'), function (row) {
      var on = row.querySelector('[role=switch]').getAttribute('aria-checked') === 'true';
      var from = row.querySelector('[data-part=from]').value, to = row.querySelector('[data-part=to]').value;
      if (on && from >= to) bad = true;
      weekly[row.getAttribute('data-dow')] = on ? [[from, to]] : [];
    });
    if (bad) { toast('Algus peab olema enne lõppu.', 'warn'); return; }
    toast('Salvestan…');
    adminApi({ action: 'admin_set_weekly', weekly: weekly }).then(function (r) {
      if (!r.ok) { toast('Ei õnnestunud salvestada.', 'error'); return; }
      toast('Tavaline nädal salvestatud ✓', 'ok');
      loadMain();
    }).catch(saveError);
  });

  // ---------- one request from the e-mail link ----------

  function showRequest(id, t) {
    view('v-request');
    var box = $('request-body');
    api({ action: 'admin_request', id: id, t: t }).then(function (r) {
      box.innerHTML = '';
      if (!r.ok) {
        box.appendChild(el('p', { text: r.error === 'not_found'
          ? 'Seda soovi enam pole: klient võttis selle tagasi või see aegus.'
          : 'Link ei ole õige. Ava see otse e-kirjast.' }));
        box.appendChild(backToMain());
        return;
      }
      var b = r.booking;
      box.appendChild(el('div', { class: 'adm-req' }, bookingLines(b)));
      if (b.status !== 'pending') {
        box.appendChild(el('p', { class: 'adm-ok', text: 'See broneering on juba kinnitatud.' }));
        box.appendChild(backToMain());
        return;
      }
      var finish = function (decision) {
        box.innerHTML = '';
        box.appendChild(el('p', { class: 'adm-ok', text: decision === 'approve'
          ? 'Kinnitatud! ' + b.name + ' sai kinnituse e-postile.'
          : decision === 'decline' ? 'Tagasi lükatud. ' + b.name + ' sai teate.' : 'Seda soovi enam pole.' }));
        box.appendChild(backToMain());
      };
      box.appendChild(el('div', { class: 'adm-actions' }, [
        el('button', { type: 'button', class: 'adm-btn primary', text: 'Kinnita', onclick: function () { decide(b, 'approve', { t: t }, finish); } }),
        el('button', { type: 'button', class: 'adm-btn', text: 'Lükka tagasi', onclick: function () { decide(b, 'decline', { t: t }, finish); } }),
      ]));
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(el('p', { text: 'Ühendus katkes. Ava link uuesti.' }));
    });
  }

  function backToMain() {
    return el('p', {}, [el('button', { type: 'button', class: 'adm-btn', text: state.session ? 'Ava kõik tööajad' : 'Logi sisse tööaegade nägemiseks',
      onclick: function () { toast(''); if (state.session) loadMain(); else logout(''); } })]);
  }

  // ---------- start ----------

  function start() {
    if (!API) { view('v-offline'); return; }
    loadSession();
    var hash = location.hash.match(/^#login=(.+)$/);
    var params = new URLSearchParams(location.search);
    if (hash || params.get('soov')) history.replaceState(null, '', location.pathname); // keep tokens out of history
    if (hash) { exchangeLogin(decodeURIComponent(hash[1])); return; }
    if (params.get('soov')) { showRequest(params.get('soov'), params.get('t') || ''); return; }
    if (state.session) loadMain();
    else view('v-login');
  }

  // The login link can also arrive while the page is already open (same address, new #login=).
  window.addEventListener('hashchange', function () {
    var hash = location.hash.match(/^#login=(.+)$/);
    if (!hash) return;
    history.replaceState(null, '', location.pathname);
    exchangeLogin(decodeURIComponent(hash[1]));
  });

  start();
})();
