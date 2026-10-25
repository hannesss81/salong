// Backend tests: the real Apps Script code running on the local fakes (booking/dev/gas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas.js');
const S = require('../../broneeri/slots.js');

// Monday 2 Nov 2026, 08:00 in Tartu. Default hours (placeholder): Mon-Fri 10-18, Sat 10-15.
const NOW = S.localToUtc('2026-11-02', '08:00');
const L = (date, hhmm) => S.localToUtc(date, hhmm);
const iso = ms => new Date(ms).toISOString();

function setup(config) {
  const gas = createGas({ quiet: true, config: Object.assign({ OWNER_EMAIL: 'ilvi.test@example.com' }, config) });
  gas.ctx.nowMs = () => NOW;
  return gas;
}
function slotsFor(av, durationMin) {
  return S.computeSlots({
    windows: av.windows, busy: av.busy, durationMin,
    bufferMin: av.bufferMin, stepMin: av.stepMin, notBeforeMs: av.notBeforeMs,
  });
}
const customer = { name: 'Mari Maasikas', phone: '5555 1234', email: 'mari@example.com', comment: 'Tundlik nahk' };
function book(gas, startMs, extra) {
  return gas.post(Object.assign({ action: 'book', serviceId: 'naopuhastus', startMs }, customer, extra));
}
/** Cancel token as the customer gets it: from the link in the confirmation e-mail. */
function tokenFromMail(gas, bookingId) {
  for (const m of gas.outbox) {
    const hit = (m.htmlBody || '').match(/tuhista=([^&"]+)&(?:amp;)?t=([^&"]+)/);
    if (hit && decodeURIComponent(hit[1]) === bookingId) return decodeURIComponent(hit[2]);
  }
  throw new Error('no cancel link for ' + bookingId);
}

test('availability: windows follow weekly hours, skip Sundays and public holidays', () => {
  const gas = setup();
  const av = gas.get({ action: 'availability' });
  assert.equal(av.ok, true);
  assert.equal(av.bufferMin, 15);
  assert.equal(av.stepMin, 15);
  assert.equal(av.notBeforeMs, NOW + 180 * 60000);
  const days = new Set(av.windows.map(w => S.localParts(w[0]).date));
  assert.ok(days.has('2026-11-02'));                // Monday
  assert.ok(!days.has('2026-11-08'));               // Sunday
  assert.ok(!days.has('2026-12-24') && !days.has('2026-12-25')); // public holidays
  assert.deepEqual(av.windows[0], [L('2026-11-02', '10:00'), L('2026-11-02', '18:00')]);
  assert.ok(av.windows.every(w => w[1] <= av.horizonEndMs));
});

test('availability: her events block time; free, declined and outside-hours events do not leak', () => {
  const gas = setup();
  gas.addEvent({ summary: 'Hambaarst', start: { dateTime: iso(L('2026-11-03', '12:00')) }, end: { dateTime: iso(L('2026-11-03', '13:00')) } });
  gas.addEvent({ summary: 'Mõttes', transparency: 'transparent', start: { dateTime: iso(L('2026-11-03', '15:00')) }, end: { dateTime: iso(L('2026-11-03', '16:00')) } });
  gas.addEvent({ summary: 'Kutse', attendees: [{ email: 'x@example.com', self: true, responseStatus: 'declined' }], start: { dateTime: iso(L('2026-11-03', '16:00')) }, end: { dateTime: iso(L('2026-11-03', '17:00')) } });
  gas.addEvent({ summary: 'Puhkus', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } });
  gas.addEvent({ summary: 'Õhtune trenn', start: { dateTime: iso(L('2026-11-05', '20:00')) }, end: { dateTime: iso(L('2026-11-05', '21:00')) } });
  const av = gas.get({ action: 'availability' });
  const busyText = av.busy.map(b => S.localParts(b[0]).date + ' ' + S.localParts(b[0]).time + '-' + S.localParts(b[1]).time);
  assert.ok(busyText.includes('2026-11-03 12:00-13:00'));
  assert.ok(!busyText.some(t => t.startsWith('2026-11-03 15') || t.startsWith('2026-11-03 16')));
  assert.ok(!busyText.some(t => t.startsWith('2026-11-05')), 'events outside opening hours are not exposed');
  const slots = S.groupByDay(slotsFor(av, 60));
  assert.equal(slots['2026-11-04'], undefined, 'all-day event closes the day');
  const tue = slots['2026-11-03'].map(ms => S.localParts(ms).time);
  assert.ok(tue.includes('10:45') && !tue.includes('11:00') && !tue.includes('13:00') && tue.includes('13:15'));
});

