#!/usr/bin/env node
// Copies the shared slot engine into the Apps Script project. Run before every clasp push:
//   node booking/dev/sync.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', '..', 'broneeri', 'slots.js');
const dst = path.join(__dirname, '..', 'apps-script', 'Slots.js');
const header = '// GENERATED from broneeri/slots.js by booking/dev/sync.js. Do not edit here.\n';
fs.writeFileSync(dst, header + fs.readFileSync(src, 'utf8'));
console.log('synced', path.relative(process.cwd(), dst));

// Bundled copy of the bookable services, used only when the live pricing.json can't be read or
// has no durations yet (e.g. before the booking branch reaches the live site).
const pricing = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'pricing.json'), 'utf8'));
const bundled = {};
pricing.services.forEach(s => {
  if (s.id && s.duration > 0 && s.bookable !== false) bundled[s.id] = { id: s.id, name: s.name, duration: s.duration, price: s.price };
});
const svc = path.join(__dirname, '..', 'apps-script', 'Services.js');
fs.writeFileSync(svc, '// GENERATED from pricing.json by booking/dev/sync.js. Do not edit here.\n' +
  'var BUNDLED_SERVICES = ' + JSON.stringify(bundled, null, 1) + ';\n');
console.log('synced', path.relative(process.cwd(), svc), '(' + Object.keys(bundled).length + ' services)');
