/**
 * E-mails in Estonian. Sent from the salon's Gmail with MailApp (100 recipients a day on a
 * personal account). Every customer-supplied value goes through esc_() before entering HTML.
 */

var MONTHS_ET = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august',
  'september', 'oktoober', 'november', 'detsember'];
var WEEKDAYS_ET = ['', 'esmaspäev', 'teisipäev', 'kolmapäev', 'neljapäev', 'reede', 'laupäev', 'pühapäev'];

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 'teisipäev, 3. november 2026' */
function formatDateEt_(ms) {
  var p = PargiSlots.localParts(ms);
  var d = p.date.split('-');
  return WEEKDAYS_ET[p.isoDow] + ', ' + Number(d[2]) + '. ' + MONTHS_ET[Number(d[1]) - 1] + ' ' + d[0];
}

/** '3. november' */
function formatDayMonthEt_(ms) {
  var d = PargiSlots.localParts(ms).date.split('-');
  return Number(d[2]) + '. ' + MONTHS_ET[Number(d[1]) - 1];
}

/** '25.10.2026 11:02' */
function formatShortEt_(ms) {
  var p = PargiSlots.localParts(ms);
  var d = p.date.split('-');
  return d[2] + '.' + d[1] + '.' + d[0] + ' ' + p.time;
}

function timeRange_(b) {
  return PargiSlots.localParts(b.startMs).time + '–' + PargiSlots.localParts(b.startMs + b.durationMin * MINUTE_MS).time;
}

function cancelUrl_(b) {
  return CONFIG.SITE_URL + CONFIG.BOOKING_PATH + '?tuhista=' + encodeURIComponent(b.id) + '&t=' + encodeURIComponent(b.token);
}

function bookUrl_() {
  return CONFIG.SITE_URL + CONFIG.BOOKING_PATH;
}

function priceText_(price) {
  return (Math.round(price * 100) / 100).toString().replace('.', ',') + ' €';
}

// ---------- layout ----------

function layout_(innerHtml) {
  return '<!doctype html><html lang="et"><body style="margin:0;background:#f5f3ef;">' +
    '<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Helvetica,Arial,sans-serif;' +
    'font-size:16px;line-height:1.5;color:#1a1d1a;">' +
    '<div style="font-family:Georgia,serif;font-size:22px;color:#1d6b4a;margin-bottom:16px;">' + esc_(CONFIG.SALON_NAME) + '</div>' +
    '<div style="background:#ffffff;border:1px solid #e2ded6;border-radius:12px;padding:20px;">' + innerHtml + '</div>' +
    '<p style="font-size:13px;color:#5a6560;margin-top:16px;">' + esc_(CONFIG.SALON_NAME) + ' · ' + esc_(CONFIG.ADDRESS) +
    ' · <a href="tel:' + esc_(CONFIG.PHONE.replace(/\s/g, '')) + '" style="color:#1d6b4a;">' + esc_(CONFIG.PHONE) + '</a></p>' +
    '</div></body></html>';
}

function detailsTable_(rows) {
  return '<table role="presentation" style="border-collapse:collapse;width:100%;margin:12px 0;">' +
    rows.map(function (r) {
      return '<tr><td style="padding:6px 12px 6px 0;color:#5a6560;vertical-align:top;white-space:nowrap;">' + esc_(r[0]) +
        '</td><td style="padding:6px 0;vertical-align:top;">' + r[1] + '</td></tr>';
    }).join('') + '</table>';
}

function button_(href, label) {
  return '<p style="margin:20px 0;"><a href="' + esc_(href) + '" style="display:inline-block;background:#1d6b4a;' +
    'color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold;">' + esc_(label) + '</a></p>';
}

function bookingRows_(b) {
  return [
    ['Teenus', esc_(b.serviceName)],
    ['Aeg', esc_(formatDateEt_(b.startMs)) + '<br>kell ' + esc_(timeRange_(b))],
    ['Hind', esc_(priceText_(b.price))],
    ['Aadress', '<a href="' + esc_(CONFIG.MAP_URL) + '" style="color:#1d6b4a;">' + esc_(CONFIG.ADDRESS) + '</a><br>' +
      esc_(CONFIG.ENTRANCE_NOTE)],
  ];
}

