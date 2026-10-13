/**
 * ============================================================================
 * ISS LIVE TRACKER — APPLICATION LOGIC
 * NORAD Satellite ID: 25544 (International Space Station)
 * Optimized for: High Performance & Comprehensive Mobile Responsiveness
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURATION & STATE
// ----------------------------------------------------------------------------
const API_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const POLL_INTERVAL_MS = 5000; // 5-second refresh interval
const MAX_TRAIL_POINTS = 50;   // Maximum historical trail points

// Application State
let currentPos = null;          // { lat, lon, alt, speed, ... }
let previousPos = null;         // Reference position for smooth LERP interpolation
let trailCoordinates = [];      // Array of [lat, lon] tuples
let autoCenterEnabled = true;   // Automatically follow the ISS
let isFirstLoad = true;
let isReconnecting = false;
let countdownRemaining = 5;
let animationFrameId = null;
let pollIntervalTimer = null;
let countdownIntervalTimer = null;

// DOM Elements
const elStatusPill = document.getElementById('status-pill');
const elStatusText = document.getElementById('status-text');
const elReconnectBanner = document.getElementById('reconnect-banner');
const elReconnectMsg = document.getElementById('reconnect-message');

// HUD Stats Elements
const elValLat = document.getElementById('val-lat');
const elValLon = document.getElementById('val-lon');
const elValAlt = document.getElementById('val-alt');
const elValAltMiles = document.getElementById('val-alt-miles');
const elValSpeed = document.getElementById('val-speed');
const elValSpeedMph = document.getElementById('val-speed-mph');
const elValVisibility = document.getElementById('val-visibility');
const elValFootprint = document.getElementById('val-footprint');
const elValTrailCount = document.getElementById('val-trail-count');
const elValTimestamp = document.getElementById('val-timestamp');

// Mobile Mini-Summary Elements
const elMiniValLat = document.getElementById('mini-val-lat');
const elMiniValLon = document.getElementById('mini-val-lon');
const elMiniValSpeed = document.getElementById('mini-val-speed');

// Timer & Navigation Controls
const elCountdownSec = document.getElementById('countdown-sec');
const elCircleProgress = document.querySelector('.progress-ring__circle');
const btnFollow = document.getElementById('btn-follow');
const btnRecenter = document.getElementById('btn-recenter');
const btnClearTrail = document.getElementById('btn-clear-trail');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeLabel = document.getElementById('theme-label');
const btnProjectionModal = document.getElementById('btn-projection-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const projectionModal = document.getElementById('projection-modal');

// Mobile Collapsible Drawer Elements
const telemetryCard = document.getElementById('telemetry-card');
const cardHeader = document.getElementById('card-header');
const btnToggleHud = document.getElementById('btn-toggle-hud');

// Projection Explainer Live Canvas Elements
const elCalcLat = document.getElementById('calc-lat');
const elCalcLon = document.getElementById('calc-lon');
const elCalcX = document.getElementById('calc-x');
const elCalcY = document.getElementById('calc-y');
const canvasFlat = document.getElementById('flatWorldCanvas');
const ctxFlat = canvasFlat ? canvasFlat.getContext('2d') : null;


// ----------------------------------------------------------------------------
// 2. LEAFLET MAP INITIALIZATION & PROJECTION EXPLANATION
// ----------------------------------------------------------------------------
/**
 * HOW LATITUDE AND LONGITUDE BECOME A SCREEN/MAP POSITION:
 *
 * 1. Spherical Geographic Coordinates (EPSG:4326):
 *    The satellite API returns degrees: Latitude [-90° to +90°] and Longitude [-180° to +180°].
 *
 * 2. Web Mercator Projection (EPSG:3857):
 *    Leaflet and OpenStreetMap convert spherical coordinates onto a 2D plane:
 *    - Longitude maps linearly:
 *        x_pixel = (lon + 180) / 360 * 256 * 2^zoom
 *    - Latitude is conformal (preserves local shapes and right angles), projected via:
 *        y_pixel = (1 - ln(tan(lat_rad) + sec(lat_rad)) / π) / 2 * 256 * 2^zoom
 *
 * 3. Screen Viewport Rendering:
 *    Leaflet subtracts the current map center's pixel coordinate from the ISS's projected
 *    coordinate and positions the HTML marker element via CSS `transform: translate3d(x px, y px, 0)`.
 */
const map = L.map('map', {
  center: [0, 0],
  zoom: 3,
  minZoom: 2,
  maxZoom: 10,
  worldCopyJump: true,
  zoomControl: true,
  preferCanvas: true // Use HTML5 Canvas for vector rendering (faster on mobile)
});

