// ============================================================
//  POETMAP — map.js
//  Full-featured poet map with sidebars, search, filter, contribute
// ============================================================

// ── State ──────────────────────────────────────────────────

let allPoets = [];
let filteredPoets = [];
let selectedPoetId = null;
let originLatLng = null;
let filterRadiusKm = 500;
let contributeGeo = null;
let contributeRadiusKm = 50;
let markerMap = new Map(); // poetId -> array of Leaflet markers
let originMarker = null;
let radiusCircle = null;

// ── Map setup ──────────────────────────────────────────────

const map = L.map('map', { zoomControl: false }).setView([30, 15], 3);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

const clusters = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 50,
  iconCreateFunction(c) {
    const n = c.getChildCount();
    return L.divIcon({
      html: `<div>${n}</div>`,
      className: 'marker-cluster marker-cluster-small',
      iconSize: [34, 34]
    });
  }
});
map.addLayer(clusters);

// ── Location type colours ───────────────────────────────────

const TYPE_COLOR = {
  birthplace: '#c9a96e',
  residence: '#6e9dc9',
  deathplace: '#c96e6e',
  active: '#6ec98a',
};

function typeColor(t) {
  return TYPE_COLOR[t] || '#aaa';
}

function typeLabel(t) {
  const labels = { birthplace: 'Born', residence: 'Lived', deathplace: 'Died', active: 'Active' };
  return labels[t] || t;
}

// ── Load poets ─────────────────────────────────────────────

async function loadPoets() {
  try {
    const res = await fetch('/api/poets/map');
    allPoets = await res.json();
    updateStats();
    renderAllMarkers();
    renderPoetList();
  } catch (err) {
    console.error('Failed to load poets:', err);
  }
}

function updateStats() {
  document.getElementById('stat-poets').textContent = allPoets.length;
  const totalLocs = allPoets.reduce((n, p) => n + (p.locations ? p.locations.filter(l => l && l.lat).length : 0), 0);
  document.getElementById('stat-locations').textContent = totalLocs;
}

// ── Render all markers ─────────────────────────────────────

