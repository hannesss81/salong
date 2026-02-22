// Pricing & dynamic behaviors
const pricingDataUrl = 'pricing.json';

const state = {
  data: [],
  categories: [],
  activeCategory: 'Kõik'
};

function $(sel, ctx=document){ return ctx.querySelector(sel); }
function $all(sel, ctx=document){ return [...ctx.querySelectorAll(sel)]; }

async function fetchPricing(){
  try {
    const res = await fetch(pricingDataUrl);
    if(!res.ok) throw new Error('Pricing data load failed');
    const json = await res.json();
    // Data uses 'categories' arrays only; no legacy single category support.
    state.data = json.services;
    const allCats = state.data.flatMap(s => Array.isArray(s.categories) ? s.categories : []);
    state.categories = Array.from(new Set(allCats));
    renderCategoryTabs();
    renderServices();
  } catch(err){
    console.error(err);
    $('#pricing-container').innerHTML = '<p class="error">Hinnakirja laadimine ebaõnnestus.</p>';
  }
}

function renderCategoryTabs(){
  const wrapper = $('.pricing-filters');
  wrapper.innerHTML = '';
  const allBtn = createTabButton('Kõik');
  wrapper.appendChild(allBtn);
  state.categories.forEach(cat => wrapper.appendChild(createTabButton(cat)));
}

function createTabButton(label){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role','tab');
  btn.setAttribute('aria-selected', label === state.activeCategory ? 'true' : 'false');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    state.activeCategory = label;
    $all('.pricing-filters button').forEach(b => b.setAttribute('aria-selected','false'));
    btn.setAttribute('aria-selected','true');
    renderServices();
  });
  return btn;
}

function renderServices(){
  const container = $('#pricing-container');
  container.innerHTML = '';
  const filtered = state.activeCategory === 'Kõik'
    ? state.data
    : state.data.filter(s => Array.isArray(s.categories) && s.categories.includes(state.activeCategory));
  filtered.forEach(service => container.appendChild(serviceCard(service)));
  if(filtered.length === 0){
    container.innerHTML = '<p class="empty">Kategoorias pole hetkel teenuseid.</p>';
  }
}

function serviceCard(service){
  const card = document.createElement('article');
  card.className = 'service-card';
  const hasDesc = service.description && service.description.length > 0;
  const isLongDesc = hasDesc && service.description.length > 80;

  if (service.new) card.classList.add('service-card--new');

  card.innerHTML = `
    ${service.new ? '<span class="badge-new">Uus</span>' : ''}
    <div class="service-top">
      <h3>${service.name}</h3>
      <span class="price">${formatPrice(service.price)}</span>
    </div>
    ${hasDesc ? `
      <div class="service-desc-wrap${isLongDesc ? ' collapsed' : ''}">
        <p class="service-desc">${service.description}</p>
        ${isLongDesc ? '<button class="desc-toggle" aria-expanded="false">Loe rohkem</button>' : ''}
      </div>
    ` : ''}
  `;

  // Add toggle functionality for long descriptions
  if (isLongDesc) {
    const toggle = card.querySelector('.desc-toggle');
    const wrap = card.querySelector('.service-desc-wrap');
    toggle.addEventListener('click', () => {
      const expanded = wrap.classList.toggle('collapsed');
      toggle.textContent = expanded ? 'Loe rohkem' : 'Näita vähem';
      toggle.setAttribute('aria-expanded', !expanded);
    });
  }

  return card;
}

function formatPrice(v){ return new Intl.NumberFormat('et-EE',{ style:'currency', currency:'EUR', minimumFractionDigits:0 }).format(v); }

function injectStructuredData(){
  const data = {
    '@context':'https://schema.org',
    '@type':'BeautySalon',
    'name':'Pargi Ilustuudio',
    'image':'https://www.pargiilustuudio.eu/assets/og-image.jpg',
    'address':{
      '@type':'PostalAddress',
      'streetAddress':'Pargi 10-10',
      'addressLocality':'Tartu',
      'postalCode':'49127',
      'addressCountry':'EE'
    },
    'geo': {
      '@type': 'GeoCoordinates',
      'latitude': 58.377, // placeholder for Tartu
      'longitude': 26.729 // placeholder for Tartu
    },
    'url':'https://www.pargiilustuudio.eu',
    'telephone':'+37255697525',
    'priceRange':'€€',
    'openingHours':'E-L Kokkuleppel',
    'servesCuisine':'',
    'description':'Pargi Ilustuudio Tartus: näohooldused, ripsmed ja kulmud, depilatsioon.'
  };
  $('#structured-data').textContent = JSON.stringify(data);
}

function setYear(){
  const yEl = document.getElementById('year');
  yEl.textContent = new Date().getFullYear();
}

// Header scroll effect
function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    lastScroll = currentScroll;
  }, { passive: true });
}

// Reveal animations on scroll
function initRevealAnimations() {
  const reveals = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  reveals.forEach(el => observer.observe(el));
}

// Booklux integration placeholder
// TODO: Replace this URL with actual Booklux embed URL when available
const BOOKLUX_URL = null; // Set to your Booklux URL, e.g., 'https://booklux.com/your-salon'

function initBooklux() {
  const container = document.getElementById('booklux-container');
  if (!container) return;

  if (BOOKLUX_URL) {
    // When Booklux URL is available, embed it
    container.innerHTML = `
      <iframe
        src="${BOOKLUX_URL}"
        width="100%"
        height="600"
        frameborder="0"
        style="border-radius: 16px; border: 1px solid var(--glass-border);"
        title="Broneeri aeg">
      </iframe>
    `;
  }
  // If no URL, keep the placeholder with contact options
}

window.addEventListener('DOMContentLoaded', () => {
  fetchPricing();
  injectStructuredData();
  setYear();
  initHeaderScroll();
  initRevealAnimations();
  initBooklux();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
});
