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
      try {
        props.setProperty('SERVICES_BACKUP', JSON.stringify(map)); // last good copy, about 5 KB of 9 KB
      } catch (err) {
        console.error('services backup not saved: ' + err);
      }
    }
  } catch (err) {
    console.error('pricing.json fetch failed: ' + err);
  }
  if (!map) map = JSON.parse(props.getProperty('SERVICES_BACKUP') || '{}');
  if (Object.keys(map).length) cache.put('services:v1', JSON.stringify(map), 600); // never cache "none"
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
  return s.length <= 254 && /^[A-Za-z0-9._+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s);
}

/** Letters (Latin incl. õäöüšž, Cyrillic), spaces, hyphens, apostrophes and dots only. */
var NAME_RE_ = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0400-\u04FF][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0400-\u04FF .'\u2019-]*$/;

function checkCustomer_(body) {
  var c = {
    name: clean_(body.name, 80),
    phoneRaw: clean_(body.phone, 30),
    email: clean_(body.email, 254).toLowerCase(),
    comment: String(body.comment == null ? '' : body.comment).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500),
  };
  c.phone = normalizePhone_(c.phoneRaw);
  var bad = [];
  if (c.name.length < 2 || !NAME_RE_.test(c.name)) bad.push('name');
  if (!c.phone) bad.push('phone');
  if (!validEmail_(c.email)) bad.push('email');
  return { customer: c, bad: bad };
}

// ---------- create ----------

function createBooking_(body) {
  var service = services_()[String(body.serviceId || '')];
  if (!service) return { ok: false, error: 'invalid_service' };
  var startMs = Number(body.startMs);
  if (body.website) { // honeypot field humans never see: answer like a success, do nothing
    return { ok: true, booking: { id: 'x', serviceId: service.id, serviceName: service.name, price: service.price,
      startMs: startMs, durationMin: service.duration, firstName: '', mailed: true } };
  }
  var checked = checkCustomer_(body);
  if (checked.bad.length) return { ok: false, error: 'invalid', fields: checked.bad };
  var c = checked.customer;
  if (!isFinite(startMs) || Math.floor(startMs) !== startMs) return { ok: false, error: 'slot_taken' };
  var requestId = /^[A-Za-z0-9-]{8,64}$/.test(String(body.requestId || '')) ? String(body.requestId) : '';
  // Each booking costs two recipients now and one reminder later; keep a reserve for those.
  if (MailApp.getRemainingDailyQuota() < CONFIG.MAIL_QUOTA_RESERVE) return { ok: false, error: 'unavailable' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ev;
  try {
    var h = horizon_();
    if (requestId) { // a retry of a request that already succeeded (e.g. after a timeout)
      var same = listEvents_(CONFIG.CALENDAR_ID, h.now - DAY_MS, h.toMs, { privateExtendedProperty: 'rid=' + requestId })
        .filter(function (e) { return privateProps_(e).pargi === '1' && e.status !== 'cancelled'; })[0];
      if (same) {
        var again = bookingSummary_(same);
        again.mailed = true;
        return { ok: true, booking: again };
      }
    }
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

    var today = PargiSlots.localParts(h.now).date;
    var props = PropertiesService.getScriptProperties();
    var counter = JSON.parse(props.getProperty('DAILY_COUNT') || '{}');
    var count = counter.date === today ? Number(counter.n) || 0 : 0;
    if (count >= CONFIG.MAX_BOOKINGS_PER_DAY) return { ok: false, error: 'daily_limit' };

    ev = Calendar.Events.insert(bookingEvent_(service, startMs, c, h.now, requestId), CONFIG.CALENDAR_ID);
    // The booking exists from here on: nothing below may turn it into an error for the customer.
    try {
      props.setProperty('DAILY_COUNT', JSON.stringify({ date: today, n: count + 1 }));
      invalidateAvailability_();
    } catch (err) {
      console.error('post-insert bookkeeping failed: ' + err);
    }
  } finally {
    lock.releaseLock();
  }

  var booking = bookingSummary_(ev);
  var withToken = Object.assign({ token: token_(ev.id) }, booking);
  booking.mailed = sendSafely_(function () { mailConfirmation_(withToken, c); });
  if (CONFIG.NOTIFY_OWNER) sendSafely_(function () { mailOwnerNew_(withToken, c); });
  return { ok: true, booking: booking }; // the cancel token travels only by e-mail
}

function bookingEvent_(service, startMs, c, createdMs, requestId) {
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
        rid: requestId || '',
        reminderFor: '', // start time (ms) the last reminder was sent for
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
    try {
      remindOne_(ev, now);
    } catch (err) {
      console.error('reminder for ' + ev.id + ' failed: ' + ((err && err.stack) || err));
    }
  });
}

function remindOne_(ev, now) {
  var p = privateProps_(ev);
  var startMs = eventStartMs_(ev);
  var key = String(startMs); // a booking Ilvi moves gets a fresh reminder for its new time
  if (startMs <= now || !p.email || p.reminderFor === key || p.reminderSkip === key) return;
  if (startMs - Number(p.createdMs || 0) < CONFIG.REMINDER_MIN_LEAD_HOURS * HOUR_MS) {
    setPrivateProps_(ev, { reminderSkip: key }); // the confirmation e-mail is recent enough
    return;
  }
  // Claim first: if the claim fails nothing is sent; if sending fails the claim is undone
  // and the next hourly run tries again. A reminder is never sent twice.
  setPrivateProps_(ev, { reminderFor: key });
  var booking = bookingSummary_(ev);
  booking.token = token_(ev.id);
  booking.cancellable = now < booking.cancelDeadlineMs;
  var ok = sendSafely_(function () { mailReminder_(booking, { name: p.name, email: p.email }); });
  if (!ok) setPrivateProps_(ev, { reminderFor: '' });
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