function renderAllMarkers() {
  clusters.clearLayers();
  markerMap.clear();

  allPoets.forEach(poet => {
    if (!poet.locations) return;
    const poetMarkers = [];

    poet.locations.forEach(loc => {
      if (!loc || !loc.lat || !loc.lng) return;

      const color = typeColor(loc.location_type);
      const icon = L.divIcon({
        html: `<div class="custom-marker" style="width:12px;height:12px;background:${color};"></div>`,
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      const marker = L.marker([loc.lat, loc.lng], { icon })
        .on('click', () => selectPoet(poet.id));

      poetMarkers.push(marker);
      clusters.addLayer(marker);
    });

    if (poetMarkers.length) markerMap.set(poet.id, poetMarkers);
  });
}

// ── Select / deselect a poet ───────────────────────────────

function selectPoet(poetId) {
  // Deselect previous
  if (selectedPoetId !== null) {
    setMarkerHighlight(selectedPoetId, false);
  }

  if (selectedPoetId === poetId) {
    selectedPoetId = null;
    hidePoetPanel();
    renderPoetList();
    return;
  }

  selectedPoetId = poetId;
  setMarkerHighlight(poetId, true);
  showPoetPanel(poetId);
  renderPoetList();

  // Pan to first location
  const poet = allPoets.find(p => p.id === poetId);
  if (poet && poet.locations) {
    const first = poet.locations.find(l => l && l.lat);
    if (first) map.panTo([first.lat, first.lng], { animate: true });
  }
}

function clearSelectedPoet() {
  if (selectedPoetId) setMarkerHighlight(selectedPoetId, false);
  selectedPoetId = null;
  hidePoetPanel();
  renderPoetList();
}

function setMarkerHighlight(poetId, on) {
  const markers = markerMap.get(poetId);
  if (!markers) return;
  markers.forEach(m => {
    const el = m.getElement();
    if (!el) return;
    const inner = el.querySelector('.custom-marker');
    if (!inner) return;
    if (on) {
      inner.classList.add('selected');
      inner.style.width = '16px';
      inner.style.height = '16px';
    } else {
      inner.classList.remove('selected');
      inner.style.width = '12px';
      inner.style.height = '12px';
    }
  });
}

// ── Poet panel ─────────────────────────────────────────────

function showPoetPanel(poetId) {
  const poet = allPoets.find(p => p.id === poetId);
  if (!poet) return;

  const panel = document.getElementById('poet-panel');
  const content = document.getElementById('poet-panel-content');

  const works = (poet.works || []).filter(w => w && w.title);
  const locs = (poet.locations || []).filter(l => l && l.place_name);

  content.innerHTML = `
    ${poet.image_url ? `<img class="panel-image" src="${esc(poet.image_url)}" alt="${esc(poet.name)}" onerror="this.style.display='none'"/>` : ''}
    <div class="panel-name">${esc(poet.name)}</div>
    ${poet.bio ? `<p class="panel-bio">${esc(poet.bio)}</p>` : ''}
    ${poet.wiki_url ? `<a class="panel-wiki-link" href="${esc(poet.wiki_url)}" target="_blank">Read more ↗</a>` : ''}

    ${locs.length ? `
      <div class="panel-section-title">Locations</div>
      <div class="panel-locations">
        ${locs.map(l => `
          <div class="panel-loc-item" onclick="flyToLocation(${l.lat}, ${l.lng})">
            <span class="loc-type-badge" style="background:${typeColor(l.location_type)}22;color:${typeColor(l.location_type)}">${typeLabel(l.location_type)}</span>
            <span class="panel-loc-name">${esc(l.place_name)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${works.length ? `
      <div class="panel-section-title">Works</div>
      <div class="panel-works">
        ${works.map(w => `
          <div class="panel-work-item">
            <div>
              ${w.url ? `<a href="${esc(w.url)}" target="_blank" style="color:var(--text);text-decoration:none;" class="work-title">${esc(w.title)}</a>` : `<span class="work-title">${esc(w.title)}</span>`}
              ${w.year ? `<span class="work-year">${w.year}</span>` : ''}
            </div>
            ${w.description ? `<div class="work-desc">${esc(w.description)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  panel.classList.remove('hidden');
}

function hidePoetPanel() {
  document.getElementById('poet-panel').classList.add('hidden');
}

function flyToLocation(lat, lng) {
  map.flyTo([lat, lng], 10, { animate: true, duration: 1.2 });
}

// ── Poet list ──────────────────────────────────────────────

function renderPoetList() {
  const list = document.getElementById('poet-list');
  const countEl = document.getElementById('poet-count');

  const poets = filteredPoets.length || filteredPoets === allPoets ? filteredPoets : allPoets;
  countEl.textContent = poets.length;

  if (!poets.length) {
    list.innerHTML = `<div style="padding:12px;font-size:0.75rem;color:var(--text-dim);font-style:italic">No poets found</div>`;
    return;
  }

  list.innerHTML = poets.map(poet => {
    const locCount = (poet.locations || []).filter(l => l && l.lat).length;
    const initial = poet.name ? poet.name[0].toUpperCase() : '?';
    const isActive = poet.id === selectedPoetId;
    return `
      <div class="poet-list-item ${isActive ? 'active' : ''}" onclick="selectPoet(${poet.id})">
        ${poet.image_url
          ? `<img class="poet-list-avatar" src="${esc(poet.image_url)}" alt="" onerror="this.style.display='none'">`
          : `<div class="poet-list-avatar-placeholder">${initial}</div>`
        }
        <span class="poet-list-name">${esc(poet.name)}</span>
        <span class="poet-list-locs">${locCount}</span>
      </div>
    `;
  }).join('');
}

// ── Search & filter ────────────────────────────────────────

function filterPoets() {
  const q = document.getElementById('poet-search').value.trim().toLowerCase();
  let result = allPoets;

  if (q) {
    result = result.filter(p => p.name && p.name.toLowerCase().includes(q));
  }

  if (originLatLng) {
    result = result.filter(p => {
      if (!p.locations) return false;
      return p.locations.some(l => {
        if (!l || !l.lat) return false;
        return haversineKm(originLatLng.lat, originLatLng.lng, l.lat, l.lng) <= filterRadiusKm;
      });
    });
  }

  filteredPoets = result;
  renderPoetList();
  dimUnfilteredMarkers();
}

function dimUnfilteredMarkers() {
  const visibleIds = new Set(filteredPoets.map(p => p.id));

  allPoets.forEach(poet => {
    const markers = markerMap.get(poet.id);
    if (!markers) return;
    const visible = visibleIds.has(poet.id) || !originLatLng && !document.getElementById('poet-search').value;
    markers.forEach(m => {
      const el = m.getElement();
      if (!el) return;
      el.style.opacity = visible ? '1' : '0.15';
    });
  });
}

function updateDistanceFilter() {
  const val = parseInt(document.getElementById('dist-slider').value);
  filterRadiusKm = val;
  document.getElementById('dist-val').textContent = val >= 1000 ? `${(val/1000).toFixed(1)}k km` : `${val} km`;

  if (originLatLng) {
    if (radiusCircle) map.removeLayer(radiusCircle);
    radiusCircle = L.circle([originLatLng.lat, originLatLng.lng], {
      radius: filterRadiusKm * 1000,
      color: 'var(--accent)',
      fillColor: '#c9a96e',
      fillOpacity: 0.04,
      weight: 1,
      dashArray: '4 4',
    }).addTo(map);

    filterPoets();
  }
}

function clearDistanceFilter() {
  originLatLng = null;
  if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
  if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }

  document.getElementById('dist-slider').disabled = true;
  document.getElementById('filter-hint').textContent = 'Click a point on the map to set origin';
  document.getElementById('btn-clear-filter').style.display = 'none';

  // Reset opacity
  markerMap.forEach(markers => markers.forEach(m => {
    const el = m.getElement();
    if (el) el.style.opacity = '1';
  }));

  filterPoets();
}

// Click on map to set origin
map.on('click', e => {
  if (document.getElementById('view-map').classList.contains('view-active')) {
    setOrigin(e.latlng);
  }
});

function setOrigin(latlng) {
  originLatLng = latlng;

  if (originMarker) map.removeLayer(originMarker);
  const pulseIcon = L.divIcon({
    html: `<div class="origin-pulse"></div>`,
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  originMarker = L.marker([latlng.lat, latlng.lng], { icon: pulseIcon }).addTo(map);

  document.getElementById('dist-slider').disabled = false;
  document.getElementById('filter-hint').textContent = `Origin set — drag slider to filter`;
  document.getElementById('btn-clear-filter').style.display = 'block';

  updateDistanceFilter();
}

// ── Views ──────────────────────────────────────────────────

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('view-active'));
  document.getElementById(`view-${view}`).classList.add('view-active');

  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });

  // Show/hide right sidebar only on map
  const rightSidebar = document.getElementById('sidebar-right');
  rightSidebar.style.display = view === 'map' ? '' : 'none';

  if (view === 'map') {
    setTimeout(() => map.invalidateSize(), 50);
  }
}

// ── Sidebar toggles ────────────────────────────────────────

function toggleSidebar(side) {
  const el = document.getElementById(`sidebar-${side}`);
  if (window.innerWidth <= 900) {
    el.classList.toggle('open');
  } else {
    el.classList.toggle('collapsed');
  }
  setTimeout(() => map.invalidateSize(), 350);
}

// ── Contribute page ────────────────────────────────────────

async function geocodeSearch() {
  const input = document.getElementById('geo-input').value.trim();
  if (!input) return;

  const resultEl = document.getElementById('geo-result');
  resultEl.classList.remove('hidden', 'success', 'error');
  resultEl.textContent = 'Searching...';

  // Try parsing as lat,lng first
  const coordMatch = input.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    contributeGeo = { lat, lng, displayName: `${lat}, ${lng}`, country: '' };
    resultEl.classList.add('success');
    resultEl.textContent = `Found: ${lat}, ${lng}`;
    findNearbyPoets();
    return;
  }

  // Nominatim geocode
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (!data.length) {
      resultEl.classList.add('error');
      resultEl.textContent = 'Location not found. Try a different search.';
      return;
    }

    const place = data[0];
    contributeGeo = {
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
      displayName: place.display_name,
      country: place.address?.country || '',
      type: place.type,
    };

    resultEl.classList.add('success');
    resultEl.textContent = `Found: ${place.display_name}`;
    findNearbyPoets();
  } catch (err) {
    resultEl.classList.add('error');
    resultEl.textContent = 'Geocoding failed. Check your network connection.';
  }
}

function setRadius(btn, km) {
  document.querySelectorAll('.radius-pills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  contributeRadiusKm = km;
  if (contributeGeo) findNearbyPoets();
}

function findNearbyPoets() {
  if (!contributeGeo || !allPoets.length) return;

  const { lat, lng } = contributeGeo;
  const nearbyDiv = document.getElementById('nearby-poets');
  const listEl = document.getElementById('nearby-list');

  let nearby = [];

  if (contributeRadiusKm === 0) {
    // Country-level: try to match country name in place names
    const country = contributeGeo.displayName.split(',').pop().trim().toLowerCase();
    nearby = allPoets.filter(p =>
      p.locations && p.locations.some(l =>
        l && l.place_name && l.place_name.toLowerCase().includes(country)
      )
    ).map(p => ({ poet: p, dist: null }));
  } else {
    nearby = allPoets
      .map(p => {
        if (!p.locations) return null;
        const minDist = Math.min(...p.locations
          .filter(l => l && l.lat)
          .map(l => haversineKm(lat, lng, l.lat, l.lng)));
        return minDist <= contributeRadiusKm ? { poet: p, dist: Math.round(minDist) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist);
  }

  nearbyDiv.classList.remove('hidden');

  if (!nearby.length) {
    listEl.innerHTML = `<div style="font-size:0.75rem;color:var(--text-dim);font-style:italic;padding:8px 0">No poets found in this area yet — be the first!</div>`;
    return;
  }

  listEl.innerHTML = nearby.slice(0, 12).map(({ poet, dist }) => `
    <div class="nearby-item">
      <span class="nearby-name">${esc(poet.name)}</span>
      ${dist !== null ? `<span class="nearby-dist">${dist} km</span>` : '<span class="nearby-dist">same country</span>'}
    </div>
  `).join('');
}

function fillFromGeo() {
  if (!contributeGeo) {
    alert('Search for a location first.');
    return;
  }
  document.getElementById('c-lat').value = contributeGeo.lat.toFixed(5);
  document.getElementById('c-lng').value = contributeGeo.lng.toFixed(5);

  // Attempt to get a short place name from display name
  const parts = contributeGeo.displayName.split(',').map(s => s.trim());
  const shortName = parts.slice(0, 2).join(', ');
  if (!document.getElementById('c-placename').value) {
    document.getElementById('c-placename').value = shortName;
  }
}

async function submitPoet() {
  const name = document.getElementById('c-name').value.trim();
  const bio = document.getElementById('c-bio').value.trim();
  const wiki_url = document.getElementById('c-wiki').value.trim();
  const image_url = document.getElementById('c-image').value.trim();
  const location_type = document.getElementById('c-loctype').value;
  const place_name = document.getElementById('c-placename').value.trim();
  const lat = parseFloat(document.getElementById('c-lat').value);
  const lng = parseFloat(document.getElementById('c-lng').value);

  const statusEl = document.getElementById('submit-status');

  if (!name || !place_name || isNaN(lat) || isNaN(lng)) {
    statusEl.className = 'submit-status error';
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Please fill in Name, Place name, Latitude and Longitude.';
    return;
  }

  statusEl.className = 'submit-status';
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poet_name: name, poet_bio: bio, poet_wiki_url: wiki_url, poet_image_url: image_url,
        location_type, place_name, lat, lng,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    statusEl.className = 'submit-status success';
    if (data.auto_approved) {
      statusEl.textContent = `⚡ ${name} was auto-approved and is now live on the map!`;
      await loadPoets();
    } else {
      statusEl.textContent = `✦ ${name} submitted for review. Thank you for contributing!`;
    }

    // Refresh user karma display
    const me = await fetch('/auth/me');
    if (me.ok) { currentUser = await me.json(); renderAuthSection(); }

    // Clear form
    ['c-name','c-bio','c-wiki','c-image','c-placename','c-lat','c-lng'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('nearby-poets').classList.add('hidden');
    document.getElementById('geo-result').classList.add('hidden');
    contributeGeo = null;

    if (data.auto_approved) setTimeout(() => switchView('map'), 1800);

  } catch (err) {
    statusEl.className = 'submit-status error';
    statusEl.textContent = `Error: ${err.message}`;
  }
}

// ── Utilities ──────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ───────────────────────────────────────────────────

filteredPoets = allPoets; // start with all
loadPoets();

// Keep filtered list in sync after load
const origLoad = loadPoets;


// ── Auth ───────────────────────────────────────────────────

let currentUser = null;

async function initAuth() {
  try {
    const res = await fetch('/auth/me');
    if (res.ok) {
      currentUser = await res.json();
    }
  } catch (_) {}
  renderAuthSection();
  renderContributeGate();
}

function renderAuthSection() {
  const el = document.getElementById('auth-section');
  if (!el) return;
  if (currentUser) {
    el.innerHTML = `
      <div class="auth-user">
        ${currentUser.avatar_url
          ? `<img class="auth-avatar" src="${esc(currentUser.avatar_url)}" alt="" />`
          : `<div class="auth-avatar" style="background:var(--surface2);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:.7rem;color:var(--accent)">${esc(currentUser.display_name?.[0] ?? '?')}</div>`}
        <span class="auth-name"><a class="account-link" href="/account">${esc(currentUser.display_name)}</a></span>
        <button class="auth-logout-btn" onclick="logout()">Sign out</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="auth-sign-in">
        <div class="auth-label">Sign in</div>
        <a href="/auth/google" class="oauth-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Google
        </a>
        <a href="/auth/github" class="oauth-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHub
        </a>
      </div>`;
  }
}

function renderContributeGate() {
  const gate = document.getElementById('contribute-auth-gate');
  const form = document.getElementById('contribute-form');
  if (!gate || !form) return;
  if (currentUser) {
    gate.style.display = 'none';
    form.style.display = '';
  } else {
    gate.style.display = '';
    form.style.display = 'none';
  }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  currentUser = null;
  renderAuthSection();
  renderContributeGate();
}

// Handle ?auth=success redirect after OAuth
if (new URLSearchParams(location.search).get('auth') === 'success') {
  history.replaceState({}, '', '/');
}

initAuth();

// ── Curator Queue ──────────────────────────────────────────────────────────

async function loadCuratorQueue() {
  const res  = await fetch('/api/curator/pending');
  const el   = document.getElementById('curator-queue');
  const badge = document.getElementById('nav-curator-badge');
  if (!res.ok) { el.innerHTML = `<div class="queue-empty">Could not load queue.</div>`; return; }
  const items = await res.json();

  if (badge) {
    if (items.length > 0) { badge.textContent = items.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  if (!items.length) {
    el.innerHTML = `<div class="queue-empty">✦ Queue is empty — all caught up.</div>`;
    return;
  }

  el.innerHTML = items.map(c => `
    <div class="queue-card" id="qcard-${c.id}">
      <div>
        <div class="queue-poet-name">${esc(c.poet_name)}</div>
        <div class="queue-meta">
          <span class="queue-tag">Location <span>${esc(c.place_name)}</span></span>
          <span class="queue-tag">Type <span>${esc(c.location_type)}</span></span>
          <span class="queue-tag">Coords <span>${Number(c.lat).toFixed(4)}, ${Number(c.lng).toFixed(4)}</span></span>
          ${c.poet_wiki_url ? `<a href="${esc(c.poet_wiki_url)}" target="_blank" class="queue-tag" style="color:var(--accent);text-decoration:none">Wiki ↗</a>` : ''}
        </div>
        ${c.poet_bio ? `<div class="queue-bio">${esc(c.poet_bio)}</div>` : ''}
        <div class="queue-submitter">
          ${c.submitter_avatar ? `<img src="${esc(c.submitter_avatar)}" />` : ''}
          ${esc(c.submitter_name)}
          <span class="karma-tag">karma ${c.submitter_karma}</span>
          <span style="margin-left:4px;color:var(--text-dim)">${new Date(c.submitted_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="queue-actions">
        <button class="queue-btn queue-btn-approve" onclick="curatorAction(${c.id},'approve',this)">✓ Approve</button>
        <button class="queue-btn queue-btn-deny"    onclick="curatorAction(${c.id},'deny',this)">✗ Deny</button>
      </div>
    </div>
  `).join('');
}

async function curatorAction(id, action, btn) {
  btn.closest('.queue-card').querySelectorAll('button').forEach(b => b.disabled = true);
  const res = await fetch(`/api/curator/${action}/${id}`, { method: 'POST' });
  const card = document.getElementById(`qcard-${id}`);
  if (res.ok) {
    card.style.transition = 'opacity .3s, transform .3s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    setTimeout(() => { card.remove(); checkQueueEmpty(); }, 300);
    // Update curator badge count
    const badge = document.getElementById('nav-curator-badge');
    if (badge) {
      const n = parseInt(badge.textContent) - 1;
      if (n <= 0) badge.classList.add('hidden');
      else badge.textContent = n;
    }
  } else {
    card.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

function checkQueueEmpty() {
  const el = document.getElementById('curator-queue');
  if (el && el.children.length === 0) {
    el.innerHTML = `<div class="queue-empty">✦ Queue is empty — all caught up.</div>`;
  }
}

// ── Extend switchView to handle curator ────────────────────────────────────

const _origSwitchView = typeof switchView === 'function' ? switchView : null;

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('view-active'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));

  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('view-active');

  const link = document.querySelector(`.nav-link[data-view="${name}"]`);
  if (link) link.classList.add('active');

  // Right sidebar: hide when on full-width views
  const rightSidebar = document.getElementById('sidebar-right');
  if (rightSidebar) {
    rightSidebar.style.display = (name === 'contribute' || name === 'curator') ? 'none' : '';
  }

  if (name === 'curator') loadCuratorQueue();
}

// Patch renderContributeGate to also show/hide curator link
const _origRenderGate = renderContributeGate;
function renderContributeGate() {
  _origRenderGate && _origRenderGate();
  const curatorNav = document.getElementById('nav-curator');
  if (!curatorNav) return;
  if (currentUser && (currentUser.role === 'curator' || currentUser.role === 'admin')) {
    curatorNav.classList.remove('hidden');
    loadCuratorQueue(); // pre-load badge count
  } else {
    curatorNav.classList.add('hidden');
  }
}
