// Admin page backend and short-notice approvals, with the real default settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas.js');
const S = require('../../broneeri/slots.js');

const OWNER = 'ilvi.test@example.com';
const NOW = S.localToUtc('2026-11-02', '08:00'); // Monday
const L = (date, hhmm) => S.localToUtc(date, hhmm);
const iso = ms => new Date(ms).toISOString();

function setup(config) {
  const gas = createGas({ quiet: true, config: Object.assign({ OWNER_EMAIL: OWNER }, config) });
  gas.ctx.nowMs = () => NOW;
  return gas;
}
const customer = { name: 'Mari Maasikas', phone: '5555 1234', email: 'mari@example.com' };
function book(gas, startMs, extra) {
  return gas.post(Object.assign({ action: 'book', serviceId: 'naopuhastus', startMs }, customer, extra));
}
function lastMailTo(gas, to, re) {
  const list = gas.outbox.filter(m => m.to === to && (!re || re.test(m.subject + ' ' + m.htmlBody)));
  return list[list.length - 1];
}
function loginLink(gas) {
  const m = lastMailTo(gas, OWNER, /#login=/);
  return m && decodeURIComponent(m.htmlBody.match(/#login=([^"&<]+)/)[1]);
}
function session(gas) {
  gas.post({ action: 'admin_login_request' });
  const r = gas.post({ action: 'admin_session', login: loginLink(gas) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.session;
}
function approvalLink(gas, bookingId) {
  for (const m of gas.outbox.filter(x => x.to === OWNER)) {
    const hit = m.htmlBody.match(/soov=([^&"]+)&(?:amp;)?t=([^&"<]+)/);
    if (hit && decodeURIComponent(hit[1]) === bookingId) return decodeURIComponent(hit[2]);
  }
  return null;
}
function cancelToken(gas, bookingId) {
  for (const m of gas.outbox) {
    const hit = (m.htmlBody || '').match(/tuhista=([^&"]+)&(?:amp;)?t=([^&"]+)/);
    if (hit && decodeURIComponent(hit[1]) === bookingId) return decodeURIComponent(hit[2]);
  }
  return null;
}
const daySet = av => new Set(av.windows.map(w => S.localParts(w[0]).date));

// ---------- default hours ----------

test('default hours: Mon, Tue, Thu, Fri 9:30-20:00; Wed, Sat, Sun closed; 8 weeks ahead', () => {
  const gas = setup();
  const av = gas.get({ action: 'availability' });
  const days = daySet(av);
  ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06'].forEach(d => assert.ok(days.has(d), d));
  ['2026-11-04', '2026-11-07', '2026-11-08'].forEach(d => assert.ok(!days.has(d), d));
  assert.deepEqual(av.windows[0], [L('2026-11-02', '09:30'), L('2026-11-02', '20:00')]);
  assert.equal(av.horizonEndMs, L(S.addDays('2026-11-02', 56), '00:00'));
  assert.equal(av.approvalBeforeMs, NOW + 36 * 3600000, 'the page can tell which times are requests');
  const mon = S.computeSlots({ windows: av.windows, busy: [], durationMin: 60, bufferMin: 15, stepMin: 15, notBeforeMs: av.notBeforeMs })
    .filter(ms => S.localParts(ms).date === '2026-11-09').map(ms => S.localParts(ms).time);
  assert.equal(mon[0], '09:30');
  assert.equal(mon[mon.length - 1], '19:00', 'last client ends by 20:00');
});

// ---------- login ----------

test('admin login link goes only to the owner, works once and expires after 30 minutes', () => {
  const gas = setup();
  assert.equal(gas.post({ action: 'admin_login_request', email: 'attacker@example.com' }).ok, true);
  assert.ok(gas.outbox.every(m => m.to === OWNER));
  const link = loginLink(gas);
  assert.equal(gas.post({ action: 'admin_session', login: link }).ok, true);
  assert.equal(gas.post({ action: 'admin_session', login: link }).error, 'unauthorized', 'single use');
  gas.post({ action: 'admin_login_request' });
  const late = loginLink(gas);
  gas.ctx.nowMs = () => NOW + 31 * 60000;
  assert.equal(gas.post({ action: 'admin_session', login: late }).error, 'unauthorized', 'expired');
  assert.equal(gas.post({ action: 'admin_session', login: 'x.y' }).error, 'unauthorized');
});

test('at most 5 login e-mails a day, without telling the caller', () => {
  const gas = setup();
  for (let i = 0; i < 8; i++) assert.equal(gas.post({ action: 'admin_login_request' }).ok, true);
  assert.equal(gas.outbox.length, 5);
});

test('admin calls need a valid session; "log out everywhere" revokes old ones', () => {
  const gas = setup();
  assert.equal(gas.post({ action: 'admin_overview' }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'admin_overview', s: 'session-12345.abc' }).error, 'unauthorized');
  const s = session(gas);
  assert.equal(gas.post({ action: 'admin_overview', s }).ok, true);
  gas.ctx.nowMs = () => NOW + 300 * 86400000;
  assert.equal(gas.post({ action: 'admin_overview', s }).ok, true, 'session lasts most of a year');
  gas.ctx.nowMs = () => NOW;
  assert.equal(gas.post({ action: 'admin_logout_all', s }).ok, true);
  assert.equal(gas.post({ action: 'admin_overview', s }).error, 'unauthorized');
});

// ---------- hours ----------

test('opening a Saturday makes it bookable; closing a weekday removes it; reset restores the default', () => {
  const gas = setup();
  const s = session(gas);
  assert.equal(gas.post({ action: 'admin_set_days', s, dates: ['2026-11-07'], ranges: [['09:30', '14:00']] }).ok, true);
  assert.equal(gas.post({ action: 'admin_set_days', s, dates: ['2026-11-03'], ranges: [] }).ok, true);
  let av = gas.get({ action: 'availability' });
  assert.ok(av.windows.some(w => w[0] === L('2026-11-07', '09:30') && w[1] === L('2026-11-07', '14:00')));
  assert.ok(!daySet(av).has('2026-11-03'));
  assert.equal(book(gas, L('2026-11-07', '10:00')).ok, true);
  assert.equal(gas.post({ action: 'admin_set_days', s, dates: ['2026-11-03'], ranges: null }).ok, true);
  av = gas.get({ action: 'availability' });
  assert.ok(daySet(av).has('2026-11-03'));
  const ov = gas.post({ action: 'admin_overview', s });
  const sat = ov.days.find(d => d.date === '2026-11-07');
  assert.deepEqual([sat.ranges, sat.source], [[['09:30', '14:00']], 'override']);
  assert.equal(ov.days.find(d => d.date === '2026-11-03').source, 'weekly');
});

test('a range of days can be closed at once (vacation)', () => {
  const gas = setup();
  const s = session(gas);
  const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  assert.equal(gas.post({ action: 'admin_set_days', s, dates, ranges: [] }).ok, true);
  const days = daySet(gas.get({ action: 'availability' }));
  dates.forEach(d => assert.ok(!days.has(d), d));
});

test('hours are validated', () => {
  const gas = setup();
  const s = session(gas);
  const bad = [
    { dates: ['2026-11-07'], ranges: [['20:00', '09:30']] },
    { dates: ['2026-11-07'], ranges: [['9:30', '10:00']] },
    { dates: ['2026-11-07'], ranges: [['09:00', '12:00'], ['11:00', '14:00']] },
    { dates: ['2026-11-01'], ranges: [] },             // in the past
    { dates: ['2026-13-01'], ranges: [] },
    { dates: [], ranges: [] },
    { dates: ['2026-11-07'], ranges: 'kinni' },
  ];
  bad.forEach(b => assert.equal(gas.post(Object.assign({ action: 'admin_set_days', s }, b)).error, 'invalid', JSON.stringify(b)));
});

test('weekly default hours can be changed', () => {
  const gas = setup();
  const s = session(gas);
  const weekly = { 1: [['09:30', '20:00']], 2: [['09:30', '20:00']], 3: [['12:00', '18:00']], 4: [['09:30', '20:00']], 5: [['09:30', '20:00']] };
  assert.equal(gas.post({ action: 'admin_set_weekly', s, weekly }).ok, true);
  const av = gas.get({ action: 'availability' });
  assert.ok(av.windows.some(w => w[0] === L('2026-11-04', '12:00')));
  assert.deepEqual(gas.post({ action: 'admin_overview', s }).weekly['3'], [['12:00', '18:00']]);
  assert.equal(gas.post({ action: 'admin_set_weekly', s, weekly: { 9: [] } }).error, 'invalid');
});

test('overview lists bookings, her own events and all-day blocks for 8 weeks', () => {
  const gas = setup();
  const s = session(gas);
  assert.equal(book(gas, L('2026-11-05', '10:00')).ok, true);
  gas.addEvent({ summary: 'Hambaarst', start: { dateTime: iso(L('2026-11-05', '12:00')) }, end: { dateTime: iso(L('2026-11-05', '13:00')) } });
  gas.addEvent({ summary: 'Puhkus', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } });
  gas.addEvent({ summary: 'Sünnipäev', eventType: 'birthday', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } });
  const ov = gas.post({ action: 'admin_overview', s });
  assert.equal(ov.days.length, 56);
  assert.equal(ov.days[0].date, '2026-11-02');
  const thu = ov.days.find(d => d.date === '2026-11-05');
  assert.equal(thu.bookings.length, 1);
  assert.deepEqual(
    [thu.bookings[0].time, thu.bookings[0].end, thu.bookings[0].service, thu.bookings[0].name, thu.bookings[0].phone, thu.bookings[0].pending],
    ['10:00', '11:00', 'Näopuhastus', 'Mari Maasikas', '+37255551234', false]);
  assert.deepEqual(thu.other, [{ time: '12:00', end: '13:00', summary: 'Hambaarst' }]);
  assert.deepEqual(thu.allDay, []);
  assert.deepEqual(ov.days.find(d => d.date === '2026-11-06').allDay, ['Puhkus']);
  assert.equal(ov.days.find(d => d.date === '2026-12-24').holiday, true);
});

// ---------- approvals ----------

test('bookings starting within 36 h become requests; later ones are instant', () => {
  const gas = setup();
  const soon = book(gas, L('2026-11-03', '10:00')); // 26 h ahead
  assert.equal(soon.ok, true, JSON.stringify(soon));
  assert.equal(soon.booking.status, 'pending');
  const ev = gas.calendar.api.Events.get('primary', soon.booking.id);
  assert.match(ev.summary, /^OOTAB KINNITUST/);
  const toCustomer = lastMailTo(gas, 'mari@example.com');
  assert.match(toCustomer.subject, /soov/i);
  assert.doesNotMatch(toCustomer.subject, /kinnitatud/i);
  assert.ok(approvalLink(gas, soon.booking.id), 'owner gets an approval link');
  const later = book(gas, L('2026-11-05', '10:00'), { email: 'teine@example.com', phone: '5000 0002' });
  assert.equal(later.booking.status, 'confirmed');
  const taken = book(gas, L('2026-11-03', '10:00'), { email: 'kolmas@example.com', phone: '5000 0003' });
  assert.equal(taken.error, 'slot_taken', 'a request holds its slot');
});

test('approving from the e-mail link confirms the booking and e-mails the customer', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-03', '10:00'));
  const t = approvalLink(gas, r.booking.id);
  const info = gas.post({ action: 'admin_request', id: r.booking.id, t });
  assert.equal(info.ok, true);
  assert.deepEqual([info.booking.status, info.booking.name, info.booking.phone, info.booking.service],
    ['pending', 'Mari Maasikas', '+37255551234', 'Näopuhastus']);
  gas.outbox.length = 0;
  assert.equal(gas.post({ action: 'admin_decide', id: r.booking.id, t, decision: 'approve' }).ok, true);
  const ev = gas.calendar.api.Events.get('primary', r.booking.id);
  assert.equal(ev.summary, 'Mari Maasikas · Näopuhastus');
  assert.equal(ev.extendedProperties.private.state, 'confirmed');
  const mail = lastMailTo(gas, 'mari@example.com');
  assert.match(mail.subject, /kinnitatud/i);
  assert.equal(mail.attachments.length, 1);
  assert.equal(gas.post({ action: 'admin_decide', id: r.booking.id, t, decision: 'approve' }).error, 'not_pending');
});

test('declining frees the slot and tells the customer', () => {
  const gas = setup();
  const s = session(gas);
  const r = book(gas, L('2026-11-03', '10:00'));
  gas.outbox.length = 0;
  assert.equal(gas.post({ action: 'admin_decide', s, id: r.booking.id, decision: 'decline' }).ok, true);
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 0);
  assert.match(lastMailTo(gas, 'mari@example.com').subject, /ei sobi/i);
  assert.equal(book(gas, L('2026-11-03', '10:00'), { email: 'uus@example.com', phone: '5000 0004' }).ok, true);
});

