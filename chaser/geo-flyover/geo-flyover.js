/**
 * GeoFlyover — Mapbox GL JS + terrain path flyover (speed km/h).
 * Peer: mapbox-gl (global mapboxgl). No Leaflet / host-app deps.
 *
 *   GeoFlyover.open(track, { accessToken, speedKmh })
 *   GeoFlyover.mount(containerEl, track, opts)
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    speedKmh: 200,
    pitch: 68,
    zoom: 14.5,
    style: "mapbox://styles/mapbox/satellite-streets-v12",
    lookAheadM: 80,
    exaggeration: 1.15,
    /** Quantize desired heading (less fidget); camera eases toward it. */
    bearingStepDeg: 60,
    /** Max turn rate while easing to the stepped target (°/s). */
    bearingTurnDegPerSec: 20,
    /** Path divided into this many skip steps (10 forward clicks → end). */
    skipSteps: 20,
    lineColor: "#00b9fe",
    lineColorDim: "#ffffff",
    headColor: "#f3ef9a"
  };

  /** Ground speed along the path (real km/h). 100 km/h ≈ 28 m/s. */
  var SPEED_MIN = 0;
  var SPEED_MAX = 1000;
  /** Camera height via Mapbox zoom: slider 0 = close, Max = high. */
  var ZOOM_CLOSE = 17;
  var ZOOM_HIGH = 11;
  var HEIGHT_SLIDER_MAX = 100;

  var GPX_NS = "http://www.topografix.com/GPX/1/1";
  var EARTH_M = 6371000;

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversineM(lon1, lat1, lon2, lat2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Bearing degrees from A→B (lon/lat). */
  function bearingDeg(lon1, lat1, lon2, lat2) {
    var φ1 = toRad(lat1);
    var φ2 = toRad(lat2);
    var Δλ = toRad(lon2 - lon1);
    var y = Math.sin(Δλ) * Math.cos(φ2);
    var x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function isLonLatPair(c) {
    return (
      Array.isArray(c) &&
      c.length >= 2 &&
      Number.isFinite(Number(c[0])) &&
      Number.isFinite(Number(c[1]))
    );
  }

  function normalizeCoord(c) {
    var lon = Number(c[0]);
    var lat = Number(c[1]);
    var row = [lon, lat];
    if (c.length > 2 && Number.isFinite(Number(c[2]))) row.push(Number(c[2]));
    return row;
  }

  function coordsFromLineString(geom) {
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
      return null;
    }
    var out = [];
    for (var i = 0; i < geom.coordinates.length; i++) {
      if (isLonLatPair(geom.coordinates[i])) out.push(normalizeCoord(geom.coordinates[i]));
    }
    return out.length >= 2 ? out : null;
  }

  function localName(node) {
    return node && node.localName ? node.localName : "";
  }

  function gpxChildText(parent, name) {
    if (!parent || !parent.children) return "";
    for (var i = 0; i < parent.children.length; i++) {
      if (localName(parent.children[i]) === name) {
        return (parent.children[i].textContent || "").trim();
      }
    }
    return "";
  }

  function gpxPointsFromParent(parent, ptName) {
    var coords = [];
    if (!parent || !parent.children) return coords;
    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (localName(el) !== ptName) continue;
      var lat = parseFloat(el.getAttribute("lat"));
      var lon = parseFloat(el.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      var eleStr = gpxChildText(el, "ele");
      var ele = eleStr ? parseFloat(eleStr) : NaN;
      if (Number.isFinite(ele)) coords.push([lon, lat, ele]);
      else coords.push([lon, lat]);
    }
    return coords;
  }

  function parseGpxString(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (!doc || !doc.documentElement || doc.querySelector("parsererror")) {
      return null;
    }
    var nodes = doc.getElementsByTagName("*");
    var i;
    var n;
    var ln;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      ln = localName(n);
      if (ln === "trk") {
        for (var j = 0; j < n.children.length; j++) {
          var seg = n.children[j];
          if (localName(seg) !== "trkseg") continue;
          var coords = gpxPointsFromParent(seg, "trkpt");
          if (coords.length >= 2) return coords;
        }
      }
    }
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (localName(n) === "rte") {
        var rcoords = gpxPointsFromParent(n, "rtept");
        if (rcoords.length >= 2) return rcoords;
      }
    }
    // Namespaced fallback
    var trkpts = doc.getElementsByTagNameNS(GPX_NS, "trkpt");
    if (trkpts && trkpts.length >= 2) {
      var nsCoords = [];
      for (i = 0; i < trkpts.length; i++) {
        var pt = trkpts[i];
        var plat = parseFloat(pt.getAttribute("lat"));
        var plon = parseFloat(pt.getAttribute("lon"));
        if (!Number.isFinite(plat) || !Number.isFinite(plon)) continue;
        var eleEl = pt.getElementsByTagNameNS(GPX_NS, "ele")[0];
        var pz = eleEl ? parseFloat(eleEl.textContent) : NaN;
        if (Number.isFinite(pz)) nsCoords.push([plon, plat, pz]);
        else nsCoords.push([plon, plat]);
      }
      if (nsCoords.length >= 2) return nsCoords;
    }
    return null;
  }

  /**
   * @returns {Array<[number,number]|[number,number,number]>|null}
   */
  function parseTrack(track) {
    if (!track) return null;
    if (typeof track === "string") {
      var trimmed = track.trim();
      if (trimmed.charAt(0) === "<") return parseGpxString(trimmed);
      try {
        return parseTrack(JSON.parse(trimmed));
      } catch (err) {
        return null;
      }
    }
    if (Array.isArray(track)) {
      if (!track.length) return null;
      if (isLonLatPair(track[0])) {
        var list = [];
        for (var i = 0; i < track.length; i++) {
          if (isLonLatPair(track[i])) list.push(normalizeCoord(track[i]));
        }
        return list.length >= 2 ? list : null;
      }
      return null;
    }
    if (typeof track !== "object") return null;
    if (track.type === "LineString") return coordsFromLineString(track);
    if (track.type === "Feature" && track.geometry) {
      return coordsFromLineString(track.geometry);
    }
    if (track.type === "FeatureCollection" && Array.isArray(track.features)) {
      for (var f = 0; f < track.features.length; f++) {
        var feat = track.features[f];
        var c = feat && feat.geometry ? coordsFromLineString(feat.geometry) : null;
        if (c) return c;
      }
    }
    return null;
  }

  function buildPath(coords) {
    var cumulative = [0];
    var total = 0;
    for (var i = 1; i < coords.length; i++) {
      var d = haversineM(
        coords[i - 1][0],
        coords[i - 1][1],
        coords[i][0],
        coords[i][1]
      );
      total += d;
      cumulative.push(total);
    }
    return { coords: coords, cumulative: cumulative, totalM: total };
  }

  function sampleAt(path, meters) {
    var coords = path.coords;
    var cumulative = path.cumulative;
    var total = path.totalM;
    if (meters <= 0) return { lon: coords[0][0], lat: coords[0][1], index: 0 };
    if (meters >= total) {
      var last = coords.length - 1;
      return { lon: coords[last][0], lat: coords[last][1], index: last };
    }
    for (var i = 1; i < coords.length; i++) {
      if (cumulative[i] < meters) continue;
      var span = cumulative[i] - cumulative[i - 1];
      var t = span === 0 ? 0 : (meters - cumulative[i - 1]) / span;
      var a = coords[i - 1];
      var b = coords[i];
      return {
        lon: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        index: i - 1
      };
    }
    var end = coords.length - 1;
    return { lon: coords[end][0], lat: coords[end][1], index: end };
  }

  function sliceCoordsTo(path, meters) {
    var coords = path.coords;
    var cumulative = path.cumulative;
    if (meters <= 0) {
      var a = coords[0].slice();
      return [a, a.slice()];
    }
    var out = [coords[0].slice()];
    for (var i = 1; i < coords.length; i++) {
      if (cumulative[i] < meters) {
        out.push(coords[i].slice());
        continue;
      }
      var at = sampleAt(path, meters);
      out.push([at.lon, at.lat]);
      break;
    }
    if (out.length < 2) out.push(out[0].slice());
    return out;
  }

  function mergeOpts(opts) {
    var o = {};
    var key;
    for (key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) o[key] = DEFAULTS[key];
    }
    if (opts) {
      for (key in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, key) && opts[key] != null) {
          o[key] = opts[key];
        }
      }
    }
    o.speedKmh = clampSpeed(o.speedKmh);
    o.zoom = clampZoom(o.zoom);
    return o;
  }

  function lineFeature(coords) {
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords }
    };
  }

  function pointFeature(lon, lat) {
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lon, lat] }
    };
  }

  function emptyLine() {
    return lineFeature([]);
  }

  function clampSpeed(kmh) {
    var n = Number(kmh);
    if (!Number.isFinite(n)) return DEFAULTS.speedKmh;
    return Math.max(SPEED_MIN, Math.min(SPEED_MAX, n));
  }

  function clampZoom(z) {
    var n = Number(z);
    if (!Number.isFinite(n)) return DEFAULTS.zoom;
    var lo = Math.min(ZOOM_HIGH, ZOOM_CLOSE);
    var hi = Math.max(ZOOM_HIGH, ZOOM_CLOSE);
    return Math.max(lo, Math.min(hi, n));
  }

  /** Slider 0 (close) … HEIGHT_SLIDER_MAX (high altitude). */
  function zoomFromHeightSlider(sliderVal) {
    var t = Math.max(0, Math.min(HEIGHT_SLIDER_MAX, Number(sliderVal) || 0)) / HEIGHT_SLIDER_MAX;
    return ZOOM_CLOSE + (ZOOM_HIGH - ZOOM_CLOSE) * t;
  }

  function heightSliderFromZoom(zoom) {
    var z = clampZoom(zoom);
    if (ZOOM_HIGH === ZOOM_CLOSE) return 0;
    var t = (z - ZOOM_CLOSE) / (ZOOM_HIGH - ZOOM_CLOSE);
    return Math.round(Math.max(0, Math.min(1, t)) * HEIGHT_SLIDER_MAX);
  }

  function normalizeBearing(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function snapBearing(deg, step) {
    var s = Number(step);
    if (!Number.isFinite(s) || s <= 0) s = 90;
    return normalizeBearing(Math.round(deg / s) * s);
  }

  /** Shortest signed delta from → to in (-180, 180]. */
  function bearingDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  /**
   * Ease `from` toward `to` by at most maxDeg (shortest turn).
   * Mapbox has no bearing damper for per-frame jumpTo — this is the path-follow approach.
   */
  function easeBearing(from, to, maxDeg) {
    var delta = bearingDelta(from, to);
    var step = Math.max(0, Number(maxDeg) || 0);
    if (Math.abs(delta) <= step) return normalizeBearing(to);
    return normalizeBearing(from + (delta > 0 ? step : -step));
  }

  function Session(container, path, opts, ownedOverlay) {
    this.container = container;
    this.path = path;
    this.opts = opts;
    this.ownedOverlay = ownedOverlay || null;
    this.map = null;
    this._raf = 0;
    this._playing = false;
    this._paused = false;
    this._progressM = 0;
    this._lastTick = 0;
    this._speedKmh = clampSpeed(opts.speedKmh);
    this._zoom = clampZoom(opts.zoom);
    this._bearing = null;
    this._bearingTarget = null;
    this._lastProgressDrawM = -1e9;
    this._destroyed = false;
    this._playBtn = null;
    this._speedInput = null;
    this._heightInput = null;
    this._onResize = null;
  }

  Session.prototype._speedMps = function () {
    return this._speedKmh / 3.6;
  };

  Session.prototype.setSpeedKmh = function (kmh) {
    this._speedKmh = clampSpeed(kmh);
    this.opts.speedKmh = this._speedKmh;
    this._syncSpeedUi();
    return this;
  };

  Session.prototype.setZoom = function (zoom) {
    this._zoom = clampZoom(zoom);
    this.opts.zoom = this._zoom;
    this._syncHeightUi();
    if (this.map && !this._destroyed) {
      this._applyFrame(this._progressM, false, 0);
    }
    return this;
  };

  Session.prototype._skipStepM = function () {
    var steps = Number(this.opts.skipSteps);
    if (!Number.isFinite(steps) || steps < 1) steps = 10;
    return this.path.totalM / steps;
  };

  /** Jump ± (trackLength / skipSteps); nearer than one step → start/end. */
  Session.prototype.skipBy = function (direction) {
    if (this._destroyed || !this.map) return this;
    var total = this.path.totalM;
    var skip = this._skipStepM();
    var next;
    if (direction < 0) {
      next = this._progressM <= skip ? 0 : this._progressM - skip;
    } else {
      var remain = total - this._progressM;
      next = remain <= skip ? total : this._progressM + skip;
    }
    this._progressM = Math.max(0, Math.min(total, next));
    this._lastProgressDrawM = -1e9;
    // Snap heading to new location (no ease across the jump).
    this._bearing = null;
    this._bearingTarget = null;
    this._lastTick = 0;
    this._applyFrame(this._progressM, true, 0);
    if (this._progressM >= total) {
      this._playing = false;
      this._paused = false;
      this._syncPlayBtn();
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    } else if (this._playing && !this._paused) {
      // keep flying from new spot
      var self = this;
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(function (t) {
        self._tick(t);
      });
    }
    return this;
  };

  Session.prototype.skipBackward = function () {
    return this.skipBy(-1);
  };

  Session.prototype.skipForward = function () {
    return this.skipBy(1);
  };

  Session.prototype._syncSpeedUi = function () {
    if (this._speedInput) this._speedInput.value = String(Math.round(this._speedKmh));
  };

  Session.prototype._syncHeightUi = function () {
    if (this._heightInput) {
      this._heightInput.value = String(heightSliderFromZoom(this._zoom));
    }
  };

  Session.prototype._pathBearing = function (progressM) {
    var path = this.path;
    var lookAhead = this.opts.lookAheadM;
    var at = sampleAt(path, progressM);
    if (progressM >= path.totalM - 0.01) {
      var back = sampleAt(path, Math.max(0, path.totalM - lookAhead));
      return bearingDeg(back.lon, back.lat, at.lon, at.lat);
    }
    var look = sampleAt(path, Math.min(path.totalM, progressM + lookAhead));
    return bearingDeg(at.lon, at.lat, look.lon, look.lat);
  };

  Session.prototype._applyFrame = function (progressM, forceLine, dtSec) {
    var path = this.path;
    var opts = this.opts;
    var at = sampleAt(path, progressM);
    var rawBearing = this._pathBearing(progressM);
    var target = snapBearing(rawBearing, opts.bearingStepDeg);
    this._bearingTarget = target;

    if (this._bearing == null) {
      this._bearing = target;
    } else {
      var rate = Number(opts.bearingTurnDegPerSec);
      if (!Number.isFinite(rate) || rate < 0) rate = 10;
      var maxStep = rate * Math.max(0, dtSec || 0);
      // If dt is 0 (paused UI tweak), keep current bearing.
      if (maxStep > 0) this._bearing = easeBearing(this._bearing, target, maxStep);
    }

    this.map.jumpTo({
      center: [at.lon, at.lat],
      bearing: this._bearing,
      pitch: opts.pitch,
      zoom: this._zoom
    });

    var headSrc = this.map.getSource("flyover-head");
    if (headSrc) headSrc.setData(pointFeature(at.lon, at.lat));

    // Progress line is expensive on dense GPX — redraw every ~25 m (or forced).
    if (forceLine || progressM - this._lastProgressDrawM >= 25 || progressM >= path.totalM) {
      this._lastProgressDrawM = progressM;
      var progressSrc = this.map.getSource("flyover-progress");
      if (progressSrc) progressSrc.setData(lineFeature(sliceCoordsTo(path, progressM)));
    }
  };

  Session.prototype._tick = function (now) {
    if (this._destroyed || !this._playing || this._paused) return;
    if (!this._lastTick) this._lastTick = now;
    var dtSec = Math.max(0, Math.min(0.25, (now - this._lastTick) / 1000));
    this._lastTick = now;
    this._progressM = Math.min(
      this.path.totalM,
      this._progressM + this._speedMps() * dtSec
    );
    this._applyFrame(this._progressM, this._progressM >= this.path.totalM, dtSec);
    if (this._progressM >= this.path.totalM) {
      this._playing = false;
      this._syncPlayBtn();
      this._raf = 0;
      this._lastTick = 0;
      return;
    }
    var self = this;
    this._raf = requestAnimationFrame(function (t) {
      self._tick(t);
    });
  };

  Session.prototype._syncPlayBtn = function () {
    if (!this._playBtn) return;
    if (!this._playing) {
      this._playBtn.textContent = "Replay";
      this._playBtn.setAttribute("aria-label", "Replay");
    } else if (this._paused) {
      this._playBtn.textContent = "Resume";
      this._playBtn.setAttribute("aria-label", "Resume");
    } else {
      this._playBtn.textContent = "Pause";
      this._playBtn.setAttribute("aria-label", "Pause");
    }
  };

  Session.prototype._bindToolbar = function () {
    var self = this;
    var play = this.container.querySelector("[data-flyover-play]");
    var close = this.container.querySelector("[data-flyover-close]");
    var speed = this.container.querySelector("[data-flyover-speed]");
    var height = this.container.querySelector("[data-flyover-height]");
    this._playBtn = play;
    this._speedInput = speed;
    this._heightInput = height;
    this._syncSpeedUi();
    this._syncHeightUi();
    if (play) {
      play.addEventListener("click", function () {
        if (!self._playing) self.play();
        else if (self._paused) self.resume();
        else self.pause();
      });
    }
    var skipBack = this.container.querySelector("[data-flyover-skip-back]");
    var skipFwd = this.container.querySelector("[data-flyover-skip-fwd]");
    if (skipBack) {
      skipBack.addEventListener("click", function () {
        self.skipBackward();
      });
    }
    if (skipFwd) {
      skipFwd.addEventListener("click", function () {
        self.skipForward();
      });
    }
    if (speed) {
      speed.addEventListener("input", function () {
        self.setSpeedKmh(speed.value);
      });
    }
    if (height) {
      height.addEventListener("input", function () {
        self.setZoom(zoomFromHeightSlider(height.value));
      });
    }
    if (close) {
      close.addEventListener("click", function () {
        self.stop();
      });
    }
  };

  Session.prototype._addLayers = function () {
    var map = this.map;
    var opts = this.opts;
    var full = lineFeature(this.path.coords);

    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.terrain-rgb",
      tileSize: 256,
      maxzoom: 15
    });
    map.setTerrain({
      source: "mapbox-dem",
      exaggeration: opts.exaggeration
    });
    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-sun": [0.0, 90.0],
        "sky-atmosphere-sun-intensity": 15
      }
    });

    map.addSource("flyover-full", { type: "geojson", data: full });
    map.addLayer({
      id: "flyover-full-line",
      type: "line",
      source: "flyover-full",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": opts.lineColorDim,
        "line-width": 3,
        "line-opacity": 0.35
      }
    });

    map.addSource("flyover-progress", { type: "geojson", data: emptyLine() });
    map.addLayer({
      id: "flyover-progress-line",
      type: "line",
      source: "flyover-progress",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": opts.lineColor,
        "line-width": 4,
        "line-opacity": 0.95
      }
    });

    map.addSource("flyover-head", {
      type: "geojson",
      data: pointFeature(this.path.coords[0][0], this.path.coords[0][1])
    });
    map.addLayer({
      id: "flyover-head-circle",
      type: "circle",
      source: "flyover-head",
      paint: {
        "circle-radius": 7,
        "circle-color": opts.headColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#111"
      }
    });
  };

  Session.prototype._initMap = function () {
    var self = this;
    if (typeof mapboxgl === "undefined") {
      return Promise.reject(new Error("mapboxgl not loaded"));
    }
    if (this.opts.accessToken) {
      mapboxgl.accessToken = this.opts.accessToken;
    }
    if (!mapboxgl.accessToken) {
      return Promise.reject(new Error("Mapbox accessToken required"));
    }

    var start = this.path.coords[0];
    var look = sampleAt(this.path, Math.min(this.path.totalM, this.opts.lookAheadM));
    var startBearing = snapBearing(
      bearingDeg(start[0], start[1], look.lon, look.lat),
      this.opts.bearingStepDeg
    );
    this._bearing = startBearing;
    this._bearingTarget = startBearing;

    this.map = new mapboxgl.Map({
      container: this.container.querySelector("[data-flyover-map]") || this.container,
      style: this.opts.style,
      center: [start[0], start[1]],
      zoom: this._zoom,
      pitch: this.opts.pitch,
      bearing: startBearing,
      antialias: true,
      attributionControl: false
    });

    this._onResize = function () {
      if (self.map) self.map.resize();
    };
    window.addEventListener("resize", this._onResize);

    return new Promise(function (resolve, reject) {
      self.map.on("load", function () {
        try {
          self.map.resize();
          self._addLayers();
          self._bearing = null;
          self._applyFrame(0, true, 0);
          resolve(self);
        } catch (err) {
          reject(err);
        }
      });
      self.map.on("error", function (e) {
        console.error("GeoFlyover map error", e && e.error);
      });
    });
  };

  Session.prototype.play = function () {
    if (this._destroyed || !this.map) return this;
    if (this._playing && !this._paused) return this;
    // Restart from beginning when finished or fresh
    if (!this._playing) {
      this._progressM = 0;
      this._bearing = null;
      this._bearingTarget = null;
      this._lastProgressDrawM = -1e9;
      this._applyFrame(0, true, 0);
    }
    this._playing = true;
    this._paused = false;
    this._lastTick = 0;
    this._syncPlayBtn();
    var self = this;
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(function (t) {
      self._tick(t);
    });
    return this;
  };

  Session.prototype.pause = function () {
    if (this._destroyed || !this._playing || this._paused) return this;
    this._paused = true;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._lastTick = 0;
    this._syncPlayBtn();
    return this;
  };

  Session.prototype.resume = function () {
    if (this._destroyed || !this._playing || !this._paused) return this;
    this._paused = false;
    this._lastTick = 0;
    this._syncPlayBtn();
    var self = this;
    this._raf = requestAnimationFrame(function (t) {
      self._tick(t);
    });
    return this;
  };

  Session.prototype.stop = function () {
    if (this._destroyed) return this;
    this._destroyed = true;
    this._playing = false;
    this._paused = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.ownedOverlay && this.ownedOverlay.parentNode) {
      this.ownedOverlay.parentNode.removeChild(this.ownedOverlay);
    }
    this.ownedOverlay = null;
    return this;
  };

  function buildShell(isModal) {
    var root = document.createElement("div");
    root.className = isModal
      ? "geo-flyover geo-flyover--modal"
      : "geo-flyover geo-flyover--embed";
    root.innerHTML =
      '<div class="geo-flyover-toolbar">' +
      '<label class="geo-flyover-slider" title="Height">' +
      '<span class="geo-flyover-slider-title">Height</span>' +
      '<span class="geo-flyover-slider-end">min</span>' +
      '<input type="range" class="geo-flyover-slider-input" data-flyover-height' +
      ' min="0" max="' + HEIGHT_SLIDER_MAX + '" step="1" value="50"' +
      ' aria-label="Height">' +
      '<span class="geo-flyover-slider-end">max</span>' +
      "</label>" +
      '<label class="geo-flyover-slider" title="Speed">' +
      '<span class="geo-flyover-slider-title">Speed</span>' +
      '<span class="geo-flyover-slider-end">min</span>' +
      '<input type="range" class="geo-flyover-slider-input" data-flyover-speed' +
      ' min="' + SPEED_MIN + '" max="' + SPEED_MAX + '" step="10" value="100"' +
      ' aria-label="Speed">' +
      '<span class="geo-flyover-slider-end">max</span>' +
      "</label>" +
      '<div class="geo-flyover-transport">' +
      '<button type="button" class="geo-flyover-btn" data-flyover-skip-back aria-label="Skip back">⟨⟨</button>' +
      '<button type="button" class="geo-flyover-btn" data-flyover-play aria-label="Pause">Pause</button>' +
      '<button type="button" class="geo-flyover-btn" data-flyover-skip-fwd aria-label="Skip forward">⟩⟩</button>' +
      "</div>" +
      (isModal
        ? '<button type="button" class="geo-flyover-btn geo-flyover-btn--close" data-flyover-close aria-label="Close">Close</button>'
        : "") +
      "</div>" +
      '<div class="geo-flyover-map" data-flyover-map></div>' +
      '<div class="geo-flyover-attrib">' +
      '<a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">© Mapbox</a> ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>' +
      "</div>";
    return root;
  }

  function startSession(container, track, opts, ownedOverlay) {
    var coords = parseTrack(track);
    if (!coords) {
      return Promise.reject(new Error("GeoFlyover: invalid track (need ≥2 points)"));
    }
    var path = buildPath(coords);
    if (path.totalM <= 0) {
      return Promise.reject(new Error("GeoFlyover: track has zero length"));
    }
    var options = mergeOpts(opts);
    var session = new Session(container, path, options, ownedOverlay);
    session._bindToolbar();
    return session._initMap().then(function () {
      session.play();
      return session;
    });
  }

  /**
   * Fullscreen modal flyover. Auto-plays when map is ready.
   * @returns {Promise<Session>}
   */
  function open(track, opts) {
    var overlay = buildShell(true);
    document.body.appendChild(overlay);
    return startSession(overlay, track, opts, overlay).catch(function (err) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      throw err;
    });
  }

  /**
   * Embed into an existing element (clears children, builds chrome + map).
   * @returns {Promise<Session>}
   */
  function mount(containerEl, track, opts) {
    if (!containerEl) {
      return Promise.reject(new Error("GeoFlyover.mount: container required"));
    }
    containerEl.innerHTML = "";
    var shell = buildShell(false);
    containerEl.appendChild(shell);
    return startSession(shell, track, opts, null);
  }

  root.GeoFlyover = {
    open: open,
    mount: mount,
    parseTrack: parseTrack,
    DEFAULTS: DEFAULTS
  };
})(typeof window !== "undefined" ? window : this);
