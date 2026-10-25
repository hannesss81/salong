/**
 * Storage: the salon's Google Calendar is the database. Online bookings are ordinary events
 * tagged with the private extended property pargi=1, which also carries the customer's
 * contact details for reminders.
 */

function listEvents_(calendarId, fromMs, toMs, extraParams) {
  var items = [];
  var pageToken = null;
  do {
    var params = {
      timeMin: new Date(fromMs).toISOString(),
      timeMax: new Date(toMs).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
    };
    Object.keys(extraParams || {}).forEach(function (k) { params[k] = extraParams[k]; });
    if (pageToken) params.pageToken = pageToken;
    var res = Calendar.Events.list(calendarId, params);
    items = items.concat(res.items || []);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return items;
}

function listBookings_(fromMs, toMs) {
  return listEvents_(CONFIG.CALENDAR_ID, fromMs, toMs, { privateExtendedProperty: 'pargi=1' });
}

function privateProps_(ev) {
  return (ev && ev.extendedProperties && ev.extendedProperties.private) || {};
}

/** Event IDs from Google are base32hex; anything else is rejected before calling the API. */
function validEventId_(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{5,200}$/.test(id);
}

/** The booking event, or null when it does not exist, was deleted, or is not an online booking. */
function getBookingEvent_(id) {
  if (!validEventId_(id)) return null;
  var ev;
  try {
    ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id);
  } catch (err) {
    return null;
  }
  if (!ev || ev.status === 'cancelled' || privateProps_(ev).pargi !== '1') return null;
  return ev;
}

/** Updates private properties; the full map is sent so nothing depends on patch merge rules. */
function setPrivateProps_(ev, changes) {
  var props = {};
  var current = privateProps_(ev);
  Object.keys(current).forEach(function (k) { props[k] = current[k]; });
  Object.keys(changes).forEach(function (k) { props[k] = String(changes[k]); });
  Calendar.Events.patch({ extendedProperties: { private: props } }, CONFIG.CALENDAR_ID, ev.id);
}

function eventStartMs_(ev) {
  return ev.start.dateTime ? Date.parse(ev.start.dateTime) : PargiSlots.localToUtc(ev.start.date, '00:00');
}

function eventEndMs_(ev) {
  return ev.end.dateTime ? Date.parse(ev.end.dateTime) : PargiSlots.localToUtc(ev.end.date, '00:00');
}

/** HMAC secret for cancel links; created once (setup() does it ahead of time). */
function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('HMAC_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('HMAC_SECRET', s);
  }
  return s;
}

function token_(id) {
  var sig = Utilities.computeHmacSha256Signature(String(id), secret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 32);
}

function tokenOk_(id, t) {
  if (!validEventId_(id) || typeof t !== 'string') return false;
  var expected = token_(id);
  if (t.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ t.charCodeAt(i);
  return diff === 0;
}