function send_(msg) {
  MailApp.sendEmail({
    to: msg.to,
    subject: msg.subject,
    body: msg.text,
    htmlBody: layout_(msg.html),
    name: CONFIG.SALON_NAME,
    replyTo: msg.replyTo || CONFIG.OWNER_EMAIL,
    attachments: msg.attachments || [],
  });
}

// ---------- customer ----------

function mailConfirmation_(b, c) {
  var when = formatDayMonthEt_(b.startMs) + ' kell ' + PargiSlots.localParts(b.startMs).time;
  var html =
    '<p>Tere, ' + esc_(b.firstName) + '!</p>' +
    '<p>Sinu broneering on kinnitatud. Ootame Sind!</p>' +
    detailsTable_(bookingRows_(b)) +
    '<p>Kui Sa ei saa tulla, palun tühista broneering vähemalt ' + CONFIG.CANCEL_DEADLINE_HOURS +
    ' tundi enne. Hiljem palun helista ' + esc_(CONFIG.PHONE) + '.</p>' +
    button_(cancelUrl_(b), 'Tühista broneering') +
    '<p>Kalendrisse lisamiseks ava manuses olev fail.</p>' +
    '<p>Kohtumiseni!<br>' + esc_(CONFIG.OWNER_NAME) + '</p>';
  var text = 'Tere, ' + b.firstName + '!\n\nSinu broneering on kinnitatud.\n\n' +
    'Teenus: ' + b.serviceName + '\nAeg: ' + formatDateEt_(b.startMs) + ' kell ' + timeRange_(b) +
    '\nHind: ' + priceText_(b.price) + '\nAadress: ' + CONFIG.ADDRESS + '. ' + CONFIG.ENTRANCE_NOTE +
    '\n\nTühistamine (kuni ' + CONFIG.CANCEL_DEADLINE_HOURS + ' tundi enne): ' + cancelUrl_(b) +
    '\nHiljem palun helista ' + CONFIG.PHONE + '.\n\nKohtumiseni!\n' + CONFIG.OWNER_NAME;
  send_({
    to: c.email,
    subject: 'Broneering kinnitatud: ' + b.serviceName + ', ' + when,
    html: html, text: text,
    attachments: [Utilities.newBlob(ics_(b), 'text/calendar; charset=utf-8', 'broneering.ics')],
  });
}

function mailCancelled_(b, c) {
  var when = formatDayMonthEt_(b.startMs) + ' kell ' + PargiSlots.localParts(b.startMs).time;
  var html = '<p>Tere, ' + esc_(b.firstName) + '!</p>' +
    '<p>Sinu broneering on tühistatud.</p>' +
    detailsTable_([['Teenus', esc_(b.serviceName)], ['Aeg', esc_(formatDateEt_(b.startMs)) + ' kell ' + esc_(timeRange_(b))]]) +
    '<p>Uue aja saad valida siit:</p>' + button_(bookUrl_(), 'Broneeri uus aeg');
  var text = 'Tere, ' + b.firstName + '!\n\nSinu broneering on tühistatud:\n' + b.serviceName + ', ' +
    formatDateEt_(b.startMs) + ' kell ' + timeRange_(b) + '\n\nUus aeg: ' + bookUrl_();
  send_({ to: c.email, subject: 'Broneering tühistatud: ' + b.serviceName + ', ' + when, html: html, text: text });
}

function mailReminder_(b, c) {
  var when = formatDateEt_(b.startMs) + ' kell ' + PargiSlots.localParts(b.startMs).time;
  var cancelPart = b.cancellable
    ? '<p>Kui Sa ei saa tulla, palun tühista:</p>' + button_(cancelUrl_(b), 'Tühista broneering')
    : '<p>Kui Sa ei saa tulla, palun helista ' + esc_(CONFIG.PHONE) + '.</p>';
  var html = '<p>Tere, ' + esc_(b.firstName) + '!</p>' +
    '<p>Tuletame meelde Sinu aega Pargi Ilustuudios.</p>' + detailsTable_(bookingRows_(b)) + cancelPart +
    '<p>Kohtumiseni!<br>' + esc_(CONFIG.OWNER_NAME) + '</p>';
  var text = 'Tere, ' + b.firstName + '!\n\nTuletame meelde: ' + b.serviceName + ', ' + when + '.\nAadress: ' +
    CONFIG.ADDRESS + '. ' + CONFIG.ENTRANCE_NOTE + '\n\n' +
    (b.cancellable ? 'Tühistamine: ' + cancelUrl_(b) : 'Kui Sa ei saa tulla, palun helista ' + CONFIG.PHONE + '.') +
    '\n\nKohtumiseni!\n' + CONFIG.OWNER_NAME;
  send_({ to: c.email, subject: 'Meeldetuletus: ' + b.serviceName + ', ' + when, html: html, text: text });
}

