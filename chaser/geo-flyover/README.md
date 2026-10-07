# GeoFlyover

Standalone **Mapbox GL JS + terrain** path flyover. Camera follows a track (bearing + pitch) at real **km/h** ground speed (slider 0–500). No Leaflet / Firebase deps.

## Peer

Load Mapbox GL v2 before this script (same stack as Legacy Trails 3D):

```html
<link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
<link rel="stylesheet" href="geo-flyover.css">
<script src="geo-flyover.js"></script>
```

## Usage

### Modal (fullscreen)

```js
const session = await GeoFlyover.open(track, {
  accessToken: "pk.…", // or set mapboxgl.accessToken first
  speedKmh: 100,
  pitch: 68,
  zoom: 14.5
});

session.setSpeedKmh(250);
session.pause();
session.resume();
session.stop(); // tears down map + overlay
```

Toolbar:
- **Speed** / **Height** sliders labeled **min … max**
- **⟨⟨ / ⟩⟩** skip by `trackLength / skipSteps` (forward clicks → end; nearer than one step → start/end)
- **Rear / Front** — flip camera bearing 180° along the path (look back / look ahead)
- Bearing: path heading snapped to `bearingStepDeg`, camera eases at up to `bearingTurnDegPerSec`

### Embed

```js
const session = await GeoFlyover.mount(document.getElementById("fly"), track, {
  accessToken: "pk.…"
});
```

Use the same Mapbox token as Legacy Trails `TerrainMap3D` when embedding there.

## Track input

Any of:

| Form | Notes |
|------|--------|
| `[[lon,lat], …]` or `[[lon,lat,ele], …]` | ≥ 2 points |
| GeoJSON `LineString` | |
| GeoJSON `Feature` (LineString) | |
| GeoJSON `FeatureCollection` | first LineString |
| GPX 1.1 string | first `trk` / `rte`; `<ele>` optional |
| JSON string of the above | |

Helper: `GeoFlyover.parseTrack(track)` → coords or `null`.

## Options (`GeoFlyover.DEFAULTS`)

| Key | Default | |
|-----|---------|---|
| `speedKmh` | `100` | ground speed along path (0–1000; UI shows 0–Max) |
| `pitch` | `55` | camera pitch (tilt; 0 = top-down) |
| `zoom` | `14.5` | also via height slider (zoom 17 close → 11 high) |
| `bearingStepDeg` | `90` | quantize *target* heading (less fidget) |
| `bearingTurnDegPerSec` | `20` | max camera turn rate toward that target |
| `skipSteps` | `10` | skip distance = path length / this |
| `lookAheadM` | `80` | meters ahead for bearing |
| `style` | `mapbox://styles/mapbox/satellite-streets-v12` | |
| `exaggeration` | `1.25` | DEM scale (matches Legacy Trails 3D) |
| `accessToken` | — | required unless `mapboxgl.accessToken` set |
| `lineColor` / `lineColorDim` / `headColor` | cyan / white / yellow | |

## Behaviour

1. Path length via haversine; each frame advances `speedKmh / 3.6` × Δt meters (real ground speed).
2. Speed / height sliders update live (`setSpeedKmh` / `setZoom`).
3. Bearing from path look-ahead, snapped to `bearingStepDeg` (default 10°).
4. Each frame: `jumpTo({ center, bearing, pitch, zoom })` (no `easeTo`).
5. Dim full line + bright progress line + head point.
6. Terrain: `mapbox.terrain-rgb` + sky atmosphere.

## Host apps

Wire a button that passes loaded GPX / selected trail GeoJSON into `GeoFlyover.open`. This package does not hook Legacy Trails or Chaser by itself.