test('book: creates the calendar event and e-mails customer and owner', () => {
  const gas = setup();
  const start = L('2026-11-03', '10:00');
  const r = book(gas, start);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.booking.id);
  assert.equal(r.booking.token, undefined, 'the cancel token only travels by e-mail');
  assert.equal(r.booking.mailed, true);
  assert.equal(r.booking.serviceName, 'Näopuhastus');
  const ev = gas.calendar.api.Events.get('primary', r.booking.id);
  assert.equal(Date.parse(ev.start.dateTime), start);
  assert.equal(Date.parse(ev.end.dateTime), start + 60 * 60000);
  assert.match(ev.summary, /Mari Maasikas/);
  assert.match(ev.summary, /Näopuhastus/);
  assert.match(ev.description, /5555 1234/);
  assert.equal(ev.extendedProperties.private.pargi, '1');
  assert.equal(gas.outbox.length, 2);
  const toCustomer = gas.outbox.find(m => m.to === 'mari@example.com');
  const toOwner = gas.outbox.find(m => m.to === 'ilvi.test@example.com');
  assert.match(toCustomer.subject, /Näopuhastus/);
  assert.match(toCustomer.htmlBody, /3\. november 2026/);
  assert.match(toCustomer.htmlBody, /10:00/);
  assert.match(toCustomer.htmlBody, /tuhista=/);
  assert.match(toCustomer.attachments[0].type, /^text\/calendar/);
  assert.match(toCustomer.attachments[0].data, /DTSTART:20261103T080000Z/);
  assert.match(toOwner.subject, /Mari Maasikas/);
  assert.match(toOwner.htmlBody, /Tundlik nahk/);
});

test('book: the same slot or one inside the 15 min gap is refused', () => {
  const gas = setup();
  assert.equal(book(gas, L('2026-11-03', '10:00')).ok, true);
  const again = book(gas, L('2026-11-03', '10:00'), { email: 'teine@example.com', phone: '5000 0000' });
  assert.deepEqual([again.ok, again.error], [false, 'slot_taken']);
  const tooClose = book(gas, L('2026-11-03', '11:00'), { email: 'teine@example.com', phone: '5000 0000' });
  assert.equal(tooClose.error, 'slot_taken');
  assert.equal(book(gas, L('2026-11-03', '11:15'), { email: 'teine@example.com', phone: '5000 0000' }).ok, true);
});

test('book: refuses past, off-grid, closed-day and too-soon starts', () => {
  const gas = setup();
  assert.equal(book(gas, L('2026-11-02', '09:00')).error, 'slot_taken'); // before 3 h notice
  assert.equal(book(gas, L('2026-11-03', '10:05')).error, 'slot_taken'); // off the grid
  assert.equal(book(gas, L('2026-11-08', '12:00')).error, 'slot_taken'); // Sunday
  assert.equal(book(gas, L('2026-11-03', '17:30')).error, 'slot_taken'); // would end after 18:00
});

test('book: validates service and contact details', () => {
  const gas = setup();
  const start = L('2026-11-03', '10:00');
  assert.equal(book(gas, start, { serviceId: 'olematu' }).error, 'invalid_service');
  assert.equal(book(gas, start, { serviceId: 'bukaalne-massaaz-pakett' }).error, 'invalid_service');
  const bad = book(gas, start, { name: ' ', email: 'pole-meil', phone: '12' });
  assert.equal(bad.error, 'invalid');
  assert.deepEqual(bad.fields.sort(), ['email', 'name', 'phone']);
  const spam = book(gas, start, { website: 'http://spam.example' });
  assert.equal(spam.ok, true, 'bots get no signal that the trap fired');
  assert.equal(gas.outbox.length, 0);
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 0);
});