// OpenStreetMap Tile Layer (with performance caching buffer)
const osmTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  keepBuffer: 3,
  updateWhenIdle: true,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
}).addTo(map);

// Set default dark mode theme on body for sleek aerospace aesthetic
document.body.classList.add('dark-mode');

// High-performance custom SVG ISS Marker with animated radar pulse rings
const issIcon = L.divIcon({
  className: 'iss-custom-marker',
  html: `
    <div class="iss-marker-container">
      <div class="iss-radar-ring"></div>
      <div class="iss-radar-ring ring-delayed"></div>
      <svg class="iss-icon-core" width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- Solar Panels Left -->
        <rect x="2" y="16" width="12" height="16" rx="2" fill="#00f0ff" fill-opacity="0.9" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="8" y1="16" x2="8" y2="32" stroke="#00384d" stroke-width="1.2"/>
        <line x1="2" y1="24" x2="14" y2="24" stroke="#00384d" stroke-width="1.2"/>
        <!-- Solar Panels Right -->
        <rect x="34" y="16" width="12" height="16" rx="2" fill="#00f0ff" fill-opacity="0.9" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="40" y1="16" x2="40" y2="32" stroke="#00384d" stroke-width="1.2"/>
        <line x1="34" y1="24" x2="46" y2="24" stroke="#00384d" stroke-width="1.2"/>
        <!-- Main Truss Structure -->
        <line x1="14" y1="24" x2="34" y2="24" stroke="#ffffff" stroke-width="2.5"/>
        <!-- Central Module Core -->
        <rect x="20" y="18" width="8" height="12" rx="3" fill="#ffffff" stroke="#00f0ff" stroke-width="1.5"/>
        <circle cx="24" cy="24" r="2" fill="#070b14"/>
      </svg>
    </div>
  `,
  iconSize: [52, 52],
  iconAnchor: [26, 26]
});

// Marker instance
const marker = L.marker([0, 0], { icon: issIcon }).addTo(map);

// Polyline Group for 50-point trajectory trail
const trailGroup = L.featureGroup().addTo(map);


// ----------------------------------------------------------------------------
// 3. FETCH TELEMETRY & RESILIENT ERROR HANDLING
// ----------------------------------------------------------------------------
/**
 * THE FETCH REQUEST:
 * Sends an asynchronous HTTP GET request to the Where The ISS At REST API.
 * Uses an AbortController with a 4.2s timeout to avoid hanging on slow mobile connections.
 * If errors occur, displays a reconnecting notice without crashing or resetting the map.
 */
