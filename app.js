/**
 * ============================================================================
 * ISS LIVE TRACKER — APPLICATION LOGIC
 * NORAD Satellite ID: 25544 (International Space Station)
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURATION & STATE
// ----------------------------------------------------------------------------
const API_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const POLL_INTERVAL_MS = 5000; // 5-second refresh interval
const MAX_TRAIL_POINTS = 50;   // Keep the last 50 position coordinates

// State variables
let currentPos = null;          // { lat, lon, alt, speed }
let previousPos = null;         // For smooth interpolation animation
let trailCoordinates = [];      // Array of [lat, lon] coordinates (max 50)
let autoCenterEnabled = true;   // Automatically pan map with the ISS
let isFirstLoad = true;
let isReconnecting = false;
let countdownRemaining = 5;
let animationFrameId = null;

// DOM Elements
const elStatusPill = document.getElementById('status-pill');
const elStatusText = document.getElementById('status-text');
const elReconnectBanner = document.getElementById('reconnect-banner');
const elReconnectMsg = document.getElementById('reconnect-message');
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

// Formula Explainer Live Elements
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
 * HOW LATITUDE AND LONGITUDE BECOME A MAP POSITION:
 *
 * 1. Geographic Coordinate System (EPSG:4326):
 *    The ISS sends coordinates in degrees: Latitude (-90° to +90°) and Longitude (-180° to +180°).
 *
 * 2. Web Mercator Projection (EPSG:3857):
 *    Leaflet and OpenStreetMap project the 3D globe onto a 2D plane using the Web Mercator projection.
 *    - Longitude maps linearly: x = (lon + 180) / 360 * 256 * 2^zoom
 *    - Latitude is projected using a logarithmic tangent formula to preserve local angles and shapes:
 *      y = (1 - ln(tan(lat) + sec(lat)) / π) / 2 * 256 * 2^zoom
 *
 * 3. Screen Pixels:
 *    Leaflet calculates the container pixel position (x, y) relative to the browser viewport and
 *    moves the marker's HTML container using CSS transform: translate3d(x px, y px, 0).
 */
const map = L.map('map', {
  center: [0, 0],
  zoom: 3,
  minZoom: 2,
  maxZoom: 10,
  worldCopyJump: true,
  zoomControl: true
});

// Default OpenStreetMap Tile Layer (as requested: Leaflet with OpenStreetMap tiles)
const osmTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
}).addTo(map);

// Set default dark mode theme class on body for sleek space aesthetic
document.body.classList.add('dark-mode');

