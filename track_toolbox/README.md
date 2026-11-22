# track toolbox — developer notes

Browser GPX/KML editor. Static files, no build, no test runner. Open `index.html` from a local server (FIT import and BRouter need network). User help is `docs.html`. Product copy is `PITCH.md` and `STRATEGY.md`.

Version string: `TRACKTOOLBOX_VERSION` in `javascript/tracktoolbox_app.js`, shown in the map attribution.

## Run

Serve this directory over HTTP. `file://` breaks the FIT dynamic import and some tile requests.

Scripts in `index.html` are plain `<script>` tags, in this order: Leaflet, easybutton, Mapbox GL, JSZip, toGeoJSON, `leaflet.togpx.js`, `leaflet.textpath.js`, `brouter_client.js`, `leaflet_route_snap.js`, then `terrain_map_3d.js` and `tracktoolbox_app.js` at the end of `<body>`. The app starts itself. Nothing is exported except `window.LegacyTerrain3D` and `window.tracktoolboxExitTerrain3D`.

`leaflet.tokml.js` is still in the tree and is not loaded. KML export is written in the app.

## Repository

| Path | Role |
|---|---|
| `index.html` | Shell, panels, script order |
| `docs.html` | User manual |
| `css/tracktoolbox.css` | Panel, list, edit toolbox, portrait layout |
| `css/leaflet_map.css` | Shared legacy chrome (toasts, panels) |
| `css/leaflet_route_snap.css` | Digitize control |
| `javascript/tracktoolbox_app.js` | The app. One IIFE, about 3600 lines |
| `javascript/brouter_client.js` | `BRouterClient.route` |
| `javascript/leaflet_route_snap.js` | `L.Control.RouteSnap` digitize UI |
| `javascript/terrain_map_3d.js` | Mapbox terrain overlay |
| `javascript/leaflet.togpx.js` | GeoJSON → GPX, including `<time>` |
| `javascript/leaflet.textpath.js` | Direction arrows along a polyline |
| `seo/` | Static landing pages, not part of the editor |

## Architecture

One page, one map, one in-memory list. No router, no backend of our own, no persistence.

```
index.html
  Leaflet map (#map)
  panel (#tracktoolbox-panel)  — list, name, description, download, merge
  edit toolbox                 — shown instead of the panel while editing
  tracktoolbox_app.js          — state, import, draw, edit, export
       │
       ├─ brouter_client.js ◄── leaflet_route_snap.js  (routesnap:save)
       └─ terrain_map_3d.js     (setTracks / show / hide)
```

Boot, inside the IIFE:

1. Create the Leaflet map, panes, basemap, locate, 3D toggle, point tool, route-snap control.
2. Bind the panel.
3. `showWelcomePanel()`.

The hub after any selection or geometry change is `syncSelectionUi`: prune dead ids, refresh the list, name/description of the last selected feature, `redrawMapLayers`, `updateButtons`. Geometry changes also call `syncTracksTo3D`.

Mutually exclusive modes: edit, digitize (`digitizePickBlocked`), add-point, 3D. Starting one exits or refuses the others. Upload and merge refuse while edit or digitize is active.

### Panes

Bottom to top: `tracktoolboxTrackPane` (400), `tracktoolboxEditHitPane` (450), `tracktoolboxEditNodePane` (650), `digitizeRoutePane` (655), `digitizePane` (670). Route geometry sits under waypoint markers so a leg cannot steal a drag.

### Layout

Landscape: panel pinned top left, `width: min(320px, 100vw - 24px)`. Portrait: the same panel pinned top center, `max-height: min(36dvh, …)`. `#tracktoolbox-panel-toggle` adds `is-collapsed` and hides `#tracktoolbox-panel-body`; the title and info button stay. Merge, name, and description sit at the bottom of the panel, so on a phone they are behind the panel scroll. Shift+drag box-select is a mouse path. Touch selection is tap-toggle. Hit targets for lines are `SELECT_HIT_WEIGHT` (28 px).

## State

| Variable | Meaning |
|---|---|
| `tracks` | All loaded features, upload order |
| `selectedIds` | Selection in click order. Last id is the name/description target and the merge tail |
| `_trackFilterIds` | `null` = show all. Otherwise a set of ids that pass the search box. Hidden tracks stay selected |
| `editMode`, `editWorking` | `editWorking` is a deep clone of the feature being edited |
| `editTracksSnapshot` | `tracks` before chord-simplify. Esc restores this, so the dense original comes back |
| `editUndoStack` / `editRedoStack` | Up to `EDIT_UNDO_MAX` (50) clones of `tracks` + `editWorking` |
| `editSessionIds` | Features created inside this edit (a scissor adds the two pieces) |

`selectedTracks()` walks `selectedIds`, not the list on screen. Merge and export therefore include a track that the filter has hidden.

