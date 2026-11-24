/**
 * Admin API for Ilvi's "Minu tööajad" page (/broneeri/haldus/).
 *
 * Login: the page asks for a link, which is e-mailed to OWNER_EMAIL only (5 a day at most).
 * The link carries a 30-minute single-use login token; the page swaps it for a session token
 * (valid ADMIN_SESSION_DAYS) kept on her phone. "Log out everywhere" bumps ADMIN_VERSION.
 * Requests for approval can also be opened with a per-booking token from her e-mail.
 *
 * Tokens are '<payload>.<HMAC>' with payloads 'login-<expMs>-<nonce>', 'session-<expMs>-<version>'
 * and 'approve-<eventId>'; customer cancel tokens sign the bare event id, so none can stand in
 * for another.
 */

function hmac_(payload) {
  var sig = Utilities.computeHmacSha256Signature(String(payload), secret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 32);
}

function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function signed_(payload) {
  return payload + '.' + hmac_(payload);
}

/** The payload of a valid signed token, or null. */
function verifySigned_(token) {
  if (typeof token !== 'string' || token.length > 300) return null;
  var i = token.lastIndexOf('.');
  if (i < 1) return null;
  var payload = token.slice(0, i);
  return safeEqual_(token.slice(i + 1), hmac_(payload)) ? payload : null;
}

function adminVersion_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_VERSION') || '1';
}

function sessionOk_(s) {
  var p = verifySigned_(s);
  if (!p) return false;
  var parts = p.split('-');
  return parts.length === 3 && parts[0] === 'session' && Number(parts[1]) > nowMs() && parts[2] === adminVersion_();
}

function approvalToken_(id) {
  return hmac_('approve-' + id);
}

/** Approval-link token for this booking, or an admin session. */
function bookingAdminOk_(body) {
  if (!validEventId_(body.id)) return false;
  if (body.t && safeEqual_(String(body.t), approvalToken_(body.id))) return true;
  return sessionOk_(body.s);
}

var UNAUTHORIZED_ = { ok: false, error: 'unauthorized' };
var INVALID_ = { ok: false, error: 'invalid' };

function handleAdmin_(body) {
  switch (body.action) {
    case 'admin_login_request': return adminLoginRequest_();
    case 'admin_session': return adminSession_(body.login);
    case 'admin_request': return bookingAdminOk_(body) ? adminRequest_(body.id) : UNAUTHORIZED_;
    case 'admin_decide': return bookingAdminOk_(body) ? adminDecide_(body.id, body.decision) : UNAUTHORIZED_;
  }
  if (!sessionOk_(body.s)) return UNAUTHORIZED_;
  switch (body.action) {
    case 'admin_overview': return adminOverview_();
    case 'admin_set_days': return adminSetDays_(body.dates, body.ranges);
    case 'admin_set_weekly': return adminSetWeekly_(body.weekly);
    case 'admin_add_event': return adminAddEvent_(body);
    case 'admin_delete_event': return adminDeleteEvent_(body.id);
    case 'admin_cancel_online': return adminCancelOnline_(body.id);
    case 'admin_logout_all':
      PropertiesService.getScriptProperties().setProperty('ADMIN_VERSION', String(Number(adminVersion_()) + 1));
      return { ok: true };
    default: return { ok: false, error: 'unknown_action' };
  }
}

// ---------- login ----------

function adminLoginRequest_() {
  var props = PropertiesService.getScriptProperties();
  var today = PargiSlots.localParts(nowMs()).date;
  var counter = JSON.parse(props.getProperty('LOGIN_COUNT') || '{}');
  var n = counter.date === today ? Number(counter.n) || 0 : 0;
  if (n >= CONFIG.ADMIN_LOGIN_PER_DAY) return { ok: true }; // same answer, no e-mail
  props.setProperty('LOGIN_COUNT', JSON.stringify({ date: today, n: n + 1 }));
  var nonce = Utilities.getUuid().replace(/-/g, '');
  var token = signed_('login-' + (nowMs() + 30 * MINUTE_MS) + '-' + nonce);
  sendSafely_(function () { mailAdminLogin_(token); });
  return { ok: true };
}

