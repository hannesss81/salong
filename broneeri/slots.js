/*
 * Pargi Ilustuudio booking: slot engine.
 *
 * Pure functions shared by the booking page (browser) and the Google Apps Script backend.
 * The backend keeps an identical copy in booking/apps-script/Slots.js
 * (written by booking/dev/sync.js; a test fails if the copies differ).
 *
 * All instants are epoch milliseconds. Local dates and times are Europe/Tallinn.
 */
var PargiSlots = (function () {
  'use strict';

  var MIN = 60 * 1000;
  var DAY = 24 * 60 * MIN;

  // Last Sunday of the given month (0-based), as a UTC day number.
  function lastSundayUtc(year, month) {
    var lastDay = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay());
  }

  /**
   * Offset of Europe/Tallinn from UTC in minutes at the given instant.
   * EU rule: summer time (UTC+3) from the last Sunday of March 01:00 UTC
   * to the last Sunday of October 01:00 UTC; otherwise UTC+2.
   */
  function tallinnOffsetMin(ms) {
    var year = new Date(ms).getUTCFullYear();
    var dstStart = lastSundayUtc(year, 2) + 60 * MIN;
    var dstEnd = lastSundayUtc(year, 9) + 60 * MIN;
    return ms >= dstStart && ms < dstEnd ? 180 : 120;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseDateKey(dateKey) {
    var p = dateKey.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  function dateKeyFromUtcDate(dt) {
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }

  /** 'YYYY-MM-DD' plus n calendar days. */
  function addDays(dateKey, n) {
    var p = parseDateKey(dateKey);
    return dateKeyFromUtcDate(new Date(Date.UTC(p.y, p.m - 1, p.d + n)));
  }

  /**
   * Instant of a Tallinn wall-clock time. In the repeated autumn hour the first (summer)
   * occurrence wins; times inside the spring gap do not exist and are not used by the salon.
   */
  function localToUtc(dateKey, hhmm) {
    var p = parseDateKey(dateKey);
    var t = hhmm.split(':');
    var naive = Date.UTC(p.y, p.m - 1, p.d, +t[0], +t[1]);
    var off = tallinnOffsetMin(naive - 180 * MIN);
    var ms = naive - off * MIN;
    var off2 = tallinnOffsetMin(ms);
    return off2 === off ? ms : naive - off2 * MIN;
  }

  /** Tallinn calendar fields of an instant. isoDow: 1 = Monday ... 7 = Sunday. */
  function localParts(ms) {
    var dt = new Date(ms + tallinnOffsetMin(ms) * MIN);
    return {
      date: dateKeyFromUtcDate(dt),
      time: pad2(dt.getUTCHours()) + ':' + pad2(dt.getUTCMinutes()),
      isoDow: dt.getUTCDay() || 7,
      minutes: dt.getUTCHours() * 60 + dt.getUTCMinutes(),
    };
  }

  /** Easter Sunday (Gregorian, anonymous algorithm) as 'YYYY-MM-DD'. */
  function easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  /** Estonian public holidays (riigipühad) of a year, sorted. */
  function estonianHolidays(year) {
    var easter = easterSunday(year);
    var fixed = ['01-01', '02-24', '05-01', '06-23', '06-24', '08-20', '12-24', '12-25', '12-26']
      .map(function (md) { return year + '-' + md; });
    return fixed.concat([addDays(easter, -2), easter, addDays(easter, 49)]).sort();
  }

  /**
   * Bookable windows [startMs, endMs] for `days` dates from `fromDate`.
   * weekly: { isoDow: [['HH:MM', 'HH:MM'], ...] }; closedDates: ['YYYY-MM-DD', ...].
   */
  function buildWindows(opts) {
    var out = [];
    var closed = {};
    (opts.closedDates || []).forEach(function (d) { closed[d] = true; });
    for (var i = 0; i < opts.days; i++) {
      var date = addDays(opts.fromDate, i);
      if (closed[date]) continue;
      var dow = localParts(localToUtc(date, '12:00')).isoDow;
      (opts.weekly[dow] || []).forEach(function (r) {
        out.push([localToUtc(date, r[0]), localToUtc(date, r[1])]);
      });
    }
    return out;
  }

  /** Sorts intervals and merges the overlapping or touching ones. */
  function mergeIntervals(list) {
    var sorted = list.slice().sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    sorted.forEach(function (iv) {
      var last = out[out.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else out.push([iv[0], iv[1]]);
    });
    return out;
  }

  /**
   * Start instants at which a service can be booked.
   * opts: windows [[s, e]], busy [[s, e]], durationMin, bufferMin, stepMin, notBeforeMs.
   * The service [t, t + duration] must lie inside one window and keep bufferMin of free time
   * before and after every busy interval. Starts sit on the stepMin grid (Tallinn's UTC offsets
   * are whole hours, so the epoch grid equals the local quarter-hour grid).
   */
  function computeSlots(opts) {
    var step = opts.stepMin * MIN;
    var dur = opts.durationMin * MIN;
    var buf = opts.bufferMin * MIN;
    var busy = mergeIntervals((opts.busy || []).map(function (b) { return [b[0] - buf, b[1] + buf]; }));
    var windows = mergeIntervals(opts.windows || []);
    var out = [];
    var i = 0;
    windows.forEach(function (w) {
      var t = Math.ceil(Math.max(w[0], opts.notBeforeMs || 0) / step) * step;
      for (; t + dur <= w[1]; t += step) {
        while (i < busy.length && busy[i][1] <= t) i++;
        if (i < busy.length && busy[i][0] < t + dur) continue;
        out.push(t);
      }
    });
    return out;
  }

  /** True when startMs is one of the slots computeSlots would offer. */
  function isSlotFree(opts, startMs) {
    return computeSlots(opts).indexOf(startMs) !== -1;
  }

  /** { 'YYYY-MM-DD': [ms, ...] } in chronological order. */
  function groupByDay(slots) {
    var out = {};
    slots.slice().sort(function (a, b) { return a - b; }).forEach(function (ms) {
      var d = localParts(ms).date;
      (out[d] = out[d] || []).push(ms);
    });
    return out;
  }

  return {
    tallinnOffsetMin: tallinnOffsetMin,
    addDays: addDays,
    localToUtc: localToUtc,
    localParts: localParts,
    estonianHolidays: estonianHolidays,
    buildWindows: buildWindows,
    computeSlots: computeSlots,
    isSlotFree: isSlotFree,
    groupByDay: groupByDay,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PargiSlots;
