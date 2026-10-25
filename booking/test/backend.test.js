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
  assert.ok(r.booking.id && r.booking.token);
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
  assert.equal(toCustomer.attachments[0].type, 'text/calendar');
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
  assert.equal(spam.ok, false);
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
  const ok = gas.get({ action: 'booking', id: r.booking.id, t: r.booking.token });
  assert.equal(ok.ok, true);
  assert.equal(ok.booking.serviceName, 'Näopuhastus');
  assert.equal(ok.booking.firstName, 'Mari');
  assert.equal(ok.booking.cancellable, true);
  assert.equal(ok.booking.phone, undefined, 'lookup does not reveal contact details');
  assert.equal(gas.get({ action: 'booking', id: r.booking.id, t: 'vale' }).error, 'not_found');
  assert.equal(gas.get({ action: 'booking', id: 'olematu', t: r.booking.token }).error, 'not_found');
});

test('cancel: frees the slot and notifies both sides; only once and only with the token', () => {
  const gas = setup();
  const start = L('2026-11-05', '10:00');
  const r = book(gas, start);
  gas.outbox.length = 0;
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: 'vale' }).error, 'not_found');
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: r.booking.token }).ok, true);
  assert.equal(gas.outbox.length, 2);
  assert.ok(gas.outbox.some(m => m.to === 'mari@example.com' && /tühistatud/i.test(m.subject)));
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: r.booking.token }).error, 'not_found');
  assert.equal(book(gas, start).ok, true, 'slot is free again');
});

test('cancel: refused inside the 24 h deadline', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-02', '15:00'));
  assert.equal(r.ok, true, JSON.stringify(r));
  const look = gas.get({ action: 'booking', id: r.booking.id, t: r.booking.token });
  assert.equal(look.booking.cancellable, false);
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: r.booking.token }).error, 'too_late');
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
  const r = book(gas, L('2026-11-03', '10:00'), { name: 'Mari <b>Maasikas</b>', comment: '<script>alert(1)</script> ja õunad' });
  assert.equal(r.ok, true);
  const owner = gas.outbox.find(m => m.to === 'ilvi.test@example.com');
  assert.ok(!owner.htmlBody.includes('<script>') && !owner.htmlBody.includes('<b>Maasikas'));
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
  gas.calendar.api.Events.remove('primary', r.booking.id);
  assert.equal(gas.get({ action: 'booking', id: r.booking.id, t: r.booking.token }).error, 'not_found');
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t: r.booking.token }).error, 'not_found');
});

test('services fall back to the last good copy when the website is unreachable', () => {
  const gas = setup();
  assert.equal(book(gas, L('2026-11-03', '10:00')).ok, true); // loads and backs up pricing.json
  gas.cache.clear();
  gas.ctx.UrlFetchApp.fetch = () => { throw new Error('DNS failure'); };
  assert.equal(book(gas, L('2026-11-04', '10:00')).ok, true);
});
