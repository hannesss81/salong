/**
 * Web API. Deployed as a web app that runs as the salon's Google account and is open to anyone.
 *
 * GET  ?action=availability            opening windows and busy times for the next HORIZON_DAYS
 * GET  ?action=booking&id=..&t=..      a booking's summary (for the cancel page)
 * GET  ?action=ping                    health check
 * POST {action:'book', serviceIds:[...], startMs, name, phone, email, comment, website}
 * POST {action:'cancel', id, t}
 *
 * POST bodies are sent as text/plain so browsers skip the CORS preflight Apps Script cannot answer.
 */

/** Current time; replaced by the tests. */
function nowMs() {
  return Date.now();
}

// Customer-only invitations, never admin credentials. The fragment is posted in the body,
// not sent in a query string. Rotating/clearing the hash invalidates both invitation forms.
function customerBookingAllowed_(invite) {
  if (CONFIG.PUBLIC_BOOKING_OPEN === true) return true;
  var hash = CONFIG.TRIAL_INVITE_HASH;
  if (!hash || typeof invite !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(invite)) return false;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, invite);
  var digest = Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  return safeEqual_(digest, hash) || safeEqual_(invite, ownerTrialInvite_());
}
function ownerTrialInvite_() { return CONFIG.TRIAL_INVITE_HASH ? hmac_('customer-trial:' + CONFIG.TRIAL_INVITE_HASH) : ''; }
function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(function () {
    switch (p.action) {
      case 'availability': return CONFIG.PUBLIC_BOOKING_OPEN === true ? getAvailability_() : {ok:false, error:'booking_closed'};
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
      case 'trial_availability': return customerBookingAllowed_(body.trial) ? getAvailability_() : {ok:false, error:'booking_closed'};
      case 'book': return createBooking_(body);
      case 'cancel': return cancelBooking_(body.id, body.t);
      default:
        if (/^admin_/.test(String(body && body.action))) return handleAdmin_(body);
        return { ok: false, error: 'unknown_action' };
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
