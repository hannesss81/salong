/*
 * Local stand-in for the Google Apps Script runtime.
 *
 * Loads the real backend files from booking/apps-script/ into a Node vm context and provides
 * in-memory fakes for the Google services they call (Calendar advanced service, MailApp,
 * LockService, CacheService, PropertiesService, Utilities, ContentService, UrlFetchApp,
 * Session, ScriptApp). Used by the tests and by the dev server.
 *
 * The fakes follow the documented behaviour of the real services as far as this project uses
 * them; anything the backend relies on that is not covered here must be verified on Google.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const GAS_DIR = path.join(__dirname, '..', 'apps-script');
const SITE_DIR = path.join(__dirname, '..', '..');
const Slots = require('../../broneeri/slots.js');

function toSignedBytes(buf) {
  return Array.from(buf, b => (b > 127 ? b - 256 : b));
}
function fromBytes(bytes) {
  return Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b)));
}

function createFakeCalendar() {
  const events = new Map(); // id -> event resource
  let seq = 0;
  const clone = x => JSON.parse(JSON.stringify(x));
  function startMs(ev) {
    return ev.start.dateTime ? Date.parse(ev.start.dateTime) : Slots.localToUtc(ev.start.date, '00:00');
  }
  function endMs(ev) {
    return ev.end.dateTime ? Date.parse(ev.end.dateTime) : Slots.localToUtc(ev.end.date, '00:00');
  }
  function notFound() {
    const e = new Error('API call to calendar.events.get failed with error: Not Found');
    e.details = { code: 404 };
    return e;
  }
  const api = {
    Events: {
      list(calendarId, params) {
        params = params || {};
        const tMin = params.timeMin ? Date.parse(params.timeMin) : -Infinity;
        const tMax = params.timeMax ? Date.parse(params.timeMax) : Infinity;
        let items = [...events.values()].filter(ev => ev.status !== 'cancelled' || params.showDeleted);
        items = items.filter(ev => endMs(ev) > tMin && startMs(ev) < tMax);
        if (params.privateExtendedProperty) {
          const [k, v] = String(params.privateExtendedProperty).split('=');
          items = items.filter(ev => ((ev.extendedProperties || {}).private || {})[k] === v);
        }
        items.sort((a, b) => startMs(a) - startMs(b));
        return { items: items.map(clone) };
      },
      get(calendarId, id) {
        const ev = events.get(id);
        if (!ev) throw notFound();
        return clone(ev);
      },
      insert(resource, calendarId) {
        const id = 'ev' + (++seq).toString(36) + crypto.randomBytes(4).toString('hex');
        const ev = Object.assign(clone(resource), { id, status: 'confirmed', created: new Date().toISOString() });
        events.set(id, ev);
        return clone(ev);
      },
      patch(resource, calendarId, id) {
        const ev = events.get(id);
        if (!ev) throw notFound();
        // Patch semantics: objects merge field by field, arrays and scalars replace.
        (function merge(target, src) {
          Object.keys(src).forEach(k => {
            if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k] && typeof target[k] === 'object') {
              merge(target[k], src[k]);
            } else {
              target[k] = clone(src[k]);
            }
          });
        })(ev, resource);
        return clone(ev);
      },
      remove(calendarId, id) {
        const ev = events.get(id);
        if (!ev || ev.status === 'cancelled') {
          const e = new Error('API call to calendar.events.delete failed with error: Resource has been deleted');
          e.details = { code: 410 };
          throw e;
        }
        ev.status = 'cancelled';
      },
    },
  };
  return { api, events, startMs, endMs };
}

function createGas(options) {
  options = options || {};
  const calendar = createFakeCalendar();
  const outbox = [];
  const props = new Map();
  const cache = new Map();
  const triggers = [];
  const ownerEmail = options.ownerEmail || 'ilvi.test@example.com';
  const log = [];

  const sandbox = {
    console: options.quiet ? { log: m => log.push(m), error: m => log.push(m), warn: m => log.push(m), info: m => log.push(m) } : console,
    Calendar: calendar.api,
    MailApp: {
      sendEmail(msg) {
        if (typeof msg !== 'object') throw new Error('fake MailApp only supports the object form');
        outbox.push(Object.assign({ sentAt: Date.now() }, msg, {
          attachments: (msg.attachments || []).map(b => ({ name: b.getName(), type: b.getContentType(), data: b.getDataAsString() })),
        }));
      },
      getRemainingDailyQuota() { return 100 - outbox.length; },
    },
    LockService: {
      getScriptLock() {
        return { waitLock() {}, tryLock() { return true; }, releaseLock() {}, hasLock() { return true; } };
      },
    },
    CacheService: {
      getScriptCache() {
        return {
          get(k) { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
          put(k, v, ttl) { cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
          remove(k) { cache.delete(k); },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return props.has(k) ? props.get(k) : null; },
          setProperty(k, v) { props.set(k, String(v)); return this; },
          deleteProperty(k) { props.delete(k); return this; },
        };
      },
    },
    Utilities: {
      computeHmacSha256Signature(value, key) {
        return toSignedBytes(crypto.createHmac('sha256', key).update(value, 'utf8').digest());
      },
      base64EncodeWebSafe(bytes) {
        return (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : fromBytes(bytes))
          .toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      getUuid() { return crypto.randomUUID(); },
      newBlob(data, contentType, name) {
        return { getDataAsString: () => String(data), getContentType: () => contentType, getName: () => name };
      },
      sleep() {},
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(s) {
        const out = { content: s, mime: 'text/plain' };
        return { setMimeType(m) { out.mime = m; return this; }, getContent() { return out.content; }, getMimeType() { return out.mime; } };
      },
    },
    UrlFetchApp: {
      fetch(url) {
        const m = String(url).match(/^https?:\/\/[^/]+(\/[^?#]*)/);
        const file = path.join(SITE_DIR, decodeURIComponent(m ? m[1] : ''));
        if (!file.startsWith(SITE_DIR) || !fs.existsSync(file)) {
          return { getResponseCode: () => 404, getContentText: () => 'not found' };
        }
        const text = fs.readFileSync(file, 'utf8');
        return { getResponseCode: () => 200, getContentText: () => text };
      },
    },
    Session: {
      getEffectiveUser() { return { getEmail: () => ownerEmail }; },
      getScriptTimeZone() { return 'Europe/Tallinn'; },
    },
    ScriptApp: {
      getProjectTriggers() { return triggers.slice(); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased() { return b; }, everyHours(h) { t.everyHours = h; return b; }, everyMinutes(m) { t.everyMinutes = m; return b; }, create() { triggers.push(t); return t; } };
        return b;
      },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const files = fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.js')).sort();
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f }));
  if (options.config) vm.runInContext('Object.assign(CONFIG, ' + JSON.stringify(options.config) + ')', ctx);

  function parse(out) { return JSON.parse(out.getContent()); }
  return {
    ctx, calendar, outbox, props, cache, triggers, log,
    get(params) { return parse(ctx.doGet({ parameter: params || {}, parameters: {} })); },
    post(body) {
      return parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body), type: 'text/plain' } }));
    },
    run(fnName) { return ctx[fnName].apply(null, [].slice.call(arguments, 1)); },
    /** Adds an event the way Ilvi would in Google Calendar. */
    addEvent(resource) { return calendar.api.Events.insert(resource, 'primary'); },
  };
}

module.exports = { createGas };
