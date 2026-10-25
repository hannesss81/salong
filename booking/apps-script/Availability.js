/**
 * Opening windows and busy times. The booking page computes the offered start times from these
 * with the shared slot engine (Slots.js); createBooking_ re-checks with fresh data.
 */
var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;

/** Today (Tallinn) through HORIZON_DAYS ahead. */
function horizon_() {
  var now = nowMs();
  var today = PargiSlots.localParts(now).date;
  return {
    now: now,
    fromDate: today,
    days: CONFIG.HORIZON_DAYS,
    fromMs: PargiSlots.localToUtc(today, '00:00'),
    toMs: PargiSlots.localToUtc(PargiSlots.addDays(today, CONFIG.HORIZON_DAYS), '00:00'),
  };
}

function closedDates_(fromDate, days) {
  var out = (CONFIG.CLOSED_DATES || []).slice();
  if (CONFIG.CLOSED_ON_PUBLIC_HOLIDAYS) {
    var y1 = Number(fromDate.slice(0, 4));
    var y2 = Number(PargiSlots.addDays(fromDate, days).slice(0, 4));
    for (var y = y1; y <= y2; y++) out = out.concat(PargiSlots.estonianHolidays(y));
  }
  return out;
}

function windowsFor_(fromDate, days) {
  return PargiSlots.buildWindows({
    fromDate: fromDate, days: days, weekly: CONFIG.WEEKLY_HOURS, closedDates: closedDates_(fromDate, days),
  });
}

/** Busy interval of one calendar event, or null when it does not block time. */
function eventBusy_(ev) {
  if (!ev || ev.status === 'cancelled') return null;
  if (ev.start && ev.start.date) {
    if (!CONFIG.ALL_DAY_EVENTS_BLOCK) return null;
    return [PargiSlots.localToUtc(ev.start.date, '00:00'), PargiSlots.localToUtc(ev.end.date, '00:00')];
  }
  if (ev.transparency === 'transparent') return null; // marked "Free" in Google Calendar
  var self = (ev.attendees || []).filter(function (a) { return a.self; })[0];
  if (self && self.responseStatus === 'declined') return null;
  return [Date.parse(ev.start.dateTime), Date.parse(ev.end.dateTime)];
}

function busyIntervals_(fromMs, toMs) {
  var out = [];
  CONFIG.BUSY_CALENDAR_IDS.forEach(function (calendarId) {
    listEvents_(calendarId, fromMs, toMs).forEach(function (ev) {
      var b = eventBusy_(ev);
      if (b) out.push(b);
    });
  });
  return out;
}

/**
 * Keeps only the parts of busy intervals that can affect a booking (opening hours plus the
 * buffer), so the public response does not reveal the rest of her calendar.
 */
function clipBusy_(busy, windows, bufferMs) {
  var out = [];
  busy.forEach(function (b) {
    windows.forEach(function (w) {
      var s = Math.max(b[0], w[0] - bufferMs);
      var e = Math.min(b[1], w[1] + bufferMs);
      if (s < e) out.push([s, e]);
    });
  });
  out.sort(function (a, b) { return a[0] - b[0]; });
  var merged = [];
  out.forEach(function (iv) {
    var last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push(iv);
  });
  return merged;
}

function availabilityCacheKey_(fromDate) {
  return 'avail:v1:' + fromDate;
}

function invalidateAvailability_() {
  CacheService.getScriptCache().remove(availabilityCacheKey_(PargiSlots.localParts(nowMs()).date));
}

function getAvailability_() {
  var h = horizon_();
  var cache = CacheService.getScriptCache();
  var key = availabilityCacheKey_(h.fromDate);
  var data = null;
  var cached = cache.get(key);
  if (cached) data = JSON.parse(cached);
  if (!data) {
    var windows = windowsFor_(h.fromDate, h.days);
    data = { windows: windows, busy: clipBusy_(busyIntervals_(h.fromMs, h.toMs), windows, CONFIG.BUFFER_MIN * MINUTE_MS) };
    cache.put(key, JSON.stringify(data), CONFIG.AVAILABILITY_CACHE_SECONDS);
  }
  return {
    ok: true,
    generatedMs: h.now,
    notBeforeMs: h.now + CONFIG.MIN_NOTICE_MIN * MINUTE_MS,
    horizonEndMs: h.toMs,
    bufferMin: CONFIG.BUFFER_MIN,
    stepMin: CONFIG.STEP_MIN,
    windows: data.windows,
    busy: data.busy,
  };
}