There is no undo outside an edit session. Merge, remove, and clear are immediate.

## Track model

`makeTrack(name, description, geometry, sourceFile, times)`:

```
{
  id: 't' + n,
  name, description, sourceFile,
  geometry: GeoJSON Point | LineString,   // [lon, lat] or [lon, lat, ele]
  times?: string[]                         // UTC ISO-8601, parallel to vertices
}
```

A `Point` has one time. A `LineString` has one time per coordinate. `null` means that vertex has no timestamp. `packTimes` drops the array when every slot is null.

Import splits multi-part geometry into separate features: each GPX `<trkseg>` is its own LineString (same name), and each KML line part is its own LineString. The live model does not keep `MultiLineString`. `flattenLineCoords` still flattens one if it appears.

`trackToFeature` copies `name`, `description`, and `times` onto a GeoJSON Feature. 3D reads `properties.name` only.

Coordinates are `[lon, lat]`. `haversineMeters` takes `[lat, lon]`. `segmentMeters` swaps them.

## Modules

| Global | File | Contract |
|---|---|---|
| `BRouterClient.route(url, waypoints, profile, opts)` | `brouter_client.js` | GET `lonlats`, `profile`, `format=geojson`, optional `apiKey`. Returns `[{lat, lng, ele?}]` |
| `L.control.routeSnap(options)` | `leaflet_route_snap.js` | Digitize control. Fires `routesnap:save` with `{latLngs, profileKey, fileName}`, plus `:error`, `:activate`, `:deactivate` |
| `LegacyTerrain3D` | `terrain_map_3d.js` | `setTracks(fc)`, `show(leafletMap, name)`, `hide(leafletMap)`, `flyToOverview()`, `visible` |
| `togpx(feature, options)` | `leaflet.togpx.js` | GPX 1.1 with the Topografix and XSI namespaces. Reads `properties.times` |
| `toGeoJSON.kml(doc)` | CDN | KML → GeoJSON. `gx:Track` times land on `properties.coordTimes` |

`tracktoolbox_app.js` is the host. It owns `tracks` and is the only place that should add or replace features.

### Splitting the app file

Leave it as one IIFE until a change is hard to make inside it. There is no bundler. A split today means either new globals or adding a bundler. The closure shares `tracks`, `selectedIds`, `map`, and `editWorking` on purpose.

If it has to be split, extract along boundaries that already do not touch the DOM, in this order:

1. Time + geometry (`canonicalTime`, `packTimes`, `lerpTime`, `extrapolateTime`, `timeForNewVertex`, `haversineMeters`).
2. Import (`parseGpxText`, `parseKmlText`, `parseFitBuffer`, `parseZipBuffer`).
3. Export (`featureXml`, `featuresToKml`, `downloadSelected`).
4. Edit session (undo, scissor, trim, node tools).

Keep panel wiring, keyboard, and `syncSelectionUi` in the host file. Do not split along "UI components" first. The expensive coupling is the shared `tracks` array, not the buttons.

## Import

`handleFiles` → per file:

| Extension | Parser |
|---|---|
| `.gpx`, or a body that contains `<gpx` | `parseGpxText` |
| `.kml`, or `<kml` | `parseKmlText` → `toGeoJSON.kml` |
| `.fit` | lazy `import()` of `@garmin/fitsdk@21.221.0` from esm.sh, then `parseFitBuffer` |
| `.zip`, `.kmz` | `parseZipBuffer` walks entries and reuses the three parsers |

Files over `MAX_FILE_BYTES` (25 MB) are skipped. A bad file increments a failure count and does not abort the batch. 3D is closed before the batch.

What each parser keeps: coordinates, elevation when present, name, description, and time (see below). Heart rate, cadence, and extensions are dropped. FIT `mergeHeartRates` is false.

GPX `<time>` and KML `when` with no zone are treated as UTC. An offset is stored as the same instant, written later with `Z`.

## Map drawing

`redrawMapLayers` clears `tracksLayer` and rebuilds every visible feature.

- Lines: visible polyline plus a transparent hit polyline (`SELECT_HIT_WEIGHT`). Selected lines get direction arrows (`applyLegacyDirArrows`).
- A segment longer than `GAP_DOT_M` (500 m) is drawn dotted by `traceRuns`. The dot is display-only. The stored geometry and the GPX are still one continuous line.
- Points: circle marker plus a transparent hit circle (`SELECT_POINT_HIT_R`).
- Click toggles selection. Context menu (long-press on touch) enters edit on that feature.

`syncSelectionUi` is what calls the redraw. Do not draw tracks from anywhere else.

## Selection

`toggleTrack` pushes onto `selectedIds` or splices the id out. Re-selecting moves that id to the end.

