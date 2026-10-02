# Chaser

Live multi-user GPS map. Leaflet + Firestore, no auth.

## What it does

- Tracestrack topo basemap
- Events scope all live data. The event id is the first URL hash token (`#event-id#viewing`). Missing or unknown event forces a picker. Create needs a pool admin code (or master); ongoing admin uses `#admin=<code>` for that event.
- Course overlay from a GPX that event admin uploads into the selected event (`events/{eventId}/routes/current`). Every client on that event draws it when it exists.
- One live trace per alias per event. Case does not distinguish (`Kay` and `kay` are the same)
- Last point shows the alias on a white stem, plus a dashed accuracy ring in the alias color. A finished ride drops the ring.
- Alias labels shrink below zoom 14
- Click the map to fade the panel. The ⓘ box brings it back
- After an event is chosen, a fresh load asks Rider or Viewer. **Start Ride / Resume Tracing** starts or continues a trace that is not finished. **Stop tracking** stops this page's writer and finishes the ride. The trace stays on the map.

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

Collection: `events`

- Document id = slug from the event name (lowercase, hyphens, max 40).
- `name` (display name)
- `createdAt` (server timestamp)
- `adminCode` (string). Set at create from a pool code or the master password. Required for later admin (GPX upload, clear traces) via `#admin=<adminCode>` on that event.

Document: `adminConfig/current`

- `masterPassword` (string). Always `admin_master_6071`. Always valid for create (does not burn a pool code) and as `#admin=admin_master_6071` on any event.
- `unusedCodes` (array of strings). One-time seeded pool of unused 5-character codes. Create with a pool code removes that code from the array. When empty, reseed from the console using [`admin-pool-seed.json`](admin-pool-seed.json) (or a new batch).

Everything live sits under an event:

```text
events/{eventId}/routes/current
events/{eventId}/placement/current
events/{eventId}/trackingSessions/{sessionId}
events/{eventId}/trackingSessions/{sessionId}/points/{pointId}
```

Session fields:

- `name` (alias, stored as typed, max 30 characters)
- `isActive` (boolean)
- `startedAt` (server timestamp)
- `endedAt` (server timestamp or `null`). **Stop tracking** sets it. The finished list line shows that time.
- `finished` (boolean). `false` when the session is created. **Stop tracking** sets it `true`. The session stays `isActive`, so the trace stays on the map. The list shows `Tracking stopped/finished` and the end time. That alias cannot start or resume in this event. With a matching `#admin=<code>`, **Clear all traces** deletes every tracking session and its points in this event and clears that event's `placement/current`.

Point fields:

- `lat`, `lon`, `accuracy` (numbers)
- `recordedAt` (server timestamp). The segment that ends at a point is drawn dotted when that `recordedAt` is more than 20 seconds after the previous point's `recordedAt`.

The client matches aliases with trim + lowercase. That does not add a field. Lookup loads active sessions and filters in the browser. The color is a hash of that same key, so both spellings share a color. The name drawn on the map is the casing stored on the document.

Route document `events/{eventId}/routes/current`:

- `name` (the uploaded file name, without `.gpx`)
- `gpx` (the file text)
- `createdAt` (server timestamp)

Event admin (`#admin=<event adminCode>` or master) shows the map upload control while an event is selected. Upload overwrites that event's `routes/current`. Bare `#admin` only opens the create form; create still needs a valid pool or master code in the form.

One route document is at most 1 MiB. Vertices closer than 10 m are dropped first, and the stored file is that GPX. The upload refuses it when the result would not fit beside `name` and `createdAt`.

### Seed admin pool (developer)

1. Open Firestore → add collection `adminConfig` → document id `current`.
2. Fields:
   - `masterPassword` (string): `admin_master_6071`
   - `unusedCodes` (array): paste all strings from [`admin-pool-seed.json`](admin-pool-seed.json) `unusedCodes`.
3. Publish the rules below (events now require `adminCode` on create).
4. When the pool is empty, generate a new batch of 5-char codes (A–Z / 2–9, no I/O/0/1) and replace or append `unusedCodes` in the console. The app does not generate codes.

## Trace lifecycle

One alias, one active trace per event.