test('approval tokens are tied to one booking', () => {
  const gas = setup();
  const a = book(gas, L('2026-11-03', '10:00'));
  const b = book(gas, L('2026-11-03', '13:00'), { email: 'b@example.com', phone: '5000 0005' });
  const ta = approvalLink(gas, a.booking.id);
  assert.equal(gas.post({ action: 'admin_decide', id: b.booking.id, t: ta, decision: 'approve' }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'admin_request', id: b.booking.id, t: 'vale' }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'admin_decide', id: a.booking.id, t: ta, decision: 'maybe' }).error, 'invalid');
});

test('unanswered requests expire 2 h before the start and both sides are told', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-02', '14:00')); // 6 h ahead
  assert.equal(r.booking.status, 'pending');
  gas.outbox.length = 0;
  gas.ctx.nowMs = () => L('2026-11-02', '11:30');
  gas.run('hourly');
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 1);
  gas.ctx.nowMs = () => L('2026-11-02', '12:30');
  gas.run('hourly');
  assert.equal(gas.calendar.api.Events.list('primary', {}).items.length, 0);
  assert.ok(lastMailTo(gas, 'mari@example.com', /kinnitada/));
  assert.ok(lastMailTo(gas, OWNER, /aegus/i));
});

test('the hourly run never touches confirmed bookings or approved requests', () => {
  const gas = setup();
  const confirmed = book(gas, L('2026-11-05', '10:00'));
  const req = book(gas, L('2026-11-03', '10:00'), { email: 'b@example.com', phone: '5000 0006' });
  assert.equal(gas.post({ action: 'admin_decide', id: req.booking.id, t: approvalLink(gas, req.booking.id), decision: 'approve' }).ok, true);
  for (const at of [L('2026-11-03', '09:00'), L('2026-11-05', '08:30'), L('2026-11-05', '09:30')]) {
    gas.ctx.nowMs = () => at;
    gas.run('hourly');
  }
  const ids = gas.calendar.api.Events.list('primary', {}).items.map(e => e.id).sort();
  assert.deepEqual(ids, [confirmed.booking.id, req.booking.id].sort());
});

test('a customer can withdraw a pending request even inside 24 h', () => {
  const gas = setup();
  const r = book(gas, L('2026-11-03', '10:00'));
  const t = cancelToken(gas, r.booking.id);
  const look = gas.get({ action: 'booking', id: r.booking.id, t });
  assert.deepEqual([look.booking.status, look.booking.cancellable], ['pending', true]);
  assert.equal(gas.post({ action: 'cancel', id: r.booking.id, t }).ok, true);
});

test('pending requests show up in the overview', () => {
  const gas = setup();
  const s = session(gas);
  const r = book(gas, L('2026-11-03', '10:00'));
  const ov = gas.post({ action: 'admin_overview', s });
  assert.equal(ov.pending.length, 1);
  assert.equal(ov.pending[0].id, r.booking.id);
  assert.equal(ov.days.find(d => d.date === '2026-11-03').bookings[0].pending, true);
});

test('setup replaces an old reminder-only trigger with the hourly one', () => {
  const gas = setup();
  gas.triggers.push({ fn: 'sendReminders', getHandlerFunction: () => 'sendReminders' });
  gas.run('setup');
  assert.deepEqual(gas.triggers.map(t => t.fn), ['hourly']);
});
