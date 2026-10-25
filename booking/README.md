# Online booking (own system)

Customers book at `https://pargiilustuudio.eu/broneeri/`. Bookings land in Ilvi's Google Calendar
as normal events; customers get confirmation, reminder and cancellation e-mails from her Gmail.
Costs nothing to run.

```
broneeri/            public booking page (served by GitHub Pages with the rest of the site)
  index.html  broneeri.js  broneeri.css  privaatsus.html
  slots.js           slot engine, shared with the backend (pure JS, tested)
  config.js          backend URL (apiUrl). Empty = page shows "please call" fallback
booking/
  apps-script/       Google Apps Script backend (web app, runs as Ilvi)
    Config.js        hours, buffer, notice, deadlines, e-mail addresses  <- settings live here
    Api.js           doGet / doPost routing
    Availability.js  opening windows + busy times from her calendar
    Bookings.js      book, look up, cancel, hourly reminders, setup()
    Store.js         calendar access, cancel-link tokens
    Mail.js          Estonian e-mails + .ics attachment
    Slots.js         GENERATED copy of broneeri/slots.js (node booking/dev/sync.js)
    appsscript.json  manifest: Calendar advanced service, web app settings, scopes
  dev/
    gas.js           in-memory fakes of the Google services (tests + preview)
    server.js        local preview: site + /api + /__dev/ panel (calendar, sent e-mails)
    sync.js          copies slots.js into apps-script/
  test/              node:test suites
```

## How it works

- Services, prices and durations come from `/pricing.json` (`id`, `duration`; `bookable: false`
  hides one). The booking page reads it directly; the backend fetches it from the live site
  (cached 10 min, last good copy kept), so the price list and booking can't disagree.
- The page asks the backend once for opening windows and busy times (her events, clipped to
  opening hours so nothing else leaks), then computes start times locally with `slots.js`.
  On "Kinnita" the backend re-checks under a script lock with fresh calendar data.
- Start times sit on a 15-min grid. Every event in her calendar gets 15 min of free time
  before and after it. All-day events she adds close the day (even though Google marks them
  "Free" by default); contacts' birthdays and working-location entries don't. Timed events
  marked "Vaba" (free) and declined invitations don't block. Estonian public holidays are
  closed. Busy times sent to the page are rounded out to the quarter hour.
- Each booking is an event (title `Name · Service`, colour Sage) with contact details in the
  description and private extended properties (`pargi=1`, email, phone, createdMs, rid,
  reminderFor).
- Cancel links carry an HMAC of the event id (secret in Script Properties). The token is only
  ever sent by e-mail, never in an API response. Online cancellation closes 24 h before;
  after that the page says to call.
- An hourly trigger sends reminders 48 h ahead, while online cancellation is still open
  (skipped when the booking was made less than 60 h before the visit). If Ilvi moves a
  booking, the reminder follows the new time. A reminder is claimed before sending and
  released if Gmail fails, so it is retried but never sent twice.
- Each booking request carries a `requestId`; a retry after a lost reply returns the first
  booking instead of making a second one.
- Limits: 3 upcoming bookings per e-mail/phone, 12 bookings per day in total (counter in
  Script Properties), names must be letters, honeypot field (answers like a success).
  Gmail allows 100 recipients a day on a personal account (2 per booking, 1 per reminder);
  booking pauses when fewer than 10 are left.

## Local preview and tests

```
node --test booking/test/          # slot engine + backend on fakes
node booking/dev/server.js         # http://127.0.0.1:8790/broneeri/  and  /__dev/
```

The preview uses the real backend code with a fake calendar seeded with three sample events.
`/__dev/` lists calendar events and renders every e-mail sent (with the .ics).
When testing in the agent's Edge, bring the tab to the front (`Page.bringToFront`): Edge
freezes background tabs and their fetches never complete.

## Deploying (first time)

Runs under **ilvi.metssalu@gmail.com**. Needs her Google login once in a browser.

1. Logged in as Ilvi, turn on "Google Apps Script API" at
   https://script.google.com/home/usersettings.
2. `node booking/dev/sync.js`
3. `cd booking/apps-script && npx @google/clasp@3.4.1 login` (approve as Ilvi), then
   `npx @google/clasp@3.4.1 create --type standalone --title "Pargi broneeringud"` and
   `npx @google/clasp@3.4.1 push -f`. This writes `.clasp.json` (project id, not secret).
4. Open the project (`clasp open-script`), select `setup` and Run. Google asks for consent:
   "Google hasn't verified this app" -> Advanced -> Go to Pargi broneeringud -> Allow. The log
   should say `OK: 47 bookable services, calendar reachable ...`.
5. Deploy -> New deployment -> type Web app, Execute as: Me, Who has access: Anyone -> Deploy.
   Copy the URL ending in `/exec`.
6. Put the URL in `broneeri/config.js` (`apiUrl`), commit, merge to `main`, push.
7. Test on the live site with a real booking (own e-mail), check the event in her calendar
   and both e-mails, cancel via the link.

Updating the backend later: edit, `node booking/dev/sync.js`, `clasp push -f`, then
Deploy -> Manage deployments -> edit the web app -> Version: New version (keeps the same URL).

## Settings to confirm with Ilvi (Config.js)

- `WEEKLY_HOURS`: placeholder Mon-Fri 10-18, Sat 10-15. The site says "E-L kokkuleppel".
- `MIN_NOTICE_MIN` (3 h), `CANCEL_DEADLINE_HOURS` (24), `HORIZON_DAYS` (60).
- `CLOSED_ON_PUBLIC_HOLIDAYS` (true), `ALL_DAY_EVENTS_BLOCK` (true): if she keeps birthdays or
  reminders as all-day events in her main calendar, those days would close.

## Kasutusjuhend Ilvile (short)

- Uus veebibroneering ilmub Sinu Google'i kalendrisse (roheline) ja tuleb ka e-kiri
  "Uus broneering". Kirjas on kliendi telefon ja e-post; vastates kirjutad otse kliendile.
- Aja kinni panemiseks lisa kalendrisse tavaline sündmus (nt "Hambaarst 14-15").
  Vaba päev: lisa terve päeva sündmus (nt "Puhkus").
- Kui klient tühistab lingiga, kaob sündmus kalendrist ja Sulle tuleb kiri "Tühistatud".
- Kui Sina pead aja muutma või tühistama: helista kliendile ja muuda/kustuta sündmus
  kalendris. Klient automaatset kirja selle kohta ei saa.

## Known gaps / next

- Bot protection is a honeypot plus the limits above. If spam bookings ever appear, add
  Cloudflare Turnstile (free): verify its token in `createBooking_` with UrlFetchApp.
- To verify on real Google at deploy time (the fakes can't prove these): `.ics` attachment
  charset in Outlook, `Events.list` with `privateExtendedProperty=rid=...` finding an event
  inserted seconds earlier, birthday events in her calendar being skipped.

- When Ilvi moves or deletes a booking herself, the customer is not e-mailed (the reminder
  does use the new time). Possible next step: detect moves in the hourly trigger.
- SMS: not yet. Messente (about 0.04 EUR/SMS) can be added to reminders later.
- Admin web UI for Ilvi (hours, days off, list of bookings): later, if Google Calendar
  is not enough.
- Health check: a daily `?action=ping` from Hermes that e-mails Hanku if booking is down.
