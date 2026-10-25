// Booking backend address (Google Apps Script web app, ends with /exec).
// Empty = the page shows the "call us" fallback. On localhost the dev server serves its own copy.
window.PARGI_BOOKING = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyz0jSK6BdLVYeiOA4iU7WMkG5B9ZWyPacMxijYyxQTdtDPMSQH-Xub5H95OG8gbjMM/exec',
  // false: customers can't book online yet (the booking page says "call", the price list has no
  // "Broneeri" links), but cancel links and Ilvi's page /broneeri/haldus/ work.
  bookingOpen: false,
};
