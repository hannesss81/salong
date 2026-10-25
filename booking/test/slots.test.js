// Core slot engine tests. Run: node --test booking/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../broneeri/slots.js');

function intlOffsetMin(ms) {
  // Offset of Europe/Tallinn from UTC in minutes, using the platform tz database.
  const p = Object.fromEntries(TALLINN_FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}
const TALLINN_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Tallinn', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

test('tallinnOffsetMin matches the tz database for every hour 2025-2032', () => {
  const start = Date.UTC(2025, 0, 1);
  const end = Date.UTC(2033, 0, 1);
  for (let ms = start; ms < end; ms += 3600 * 1000) {
    assert.equal(S.tallinnOffsetMin(ms), intlOffsetMin(ms), new Date(ms).toISOString());
  }
});

test('localToUtc converts Tallinn wall time on both sides of the autumn change', () => {
  assert.equal(S.localToUtc('2026-10-24', '10:00'), Date.UTC(2026, 9, 24, 7, 0)); // summer, UTC+3
  assert.equal(S.localToUtc('2026-10-25', '10:00'), Date.UTC(2026, 9, 25, 8, 0)); // change day, after 04:00
  assert.equal(S.localToUtc('2026-10-26', '10:00'), Date.UTC(2026, 9, 26, 8, 0)); // winter, UTC+2
  assert.equal(S.localToUtc('2027-03-28', '10:00'), Date.UTC(2027, 2, 28, 7, 0)); // spring change day
});

test('localParts round-trips localToUtc every 15 minutes of 2026 outside the spring gap', () => {
  let n = 0;
  for (let d = '2026-01-01'; d < '2027-01-01'; d = S.addDays(d, 1)) {
    for (let m = 0; m < 24 * 60; m += 15) {
      const hhmm = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      if (d === '2026-03-29' && hhmm >= '03:00' && hhmm < '04:00') continue; // does not exist
      const p = S.localParts(S.localToUtc(d, hhmm));
      assert.equal(p.date + ' ' + p.time, d + ' ' + hhmm);
      n++;
    }
  }
  assert.equal(n, 365 * 96 - 4);
});

test('localParts gives ISO weekday (1 = Monday, 7 = Sunday)', () => {
  assert.equal(S.localParts(S.localToUtc('2026-10-26', '12:00')).isoDow, 1);
  assert.equal(S.localParts(S.localToUtc('2026-10-25', '12:00')).isoDow, 7);
  // 23:30 UTC on Saturday is already Sunday in Tallinn
  assert.equal(S.localParts(Date.UTC(2026, 9, 24, 23, 30)).isoDow, 7);
});

test('addDays crosses month and year ends', () => {
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(S.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
});

test('estonianHolidays lists the 12 public days off, Easter-based ones included', () => {
  assert.deepEqual(S.estonianHolidays(2026), [
    '2026-01-01', '2026-02-24', '2026-04-03', '2026-04-05', '2026-05-01', '2026-05-24',
    '2026-06-23', '2026-06-24', '2026-08-20', '2026-12-24', '2026-12-25', '2026-12-26',
  ]);
  const y27 = S.estonianHolidays(2027);
  assert.ok(y27.includes('2027-03-26')); // Good Friday
  assert.ok(y27.includes('2027-03-28')); // Easter Sunday
  assert.ok(y27.includes('2027-05-16')); // Pentecost
});

test('buildWindows expands weekly hours in Tallinn time and skips closed dates', () => {
  const weekly = { 1: [['10:00', '18:00']], 6: [['10:00', '13:00'], ['14:00', '16:00']] };
  // 2026-10-24 is a Saturday, 2026-10-25 Sunday (closed), 2026-10-26 Monday
  const w = S.buildWindows({ fromDate: '2026-10-24', days: 3, weekly, closedDates: [] });
  assert.deepEqual(w, [
    [S.localToUtc('2026-10-24', '10:00'), S.localToUtc('2026-10-24', '13:00')],
    [S.localToUtc('2026-10-24', '14:00'), S.localToUtc('2026-10-24', '16:00')],
    [S.localToUtc('2026-10-26', '10:00'), S.localToUtc('2026-10-26', '18:00')],
  ]);
  const closed = S.buildWindows({ fromDate: '2026-10-24', days: 3, weekly, closedDates: ['2026-10-26'] });
  assert.equal(closed.length, 2);
});

// Helpers for slot tests: one Monday, times as 'HH:MM'
const DAY = '2026-11-02';
const at = hhmm => S.localToUtc(DAY, hhmm);
const times = slots => slots.map(ms => S.localParts(ms).time);
const base = { bufferMin: 15, stepMin: 15, notBeforeMs: 0 };

test('computeSlots: empty window offers every quarter hour whose service fits', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('10:00'), at('12:00')]], busy: [], durationMin: 60,
  }));
  assert.deepEqual(times(slots), ['10:00', '10:15', '10:30', '10:45', '11:00']);
});