test('book: at most 3 upcoming bookings per e-mail or phone', () => {
  const gas = setup();
  ['10:00', '11:30', '13:00'].forEach(t => assert.equal(book(gas, L('2026-11-03', t)).ok, true));
  const fourth = book(gas, L('2026-11-03', '14:30'), { email: 'muu@example.com' }); // same phone
  assert.equal(fourth.error, 'too_many');
});

test('booking lookup needs the right token', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-05', '10:00'));
  const token = tokenFromMail(gas, r.booking.id);
  const ok = gas.get({ action: 'booking', id: r.booking.id, t: token });
  assert.equal(ok.ok, true);
  assert.equal(ok.booking.serviceName, 'Näopuhastus');
  assert.equal(ok.booking.firstName, 'Mari');
  assert.equal(ok.booking.cancellable, true);
  assert.equal(ok.booking.phone, undefined, 'lookup does not reveal contact details');
  assert.equal(gas.get({ action: 'booking', id: r.booking.id, t: 'vale' }).error, 'not_found');
  assert.equal(gas.get({ action: 'booking', id: 'olematu', t: token }).error, 'not_found');
});

test('cancel: frees the slot and notifies both sides; only once and only with the token', () => {
  const gas = setup();
  const start = L('2026-11-05', '10:00');
  const r = book(gas, start);
  const token = tokenFromMail(gas, r.booking.id);
  gas.outbox.length = 0;
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: 'vale' }).error, 'not_found');
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: token }).ok, true);
  assert.equal(gas.outbox.length, 2);
  assert.ok(gas.outbox.some(m => m.to === 'mari@example.com' && /tühistatud/i.test(m.subject)));
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: token }).error, 'not_found');
  assert.equal(book(gas, start).ok, true, 'slot is free again');
});

test('cancel: refused inside the 24 h deadline', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-02', '15:00'));
  assert.equal(r.ok, true, JSON.stringify(r));
  const token = tokenFromMail(gas, r.booking.id);
  const look = gas.get({ action: 'booking', id: r.booking.id, t: token });
  assert.equal(look.booking.cancellable, false);
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: token }).error, 'too_late');
});

test('reminders: sent once, a day ahead, and not for last-minute bookings', () => {
  const gas = setup();
  const early = book(gas, L('2026-11-03', '10:00'));
  const late = book(gas, L('2026-11-03', '13:00'), { email: 'jyri@example.com', phone: '5111 2222', name: 'Jüri' });
  // Pretend the first one was booked a week ago
  gas.calendar.events.get(early.booking.id).extendedProperties.private.createdMs = String(NOW - 7 * 86400000);
  gas.outbox.length = 0;
  gas.ctx.nowMs = () => L('2026-11-02', '11:00'); // 23 h before
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
  assert.equal(gas.outbox[0].to, 'mari@example.com');
  assert.match(gas.outbox[0].subject, /Meeldetuletus/);
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1, 'no second reminder');
  assert.ok(late.ok);
});

test('setup: one hourly reminder trigger and a signing secret, safe to run twice', () => {
  const gas = setup();
  gas.run('setup');
  gas.run('setup');
  assert.equal(gas.triggers.filter(t => t.fn === 'sendReminders').length, 1);
  assert.equal(gas.triggers[0].everyHours, 1);
  assert.ok((gas.props.get('HMAC_SECRET') || '').length >= 32);
});

test('unknown actions and broken requests answer with an error, not a crash', () => {
  const gas = setup();
  assert.equal(gas.get({ action: 'kustuta-koik' }).ok, false);
  const out = gas.ctx.doPost({ parameter: {}, postData: { contents: '{not json', type: 'text/plain' } });
  assert.equal(JSON.parse(out.getContent()).ok, false);
});

test('the Apps Script copy of the slot engine is in sync with the page copy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../../broneeri/slots.js'), 'utf8');
  const gasCopy = fs.readFileSync(path.join(__dirname, '../apps-script/Slots.js'), 'utf8');
  assert.ok(gasCopy.endsWith(page), 'run: node booking/dev/sync.js');
});

