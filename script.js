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
    state.data = json.services;
    state.categories = Array.from(new Set(state.data.map(s => s.category)));
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
  const filtered = state.activeCategory === 'Kõik' ? state.data : state.data.filter(s => s.category === state.activeCategory);
  filtered.forEach(service => container.appendChild(serviceCard(service)));
  if(filtered.length === 0){
    container.innerHTML = '<p class="empty">Kategoorias pole hetkel teenuseid.</p>';
  }
}

function serviceCard(service){
  const card = document.createElement('article');
  card.className = 'service-card';
  card.innerHTML = `
    <div class="service-top">
      <h3>${service.name}</h3>
      <span class="price">${formatPrice(service.price)}</span>
    </div>
    <p class="service-desc">${service.description}</p>
    <div class="meta-row">
      <span class="service-duration" aria-label="Kestus">${service.duration} min</span>
      <span class="service-meta" aria-label="Kategooria">${service.category}</span>
    </div>
  `;
  return card;
}

function formatPrice(v){ return new Intl.NumberFormat('et-EE',{ style:'currency', currency:'EUR', minimumFractionDigits:0 }).format(v); }

function injectStructuredData(){
  const data = {
    '@context':'https://schema.org',
    '@type':'BeautySalon',
    'name':'Vanalinna Ilusalong',
    'image':'https://www.example.com/assets/og-image.jpg',
    'address':{
      '@type':'PostalAddress',
      'streetAddress':'Tööstuse 1',
      'addressLocality':'Tallinn',
      'postalCode':'10416',
      'addressCountry':'EE'
    },
    'geo': {
      '@type': 'GeoCoordinates',
      'latitude': 59.448, // placeholder
      'longitude': 24.738 // placeholder
    },
    'url':'https://www.example.com',
    'telephone':'+3725000000',
    'priceRange':'€€',
    'openingHoursSpecification':[
      { '@type':'OpeningHoursSpecification','dayOfWeek':['Monday','Tuesday','Wednesday','Thursday','Friday'],'opens':'10:00','closes':'19:00' },
      { '@type':'OpeningHoursSpecification','dayOfWeek':'Saturday','opens':'10:00','closes':'15:00' }
    ],
    'servesCuisine':'',
    'description':'Vanalinna ilusalong Tallinnas: juuksed, küüned, näohooldused.'
  };
  $('#structured-data').textContent = JSON.stringify(data);
}

function setYear(){
  const yEl = document.getElementById('year');
  yEl.textContent = new Date().getFullYear();
}

window.addEventListener('DOMContentLoaded', () => {
  fetchPricing();
  injectStructuredData();
  setYear();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
});
