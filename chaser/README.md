# Chaser

Live multi-user GPS map built with Leaflet + Firestore realtime updates.

## Scope (MVP)

- Full map canvas + right-side status panel
- Multi-user live location display
- Per-session breadcrumb tracks
- Writer loop every 10 seconds while sharing is active

Excluded in this phase:
- GPX upload/matching
- Leaderboards
- Historical analytics UI

## Project files

- `index.html` – page structure and SDK includes
- `styles.css` – map/panel styling and user marker styles
- `app.js` – map logic, Firestore subscription, geolocation writer

## Firebase setup

`app.js` expects a global `window.CHASER_FIREBASE_CONFIG`.

Add this block in `index.html` before `app.js`:

```html
<script>
  window.CHASER_FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  };
</script>
```

If this object is missing, realtime sync is disabled and the app logs a warning.

## Firestore data model

Collection: `trackingSessions`

Document ID: generated once per tracking session

Session fields:
- `name` (alias, the only identity)
- `isActive` (boolean)
- `startedAt` (server timestamp)
- `endedAt` (server timestamp or `null`)

Subcollection: `trackingSessions/{sessionId}/points`

Point fields:
- `lat` (number)
- `lon` (number)
- `accuracy` (number)
- `recordedAt` (server timestamp)

## Trace lifecycle

An alias has one active trace. **Stop sharing** sets `isActive` to `false` and
records `endedAt`. If several active traces share that alias, Stop ends all of
them.

**Start sharing** looks up that alias.

- No active trace: a new trace is created and this page writes points to it.
- An active trace: the page asks `Resume the trace for "<alias>" on this browser?`
  - **Resume** writes points onto that existing trace.
  - **Stop old & start new** ends every active trace for the alias, then creates
    a new one and writes to it.

GPS loss, network loss, a refresh, or closing the tab does not end the trace.
The next Start with that alias finds it.

The old `liveLocations` collection is not used by this model. Existing
documents can remain in Firestore.

## Firestore rules

These rules intentionally allow public, unauthenticated reads and validated
writes. Anyone who knows the project configuration can view tracks, append
points, or stop an active trace.

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

Publish these rules in the Firebase console before testing the session model.

## Usage

1. Serve the repository over localhost or HTTPS.
2. Open `chaser/`.
3. Enter a display name.
4. Click **Start sharing**.
5. Allow browser location permission.
6. Open the page on another device/browser to verify multi-user sync.
7. Click **Stop sharing** to finish and hide the current track.

## Runtime behavior

- Writer cadence: every 10s (`WRITE_INTERVAL_MS`)
- Start centers once on the first GPS fix at zoom level 17
- The top-left session control manually centers on the latest local position
- Breadcrumb color is a stable hash of the alias
- The active-user panel shows one row per active trace
- An alias with an active trace asks to resume it, or to stop it and start a new trace
- Each writer interval appends one point to the active trace
- Active points are connected by a Leaflet polyline
- Stop sharing ends every active trace for the current alias
- Completed traces remain stored but are hidden from the live map

## Troubleshooting

- **No users appear:** check Firebase config and browser console.
- **Writes fail:** publish the Firestore rules above.
- **Only your own marker appears:** open additional clients/devices.
- **Location denied:** enable geolocation permission for the site.