// ---------- owner ----------

function ownerRows_(b, c) {
  var rows = [
    ['Teenus', esc_(b.serviceName) + ' (' + b.durationMin + ' min, ' + esc_(priceText_(b.price)) + ')'],
    ['Aeg', esc_(formatDateEt_(b.startMs)) + ' kell ' + esc_(timeRange_(b))],
    ['Klient', esc_(c.name)],
    ['Telefon', '<a href="tel:' + esc_(c.phone) + '" style="color:#1d6b4a;">' + esc_(c.phoneRaw || c.phone) + '</a>'],
    ['E-post', '<a href="mailto:' + esc_(encodeURIComponent(c.email).replace(/%40/g, '@')) + '" style="color:#1d6b4a;">' + esc_(c.email) + '</a>'],
  ];
  if (c.comment) rows.push(['Kommentaar', esc_(c.comment).replace(/\n/g, '<br>')]);
  return rows;
}

function ownerSubjectTail_(b, c) {
  var p = PargiSlots.localParts(b.startMs);
  var d = p.date.split('-');
  return c.name + ', ' + b.serviceName + ', ' + Number(d[2]) + '.' + Number(d[1]) + ' kell ' + p.time;
}

function mailOwnerNew_(b, c) {
  var html = '<p><strong>Uus broneering veebist.</strong> See on juba Sinu Google\'i kalendris.</p>' +
    detailsTable_(ownerRows_(b, c)) + '<p>Vastates sellele kirjale kirjutad otse kliendile.</p>';
  var text = 'Uus broneering: ' + b.serviceName + ', ' + formatDateEt_(b.startMs) + ' kell ' + timeRange_(b) +
    '\nKlient: ' + c.name + '\nTelefon: ' + (c.phoneRaw || c.phone) + '\nE-post: ' + c.email +
    (c.comment ? '\nKommentaar: ' + c.comment : '');
  send_({ to: CONFIG.OWNER_EMAIL, subject: 'Uus broneering: ' + ownerSubjectTail_(b, c), html: html, text: text, replyTo: c.email });
}

function mailOwnerCancelled_(b, c) {
  var html = '<p><strong>Klient tühistas broneeringu.</strong> Aeg on kalendrist eemaldatud ja jälle vaba.</p>' +
    detailsTable_(ownerRows_(b, c));
  var text = 'Tühistatud: ' + b.serviceName + ', ' + formatDateEt_(b.startMs) + ' kell ' + timeRange_(b) +
    '\nKlient: ' + c.name + '\nTelefon: ' + c.phone + '\nE-post: ' + c.email;
  send_({ to: CONFIG.OWNER_EMAIL, subject: 'Tühistatud: ' + ownerSubjectTail_(b, c), html: html, text: text, replyTo: c.email });
}

// ---------- calendar file ----------

function icsText_(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsTime_(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Folds a content line at 75 octets (RFC 5545 3.1). */
function icsFold_(line) {
  var out = [];
  var cur = '';
  var bytes = 0;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    var code = line.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) { ch += line.charAt(++i); }
    var n = code < 0x80 ? 1 : code < 0x800 ? 2 : (code >= 0xd800 && code <= 0xdbff) ? 4 : 3;
    var limit = out.length ? 74 : 75;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function ics_(b) {
  var lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pargi Ilustuudio//Broneering//ET', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + b.id + '@pargiilustuudio.eu',
    'DTSTAMP:' + icsTime_(nowMs()),
    'DTSTART:' + icsTime_(b.startMs),
    'DTEND:' + icsTime_(b.startMs + b.durationMin * MINUTE_MS),
    'SUMMARY:' + icsText_(b.serviceName + ' – ' + CONFIG.SALON_NAME),
    'LOCATION:' + icsText_(CONFIG.ADDRESS),
    'DESCRIPTION:' + icsText_(CONFIG.ENTRANCE_NOTE + ' Telefon ' + CONFIG.PHONE + '. Tühistamine: ' + cancelUrl_(b)),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(icsFold_).join('\r\n') + '\r\n';
}
