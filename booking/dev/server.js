#!/usr/bin/env node
/*
 * Local preview of the whole booking system, no Google account needed.
 *   node booking/dev/server.js          -> http://127.0.0.1:8790/broneeri/
 * Serves the website, answers /api with the real Apps Script code running on fakes
 * (booking/dev/gas.js), and shows the fake calendar and sent e-mails at /__dev/.
 * Env: PORT (8790), LATENCY_MS (700, mimics Apps Script response times), SEED (1),
 *      REAL_API=1 serves the real broneeri/config.js (live backend) instead of the fakes,
 *      BOOKING_OPEN=0 previews the "opening soon" state.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createGas } = require('./gas.js');
const S = require('../../broneeri/slots.js');

const PORT = Number(process.env.PORT || 8790);
const LATENCY = Number(process.env.LATENCY_MS == null ? 700 : process.env.LATENCY_MS);
const SITE = path.join(__dirname, '..', '..');
const ORIGIN = 'http://127.0.0.1:' + PORT;

const gas = createGas({ quiet: true, config: { OWNER_EMAIL: 'ilvi.dev@example.com', SITE_URL: ORIGIN } });

function seed() {
  const today = S.localParts(Date.now()).date;
  const iso = ms => new Date(ms).toISOString();
  let d = S.addDays(today, 1);
  while (S.localParts(S.localToUtc(d, '12:00')).isoDow > 5) d = S.addDays(d, 1); // next weekday
  gas.addEvent({ summary: 'Hambaarst (näidis)', start: { dateTime: iso(S.localToUtc(d, '12:00')) }, end: { dateTime: iso(S.localToUtc(d, '13:30')) } });
  gas.addEvent({ summary: 'Klient telefoni teel (näidis)', start: { dateTime: iso(S.localToUtc(d, '15:00')) }, end: { dateTime: iso(S.localToUtc(d, '16:00')) } });
  gas.addEvent({ summary: 'Koolitus (näidis, terve päev)', start: { date: S.addDays(d, 2) }, end: { date: S.addDays(d, 3) } });
}
if (process.env.SEED !== '0') seed();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function devPanel() {
  const evs = gas.calendar.api.Events.list('primary', {}).items;
  const rows = evs.map(ev => {
    const s = ev.start.dateTime ? S.localParts(Date.parse(ev.start.dateTime)) : { date: ev.start.date, time: 'terve päev' };
    const e = ev.end.dateTime ? S.localParts(Date.parse(ev.end.dateTime)).time : '';
    const online = ((ev.extendedProperties || {}).private || {}).pargi === '1';
    return `<tr><td>${s.date} ${s.time}${e ? '–' + e : ''}</td><td>${esc(ev.summary)}</td><td>${online ? 'veebibroneering' : 'Ilvi enda sündmus'}</td></tr>`;
  }).join('');
  const mails = gas.outbox.map((m, i) => `<tr><td>${new Date(m.sentAt).toLocaleTimeString('et-EE')}</td><td>${esc(m.to)}</td><td><a href="/__dev/mail/${i}">${esc(m.subject)}</a></td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Arendaja vaade</title>
<style>body{font:15px system-ui;margin:24px;max-width:960px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td{border-bottom:1px solid #ddd;padding:6px 8px}h2{margin-top:28px}</style>
<h1>Arendaja vaade (võltskalender)</h1>
<p><a href="/broneeri/">Broneerimisleht</a> · <a href="/broneeri/haldus/">Minu tööajad (haldus)</a> · <form method="post" action="/__dev/reminders" style="display:inline"><button>Käivita tunnitöö kohe (aegumised, meeldetuletused)</button></form></p>
<h2>Kalender (${evs.length})</h2><table>${rows || '<tr><td>tühi</td></tr>'}</table>
<h2>Saadetud kirjad (${gas.outbox.length})</h2><table>${mails || '<tr><td>ühtegi</td></tr>'}</table>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === '/api') {
    if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
    const t0 = Date.now();
    if (process.env.LOG) console.log(new Date().toISOString(), req.method, req.url, 'received');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => setTimeout(() => {
      const out = req.method === 'POST'
        ? gas.ctx.doPost({ parameter: {}, postData: { contents: body, type: req.headers['content-type'] || '' } })
        : gas.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
      send(res, 200, 'application/json; charset=utf-8', out.getContent());
      if (process.env.LOG) console.log(new Date().toISOString(), req.method, req.url, 'answered in', Date.now() - t0, 'ms', out.getContent().slice(0, 80));
    }, LATENCY));
    return;
  }
  if (url.pathname === '/broneeri/config.js' && process.env.REAL_API !== '1') {
    const open = process.env.BOOKING_OPEN !== '0';
    return send(res, 200, MIME['.js'], `// dev server: fake backend at /api (REAL_API=1 serves the real file)\n` +
      `window.PARGI_BOOKING = { apiUrl: '', bookingOpen: ${open} };\n`);
  }
  if (url.pathname === '/__dev/' || url.pathname === '/__dev') return send(res, 200, 'text/html; charset=utf-8', devPanel());
  const mail = url.pathname.match(/^\/__dev\/mail\/(\d+)$/);
  if (mail && gas.outbox[+mail[1]]) {
    const m = gas.outbox[+mail[1]];
    const att = m.attachments.map(a => `<pre style="background:#eee;padding:8px;white-space:pre-wrap">${esc(a.name)}\n${esc(a.data)}</pre>`).join('');
    return send(res, 200, 'text/html; charset=utf-8', `<p style="font:14px system-ui">Kellele: ${esc(m.to)} · Vastus: ${esc(m.replyTo || '')}<br>Teema: <b>${esc(m.subject)}</b></p>${m.htmlBody}<hr><pre style="white-space:pre-wrap">${esc(m.body)}</pre>${att}`);
  }
  if (url.pathname === '/__dev/reminders' && req.method === 'POST') {
    gas.run('hourly');
    res.writeHead(303, { Location: '/__dev/' });
    return res.end();
  }
  let file = path.normalize(path.join(SITE, decodeURIComponent(url.pathname)));
  if (!file.startsWith(SITE)) return send(res, 403, 'text/plain', 'forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', 'ei leitud');
  send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
});
server.listen(PORT, '127.0.0.1', () => console.log('Booking preview on ' + ORIGIN + '/broneeri/  (dev panel ' + ORIGIN + '/__dev/)'));