A load with no event id (or an unknown id) opens the event picker. With `#admin` or `#admin=…` the create form appears; submit needs a valid unused pool code or the master password. After an event is bound, a load with no mode hash asks Rider or Viewer. Viewer sets `#eventId#viewing`. The bike button, or a load that already has `#tracking`, opens the name box. **Start Ride / Resume Tracing** calls GPS in that click, then:

- No active trace for the typed alias: a new session is created and this page writes to it. The hash becomes `#eventId#tracking`.
- Start and resume also write the alias as a `#rider=` token (URL-encoded). The name box is filled from that token.
- An active trace exists and is not finished: writing continues on the oldest active session for that alias.
- An active trace for that alias is finished: the name box shows `{alias} already finished the ride!` and does not write. The box then closes and the page stays a viewer.
- This page is already writing: **Stop tracking** asks for a confirm, then sets `finished` and `endedAt` and stops this page's writer. The trace stays on the map. The list shows `Tracking stopped/finished` in green with the end time. The page becomes a viewer (`#eventId#viewing`).

`#simulation` on the hash uses a generated fix instead of the device. It runs only while a GPX route is drawn. Otherwise the start is refused and a notice says the simulation stopped. A new ride begins at the route start. One speed is picked for the ride, evenly between 10 and 25 km/h, and each fix advances that far along the route. A resume on a fresh page starts at the route vertex nearest the last stored point. The fix still writes only for this page's active rider. The log under Active Riders shows meters, m/s, and `slow/no move skip`, `+30 m/s skip`, or `normal write`.

GPS loss, a dropped network, refresh, tab close, or locking the phone does not end the Firestore trace. The writer on this page stops. Open the name box and submit the alias again to continue it.

## Firestore rules

Public unauthenticated reads. Writes are validated. Anyone with the project config can read tracks, append points to an active trace that is not finished, or mark one finished. Live paths are under `events/{eventId}`.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /adminConfig/{docId} {
      allow read: if true;

      allow create, update: if
        docId == 'current' &&
        request.resource.data.keys().hasOnly(['unusedCodes', 'masterPassword']) &&
        request.resource.data.unusedCodes is list &&
        request.resource.data.unusedCodes.size() <= 500 &&
        request.resource.data.masterPassword is string &&
        request.resource.data.masterPassword.size() >= 8 &&
        request.resource.data.masterPassword.size() <= 80;

      allow delete: if false;
    }

    match /events/{eventId} {
      allow read: if true;

      allow create: if
        request.resource.data.keys().hasOnly(['name', 'createdAt', 'adminCode']) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() >= 1 &&
        request.resource.data.name.size() <= 80 &&
        request.resource.data.createdAt is timestamp &&
        request.resource.data.adminCode is string &&
        request.resource.data.adminCode.size() >= 5 &&
        request.resource.data.adminCode.size() <= 40;

      allow update: if
        request.resource.data.keys().hasOnly(['name', 'createdAt', 'adminCode']) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() >= 1 &&
        request.resource.data.name.size() <= 80 &&
        request.resource.data.createdAt is timestamp &&
        request.resource.data.adminCode is string &&
        request.resource.data.adminCode == resource.data.adminCode;

      allow delete: if true;

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
          request.resource.data.startedAt is timestamp &&
          (
            request.resource.data.endedAt == null ||
            request.resource.data.endedAt is timestamp
          ) &&
          request.resource.data.finished is bool;

        allow update: if
          resource.data.isActive == true &&
          resource.data.finished != true &&
          (
            (
              request.resource.data.diff(resource.data).affectedKeys().hasOnly([
                'finished', 'endedAt'
              ]) &&
              request.resource.data.finished == true &&
              request.resource.data.endedAt is timestamp
            ) ||
            (
              request.resource.data.diff(resource.data).affectedKeys().hasOnly([
                'isActive', 'endedAt'
              ]) &&
              request.resource.data.isActive == false &&
              request.resource.data.endedAt is timestamp
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
            request.resource.data.recordedAt is timestamp &&
            get(
              /databases/$(database)/documents/events/$(eventId)/trackingSessions/$(sessionId)
            ).data.isActive == true;

          allow update: if false;
          allow delete: if true;
        }
      }

      match /routes/current {
        allow read: if true;

        allow create, update: if
          request.resource.data.keys().hasOnly(['name', 'gpx', 'createdAt']) &&
          request.resource.data.name is string &&
          request.resource.data.name.size() >= 1 &&
          request.resource.data.name.size() <= 200 &&
          request.resource.data.gpx is string &&
          request.resource.data.gpx.size() >= 1 &&
          request.resource.data.gpx.size() <= 1000000 &&
          request.resource.data.createdAt is timestamp;

        allow delete: if true;
      }

      match /placement/{placementId} {
        allow read: if true;

        allow create, update: if
          placementId == 'current' &&
          request.resource.data.keys().hasOnly(['order', 'locked', 'recordedAt']) &&
          request.resource.data.order is list &&
          request.resource.data.order.size() <= 100 &&
          request.resource.data.order.join(',') is string &&
          request.resource.data.locked is list &&
          request.resource.data.locked.size() <= 100 &&
          request.resource.data.locked.join(',') is string &&
          request.resource.data.recordedAt is timestamp;

        allow delete: if false;
      }
    }
  }
}
```

Publish these in the Firebase console. Event create (with `adminCode`), adminConfig pool updates, route overwrite, placement, and point writes all need this paste.

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
3. Pick an event (or `#admin` create one). Share links look like `#event-id#viewing`.
4. Choose Rider, or Viewer and then the bike button.
5. Enter an alias and click **Start Ride / Resume Tracing**. Allow location.
6. Open the page on another device with the same event hash to see the live trace.
7. Click **Stop tracking** and confirm. This page stops writing and switches to viewer. The trace stays on the map with `Tracking stopped/finished` and the end time. That alias cannot start again in this event.

