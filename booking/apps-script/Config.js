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
  ADMIN_PATH: '/broneeri/haldus/',
  PRICING_PATH: '/pricing.json',
  ADDRESS: 'Pargi tn 10-10, 50103 Tartu',
  ENTRANCE_NOTE: 'Välisuksel vali number 10.',
  PHONE: '+372 5569 7525',
  MAP_URL: 'https://maps.google.com/?cid=1626287203448523784',

  CALENDAR_ID: 'primary',          // bookings are written here
  BUSY_CALENDAR_IDS: ['primary'],  // events in these calendars block booking times

  // Default bookable hours per ISO weekday (1 = Monday ... 7 = Sunday); the last client finishes
  // by the end time. Wednesday and Saturday are closed unless Ilvi opens them on the admin page,
  // which can also change these defaults (stored in Script Properties, overriding this).
  WEEKLY_HOURS: {
    1: [['09:30', '20:00']],
    2: [['09:30', '20:00']],
    4: [['09:30', '20:00']],
    5: [['09:30', '20:00']],
  },
  OPEN_DAY_DEFAULT: [['09:30', '20:00']], // hours used when she opens a normally closed day
  CLOSED_ON_PUBLIC_HOLIDAYS: true,
  CLOSED_DATES: [],                // extra days off, 'YYYY-MM-DD' (an all-day calendar event works too)
  ALL_DAY_EVENTS_BLOCK: true,      // any all-day event in her calendar closes that day

  BUFFER_MIN: 15,                  // free time kept before and after every event
  STEP_MIN: 15,                    // start times on the quarter hour
  MIN_NOTICE_MIN: 180,             // earliest booking: 3 h from now
  HORIZON_DAYS: 56,                // how far ahead customers can book (rolling 8 weeks)
  APPROVAL_WITHIN_HOURS: 36,       // bookings starting sooner than this are requests Ilvi confirms
  REQUEST_EXPIRE_BEFORE_MIN: 120,  // unanswered requests are withdrawn this long before the start
  PENDING_COLOR_ID: '5',           // Google Calendar colour of unconfirmed requests (5 = Banana)
  ADMIN_LOGIN_PER_DAY: 5,          // login e-mails to Ilvi per day at most
  ADMIN_SESSION_DAYS: 365,
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
