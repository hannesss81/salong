/**
 * Web API. Deployed as a web app that runs as the salon's Google account and is open to anyone.
 *
 * GET  ?action=availability            opening windows and busy times for the next HORIZON_DAYS
 * GET  ?action=booking&id=..&t=..      a booking's summary (for the cancel page)
 * GET  ?action=ping                    health check
 * POST {action:'book', serviceId, startMs, name, phone, email, comment, website}
 * POST {action:'cancel', id, t}
 *
 * POST bodies are sent as text/plain so browsers skip the CORS preflight Apps Script cannot answer.
 */

/** Current time; replaced by the tests. */
function nowMs() {
  return Date.now();
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(function () {
    switch (p.action) {
      case 'availability': return getAvailability_();
      case 'booking': return lookupBooking_(p.id, p.t);
      case 'ping': return { ok: true, now: nowMs() };
      default: return { ok: false, error: 'unknown_action' };
    }
  });
}

function doPost(e) {
  return respond_(function () {
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (err) {
      return { ok: false, error: 'bad_request' };
    }
    switch (body && body.action) {
      case 'book': return createBooking_(body);
      case 'cancel': return cancelBooking_(body.id, body.t);
      default: return { ok: false, error: 'unknown_action' };
    }
  });
}

function respond_(handler) {
  var out;
  try {
    out = handler();
  } catch (err) {
    console.error((err && err.stack) || err);
    out = { ok: false, error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
