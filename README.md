# 🛰️ ISS Live Tracker

A modern real-time International Space Station (ISS) tracker built with vanilla HTML5, CSS3, and JavaScript.

![ISS Live Tracker](https://img.shields.io/badge/Status-Live%20Tracking-00f0ff?style=for-the-badge)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![OpenStreetMap](https://img.shields.io/badge/Map-OpenStreetMap-7EBC6F?style=for-the-badge&logo=openstreetmap&logoColor=white)

---

## ✨ Features

- **Live Telemetry:** Polls `https://api.wheretheiss.at/v1/satellites/25544` every 5 seconds.
- **Interactive Leaflet Map:** Displays the ISS marker over OpenStreetMap tiles with custom aerospace SVG styling and pulsing radar beacons.
- **Orbital Trail:** Draws the path of the last 50 recorded positions with antimeridian seam wrapping.
- **Smooth Marker Interpolation:** Marker moves smoothly across the screen using custom cubic-bezier easing.
- **Telemetry HUD Card:** Displays Latitude, Longitude, Altitude (km/mi), Ground Speed (km/h & mph), Footprint, and Solar Visibility.
- **Resilient Error Handling:** Gracefully handles network blurs and displays a reconnecting message without interrupting the UI.
- **Projection Math Explainer:** Interactive modal explaining 3D spherical coordinate conversion into 2D screen positions (Equirectangular formula vs Web Mercator).

---

## 🚀 Getting Started

Simply open `index.html` in any modern web browser or serve via a local HTTP server:

```bash
# Python
python -m http.server 5500

# Node
npx serve .
```

Then visit [http://localhost:5500](http://localhost:5500).

---

## 📂 File Architecture

Strictly organized into 3 core files:
- `index.html`: Scaffolding, HUD card, and projection math modal.
- `style.css`: Mission-control dark glassmorphic styling, pulse animations, and responsiveness.
- `app.js`: Telemetry fetch loop, Leaflet marker animation, trail tracking, and projection calculation.

---

## 📜 License
MIT License
