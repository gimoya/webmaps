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
  const GAP_DOT_SEC = 20;
  const MIN_MOVE_M = 5;
  const MAX_SPEED_MPS = 30;
  const SIM_ACCURACY_M = 8;
  const SIM_STEP_MAX_M = 50;
  const SIM_SLOW_CAP_M = 4.99999;
  const TRACE_LINE_PAUSED = "Tracing paused!";
  const TRACE_LINE_WRITING = "Tracing points every 5s";
  const TRACE_LINE_SLOW = "Slow/no rider movement";
  const SESSIONS_COLLECTION = "trackingSessions";

  const userListEl = document.getElementById("user-list");
  const clearSessionsBtn = document.getElementById("clear-sessions");
  const simLogEl = document.getElementById("sim-log");
  const simLines = [];
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

  function hashTokens() {
    return window.location.hash.slice(1).split("#").filter(Boolean);
  }

  function isAdminMode() {
    return hashTokens().includes("admin");
  }

  function isSimulationMode() {
    return hashTokens().includes("simulation");
  }

  function stripNamedSuffixes(raw, suffixes) {
    let changed = true;
    while (raw && changed) {
      changed = false;
      for (const suffix of suffixes) {
        if (raw === suffix.slice(1)) {
          raw = "";
          changed = true;
        } else if (raw.endsWith(suffix)) {
          raw = raw.slice(0, -suffix.length);
          changed = true;
        }
      }
    }
    return raw;
  }

  function stripHashSuffixes(raw) {
    return stripNamedSuffixes(raw, ["#admin", "#simulation", "#viewing", "#tracking"]);
  }

  function modeFromHash() {
    const raw = stripNamedSuffixes(window.location.hash.slice(1), ["#admin", "#simulation"]);
    if (raw === "viewing" || raw.endsWith("#viewing")) return "viewing";
    if (raw === "tracking" || raw.endsWith("#tracking")) return "tracking";
    return null;
  }

  function routeIdFromHash() {
    const raw = stripHashSuffixes(window.location.hash.slice(1));
    if (!raw || raw === "infos" || raw === "admin" || raw === "simulation") return null;
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
      if (isSimulationMode()) fragment = fragment ? `${fragment}#simulation` : "simulation";
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
    const tokens = hashTokens();
    const onlyFlags = tokens.length > 0 && tokens.every((token) => token === "admin" || token === "simulation");
    if (onlyFlags && previousRoute) writeRouteHash(previousRoute);
    else routeInHash = routeIdFromHash();
    if (pageMode === "viewing" && !activeSessionRef) {
      document.body.classList.add("is-viewer");
      entryDialog.hidden = true;
    } else if (pageMode === "tracking" && !activeSessionRef && riderDialog.hidden) {
      entryDialog.hidden = true;
      openRiderBox();
    }
    renderRouteList();
    syncAdminControls();
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
  let acceptedFix = null;
  let writerTraceLine = TRACE_LINE_PAUSED;
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
  syncAdminControls();
  clearSessionsBtn.addEventListener("click", () => {
    clearAllTrackingSessions();
  });
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
  setInterval(() => {
    renderUserList(sortedTracks());
    refreshTracePopups();
  }, 5000);
  wireControls();

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
      if (aliasFinished(name)) {
        showFinishedRide(name);
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

  function showViewerNotice(fillLog) {
    document.body.classList.add("is-viewer");
    resetRiderForm();
    riderTitle.hidden = true;
    riderNameEl.hidden = true;
    riderActions.hidden = true;
    riderForm.classList.add("is-result");
    fillLog(riderLog);
    riderLog.hidden = false;
    riderDialog.hidden = false;
    setPageMode("viewing");
    clearTimeout(riderCloseTimer);
    riderCloseTimer = setTimeout(() => fadeRiderBox(() => {
      entryDialog.hidden = true;
    }), ENTRY_FEEDBACK_MS);
  }

  function showFinishedRide(name) {
    showViewerNotice((log) => {
      log.replaceChildren(aliasNode(name), " already finished the ride!");
    });
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
    showViewerNotice((log) => {
      log.textContent = "Tracing stopped! Switching to Viewer Mode.";
    });
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

  function syncAdminControls() {
    clearSessionsBtn.hidden = !isAdminMode();
    simLogEl.hidden = !isSimulationMode();
  }

  function noteSim(meters, seconds, label) {
    if (!isSimulationMode()) return;
    const speed = seconds > 0 ? meters / seconds : 0;
    simLines.push(`${meters.toFixed(2)} m · ${speed.toFixed(2)} m/s · ${label}`);
    if (simLines.length > 8) simLines.shift();
    simLogEl.textContent = simLines.map((line) => `${line}\n---`).join("\n");
    simLogEl.scrollTop = simLogEl.scrollHeight;
  }

  async function clearAllTrackingSessions() {
    if (!db || !isAdminMode()) return;
    const confirmed = await showNotice(
      "Clear all tracking sessions? Every trace will leave the map.",
      { confirmLabel: "Clear all", cancelLabel: "Cancel" }
    );
    if (!confirmed) return;

    clearWriter();
    try {
      const sessions = await db.collection(SESSIONS_COLLECTION).get();
      for (const sessionDoc of sessions.docs) {
        const points = await sessionDoc.ref.collection("points").get();
        const refs = points.docs.map((doc) => doc.ref);
        refs.push(sessionDoc.ref);
        for (let index = 0; index < refs.length; index += 500) {
          const batch = db.batch();
          refs.slice(index, index + 500).forEach((ref) => batch.delete(ref));
          await batch.commit();
        }
      }
    } catch (err) {
      console.error("Failed to clear tracking sessions:", err);
      await showNotice("Tracking sessions could not be cleared.");
    }
  }

  function wireControls() {
    stopBtn.addEventListener("click", () => {
      if (activeSessionRef) stopTracking();
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
      const activeDocs = await findActiveAliasSessions(ref, name);
      if (activeDocs.some((doc) => doc.data().finished === true)) {
        locationRequest = null;
        showFinishedRide(name);
        return;
      }
      if (!activeDocs.length) {
        const sessionRef = await createAliasSession(ref, name);
        showRiderResult(name, "..is starting!");
        beginWriting(sessionRef);
      } else {
        showRiderResult(name, "..is resuming his ride!");
        beginWriting(activeDocs[0].ref);
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

  async function stopTracking() {
    const name = sanitizeName(localStorage.getItem("chaser_display_name"));
    const sessionRef = activeSessionRef;
    if (!name || !sessionRef) return;

    const confirmed = await showNotice(
      "Stop tracking {alias}? GPS Tracking will stop if the ride is finished. Your trace will stay on the map!",
      { alias: name, confirmLabel: "Stop tracking", cancelLabel: "Cancel" }
    );
    if (!confirmed || sessionRef !== activeSessionRef) return;

    try {
      await sessionRef.update({
        finished: true,
        endedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to finish tracking session:", err);
      renderConnection(false, "offline");
      await showNotice("Could not finish the ride.");
      return;
    }

    const track = tracksBySessionId.get(sessionRef.id);
    if (track) track.finished = true;
    if (sessionRef === activeSessionRef) clearWriter();
    renderTracksAndPanel();
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
  }

  async function createAliasSession(ref, name) {
    const sessionRef = ref.doc();
    await sessionRef.set({
      name,
      isActive: true,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endedAt: null,
      finished: false
    });
    return sessionRef;
  }

  function beginWriting(sessionRef) {
    latestOwnPosition = null;
    acceptedFix = null;
    writerTraceLine = TRACE_LINE_WRITING;
    activeSessionRef = sessionRef;
    setWriterState(true);
    renderTracksAndPanel();

    const requested = locationRequest;
    locationRequest = null;
    writeTimer = setInterval(() => {
      if (isSimulationMode()) sendSimulatedLocation(sessionRef);
      else sendOwnLocation(sessionRef);
    }, WRITE_INTERVAL_MS);

    return Promise.resolve(requested).then((position) => {
      if (sessionRef !== activeSessionRef) return;
      if (position) return writePoint(sessionRef, position, true);
      if (isSimulationMode()) sendSimulatedLocation(sessionRef, true);
      else sendOwnLocation(sessionRef, true);
    });
  }

  function clearWriter() {
    activeSessionRef = null;
    acceptedFix = null;
    writerTraceLine = TRACE_LINE_PAUSED;
    clearInterval(writeTimer);
    writeTimer = null;
    latestOwnPosition = null;
    setWriterState(false);
    refreshTracePopups();
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
      existing.endedAtMs = toMillis(session.endedAt);
      existing.finished = session.finished === true;
      return;
    }

    const track = {
      sessionId: sessionRef.id,
      name: session.name,
      startedAtMs: toMillis(session.startedAt),
      endedAtMs: toMillis(session.endedAt),
      finished: session.finished === true,
      color: colorForAlias(session.name),
      points: [],
      pointsReady: false,
      marker: null,
      accuracyRing: null,
      lines: null,
      unsubscribePoints: null
    };

    tracksBySessionId.set(sessionRef.id, track);
    track.unsubscribePoints = sessionRef
      .collection("points")
      .orderBy("recordedAt", "asc")
      .onSnapshot((snapshot) => {
        track.pointsReady = true;
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
    const lineStyle = {
      color: track.color,
      weight: 2,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };

    if (!track.lines) {
      track.lines = L.layerGroup().addTo(tracksLayer);
    } else {
      track.lines.clearLayers();
    }

    track.lines.addLayer(L.polyline(
      track.points.map((point) => [point.lat, point.lon]),
      {
        color: "#e0e0e0", // light grey
        weight: 4,
        opacity: 0.4,
        lineCap: "round",
        lineJoin: "round",
        interactive: false
   
      }
    ));

    traceRuns(track.points).forEach((run) => {
      const style = run.dotted
        ? { ...lineStyle, dashArray: "1 6" }
        : lineStyle;
      track.lines.addLayer(L.polyline(run.latLngs, style));
    });

    upsertAccuracyRing(track, latestPoint);
    upsertMarker(track, latestPoint);
  }

  function traceRuns(points) {
    if (points.length === 1) {
      return [{ dotted: false, latLngs: [[points[0].lat, points[0].lon]] }];
    }

    const runs = [];
    for (let index = 1; index < points.length; index += 1) {
      const dotted = gapSec(points[index], points[index - 1]) > GAP_DOT_SEC;
      const end = [points[index].lat, points[index].lon];
      const last = runs[runs.length - 1];
      if (last && last.dotted === dotted) {
        last.latLngs.push(end);
      } else {
        runs.push({
          dotted,
          latLngs: [[points[index - 1].lat, points[index - 1].lon], end]
        });
      }
    }
    return runs;
  }

  function upsertAccuracyRing(track, point) {
    if (track.finished) {
      if (track.accuracyRing) {
        tracksLayer.removeLayer(track.accuracyRing);
        track.accuracyRing = null;
      }
      return;
    }

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

  function gapSec(current, previous) {
    if (!previous) return 0;
    if (!current.recordedAtMs || !previous.recordedAtMs) return null;
    return Math.max(0, Math.round((current.recordedAtMs - previous.recordedAtMs) / 1000));
  }

  function markerPopup(track, point) {
    return [
      `<span class="notice-alias" style="color:${track.color}">${escapeHtml(track.name)}</span>`,
      `Rec. points: ${track.points.length}`,
      `Rec. accuracy: ${Math.round(point.accuracy)} m`,
      traceStatusLine(track)
    ].join("<br>");
  }

  function traceStatusLine(track) {
    if (track.finished) return TRACE_LINE_PAUSED;
    if (activeSessionRef && track.sessionId === activeSessionRef.id) return writerTraceLine;
    if (signalStaleFor(track)) return TRACE_LINE_PAUSED;
    return TRACE_LINE_WRITING;
  }

  function refreshTracePopups() {
    tracksBySessionId.forEach((track) => {
      const point = track.points[track.points.length - 1];
      if (track.marker && point) track.marker.setPopupContent(markerPopup(track, point));
    });
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
    const popup = markerPopup(track, point);

    if (!track.marker) {
      track.marker = L.marker([point.lat, point.lon], { icon }).addTo(tracksLayer);
      track.marker.bindPopup(popup, {
        className: "trace-popup",
        minWidth: 260,
        maxWidth: 260,
        offset: [0, 0]
      });
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
    if (track.lines) tracksLayer.removeLayer(track.lines);
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
      const finished = track.finished === true;
      const signalStale = finished ? false : signalStaleFor(track);

      return {
        track,
        finished,
        signalStale,
        own: Boolean(activeSessionRef && track.sessionId === activeSessionRef.id),
        meta: `last timestamp: ${formatClock(updatedAtMs, true)} · start time: ${formatClock(track.startedAtMs, false)} · ${track.points.length} ${pointLabel}`
      };
    });
    const signature = rows
      .map((row) => `${row.track.sessionId}:${row.own}:${row.finished}:${row.track.endedAtMs || ""}:${row.signalStale}:${row.track.points.length}:${row.track.name}`)
      .join("|");

    if (signature !== userListSignature) {
      userListEl.innerHTML = rows.map((row) => {
        const sessionAttribute = row.track.points.length
          ? ` data-session-id="${escapeHtml(row.track.sessionId)}"`
          : "";
        const warning = row.finished
          ? `<div class="user-item-finished">Tracking stopped/finished · end time: ${formatClock(row.track.endedAtMs, true)}</div>`
          : row.signalStale
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
        <span class="course-callout-label course-km-label${label.endsWith(" km") ? " is-km" : ""}">${label}</span>
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
    const latLngs = course.points.map((point) => [point.lat, point.lon]);
    L.polyline(latLngs, {
      className: "course-outline",
      color: cssColor("--color-white"),
      weight: 4.5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(gpxLayer);
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
      await db.runTransaction(async (transaction) => {
        const counterRef = db.collection("routes").doc("counter");
        const counterSnap = await transaction.get(counterRef);
        const routeRef = db.collection("routes").doc(id);
        const routeSnap = await transaction.get(routeRef);
        if (!routeSnap.exists) throw new Error("Route is already gone.");

        let next = null;
        if (counterSnap.exists) {
          next = counterSnap.data().next;
          if (!Number.isInteger(next) || next < 1) {
            throw new Error("Route counter is invalid.");
          }
        }

        const snaps = [];
        if (next != null) {
          for (let n = 1; n < next; n += 1) {
            if (`route_${n}` === id) continue;
            snaps.push(transaction.get(db.collection("routes").doc(`route_${n}`)));
          }
        }
        const existing = await Promise.all(snaps);

        transaction.delete(routeRef);
        if (next == null) return;

        let max = 0;
        existing.forEach((snap) => {
          if (!snap.exists) return;
          const match = /^route_([1-9][0-9]*)$/.exec(snap.id);
          if (!match) return;
          const n = Number(match[1]);
          if (n > max) max = n;
        });
        const newNext = max + 1;
        if (newNext !== next) transaction.set(counterRef, { next: newNext });
      });
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
    button.title = "Load GPX Route";
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

  let simFix = null;
  let simSlowLeft = 0;
  let simAnchor = null;
  let simTickAtMs = null;
  let simIdlePending = false;

  function offsetMeters(origin, bearingDeg, meters) {
    const rad = bearingDeg * Math.PI / 180;
    const latRad = origin.lat * Math.PI / 180;
    return {
      lat: origin.lat + (meters * Math.cos(rad)) / 111320,
      lon: origin.lon + (meters * Math.sin(rad)) / (111320 * Math.cos(latRad))
    };
  }

  function writableStepMeters() {
    return MIN_MOVE_M + (SIM_STEP_MAX_M - MIN_MOVE_M) * Math.random() ** 2;
  }

  function placeSimIdleJump(sessionRef, position) {
    if (!isSimulationMode() || !simIdlePending || !position.simStep) return;
    const baseline = speedBaseline(sessionRef.id);
    if (baseline === null) {
      simIdlePending = false;
      return;
    }
    if (!baseline) return;
    const gapSec = (Date.now() - baseline.atMs) / 1000;
    simIdlePending = false;
    if (gapSec <= GAP_DOT_SEC) return;
    const meters = writableStepMeters() * (gapSec / (WRITE_INTERVAL_MS / 1000));
    const moved = offsetMeters(baseline, Math.random() * 360, meters);
    position.coords.latitude = moved.lat;
    position.coords.longitude = moved.lon;
    position.simStep.meters = meters;
    simFix = { lat: moved.lat, lon: moved.lon };
    simSlowLeft = 0;
    simAnchor = null;
  }

  function simulationPosition() {
    if (!simFix) {
      const center = map.getCenter();
      simFix = { lat: center.lat, lon: center.lng };
    }

    const now = Date.now();
    const firstTick = simTickAtMs == null;
    const tickGapSec = firstTick ? 0 : (now - simTickAtMs) / 1000;
    simTickAtMs = now;
    if (firstTick) simIdlePending = true;

    if (!firstTick && simIdlePending) {
      return {
        coords: {
          latitude: simFix.lat,
          longitude: simFix.lon,
          accuracy: SIM_ACCURACY_M
        },
        simStep: { meters: 0 }
      };
    }

    const bearing = Math.random() * 360;
    let meters;
    if (tickGapSec > GAP_DOT_SEC) {
      simSlowLeft = 0;
      simAnchor = null;
      simIdlePending = false;
      meters = writableStepMeters() * (tickGapSec / (WRITE_INTERVAL_MS / 1000));
      simFix = offsetMeters(simFix, bearing, meters);
    } else if (simSlowLeft > 0) {
      simSlowLeft -= 1;
      meters = Math.random() * SIM_SLOW_CAP_M;
      simFix = offsetMeters(simAnchor, bearing, meters);
    } else if (Math.random() < 0.05) {
      simSlowLeft = 6 + Math.floor(Math.random() * 5);
      meters = Math.random() * SIM_SLOW_CAP_M;
      simAnchor = acceptedFix
        ? { lat: acceptedFix.lat, lon: acceptedFix.lon }
        : { lat: simFix.lat, lon: simFix.lon };
      simFix = offsetMeters(simAnchor, bearing, meters);
    } else {
      if (simAnchor) {
        simFix = { lat: simAnchor.lat, lon: simAnchor.lon };
        simAnchor = null;
      }
      meters = writableStepMeters();
      simFix = offsetMeters(simFix, bearing, meters);
    }

    return {
      coords: {
        latitude: simFix.lat,
        longitude: simFix.lon,
        accuracy: SIM_ACCURACY_M
      },
      simStep: { meters }
    };
  }

  function requestDeviceLocation() {
    if (isSimulationMode()) {
      noteGpsAllowed();
      const request = Promise.resolve(simulationPosition());
      locationRequest = request;
      return request;
    }

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

  function sendSimulatedLocation(sessionRef, centerMap = false) {
    if (sessionRef !== activeSessionRef) return;
    noteGpsAllowed();
    writePoint(sessionRef, simulationPosition(), centerMap);
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
    const track = tracksBySessionId.get(sessionRef.id);
    if (track && track.finished === true) return;

    noteGpsAllowed();
    placeSimIdleJump(sessionRef, position);

    latestOwnPosition = position;
    if (centerMap) centerMapOnPosition(position);

    try {
      const baseline = speedBaseline(sessionRef.id);
      if (baseline === undefined) return;
      let meters = position.simStep ? position.simStep.meters : 0;
      let seconds = WRITE_INTERVAL_MS / 1000;
      if (baseline) {
        meters = haversineMeters(
          [baseline.lat, baseline.lon],
          [position.coords.latitude, position.coords.longitude]
        );
        seconds = (Date.now() - baseline.atMs) / 1000;
        if (meters < MIN_MOVE_M) {
          writerTraceLine = TRACE_LINE_SLOW;
          refreshTracePopups();
          noteSim(meters, seconds, "slow/no move skip");
          return;
        }
        if (seconds <= 0 || meters / seconds > MAX_SPEED_MPS) {
          noteSim(meters, seconds, "+30 m/s skip");
          return;
        }
      }

      await sessionRef.collection("points").add({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy || 0,
        recordedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (sessionRef !== activeSessionRef) return;
      writerTraceLine = TRACE_LINE_WRITING;
      acceptedFix = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        atMs: Date.now()
      };
      noteSim(meters, seconds, "normal write");
    } catch (err) {
      console.error("Failed to write tracking point:", err);
      renderConnection(false, "offline");
    }
  }

  function speedBaseline(sessionId) {
    const track = tracksBySessionId.get(sessionId);
    if (!track || !track.pointsReady) return undefined;

    const stored = track.points[track.points.length - 1];
    if (acceptedFix && (!stored || !stored.recordedAtMs || acceptedFix.atMs > stored.recordedAtMs)) {
      return acceptedFix;
    }
    if (!stored) return null;
    if (!stored.recordedAtMs) return undefined;
    return { lat: stored.lat, lon: stored.lon, atMs: stored.recordedAtMs };
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

  const TRACE_COLORS = Array.from({ length: 24 }, (_, index) => cssColor(`--color-trace-${index + 1}`));

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
    noticeConfirm.classList.toggle("is-danger", noticeConfirm.textContent === "Stop tracking" || noticeConfirm.textContent === "Delete" || noticeConfirm.textContent === "Clear all");
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

  function aliasFinished(name) {
    const key = aliasKey(name);
    return [...tracksBySessionId.values()].some(
      (track) => aliasKey(track.name) === key && track.finished === true
    );
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
