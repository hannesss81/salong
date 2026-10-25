/**
 * Opening hours as Ilvi sets them on the admin page. Stored in Script Properties as
 * SCHEDULE = { weekly: {isoDow: ranges} | null, days: {'YYYY-MM-DD': ranges} }, where a day's
 * ranges replace the weekly default for that date and an empty list closes it.
 */

/** What is stored: weekly is null while Ilvi hasn't changed the defaults in Config.js. */
function getStoredSchedule_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SCHEDULE');
  var stored = raw ? JSON.parse(raw) : {};
  return { weekly: stored.weekly || null, days: stored.days || {} };
}

/** The hours in force. */
function getSchedule_() {
  var stored = getStoredSchedule_();
  return { weekly: stored.weekly || CONFIG.WEEKLY_HOURS, days: stored.days };
}

function saveSchedule_(schedule) {
  var today = PargiSlots.localParts(nowMs()).date;
  var days = {};
  Object.keys(schedule.days || {}).sort().forEach(function (d) {
    if (d >= today) days[d] = schedule.days[d]; // past days are dropped to stay well under 9 KB
  });
  PropertiesService.getScriptProperties().setProperty('SCHEDULE', JSON.stringify({ weekly: schedule.weekly, days: days }));
  invalidateAvailability_();
}

var HHMM_RE_ = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes_(hhmm) {
  var m = HHMM_RE_.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Ranges like [['09:30', '14:00'], ['15:00', '20:00']]: valid, ascending, not overlapping. */
function validRanges_(ranges) {
  if (!Array.isArray(ranges) || ranges.length > 3) return false;
  var prevEnd = -1;
  for (var i = 0; i < ranges.length; i++) {
    var r = ranges[i];
    if (!Array.isArray(r) || r.length !== 2) return false;
    var a = toMinutes_(r[0]), b = toMinutes_(r[1]);
    if (!(a >= 0 && b > a) || a % 5 || b % 5 || a < prevEnd) return false;
    prevEnd = b;
  }
  return true;
}

function validDateKey_(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return PargiSlots.addDays(d, 0) === d; // rejects 2026-13-01, 2026-02-30
}