test('customer input is escaped in e-mails and the calendar file follows RFC 5545 line limits', () => {
  const gas = setup();
  assert.deepEqual(book(gas, L('2026-11-03', '10:00'), { name: 'Mari <b>Maasikas</b>' }).fields, ['name']);
  const r = book(gas, L('2026-11-03', '10:00'), { comment: '<script>alert(1)</script> ja <b>õunad</b>' });
  assert.equal(r.ok, true);
  const owner = gas.outbox.find(m => m.to === 'ilvi.test@example.com');
  assert.ok(!owner.htmlBody.includes('<script>') && !owner.htmlBody.includes('<b>õunad'));
  assert.match(owner.htmlBody, /&lt;script&gt;/);
  const ics = gas.outbox.find(m => m.to === 'mari@example.com').attachments[0].data;
  ics.split('\r\n').forEach(line => assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('phone numbers are normalised to international format', () => {
  const gas = setup();
  const n = s => gas.ctx.normalizePhone_(s);
  assert.equal(n('5555 1234'), '+37255551234');
  assert.equal(n('+372 5555 1234'), '+37255551234');
  assert.equal(n('00358 40 123 4567'), '+358401234567');
  assert.equal(n('372 5123 4567'), '+37251234567');
  assert.equal(n('12'), '');
  assert.equal(n('helista mulle'), '');
});

test('a booking Ilvi deleted in her calendar can no longer be looked up or cancelled', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-05', '10:00'));
  const token = tokenFromMail(gas, r.booking.id);
  gas.calendar.api.Events.remove('primary', r.booking.id);
  assert.equal(gas.get({ action: 'booking', id: r.booking.id, t: token }).error, 'not_found');
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: token }).error, 'not_found');
});

test('services fall back to the last good copy when the website is unreachable', () => {
  const gas = setup();
  assert.equal(book(gas, L('2026-11-03', '10:00')).ok, true); // loads and backs up pricing.json
  gas.cache.clear();
  gas.ctx.UrlFetchApp.fetch = () => { throw new Error('DNS failure'); };
  assert.equal(book(gas, L('2026-11-04', '10:00')).ok, true);
});


// ---------- review findings (2026-10-25) ----------

test('daily booking cap survives cache loss and uses no over-long cache entries', () => {
  const gas = setup({ MAX_BOOKINGS_PER_DAY: 2 });
  assert.equal(book(gas, L('2026-11-03', '10:00')).ok, true);
  gas.cache.clear();
  assert.equal(book(gas, L('2026-11-03', '12:00'), { email: 'b@example.com', phone: '5000 0002' }).ok, true);
  gas.cache.clear();
  const third = book(gas, L('2026-11-03', '14:00'), { email: 'c@example.com', phone: '5000 0003' });
  assert.equal(third.error, 'daily_limit');
});

test('mail failures after the event is saved still report success, with mailed=false', () => {
  const gas = setup();
  gas.ctx.MailApp.failNext = 2;
  const r = book(gas, L('2026-11-03', '10:00'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.booking.mailed, false);
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 1);
});

test('bookings stop before the Gmail quota runs out', () => {
  const gas = setup();
  gas.ctx.MailApp.quota = 8; // fewer than the reserve
  const r = book(gas, L('2026-11-03', '10:00'));
  assert.equal(r.error, 'unavailable');
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 0);
});

test('birthdays and working-location entries do not close days; out-of-office and all-day "Free" events do', () => {
  const gas = setup();
  gas.addEvent({ summary: 'Mari sünnipäev', eventType: 'birthday', transparency: 'transparent', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } });
  gas.addEvent({ summary: 'Kodus', eventType: 'workingLocation', transparency: 'transparent', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } });
  gas.addEvent({ summary: 'Puhkus', transparency: 'transparent', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } });
  gas.addEvent({ summary: 'Ära', eventType: 'outOfOffice', start: { dateTime: iso(L('2026-11-06', '10:00')) }, end: { dateTime: iso(L('2026-11-06', '18:00')) } });
  const days = S.groupByDay(slotsFor(gas.get({ action: 'availability' }), 60));
  assert.ok(days['2026-11-03'], 'birthday keeps the day open');
  assert.ok(days['2026-11-04'], 'working location keeps the day open');
  assert.equal(days['2026-11-05'], undefined, 'an all-day event she adds closes the day even when marked Free');
  assert.equal(days['2026-11-06'], undefined, 'out of office blocks');
});

