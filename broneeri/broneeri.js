/*
 * Pargi Ilustuudio booking page.
 * Services come from /pricing.json; opening windows and busy times from the booking API
 * (Google Apps Script). Start times are computed here with the shared slot engine (slots.js)
 * and re-checked by the server when the customer confirms.
 */
(function () {
  'use strict';

  var S = window.PargiSlots;
  var cfg = window.PARGI_BOOKING || {};
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = cfg.apiUrl || (LOCAL ? '/api' : '');

  var MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];
  var WEEKDAYS = ['', 'esmaspäev', 'teisipäev', 'kolmapäev', 'neljapäev', 'reede', 'laupäev', 'pühapäev'];
  var WD_SHORT = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];
  var PHONE = '5569 7525';

  var state = {
    services: [],
    byId: {},
    availability: null,
    availabilityPromise: null,
    service: null,
    date: null,
    startMs: null,
    month: null, // 'YYYY-MM'
    booking: null,
    requestId: null,     // one per chosen time; retries reuse it so the server never books twice
    pendingStatus: null, // message to show after a history.back()
  };
  var AVAILABILITY_MAX_AGE_MS = 2 * 60 * 1000;

  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

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

  function price(v) {
    return new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(v);
  }

  function duration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }

  function dayLabel(dateKey) {
    var p = S.localParts(S.localToUtc(dateKey, '12:00'));
    var d = dateKey.split('-');
    return WEEKDAYS[p.isoDow] + ', ' + Number(d[2]) + '. ' + MONTHS[Number(d[1]) - 1];
  }

  function relativeDay(dateKey) {
    var today = S.localParts(Date.now()).date;
    if (dateKey === today) return 'täna';
    if (dateKey === S.addDays(today, 1)) return 'homme';
    return '';
  }

  function timeOf(ms) { return S.localParts(ms).time; }

  function status(msg, kind) {
    var s = $('bk-status');
    s.textContent = msg || '';
    s.className = 'bk-status' + (msg ? ' is-' + (kind || 'info') : '');
  }

  function api(method, params) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 60000);
    var req = method === 'GET'
      ? fetch(API + (API.indexOf('?') === -1 ? '?' : '&') + new URLSearchParams(params).toString(), { signal: ctrl && ctrl.signal })
      : fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: no CORS preflight
        body: JSON.stringify(params),
        signal: ctrl && ctrl.signal,
      });
    return req.then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // ---------- steps and history ----------

  var PANELS = ['step-1', 'step-2', 'step-3', 'step-done', 'cancel', 'offline'];

  function show(panelId, push) {
    PANELS.forEach(function (id) { $(id).hidden = id !== panelId; });
    var n = { 'step-1': 1, 'step-2': 2, 'step-3': 3 }[panelId] || 0;
    var steps = document.querySelector('.bk-steps');
    steps.hidden = !n;
    Array.prototype.forEach.call(steps.children, function (li) {
      var s = Number(li.getAttribute('data-step'));
      li.className = s === n ? 'is-current' : s < n ? 'is-done' : '';
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (push) history.pushState({ panel: panelId }, '');
    var h = $(panelId).querySelector('h2');
    window.scrollTo(0, 0);
    if (h && push !== null) h.focus({ preventScroll: true });
  }

  window.addEventListener('popstate', function (e) {
    var panel = (e.state && e.state.panel) || 'step-1';
    if (panel === 'step-done' || panel === 'cancel') return;
    if (state.booking) { // after a booking, "back" starts over instead of resubmitting
      state.booking = null;
      state.service = null;
      panel = 'step-1';
    }
    if (panel !== 'step-1' && !state.service) panel = 'step-1';
    if (panel === 'step-3' && !state.startMs) panel = 'step-2';
    status(state.pendingStatus || '', 'warn');
    state.pendingStatus = null;
    if (panel === 'step-2') { refreshIfStale(); renderStep2(); }
    show(panel, false);
  });

  // ---------- data ----------

  function loadServices() {
    return fetch('/pricing.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (json) {
      state.services = json.services.filter(function (s) { return s.id && s.duration > 0 && s.bookable !== false; });
      state.services.forEach(function (s) { state.byId[s.id] = s; });
    });
  }

  function loadAvailability() {
    state.availabilityPromise = api('GET', { action: 'availability' }).then(function (av) {
      if (!av.ok) throw new Error(av.error || 'availability');
      av.receivedAt = Date.now();
      state.availability = av;
      return av;
    });
    return state.availabilityPromise;
  }

  /** Drops availability older than two minutes so the page never offers long-gone times. */
  function refreshIfStale() {
    var av = state.availability;
    if (av && Date.now() - av.receivedAt > AVAILABILITY_MAX_AGE_MS) {
      state.availability = null;
      loadAvailability().catch(function () {});
    }
  }

  function slotsForService(service) {
    var av = state.availability;
    var lead = av.notBeforeMs - av.generatedMs; // minimum notice, kept as time passes
    return S.computeSlots({
      windows: av.windows,
      busy: av.busy,
      durationMin: service.duration,
      bufferMin: av.bufferMin,
      stepMin: av.stepMin,
      notBeforeMs: Math.max(av.notBeforeMs, Date.now() + lead),
    });
  }

  // ---------- step 1: services ----------

  function renderServices(filter) {
    var list = $('service-list');
    list.innerHTML = '';
    var q = (filter || '').trim().toLowerCase();
    var groups = [];
    var byGroup = {};
    state.services.forEach(function (s) {
      var g = (s.categories && s.categories[0]) || 'Muu';
      if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
      if (!q || (s.name + ' ' + (s.description || '') + ' ' + g).toLowerCase().indexOf(q) !== -1) byGroup[g].push(s);
    });
    var shown = 0;
    groups.forEach(function (g) {
      var items = byGroup[g];
      if (!items.length) return;
      shown += items.length;
      var details = el('details', { class: 'bk-group', open: q ? true : false }, [
        el('summary', {}, [el('span', { text: g }), el('span', { class: 'bk-count', text: items.length + '' })]),
      ]);
      var ul = el('ul', { class: 'bk-service-list' });
      items.forEach(function (s) {
        var desc = (s.description || '').trim();
        if (desc.length > 110) desc = desc.slice(0, 105).replace(/\s+\S*$/, '') + '…';
        ul.appendChild(el('li', {}, [el('button', {
          type: 'button', class: 'bk-service', 'data-id': s.id,
          onclick: function () { chooseService(s.id, true); },
        }, [
          el('span', { class: 'bk-service-name', text: s.name }),
          el('span', { class: 'bk-service-meta', text: duration(s.duration) + ' · ' + price(s.price) }),
          desc ? el('span', { class: 'bk-service-desc', text: desc }) : null,
        ])]));
      });
      details.appendChild(ul);
      list.appendChild(details);
    });
    if (!shown) list.appendChild(el('p', { class: 'bk-empty', text: 'Ei leidnud sellist teenust. Proovi teist sõna või helista ' + PHONE + '.' }));
  }

  function chooseService(id, push) {
    var s = state.byId[id];
    if (!s) return;
    state.service = s;
    state.date = null;
    state.startMs = null;
    state.month = null;
    status('');
    refreshIfStale();
    renderStep2();
    show('step-2', push);
  }

  // ---------- step 2: calendar and times ----------

  function renderChosen() {
    var s = state.service;
    var box = $('chosen-service');
    box.innerHTML = '';
    box.appendChild(el('div', {}, [
      el('strong', { text: s.name }),
      el('span', { class: 'bk-service-meta', text: duration(s.duration) + ' · ' + price(s.price) }),
    ]));
    box.appendChild(el('button', { type: 'button', class: 'bk-link', text: 'Muuda teenust', onclick: function () { history.back(); } }));
  }

  function renderStep2() {
    renderChosen();
    var area = $('calendar-area');
    if (!state.availability) {
      $('calendar').hidden = true;
      $('times').innerHTML = '<p class="bk-loading">Laen vabu aegu…</p>';
      state.availabilityPromise.then(function () {
        if (state.service && !$('step-2').hidden) renderStep2();
      }, function () { show('offline', false); });
      return;
    }
    $('calendar').hidden = false;
    var byDay = S.groupByDay(slotsForService(state.service));
    state.byDay = byDay;
    var days = Object.keys(byDay);
    if (!days.length) {
      $('calendar').hidden = true;
      $('times').innerHTML = '';
      $('times').appendChild(el('p', { class: 'bk-empty' }, [
        'Järgmise kahe kuu jooksul sellele teenusele vabu aegu ei ole. Palun helista ',
        el('a', { href: 'tel:+37255697525', text: PHONE }), ', küll leiame aja.',
      ]));
      area.className = '';
      return;
    }
    if (!state.date || !byDay[state.date]) state.date = days[0];
    if (!state.month) state.month = state.date.slice(0, 7);
    renderCalendar();
    renderTimes();
  }

  function monthShift(ym, n) {
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }

  function renderCalendar() {
    var ym = state.month;
    var today = S.localParts(Date.now()).date;
    var lastDay = S.localParts(state.availability.horizonEndMs - 1).date;
    $('cal-month').textContent = MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
    $('cal-prev').disabled = ym <= today.slice(0, 7);
    $('cal-next').disabled = ym >= lastDay.slice(0, 7);
    var grid = $('cal-grid');
    grid.innerHTML = '';
    var head = el('div', { class: 'bk-cal-row bk-cal-wd', 'aria-hidden': 'true' });
    WD_SHORT.forEach(function (w) { head.appendChild(el('span', { text: w })); });
    grid.appendChild(head);
    var first = ym + '-01';
    var lead = S.localParts(S.localToUtc(first, '12:00')).isoDow - 1;
    var row = el('div', { class: 'bk-cal-row' });
    for (var i = 0; i < lead; i++) row.appendChild(el('span', { class: 'bk-day is-blank', 'aria-hidden': 'true' }));
    for (var d = first; d.slice(0, 7) === ym; d = S.addDays(d, 1)) {
      var n = (state.byDay[d] || []).length;
      var label = dayLabel(d) + (n ? ', ' + n + ' vaba aega' : ', vabu aegu pole');
      var cls = 'bk-day' + (n ? ' has-slots' : '') + (d === state.date ? ' is-selected' : '') + (d === today ? ' is-today' : '');
      var cell = n
        ? el('button', { type: 'button', class: cls, 'aria-label': label, 'aria-pressed': d === state.date ? 'true' : 'false',
          onclick: (function (day) { return function () { state.date = day; renderCalendar(); renderTimes(true); }; })(d) },
          [String(Number(d.slice(8)))])
        : el('span', { class: cls, 'aria-hidden': 'true' }, [String(Number(d.slice(8)))]);
      row.appendChild(el('span', { class: 'bk-cell' }, [cell]));
      if (row.children.length === 7) { grid.appendChild(row); row = el('div', { class: 'bk-cal-row' }); }
    }
    if (row.children.length) grid.appendChild(row);
  }

  function renderTimes(scroll) {
    var box = $('times');
    box.innerHTML = '';
    var slots = state.byDay[state.date] || [];
    var rel = relativeDay(state.date);
    box.appendChild(el('h3', { text: (rel ? rel.charAt(0).toUpperCase() + rel.slice(1) + ', ' : '') + dayLabel(state.date) }));
    var wrap = el('div', { class: 'bk-time-grid' });
    slots.forEach(function (ms) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'bk-time', text: timeOf(ms),
        'aria-label': 'kell ' + timeOf(ms) + ', ' + dayLabel(state.date),
        onclick: function () { chooseTime(ms); },
      }));
    });
    box.appendChild(wrap);
    if (scroll && window.matchMedia('(max-width: 760px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function chooseTime(ms) {
    state.startMs = ms;
    state.requestId = newRequestId();
    status('');
    renderSummary();
    $('submit-btn').textContent = submitLabel();
    show('step-3', true);
  }

  /** Times starting soon are requests that Ilvi confirms personally. */
  function needsApproval(ms) {
    var av = state.availability;
    return !!(av && av.approvalBeforeMs && ms < av.approvalBeforeMs);
  }

  function submitLabel() {
    return state.startMs && needsApproval(state.startMs) ? 'Saada broneeringusoov' : 'Kinnita broneering';
  }

  $('cal-prev').addEventListener('click', function () { state.month = monthShift(state.month, -1); renderCalendar(); });
  $('cal-next').addEventListener('click', function () { state.month = monthShift(state.month, 1); renderCalendar(); });

  // ---------- step 3: details ----------

  function renderSummary() {
    var s = state.service, ms = state.startMs;
    var box = $('summary');
    box.innerHTML = '';
    box.appendChild(el('dl', {}, [
      el('dt', { text: 'Teenus' }), el('dd', { text: s.name }),
      el('dt', { text: 'Aeg' }), el('dd', { text: dayLabel(S.localParts(ms).date) + ' kell ' + timeOf(ms) + '–' + timeOf(ms + s.duration * 60000) }),
      el('dt', { text: 'Hind' }), el('dd', { text: price(s.price) + ' (tasumine kohapeal)' }),
    ]));
    box.appendChild(el('button', { type: 'button', class: 'bk-link', text: 'Muuda aega', onclick: function () { history.back(); } }));
    if (needsApproval(ms)) {
      box.appendChild(el('p', { class: 'bk-approval-note', text: 'See aeg on juba varsti, seega kinnitab Ilvi selle isiklikult. ' +
        'Saad kinnituse e-postile, tavaliselt mõne tunni jooksul.' }));
    }
  }

  var EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;

  function fieldError(name, msg) {
    var input = $('f-' + name);
    $('e-' + name).textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate(form) {
    var errors = {};
    var name = form.name.value.trim();
    var phoneDigits = form.phone.value.replace(/[^\d]/g, '');
    var email = form.email.value.trim();
    if (name.length < 2) errors.name = 'Palun kirjuta oma nimi.';
    if (phoneDigits.length < 7 || phoneDigits.length > 15) errors.phone = 'Palun kontrolli telefoninumbrit.';
    if (!EMAIL_RE.test(email)) errors.email = 'Palun kontrolli e-posti aadressi.';
    ['name', 'phone', 'email'].forEach(function (k) { fieldError(k, errors[k]); });
    return errors;
  }

  $('details-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var errors = validate(form);
    var firstBad = ['name', 'phone', 'email'].filter(function (k) { return errors[k]; })[0];
    if (firstBad) { $('f-' + firstBad).focus(); return; }
    var btn = $('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Broneerin…';
    status('');
    api('POST', {
      action: 'book',
      serviceId: state.service.id,
      startMs: state.startMs,
      name: form.name.value,
      phone: form.phone.value,
      email: form.email.value.trim(),
      comment: form.comment.value,
      website: form.website.value,
      requestId: state.requestId,
    }).then(function (r) {
      if (r.ok) return done(r.booking, form.email.value.trim());
      if (r.error === 'slot_taken') {
        state.startMs = null;
        state.availability = null;
        loadAvailability().catch(function () {});
        state.pendingStatus = 'Kahjuks broneeriti see aeg just ära. Palun vali uus aeg.';
        history.back(); // back to the time list, without stacking history entries
        return;
      }
      if (r.error === 'unavailable' || r.error === 'daily_limit') {
        return status('Veebibroneerimine on täna ajutiselt suletud. Palun helista ' + PHONE + ' või kirjuta WhatsAppis.', 'warn');
      }
      if (r.error === 'invalid' && r.fields) {
        r.fields.forEach(function (k) { fieldError(k, k === 'phone' ? 'Palun kontrolli telefoninumbrit.' : k === 'email' ? 'Palun kontrolli e-posti aadressi.' : 'Palun kirjuta oma nimi.'); });
        return;
      }
      if (r.error === 'too_many') return status('Sul on juba mitu tulevast broneeringut. Uue aja jaoks palun helista ' + PHONE + '.', 'warn');
      status('Broneerimine ei õnnestunud. Palun proovi uuesti või helista ' + PHONE + '.', 'error');
    }).catch(function () {
      status('Ühendus katkes. Palun vajuta nuppu uuesti: kui aeg jõudis juba kinni panna, topelt broneeringut ei teki.', 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = submitLabel();
    });
  });

  // ---------- done ----------

  function done(b, email) {
    state.booking = b;
    var pending = b.status === 'pending';
    $('done-h').textContent = pending ? 'Soov on saadetud!' : 'Aeg on broneeritud!';
    $('ics-btn').hidden = pending; // nothing to add before Ilvi confirms
    var body = $('done-body');
    body.innerHTML = '';
    body.appendChild(el('dl', { class: 'bk-summary-dl' }, [
      el('dt', { text: 'Teenus' }), el('dd', { text: b.serviceName }),
      el('dt', { text: 'Aeg' }), el('dd', { text: dayLabel(S.localParts(b.startMs).date) + ' kell ' + timeOf(b.startMs) + '–' + timeOf(b.startMs + b.durationMin * 60000) }),
      el('dt', { text: 'Aadress' }), el('dd', {}, ['Pargi 10-10, Tartu', el('br'), 'Välisuksel vali number 10']),
    ]));
    if (pending) {
      body.appendChild(el('p', {}, ['Aeg on Sinu jaoks kinni hoitud. Kuna see on juba varsti, kinnitab Ilvi selle isiklikult. ',
        el('strong', { text: 'Kinnituse saad e-postile' }), b.mailed === false ? '.' : ' (' + email + ').']));
      body.appendChild(el('p', {}, ['Kiire küsimuse korral helista ', el('a', { href: 'tel:+37255697525', text: PHONE }), '.']));
    } else if (b.mailed === false) {
      body.appendChild(el('p', {}, ['Sinu aeg on kirjas, kuid kinnituskirja saatmine ebaõnnestus. Tühistamiseks või küsimustega helista ',
        el('a', { href: 'tel:+37255697525', text: PHONE }), '.']));
    } else {
      body.appendChild(el('p', {}, ['Kinnitus on teel aadressile ', el('strong', { text: email }), '. Kui kirja mõne minuti jooksul pole, vaata ka rämpsposti kausta.']));
      body.appendChild(el('p', { text: 'Tühistada saad kirjas oleva lingi kaudu kuni 24 tundi enne.' }));
    }
    document.getElementById('details-form').reset();
    show('step-done', true);
  }

  function icsFor(b) {
    var t = function (ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pargi Ilustuudio//Broneering//ET', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + b.id + '@pargiilustuudio.eu', 'DTSTAMP:' + t(Date.now()),
      'DTSTART:' + t(b.startMs), 'DTEND:' + t(b.startMs + b.durationMin * 60000),
      'SUMMARY:' + b.serviceName.replace(/([,;\\])/g, '\\$1') + ' – Pargi Ilustuudio',
      'LOCATION:Pargi 10-10\\, 50103 Tartu',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n') + '\r\n';
  }

  $('ics-btn').addEventListener('click', function () {
    if (!state.booking) return;
    var url = URL.createObjectURL(new Blob([icsFor(state.booking)], { type: 'text/calendar' }));
    var a = el('a', { href: url, download: 'pargi-ilustuudio.ics' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  });

  // ---------- cancel ----------

  function startCancel(id, token) {
    show('cancel', false);
    var box = $('cancel-body');
    api('GET', { action: 'booking', id: id, t: token }).then(function (r) {
      box.innerHTML = '';
      if (!r.ok) {
        box.appendChild(el('p', { text: 'Seda broneeringut ei leitud. Võimalik, et see on juba tühistatud.' }));
        box.appendChild(el('p', {}, [el('a', { class: 'cta primary', href: '/broneeri/', text: 'Broneeri uus aeg' })]));
        return;
      }
      var b = r.booking;
      var pending = b.status === 'pending';
      $('cancel-h').textContent = pending ? 'Broneeringusoovi tagasivõtmine' : 'Broneeringu tühistamine';
      box.appendChild(el('p', { text: 'Tere, ' + b.firstName + '!' + (pending ? ' Ilvi pole seda soovi veel kinnitanud.' : '') }));
      box.appendChild(el('dl', { class: 'bk-summary-dl' }, [
        el('dt', { text: 'Teenus' }), el('dd', { text: b.serviceName }),
        el('dt', { text: 'Aeg' }), el('dd', { text: dayLabel(S.localParts(b.startMs).date) + ' kell ' + timeOf(b.startMs) }),
      ]));
      if (!b.cancellable) {
        box.appendChild(el('p', {}, ['Veebis saab tühistada kuni 24 tundi enne. Palun helista ', el('a', { href: 'tel:+37255697525', text: PHONE }), '.']));
        return;
      }
      var yes = pending ? 'Jah, võta soov tagasi' : 'Jah, tühista broneering';
      var btn = el('button', { type: 'button', class: 'cta accent', text: yes });
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Tühistan…';
        api('POST', { action: 'cancel', id: id, t: token }).then(function (c) {
          box.innerHTML = '';
          if (c.ok) {
            box.appendChild(el('p', { class: 'bk-ok', text: (pending ? 'Soov on tagasi võetud.' : 'Broneering on tühistatud.') + ' Kinnitus tuleb ka e-postile.' }));
          } else if (c.error === 'too_late') {
            box.appendChild(el('p', { text: 'Tühistamiseks on veebis liiga hilja. Palun helista ' + PHONE + '.' }));
          } else {
            box.appendChild(el('p', { text: 'Broneeringut ei leitud. Võimalik, et see on juba tühistatud.' }));
          }
          box.appendChild(el('p', {}, [el('a', { class: 'cta primary', href: '/broneeri/', text: 'Broneeri uus aeg' })]));
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = yes;
          status('Ühendus katkes. Palun proovi uuesti või helista ' + PHONE + '.', 'error');
        });
      });
      box.appendChild(el('div', { class: 'bk-actions' }, [btn, el('a', { class: 'cta outline', href: '/', text: 'Ei, jätan alles' })]));
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(el('p', { text: 'Broneeringu laadimine ei õnnestunud. Palun proovi hiljem uuesti või helista ' + PHONE + '.' }));
    });
  }

  // ---------- start ----------

  function init() {
    var params = new URLSearchParams(location.search);
    if (!API) { show('offline', false); return; }
    if (params.get('tuhista')) {
      var id = params.get('tuhista'), token = params.get('t') || '';
      history.replaceState({ panel: 'cancel' }, '', location.pathname); // keep the token out of history
      startCancel(id, token);
      return;
    }
    history.replaceState({ panel: 'step-1' }, '');
    show('step-1', null);
    loadAvailability().catch(function () {});
    loadServices().then(function () {
      renderServices('');
      var pre = params.get('teenus');
      if (pre && state.byId[pre]) chooseService(pre, true);
    }).catch(function () { show('offline', false); });
    $('service-search').addEventListener('input', function (e) { renderServices(e.target.value); });
  }

  init();
})();
