/**
 * Pargi Ilustuudio booking backend: settings.
 * Edit here, then push with clasp (see booking/README.md). Times are Europe/Tallinn.
 */
var CONFIG = {
  SALON_NAME: 'Pargi Ilustuudio',
  OWNER_NAME: 'Ilvi Metssalu',
  OWNER_EMAIL: 'ilvi.metssalu@gmail.com', // gets a copy of every booking and cancellation
  SITE_URL: 'https://pargiilustuudio.eu',
  BOOKING_PATH: '/broneeri/',
  PRICING_PATH: '/pricing.json',
  ADDRESS: 'Pargi tn 10-10, 50103 Tartu',
  ENTRANCE_NOTE: 'Välisuksel vali number 10.',
  PHONE: '+372 5569 7525',
  MAP_URL: 'https://maps.google.com/?cid=1626287203448523784',

  CALENDAR_ID: 'primary',          // bookings are written here
  BUSY_CALENDAR_IDS: ['primary'],  // events in these calendars block booking times

  // Bookable hours per ISO weekday (1 = Monday ... 7 = Sunday). Several ranges per day allowed.
  // PLACEHOLDER until Ilvi confirms her hours.
  WEEKLY_HOURS: {
    1: [['10:00', '18:00']],
    2: [['10:00', '18:00']],
    3: [['10:00', '18:00']],
    4: [['10:00', '18:00']],
    5: [['10:00', '18:00']],
    6: [['10:00', '15:00']],
  },
  CLOSED_ON_PUBLIC_HOLIDAYS: true,
  CLOSED_DATES: [],                // extra days off, 'YYYY-MM-DD' (an all-day calendar event works too)
  ALL_DAY_EVENTS_BLOCK: true,      // any all-day event in her calendar closes that day

  BUFFER_MIN: 15,                  // free time kept before and after every event
  STEP_MIN: 15,                    // start times on the quarter hour
  MIN_NOTICE_MIN: 180,             // earliest booking: 3 h from now
  HORIZON_DAYS: 60,                // how far ahead customers can book
  CANCEL_DEADLINE_HOURS: 24,       // online cancellation allowed until this many hours before
  REMINDER_HOURS_BEFORE: 48,       // reminder two days ahead, while online cancellation is still open
  REMINDER_MIN_LEAD_HOURS: 60,     // bookings made closer than this to the visit get no reminder
  MAX_UPCOMING_PER_CONTACT: 3,
  MAX_BOOKINGS_PER_DAY: 12,        // safety valve against floods; more than one person can serve
  MAIL_QUOTA_RESERVE: 10,          // stop taking bookings when fewer Gmail recipients are left today
  EVENT_COLOR_ID: '2',             // Google Calendar colour of online bookings (2 = Sage)
  NOTIFY_OWNER: true,
  AVAILABILITY_CACHE_SECONDS: 60,
};