Shift+drag (`mousedown` with shift, box zoom is off) adds every visible feature whose geometry hits the box, in `tracks` order. Ctrl+A replaces the selection with `visibleTracks()` order. Ctrl+D clears it.

The list button with `is-last-selected` is the tail of `selectedIds`. Earlier selected rows have no order number.

## Edit session

Enter: right-click / long-press, or `e` with exactly one feature selected. `enterEditMode` clones the feature, snapshots `tracks`, then `applyEditSessionChordSimplify` using the edit panel metres field (`#tracktoolbox-edit-step`, starts at 10). Changing that field restores the snapshot and thins again. Undo can step back inside the session after that. Esc discards to the snapshot from before the thin.

Tools (`setEditTool`): `node`, `scissor`, `trimBefore`, `trimAfter`, `delete`, `deleteFeature`. Points only allow node, delete, and delete-feature.

| Tool | Behavior |
|---|---|
| node | Drag a vertex. Click the segment to insert. A click within `EDIT_NODE_PAD_PX` (12 px) of a vertex does not insert |
| scissor | Split into two features, `_1` and `_2`. The shared vertex is on both. A cut within `EDIT_MIN_CUT_M` (1 m) of an end is refused |
| trim before / after | Drop one side. The click becomes the new end |
| delete | Remove one vertex. At least two remain |
| delete feature | Remove a feature that belongs to this session |

`projectClickOntoLine` returns `{index, t, cutCoord, cutLL}`. `index` is the vertex before the cut. `t` is 0..1 along that segment. Elevation of a new vertex is `lerpEle` of the two ends when both have elevation.

Save writes `editWorking` back and exits. The session has no separate "dirty" flag beyond the undo stack.

## Time

A timestamp belongs to the sample. The vertex keeps it when that sample is still that vertex.

| Operation | Rule |
|---|---|
| Thin | Survivors keep `times[keptIndex]`. The clock between two survivors does not move |
| Drag | Same index, same time |
| Delete vertex | That slot is spliced out |
| Cut on an existing vertex | Both pieces keep that vertex's time |
| New vertex on a segment | `timeForNewVertex` |
| Merge | Concatenate `times` in `selectedIds` order. A source with no `times` contributes `null` per vertex |
| Digitize | No `times`. BRouter has no clock and the new track has no anchor sample |

`timeForNewVertex` on segment `i → i+1`:

1. Lerp when both ends have a time: `t0 + (t1 - t0) * t`.
2. Otherwise extrapolate. Ahead first (anchor `i+1`, other `i+2`), then behind (anchor `i`, other `i-1`). The anchor must already have a time. Speed of a real pair is used as-is, including a backwards pair: new start `tA - (tB - tA) * (dNew / dRef)`, new end `tA + (tA - tB) * (dNew / dRef)`.
3. Default rate is **0.5 s/m** (`EXTRAP_SPEED_MPS = 2`). Used when `dRef` is 0, when `dRef / dNew < EXTRAP_RATIO_EPS` (`1e-6`), or when the second timestamp is missing. Offset is `distance_m * 0.5` seconds before or after the anchor.

A feature that arrived without `times` stays without `times`. No `Date.now()`.

### Write

GPX: `togpx` writes `<time>` for each truthy `properties.times[i]`, on track points and waypoints. A `null` slot omits the element. Namespace declarations stay on the GPX root.

KML: `featuresToKml`.

- Point with a time → `TimeStamp` / `when`.
- Line → `gx:Track` only when `lineTimesComplete` (every vertex has a time). `when[i]` is paired with `gx:coord[i]`. One hole and the line is a `LineString` with no times in that file. GPX of the same feature still has the times that exist.
- Root declares `xmlns` (KML 2.2) and `xmlns:gx`.

One `null` run after a merge of a timed track with an untimed track is enough to lose `gx:Track` on KML export.

## Export and merge

`downloadSelected(format)` partitions the selection into points and lines. A single document never contains both. Points-only → `points.gpx` / `points.kml`. One line, separate mode → a file named from the track. Several lines, separate mode → a zip, one file each. Collection mode → one file of all lines. A mixed selection in collection mode → a zip of `tracks.*` plus `points.*`.

`mergeSelectedLines` replaces the selected lines with one LineString. Name and description are joined with ` - `. The feature is inserted at the first source's index in `tracks`. `sourceFile` is the first source's file. Order is `selectedIds`, not the order of the list and not spatial order. No undo.

## Digitize

`L.Control.RouteSnap` draws stations and resolves each leg with the current pen:

- `route` — BRouter
- `straightElev` — straight line, elevation sampled along it
- `straightSkip` — straight line, that leg is left out of the elevation stats