async function fetchIssPosition() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4200);

  try {
    const response = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} (${response.statusText})`);
    }

    const data = await response.json();
    handleSuccessTelemetry(data);
  } catch (error) {
    clearTimeout(timeoutId);
    handleFetchError(error);
  }
}

/**
 * Handles successful telemetry response:
 * Updates coordinates, smoothly moves marker, advances 50-point trail, and refreshes UI.
 */
function handleSuccessTelemetry(data) {
  const { latitude, longitude, altitude, velocity, visibility, footprint, timestamp } = data;

  // Restore active status badge if recovering from connection drop
  if (isReconnecting) {
    isReconnecting = false;
    elStatusPill.className = 'status-pill online';
    elStatusText.textContent = 'LIVE • 5s';
    elReconnectBanner.classList.add('hidden');
  }

  previousPos = currentPos;
  currentPos = {
    lat: Number(latitude),
    lon: Number(longitude),
    alt: Number(altitude),
    speed: Number(velocity),
    visibility: visibility || 'unknown',
    footprint: Number(footprint),
    timestamp: Number(timestamp)
  };

  // Update Telemetry Displays
  updateTelemetryCard(currentPos);

  // Smoothly interpolate marker movement
  if (previousPos) {
    smoothMoveMarker(previousPos, currentPos, 1200);
  } else {
    marker.setLatLng([currentPos.lat, currentPos.lon]);
  }

  // Record point into orbital trail (capped at 50)
  appendTrailCoordinate(currentPos.lat, currentPos.lon);

  // Auto-center map if enabled
  if (autoCenterEnabled) {
    if (isFirstLoad) {
      map.setView([currentPos.lat, currentPos.lon], 4, { animate: true });
      isFirstLoad = false;
    } else {
      map.panTo([currentPos.lat, currentPos.lon], { animate: true, duration: 1.0 });
    }
  }

  // Update Live Projection Canvas
  updateFlatWorldExplainer(currentPos.lat, currentPos.lon);

  // Reset 5s countdown display
  resetCountdown();
}

/**
 * Resilient Error Handler:
 * Prevents application crash during connection drops and signals reconnecting state.
 */
function handleFetchError(error) {
  console.warn('Telemetry feed interrupted:', error.message);
  isReconnecting = true;

  elStatusPill.className = 'status-pill reconnecting';
  elStatusText.textContent = 'RECONNECTING...';
  elReconnectMsg.textContent = `Telemetry connection issue (${error.message}). Retrying in 5 seconds...`;
  elReconnectBanner.classList.remove('hidden');

  resetCountdown();
}


// ----------------------------------------------------------------------------
// 4. SMOOTH MARKER ANIMATION & TRAIL MANAGEMENT
// ----------------------------------------------------------------------------
/**
 * Smoothly interpolates the Leaflet marker position from previous to latest
 * coordinates using a cubic-bezier ease-out curve via requestAnimationFrame.
 */
function smoothMoveMarker(start, end, durationMs = 1200) {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  // Skip animation when tab is in background to save mobile battery
  if (document.hidden) {
    marker.setLatLng([end.lat, end.lon]);
    return;
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1.0);

    // Ease-out cubic curve: fast start with natural deceleration
    const ease = 1 - Math.pow(1 - progress, 3);

    const currentLat = start.lat + (end.lat - start.lat) * ease;

    // Handle antimeridian wrapping (-180° / +180°)
    let lonDiff = end.lon - start.lon;
    if (lonDiff > 180) lonDiff -= 360;
    if (lonDiff < -180) lonDiff += 360;
    const currentLon = start.lon + lonDiff * ease;

    marker.setLatLng([currentLat, currentLon]);

    if (progress < 1.0) {
      animationFrameId = requestAnimationFrame(step);
    } else {
      marker.setLatLng([end.lat, end.lon]);
      animationFrameId = null;
    }
  }

  animationFrameId = requestAnimationFrame(step);
}

/**
 * Appends the newest coordinate to the trail array, maintaining exactly up to 50 points.
 */
function appendTrailCoordinate(lat, lon) {
  trailCoordinates.push([lat, lon]);

  // Keep strictly the last 50 recorded positions
  if (trailCoordinates.length > MAX_TRAIL_POINTS) {
    trailCoordinates.shift();
  }

  elValTrailCount.textContent = `${trailCoordinates.length} / ${MAX_TRAIL_POINTS} points`;
  redrawTrail();
}

/**
 * Redraws the glowing polyline trail, splitting across the antimeridian seam if needed.
 */
function redrawTrail() {
  trailGroup.clearLayers();

  if (trailCoordinates.length < 2) return;

  const segments = [];
  let currentSegment = [trailCoordinates[0]];

  for (let i = 1; i < trailCoordinates.length; i++) {
    const prevLon = trailCoordinates[i - 1][1];
    const currLon = trailCoordinates[i][1];

    // Detect antimeridian crossing (+179° to -179°)
    if (Math.abs(currLon - prevLon) > 180) {
      segments.push(currentSegment);
      currentSegment = [trailCoordinates[i]];
    } else {
      currentSegment.push(trailCoordinates[i]);
    }
  }
  segments.push(currentSegment);

  segments.forEach(segmentCoords => {
    if (segmentCoords.length > 1) {
      L.polyline(segmentCoords, {
        color: '#00f0ff',
        weight: 3.5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'iss-orbit-trail',
        dashArray: '2, 6'
      }).addTo(trailGroup);
    }
  });
}


// ----------------------------------------------------------------------------
// 5. TELEMETRY DISPLAY & FORMATTING
// ----------------------------------------------------------------------------
function updateTelemetryCard(data) {
  const latDir = data.lat >= 0 ? 'N' : 'S';
  const lonDir = data.lon >= 0 ? 'E' : 'W';
  const latFormatted = `${Math.abs(data.lat).toFixed(4)}° ${latDir}`;
  const lonFormatted = `${Math.abs(data.lon).toFixed(4)}° ${lonDir}`;

  // Main Card
  elValLat.textContent = latFormatted;
  elValLon.textContent = lonFormatted;

  const altKm = Math.round(data.alt);
  const altMiles = Math.round(data.alt * 0.621371);
  elValAlt.textContent = altKm.toLocaleString();
  elValAltMiles.textContent = `${altMiles.toLocaleString()} miles`;

  const speedKmh = Math.round(data.speed);
  const speedMph = Math.round(data.speed * 0.621371);
  const speedKms = (data.speed / 3600).toFixed(2);
  elValSpeed.textContent = speedKmh.toLocaleString();
  elValSpeedMph.textContent = `${speedMph.toLocaleString()} mph • ~${speedKms} km/s`;

  const isDaylight = data.visibility.toLowerCase() === 'daylight';
  elValVisibility.textContent = isDaylight ? '☀️ Daylight' : '🌑 In Shadow';
  elValVisibility.className = `detail-badge ${isDaylight ? '' : 'eclipsed'}`;

  elValFootprint.textContent = `${Math.round(data.footprint).toLocaleString()} km`;

  const date = new Date(data.timestamp * 1000);
  elValTimestamp.textContent = date.toUTCString().slice(17, 25) + ' UTC';

  // Mobile Mini Summary
  if (elMiniValLat && elMiniValLon && elMiniValSpeed) {
    elMiniValLat.textContent = `${Math.abs(data.lat).toFixed(2)}° ${latDir}`;
    elMiniValLon.textContent = `${Math.abs(data.lon).toFixed(2)}° ${lonDir}`;
    elMiniValSpeed.textContent = `${speedKmh.toLocaleString()} km/h`;
  }
}


// ----------------------------------------------------------------------------
// 6. POLLING & COUNTDOWN SCHEDULER
// ----------------------------------------------------------------------------
/**
 * THE POLLING MECHANISM:
 * We schedule automatic fetches every 5,000ms using JavaScript's `setInterval`.
 * An accompanying 1-second timer smoothly ticks down the SVG circular progress ring.
 */
function startPolling() {
  fetchIssPosition();

  // Primary 5-second polling loop
  pollIntervalTimer = setInterval(fetchIssPosition, POLL_INTERVAL_MS);

  // 1-second countdown UI updates
  countdownIntervalTimer = setInterval(() => {
    countdownRemaining--;
    if (countdownRemaining <= 0) {
      countdownRemaining = 5;
    }
    elCountdownSec.textContent = `${countdownRemaining}s`;

    // SVG Ring progress
    const circumference = 2 * Math.PI * 11; // ~69.1
    const offset = circumference - (countdownRemaining / 5) * circumference;
    if (elCircleProgress) {
      elCircleProgress.style.strokeDashoffset = offset;
    }
  }, 1000);
}

function resetCountdown() {
  countdownRemaining = 5;
  elCountdownSec.textContent = '5s';
  if (elCircleProgress) {
    elCircleProgress.style.strokeDashoffset = '0';
  }
}

// Battery & Mobile Data optimization: Throttle when tab is inactive
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    // When returning to tab, immediately fetch latest position
    fetchIssPosition();
  }
});


// ----------------------------------------------------------------------------
// 7. FLAT WORLD PROJECTION CALCULATION & DEMONSTRATION
// ----------------------------------------------------------------------------
/**
 * Calculates screen (x, y) coordinates on a 2D flat plane:
 * Formula:
 *   x = ((lon + 180) / 360) * width
 *   y = ((90 - lat) / 180) * height
 */
function updateFlatWorldExplainer(lat, lon) {
  if (!canvasFlat || !ctxFlat) return;

  const width = canvasFlat.width;   // 360 px
  const height = canvasFlat.height; // 180 px

  const screenX = ((lon + 180) / 360) * width;
  const screenY = ((90 - lat) / 180) * height;

  if (elCalcLat) elCalcLat.textContent = `${lat.toFixed(2)}°`;
  if (elCalcLon) elCalcLon.textContent = `${lon.toFixed(2)}°`;
  if (elCalcX) elCalcX.textContent = `${screenX.toFixed(1)} px (X)`;
  if (elCalcY) elCalcY.textContent = `${screenY.toFixed(1)} px (Y)`;

  drawFlatWorld(screenX, screenY);
}

function drawFlatWorld(targetX, targetY) {
  const w = canvasFlat.width;
  const h = canvasFlat.height;

  ctxFlat.fillStyle = '#060a12';
  ctxFlat.fillRect(0, 0, w, h);

  // Lat/Lon grid
  ctxFlat.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctxFlat.lineWidth = 1;

  ctxFlat.beginPath();
  ctxFlat.moveTo(0, h / 2);
  ctxFlat.lineTo(w, h / 2);
  ctxFlat.moveTo(w / 2, 0);
  ctxFlat.lineTo(w / 2, h);
  ctxFlat.stroke();

  for (let x = 60; x < w; x += 60) {
    ctxFlat.beginPath();
    ctxFlat.moveTo(x, 0);
    ctxFlat.lineTo(x, h);
    ctxFlat.stroke();
  }
  for (let y = 45; y < h; y += 45) {
    ctxFlat.beginPath();
    ctxFlat.moveTo(0, y);
    ctxFlat.lineTo(w, y);
    ctxFlat.stroke();
  }

  // Simplified continents
  drawSimplifiedContinents(ctxFlat, w, h);

  // Trajectory on flat canvas
  if (trailCoordinates.length > 1) {
    ctxFlat.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctxFlat.lineWidth = 2;
    ctxFlat.beginPath();
    for (let i = 0; i < trailCoordinates.length; i++) {
      const ptLat = trailCoordinates[i][0];
      const ptLon = trailCoordinates[i][1];
      const px = ((ptLon + 180) / 360) * w;
      const py = ((90 - ptLat) / 180) * h;
      if (i === 0) ctxFlat.moveTo(px, py);
      else ctxFlat.lineTo(px, py);
    }
    ctxFlat.stroke();
  }

  // ISS Position Marker
  ctxFlat.fillStyle = '#ff0055';
  ctxFlat.beginPath();
  ctxFlat.arc(targetX, targetY, 4.5, 0, Math.PI * 2);
  ctxFlat.fill();

  ctxFlat.strokeStyle = '#00f0ff';
  ctxFlat.lineWidth = 1.5;
  ctxFlat.beginPath();
  ctxFlat.arc(targetX, targetY, 7.5, 0, Math.PI * 2);
  ctxFlat.stroke();
}

function drawSimplifiedContinents(ctx, w, h) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(w * 0.12, h * 0.15, w * 0.22, h * 0.3); // N. America
  ctx.fillRect(w * 0.23, h * 0.5, w * 0.12, h * 0.35);  // S. America
  ctx.fillRect(w * 0.45, h * 0.15, w * 0.42, h * 0.32); // Eurasia
  ctx.fillRect(w * 0.46, h * 0.45, w * 0.18, h * 0.38); // Africa
  ctx.fillRect(w * 0.78, h * 0.65, w * 0.12, h * 0.22); // Australia
}


// ----------------------------------------------------------------------------
// 8. EVENT LISTENERS & MOBILE INTERACTION
// ----------------------------------------------------------------------------

// Mobile Collapsible Telemetry Sheet Toggle
function toggleTelemetrySheet() {
  if (!telemetryCard) return;
  telemetryCard.classList.toggle('collapsed');
}

if (cardHeader) {
  cardHeader.addEventListener('click', toggleTelemetrySheet);
}

if (btnToggleHud) {
  btnToggleHud.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTelemetrySheet();
  });
}

// Auto-collapse on small screens upon initial load
if (window.innerWidth <= 768 && telemetryCard) {
  telemetryCard.classList.add('collapsed');
}

// Lock / Follow ISS Button
btnFollow.addEventListener('click', () => {
  autoCenterEnabled = !autoCenterEnabled;
  btnFollow.classList.toggle('active', autoCenterEnabled);
  if (autoCenterEnabled && currentPos) {
    map.panTo([currentPos.lat, currentPos.lon], { animate: true });
  }
});

// Center on ISS Button
btnRecenter.addEventListener('click', () => {
  if (currentPos) {
    map.setView([currentPos.lat, currentPos.lon], 4, { animate: true });
  }
});

// Reset Trail Button
btnClearTrail.addEventListener('click', () => {
  trailCoordinates = [];
  if (currentPos) {
    trailCoordinates.push([currentPos.lat, currentPos.lon]);
  }
  redrawTrail();
  elValTrailCount.textContent = `${trailCoordinates.length} / ${MAX_TRAIL_POINTS} points`;
});

// Map Theme Toggle
btnThemeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark-mode');
  themeLabel.textContent = isDark ? '🌙 Mode' : '☀️ Mode';
});

// Projection Math Modal
btnProjectionModal.addEventListener('click', () => {
  projectionModal.classList.remove('hidden');
  if (currentPos) {
    updateFlatWorldExplainer(currentPos.lat, currentPos.lon);
  }
});

btnCloseModal.addEventListener('click', () => {
  projectionModal.classList.add('hidden');
});

projectionModal.addEventListener('click', (e) => {
  if (e.target === projectionModal) {
    projectionModal.classList.add('hidden');
  }
});

// Keyboard accessibility: Escape to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !projectionModal.classList.contains('hidden')) {
    projectionModal.classList.add('hidden');
  }
});


// ----------------------------------------------------------------------------
// 9. APP INITIALIZATION
// ----------------------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPolling);
} else {
  startPolling();
}
