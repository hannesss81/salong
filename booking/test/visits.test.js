const test = require('node:test');
const assert = require('node:assert/strict');
const {createGas} = require('../dev/gas');
const S = require('../../broneeri/slots');
const now = S.localToUtc('2026-11-02', '08:00');
const at = time => S.localToUtc('2026-11-26', time);
const ids = ['naopuhastus', 'kulmude-korrigeerimine'];
function setup() { const g = createGas({quiet: true, config:{OWNER_EMAIL:'owner@example.com'}}); g.ctx.nowMs = () => now; return g; }
function submit(g, time, extra) { return g.post(Object.assign({action:'book', serviceIds:ids, startMs:at(time), name:'Mari Maasikas', phone:'55551234', email:'client@example.com'},extra)); }
test('pre-launch backend accepts no customer requests or mail, even if the public page is stale', () => {
  const gas=createGas({quiet:true,config:{PUBLIC_BOOKING_OPEN:false}}); gas.ctx.nowMs=()=>now;
  assert.equal(submit(gas,'10:00').error,'booking_closed');assert.equal(gas.outbox.length,0);
  assert.equal(gas.calendar.api.Events.list('primary',{}).items.length,0);
});
test('one multi-service request holds the complete contiguous visit; calendar, owner review, receipts and confirmation agree', () => {
  const g = setup(); const start = at('18:45');
  const r = submit(g, '18:45', {durationMin: 1, price: 1, status:'confirmed'});
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.booking.status,r.booking.price,r.booking.durationMin,r.booking.serviceIds],['pending',60,75,ids]);
  const id=r.booking.id, event = g.calendar.api.Events.get('primary', id);
  assert.equal(Date.parse(event.end.dateTime), at('20:00')); assert.match(event.summary,/Näopuhastus.*Kulmude korrigeerimine/i);
  assert.equal(g.calendar.api.Events.list('primary',{}).items.length,1);
  assert.equal(g.outbox.length,2); const receipt=g.outbox.find(m=>m.to==='client@example.com');
  assert.match(receipt.subject,/kätte saadud/i); assert.equal(receipt.attachments.length,0);
  const owner=g.outbox.find(m=>m.to==='owner@example.com'); assert.match(owner.body,/Näopuhastus.*Kulmude korrigeerimine/i);
  assert.equal(submit(g,'19:45',{serviceIds:['kulmude-korrigeerimine']}).error,'slot_taken');
  const t=g.ctx.approvalToken_(id);
  assert.match(g.post({action:'admin_request',id,t}).booking.service,/Näopuhastus.*Kulmude korrigeerimine/i);
  assert.equal(g.post({action:'admin_decide',id,t,decision:'approve'}).ok,true);
  const conf=g.outbox.at(-1); assert.equal(conf.to,'client@example.com'); assert.match(conf.subject,/kinnitatud/i);
  assert.match(conf.body,/Näopuhastus.*Kulmude korrigeerimine/i); assert.equal(conf.attachments.length,1);
  assert.deepEqual([Date.parse(event.start.dateTime),Date.parse(event.end.dateTime)-start],[start,75*60000]);
});
test('combined duration must fit; outside gap only; malformed, repeated or unknown service lists create no event or mail', () => {
  const g=setup(); for(const serviceIds of [[],{},null,'mask',['naopuhastus','naopuhastus'],['mask','missing'],[42],['bukaalne-massaaz-pakett']]) {
    assert.equal(submit(g,'10:00',{serviceIds}).error,'invalid_service',JSON.stringify(serviceIds));
  }
  assert.equal(submit(g,'19:00').error,'slot_taken'); assert.equal(g.outbox.length,0);
  assert.equal(submit(g,'10:00').ok,true); // ends 11:15
  assert.equal(submit(g,'11:15',{serviceIds:['mask']}).error,'slot_taken');
  assert.equal(submit(g,'11:30',{serviceIds:['mask']}).ok,true);
});
for (const approved of [false,true]) for (const seconds of [-1,0,1]) test(`${approved?'confirmed':'pending'} cancellation: ${seconds} s relative to the 24-hour deadline`,()=>{
  const g=setup();const b=submit(g,'10:00').booking; assert.ok(b); const id=b.id;
  if (approved) assert.equal(g.post({action:'admin_decide',id,t:g.ctx.approvalToken_(id),decision:'approve'}).ok,true);
  const t=g.ctx.token_(id);g.ctx.nowMs=()=>at('10:00')-86400000+seconds*1000;
  assert.equal(g.get({action:'booking',id,t}).booking.cancellable,seconds<=0);
  const r=g.post({action:'cancel',id,t}); assert.equal(r.ok,seconds<=0); if(seconds>0) assert.equal(r.error,'too_late');
});
