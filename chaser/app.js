(function () {
  const VIEW_STALE_MS = 60 * 1000;
  const WRITE_INTERVAL_MS = 10 * 1000;
  const COLLECTION_NAME = "liveLocations";

  const userListEl = document.getElementById("user-list");
  const statusEl = document.getElementById("connection-status");
  const displayNameEl = document.getElementById("display-name");
  const startBtn = document.getElementById("start-share");
  const stopBtn = document.getElementById("stop-share");

  const map = L.map("map", { zoomControl: true }).setView([47.2672, 11.3928], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  L.control.locate({
    position: "topleft",
    flyTo: false,
    showPopup: false,
    strings: { title: "Center on my location" }
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  const markersByUserId = new Map();
  const latestUsers = new Map();

  let unsubscribe = null;
  let writeTimer = null;
  let writerActive = false;

  const userId = ensureUserId();
  const storedName = localStorage.getItem("chaser_display_name");
  if (storedName) displayNameEl.value = storedName;

  const firebaseConfig = window.CHASER_FIREBASE_CONFIG || null;
  if (!firebaseConfig) {
    renderConnection(false, "offline");
    console.warn("CHASER_FIREBASE_CONFIG missing. Realtime sync disabled.");
    return;
  }

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const locationsRef = db.collection(COLLECTION_NAME);

  attachViewerSubscription(locationsRef);
  setInterval(updateStaleState, 5000);
  wireControls(locationsRef);

  function wireControls(ref) {
    startBtn.addEventListener("click", () => {
      const name = sanitizeName(displayNameEl.value);
      if (!name) {
        alert("Please enter a display name.");
        return;
      }
      localStorage.setItem("chaser_display_name", name);
      setWriterState(true);
      sendOwnLocation(ref, name);
      writeTimer = setInterval(() => sendOwnLocation(ref, name), WRITE_INTERVAL_MS);
    });

    stopBtn.addEventListener("click", async () => {
      setWriterState(false);
      clearInterval(writeTimer);
      writeTimer = null;
      try {
        await ref.doc(userId).set({
          isActive: false,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.warn("Failed to mark user inactive:", err);
      }
    });
  }

  function setWriterState(active) {
    writerActive = active;
    startBtn.disabled = active;
    stopBtn.disabled = !active;
    displayNameEl.disabled = active;
  }

  function attachViewerSubscription(ref) {
    unsubscribe = ref.onSnapshot((snap) => {
      latestUsers.clear();
      snap.forEach((doc) => {
        const data = doc.data();
        if (!isValidUserRecord(doc.id, data)) return;
        latestUsers.set(doc.id, {
          userId: doc.id,
          name: data.name,
          lat: data.lat,
          lon: data.lon,
          accuracy: Number(data.accuracy || 0),
          updatedAtMs: toMillis(data.updatedAt),
          isActive: data.isActive !== false
        });
      });
      syncMarkersAndPanel();
      renderConnection(true, "online");
    }, (error) => {
      console.error("Firestore subscription error:", error);
      renderConnection(false, "offline");
    });
  }

  function syncMarkersAndPanel() {
    const seen = new Set();
    const sorted = [...latestUsers.values()]
      .filter((u) => u.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));

    sorted.forEach((user) => {
      seen.add(user.userId);
      const stale = isStale(user.updatedAtMs);
      upsertMarker(user, stale);
    });

    markersByUserId.forEach((marker, uid) => {
      if (!seen.has(uid)) {
        markersLayer.removeLayer(marker);
        markersByUserId.delete(uid);
      }
    });

    renderUserList(sorted);
  }

  function upsertMarker(user, stale) {
    const className = stale ? "chaser-user-marker stale" : "chaser-user-marker";
    const icon = L.divIcon({ className, iconSize: [14, 14] });
    const ageSec = user.updatedAtMs ? Math.max(0, Math.round((Date.now() - user.updatedAtMs) / 1000)) : null;
    const popup = [
      `<strong>${escapeHtml(user.name)}</strong>`,
      `Accuracy: ${Math.round(user.accuracy || 0)} m`,
      ageSec === null ? "Age: n/a" : `Age: ${ageSec}s`,
      stale ? "<em>stale</em>" : "<em>live</em>"
    ].join("<br>");

    const marker = markersByUserId.get(user.userId);
    if (!marker) {
      const m = L.marker([user.lat, user.lon], { icon }).addTo(markersLayer);
      m.bindPopup(popup);
      markersByUserId.set(user.userId, m);
      return;
    }
    marker.setLatLng([user.lat, user.lon]);
    marker.setIcon(icon);
    marker.setPopupContent(popup);
  }

  function renderUserList(users) {
    if (!users.length) {
      userListEl.innerHTML = "<li class='user-item'><div class='user-item-meta'>No active users</div></li>";
      return;
    }
    userListEl.innerHTML = users.map((user) => {
      const stale = isStale(user.updatedAtMs);
      const ageSec = user.updatedAtMs ? Math.max(0, Math.round((Date.now() - user.updatedAtMs) / 1000)) : null;
      return `
        <li class="user-item${stale ? " stale" : ""}">
          <div class="user-item-name">${escapeHtml(user.name)}</div>
          <div class="user-item-meta">
            ${stale ? "stale" : "live"} · age ${ageSec === null ? "n/a" : `${ageSec}s`} · acc ${Math.round(user.accuracy || 0)}m
          </div>
        </li>`;
    }).join("");
  }

  function updateStaleState() {
    syncMarkersAndPanel();
  }

  async function sendOwnLocation(ref, name) {
    if (!navigator.geolocation) {
      console.warn("Geolocation unsupported.");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await ref.doc(userId).set({
          name,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
          isActive: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to write own location:", err);
        renderConnection(false, "offline");
      }
    }, (err) => {
      console.warn("Geolocation error:", err);
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 4000
    });
  }

  function ensureUserId() {
    let id = localStorage.getItem("chaser_user_id");
    if (!id) {
      id = `u_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("chaser_user_id", id);
    }
    return id;
  }

  function renderConnection(connected, text) {
    statusEl.textContent = text;
    statusEl.classList.toggle("status-online", connected);
    statusEl.classList.toggle("status-offline", !connected);
  }

  function isValidUserRecord(userId, data) {
    return Boolean(
      userId &&
      data &&
      typeof data.name === "string" &&
      typeof data.lat === "number" &&
      typeof data.lon === "number"
    );
  }

  function toMillis(ts) {
    if (!ts) return null;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    return null;
  }

  function isStale(updatedAtMs) {
    if (!updatedAtMs) return true;
    return Date.now() - updatedAtMs > VIEW_STALE_MS;
  }

  function sanitizeName(raw) {
    return String(raw || "").trim().slice(0, 30);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.addEventListener("beforeunload", () => {
    if (unsubscribe) unsubscribe();
    if (writeTimer) clearInterval(writeTimer);
  });
})();
