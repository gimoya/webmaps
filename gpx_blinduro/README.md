# GPX Blinduro

Web app: upload GPX, get segment times between start/end checkpoints. Preloaded tracks and segments are loaded from GeoJSON. Leaderboards via Firebase Firestore.

## Quick start

1. Add GeoJSON files in `data/`:
   - `segments.geojson` – FeatureCollection of Point features with `properties.segmentName` and `properties.pointType` (`start` or `end`)
   - `tracks.geojson` – FeatureCollection of LineString/MultiLineString features for reference display (optional `properties.name` per track)
2. Serve via `python -m http.server` or `npx serve` (fetch needs HTTP).
3. Upload a GPX file – it is displayed on the map and matched against checkpoints; segment times shown.

## Files

- `index.html` – upload UI, results, map
- `app.js` – GPX parsing, snapping, pairing, segment logic
- `styles.css` – layout
- `data/segments.geojson` – start/end points per segment (WGS84)
- `data/tracks.geojson` – reference tracks

## Map features

- MapTiler Topo basemap (darkened via CSS filter)
- Locate control (GPS) with panel offset
- Fullscreen toggle (F11-style)
- Preloaded tracks: click for name tooltip, track nav arrows
- Merged track bounds outline

## Leaderboard (Firebase)

Configure Firebase in `index.html` (firebaseConfig). Leaderboards are stored in Firestore. See `firestore.rules` for security rules.

## Deploy (GitHub Pages)

1. Push to GitHub.
2. Settings → Pages → Source: master (or main), / (root).
3. Custom domain: add CNAME if needed.

## GPX requirements

- GPX 1.0 or 1.1 with proper `xmlns` on root.
- Tracks (`trk`/`trkseg`/`trkpt`) or routes (`rte`/`rtept`).
- Optional `<time>` per point (duration empty if missing).
