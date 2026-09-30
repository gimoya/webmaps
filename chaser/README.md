# Chaser

Live multi-user GPS map. Leaflet + Firestore, no auth.

## What it does

- Tracestrack topo basemap
- Course overlay from a GPX the user uploads. The file is stored on the `routes` document. The chosen route id stays in the URL hash.
- One live trace per alias. Case does not distinguish (`Kay` and `kay` are the same)
- Last point shows the alias on a white stem, plus a dashed accuracy ring in the alias color. A finished ride drops the ring.
- Alias labels shrink below zoom 14
- Click the map to fade the panel. The ⓘ box brings it back
- A fresh load asks Rider or Viewer. **Start Ride / Resume Tracing** starts or continues a trace that is not finished. **Stop tracking** stops this page's writer and finishes the ride. The trace stays on the map.

## Project files

- `index.html` – page, FAQ, Firebase web config
- `styles.css` – panel, dialog, marker, accuracy-ring pulse
- `app.js` – map, Firestore, GPS writer
- `gpx.js` – GPX parse, 10 m thinning, namespaced write
- `track-grade.js` – uphill / flat split for the course line
- `manifest.json` – installable app
- `sw.js` – app shell and topo tile cache. The page does not register it.
- `icons/` – 📡 app icons
- `gpx_tracks/` – sample course file, not loaded automatically

## Firebase

`window.CHASER_FIREBASE_CONFIG` is set in `index.html` before `app.js`. The web API key is public. Firestore rules are the lock.

If that object is missing, the map still loads. Route storage and live traces stay offline.

## Firestore data model

Collection: `trackingSessions`

Session fields:

- `name` (alias, stored as typed, max 30 characters)
- `isActive` (boolean)
- `startedAt` (server timestamp)
- `endedAt` (server timestamp or `null`). **Stop tracking** sets it. The finished list line shows that time.
- `finished` (boolean). `false` when the session is created. **Stop tracking** sets it `true`. The session stays `isActive`, so the trace stays on the map. The list shows `Tracking stopped/finished` and the end time. That alias cannot start or resume. `#admin` shows **Clear all traces**, which deletes every tracking session and its points.

Subcollection: `trackingSessions/{sessionId}/points`

Point fields:

- `lat`, `lon`, `accuracy` (numbers)
- `recordedAt` (server timestamp). The segment that ends at a point is drawn dotted when that `recordedAt` is more than 20 seconds after the previous point's `recordedAt`.

The client matches aliases with trim + lowercase. That does not add a field. Lookup loads active sessions and filters in the browser. The color is a hash of that same key, so both spellings share a color. The name drawn on the map is the casing stored on the document.

Collection: `routes`

- Document id `route_1`, `route_2`, `route_3`, … The hash is that id.
- `name` (the uploaded file name, without `.gpx`)
- `gpx` (the file text)
- `createdAt` (server timestamp)

`routes/counter` stores `{ next }`, the next number to assign. An upload reads it and writes the route in one transaction. The list skips that document. `#admin` shows a delete button on each route. That delete removes the route and sets `next` to one higher than the highest `route_N` still stored, or `1` when none remain. Deleting an older route leaves `next` where it is.

One document is at most 1 MiB. Vertices closer than 10 m are dropped first, and the stored file is that GPX. The upload refuses it when the result would not fit beside `name` and `createdAt`. Opening a route reads that document's `gpx`.

## Trace lifecycle

One alias, one active trace.

A fresh load with no mode hash asks Rider or Viewer. Viewer sets `#viewing`. The bike button, or a load that already has `#tracking`, opens the name box. **Start Ride / Resume Tracing** calls GPS in that click, then:

- No active trace for the typed alias: a new session is created and this page writes to it. The hash becomes `#tracking`.
- An active trace exists and is not finished: writing continues on the oldest active session for that alias.
- An active trace for that alias is finished: the name box shows `{alias} already finished the ride!` and does not write. The box then closes and the page stays a viewer.
- This page is already writing: **Stop tracking** asks for a confirm, then sets `finished` and `endedAt` and stops this page's writer. The trace stays on the map. The list shows `Tracking stopped/finished` in green with the end time. The page becomes a viewer (`#viewing`).

`#simulation` on the hash uses a generated fix instead of the device. Bearing is random, 0–360. Step length is left-weighted from 5 m to 50 m. From time to time a run of steps stays under 5 m, measured from the last stored point, so the writer skips them as slow. If the generator itself was idle for more than 20 s, the next fix is one step at that same riding speed across the whole gap. That point is stored, and the segment is dashed because the stored timestamps are more than 20 s apart. The fix still writes only for this page's active rider. The log under Active Riders shows meters, m/s, and `slow/no move skip`, `+30 m/s skip`, or `normal write`.