Profile (`mtb`, `trekking`, `hiking-mountain`) applies to the next leg. Coverage is `COVERAGE_BOUNDS` (lon 5–20, lat 40–50). A leg over `MAX_LEG_M` (25 km) is refused. The host passes `TRACKTOOLBOX_BROUTER_URL` (`?brouter=` overrides it, otherwise `https://route.tiroltrailhead.com/brouter`).

Save emits `routesnap:save`. `addRoutedTrackFromLatLngs` appends a LineString, `sourceFile: 'digitize'`, description `BRouter · <profile>`, no times.

## 3D

`LegacyTerrain3D` is a Mapbox GL map in `#map-3d`, terrain-RGB, same camera idea as the 2D view. `syncTracksTo3D` pushes `tracksToFeatureCollection()` even while 3D is hidden, so the next open is current. `show` flies to the single selected name when there is one. iOS canvas fingerprinting can poison terrain RGB; `canvasDemDecodePoisoned` bails out before `setTerrain`. Digitize and edit are refused while 3D is up, and the other way around.

## Search

The panel field does two jobs. A short debounce (`scheduleSearch`) runs a fuzzy match over `tracks` (`fuzzyScore`, limit `SEARCH_TRACK_LIMIT` 12) and, from `SEARCH_NOMINATIM_MIN` (2) characters, a Nominatim request (limit 6, abortable). Choosing a track selects it. Choosing a place pans the map.

The same string filters the list and the map via `_trackFilterIds`. Clearing the field clears the filter. It does not clear the selection.

## UI shell

Toasts: `showToast`, centered on `#map`, 2.8 s. Busy flag: `setBusy` on the `#tracktoolbox-busy` overlay during import and zip.

Welcome panel on load. After a download, `showKofiDownloadReminder` once per page view.

The header info control (`#tracktoolbox-docs-open`) calls `showDocsOverlay`. That loads `docs.html` in an iframe over a dimmed page: 90vw by 90dvh, or 60vw by 90dvh in landscape. Embedded docs drop the 720px column so the text fills the frame. The app document stays loaded, so tracks and the edit session survive. Direct visits and the `seo/` links still open `docs.html` as its own page.

Keyboard listener is the last big block in the app file. Shortcuts are ignored while focus is in an input. `data-shortcut` on a control is the badge shown when `k` toggles `.tracktoolbox-show-keys`. The shortcut list in the page and in `docs.html` has to be updated with the listener. They are not generated.

## Constants

Behavior knobs in `tracktoolbox_app.js`:

| Constant | Value | Effect |
|---|---|---|
| `DEFAULT_CENTER` / `DEFAULT_ZOOM` | Innsbruck, 11 | Empty-map view |
| `MAX_FILE_BYTES` | 25 MB | Reject on import |
| `GAP_DOT_M` | 500 m | Dotted draw for a long segment |
| `#tracktoolbox-edit-step` | 10 m | Chord thin on entering edit, and again when the field changes |
| `EDIT_NODE_PAD_PX` | 12 px | No insert on top of a vertex |
| `EDIT_MIN_CUT_M` | 1 m | No scissor at an end |
| `EDIT_UNDO_MAX` | 50 | Undo depth |
| `EDIT_HIT_WEIGHT` | 25 px | Edit hit target |
| `SELECT_HIT_WEIGHT` | 28 px | Select hit target |
| `EXTRAP_SPEED_MPS` | 2 | 0.5 s/m for a new timestamp with no usable pair |
| `EXTRAP_RATIO_EPS` | 1e-6 | `dRef / dNew` below this uses that default rate |
| `SEARCH_TRACK_LIMIT` | 12 | Fuzzy dropdown cap |
| `SEARCH_NOMINATIM_LIMIT` | 6 | Place dropdown cap |

In `leaflet_route_snap.js`: `MAX_LEG_M` 25 km, `COVERAGE_BOUNDS`, `ELEV_GRADE_WINDOW_M` 50 m, `ROUTE_HIST_MAX` 40. In `terrain_map_3d.js`: `LABEL_MIN_ZOOM` 13, `LABEL_RADIUS_M` 3 km, `OVERVIEW_CAMERA`.

## Services and keys

All of these are client-side and visible in the page source.

| Service | Where |
|---|---|
| Topo tiles | Tracestrack, key on the tile URL in the app file |
| Satellite | Google `vt/lyrs=y`, no key |
| BRouter | `TRACKTOOLBOX_BROUTER_URL`, `TRACKTOOLBOX_BROUTER_KEY` |
| Mapbox terrain | `MAPBOX_TOKEN` in `terrain_map_3d.js` |
| Nominatim | `nominatimSearch` |
| FIT SDK | esm.sh, fetched on first `.fit` |

## Out of scope

No account, no save-to-server, no heart rate or cadence round-trip, no per-point time on a digitized route, no undo for merge/remove/clear. A KML line with a single missing time is not a `gx:Track`.
