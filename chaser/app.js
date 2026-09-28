(function () {
  // Lowest zoom the map allows.
  const ZOOM_MIN = 10;
  // Below this: one solid white outer line, solid dark-grey inner line, short course labels.
  const ZOOM_COURSE = 14;
  // Above this: the main title stem grows to its longest.
  const ZOOM_TITLE = 15;
  // Below this: alias labels on live traces shrink.
  const ZOOM_ALIAS = 14;

  const WRITE_INTERVAL_MS = 5 * 1000;
  const SIGNAL_STALE_MS = 5 * 1000;
  const SESSIONS_COLLECTION = "trackingSessions";

  const userListEl = document.getElementById("user-list");
  const statusEl = document.getElementById("connection-status");
  const gpsStatusEl = document.getElementById("gps-status");
  const stopBtn = document.getElementById("stop-tracking");
  const panelMain = document.getElementById("panel-main");
  const panelInfo = document.getElementById("panel-info");
  const noticeDialog = document.getElementById("notice-dialog");
  const noticeMessage = document.getElementById("notice-dialog-message");
  const noticeConfirm = document.getElementById("notice-dialog-confirm");
  const noticeCancel = document.getElementById("notice-dialog-cancel");
  const entryDialog = document.getElementById("entry-dialog");
  const riderDialog = document.getElementById("rider-dialog");
  const riderForm = document.getElementById("rider-form");
  const riderNameEl = document.getElementById("rider-name");
  const riderLog = document.getElementById("rider-log");
  const riderTitle = document.getElementById("rider-dialog-title");
  const riderPanelTitle = document.getElementById("rider-panel-title");
  const riderActions = document.getElementById("rider-actions");
  const riderStart = document.getElementById("rider-start");
  const entryRider = document.getElementById("entry-rider");
  const ENTRY_FEEDBACK_MS = 3000;
  let riderCloseTimer = null;
  const routeList = document.getElementById("route-list");
  let noticeResolver = null;
  let selectedRouteId = null;
  let drawnRouteId = null;
  const routesById = new Map();
  let routeListSignature = "";
  const GPX_MAX_BYTES = 1024 * 1024 - 2048;

  function isAdminMode() {
    const raw = window.location.hash.slice(1);
    return raw === "admin" || raw.endsWith("#admin");
  }

  function stripHashSuffixes(raw) {
    if (raw.endsWith("#admin")) raw = raw.slice(0, -"#admin".length);
    if (raw === "viewing" || raw.endsWith("#viewing")) {
      raw = raw === "viewing" ? "" : raw.slice(0, -"#viewing".length);
    }
    if (raw === "tracking" || raw.endsWith("#tracking")) {
      raw = raw === "tracking" ? "" : raw.slice(0, -"#tracking".length);
    }
    return raw;
  }

  function modeFromHash() {
    let raw = window.location.hash.slice(1);
    if (raw.endsWith("#admin")) raw = raw.slice(0, -"#admin".length);
    if (raw === "viewing" || raw.endsWith("#viewing")) return "viewing";
    if (raw === "tracking" || raw.endsWith("#tracking")) return "tracking";
    return null;
  }

  function routeIdFromHash() {
    const raw = stripHashSuffixes(window.location.hash.slice(1));
    if (!raw || raw === "infos" || raw === "admin") return null;
    return decodeURIComponent(raw);
  }

  function writePageUrl(hash) {
    const center = map.getCenter();
    const params = new URLSearchParams();
    params.set("lat", center.lat.toFixed(5));
    params.set("lng", center.lng.toFixed(5));
    params.set("z", String(map.getZoom()));
    let fragment = hash == null ? window.location.hash.slice(1) : String(hash || "");
    if (hash != null && fragment !== "infos") {
      fragment = stripHashSuffixes(fragment);
      if (pageMode) fragment = fragment ? `${fragment}#${pageMode}` : pageMode;
      if (isAdminMode()) fragment = fragment ? `${fragment}#admin` : "admin";
    }
    const nextHash = fragment ? `#${fragment}` : "";
    history.replaceState(null, "", `${window.location.pathname}?${params}${nextHash}`);
    routeInHash = routeIdFromHash();
  }

  function writeRouteHash(id) {
    writePageUrl(id || "");
  }

  let routeInHash = routeIdFromHash();
  let pageMode = modeFromHash();

  function setPageMode(mode) {
    pageMode = mode;
    writeRouteHash(routeIdFromHash());
  }

  const togglePanelContent = () => {
    const showInfo = window.location.hash === "#infos";
    panelMain.hidden = showInfo;
    panelInfo.hidden = !showInfo;
  };
  togglePanelContent();
  window.addEventListener("hashchange", () => {
    togglePanelContent();
    const previousRoute = routeInHash;
    pageMode = modeFromHash();
    if (window.location.hash === "#admin" && previousRoute) writeRouteHash(previousRoute);
    else routeInHash = routeIdFromHash();
    if (pageMode === "viewing" && !activeSessionRef) {
      document.body.classList.add("is-viewer");
      entryDialog.hidden = true;
    } else if (pageMode === "tracking" && !activeSessionRef && riderDialog.hidden) {
      entryDialog.hidden = true;
      openRiderBox();
    }
    renderRouteList();
    const id = routeIdFromHash();
    if (id) selectRoute(id, { frame: !parseMapView() });
  });
  panelInfo.querySelector(".panel-info-close").addEventListener("click", (event) => {
    event.preventDefault();
    writeRouteHash(selectedRouteId);
    panelMain.hidden = false;
    panelInfo.hidden = true;
  });

  noticeConfirm.addEventListener("click", () => closeNotice(true));
  noticeCancel.addEventListener("click", () => closeNotice(false));
  userListEl.addEventListener("click", centerOnListedUser);

  const initialView = parseMapView();
  const map = L.map("map", { zoomControl: true, minZoom: ZOOM_MIN }).setView(
    initialView ? [initialView.lat, initialView.lng] : [47.2672, 11.3928],
    initialView ? initialView.zoom : 12
  );
  wirePanelFade();
  map.on("zoomend", syncLabelZoom);
  map.on("moveend", scheduleUrlSync);
  writeMapUrl();
  syncLabelZoom();
  L.tileLayer("https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key={apiKey}", {
    minZoom: 1,
    maxZoom: 19,
    apiKey: "3e42a34cc017771733149a4097431ecd",
    attribution: '&copy; <a href="https://www.tracestrack.com/">Tracestrack</a>, &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  }).addTo(map);

  const gpxLayer = L.layerGroup().addTo(map);
  const tracksLayer = L.layerGroup().addTo(map);
  renderRouteList();
  routeList.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".route-delete");
    if (deleteBtn) {
      deleteRoute(deleteBtn.dataset.routeId);
      return;
    }
    const item = event.target.closest("[data-route-id]");
    if (!item) return;
    selectRoute(item.dataset.routeId, { frame: true, force: true });
  });
  const tracksBySessionId = new Map();

  let sessionsUnsubscribe = null;
  let routesUnsubscribe = null;
  let writeTimer = null;
  let activeSessionRef = null;
  let latestOwnPosition = null;
  let locationRequest = null;
  let gpsAllowed = null;
  let gpsRunning = false;
  let centerControlButton = null;
  let urlSyncTimer = null;
  let db = null;
  let sessionsRef = null;

  addGpxLoadControl();
  addSessionCenterControl();
  watchGpsPermission();
  renderGpsStatus();
  applyInitialMode();
  wireEntryGate();

  const firebaseConfig = window.CHASER_FIREBASE_CONFIG || null;
  if (!firebaseConfig) {
    renderConnection(false, "offline");
    console.warn("CHASER_FIREBASE_CONFIG missing. Realtime sync disabled.");
    return;
  }

  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  sessionsRef = db.collection(SESSIONS_COLLECTION);

  attachSessionsSubscription(sessionsRef);
  attachRoutesSubscription(db);
  setInterval(() => renderUserList(sortedTracks()), 5000);
  wireControls(sessionsRef);

  function wireEntryGate() {
    document.getElementById("entry-viewer").addEventListener("click", () => {
      entryDialog.hidden = true;
      document.body.classList.add("is-viewer");
      setPageMode("viewing");
    });
    entryRider.addEventListener("click", () => {
      entryDialog.hidden = true;
      openRiderBox();
    });
    document.getElementById("viewer-ride").addEventListener("click", () => {
      openRiderBox();
    });
    riderForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = sanitizeName(riderNameEl.value);
      if (!name) {
        riderLog.hidden = true;
        riderNameEl.focus();
        return;
      }
      if (!sessionsRef) {
        riderLog.textContent = "Firebase is not configured.";
        riderLog.hidden = false;
        return;
      }
      riderStart.classList.add("is-fading");
      riderStart.addEventListener("transitionend", function hideStart(event) {
        if (event.propertyName !== "opacity") return;
        riderStart.removeEventListener("transitionend", hideStart);
        if (riderStart.classList.contains("is-fading")) riderActions.hidden = true;
      });
      requestDeviceLocation();
      beginAliasTracking(sessionsRef, name);
    });
  }

  function resetRiderForm() {
    riderNameEl.disabled = false;
    riderNameEl.hidden = false;
    riderTitle.hidden = false;
    riderLog.hidden = true;
    riderLog.textContent = "";
    riderStart.classList.remove("is-fading");
    riderActions.hidden = false;
    riderForm.classList.remove("is-result");
    riderForm.style.minHeight = "";
    riderDialog.classList.remove("is-fading");
    riderForm.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
  }

  function openRiderBox() {
    clearTimeout(riderCloseTimer);
    resetRiderForm();
    riderNameEl.value = localStorage.getItem("chaser_display_name") || "";
    riderDialog.hidden = false;
    riderNameEl.focus();
  }

  function setRiderPanelTitle(name) {
    riderPanelTitle.replaceChildren("Rider ", aliasNode(name));
  }

  function showRiderResult(name, after) {
    riderForm.style.minHeight = "";
    riderForm.classList.add("is-result");
    riderTitle.hidden = true;
    riderNameEl.hidden = true;
    riderActions.hidden = true;
    riderLog.replaceChildren("Rider ", aliasNode(name), after);
    riderLog.hidden = false;
  }

  function fadeRiderBox(done) {
    riderDialog.classList.add("is-fading");
    riderDialog.addEventListener("transitionend", function onFade(event) {
      if (event.target !== riderDialog || event.propertyName !== "opacity") return;
      riderDialog.removeEventListener("transitionend", onFade);
      if (!riderDialog.classList.contains("is-fading")) return;
      riderDialog.hidden = true;
      riderDialog.classList.remove("is-fading");
      if (done) done();
      else {
        document.body.classList.remove("is-viewer");
        setPageMode("tracking");
      }
    });
  }

  function showStoppedNotice() {
    document.body.classList.add("is-viewer");
    resetRiderForm();
    riderTitle.hidden = true;
    riderNameEl.hidden = true;
    riderActions.hidden = true;
    riderForm.classList.add("is-result");
    riderLog.textContent = "Tracing stopped! Switching to Viewer Mode.";
    riderLog.hidden = false;
    riderDialog.hidden = false;
    setPageMode("viewing");
    clearTimeout(riderCloseTimer);
    riderCloseTimer = setTimeout(() => fadeRiderBox(() => {
      entryDialog.hidden = true;
    }), ENTRY_FEEDBACK_MS);
  }

  function showEntryGate() {
    clearTimeout(riderCloseTimer);
    document.body.classList.add("is-viewer");
    riderDialog.classList.remove("is-fading");
    riderDialog.hidden = true;
    entryDialog.hidden = false;
  }

  function applyInitialMode() {
    if (pageMode === "viewing") {
      document.body.classList.add("is-viewer");
      entryDialog.hidden = true;
      riderDialog.hidden = true;
      return;
    }
    if (pageMode === "tracking") {
      document.body.classList.add("is-viewer");
      entryDialog.hidden = true;
      openRiderBox();
      return;
    }
    showEntryGate();
  }

  function wireControls(ref) {
    stopBtn.addEventListener("click", () => {
      if (activeSessionRef) stopTracking(ref);
    });
  }

  async function beginAliasTracking(ref, name) {
    localStorage.setItem("chaser_display_name", name);
    setRiderPanelTitle(name);
    riderNameEl.disabled = true;
    riderForm.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      const activeRefs = await findActiveAliasSessions(ref, name);
      if (!activeRefs.length) {
        const sessionRef = await createAliasSession(ref, name);
        showRiderResult(name, " is starting his ride!");
        beginWriting(sessionRef);
      } else {
        showRiderResult(name, " is resuming his trace");
        beginWriting(activeRefs[0]);
      }
      clearTimeout(riderCloseTimer);
      riderCloseTimer = setTimeout(fadeRiderBox, ENTRY_FEEDBACK_MS);
    } catch (err) {
      clearWriter();
      console.error("Failed to start tracking session:", err);
      renderConnection(false, "offline");
      resetRiderForm();
      riderLog.textContent = "Could not start tracking.";
      riderLog.hidden = false;
    }
  }

  async function stopTracking(ref) {
    const name = sanitizeName(localStorage.getItem("chaser_display_name"));
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

    showStoppedNotice();
  }

  function syncLabelZoom() {
    const zoom = map.getZoom();
    document.body.classList.toggle("map-zoom-low", zoom < ZOOM_ALIAS);
    document.body.classList.toggle("map-zoom-course", zoom < ZOOM_COURSE);
    document.body.classList.toggle("map-zoom-title", zoom > ZOOM_TITLE);
  }

  function wirePanelFade() {
    const launcher = document.getElementById("panel-launcher");

    map.getContainer().addEventListener("click", (event) => {
      if (event.target.closest(".leaflet-control")) return;
      document.body.classList.add("panel-faded");
    }, true);

    launcher.addEventListener("click", () => {
      document.body.classList.remove("panel-faded");
    });
  }

  function addBarButton(className) {
    let button = null;
    const BarButton = L.Control.extend({
      options: { position: "topleft" },

      onAdd() {
        const container = L.DomUtil.create("div", `leaflet-bar ${className}`);
        button = L.DomUtil.create("a", "", container);
        button.href = "#";
        button.setAttribute("role", "button");
        L.DomEvent.disableClickPropagation(container);
        return container;
      }
    });
    new BarButton().addTo(map);
    return button;
  }

  function addSessionCenterControl() {
    const button = addBarButton("session-center-control");

    button.classList.add("session-center-btn");
    button.title = "Center map to GPS";
    button.innerHTML = '<svg class="session-center-icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M444.52 3.52 28.74 195.42c-47.97 22.39-31.98 92.75 19.19 92.75h175.91v175.91c0 51.17 70.36 67.17 92.75 19.19L508.49 67.49c15.99-38.39-25.59-79.97-63.97-63.97z"></path></svg>';

    L.DomEvent.on(button, "click", L.DomEvent.stop)
      .on(button, "click", centerCurrentSession);

    centerControlButton = button;
    updateCenterControl();
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
    centerControlButton.title = "Center map to GPS";
  }

  function centerMapOnPosition(position) {
    centerMapOnLatLng(position.coords.latitude, position.coords.longitude);
  }

  function panelOffset() {
    const faded = document.body.classList.contains("panel-faded");
    const panel = document.getElementById(faded ? "panel-launcher" : "unified-panel").getBoundingClientRect();
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
    const key = aliasKey(name);
    const snapshot = await ref.where("isActive", "==", true).get();
    return snapshot.docs
      .filter((doc) => aliasKey(doc.data().name) === key)
      .sort((a, b) => (toMillis(a.data().startedAt) || 0) - (toMillis(b.data().startedAt) || 0))
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

    const requested = locationRequest;
    locationRequest = null;
    writeTimer = setInterval(
      () => sendOwnLocation(sessionRef),
      WRITE_INTERVAL_MS
    );

    return Promise.resolve(requested).then((position) => {
      if (sessionRef !== activeSessionRef) return;
      if (position) return writePoint(sessionRef, position, true);
      sendOwnLocation(sessionRef, true);
    });
  }

  function clearWriter() {
    activeSessionRef = null;
    clearInterval(writeTimer);
    writeTimer = null;
    latestOwnPosition = null;
    setWriterState(false);
  }

  function setWriterState(active) {
    gpsRunning = active;
    renderGpsStatus();
    stopBtn.hidden = !active;
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
      accuracyRing: null,
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

  function sortedTracks() {
    return [...tracksBySessionId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderTracksAndPanel() {
    const tracks = sortedTracks();
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

    upsertAccuracyRing(track, latestPoint);
    upsertMarker(track, latestPoint);
  }

  function upsertAccuracyRing(track, point) {
    const style = {
      color: track.color,
      weight: 2,
      opacity: 1,
      dashArray: "6 4",
      fill: false,
      interactive: false,
      className: "chaser-accuracy-ring"
    };

    if (!track.accuracyRing) {
      track.accuracyRing = L.circle([point.lat, point.lon], {
        radius: point.accuracy,
        ...style
      }).addTo(tracksLayer);
      return;
    }

    track.accuracyRing.setLatLng([point.lat, point.lon]);
    track.accuracyRing.setRadius(point.accuracy);
    track.accuracyRing.setStyle(style);
  }

  function upsertMarker(track, point) {
    const icon = L.divIcon({
      className: "chaser-marker-icon",
      html: `<span class="chaser-callout">
        <span class="chaser-callout-label" style="color:${track.color}">${escapeHtml(track.name)}</span>
        <span class="chaser-callout-stem"></span>
        <span class="chaser-user-marker" style="background:${track.color}"></span>
      </span>`,
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
      ageSec === null ? "Time since last pt.: n/a" : `Time since last pt.: ${ageSec}s`
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
    if (track.accuracyRing) tracksLayer.removeLayer(track.accuracyRing);
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
        userListEl.innerHTML = "<li class='user-item'><div class='user-item-meta'>No active riders</div></li>";
        userListSignature = "empty";
      }
      return;
    }

    const ordered = [...tracks].sort((a, b) => {
      const aOwn = activeSessionRef && a.sessionId === activeSessionRef.id;
      const bOwn = activeSessionRef && b.sessionId === activeSessionRef.id;
      if (aOwn !== bOwn) return aOwn ? -1 : 1;
      return 0;
    });

    const rows = ordered.map((track) => {
      const updatedAtMs = latestResolvedSignalMs(track);
      const pointLabel = track.points.length === 1 ? "point" : "points";
      const signalStale = signalStaleFor(track);

      return {
        track,
        signalStale,
        own: Boolean(activeSessionRef && track.sessionId === activeSessionRef.id),
        meta: `last timestamp: ${formatClock(updatedAtMs, true)} · start time: ${formatClock(track.startedAtMs, false)} · ${track.points.length} ${pointLabel}`
      };
    });
    const signature = rows
      .map((row) => `${row.track.sessionId}:${row.own}:${row.signalStale}:${row.track.points.length}:${row.track.name}`)
      .join("|");

    if (signature !== userListSignature) {
      userListEl.innerHTML = rows.map((row) => {
        const sessionAttribute = row.track.points.length
          ? ` data-session-id="${escapeHtml(row.track.sessionId)}"`
          : "";
        const warning = row.signalStale
          ? `<div class="user-item-stale">Tracking paused.</div>`
          : "";

      return `
          <li class="user-item${row.own ? " is-tracking" : ""}" data-track-id="${escapeHtml(row.track.sessionId)}"${sessionAttribute} style="border-left-color:${row.track.color}">
            <div class="user-item-name notice-alias" style="color:${row.track.color}">${escapeHtml(row.track.name)}</div>
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

  function parseMapView() {
    const params = new URLSearchParams(window.location.search);
    const latRaw = params.get("lat");
    const lngRaw = params.get("lng");
    const zoomRaw = params.get("z");
    if (latRaw == null || lngRaw == null || zoomRaw == null) return null;
    if (latRaw === "" || lngRaw === "" || zoomRaw === "") return null;
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const zoom = Number(zoomRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng, zoom };
  }

  function writeMapUrl() {
    writePageUrl(null);
  }

  function scheduleUrlSync() {
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(writeMapUrl, 300);
  }

  function haversineMeters(a, b) {
    const earth = 6371000;
    const toRad = (degrees) => degrees * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * earth * Math.asin(Math.sqrt(h));
  }

  function pointAtDistance(latLngs, targetMeters) {
    let walked = 0;
    for (let index = 1; index < latLngs.length; index += 1) {
      const step = haversineMeters(latLngs[index - 1], latLngs[index]);
      if (walked + step >= targetMeters) {
        const t = step === 0 ? 0 : (targetMeters - walked) / step;
        return [
          latLngs[index - 1][0] + (latLngs[index][0] - latLngs[index - 1][0]) * t,
          latLngs[index - 1][1] + (latLngs[index][1] - latLngs[index - 1][1]) * t
        ];
      }
      walked += step;
    }
    return latLngs[latLngs.length - 1];
  }

  function courseDistance(latLngs) {
    let walked = 0;
    for (let index = 1; index < latLngs.length; index += 1) {
      walked += haversineMeters(latLngs[index - 1], latLngs[index]);
    }
    return walked;
  }

  function addCoursePin(latLng, label, dotColor) {
    const dot = dotColor
      ? `<span class="course-callout-dot" style="background:${dotColor}"></span>`
      : "";
    const icon = L.divIcon({
      className: "course-marker-icon",
      html: `<span class="course-callout">
        <span class="course-callout-label course-km-label">${label}</span>
        <span class="course-callout-stem"></span>
        ${dot}
      </span>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5]
    });
    L.marker(latLng, { icon, interactive: false, keyboard: false }).addTo(gpxLayer);
  }

  function addCourseMarkers(latLngs, trackName) {
    const total = courseDistance(latLngs);
    addCoursePin(latLngs[0], "Start", cssColor("--color-course-start"));
    addCoursePin(latLngs[latLngs.length - 1], "Finish", cssColor("--color-course-finish"));
    for (let km = 10; km * 1000 < total; km += 10) {
      addCoursePin(pointAtDistance(latLngs, km * 1000), `${km} km`);
    }

    const icon = L.divIcon({
      className: "course-title-icon",
      html: `<span class="course-callout course-callout-title">
        <span class="course-callout-label course-title">${escapeHtml(trackName)}</span>
        <span class="course-callout-stem"></span>
      </span>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5]
    });
    L.marker(pointAtDistance(latLngs, total / 2), {
      icon,
      interactive: false,
      keyboard: false
    }).addTo(gpxLayer);
  }

  function drawCourse(course, frame) {
    gpxLayer.clearLayers();
    const highlight = {
      uphill: cssColor("--color-grade-uphill"),
      flat: cssColor("--color-grade-flat")
    };
    splitTrackByGrade(course.points).forEach((portion) => {
      L.polyline(portion.latLngs, {
        className: "course-grade",
        color: highlight[portion.kind],
        weight: 7.5,
        opacity: 0.85,
        lineCap: "butt",
        interactive: false
      }).addTo(gpxLayer);
    });
    const latLngs = course.points.map((point) => [point.lat, point.lon]);
    const line = L.polyline(latLngs, {
      className: "course-line",
      color: cssColor("--color-course"),
      weight: 2.5,
      opacity: 0.9,
      dashArray: "4, 4",
      lineCap: "butt",
      interactive: false
    }).addTo(gpxLayer);
    if (frame) frameGpx(line.getBounds());
    addCourseMarkers(latLngs, course.name);
  }

  function capLetters(text, max) {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
  }

  function renderRouteList() {
    const routes = [...routesById.values()].sort((a, b) => a.name.localeCompare(b.name));
    const signature = [
      isAdminMode() ? "admin" : "view",
      ...routes.map((route) => `${route.id}\t${route.name}`)
    ].join("\n");

    if (signature !== routeListSignature) {
      const scrollTop = routeList.scrollTop;
      routeListSignature = signature;
      routeList.replaceChildren();
      if (!routes.length) {
        const empty = document.createElement("li");
        empty.className = "route-empty";
        empty.textContent = "no routes yet - upload one";
        routeList.append(empty);
      } else {
        routes.forEach((route) => {
          const item = document.createElement("li");
          item.className = "route-row";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "route-item";
          button.dataset.routeId = route.id;
          button.textContent = capLetters(route.name, 25);
          button.title = route.name;
          item.append(button);
          if (isAdminMode()) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "route-delete";
            del.dataset.routeId = route.id;
            del.title = "Delete route";
            del.textContent = "Del";
            item.append(del);
          }
          routeList.append(item);
        });
      }
      routeList.scrollTop = scrollTop;
    }

    routeList.querySelectorAll(".route-item").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.routeId === selectedRouteId);
    });
  }

  async function deleteRoute(id) {
    const route = routesById.get(id);
    if (!route || !db || !isAdminMode()) return;
    const confirmed = await showNotice(`Delete route: ${route.name}?`, {
      confirmLabel: "Delete",
      cancelLabel: "Cancel"
    });
    if (!confirmed) return;

    try {
      await db.collection("routes").doc(id).delete();
    } catch (err) {
      console.error("Failed to delete route:", err);
      await showNotice("Route could not be deleted.");
      return;
    }

    if (selectedRouteId === id) {
      gpxLayer.clearLayers();
      selectedRouteId = null;
      drawnRouteId = null;
    }
    renderRouteList();
  }

  function attachRoutesSubscription(firestore) {
    let reportedMissingRouteId = "";
    routesUnsubscribe = firestore.collection("routes").onSnapshot((snapshot) => {
      routesById.clear();
      snapshot.forEach((doc) => {
        if (doc.id === "counter") return;
        const data = doc.data();
        if (typeof data.name !== "string" || !data.name) return;
        routesById.set(doc.id, { id: doc.id, name: data.name });
      });
      renderRouteList();
      const id = routeIdFromHash();
      if (!id) return;
      if (!routesById.has(id)) {
        if (reportedMissingRouteId !== id) {
          reportedMissingRouteId = id;
          showNotice("That route is not in the list.");
        }
        return;
      }
      reportedMissingRouteId = "";
      if (drawnRouteId !== id) selectRoute(id, { frame: !parseMapView() });
    }, (error) => {
      console.error("Firestore routes subscription error:", error);
    });
  }

  async function selectRoute(id, options) {
    const route = routesById.get(id);
    if (!route || !db) return;
    selectedRouteId = id;
    writeRouteHash(id);
    renderRouteList();
    if (drawnRouteId === id && !options.force) return;

    try {
      const snap = await db.collection("routes").doc(id).get();
      const gpx = snap.exists ? snap.data().gpx : "";
      if (typeof gpx !== "string" || !gpx) {
        await showNotice("GPX could not be loaded.");
        return;
      }
      const parsed = parseGpx(gpx);
      if (parsed.error) {
        await showNotice(parsed.error);
        return;
      }
      drawCourse(parsed, options.frame);
      drawnRouteId = id;
    } catch (err) {
      console.error("Failed to load route GPX:", err);
      await showNotice("GPX could not be loaded.");
    }
  }

  function readGpxFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function uploadGpxFile(file) {
    if (!db) {
      await showNotice("Firebase is not configured.");
      return;
    }
    let xmlText = "";
    try {
      xmlText = await readGpxFile(file);
    } catch (err) {
      console.error("Failed to read GPX file:", err);
      await showNotice("GPX could not be read.");
      return;
    }

    const parsed = parseGpx(xmlText);
    if (parsed.error) {
      await showNotice(parsed.error);
      return;
    }
    const fileName = file.name.replace(/\.gpx$/i, "").trim();
    if (!fileName) {
      await showNotice("GPX file name is missing.");
      return;
    }
    if (fileName.length > 200) {
      await showNotice("GPX file name is too long.");
      return;
    }
    parsed.name = fileName;

    const gpxText = gpxDocument(parsed);
    if (new TextEncoder().encode(gpxText).length > GPX_MAX_BYTES) {
      await showNotice("GPX is larger than 1 MB.");
      return;
    }

    const counterRef = db.collection("routes").doc("counter");
    let routeId = "";
    try {
      routeId = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(counterRef);
        const next = snap.exists ? snap.data().next : 1;
        if (!Number.isInteger(next) || next < 1) {
          throw new Error("Route counter is invalid.");
        }
        const id = `route_${next}`;
        transaction.set(counterRef, { next: next + 1 });
        transaction.set(db.collection("routes").doc(id), {
          name: parsed.name,
          gpx: gpxText,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return id;
      });
    } catch (err) {
      console.error("Failed to store GPX:", err);
      await showNotice("GPX could not be stored.");
      return;
    }

    routesById.set(routeId, { id: routeId, name: parsed.name });
    drawCourse(parsed, true);
    drawnRouteId = routeId;
    selectedRouteId = routeId;
    writeRouteHash(routeId);
    renderRouteList();
  }

  function addGpxLoadControl() {
    const button = addBarButton("gpx-load-control");
    const input = L.DomUtil.create("input", "", map.getContainer());

    button.classList.add("gpx-load-btn");
    button.title = "Load GPX";
    button.setAttribute("aria-label", "Load GPX");
    button.innerHTML = '<svg class="gpx-load-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 5h-3v6h-4V8H7l5-5zm-7 14h14v2H5v-2z"></path></svg>';
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml,application/xml,text/xml";
    input.hidden = true;

    L.DomEvent.on(button, "click", L.DomEvent.stop)
      .on(button, "click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) uploadGpxFile(file);
    });
  }

  function requestDeviceLocation() {
    if (!navigator.geolocation) return null;

    const request = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          noteGpsAllowed();
          resolve(position);
        },
        (err) => {
          console.warn("Geolocation error:", err);
          noteGpsError(err);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0
        }
      );
    });
    locationRequest = request;
    return request;
  }

  function sendOwnLocation(sessionRef, centerMap = false) {
    if (!navigator.geolocation) {
      console.warn("Geolocation unsupported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      if (sessionRef !== activeSessionRef) return;
      noteGpsAllowed();
      await writePoint(sessionRef, position, centerMap);
    }, (err) => {
      console.warn("Geolocation error:", err);
      noteGpsError(err);
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 4000
    });
  }

  async function writePoint(sessionRef, position, centerMap) {
    if (sessionRef !== activeSessionRef) return;

    noteGpsAllowed();

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
      lat: data.lat,
      lon: data.lon,
      accuracy: data.accuracy,
      recordedAtMs: toMillis(data.recordedAt)
    };
  }

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const TRACE_COLORS = Array.from({ length: 12 }, (_, index) => cssColor(`--color-trace-${index + 1}`));

  function colorForAlias(name) {
    let hash = 2166136261;
    const value = aliasKey(name);

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return TRACE_COLORS[(hash >>> 0) % TRACE_COLORS.length];
  }

  function aliasNode(name) {
    const alias = document.createElement("span");
    alias.className = "notice-alias";
    alias.style.color = colorForAlias(name);
    alias.textContent = name;
    return alias;
  }

  function showNotice(message, options = {}) {
    if (noticeResolver) closeNotice(false);

    noticeMessage.replaceChildren();
    if (options.alias) {
      const [before, after = ""] = message.split("{alias}");
      noticeMessage.append(before, aliasNode(options.alias), after);
    } else {
      noticeMessage.textContent = message;
    }
    noticeConfirm.textContent = options.confirmLabel || "OK";
    noticeCancel.hidden = !options.cancelLabel;
    if (options.cancelLabel) noticeCancel.textContent = options.cancelLabel;
    noticeConfirm.classList.toggle("is-danger", noticeConfirm.textContent === "Stop tracking" || noticeConfirm.textContent === "Delete");
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

  function noteGpsAllowed() {
    gpsAllowed = true;
    renderGpsStatus();
  }

  function noteGpsError(err) {
    if (err && err.code === 1) gpsAllowed = false;
    renderGpsStatus();
  }

  function watchGpsPermission() {
    if (!navigator.geolocation) {
      gpsAllowed = false;
      return;
    }
    if (!navigator.permissions || !navigator.permissions.query) return;

    navigator.permissions.query({ name: "geolocation" }).then((permission) => {
      applyGpsPermission(permission.state);
      permission.onchange = () => applyGpsPermission(permission.state);
    });
  }

  function applyGpsPermission(state) {
    if (state === "granted") gpsAllowed = true;
    else if (state === "denied") gpsAllowed = false;
    else gpsAllowed = null;
    renderGpsStatus();
  }

  function renderGpsStatus() {
    const allowedText = gpsAllowed === true ? "allowed" : gpsAllowed === false ? "denied" : "unknown";
    const runningText = gpsRunning ? "running" : "stopped";
    gpsStatusEl.textContent = `${allowedText} · ${runningText}`;
    gpsStatusEl.classList.toggle("status-online", gpsAllowed === true && gpsRunning);
    gpsStatusEl.classList.toggle("status-offline", gpsAllowed === false);
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

  function aliasKey(name) {
    return sanitizeName(name).toLowerCase();
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
    if (routesUnsubscribe) routesUnsubscribe();
    tracksBySessionId.forEach((track) => {
      if (track.unsubscribePoints) track.unsubscribePoints();
    });
    if (writeTimer) clearInterval(writeTimer);
  });
})();
