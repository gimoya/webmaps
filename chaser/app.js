(function () {
  const REPLAY_DURATION_MS = 30 * 1000;

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
  const SIM_SPEED_MIN_KMH = 10;
  const SIM_SPEED_MAX_KMH = 25;
  const TRACE_LINE_PAUSED = "Tracing paused!";
  const TRACE_LINE_WRITING = "Tracing points every 5s";
  const TRACE_LINE_SLOW = "Slow/no rider movement";
  const SESSIONS_COLLECTION = "trackingSessions";
  const PLACEMENT_COLLECTION = "placement";
  const PLACEMENT_DOC = "current";
  const ROUTES_COLLECTION = "routes";
  const ROUTE_DOC = "current";
  const EVENTS_COLLECTION = "events";
  const EVENT_ID_MAX = 40;
  const PLACE_CUPS = ["🥇", "🥈", "🥉"];

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
  const eventDialog = document.getElementById("event-dialog");
  const eventListEl = document.getElementById("event-list");
  const eventEmptyEl = document.getElementById("event-empty");
  const eventAdminEl = document.getElementById("event-admin");
  const eventNameEl = document.getElementById("event-name");
  const eventCreateBtn = document.getElementById("event-create");
  const eventPanelLine = document.getElementById("event-panel-line");
  const eventPanelName = document.getElementById("event-panel-name");
  const eventSwitchBtn = document.getElementById("event-switch");
  const panelHeader = document.getElementById("panel-header");
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
  let noticeResolver = null;
  let routeLatLngs = null;
  let pendingRouteFrame = false;
  let gpxLoadButton = null;
  let gpxLoadControl = null;
  const GPX_MAX_BYTES = 1024 * 1024 - 2048;
  const eventsById = new Map();
  let eventId = null;
  let eventName = null;
  let eventRef = null;
  let eventsUnsubscribe = null;
  let resolvingEvent = false;

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

  function withoutRider(raw) {
    return raw.split("#").filter((token) => !token.startsWith("rider=")).join("#");
  }

  function riderFromHash() {
    const token = hashTokens().find((part) => part.startsWith("rider="));
    if (!token) return "";
    return sanitizeName(decodeURIComponent(token.slice(6)));
  }

  function modeFromHash() {
    const tokens = hashTokens();
    if (tokens.includes("viewing")) return "viewing";
    if (tokens.includes("tracking")) return "tracking";
    return null;
  }

  function eventIdFromHash() {
    const token = hashTokens().find((part) => (
      part !== "admin" &&
      part !== "simulation" &&
      part !== "viewing" &&
      part !== "tracking" &&
      !part.startsWith("rider=")
    ));
    return token ? decodeURIComponent(token) : null;
  }

  function modeHashFragment() {
    let fragment = eventId || eventIdFromHash() || "";
    if (hashRider) fragment = fragment ? `${fragment}#rider=${encodeURIComponent(hashRider)}` : `rider=${encodeURIComponent(hashRider)}`;
    if (pageMode) fragment = fragment ? `${fragment}#${pageMode}` : pageMode;
    if (isSimulationMode()) fragment = fragment ? `${fragment}#simulation` : "simulation";
    if (isAdminMode()) fragment = fragment ? `${fragment}#admin` : "admin";
    return fragment;
  }

  function writePageUrl() {
    const center = map.getCenter();
    const params = new URLSearchParams();
    params.set("lat", center.lat.toFixed(5));
    params.set("lng", center.lng.toFixed(5));
    params.set("z", String(map.getZoom()));
    const fragment = modeHashFragment();
    const nextHash = fragment ? `#${fragment}` : "";
    history.replaceState(null, "", `${window.location.pathname}?${params}${nextHash}`);
  }

  let pageMode = modeFromHash();
  let hashRider = riderFromHash();

  function setPageMode(mode) {
    pageMode = mode;
    writePageUrl();
  }

  function showInfoPanel() {
    panelMain.hidden = true;
    panelInfo.hidden = false;
  }

  function hideInfoPanel() {
    panelMain.hidden = false;
    panelInfo.hidden = true;
  }

  window.addEventListener("hashchange", () => {
    pageMode = modeFromHash();
    hashRider = riderFromHash();
    const nextEvent = eventIdFromHash();
    if (db && nextEvent !== eventId) {
      resolveEventFromHash();
      return;
    }
    if (!eventId) {
      showEventPicker();
      return;
    }
    if (pageMode === "viewing" && !activeSessionRef) {
      document.body.classList.add("is-viewer");
      entryDialog.hidden = true;
    } else if (pageMode === "tracking" && !activeSessionRef && riderDialog.hidden) {
      entryDialog.hidden = true;
      openRiderBox();
    }
    syncAdminControls();
  });
  document.querySelector(".info-link").addEventListener("click", () => {
    showInfoPanel();
  });
  panelInfo.querySelector(".panel-info-close").addEventListener("click", () => {
    hideInfoPanel();
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
  const tracksBySessionId = new Map();

  let sessionsUnsubscribe = null;
  let routesUnsubscribe = null;
  let placementUnsubscribe = null;
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
  let placementCurrent = null;
  let placeCups = new Map();
  let replayActive = false;
  let replayFrame = 0;
  let replayLayer = null;

  addGpxLoadControl();
  addSessionCenterControl();
  watchGpsPermission();
  renderGpsStatus();
  syncAdminControls();
  clearSessionsBtn.addEventListener("click", () => {
    clearAllTrackingSessions();
  });
  eventSwitchBtn.addEventListener("click", () => {
    showEventPicker();
  });
  eventSwitchBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showEventPicker();
  });
  eventCreateBtn.addEventListener("click", () => {
    createEventFromForm();
  });
  eventListEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-id]");
    if (!button) return;
    selectEvent(button.dataset.eventId);
  });
  wireEntryGate();

  const firebaseConfig = window.CHASER_FIREBASE_CONFIG || null;
  if (!firebaseConfig) {
    renderConnection(false, "offline");
    console.warn("CHASER_FIREBASE_CONFIG missing. Realtime sync disabled.");
    showEventPicker();
    return;
  }

  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  attachEventsSubscription();
  resolveEventFromHash();
  setInterval(() => {
    if (!eventId) return;
    renderUserList(sortedTracks());
    refreshTracePopups();
  }, 5000);
  wireControls();

  function eventSlug(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, EVENT_ID_MAX);
  }

  function renderEventPanel() {
    if (!eventId || !eventName) {
      eventPanelLine.hidden = true;
      eventPanelName.textContent = "";
      panelHeader.classList.remove("has-event");
      return;
    }
    eventPanelLine.hidden = false;
    eventPanelName.textContent = eventName;
    panelHeader.classList.add("has-event");
  }

  function renderEventPickerList() {
    const events = [...eventsById.values()].sort((a, b) => a.name.localeCompare(b.name));
    eventListEl.replaceChildren();
    events.forEach((event) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.eventId = event.id;
      button.textContent = event.name;
      button.title = event.id;
      item.append(button);
      eventListEl.append(item);
    });
    eventEmptyEl.hidden = events.length > 0;
  }

  function showEventPicker() {
    entryDialog.hidden = true;
    riderDialog.hidden = true;
    eventAdminEl.hidden = !isAdminMode();
    renderEventPickerList();
    eventDialog.hidden = false;
    syncAdminControls();
  }

  function hideEventPicker() {
    eventDialog.hidden = true;
  }

  function attachEventsSubscription() {
    eventsUnsubscribe = db.collection(EVENTS_COLLECTION).onSnapshot((snapshot) => {
      eventsById.clear();
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (typeof data.name !== "string" || !data.name) return;
        eventsById.set(doc.id, { id: doc.id, name: data.name });
      });
      renderEventPickerList();
      if (eventId && !eventsById.has(eventId) && !resolvingEvent) {
        teardownEventScope();
        showEventPicker();
      }
    }, (error) => {
      console.error("Firestore events subscription error:", error);
      renderConnection(false, "offline");
    });
  }

  async function resolveEventFromHash() {
    if (!db || resolvingEvent) return;
    resolvingEvent = true;
    try {
      const id = eventIdFromHash();
      if (!id) {
        if (eventId) teardownEventScope();
        showEventPicker();
        return;
      }
      if (id === eventId && eventRef) {
        hideEventPicker();
        syncAdminControls();
        return;
      }
      const snap = await db.collection(EVENTS_COLLECTION).doc(id).get();
      if (!snap.exists) {
        if (eventId) teardownEventScope();
        showEventPicker();
        return;
      }
      await bindEvent(id, snap.data());
      hideEventPicker();
      applyInitialMode();
    } finally {
      resolvingEvent = false;
    }
  }

  async function selectEvent(id) {
    if (!db || !eventsById.has(id)) return;
    const row = eventsById.get(id);
    pendingRouteFrame = true;
    await bindEvent(id, { name: row.name });
    hideEventPicker();
    applyInitialMode();
  }

  async function createEventFromForm() {
    if (!db || !isAdminMode()) return;
    const name = String(eventNameEl.value || "").trim();
    if (!name) {
      await showNotice("Event name is missing.");
      return;
    }
    if (name.length > 80) {
      await showNotice("Event name is too long.");
      return;
    }
    const id = eventSlug(name);
    if (!id) {
      await showNotice("Event name needs letters or numbers.");
      return;
    }
    const ref = db.collection(EVENTS_COLLECTION).doc(id);
    try {
      const existing = await ref.get();
      if (existing.exists) {
        await showNotice("That event id already exists.");
        return;
      }
      await ref.set({
        name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      eventNameEl.value = "";
      await bindEvent(id, { name });
      hideEventPicker();
      applyInitialMode();
    } catch (err) {
      console.error("Failed to create event:", err);
      await showNotice("Event could not be created.");
    }
  }

  function teardownEventScope() {
    clearWriter();
    if (replayActive) stopReplay();
    if (sessionsUnsubscribe) {
      sessionsUnsubscribe();
      sessionsUnsubscribe = null;
    }
    if (routesUnsubscribe) {
      routesUnsubscribe();
      routesUnsubscribe = null;
    }
    if (placementUnsubscribe) {
      placementUnsubscribe();
      placementUnsubscribe = null;
    }
    [...tracksBySessionId.keys()].forEach((sessionId) => removeTrack(sessionId));
    clearCourse();
    placementCurrent = null;
    placeCups = new Map();
    sessionsRef = null;
    eventRef = null;
    eventId = null;
    eventName = null;
    renderEventPanel();
    renderTracksAndPanel();
    syncAdminControls();
  }

  async function bindEvent(id, data) {
    if (eventId === id && eventRef) {
      writePageUrl("");
      renderEventPanel();
      syncAdminControls();
      if (pendingRouteFrame) {
        pendingRouteFrame = false;
        if (routeLatLngs && routeLatLngs.length > 1) {
          frameGpx(L.latLngBounds(routeLatLngs));
        }
      }
      return;
    }
    if (eventId) teardownEventScope();
    eventId = id;
    eventName = typeof data.name === "string" ? data.name : id;
    eventRef = db.collection(EVENTS_COLLECTION).doc(id);
    sessionsRef = eventRef.collection(SESSIONS_COLLECTION);
    writePageUrl("");
    renderEventPanel();
    attachSessionsSubscription(sessionsRef);
    attachRoutesSubscription(eventRef);
    attachPlacementSubscription(eventRef);
    syncAdminControls();
  }

  function wireEntryGate() {
    document.getElementById("entry-viewer").addEventListener("click", () => {
      entryDialog.hidden = true;
      document.body.classList.add("is-viewer");
      setPageMode("viewing");
    });
    entryRider.addEventListener("click", () => {
      if (!eventId) {
        showEventPicker();
        return;
      }
      entryDialog.hidden = true;
      openRiderBox();
    });
    document.getElementById("viewer-ride").addEventListener("click", () => {
      if (!eventId) {
        showEventPicker();
        return;
      }
      openRiderBox();
    });
    document.getElementById("viewer-replay").addEventListener("click", () => {
      if (!eventId) {
        showEventPicker();
        return;
      }
      if (replayActive) stopReplay();
      else startReplay();
    });
    document.getElementById("rider-cancel").addEventListener("click", () => {
      clearTimeout(riderCloseTimer);
      resetRiderForm();
      riderDialog.hidden = true;
      document.body.classList.add("is-viewer");
      setPageMode("viewing");
    });
    riderForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = sanitizeName(riderNameEl.value);
      if (!name) {
        riderLog.hidden = true;
        riderNameEl.focus();
        return;
      }
      if (!sessionsRef || !eventId) {
        riderLog.textContent = eventId ? "Firebase is not configured." : "Pick an event first.";
        riderLog.hidden = false;
        return;
      }
      if (aliasFinished(name)) {
        showFinishedRide(name);
        return;
      }
      if (isSimulationMode() && !(routeLatLngs && routeLatLngs.length > 1)) {
        showNotice("No GPX route is drawn. Simulation stopped.");
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
    riderNameEl.value = hashRider;
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
    const admin = isAdminMode();
    const ready = Boolean(eventId);
    clearSessionsBtn.hidden = !admin || !ready;
    if (gpxLoadControl) gpxLoadControl.hidden = !admin;
    if (eventAdminEl) eventAdminEl.hidden = !admin;
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
    if (!db || !eventRef || !isAdminMode()) return;
    const confirmed = await showNotice(
      "Clear all tracking sessions? Every trace will leave the map.",
      { confirmLabel: "Clear all", cancelLabel: "Cancel" }
    );
    if (!confirmed) return;

    clearWriter();
    try {
      const sessions = await eventRef.collection(SESSIONS_COLLECTION).get();
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
      await writePlacement([], []);
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
    hashRider = name;
    writePageUrl("");
    setRiderPanelTitle(name);
    riderNameEl.disabled = true;
    riderForm.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      const activeDocs = findActiveAliasSessions(ref, name);
      if (activeDocs.some((doc) => doc.data().finished === true)) {
        locationRequest = null;
        showFinishedRide(name);
        return;
      }
      if (!activeDocs.length) {
        if (isSimulationMode()) beginNewSimulation();
        const sessionRef = await createAliasSession(ref, name);
        showRiderResult(name, "..is starting!");
        beginWriting(sessionRef);
      } else {
        if (isSimulationMode()) placeSimulationOnRoute(activeDocs[0].id);
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
    const sessionRef = activeSessionRef;
    if (!sessionRef) return;
    const track = tracksBySessionId.get(sessionRef.id);
    const name = sanitizeName(track && track.name);
    if (!name) return;

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

    if (track) {
      track.finished = true;
      if (track.pointsReady) dropPointsListener(track);
    }
    await lockPlacement(sessionRef.id);
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

  function findActiveAliasSessions(ref, name) {
    const key = aliasKey(name);
    return [...tracksBySessionId.values()]
      .filter((track) => aliasKey(track.name) === key)
      .sort((a, b) => (a.startedAtMs || 0) - (b.startedAtMs || 0))
      .map((track) => ({
        id: track.sessionId,
        ref: ref.doc(track.sessionId),
        data: () => ({
          name: track.name,
          finished: track.finished === true,
          startedAt: track.startedAtMs
        })
      }));
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
    if (sessionsUnsubscribe) sessionsUnsubscribe();
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

  function dropPointsListener(track) {
    if (!track.unsubscribePoints) return;
    track.unsubscribePoints();
    track.unsubscribePoints = null;
  }

  function ensureTrackSubscription(sessionRef, session) {
    const existing = tracksBySessionId.get(sessionRef.id);
    if (existing) {
      existing.name = session.name;
      existing.color = colorForAlias(session.name);
      existing.startedAtMs = toMillis(session.startedAt);
      existing.endedAtMs = toMillis(session.endedAt);
      existing.finished = session.finished === true;
      if (existing.finished && existing.pointsReady) dropPointsListener(existing);
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
        if (!track.pointsReady) {
          track.points = snapshot.docs
            .map((doc) => pointFromDocument(doc))
            .filter(Boolean);
          track.pointsReady = true;
        } else {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const point = pointFromDocument(change.doc);
              if (point) track.points.push(point);
              return;
            }
            if (change.type === "modified") {
              const point = pointFromDocument(change.doc);
              const index = track.points.findIndex((row) => row.id === change.doc.id);
              if (point && index >= 0) track.points[index] = point;
              else if (point) track.points.push(point);
              return;
            }
            if (change.type === "removed") {
              track.points = track.points.filter((row) => row.id !== change.doc.id);
            }
          });
        }
        if (track.finished) dropPointsListener(track);
        renderTracksAndPanel();
      }, (error) => {
        console.error(`Firestore points subscription error for ${sessionRef.id}:`, error);
        renderConnection(false, "offline");
      });
  }

  function sortedTracks() {
    return [...tracksBySessionId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function stringList(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  }

  function placementFromData(data) {
    if (!data) return null;
    const order = stringList(data.order);
    const locked = stringList(data.locked);
    if (!order || !locked) return null;
    return { order, locked, recordedAtMs: toMillis(data.recordedAt) };
  }

  function placeMark(index) {
    if (index < PLACE_CUPS.length) return PLACE_CUPS[index];
    return `${index + 1}.th #`;
  }

  function marksFromOrder(order) {
    const marks = new Map();
    (order || []).forEach((id, index) => marks.set(id, placeMark(index)));
    return marks;
  }

  function applyLivePlacement() {
    placeCups = marksFromOrder(placementCurrent && placementCurrent.order);
  }

  function attachPlacementSubscription(scopeRef) {
    if (placementUnsubscribe) placementUnsubscribe();
    placementUnsubscribe = scopeRef.collection(PLACEMENT_COLLECTION).doc(PLACEMENT_DOC).onSnapshot((doc) => {
      placementCurrent = doc.exists ? placementFromData(doc.data()) : null;
      applyLivePlacement();
      renderTracksAndPanel();
    }, (error) => {
      console.error("Firestore placement subscription error:", error);
    });
  }

  function orderWithLocks(fix) {
    const previous = placementCurrent;
    const locked = new Set((previous && previous.locked) || []);
    const pins = new Map();
    if (previous) {
      previous.order.forEach((id, index) => {
        if (locked.has(id)) pins.set(index, id);
      });
    }

    const ranked = [];
    const seen = new Set(locked);
    tracksBySessionId.forEach((track) => {
      if (seen.has(track.sessionId)) return;
      const point = track.sessionId === fix.sessionId
        ? { lat: fix.lat, lon: fix.lon }
        : track.points[track.points.length - 1];
      if (!point) return;
      seen.add(track.sessionId);
      ranked.push({
        id: track.sessionId,
        meters: metersLeftOnRoute(routeLatLngs, point.lat, point.lon)
      });
    });
    if (!seen.has(fix.sessionId)) {
      ranked.push({
        id: fix.sessionId,
        meters: metersLeftOnRoute(routeLatLngs, fix.lat, fix.lon)
      });
    }
    ranked.sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id));

    const pinIndexes = [...pins.keys()];
    const lastPin = pinIndexes.length ? Math.max(...pinIndexes) : -1;
    const length = Math.max(lastPin + 1, pins.size + ranked.length);
    const order = [];
    let next = 0;
    for (let index = 0; index < length; index += 1) {
      if (pins.has(index)) {
        order.push(pins.get(index));
        continue;
      }
      if (next < ranked.length) {
        order.push(ranked[next].id);
        next += 1;
        continue;
      }
      const held = previous && previous.order[index];
      if (held && !order.includes(held)) order.push(held);
    }
    return { order, locked: [...locked] };
  }

  function sameStringList(a, b) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  async function writePlacement(order, locked) {
    if (!eventRef) return;
    if (
      placementCurrent &&
      sameStringList(placementCurrent.order, order) &&
      sameStringList(placementCurrent.locked, locked)
    ) {
      return;
    }
    await eventRef.collection(PLACEMENT_COLLECTION).doc(PLACEMENT_DOC).set({
      order,
      locked,
      recordedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function publishPlacement(fix) {
    if (!routeLatLngs || routeLatLngs.length < 2) return;
    const next = orderWithLocks(fix);
    await writePlacement(next.order, next.locked);
  }

  async function lockPlacement(sessionId) {
    const current = placementCurrent;
    if (!current || !current.order.includes(sessionId) || current.locked.includes(sessionId)) return;
    try {
      await writePlacement(current.order, current.locked.concat(sessionId));
    } catch (err) {
      console.error("Failed to lock placement:", err);
    }
  }

  function renderTracksAndPanel() {
    const tracks = sortedTracks();
    tracks.forEach(renderTrack);
    renderUserList(tracks);
  }

  function hideLiveTraceLayers() {
    tracksBySessionId.forEach((track) => {
      if (track.marker) {
        tracksLayer.removeLayer(track.marker);
        track.marker = null;
      }
      if (track.accuracyRing) {
        tracksLayer.removeLayer(track.accuracyRing);
        track.accuracyRing = null;
      }
      if (track.lines) {
        tracksLayer.removeLayer(track.lines);
        track.lines = null;
      }
    });
  }

  function replaySources() {
    return sortedTracks().flatMap((track) => {
      const points = track.points.filter((point) => point.recordedAtMs != null);
      if (!points.length) return [];
      return [{
        sessionId: track.sessionId,
        name: track.name,
        color: track.color,
        t0: points[0].recordedAtMs,
        points
      }];
    });
  }

  function paintReplayActor(actor) {
    const points = actor.source.points.slice(0, actor.shown);
    const latest = points[points.length - 1];
    const lineStyle = {
      color: actor.source.color,
      weight: 1.5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    };
    actor.lines.clearLayers();
    actor.lines.addLayer(L.polyline(
      points.map((point) => [point.lat, point.lon]),
      {
        color: "#e0e0e0",
        weight: 2.5,
        opacity: 0.4,
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      }
    ));
    traceRuns(points).forEach((run) => {
      const style = run.dotted ? { ...lineStyle, dashArray: "1 6" } : lineStyle;
      actor.lines.addLayer(L.polyline(run.latLngs, style));
    });
    const icon = traceMarkerIcon(actor.source.name, actor.source.color, actor.cup);
    if (!actor.marker) {
      actor.marker = L.marker([latest.lat, latest.lon], {
        icon,
        interactive: false,
        keyboard: false
      }).addTo(replayLayer);
      return;
    }
    actor.marker.setLatLng([latest.lat, latest.lon]);
    actor.marker.setIcon(icon);
  }

  function startReplay() {
    const sources = replaySources();
    if (!sources.length || replayActive) return;
    let longestMs = 0;
    sources.forEach((source) => {
      const durationMs = source.points[source.points.length - 1].recordedAtMs - source.t0;
      if (durationMs > longestMs) longestMs = durationMs;
    });
    const replaySpeed = longestMs / REPLAY_DURATION_MS;
    const bounds = L.latLngBounds([]);
    sources.forEach((source) => {
      source.points.forEach((point) => bounds.extend([point.lat, point.lon]));
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], animate: false });
    }
    replayActive = true;
    document.body.classList.add("is-replaying");
    document.getElementById("viewer-replay").setAttribute("aria-pressed", "true");
    hideLiveTraceLayers();
    replayLayer = L.layerGroup().addTo(map);
    const actors = sources.map((source) => ({
      source,
      shown: 0,
      cup: "",
      lines: L.layerGroup().addTo(replayLayer),
      marker: null
    }));
    const started = performance.now();

    const frame = (now) => {
      if (!replayActive) return;
      const elapsed = (now - started) * replaySpeed;
      let finished = true;
      let moved = false;
      actors.forEach((actor) => {
        const points = actor.source.points;
        let count = actor.shown;
        while (count < points.length && points[count].recordedAtMs - actor.source.t0 <= elapsed) {
          count += 1;
        }
        if (count < points.length) finished = false;
        if (count !== actor.shown) moved = true;
        actor.shown = count;
      });
      if (!moved) {
        if (finished) {
          stopReplay();
          return;
        }
        replayFrame = requestAnimationFrame(frame);
        return;
      }
      const cups = marksFromOrder(placementCurrent && placementCurrent.order);
      actors.forEach((actor) => {
        if (!actor.shown) return;
        const cup = cups.get(actor.source.sessionId) || "";
        if (actor.marker && actor.cup === cup && actor.painted === actor.shown) return;
        actor.cup = cup;
        actor.painted = actor.shown;
        paintReplayActor(actor);
      });
      if (finished) {
        stopReplay();
        return;
      }
      replayFrame = requestAnimationFrame(frame);
    };
    replayFrame = requestAnimationFrame(frame);
  }

  function stopReplay() {
    if (!replayActive) return;
    replayActive = false;
    cancelAnimationFrame(replayFrame);
    replayFrame = 0;
    document.body.classList.remove("is-replaying");
    document.getElementById("viewer-replay").setAttribute("aria-pressed", "false");
    if (replayLayer) {
      map.removeLayer(replayLayer);
      replayLayer = null;
    }
    renderTracksAndPanel();
  }

  function renderTrack(track) {
    if (replayActive) return;
    if (!track.points.length) return;

    const latestPoint = track.points[track.points.length - 1];
    const latLngs = track.points.map((point) => [point.lat, point.lon]);
    const lineStyle = {
      color: track.color,
      weight: 1.5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    };

    if (!track.lines) {
      track.lines = L.layerGroup().addTo(tracksLayer);
    } else {
      track.lines.clearLayers();
    }

    track.lines.addLayer(L.polyline(latLngs, {
      color: "#e0e0e0",
      weight: 2.5,
      opacity: 0.4,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }));

    const hit = L.polyline(latLngs, {
      color: track.color,
      weight: 14,
      opacity: 0,
      lineCap: "round",
      lineJoin: "round",
      interactive: true,
      className: "trace-hit"
    });
    hit.on("mousedown click", (event) => {
      L.DomEvent.preventDefault(event);
      L.DomEvent.stopPropagation(event);
    });
    hit.bindTooltip(
      `<span class="notice-alias" style="color:${track.color}">${escapeHtml(track.name)}</span>`,
      {
        sticky: true,
        direction: "top",
        opacity: 1,
        className: "trace-hover-label"
      }
    );
    track.lines.addLayer(hit);

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

  function stemMetrics(name) {
    const base = 56;
    const key = aliasKey(name);
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const factor = 0.8 + (hash >>> 0) % 1001 / 1000 * 0.4;
    const stem = Math.round(base * factor);
    return { stem, labelBottom: stem + 8 };
  }

  function traceMarkerIcon(name, color, mark = "") {
    const place = mark ? `<span class="chaser-place">${escapeHtml(mark)}</span>` : "";
    const stem = stemMetrics(name);
    return L.divIcon({
      className: "chaser-marker-icon",
      html: `<span class="chaser-callout">
        <span class="chaser-callout-label" style="color:${color};bottom:${stem.labelBottom}px">${place}${escapeHtml(name)}</span>
        <span class="chaser-callout-stem" style="height:${stem.stem}px"></span>
        <span class="chaser-user-marker" style="background:${color}"></span>
      </span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
  }

  function upsertMarker(track, point) {
    const icon = traceMarkerIcon(track.name, track.color, placeCups.get(track.sessionId) || "");
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

    const placeOrder = (placementCurrent && placementCurrent.order) || [];
    const placeRank = new Map(placeOrder.map((id, index) => [id, index]));
    const pinnedKey = activeSessionRef
      ? null
      : (hashRider ? aliasKey(hashRider) : null);

    const ordered = [...tracks].sort((a, b) => {
      const aOwn = Boolean(
        (activeSessionRef && a.sessionId === activeSessionRef.id) ||
        (pinnedKey && aliasKey(a.name) === pinnedKey)
      );
      const bOwn = Boolean(
        (activeSessionRef && b.sessionId === activeSessionRef.id) ||
        (pinnedKey && aliasKey(b.name) === pinnedKey)
      );
      if (aOwn !== bOwn) return aOwn ? -1 : 1;

      const aRank = placeRank.has(a.sessionId) ? placeRank.get(a.sessionId) : Number.POSITIVE_INFINITY;
      const bRank = placeRank.has(b.sessionId) ? placeRank.get(b.sessionId) : Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

    const rows = ordered.map((track) => {
      const updatedAtMs = latestResolvedSignalMs(track);
      const pointLabel = track.points.length === 1 ? "point" : "points";
      const finished = track.finished === true;
      const signalStale = finished ? false : signalStaleFor(track);
      const own = Boolean(
        (activeSessionRef && track.sessionId === activeSessionRef.id) ||
        (pinnedKey && aliasKey(track.name) === pinnedKey)
      );

      return {
        track,
        finished,
        signalStale,
        own,
        meta: `last timestamp: ${formatClock(updatedAtMs, true)} · start time: ${formatClock(track.startedAtMs, false)} · ${track.points.length} ${pointLabel}`
      };
    });
    const viewing = document.body.classList.contains("is-viewer");
    const signature = `${viewing ? "view" : "ride"}|${placeOrder.join(",")}|` + rows
      .map((row) => `${row.track.sessionId}:${row.own}:${row.finished}:${row.track.endedAtMs || ""}:${row.signalStale}:${row.track.points.length}:${row.track.name}:${placeCups.get(row.track.sessionId) || ""}`)
      .join("|");

    if (signature !== userListSignature) {
      userListEl.innerHTML = rows.map((row) => {
        const sessionAttribute = row.track.points.length
          ? ` data-session-id="${escapeHtml(row.track.sessionId)}"`
          : "";
        const warning = row.finished
          ? `<div class="user-item-finished">Tracking stopped/finished · end time: ${formatClock(row.track.endedAtMs, true)}</div>`
          : row.signalStale && !viewing
            ? `<div class="user-item-stale">Tracking paused.</div>`
            : "";
        const mark = placeCups.get(row.track.sessionId) || "";
        const name = mark
          ? `<span class="chaser-place">${escapeHtml(mark)}</span>${escapeHtml(row.track.name)}`
          : escapeHtml(row.track.name);

      return `
          <li class="user-item${row.own ? " is-tracking" : ""}" data-track-id="${escapeHtml(row.track.sessionId)}"${sessionAttribute} style="border-left-color:${row.track.color}">
            <div class="user-item-name notice-alias" style="color:${row.track.color}">${name}</div>
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

  function metersLeftOnRoute(latLngs, lat, lon) {
    const latScale = 110540;
    const lonScale = 111320 * Math.cos(((latLngs[0][0] + latLngs[latLngs.length - 1][0]) / 2) * Math.PI / 180);
    const px = lon * lonScale;
    const py = lat * latScale;
    let walked = 0;
    let bestAt = 0;
    let bestOff = Infinity;
    for (let index = 1; index < latLngs.length; index += 1) {
      const a = latLngs[index - 1];
      const b = latLngs[index];
      const ax = a[1] * lonScale;
      const ay = a[0] * latScale;
      const bx = b[1] * lonScale;
      const by = b[0] * latScale;
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / len2));
      const offX = px - (ax + abx * t);
      const offY = py - (ay + aby * t);
      const off = offX * offX + offY * offY;
      const step = haversineMeters(a, b);
      if (off < bestOff) {
        bestOff = off;
        bestAt = walked + t * step;
      }
      walked += step;
    }
    return walked - bestAt;
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
    routeLatLngs = latLngs.length > 1 ? latLngs : null;
    renderTracksAndPanel();
  }

  function clearCourse() {
    gpxLayer.clearLayers();
    routeLatLngs = null;
    renderTracksAndPanel();
  }

  function applyRouteDoc(data, frame) {
    if (!data || typeof data.gpx !== "string" || !data.gpx) {
      clearCourse();
      return;
    }
    const parsed = parseGpx(data.gpx);
    if (parsed.error) {
      console.error("Stored GPX could not be parsed:", parsed.error);
      clearCourse();
      return;
    }
    if (typeof data.name === "string" && data.name) parsed.name = data.name;
    drawCourse(parsed, frame);
  }

  function attachRoutesSubscription(scopeRef) {
    if (routesUnsubscribe) routesUnsubscribe();
    routesUnsubscribe = scopeRef.collection(ROUTES_COLLECTION).doc(ROUTE_DOC).onSnapshot((doc) => {
      const frame = pendingRouteFrame || (!parseMapView() && !routeLatLngs);
      pendingRouteFrame = false;
      applyRouteDoc(doc.exists ? doc.data() : null, frame);
    }, (error) => {
      console.error("Firestore routes subscription error:", error);
    });
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
    if (!isAdminMode() || !eventRef) return;
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

    try {
      await eventRef.collection(ROUTES_COLLECTION).doc(ROUTE_DOC).set({
        name: parsed.name,
        gpx: gpxText,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to store GPX:", err);
      await showNotice("GPX could not be stored.");
      return;
    }

    drawCourse(parsed, true);
  }

  function addGpxLoadControl() {
    const button = addBarButton("gpx-load-control");
    const input = L.DomUtil.create("input", "", map.getContainer());
    gpxLoadButton = button;
    gpxLoadControl = button.parentElement;

    button.classList.add("gpx-load-btn");
    button.title = "Load GPX Route";
    button.setAttribute("aria-label", "Load GPX");
    if (gpxLoadControl) gpxLoadControl.hidden = !isAdminMode();
    button.innerHTML = '<svg class="gpx-load-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 5h-3v6h-4V8H7l5-5zm-7 14h14v2H5v-2z"></path></svg>';
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml,application/xml,text/xml";
    input.hidden = true;

    L.DomEvent.on(button, "click", L.DomEvent.stop)
      .on(button, "click", () => {
        if (!isAdminMode()) return;
        input.click();
      });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) uploadGpxFile(file);
    });
  }

  let simFix = null;
  let simAlongM = 0;
  let simSpeedMps = null;
  let simTickAtMs = null;

  function simSpeedPick() {
    const kmh = SIM_SPEED_MIN_KMH + Math.random() * (SIM_SPEED_MAX_KMH - SIM_SPEED_MIN_KMH);
    return kmh / 3.6;
  }

  function simCoords(metersMoved) {
    const at = pointAtDistance(routeLatLngs, simAlongM);
    simFix = { lat: at[0], lon: at[1] };
    return {
      coords: {
        latitude: at[0],
        longitude: at[1],
        accuracy: SIM_ACCURACY_M
      },
      simStep: { meters: metersMoved }
    };
  }

  function beginNewSimulation() {
    simSpeedMps = simSpeedPick();
    simAlongM = 0;
    simTickAtMs = Date.now();
    locationRequest = Promise.resolve(simCoords(0));
  }

  function placeSimulationOnRoute(sessionId) {
    if (simSpeedMps == null) simSpeedMps = simSpeedPick();
    if (simTickAtMs == null) {
      const track = tracksBySessionId.get(sessionId);
      const last = track && track.points[track.points.length - 1];
      let walked = 0;
      let bestAt = 0;
      let best = Infinity;
      routeLatLngs.forEach((latLng, index) => {
        if (index > 0) walked += haversineMeters(routeLatLngs[index - 1], latLng);
        if (!last) return;
        const distance = haversineMeters(latLng, [last.lat, last.lon]);
        if (distance < best) {
          best = distance;
          bestAt = walked;
        }
      });
      simAlongM = last ? bestAt : 0;
    }
    simTickAtMs = Date.now();
    locationRequest = Promise.resolve(simCoords(0));
  }

  function simulationPosition() {
    if (!routeLatLngs || routeLatLngs.length < 2) {
      showNotice("No GPX route is drawn. Simulation stopped.");
      clearWriter();
      return null;
    }
    if (simSpeedMps == null) simSpeedMps = simSpeedPick();
    const now = Date.now();
    const dt = simTickAtMs == null ? 0 : (now - simTickAtMs) / 1000;
    simTickAtMs = now;
    const moved = simSpeedMps * dt;
    simAlongM += moved;
    return simCoords(moved);
  }

  function requestDeviceLocation() {
    if (isSimulationMode()) {
      noteGpsAllowed();
      locationRequest = Promise.resolve(null);
      return locationRequest;
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
    const position = simulationPosition();
    if (!position) return;
    noteGpsAllowed();
    writePoint(sessionRef, position, centerMap);
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
      try {
        await publishPlacement({
          sessionId: sessionRef.id,
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
      } catch (err) {
        console.error("Failed to write placement:", err);
      }
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
      id: doc.id,
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
