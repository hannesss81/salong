# Online booking (own system)

Customers book at `https://pargiilustuudio.eu/broneeri/`. Bookings land in Ilvi's Google Calendar
as normal events; customers get confirmation, reminder and cancellation e-mails from her Gmail.
Ilvi opens and closes days, changes hours and answers short-notice requests on her phone at
`https://pargiilustuudio.eu/broneeri/haldus/` ("Minu tööajad"). Costs nothing to run.

```
broneeri/            public booking page (served by GitHub Pages with the rest of the site)
  index.html  broneeri.js  broneeri.css  privaatsus.html
  slots.js           slot engine, shared with the backend (pure JS, tested)
  config.js          backend URL (apiUrl). Empty = page shows "please call" fallback
  haldus/            Ilvi's admin page: index.html haldus.js haldus.css manifest.webmanifest
booking/
  apps-script/       Google Apps Script backend (web app, runs as Ilvi)
    Config.js        default hours, buffer, notice, deadlines, e-mail addresses  <- settings
    Api.js           doGet / doPost routing
    Availability.js  opening windows + busy times from her calendar
    Schedule.js      hours as set on the admin page (Script Properties), validation
    Admin.js         admin API: e-mail login link, sessions, overview, hours, approvals
    Bookings.js      book, look up, cancel, hourly trigger (expiry + reminders), setup()
    Store.js         calendar access, cancel-link tokens
    Mail.js          Estonian e-mails + .ics attachment
    Slots.js         GENERATED copy of broneeri/slots.js (node booking/dev/sync.js)
    Services.js      GENERATED bookable services from pricing.json (fallback, same command)
    .clasp.json      Apps Script project id (not secret)
    appsscript.json  manifest: Calendar advanced service, web app settings, scopes
  dev/
    gas.js           in-memory fakes of the Google services (tests + preview)
    server.js        local preview: site + /api + /__dev/ panel (calendar, sent e-mails)
    sync.js          copies slots.js into apps-script/
  test/              node:test suites
```

## How it works

- Hours: by default Mon, Tue, Thu, Fri 9:30-20:00 (the last client finishes by 20:00);
  Wednesday, Saturday and Sunday closed; public holidays closed. Customers see 8 weeks ahead,
  rolling. On the admin page Ilvi switches single days open or closed, sets a day's hours,
  closes a date range (vacation) or changes the default week. A day's setting beats the
  default and the holiday rule. Stored in Script Properties (`SCHEDULE`); past days are pruned.
- Bookings starting within 36 h are **requests**: the slot is held (yellow event titled
  `OOTAB KINNITUST · ...`), the customer is told Ilvi will confirm, and Ilvi gets a "Kinnita:"
  e-mail with a link to approve or decline (the link works without logging in; it signs the
  event id). Approving sends the normal confirmation; declining frees the slot and tells the
  customer. Requests not answered 2 h before the start are withdrawn by the hourly trigger and
  both sides are told. Customers can withdraw a request at any time. Later bookings are instant.
- Admin login: the page asks the backend to e-mail a login link to OWNER_EMAIL only (5 a day at
  most). The link holds a 30-minute single-use token, swapped for a one-year session kept in
  the phone's browser. `admin_logout_all` (or bumping `ADMIN_VERSION` in Script Properties)
  signs out every device. Safari drops site data after 7 days without a visit; she then
  asks for a new link.
- Services, prices and durations come from `/pricing.json` (`id`, `duration`; `bookable: false`
  hides one). The booking page reads it directly; the backend fetches it from the live site
  (cached 10 min, last good copy kept), so the price list and booking can't disagree. If the
  live file can't be read or has no durations, the backend uses `Services.js`, a copy that
  `sync.js` bundles at deploy time.
- The page asks the backend once for opening windows and busy times (her events, clipped to
  opening hours so nothing else leaks), then computes start times locally with `slots.js`.
  On "Kinnita" the backend re-checks under a script lock with fresh calendar data.
- Start times sit on a 15-min grid. Every event in her calendar gets 15 min of free time
  before and after it. All-day events she adds close the day (even though Google marks them
  "Free" by default); contacts' birthdays and working-location entries don't. Timed events
  marked "Vaba" (free) and declined invitations don't block. Estonian public holidays are
  closed. Busy times sent to the page are rounded out to the quarter hour.
