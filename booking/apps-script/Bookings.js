/**
 * Bookings: create, look up, cancel, remind. Services come from the website's pricing.json, so
 * the price list and the booking system can never disagree.
 */

// ---------- services ----------

/** Bookable services by id: { id: {id, name, duration, price} }. */
function services_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('services:v1');
  if (cached) return JSON.parse(cached);
  var props = PropertiesService.getScriptProperties();
  var map = null;
  try {
    var res = UrlFetchApp.fetch(CONFIG.SITE_URL + CONFIG.PRICING_PATH, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      map = {};
      JSON.parse(res.getContentText()).services.forEach(function (s) {
        if (s.id && s.duration > 0 && s.bookable !== false) {
          map[s.id] = { id: s.id, name: s.name, duration: s.duration, price: s.price };
        }
      });
      props.setProperty('SERVICES_BACKUP', JSON.stringify(map)); // last good copy, about 4 KB
    }
  } catch (err) {
    console.error('pricing.json fetch failed: ' + err);
  }
  if (!map) map = JSON.parse(props.getProperty('SERVICES_BACKUP') || '{}');
  cache.put('services:v1', JSON.stringify(map), 600);
  return map;
}

// ---------- input checks ----------

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** E.164 for Estonian and international numbers, or '' when it does not look like a phone. */
function normalizePhone_(raw) {
  var s = String(raw || '').replace(/[\s\-().\/]/g, '');
  if (/^00\d+$/.test(s)) s = '+' + s.slice(2);
  if (/^\+\d{7,15}$/.test(s)) return s;
  if (/^\d{7,8}$/.test(s)) return '+372' + s;           // local Estonian number
  if (/^372\d{7,8}$/.test(s)) return '+' + s;
  return '';
}

function validEmail_(s) {
  return s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(s);
}

function checkCustomer_(body) {
  var c = {
    name: clean_(body.name, 80),
    phoneRaw: clean_(body.phone, 30),
    email: clean_(body.email, 254).toLowerCase(),
    comment: String(body.comment == null ? '' : body.comment).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500),
  };
  c.phone = normalizePhone_(c.phoneRaw);
  var bad = [];
  if (c.name.length < 2) bad.push('name');
  if (!c.phone) bad.push('phone');
  if (!validEmail_(c.email)) bad.push('email');
  return { customer: c, bad: bad };
}

// ---------- create ----------

function createBooking_(body) {
  if (body.website) return { ok: false, error: 'invalid' }; // honeypot field humans never see
  var service = services_()[String(body.serviceId || '')];
  if (!service) return { ok: false, error: 'invalid_service' };
  var checked = checkCustomer_(body);
  if (checked.bad.length) return { ok: false, error: 'invalid', fields: checked.bad };
  var c = checked.customer;
  var startMs = Number(body.startMs);
  if (!isFinite(startMs) || Math.floor(startMs) !== startMs) return { ok: false, error: 'slot_taken' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ev;
  try {
    var h = horizon_();
    if (startMs < h.now || startMs >= h.toMs) return { ok: false, error: 'slot_taken' };

    var upcoming = listBookings_(h.now, h.toMs).filter(function (b) {
      var p = privateProps_(b);
      return p.email === c.email || p.phone === c.phone;
    });
    if (upcoming.length >= CONFIG.MAX_UPCOMING_PER_CONTACT) return { ok: false, error: 'too_many' };

    var free = PargiSlots.isSlotFree({
      windows: windowsFor_(h.fromDate, h.days),
      busy: busyIntervals_(startMs - DAY_MS, startMs + DAY_MS),
      durationMin: service.duration,
      bufferMin: CONFIG.BUFFER_MIN,
      stepMin: CONFIG.STEP_MIN,
      notBeforeMs: h.now + CONFIG.MIN_NOTICE_MIN * MINUTE_MS,
    }, startMs);
    if (!free) return { ok: false, error: 'slot_taken' };

    var cache = CacheService.getScriptCache();
    var dayKey = 'count:' + PargiSlots.localParts(h.now).date;
    var count = Number(cache.get(dayKey) || 0);
    if (count >= CONFIG.MAX_BOOKINGS_PER_DAY) return { ok: false, error: 'daily_limit' };

    ev = Calendar.Events.insert(bookingEvent_(service, startMs, c, h.now), CONFIG.CALENDAR_ID);
    cache.put(dayKey, String(count + 1), 26 * 3600);
    invalidateAvailability_();
  } finally {
    lock.releaseLock();
  }

  var booking = bookingSummary_(ev);
  booking.token = token_(ev.id);
  sendSafely_(function () { mailConfirmation_(booking, c); });
  if (CONFIG.NOTIFY_OWNER) sendSafely_(function () { mailOwnerNew_(booking, c); });
  return { ok: true, booking: booking };
}

function bookingEvent_(service, startMs, c, createdMs) {
  var endMs = startMs + service.duration * MINUTE_MS;
  var lines = [
    'Teenus: ' + service.name + ' (' + service.duration + ' min, ' + service.price + ' €)',
    'Klient: ' + c.name,
    'Telefon: ' + c.phoneRaw + (c.phoneRaw.replace(/\s/g, '') !== c.phone ? ' (' + c.phone + ')' : ''),
    'E-post: ' + c.email,
  ];
  if (c.comment) lines.push('Kommentaar: ' + c.comment);
  lines.push('', 'Broneeritud veebis ' + formatShortEt_(createdMs) + '.');
  return {
    summary: c.name + ' · ' + service.name,
    location: CONFIG.ADDRESS,
    description: lines.join('\n'),
    start: { dateTime: new Date(startMs).toISOString(), timeZone: 'Europe/Tallinn' },
    end: { dateTime: new Date(endMs).toISOString(), timeZone: 'Europe/Tallinn' },
    colorId: CONFIG.EVENT_COLOR_ID,
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        pargi: '1',
        serviceId: service.id,
        serviceName: service.name,
        price: String(service.price),
        name: c.name,
        phone: c.phone,
        email: c.email,
        createdMs: String(createdMs),
        reminderSent: '0',
      },
    },
  };
}

