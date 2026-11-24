const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createGas} = require('../dev/gas');
const S = require('../../broneeri/slots');
const now = S.localToUtc('2026-11-02','08:00');
const start = S.localToUtc('2026-11-12','10:00');
const trial = 'example-only-trial-invitation-1234';
const digest = createHash('sha256').update(trial).digest('base64url');
const body = {action:'book',serviceIds:['naopuhastus','kulmude-korrigeerimine'], startMs:start,
  email:'sample@example.com',phone:'55551234',name:'Mari Maasikas',comment:'no notes in cancellation records',trial};
function setup(){const g=createGas({quiet:true,config:{PUBLIC_BOOKING_OPEN:false,TRIAL_INVITE_HASH:digest,OWNER_EMAIL:'owner@example.com'}});g.ctx.nowMs=()=>now;return g;}
function login(g){g.post({action:'admin_login_request'});const msg=g.outbox.at(-1); const token=decodeURIComponent(msg.htmlBody.match(/#login=([^"&<]+)/)[1]); return g.post({action:'admin_session',login:token}).session;}
test('trial invite admits a real request, not management; bare URL stays closed',()=>{
 const g=setup();assert.equal(g.get({action:'availability'}).error,'booking_closed');
 for (const k of [null,'',digest,'wrong']){assert.equal(g.post({action:'trial_availability',trial:k}).error,'booking_closed');assert.equal(g.post({...body,trial:k}).error,'booking_closed');}
 const av=g.post({action:'trial_availability',trial});assert.ok(av.ok && av.windows.length);assert.equal(g.post({action:'admin_overview',s:trial}).error,'unauthorized');
 assert.equal(g.outbox.length,0);assert.equal(g.post(body).booking.status,'pending');assert.equal(g.outbox.length,2);
 const s=login(g); const ownerLink=g.post({action:'admin_overview',s}).customerTrial;assert.ok(ownerLink && ownerLink!==trial);assert.ok(g.post({action:'trial_availability',trial:ownerLink}).ok);
 g.ctx.CONFIG.TRIAL_INVITE_HASH='';assert.equal(g.post({action:'trial_availability',trial:ownerLink}).error,'booking_closed');assert.equal(g.post(body).error,'booking_closed');
});
test('withdrawals and cancellations remain in the private dashboard after the slot reopens, then expire',()=>{
 const g=setup(), s=login(g), overview=()=>g.post({action:'admin_overview',s});
 for (const reason of ['withdrawn','client_cancelled','declined','owner_cancelled']) {
  const id=g.post(body).booking.id;assert.ok(overview().pending.some(x=>x.id===id));
  if(['client_cancelled','owner_cancelled'].includes(reason)) assert.ok(g.post({action:'admin_decide',s,id,decision:'approve'}).ok);
  if(reason==='owner_cancelled'){assert.equal(g.post({action:'admin_cancel_online',s:trial,id}).error,'unauthorized');assert.ok(g.post({action:'admin_cancel_online',s,id}).ok);assert.match(g.outbox.at(-1).subject,/tühistatud/i);}
  else if(reason==='declined') assert.ok(g.post({action:'admin_decide',s,id,decision:'decline'}).ok);
  else assert.ok(g.post({action:'cancel',id,t:g.ctx.token_(id)}).ok);
  const v=overview();const row=v.cancellations.find(r=>r.reason===reason);assert.ok(row);assert.equal(row.startMs,start);assert.equal(row.name,body.name);assert.equal(row.service,'Näopuhastus + Kulmude korrigeerimine');assert.deepEqual(Object.keys(row).sort(),['at','name','reason','service','startMs']);assert.equal(v.pending.length,0);
 }
 assert.equal(overview().cancellations.length,4);assert.equal(g.post({action:'trial_availability',trial}).cancellations,undefined);
 g.ctx.nowMs=()=>now+15*86400000;g.run('hourly');assert.equal(overview().cancellations.length,0);assert.ok(![...g.props.keys()].some(k=>k.startsWith('CXL:')));
});
test('a refused late cancellation creates no history entry; the owner can still cancel a confirmed visit',()=>{
 const g=setup(),s=login(g),id=g.post(body).booking.id;g.post({action:'admin_decide',s,id,decision:'approve'});g.ctx.nowMs=()=>start-5*3600000;
 assert.equal(g.post({action:'cancel',id,t:g.ctx.token_(id)}).error,'too_late');assert.equal(g.post({action:'admin_overview',s}).cancellations.length,0);
 assert.equal(g.post({action:'admin_cancel_online',id,s}).ok,true);assert.equal(g.post({action:'admin_cancel_online',id,s}).error,'not_found');
});
