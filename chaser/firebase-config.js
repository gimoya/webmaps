/** Shared Firebase web config (window + service worker via importScripts). */
const CHASER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDltxjsiYUSWb-ACSXbVwgle1QiTwWJDiI",
  authDomain: "chaser-75e2e.firebaseapp.com",
  projectId: "chaser-75e2e",
  storageBucket: "chaser-75e2e.firebasestorage.app",
  messagingSenderId: "764827136309",
  appId: "1:764827136309:web:888b04389963a1fec75c7c"
};

/**
 * Web Push VAPID key from Firebase Console → Project settings → Cloud Messaging
 * → Web Push certificates. Leave empty until generated; push subscribe stays off.
 */
const CHASER_VAPID_KEY = "";

if (typeof window !== "undefined") {
  window.CHASER_FIREBASE_CONFIG = CHASER_FIREBASE_CONFIG;
  window.CHASER_VAPID_KEY = "BGYLtU8STyEXm17HjUEbgqt0ZZCqF3bxQxrcAZYkebT0fP3IyeUFkN1I_RcqrmgEOsowec6xvtq7s5Egcdh_R3Y";
  window.CHASER_MAPBOX_TOKEN =
    "pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ";
} else if (typeof self !== "undefined") {
  self.CHASER_FIREBASE_CONFIG = CHASER_FIREBASE_CONFIG;
  self.CHASER_VAPID_KEY = "BGYLtU8STyEXm17HjUEbgqt0ZZCqF3bxQxrcAZYkebT0fP3IyeUFkN1I_RcqrmgEOsowec6xvtq7s5Egcdh_R3Y";
}
