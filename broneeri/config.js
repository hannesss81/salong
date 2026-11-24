// Booking backend address (Google Apps Script web app, ends with /exec).
// Empty = the page shows the "call us" fallback. On localhost the dev server serves its own copy.
window.PARGI_BOOKING = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyz0jSK6BdLVYeiOA4iU7WMkG5B9ZWyPacMxijYyxQTdtDPMSQH-Xub5H95OG8gbjMM/exec',
  // Closed to the general public. A valid customer trial invitation enables real requests.
  // The public homepage still points to phone/WhatsApp; admin and cancellation links work.
  bookingOpen: false,
};