## Runtime

- GPS is `getCurrentPosition` with `enableHighAccuracy`. The first call runs in the button click, before any Firestore `await`, or mobile browsers drop the permission prompt.
- A point is written every 5 seconds while this page is the writer. A fix closer than 5 m to the last accepted point is skipped (`slow/no move skip`). A fix is also skipped when that distance divided by the time since that accepted point is over 30 m/s (`+30 m/s skip`). The writer keeps running; only that sample is dropped. The next attempt is still measured against the same last accepted point, so `dt` only grows until a write succeeds. A GPS jump that later snaps back near the last accepted point writes again. A real move that stays over 30 m/s keeps skipping until implied speed from that last accepted point is under 30 m/s; then one catch-up point is stored and the vertices in between are lost. After a stored point, while a GPX route is drawn, this page overwrites that event's `placement/current` when the order or locks changed: `order` is every session id, first to last, by meters still left along the line, and `locked` keeps stopped riders in the index they held. **Stop tracking** appends that rider to `locked` on the same document. Cups on the map and in Active Riders come from that order: a cup plus the alias for the first three, then `4.th # Alias` and so on. Reaching the end of the line does not lock a place. Finished rides drop their points listener after the first full load; the line stays in memory. Until the event placement rules are published, the point still stores and the placement write is denied.
- The first fix on start or resume centers at zoom 17. Later points do not recenter. The top-left control recenters on this page's latest fix.
- Portrait framing shifts the target up. Landscape shifts it left, clear of the panel.
- Clicking a listed user with points centers on their last point.
- An active session with no points is in the list and has no line.
- The list marks a trace stale when the last stored point is older than 5 seconds. This page's own writer is never marked stale. A finished ride shows `Tracking stopped/finished` in green with `end time: HH:MM:SS` from `endedAt`.
- The marker popup's last line is `Tracing 1 point every 5s` while this page is storing fixes, `Slow or no rider movement` when a fix is under 5 m from the last stored point, and `Tracing paused!` when this page is not writing. A fix over 30 m/s does not change that line. Other viewers see `Tracing paused!` once the last stored point is older than 5 seconds.
- The GPS row is `allowed` / `denied` / `unknown` and `running` / `stopped`. `running` means this page started the 5-second loop. It does not prove points are being stored. iPhone Safari often stays `unknown` until a fix or a denial.
- Locking the phone freezes the page. No new points are stored. If the page is still there when you unlock, the writer continues. If the phone discarded it, open the name box and submit the alias again.
- Completed traces stay in Firestore and are hidden from the live map.
- Pan and zoom write `?lat=&lng=&z=` and keep the mode fragment.
- Installable from the manifest. `sw.js` is not registered, so its app-shell and tile cache do not run.
