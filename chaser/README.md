# Chaser

Live multi-user GPS map. Leaflet + Firestore, no auth.

## What it does

- Tracestrack topo basemap
- Course overlay from `gpx_tracks/El Camino de la Paz 2026.gpx`, framed on load unless the URL already has `lat`, `lng`, and `z`
- One live trace per alias. Case does not distinguish (`Kay` and `kay` are the same)
- Last point shows the alias on a white stem, plus a dashed accuracy ring in the alias color
- Alias labels shrink below zoom 14
- Click the map to fade the panel. The ⓘ box brings it back
- One button: **START / RESUME / STOP**

## Project files

- `index.html` – page, FAQ, Firebase web config
- `styles.css` – panel, dialog, marker, accuracy-ring pulse
- `app.js` – map, Firestore, GPS writer
- `manifest.json` – installable app
- `sw.js` – app shell and topo tile cache
- `icons/` – 📡 app icons
- `gpx_tracks/` – course file drawn on load

## Firebase

`window.CHASER_FIREBASE_CONFIG` is set in `index.html` before `app.js`. The web API key is public. Firestore rules are the lock.

If that object is missing, the map and GPX still load. Realtime sync stays offline.

## Firestore data model

Collection: `trackingSessions`

Session fields:

- `name` (alias, stored as typed, max 30 characters)
- `isActive` (boolean)
- `startedAt` (server timestamp)
- `endedAt` (server timestamp or `null`)

Subcollection: `trackingSessions/{sessionId}/points`

Point fields:

- `lat`, `lon`, `accuracy` (numbers)
- `recordedAt` (server timestamp)

The client matches aliases with trim + lowercase. That does not add a field. Lookup loads active sessions and filters in the browser. The color is a hash of that same key, so both spellings share a color. The name drawn on the map is the casing stored on the document.

## Trace lifecycle

One alias, one active trace, until Stop.

**START / RESUME / STOP**

- This page is already writing: the button stops that alias, after a confirm. The trace is removed from the live map. It is gone for good. A new trace is a later click.
- No active trace for the typed alias: a new session is created and this page writes to it.
- An active trace exists: **Resume** writes onto the oldest active session for that alias. **Stop tracking** ends every active session whose alias matches, ignoring case. It does not start a new one.

GPS loss, a dropped network, refresh, tab close, or locking the phone does not end the Firestore trace. The writer on this page stops. Type the alias and Resume to continue it.

## Firestore rules

Public unauthenticated reads. Writes are validated. Anyone with the project config can read tracks, append points to an active trace, or stop one.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /trackingSessions/{sessionId} {
      allow read: if true;

      allow create: if
        request.resource.data.keys().hasOnly([
          'name', 'isActive', 'startedAt', 'endedAt'
        ]) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() >= 1 &&
        request.resource.data.name.size() <= 30 &&
        request.resource.data.isActive == true &&
        request.resource.data.startedAt == request.time &&
        request.resource.data.endedAt == null;

      allow update: if
        resource.data.isActive == true &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'isActive', 'endedAt'
        ]) &&
        request.resource.data.isActive == false &&
        request.resource.data.endedAt == request.time;

      allow delete: if false;

      match /points/{pointId} {
        allow read: if true;

        allow create: if
          request.resource.data.keys().hasOnly([
            'lat', 'lon', 'accuracy', 'recordedAt'
          ]) &&
          request.resource.data.lat is number &&
          request.resource.data.lat >= -90 &&
          request.resource.data.lat <= 90 &&
          request.resource.data.lon is number &&
          request.resource.data.lon >= -180 &&
          request.resource.data.lon <= 180 &&
          request.resource.data.accuracy is number &&
          request.resource.data.accuracy >= 0 &&
          request.resource.data.recordedAt == request.time &&
          get(
            /databases/$(database)/documents/trackingSessions/$(sessionId)
          ).data.isActive == true;

        allow update, delete: if false;
      }
    }
  }
}
```

Publish these in the Firebase console. A new field needs a rules change.

## Basemap

Topo tiles come from Tracestrack. The key sits in the tile URL in `app.js`. Restrict it in the Tracestrack console with a referer allow-list. Put origins in **Referers**. Leave **User Agents** empty.

```txt
http://127.0.0.1
http://localhost
https://tiroltrailhead.com
```

The page sends `strict-origin-when-cross-origin`, so the tile request includes the origin.

## Usage

1. Serve the repo over localhost or HTTPS.
2. Open `chaser/`.
3. Enter an alias.
4. Click **START / RESUME / STOP** and allow location.
5. Open the page on another device to see both traces.
6. Click the same button again to stop. Confirm. The trace leaves the map.

## Runtime

- GPS is `getCurrentPosition` with `enableHighAccuracy`. The first call runs in the button click, before any Firestore `await`, or mobile browsers drop the permission prompt.
- A point is written every 5 seconds while this page is the writer.
- The first fix on start or resume centers at zoom 17. Later points do not recenter. The top-left control recenters on this page's latest fix.
- Portrait framing shifts the target up. Landscape shifts it left, clear of the panel.
- Clicking a listed user with points centers on their last point.
- An active session with no points is in the list and has no line.
- The list marks a trace stale when the last stored point is older than 5 seconds. This page's own writer is never marked stale.
- The GPS row is `allowed` / `denied` / `unknown` and `running` / `stopped`. `running` means this page started the 5-second loop. It does not prove points are being stored. iPhone Safari often stays `unknown` until a fix or a denial.
- Locking the phone freezes the page. No new points are stored. If the page is still there when you unlock, the writer continues. If the phone discarded it, type the alias and Resume.
- Completed traces stay in Firestore and are hidden from the live map.
- Pan and zoom write `?lat=&lng=&z=` and keep the fragment, so `#infos` still opens the FAQ.
- Installable from the manifest. `sw.js` serves the app shell network-first and caches Tracestrack tiles up to 50MB.