test('busy times are rounded out to the quarter hour without changing the offered slots', () => {
  const gas = setup();
  gas.addEvent({ summary: 'Arst', start: { dateTime: iso(L('2026-11-03', '12:07')) }, end: { dateTime: iso(L('2026-11-03', '13:22')) } });
  const av = gas.get({ action: 'availability' });
  const b = av.busy.find(x => S.localParts(x[0]).date === '2026-11-03');
  assert.deepEqual([S.localParts(b[0]).time, S.localParts(b[1]).time], ['12:00', '13:30']);
  const tue = S.groupByDay(slotsFor(av, 60))['2026-11-03'].map(ms => S.localParts(ms).time);
  assert.ok(tue.includes('10:45') && !tue.includes('11:00') && tue.includes('13:45') && !tue.includes('13:30'));
});

test('reminder goes out two days ahead with a working cancel link', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-06', '10:00'));
  gas.outbox.length = 0;
  gas.ctx.nowMs = () => L('2026-11-04', '11:00'); // 47 h before
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
  assert.match(gas.outbox[0].htmlBody, /tuhista=/);
  assert.ok(tokenFromMail(gas, r.booking.id));
});

test('a booking Ilvi moves after the reminder gets a new reminder for the new time', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-06', '10:00'));
  gas.ctx.nowMs = () => L('2026-11-04', '11:00');
  gas.run('sendReminders');
  const ev = gas.calendar.events.get(r.booking.id); // Ilvi drags it to the day before
  ev.start.dateTime = iso(L('2026-11-05', '14:00'));
  ev.end.dateTime = iso(L('2026-11-05', '15:00'));
  gas.outbox.length = 0;
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
  assert.match(gas.outbox[0].subject, /14:00/);
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
});

test('a failed reminder is retried next hour, a sent one is never repeated', () => {
  const gas = setup();
  book(gas, L('2026-11-06', '10:00'));
  gas.outbox.length = 0;
  gas.ctx.nowMs = () => L('2026-11-04', '11:00');
  gas.ctx.MailApp.failNext = 1;
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 0);
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
  gas.run('sendReminders');
  assert.equal(gas.outbox.length, 1);
});

test('a retried request with the same requestId returns the first booking instead of a second one', () => {
  const gas = setup();
  const a = book(gas, L('2026-11-03', '10:00'), { requestId: 'req-123e4567-e89b' });
  const b = book(gas, L('2026-11-03', '10:00'), { requestId: 'req-123e4567-e89b' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.booking.id, a.booking.id);
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 1);
  assert.equal(gas.outbox.length, 2, 'no second round of e-mails');
});

test('names must look like names; e-mail addresses must be plain', () => {
  const gas = setup();
  const start = L('2026-11-03', '10:00');
  assert.deepEqual(book(gas, start, { name: 'evil.example/win€500' }).fields, ['name']);
  assert.deepEqual(book(gas, start, { name: 'Mari 2000' }).fields, ['name']);
  assert.deepEqual(book(gas, start, { email: 'a?b=c@example.com' }).fields, ['email']);
  assert.equal(book(gas, start, { name: 'Mari-Liis O’Neil' }).ok, true);
  assert.equal(book(gas, L('2026-11-03', '12:00'), { name: 'Ольга Иванова', email: 'olga@example.com', phone: '5000 0009' }).ok, true);
});

test('a failed first price-list fetch is not cached as "no services"', () => {
  const gas = setup();
  const realFetch = gas.ctx.UrlFetchApp.fetch;
  gas.ctx.UrlFetchApp.fetch = () => { throw new Error('DNS failure'); };
  assert.equal(book(gas, L('2026-11-03', '10:00')).error, 'invalid_service');
  gas.ctx.UrlFetchApp.fetch = realFetch;
  assert.equal(book(gas, L('2026-11-03', '10:00')).ok, true);
});

test('the e-mailed calendar file is declared as UTF-8', () => {
  const gas = setup();
  book(gas, L('2026-11-03', '10:00'));
  const att = gas.outbox.find(m => m.to === 'mari@example.com').attachments[0];
  assert.match(att.type, /^text\/calendar; ?charset=utf-8$/i);
});