function adminSession_(login) {
  var p = verifySigned_(login);
  var parts = p ? p.split('-') : [];
  if (parts.length !== 3 || parts[0] !== 'login' || Number(parts[1]) < nowMs()) return UNAUTHORIZED_;
  var cache = CacheService.getScriptCache();
  if (cache.get('used-login:' + parts[2])) return UNAUTHORIZED_;
  cache.put('used-login:' + parts[2], '1', 3600);
  return { ok: true, session: signed_('session-' + (nowMs() + CONFIG.ADMIN_SESSION_DAYS * DAY_MS) + '-' + adminVersion_()) };
}

// ---------- overview ----------

function adminBookingView_(ev) {
  var p = privateProps_(ev);
  var s = eventStartMs_(ev);
  return {
    id: ev.id,
    date: PargiSlots.localParts(s).date,
    time: PargiSlots.localParts(s).time,
    end: PargiSlots.localParts(eventEndMs_(ev)).time,
    startMs: s,
    service: p.serviceName,
    name: p.name,
    phone: p.phone,
    email: p.email,
    comment: p.comment || '',
    pending: p.state === 'pending',
    manual: false,
  };
}

/** Appointments she adds herself ("Lisa aeg"): private property pargiManual=1. */
function manualView_(ev) {
  var p = privateProps_(ev);
  var s = eventStartMs_(ev);
  return {
    id: ev.id,
    date: PargiSlots.localParts(s).date,
    time: PargiSlots.localParts(s).time,
    end: PargiSlots.localParts(eventEndMs_(ev)).time,
    startMs: s,
    service: p.serviceName || '',
    name: p.name || '',
    phone: p.phone || '',
    email: '',
    comment: p.note || '',
    pending: false,
    manual: true,
  };
}

function busyCalendars_() {
  var calendars = CONFIG.BUSY_CALENDAR_IDS.slice();
  if (calendars.indexOf(CONFIG.CALENDAR_ID) === -1) calendars.push(CONFIG.CALENDAR_ID);
  return calendars;
}

function adminOverview_() {
  var h = horizon_();
  var stored = getStoredSchedule_();
  var schedule = getSchedule_();
  var closed = closedDates_(h.fromDate, h.days);
  var holidays = {};
  closed.forEach(function (d) { holidays[d] = true; });
  var opts = { weekly: schedule.weekly, overrides: schedule.days, closedDates: closed };

  var days = [];
  var byDate = {};
  for (var i = 0; i < h.days; i++) {
    var date = PargiSlots.addDays(h.fromDate, i);
    var r = PargiSlots.dayRanges(opts, date);
    var day = {
      date: date,
      isoDow: PargiSlots.localParts(PargiSlots.localToUtc(date, '12:00')).isoDow,
      ranges: r.ranges,
      source: r.source,
      holiday: !!holidays[date],
      bookings: [],
      other: [],
      allDay: [],
    };
    days.push(day);
    byDate[date] = day;
  }

  var pending = [];
  busyCalendars_().forEach(function (calendarId) {
    listEvents_(calendarId, h.fromMs, h.toMs).forEach(function (ev) {
      var own = calendarId === CONFIG.CALENDAR_ID && ev.status !== 'cancelled' ? privateProps_(ev) : {};
      if (own.pargi === '1' || own.pargiManual === '1') {
        var b = own.pargi === '1' ? adminBookingView_(ev) : manualView_(ev);
        if (byDate[b.date]) byDate[b.date].bookings.push(b);
        if (b.pending) pending.push(b);
        return;
      }
      if (!eventBusy_(ev)) return;
      var title = ev.summary || '(sündmus)';
      if (ev.start.date) {
        for (var d = ev.start.date; d < ev.end.date; d = PargiSlots.addDays(d, 1)) {
          if (byDate[d]) byDate[d].allDay.push(title);
        }
      } else {
        var s = PargiSlots.localParts(Date.parse(ev.start.dateTime));
        if (byDate[s.date]) {
          byDate[s.date].other.push({ time: s.time, end: PargiSlots.localParts(Date.parse(ev.end.dateTime)).time, summary: title });
        }
      }
    });
  });

  return {
    ok: true,
    today: h.fromDate,
    weekly: schedule.weekly,
    weeklyIsDefault: !stored.weekly,
    openDefault: CONFIG.OPEN_DAY_DEFAULT,
    requiresApproval: CONFIG.REQUIRE_APPROVAL !== false,
    days: days,
    pending: pending,
    cancellations: recentCancellations_(false),
    customerTrial: CONFIG.PUBLIC_BOOKING_OPEN !== true ? ownerTrialInvite_() : '',
  };
}