// Custom SVG ISS Marker with animated radar pulse rings
const issIcon = L.divIcon({
  className: 'iss-custom-marker',
  html: `
    <div class="iss-marker-container">
      <div class="iss-radar-ring"></div>
      <div class="iss-radar-ring ring-delayed"></div>
      <svg class="iss-icon-core" width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Solar Panels Left -->
        <rect x="2" y="16" width="12" height="16" rx="2" fill="#00f0ff" fill-opacity="0.85" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="8" y1="16" x2="8" y2="32" stroke="#00384d" stroke-width="1.2"/>
        <line x1="2" y1="24" x2="14" y2="24" stroke="#00384d" stroke-width="1.2"/>
        <!-- Solar Panels Right -->
        <rect x="34" y="16" width="12" height="16" rx="2" fill="#00f0ff" fill-opacity="0.85" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="40" y1="16" x2="40" y2="32" stroke="#00384d" stroke-width="1.2"/>
        <line x1="34" y1="24" x2="46" y2="24" stroke="#00384d" stroke-width="1.2"/>
        <!-- Truss Structure -->
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

// Polyline Trail (up to 50 positions)
// Using multi-polyline segments to gracefully handle anti-meridian meridian wrapping (-180° / +180°)
let trailLayers = [];
const trailGroup = L.featureGroup().addTo(map);


// ----------------------------------------------------------------------------
// 3. FETCH TELEMETRY & ERROR HANDLING
// ----------------------------------------------------------------------------
/**
 * THE FETCH REQUEST:
 * Sends an asynchronous HTTP GET request to the Where The ISS At REST API.
 * Uses an AbortController with a 4-second timeout to detect hanging networks.
 * If network issues occur, catches the error cleanly, shows a reconnecting banner,
 * and maintains the existing map state without crashing.
 */
async function fetchIssPosition() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4200);

  try {
    const response = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    handleSuccessTelemetry(data);
  } catch (error) {
    clearTimeout(timeoutId);
    handleFetchError(error);
  }
}

/**
 * Successful response handler:
 * Extracts coordinates, updates telemetry card, advances trail, and smoothly animates marker.
 */
function handleSuccessTelemetry(data) {
  const { latitude, longitude, altitude, velocity, visibility, footprint, timestamp } = data;

  // Restore online status indicator if previously reconnecting
  if (isReconnecting) {
    isReconnecting = false;
    elStatusPill.className = 'status-pill online';
    elStatusText.textContent = 'LIVE • 5s POLLING';
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

  // Update Telemetry Display
  updateTelemetryCard(currentPos);

  // Smoothly move the marker on the map
  if (previousPos) {
    smoothMoveMarker(previousPos, currentPos, 1200);
  } else {
    marker.setLatLng([currentPos.lat, currentPos.lon]);
  }

  // Update Trajectory Trail (max 50 points)
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

  // Update Flat World Live Formula calculation
  updateFlatWorldExplainer(currentPos.lat, currentPos.lon);

  // Reset 5s countdown
  resetCountdown();
}

/**
 * Graceful error handling:
 * Displays non-intrusive reconnecting banner and visual badge without crashing.
 */
function handleFetchError(error) {
  console.warn('ISS Telemetry fetch encountered an issue:', error.message);
  isReconnecting = true;

  elStatusPill.className = 'status-pill reconnecting';
  elStatusText.textContent = 'RECONNECTING...';
  elReconnectMsg.textContent = `Connecting to telemetry feed (${error.message}). Retrying in 5 seconds...`;
  elReconnectBanner.classList.remove('hidden');

  // Reset countdown for retry
  resetCountdown();
}


// ----------------------------------------------------------------------------
// 4. SMOOTH MARKER ANIMATION & TRAIL MANAGEMENT
// ----------------------------------------------------------------------------
/**
 * Smoothly interpolates the Leaflet marker position from start to destination
 * using linear interpolation (LERP) across requestAnimationFrame.
 */
function smoothMoveMarker(start, end, durationMs = 1000) {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1.0);

    // Ease-out cubic curve for natural deceleration
    const ease = 1 - Math.pow(1 - progress, 3);

    const currentLat = start.lat + (end.lat - start.lat) * ease;

    // Handle anti-meridian crossing for longitude
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
 * Appends a coordinate to the historical trail, capping it at 50 points.
 * Handles anti-meridian splitting so lines don't streak across the globe.
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
 * Rebuilds the polyline segments on the map, breaking paths if longitude jumps > 180°
 */
function redrawTrail() {
  trailGroup.clearLayers();

  if (trailCoordinates.length < 2) return;

  const segments = [];
  let currentSegment = [trailCoordinates[0]];

  for (let i = 1; i < trailCoordinates.length; i++) {
    const prevLon = trailCoordinates[i - 1][1];
    const currLon = trailCoordinates[i][1];

    // Check for anti-meridian jump (e.g. +179° to -179°)
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
  // Latitude formatting
  const latDir = data.lat >= 0 ? 'N' : 'S';
  elValLat.textContent = `${Math.abs(data.lat).toFixed(4)}° ${latDir}`;

  // Longitude formatting
  const lonDir = data.lon >= 0 ? 'E' : 'W';
  elValLon.textContent = `${Math.abs(data.lon).toFixed(4)}° ${lonDir}`;

  // Altitude (km & miles)
  const altKm = Math.round(data.alt);
  const altMiles = Math.round(data.alt * 0.621371);
  elValAlt.textContent = altKm.toLocaleString();
  elValAltMiles.textContent = `${altMiles.toLocaleString()} miles`;

  // Speed / Velocity (km/h & mph)
  const speedKmh = Math.round(data.speed);
  const speedMph = Math.round(data.speed * 0.621371);
  const speedKms = (data.speed / 3600).toFixed(2);
  elValSpeed.textContent = speedKmh.toLocaleString();
  elValSpeedMph.textContent = `${speedMph.toLocaleString()} mph • ~${speedKms} km/s`;

  // Visibility status
  const isDaylight = data.visibility.toLowerCase() === 'daylight';
  elValVisibility.textContent = isDaylight ? '☀️ Daylight' : '🌑 In Shadow';
  elValVisibility.className = `detail-badge ${isDaylight ? '' : 'eclipsed'}`;

  // Footprint
  elValFootprint.textContent = `${Math.round(data.footprint).toLocaleString()} km`;

  // Timestamp
  const date = new Date(data.timestamp * 1000);
  elValTimestamp.textContent = date.toUTCString().slice(17, 25) + ' UTC';
}


// ----------------------------------------------------------------------------
// 6. POLLING MECHANISM & COUNTDOWN
// ----------------------------------------------------------------------------
/**
 * THE POLLING MECHANISM:
 * We use JavaScript's `setInterval(fetchIssPosition, 5000)` to trigger a network
 * request every 5,000 milliseconds (5 seconds).
 *
 * A secondary 1-second interval manages the smooth circular countdown badge in the UI.
 */
function startPolling() {
  // Immediate initial fetch
  fetchIssPosition();

  // Primary 5-second polling interval
  setInterval(fetchIssPosition, POLL_INTERVAL_MS);

  // UI countdown timer tick every second
  setInterval(() => {
    countdownRemaining--;
    if (countdownRemaining <= 0) {
      countdownRemaining = 5;
    }
    elCountdownSec.textContent = `${countdownRemaining}s`;

    // Update circular SVG progress indicator
    const circumference = 2 * Math.PI * 12; // ~75.4
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


// ----------------------------------------------------------------------------
// 7. FLAT WORLD PROJECTION CALCULATION & DEMONSTRATION
// ----------------------------------------------------------------------------
/**
 * Calculates screen (x, y) coordinates on a flat equirectangular 2D plane:
 * Formula:
 *   x = ((lon + 180) / 360) * width
 *   y = ((90 - lat) / 180) * height
 */
function updateFlatWorldExplainer(lat, lon) {
  if (!canvasFlat || !ctxFlat) return;

  const width = canvasFlat.width;   // 360 px
  const height = canvasFlat.height; // 180 px

  // Exact math requested:
  const screenX = ((lon + 180) / 360) * width;
  const screenY = ((90 - lat) / 180) * height;

  // Update formula values in modal UI
  if (elCalcLat) elCalcLat.textContent = `${lat.toFixed(2)}°`;
  if (elCalcLon) elCalcLon.textContent = `${lon.toFixed(2)}°`;
  if (elCalcX) elCalcX.textContent = `${screenX.toFixed(1)} px (X-offset)`;
  if (elCalcY) elCalcY.textContent = `${screenY.toFixed(1)} px (Y-offset)`;

  // Render on flat preview canvas
  drawFlatWorld(screenX, screenY);
}

function drawFlatWorld(targetX, targetY) {
  const w = canvasFlat.width;
  const h = canvasFlat.height;

  // Clear canvas
  ctxFlat.fillStyle = '#060a12';
  ctxFlat.fillRect(0, 0, w, h);

  // Draw latitude / longitude grid lines
  ctxFlat.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctxFlat.lineWidth = 1;

  // Equator & Prime Meridian
  ctxFlat.beginPath();
  ctxFlat.moveTo(0, h / 2);
  ctxFlat.lineTo(w, h / 2);
  ctxFlat.moveTo(w / 2, 0);
  ctxFlat.lineTo(w / 2, h);
  ctxFlat.stroke();

  // Grid parallels & meridians
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

  // Draw subtle continent outlines
  drawSimplifiedContinents(ctxFlat, w, h);

  // Draw Trail on Flat Canvas
  if (trailCoordinates.length > 1) {
    ctxFlat.strokeStyle = 'rgba(0, 240, 255, 0.5)';
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

  // Draw ISS Marker on Flat World
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

/**
 * Draws minimal continent approximations for visual reference on flat canvas
 */
function drawSimplifiedContinents(ctx, w, h) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  // North America
  ctx.fillRect(w * 0.12, h * 0.15, w * 0.22, h * 0.3);
  // South America
  ctx.fillRect(w * 0.23, h * 0.5, w * 0.12, h * 0.35);
  // Eurasia & Africa
  ctx.fillRect(w * 0.45, h * 0.15, w * 0.42, h * 0.32);
  ctx.fillRect(w * 0.46, h * 0.45, w * 0.18, h * 0.38);
  // Australia
  ctx.fillRect(w * 0.78, h * 0.65, w * 0.12, h * 0.22);
}


// ----------------------------------------------------------------------------
// 8. EVENT LISTENERS & USER CONTROLS
// ----------------------------------------------------------------------------

// Toggle "Follow ISS" Auto-centering
btnFollow.addEventListener('click', () => {
  autoCenterEnabled = !autoCenterEnabled;
  btnFollow.classList.toggle('active', autoCenterEnabled);
  if (autoCenterEnabled && currentPos) {
    map.panTo([currentPos.lat, currentPos.lon], { animate: true });
  }
});

// Center View Button
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

// Map theme toggle (Dark Tactical Mode vs Standard OSM)
btnThemeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark-mode');
  themeLabel.textContent = isDark ? '🌙 Dark Mode' : '☀️ Standard OSM';
});

// Open & Close Projection Math Modal
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

// ----------------------------------------------------------------------------
// 9. APP INITIALIZATION
// ----------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  startPolling();
});