GPS loss, a dropped network, refresh, tab close, or locking the phone does not end the Firestore trace. The writer on this page stops. Open the name box and submit the alias again to continue it.

## Firestore rules

Public unauthenticated reads. Writes are validated. Anyone with the project config can read tracks, append points to an active trace that is not finished, or mark one finished.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /trackingSessions/{sessionId} {
      allow read: if true;

      allow create: if
        request.resource.data.keys().hasOnly([
          'name', 'isActive', 'startedAt', 'endedAt', 'finished'
        ]) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() >= 1 &&
        request.resource.data.name.size() <= 30 &&
        request.resource.data.isActive == true &&
        request.resource.data.startedAt == request.time &&
        request.resource.data.endedAt == null &&
        request.resource.data.finished == false;

      allow update: if
        resource.data.isActive == true &&
        resource.data.finished != true &&
        (
          (
            request.resource.data.diff(resource.data).affectedKeys().hasOnly([
              'finished', 'endedAt'
            ]) &&
            request.resource.data.finished == true &&
            request.resource.data.endedAt == request.time
          ) ||
          (
            request.resource.data.diff(resource.data).affectedKeys().hasOnly([
              'isActive', 'endedAt'
            ]) &&
            request.resource.data.isActive == false &&
            request.resource.data.endedAt == request.time
          )
        );

      allow delete: if true;

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
          ).data.isActive == true &&
          get(
            /databases/$(database)/documents/trackingSessions/$(sessionId)
          ).data.finished != true;

        allow update: if false;
        allow delete: if true;
      }
    }

    match /routes/counter {
      allow read: if true;

      allow create: if
        request.resource.data.keys().hasOnly(['next']) &&
        request.resource.data.next == 2;

      allow update: if
        request.resource.data.keys().hasOnly(['next']) &&
        request.resource.data.next is int &&
        resource.data.next is int &&
        request.resource.data.next >= 1 &&
        (
          request.resource.data.next == resource.data.next + 1 ||
          request.resource.data.next < resource.data.next
        );

      allow delete: if false;
    }

    match /routes/{routeId} {
      allow read: if true;

      allow create: if
        routeId.matches('^route_[1-9][0-9]*$') &&
        request.resource.data.keys().hasOnly(['name', 'gpx', 'createdAt']) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() >= 1 &&
        request.resource.data.name.size() <= 200 &&
        request.resource.data.gpx is string &&
        request.resource.data.gpx.size() >= 1 &&
        request.resource.data.gpx.size() <= 1000000 &&
        request.resource.data.createdAt == request.time;

      allow update: if false;
      allow delete: if true;
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
3. Choose Rider, or Viewer and then the bike button.
4. Enter an alias and click **Start Ride / Resume Tracing**. Allow location.
5. Open the page on another device to see the live trace.
6. Click **Stop tracking** and confirm. This page stops writing and switches to viewer. The trace stays on the map with `Tracking stopped/finished` and the end time. That alias cannot start again.

## Runtime

- GPS is `getCurrentPosition` with `enableHighAccuracy`. The first call runs in the button click, before any Firestore `await`, or mobile browsers drop the permission prompt.
- A point is written every 5 seconds while this page is the writer. A fix closer than 5 m to the last stored point is skipped. A fix is also skipped when that distance divided by the time since that point is over 30 m/s. The next fix is checked against that same stored point.
- The first fix on start or resume centers at zoom 17. Later points do not recenter. The top-left control recenters on this page's latest fix.
- Portrait framing shifts the target up. Landscape shifts it left, clear of the panel.
- Clicking a listed user with points centers on their last point.
- An active session with no points is in the list and has no line.
- The list marks a trace stale when the last stored point is older than 5 seconds. This page's own writer is never marked stale. A finished ride shows `Tracking stopped/finished` in green with `end time: HH:MM:SS` from `endedAt`.
- The marker popup's last line is `Tracing 1 point every 5s` while this page is storing fixes, `Slow or no rider movement` when a fix is under 5 m from the last stored point, and `Tracing paused!` when this page is not writing. A fix over 30 m/s does not change that line. Other viewers see `Tracing paused!` once the last stored point is older than 5 seconds.
- The GPS row is `allowed` / `denied` / `unknown` and `running` / `stopped`. `running` means this page started the 5-second loop. It does not prove points are being stored. iPhone Safari often stays `unknown` until a fix or a denial.
- Locking the phone freezes the page. No new points are stored. If the page is still there when you unlock, the writer continues. If the phone discarded it, open the name box and submit the alias again.
- Completed traces stay in Firestore and are hidden from the live map.
- Pan and zoom write `?lat=&lng=&z=` and keep the fragment, so `#infos` still opens the FAQ.
- Installable from the manifest. `sw.js` is not registered, so its app-shell and tile cache do not run.