test('computeSlots: keeps a 15 min gap before and after an existing event', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('09:00'), at('14:00')]], busy: [[at('11:00'), at('11:30')]], durationMin: 60,
  }));
  // must end by 10:45 or start from 11:45
  assert.deepEqual(times(slots), ['09:00', '09:15', '09:30', '09:45',
    '11:45', '12:00', '12:15', '12:30', '12:45', '13:00']);
});

test('computeSlots: the booked service itself needs no gap at opening or closing time', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('10:00'), at('11:00')]], busy: [], durationMin: 60,
  }));
  assert.deepEqual(times(slots), ['10:00']);
});

test('computeSlots: respects the earliest allowed start (minimum notice)', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('09:00'), at('11:00')]], busy: [], durationMin: 30, notBeforeMs: at('09:20'),
  }));
  assert.deepEqual(times(slots), ['09:30', '09:45', '10:00', '10:15', '10:30']);
});

test('computeSlots: aligns to quarter hours when opening time is uneven', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('10:10'), at('11:00')]], busy: [], durationMin: 30,
  }));
  assert.deepEqual(times(slots), ['10:15', '10:30']);
});

test('computeSlots: service longer than the window gives nothing', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('10:00'), at('11:00')]], busy: [], durationMin: 75,
  }));
  assert.deepEqual(slots, []);
});

test('computeSlots: unsorted, overlapping and all-day busy blocks', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('09:00'), at('13:00')], [at('14:00'), at('17:00')]],
    busy: [[at('15:00'), at('16:00')], [at('09:00'), at('10:00')], [at('09:30'), at('10:30')]],
    durationMin: 45,
  }));
  assert.deepEqual(times(slots), ['10:45', '11:00', '11:15', '11:30', '11:45', '12:00', '12:15', '14:00', '16:15']);
  const none = S.computeSlots(Object.assign({}, base, {
    windows: [[at('09:00'), at('17:00')]],
    busy: [[S.localToUtc(DAY, '00:00'), S.localToUtc(S.addDays(DAY, 1), '00:00')]], durationMin: 15,
  }));
  assert.deepEqual(none, []);
});

test('isSlotFree agrees with computeSlots', () => {
  const opts = Object.assign({}, base, {
    windows: [[at('09:00'), at('14:00')]], busy: [[at('11:00'), at('11:30')]], durationMin: 60,
  });
  assert.equal(S.isSlotFree(opts, at('09:45')), true);
  assert.equal(S.isSlotFree(opts, at('10:00')), false);
  assert.equal(S.isSlotFree(opts, at('11:45')), true);
  assert.equal(S.isSlotFree(opts, at('11:50')), false); // not on the quarter-hour grid
  assert.equal(S.isSlotFree(opts, at('13:15')), false); // would end after closing
});

test('groupByDay groups instants by Tallinn date in order', () => {
  const g = S.groupByDay([S.localToUtc('2026-11-03', '10:00'), at('10:00'), at('11:00')]);
  assert.deepEqual(Object.keys(g), ['2026-11-02', '2026-11-03']);
  assert.deepEqual(times(g['2026-11-02']), ['10:00', '11:00']);
});

test('computeSlots: overlapping windows behave like their union', () => {
  const slots = S.computeSlots(Object.assign({}, base, {
    windows: [[at('09:00'), at('12:00')], [at('09:30'), at('11:00')]],
    busy: [[at('10:00'), at('10:15')]], durationMin: 30,
  }));
  assert.deepEqual(times(slots), ['09:00', '09:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
  // A nested window must not resurrect a start that an earlier busy block covers
  const nested = S.computeSlots(Object.assign({}, base, {
    bufferMin: 0,
    windows: [[at('09:00'), at('10:15')], [at('09:00'), at('09:45')]],
    busy: [[at('09:20'), at('09:40')], [at('09:45'), at('10:30')]], durationMin: 15,
  }));
  assert.deepEqual(times(nested), ['09:00']);
});

test('isSlotFree accepts a start that spans two touching windows, like computeSlots', () => {
  const opts = Object.assign({}, base, {
    windows: [[at('10:00'), at('13:00')], [at('13:00'), at('16:00')]], busy: [], durationMin: 60,
  });
  assert.ok(times(S.computeSlots(opts)).includes('12:30'));
  assert.equal(S.isSlotFree(opts, at('12:30')), true);
});