// ---------- hours ----------

function adminSetDays_(dates, ranges) {
  var today = PargiSlots.localParts(nowMs()).date;
  if (!Array.isArray(dates) || !dates.length || dates.length > 120) return INVALID_;
  for (var i = 0; i < dates.length; i++) {
    if (!validDateKey_(dates[i]) || dates[i] < today) return INVALID_;
  }
  if (ranges !== null && !validRanges_(ranges)) return INVALID_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var stored = getStoredSchedule_();
    dates.forEach(function (d) {
      if (ranges === null) delete stored.days[d];
      else stored.days[d] = ranges;
    });
    saveSchedule_(stored);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function adminSetWeekly_(weekly) {
  if (!weekly || typeof weekly !== 'object' || Array.isArray(weekly)) return INVALID_;
  var out = {};
  var keys = Object.keys(weekly);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!/^[1-7]$/.test(k) || !validRanges_(weekly[k])) return INVALID_;
    if (weekly[k].length) out[k] = weekly[k];
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var stored = getStoredSchedule_();
    stored.weekly = out;
    saveSchedule_(stored);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ---------- approvals ----------

function adminRequest_(id) {
  var ev = getBookingEvent_(id);
  if (!ev) return { ok: false, error: 'not_found' };
  var v = adminBookingView_(ev);
  v.status = v.pending ? 'pending' : 'confirmed';
  return { ok: true, booking: v };
}

function adminDecide_(id, decision) {
  if (decision !== 'approve' && decision !== 'decline') return INVALID_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ev, p;
  try {
    ev = getBookingEvent_(id);
    if (!ev) return { ok: false, error: 'not_found' };
    p = privateProps_(ev);
    if (p.state !== 'pending') return { ok: false, error: 'not_pending' };
    if (decision === 'approve') {
      Calendar.Events.patch({
        summary: p.name + ' · ' + p.serviceName,
        colorId: CONFIG.EVENT_COLOR_ID,
        extendedProperties: { private: mergedPrivate_(ev, { state: 'confirmed' }) },
      }, CONFIG.CALENDAR_ID, id);
    } else {
      Calendar.Events.remove(CONFIG.CALENDAR_ID, id);
      recordCancellation_(ev, 'declined');
    }
    invalidateAvailability_();
  } finally {
    lock.releaseLock();
  }
  var booking = bookingSummary_(ev);
  booking.status = decision === 'approve' ? 'confirmed' : 'declined';
  var c = { name: p.name, phone: p.phone, phoneRaw: p.phone, email: p.email };
  var mailed;
  if (decision === 'approve') {
    var withToken = Object.assign({ token: token_(id) }, booking);
    mailed = sendSafely_(function () { mailConfirmation_(withToken, c); });
  } else {
    mailed = sendSafely_(function () { mailDeclined_(booking, c); });
  }
  return { ok: true, status: booking.status, mailed: mailed };
}

/** Ilvi may cancel a confirmed online appointment after speaking with the client, even inside 24 h.
 * Only a full admin session may reach this action, not an individual approval link. */
function adminCancelOnline_(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var ev, booking, p;
  try {
    ev = getBookingEvent_(id);
    if (!ev) return {ok:false,error:'not_found'};
    p = privateProps_(ev); booking = bookingSummary_(ev);
    if (booking.status !== 'confirmed' || booking.startMs <= nowMs()) return {ok:false,error:'invalid'};
    Calendar.Events.remove(CONFIG.CALENDAR_ID,id);
    recordCancellation_(ev, 'owner_cancelled');
    invalidateAvailability_();
  } finally { lock.releaseLock(); }
  var mailed = sendSafely_(function () { mailCancelled_(booking, {name:p.name, email:p.email}); });
  return {ok:true,mailed:mailed};
}

// ---------- her own appointments ("Lisa aeg") ----------

/** Busy events touching [fromMs, toMs), as she would recognise them. */
function conflictsBetween_(fromMs, toMs) {
  var out = [];
  busyCalendars_().forEach(function (calendarId) {
    listEvents_(calendarId, fromMs, toMs).forEach(function (ev) {
      var b = eventBusy_(ev);
      if (!b || b[1] <= fromMs || b[0] >= toMs) return;
      var allDay = !!(ev.start && ev.start.date);
      out.push({
        date: PargiSlots.localParts(b[0]).date,
        time: allDay ? '' : PargiSlots.localParts(b[0]).time,
        end: allDay ? '' : PargiSlots.localParts(b[1]).time,
        summary: ev.summary || '(sündmus)',
      });
    });
  });
  return out;
}

/**
 * Adds an appointment she arranged herself (phone, in person). Any day and time, opening hours
 * or not; it blocks online booking like any calendar event. Overlaps and gaps under BUFFER_MIN
 * are reported first and saved only with force: true.
 */
function adminAddEvent_(body) {
  var today = PargiSlots.localParts(nowMs()).date;
  var date = body.date;
  if (!validDateKey_(date) || date < today || date > PargiSlots.addDays(today, 366)) return INVALID_;
  var startMin = toMinutes_(body.time);
  if (!(startMin >= 0) || startMin % 5) return INVALID_;
  var service = null;
  if (body.serviceId != null && body.serviceId !== '') {
    service = services_()[String(body.serviceId)];
    if (!service) return INVALID_;
  }
  var hasDuration = body.durationMin != null && body.durationMin !== '';
  var duration = hasDuration ? Number(body.durationMin) : (service ? service.duration : NaN);
  if (!(duration >= 5 && duration <= 600) || duration % 5) return INVALID_;
  var name = clean_(body.name, 80);
  var phoneRaw = clean_(body.phone, 30);
  var phone = phoneRaw ? (normalizePhone_(phoneRaw) || phoneRaw) : '';
  var note = clean_(body.note, 300);
  var startMs = PargiSlots.localToUtc(date, body.time);
  var endMs = startMs + duration * MINUTE_MS;
  var gap = CONFIG.BUFFER_MIN * MINUTE_MS;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ev;
  try {
    if (body.force !== true) {
      var conflicts = conflictsBetween_(startMs - gap, endMs + gap);
      if (conflicts.length) return { ok: false, error: 'overlap', conflicts: conflicts };
    }
    var lines = [];
    if (phone) lines.push('Telefon: ' + phone);
    if (note) lines.push('Märkus: ' + note);
    lines.push('Lisatud lehelt „Minu tööajad“.');
    ev = Calendar.Events.insert({
      summary: (name || 'Klient') + (service ? ' · ' + service.name : ''),
      location: CONFIG.ADDRESS,
      description: lines.join('\n'),
      start: { dateTime: new Date(startMs).toISOString(), timeZone: 'Europe/Tallinn' },
      end: { dateTime: new Date(endMs).toISOString(), timeZone: 'Europe/Tallinn' },
      colorId: CONFIG.MANUAL_COLOR_ID,
      reminders: { useDefault: true },
      extendedProperties: {
        private: {
          pargiManual: '1',
          serviceId: service ? service.id : '',
          serviceName: service ? service.name : '',
          name: name,
          phone: phone,
          note: note,
        },
      },
    }, CONFIG.CALENDAR_ID);
    invalidateAvailability_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, event: manualView_(ev) };
}

/** Deletes an appointment she added on her page; online bookings and other events are refused. */
function adminDeleteEvent_(id) {
  var NOT_FOUND = { ok: false, error: 'not_found' };
  if (!validEventId_(id)) return NOT_FOUND;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ev;
    try {
      ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id);
    } catch (err) {
      return NOT_FOUND;
    }
    if (!ev || ev.status === 'cancelled' || privateProps_(ev).pargiManual !== '1') return NOT_FOUND;
    Calendar.Events.remove(CONFIG.CALENDAR_ID, id);
    invalidateAvailability_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}
