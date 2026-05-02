# Chaser

Live multi-user GPS map built with Leaflet + Firestore realtime updates.

## Scope (MVP)

- Full map canvas + right-side status panel
- Multi-user live location display
- Writer loop every 10 seconds while sharing is active
- Stale user highlighting after 60 seconds

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

If this object is missing, the app runs in UI-only mode and logs a warning.

## Firestore data model

Collection: `liveLocations`  
Document ID: `userId`

Fields used:
- `name` (string)
- `lat` (number)
- `lon` (number)
- `accuracy` (number)
- `updatedAt` (server timestamp)
- `isActive` (boolean, optional)

## Recommended Firestore rules (starter)

Adjust these to match your auth model.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /liveLocations/{userId} {
      allow read: if true;

      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.data.keys().hasOnly([
                     'name', 'lat', 'lon', 'accuracy', 'updatedAt', 'isActive'
                   ])
                   && request.resource.data.name is string
                   && request.resource.data.lat is number
                   && request.resource.data.lon is number
                   && request.resource.data.accuracy is number;
    }
  }
}
```

For private events, replace `allow read: if true;` with authenticated/role-based access.

## Usage

1. Open `chaser/index.html`.
2. Enter display name.
3. Click **Start sharing**.
4. Allow browser location permission.
5. Open the page on another device/browser to verify multi-user sync.

## Runtime behavior

- Writer cadence: every 10s (`WRITE_INTERVAL_MS`)
- Stale threshold: 60s (`VIEW_STALE_MS`)
- Stop sharing sets your document `isActive: false`

## Troubleshooting

- **No users appear:** check Firebase config and browser console.
- **Writes fail:** verify Firestore rules and auth state.
- **Only your own marker appears:** open additional clients/devices.
- **Location denied:** enable geolocation permission for the site.
