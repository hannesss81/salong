# Online booking (own system)

Customers book at `https://pargiilustuudio.eu/broneeri/`. Bookings land in Ilvi's Google Calendar
as normal events; customers get confirmation, reminder and cancellation e-mails from her Gmail.
Ilvi opens and closes days, changes hours, adds appointments she arranges herself and answers
online requests on her phone at `https://pargiilustuudio.eu/broneeri/haldus/`
("Minu tööajad"). Costs nothing to run.

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

## Invitation-only live trial (2026-11-24)

The real customer trial opens `/broneeri/#proov=…` and uses the production calendar and mail. The plain `/broneeri/` and homepage stay in their closed state. The customer invitation allows availability and requests only; it cannot open management. Ilvi signs in at `/broneeri/haldus/`, where **Ava kliendivaade** also gives her a working customer link. The repository contains only the digest, not the distributed invitation; rotate or clear `TRIAL_INVITE_HASH` and redeploy to replace/revoke trial links. The self-contained phone/desktop customer preview lives in `artifacts/pargi-client-review-2026-11-24/proovibroneering.html` in the workspace. It uses the client page and booking/mail logic with a fictional calendar and in-memory inbox; there is no network transport or persistence. Rebuild it from the workspace with `python3 projects/pargi-ilustuudio/tools/build-client-preview.py artifacts/pargi-client-review-2026-11-24/proovibroneering.html`.

## How it works

- Hours: by default Mon, Tue, Thu, Fri 9:30-20:00 (the last client finishes by 20:00);
  Wednesday, Saturday and Sunday closed; public holidays closed. Customers see 8 weeks ahead,
  rolling. On the admin page Ilvi switches single days open or closed, sets a day's hours,
  closes a date range (vacation) or changes the default week. A day's setting beats the
  default and the holiday rule. Stored in Script Properties (`SCHEDULE`); past days are pruned.
- Customers can select one or more distinct bookable services. Their prices and durations add up, with no gap inside the single visit. Availability, the calendar event, the owner’s review and all emails use that whole visit. The 15-minute buffer still separates different visits.
- All online bookings are **requests**: the slot is held (yellow event titled
  `OOTAB KINNITUST · ...`), the customer is told Ilvi will confirm, and Ilvi gets a "Kinnita:"
  e-mail with a link to approve or decline (the link works without logging in; it signs the
  event id). Approving sends the normal confirmation; declining frees the slot and tells the
  customer. Requests not answered 2 h before the start are withdrawn by the hourly trigger and
  both sides are told. Both pending requests and confirmed visits can be cancelled online when at least 24 hours remain, including exactly 24 hours. Inside that window the customer is asked to call.
- "Lisa aeg": appointments she arranges by phone or in person (until now in her paper notebook)
  are added on her page with date, time, service or duration, and optionally name, phone and a
  note. Any day up to a year ahead, opening hours or not. They are calendar events (colour
  Peacock, private property `pargiManual=1`) and block online booking with the 15-min gap like
  any event; nobody is e-mailed. Overlaps and gaps under 15 min are shown first and saved only
  if she insists. She can delete these from her page (not online bookings or other events).
- `bookingOpen` in `broneeri/config.js`: `false` keeps online booking closed (booking page says
  "avatakse peagi", price list without "Broneeri" links) while her page and cancel links work.
  Before public launch, also leave `PUBLIC_BOOKING_OPEN: false` on the backend: only validated invitations can create real booking requests or fetch times. At the agreed launch, deploy the revised backend with this flag on, then enable the public page. Do not open either for a design review.
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
PORT=8791 REAL_API=1 node booking/dev/server.js   # same pages against the LIVE backend
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
- `MIN_NOTICE_MIN` (3 h), `CANCEL_DEADLINE_HOURS` (24, confirmed on 2026-11-24),
  `HORIZON_DAYS` (56), `REQUIRE_APPROVAL` (true), `REQUEST_EXPIRE_BEFORE_MIN` (120).
- `CLOSED_ON_PUBLIC_HOLIDAYS` (true), `ALL_DAY_EVENTS_BLOCK` (true): an all-day event she adds
  (e.g. "Puhkus") closes the day.

## Kasutusjuhend Ilvile (short)

- **Minu tööajad** (pargiilustuudio.eu/broneeri/haldus/). Telefoni avaekraanile: ava leht
  Chrome'is, vajuta ⋮ ja vali „Lisa avaekraanile“. Iga päeva
  kõrval on lüliti. Roheline = kliendid saavad broneerida, hall = suletud. Kolmapäev ja
  laupäev on vaikimisi suletud: laupäeva avamiseks lülita see roheliseks. Päeva puudutades
  näed broneeringuid ja saad muuta kellaaegu. "Puhkus" sulgeb mitu päeva korraga.
  Sisse logid e-posti lingiga (üks kord telefonis).
- Kõik veebist saadetud broneeringud on esmalt **soovid**. Ühel külastusel võib olla mitu teenust. Kliendi andmed on kirjas ja ootel aeg on kalendris kollasena ("OOTAB KINNITUST") ja
  Sulle tuleb e-kiri "Kinnita: ...". Vajuta kirjas nuppu ja vali Kinnita või Lükka tagasi; klient saab
  kirja ise. Kui Sa ei vasta, võetakse soov 2 tundi enne algust tagasi.
- **Lisa aeg**: telefoni teel või kohapeal kokku lepitud kliendi paned kirja nupuga
  „＋ Lisa aeg“: kuupäev, kellaaeg, teenus (kestus tuleb ise). Nimi ja telefon soovi korral.
  Veebis on see aeg siis kinni. Valesti lisatud aja kustutad päeva vaates nupuga „Kustuta“.
  Märkmikku pole enam vaja: kõik ajad on lehel ja Google'i kalendris.
- Muu kinni panemiseks (arst, koolitus) võid lisada sündmuse ka Google'i kalendrisse.
  Terve päeva sündmus (nt "Puhkus") sulgeb päeva.
- **Ootavad kinnitust**: kinnita soov või lükka see tagasi. Kinnitatud aeg on vastava kuupäeva all.
- **Tühistamised** näitab viimase 14 päeva tühistamisi, ka tagasi võetud, tagasilükatud ja aegunud soove. Kliendi tühistatud aeg vabaneb automaatselt. Uuendamiseks vajuta ↻.
- Vajadusel saad päeva vaates kinnitatud veebiaja ise tühistada nupuga **Tühista**. Klient saab teate. Google’i kalendris otse tehtud kustutuse kohta teade ei lähe ja seda halduse tühistamiste nimekirja ei lisata.

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