/** What the customer may see about a booking. Times come from the event, so moves by Ilvi count. */
function bookingSummary_(ev) {
  var p = privateProps_(ev);
  var startMs = eventStartMs_(ev);
  return {
    id: ev.id,
    serviceId: p.serviceId,
    serviceName: p.serviceName,
    price: Number(p.price),
    startMs: startMs,
    durationMin: Math.round((eventEndMs_(ev) - startMs) / MINUTE_MS),
    firstName: String(p.name || '').split(' ')[0],
    cancelDeadlineMs: startMs - CONFIG.CANCEL_DEADLINE_HOURS * HOUR_MS,
  };
}

// ---------- look up and cancel ----------

function lookupBooking_(id, t) {
  if (!tokenOk_(id, t)) return { ok: false, error: 'not_found' };
  var ev = getBookingEvent_(id);
  if (!ev) return { ok: false, error: 'not_found' };
  var b = bookingSummary_(ev);
  b.cancellable = nowMs() < b.cancelDeadlineMs;
  return { ok: true, booking: b };
}

function cancelBooking_(id, t) {
  if (!tokenOk_(id, t)) return { ok: false, error: 'not_found' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ev, booking;
  try {
    ev = getBookingEvent_(id);
    if (!ev) return { ok: false, error: 'not_found' };
    booking = bookingSummary_(ev);
    if (nowMs() >= booking.cancelDeadlineMs) return { ok: false, error: 'too_late' };
    Calendar.Events.remove(CONFIG.CALENDAR_ID, id);
    invalidateAvailability_();
  } finally {
    lock.releaseLock();
  }
  var p = privateProps_(ev);
  var c = { name: p.name, phone: p.phone, phoneRaw: p.phone, email: p.email };
  sendSafely_(function () { mailCancelled_(booking, c); });
  if (CONFIG.NOTIFY_OWNER) sendSafely_(function () { mailOwnerCancelled_(booking, c); });
  return { ok: true };
}

// ---------- reminders (time-driven trigger, hourly) ----------

function sendReminders() {
  var now = nowMs();
  listBookings_(now, now + CONFIG.REMINDER_HOURS_BEFORE * HOUR_MS).forEach(function (ev) {
    var p = privateProps_(ev);
    if (p.reminderSent && p.reminderSent !== '0') return;
    var startMs = eventStartMs_(ev);
    if (startMs <= now || !p.email) return;
    if (startMs - Number(p.createdMs || 0) < CONFIG.REMINDER_MIN_LEAD_HOURS * HOUR_MS) {
      setPrivateProps_(ev, { reminderSent: 'skip' }); // confirmation e-mail was recent enough
      return;
    }
    var booking = bookingSummary_(ev);
    booking.token = token_(ev.id);
    booking.cancellable = now < booking.cancelDeadlineMs;
    var ok = sendSafely_(function () { mailReminder_(booking, { name: p.name, email: p.email }); });
    if (ok) setPrivateProps_(ev, { reminderSent: '1' });
  });
}

// ---------- one-time setup (run from the Apps Script editor) ----------

/** Creates the signing secret and the hourly reminder trigger, and checks access. Safe to re-run. */
function setup() {
  secret_();
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sendReminders'; });
  if (!has) ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  var n = Object.keys(services_()).length;
  var probe = Calendar.Events.list(CONFIG.CALENDAR_ID, { maxResults: 1, timeMin: new Date().toISOString() });
  var msg = 'OK: ' + n + ' bookable services, calendar reachable (' + ((probe.items || []).length) +
    ' upcoming event sampled), reminder trigger ' + (has ? 'already present' : 'created') +
    ', e-mail quota left today: ' + MailApp.getRemainingDailyQuota() + '.';
  console.log(msg);
  return msg;
}

function sendSafely_(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    console.error('mail failed: ' + ((err && err.stack) || err));
    return false;
  }
}
