(function () {
  const WRITE_INTERVAL_MS = 10 * 1000;
  const SIGNAL_STALE_MS = 20 * 1000;
  const SESSIONS_COLLECTION = "trackingSessions";

  const userListEl = document.getElementById("user-list");
  const statusEl = document.getElementById("connection-status");
  const displayNameEl = document.getElementById("display-name");
  const startBtn = document.getElementById("start-share");
  const panelMain = document.getElementById("panel-main");
  const panelInfo = document.getElementById("panel-info");
  const noticeDialog = document.getElementById("notice-dialog");
  const noticeMessage = document.getElementById("notice-dialog-message");
  const noticeConfirm = document.getElementById("notice-dialog-confirm");
  const noticeCancel = document.getElementById("notice-dialog-cancel");
  let noticeResolver = null;

  const togglePanelContent = () => {
    const showInfo = window.location.hash === "#infos";
    panelMain.hidden = showInfo;
    panelInfo.hidden = !showInfo;
  };
  togglePanelContent();
  window.addEventListener("hashchange", togglePanelContent);
  panelInfo.querySelector(".panel-info-close").addEventListener("click", (event) => {
    event.preventDefault();
    history.replaceState(null, "", window.location.pathname + window.location.search);
    panelMain.hidden = false;
    panelInfo.hidden = true;
  });

  noticeConfirm.addEventListener("click", () => closeNotice(true));
  noticeCancel.addEventListener("click", () => closeNotice(false));
  userListEl.addEventListener("click", centerOnListedUser);

  const map = L.map("map", { zoomControl: true }).setView([47.2672, 11.3928], 12);
  addPanelToggleControl();
  L.tileLayer("https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key={apiKey}", {
    minZoom: 1,
    maxZoom: 19,
    apiKey: "3e42a34cc017771733149a4097431ecd",
    attribution: '&copy; <a href="https://www.tracestrack.com/">Tracestrack</a>, &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  }).addTo(map);

  const gpxLayer = L.layerGroup().addTo(map);
  const tracksLayer = L.layerGroup().addTo(map);
  loadGpxOverlay();
  const tracksBySessionId = new Map();

  let sessionsUnsubscribe = null;
  let writeTimer = null;
  let activeSessionRef = null;
  let latestOwnPosition = null;
  let centerControlButton = null;

  addSessionCenterControl();

  const firebaseConfig = window.CHASER_FIREBASE_CONFIG || null;
  if (!firebaseConfig) {
    renderConnection(false, "offline");
    console.warn("CHASER_FIREBASE_CONFIG missing. Realtime sync disabled.");
    return;
  }

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const sessionsRef = db.collection(SESSIONS_COLLECTION);

  attachSessionsSubscription(sessionsRef);
  setInterval(renderTracksAndPanel, 5000);
  wireControls(sessionsRef);

  function wireControls(ref) {
    startBtn.addEventListener("click", async () => {
      if (activeSessionRef) {
        await stopTracking(ref);
        return;
      }

      const name = sanitizeName(displayNameEl.value);
      if (!name) {
        await showNotice("Please enter a display name.");
        return;
      }

      localStorage.setItem("chaser_display_name", name);

      try {
        const activeRefs = await findActiveAliasSessions(ref, name);
        if (!activeRefs.length) {
          beginWriting(await createAliasSession(ref, name));
          return;
        }

        const shouldResume = await showNotice(
          "Resume the trace for {alias} on this device/browser? Stop tracking removes it. It will be gone for good.",
          { alias: name, confirmLabel: "Resume", cancelLabel: "Stop tracking" }
        );
        if (shouldResume) {
          beginWriting(activeRefs[0]);
          return;
        }

        await endAliasSessions(activeRefs);
      } catch (err) {
        clearWriter();
        console.error("Failed to start tracking session:", err);
        renderConnection(false, "offline");
      }
    });
  }

  async function stopTracking(ref) {
    const name = sanitizeName(
      localStorage.getItem("chaser_display_name") || displayNameEl.value
    );
    if (!name) return;

    const confirmed = await showNotice(
      "Stop tracking {alias}? This trace will be gone for good.",
      { alias: name, confirmLabel: "Stop tracking", cancelLabel: "Cancel" }
    );
    if (!confirmed) return;

    clearWriter();

    try {
      const activeRefs = await findActiveAliasSessions(ref, name);
      await endAliasSessions(activeRefs);
    } catch (err) {
      console.error("Failed to stop tracking session:", err);
      renderConnection(false, "offline");
    }
  }

  function addPanelToggleControl() {
    const PanelToggleControl = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const button = L.DomUtil.create("a", "leaflet-control-button", container);
        button.href = "#";
        button.style.cssText = "width: 30px; height: 30px; line-height: 30px; text-align: center; font-size: 18px; display: block;";
        L.DomEvent.disableClickPropagation(button);

        const updateButton = () => {
          const hidden = document.body.classList.contains("panel-hidden");
          button.title = hidden ? "Show panel" : "Hide panel";
          button.setAttribute("aria-label", button.title);
          button.innerHTML = hidden ? "ⓘ" : "↖";
        };
        updateButton();
        L.DomEvent.on(button, "click", (event) => {
          L.DomEvent.stopPropagation(event);
          L.DomEvent.preventDefault(event);
          document.body.classList.toggle("panel-hidden");
          updateButton();
        });
        return container;
      }
    });

    new PanelToggleControl({ position: "topleft" }).addTo(map);
  }

  function addSessionCenterControl() {
    const SessionCenterControl = L.Control.extend({
      options: { position: "topleft" },

      onAdd() {
        const container = L.DomUtil.create(
          "div",
          "leaflet-bar session-center-control"
        );
        const button = L.DomUtil.create("a", "", container);

        button.href = "#";
        button.innerHTML = `
          <svg class="session-center-icon" viewBox="0 0 512 512" aria-hidden="true">
            <path d="M444.52 3.52 28.74 195.42c-47.97 22.39-31.98 92.75 19.19 92.75h175.91v175.91c0 51.17 70.36 67.17 92.75 19.19L508.49 67.49c15.99-38.39-25.59-79.97-63.97-63.97z"></path>
          </svg>`;
        button.setAttribute("role", "button");

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", L.DomEvent.stop)
          .on(button, "click", centerCurrentSession);

        centerControlButton = button;
        updateCenterControl();
        return container;
      }
    });

    new SessionCenterControl().addTo(map);
  }

  function centerCurrentSession() {
    if (!activeSessionRef || !latestOwnPosition) return;
    centerMapOnPosition(latestOwnPosition);
  }

  function updateCenterControl() {
    if (!centerControlButton) return;

    const sessionActive = Boolean(activeSessionRef);
    centerControlButton.classList.toggle("is-active", sessionActive);
    centerControlButton.classList.toggle("is-disabled", !sessionActive);
    centerControlButton.setAttribute("aria-disabled", String(!sessionActive));
    centerControlButton.title = sessionActive
      ? "Center on this session"
      : "Start sharing to center on this session";
  }

  function centerMapOnPosition(position) {
    centerMapOnLatLng(position.coords.latitude, position.coords.longitude);
  }

  function panelOffset() {
    const panel = document.getElementById("unified-panel").getBoundingClientRect();
    if (window.matchMedia("(orientation: portrait)").matches) {
      return L.point(0, panel.height / 2 + 96);
    }
    return L.point(panel.width / 2, 0);
  }

  function centerMapOnLatLng(lat, lon) {
    const zoom = 17;
    const center = map.unproject(map.project([lat, lon], zoom).add(panelOffset()), zoom);
    map.setView(center, zoom);
  }

  function centerOnListedUser(event) {
    const item = event.target.closest(".user-item[data-session-id]");
    if (!item) return;

    const track = tracksBySessionId.get(item.dataset.sessionId);
    const point = track && track.points[track.points.length - 1];
    if (!point) return;

    centerMapOnLatLng(point.lat, point.lon);
  }

  async function findActiveAliasSessions(ref, name) {
    const snapshot = await ref.where("name", "==", name).get();
    return snapshot.docs
      .filter((doc) => doc.data().isActive === true)
      .map((doc) => doc.ref);
  }

  async function createAliasSession(ref, name) {
    const sessionRef = ref.doc();
    await sessionRef.set({
      name,
      isActive: true,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endedAt: null
    });
    return sessionRef;
  }

  async function endAliasSessions(sessionRefs) {
    await Promise.all(sessionRefs.map((sessionRef) => sessionRef.update({
      isActive: false,
      endedAt: firebase.firestore.FieldValue.serverTimestamp()
    })));
  }

  function beginWriting(sessionRef) {
    latestOwnPosition = null;
    activeSessionRef = sessionRef;
    setWriterState(true);
    renderTracksAndPanel();
    sendOwnLocation(sessionRef, true);
    writeTimer = setInterval(
      () => sendOwnLocation(sessionRef),
      WRITE_INTERVAL_MS
    );
  }

  function clearWriter() {
    activeSessionRef = null;
    clearInterval(writeTimer);
    writeTimer = null;
    latestOwnPosition = null;
    setWriterState(false);
  }

  function setWriterState(active) {
    displayNameEl.disabled = active;
    displayNameEl.placeholder = active ? "Tracking.." : "...put your name/alias here!";
    displayNameEl.value = active
      ? ""
      : localStorage.getItem("chaser_display_name") || "";
    updateCenterControl();
  }

  function attachSessionsSubscription(ref) {
    sessionsUnsubscribe = ref
      .where("isActive", "==", true)
      .onSnapshot((snapshot) => {
        const seen = new Set();

        snapshot.forEach((doc) => {
          const data = doc.data();
          if (!isValidSessionRecord(doc.id, data)) return;

          seen.add(doc.id);
          ensureTrackSubscription(doc.ref, data);
        });

        tracksBySessionId.forEach((track, sessionId) => {
          if (!seen.has(sessionId)) removeTrack(sessionId);
        });

        renderTracksAndPanel();
        renderConnection(true, "online");
      }, (error) => {
        console.error("Firestore sessions subscription error:", error);
        renderConnection(false, "offline");
      });
  }

  function ensureTrackSubscription(sessionRef, session) {
    const existing = tracksBySessionId.get(sessionRef.id);
    if (existing) {
      existing.name = session.name;
      existing.color = colorForAlias(session.name);
      existing.startedAtMs = toMillis(session.startedAt);
      return;
    }

    const track = {
      sessionId: sessionRef.id,
      name: session.name,
      startedAtMs: toMillis(session.startedAt),
      color: colorForAlias(session.name),
      points: [],
      marker: null,
      line: null,
      unsubscribePoints: null
    };

    tracksBySessionId.set(sessionRef.id, track);
    track.unsubscribePoints = sessionRef
      .collection("points")
      .orderBy("recordedAt", "asc")
      .onSnapshot((snapshot) => {
        track.points = snapshot.docs
          .map((doc) => pointFromDocument(doc))
          .filter(Boolean);
        renderTracksAndPanel();
      }, (error) => {
        console.error(`Firestore points subscription error for ${sessionRef.id}:`, error);
        renderConnection(false, "offline");
      });
  }

  function renderTracksAndPanel() {
    const tracks = [...tracksBySessionId.values()]
      .sort((a, b) => a.name.localeCompare(b.name));

    tracks.forEach(renderTrack);
    renderUserList(tracks);
  }

  function renderTrack(track) {
    if (!track.points.length) return;

    const latestPoint = track.points[track.points.length - 1];
    const latLngs = track.points.map((point) => [point.lat, point.lon]);
    const lineStyle = {
      color: track.color,
      weight: 2,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };

    if (!track.line) {
      track.line = L.polyline(latLngs, lineStyle).addTo(tracksLayer);
    } else {
      track.line.setLatLngs(latLngs);
      track.line.setStyle(lineStyle);
    }

    upsertMarker(track, latestPoint);
  }

  function upsertMarker(track, point) {
    const icon = L.divIcon({
      className: "chaser-marker-icon",
      html: `<span class="chaser-user-marker" style="background:${track.color}"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const ageSec = point.recordedAtMs
      ? Math.max(0, Math.round((Date.now() - point.recordedAtMs) / 1000))
      : null;
    const popup = [
      `<strong>${escapeHtml(track.name)}</strong>`,
      `Points: ${track.points.length}`,
      `Accuracy: ${Math.round(point.accuracy)} m`,
      ageSec === null ? "Age: n/a" : `Age: ${ageSec}s`
    ].join("<br>");

    if (!track.marker) {
      track.marker = L.marker([point.lat, point.lon], { icon }).addTo(tracksLayer);
      track.marker.bindPopup(popup);
      return;
    }

    track.marker.setLatLng([point.lat, point.lon]);
    track.marker.setIcon(icon);
    track.marker.setPopupContent(popup);
  }

  function removeTrack(sessionId) {
    const track = tracksBySessionId.get(sessionId);
    if (!track) return;

    if (track.unsubscribePoints) track.unsubscribePoints();
    if (track.marker) tracksLayer.removeLayer(track.marker);
    if (track.line) tracksLayer.removeLayer(track.line);
    tracksBySessionId.delete(sessionId);
  }

  let userListSignature = "";

  function signalStaleFor(track) {
    if (activeSessionRef && track.sessionId === activeSessionRef.id) return false;
    if (track.points.some((point) => point.recordedAtMs == null)) return false;

    const latestPoint = track.points[track.points.length - 1];
    const signalAtMs = latestPoint ? latestPoint.recordedAtMs : track.startedAtMs;
    return Boolean(signalAtMs) && Date.now() - signalAtMs > SIGNAL_STALE_MS;
  }

  function renderUserList(tracks) {
    if (!tracks.length) {
      if (userListSignature !== "empty") {
        userListEl.innerHTML = "<li class='user-item'><div class='user-item-meta'>No active users</div></li>";
        userListSignature = "empty";
      }
      return;
    }

    const rows = tracks.map((track) => {
      const updatedAtMs = latestResolvedSignalMs(track);
      const pointLabel = track.points.length === 1 ? "point" : "points";
      const signalStale = signalStaleFor(track);

      return {
        track,
        signalStale,
        meta: `last timestamp: ${formatClock(updatedAtMs, true)} · start time: ${formatClock(track.startedAtMs, false)} · ${track.points.length} ${pointLabel}`
      };
    });
    const signature = rows
      .map((row) => `${row.track.sessionId}:${row.signalStale}:${row.track.points.length}:${row.track.name}`)
      .join("|");

    if (signature !== userListSignature) {
      userListEl.innerHTML = rows.map((row) => {
        const sessionAttribute = row.track.points.length
          ? ` data-session-id="${escapeHtml(row.track.sessionId)}"`
          : "";
        const warning = row.signalStale
          ? `<div class="user-item-stale">Tracking was interrupted! Resume or stop tracing using your alias!</div>`
          : "";

        return `
          <li class="user-item" data-track-id="${escapeHtml(row.track.sessionId)}"${sessionAttribute} style="border-left-color:${row.track.color}">
            <div class="user-item-name">${escapeHtml(row.track.name)}</div>
            ${warning}
            <div class="user-item-meta">${row.meta}</div>
          </li>`;
      }).join("");
      userListSignature = signature;
      return;
    }

    rows.forEach((row) => {
      const meta = userListEl.querySelector(
        `[data-track-id="${CSS.escape(row.track.sessionId)}"] .user-item-meta`
      );
      if (meta) meta.textContent = row.meta;
    });
  }

  function formatClock(ms, withSeconds) {
    if (!ms) return "n/a";
    const date = new Date(ms);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    if (!withSeconds) return `${hours}:${minutes}`;
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  function latestResolvedSignalMs(track) {
    for (let index = track.points.length - 1; index >= 0; index -= 1) {
      if (track.points[index].recordedAtMs != null) return track.points[index].recordedAtMs;
    }
    return track.startedAtMs || null;
  }

  function frameGpx(bounds) {
    map.fitBounds(bounds, { padding: [24, 24], animate: false });
    map.panBy(panelOffset(), { animate: false });
    map.setZoom(map.getZoom() - 1, { animate: false });
  }

  function loadGpxOverlay() {
    const gpxNs = "http://www.topografix.com/GPX/1/1";
    fetch(encodeURI("gpx_tracks/El Camino de la Paz 2026.gpx"))
      .then((response) => {
        if (!response.ok) throw new Error(`GPX request failed: ${response.status}`);
        return response.text();
      })
      .then((xmlText) => {
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        if (doc.querySelector("parsererror")) throw new Error("GPX parse failed");

        const latLngs = [...doc.getElementsByTagNameNS(gpxNs, "trkpt")].map((point) => [
          Number(point.getAttribute("lat")),
          Number(point.getAttribute("lon"))
        ]);
        L.polyline(latLngs, {
          color: "#fff",
          weight: 7.5,
          opacity: 0.35,
          interactive: false
        }).addTo(gpxLayer);
        const line = L.polyline(latLngs, {
          color: "#960018",
          weight: 2.5,
          opacity: 0.9,
          dashArray: "4, 4",
          interactive: false
        }).addTo(gpxLayer);
        frameGpx(line.getBounds());
      })
      .catch((err) => {
        console.error("Failed to load GPX overlay:", err);
      });
  }

  function sendOwnLocation(sessionRef, centerMap = false) {
    if (!navigator.geolocation) {
      console.warn("Geolocation unsupported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      if (sessionRef !== activeSessionRef) return;

      latestOwnPosition = position;
      if (centerMap) centerMapOnPosition(position);

      try {
        await sessionRef.collection("points").add({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
          recordedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to write tracking point:", err);
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

  function pointFromDocument(doc) {
    const data = doc.data();
    if (
      typeof data.lat !== "number" ||
      typeof data.lon !== "number" ||
      typeof data.accuracy !== "number"
    ) {
      return null;
    }

    return {
      pointId: doc.id,
      lat: data.lat,
      lon: data.lon,
      accuracy: data.accuracy,
      recordedAtMs: toMillis(data.recordedAt)
    };
  }

  const TRACE_COLORS = [
    "#ffe500",
    "#00e5ff",
    "#ff4dff",
    "#7cff3f",
    "#4c7dff",
    "#ff7a00",
    "#ff4d6a",
    "#c8a2ff",
    "#00f0a8",
    "#e8ff4d",
    "#ff9ec8",
    "#9af6ff"
  ];

  function colorForAlias(name) {
    let hash = 2166136261;
    const value = String(name);

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return TRACE_COLORS[(hash >>> 0) % TRACE_COLORS.length];
  }

  function showNotice(message, options = {}) {
    if (noticeResolver) closeNotice(false);

    noticeMessage.replaceChildren();
    if (options.alias) {
      const [before, after = ""] = message.split("{alias}");
      const alias = document.createElement("span");
      alias.className = "notice-alias";
      alias.style.color = colorForAlias(options.alias);
      alias.textContent = options.alias;
      noticeMessage.append(before, alias, after);
    } else {
      noticeMessage.textContent = message;
    }
    noticeConfirm.textContent = options.confirmLabel || "OK";
    noticeCancel.hidden = !options.cancelLabel;
    if (options.cancelLabel) noticeCancel.textContent = options.cancelLabel;
    noticeConfirm.classList.toggle("is-danger", noticeConfirm.textContent === "Stop tracking");
    noticeCancel.classList.toggle("is-danger", !noticeCancel.hidden && noticeCancel.textContent === "Stop tracking");
    noticeDialog.hidden = false;
    noticeConfirm.focus();

    return new Promise((resolve) => {
      noticeResolver = resolve;
    });
  }

  function closeNotice(confirmed) {
    noticeDialog.hidden = true;
    const resolve = noticeResolver;
    noticeResolver = null;
    if (resolve) resolve(confirmed);
  }

  function renderConnection(connected, text) {
    statusEl.textContent = text;
    statusEl.classList.toggle("status-online", connected);
    statusEl.classList.toggle("status-offline", !connected);
  }

  function isValidSessionRecord(sessionId, data) {
    return Boolean(
      sessionId &&
      data &&
      typeof data.name === "string" &&
      data.isActive === true
    );
  }

  function toMillis(timestamp) {
    if (!timestamp) return null;
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (typeof timestamp === "number") return timestamp;
    return null;
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
    if (sessionsUnsubscribe) sessionsUnsubscribe();
    tracksBySessionId.forEach((track) => {
      if (track.unsubscribePoints) track.unsubscribePoints();
    });
    if (writeTimer) clearInterval(writeTimer);
  });
})();