- Each booking is an event (title `Name · Service`, colour Sage) with contact details in the
  description and private extended properties (`pargi=1`, state, email, phone, comment,
  createdMs, rid, reminderFor).
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
`/__dev/` lists calendar events and renders every e-mail sent (with the .ics), including the
admin login link: open `/broneeri/haldus/`, press "Saada link", then follow the link from the
"Minu tööajad: sisselogimine" mail in `/__dev/`.
When testing in the agent's Edge, bring the tab to the front (`Page.bringToFront`): Edge
freezes background tabs and their fetches never complete.

## Deployment (live since 2026-10-25)

- Apps Script project "Pargi broneeringud" in **ilvi.metssalu@gmail.com**:
  https://script.google.com/d/1sBJcBMdOe8lYhElqykk8Aj601rhLf-hIv6Sqi6-L65TlFulSIjx2pqNV/edit
- Web app deployment id `AKfycbyz0jSK6BdLVYeiOA4iU7WMkG5B9ZWyPacMxijYyxQTdtDPMSQH-Xub5H95OG8gbjMM` (the URL in `broneeri/config.js`). Executes as Ilvi, access
  Anyone (from `appsscript.json`).
- clasp's login for her account is in `~/.clasprc.json` on the Hermes host.

Updating the backend (same URL):

```
node booking/dev/sync.js && node --test booking/test/
cd booking/apps-script
npx @google/clasp@3.4.1 push -f
npx @google/clasp@3.4.1 create-deployment -i AKfycbyz0jSK6BdLVYeiOA4iU7WMkG5B9ZWyPacMxijYyxQTdtDPMSQH-Xub5H95OG8gbjMM -d "what changed"
```

If a change adds a permission (new scope in `appsscript.json`), run `setup` once in the editor
so Ilvi's account approves it, before redeploying. The pages (`broneeri/`) deploy with the site.

First-time setup, for reference: Apps Script API on at script.google.com/home/usersettings;
`clasp login` (Google asks Ilvi to confirm on her phone); `clasp create-script --type standalone
--title "Pargi broneeringud"` (it overwrites `appsscript.json` with a default: restore ours);
`clasp push -f`; run `setup` in the editor and approve ("Google hasn't verified this app" ->
Advanced -> Go to Pargi broneeringud -> Select all -> Continue); `clasp create-deployment`.
The setup log said `OK: 47 bookable services (from bundled copy), calendar reachable ...,
hourly trigger created, e-mail quota left today: 100.`

## Settings (Config.js)

- `WEEKLY_HOURS` (defaults until she changes them on the admin page), `OPEN_DAY_DEFAULT`.
- `MIN_NOTICE_MIN` (3 h), `CANCEL_DEADLINE_HOURS` (24, still to confirm with Ilvi),
  `HORIZON_DAYS` (56), `APPROVAL_WITHIN_HOURS` (36), `REQUEST_EXPIRE_BEFORE_MIN` (120).
- `CLOSED_ON_PUBLIC_HOLIDAYS` (true), `ALL_DAY_EVENTS_BLOCK` (true): an all-day event she adds
  (e.g. "Puhkus") closes the day.

## Kasutusjuhend Ilvile (short)

- **Minu tööajad** (pargiilustuudio.eu/broneeri/haldus/, pane telefoni avaekraanile): iga päeva
  kõrval on lüliti. Roheline = kliendid saavad broneerida, hall = suletud. Kolmapäev ja
  laupäev on vaikimisi suletud: laupäeva avamiseks lülita see roheliseks. Päeva puudutades
  näed broneeringuid ja saad muuta kellaaegu. "Puhkus" sulgeb mitu päeva korraga.
  Sisse logid e-posti lingiga (üks kord telefonis).
- Uus veebibroneering ilmub Sinu Google'i kalendrisse (roheline) ja tuleb ka e-kiri
  "Uus broneering". Kirjas on kliendi telefon ja e-post; vastates kirjutad otse kliendile.
- Lähema 36 tunni broneeringud on **soovid**: kalendris kollasena ("OOTAB KINNITUST") ja
  e-kiri "Kinnita: ...". Vajuta kirjas nuppu ja vali Kinnita või Lükka tagasi; klient saab
  kirja ise. Kui Sa ei vasta, võetakse soov 2 tundi enne algust tagasi.
- Aja kinni panemiseks lisa kalendrisse tavaline sündmus (nt "Hambaarst 14-15").
  Terve päeva sündmus (nt "Puhkus") sulgeb ka päeva.
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
- Optional: a Sunday-evening e-mail to Ilvi with next week's open days ("Laupäev suletud.
  Avan?"), if she forgets to open Saturdays.
- Health check: a daily `?action=ping` from Hermes that e-mails Hanku if booking is down.
