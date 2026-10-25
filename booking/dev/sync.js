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
