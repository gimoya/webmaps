/**
 * Digitize: waypoints + per-segment route|straightElev|straightSkip legs.
 * Pen + profile apply only to the next segment (not the last drawn).
 * Drag waypoints or route → re-resolve adjacent segments. Digitize again → GPX.
 * Straight runs get BRouter-flank linear elev; straightSkip edges skip ↑/↓/min/max.
 */
(function (global, L) {
	'use strict';

	if (!L || !L.Control) return;

	var PEN_ROUTE = 'route';
	var PEN_STRAIGHT_ELEV = 'straightElev';
	var PEN_STRAIGHT_SKIP = 'straightSkip';
	var PEN_CYCLE = [PEN_ROUTE, PEN_STRAIGHT_ELEV, PEN_STRAIGHT_SKIP];

	/* Signed grade bands for sparkline (Δele / horizDist). */
	var COLOR_FLAT = '#ffffff';       /* -3% … +3% */
	var COLOR_DOWN_SOFT = '#43a047'; /* -10% … -3% */
	var COLOR_DOWN_MID = '#26c6da';  /* -15% … -10% turquoise */
	var COLOR_DOWN_HARD = '#0d47a1'; /* < -15% marine */
	var COLOR_UP_SOFT = '#fdd835';   /* +3% … +10% */
	var COLOR_UP_MID = '#e53935';    /* +10% … +15% */
	var COLOR_UP_HARD = '#7f1310';   /* > +15% */

	/* Fixed X scale: 100 m = 1 cm (CSS reference px). Chart scrolls when longer. */
	var ELEV_X_M = 100;
	var ELEV_X_CM = 1;
	var ELEV_X_PX_PER_M = (ELEV_X_CM * (96 / 2.54)) / ELEV_X_M;

	var ELEV_LOUPE_PX = 72;
	var ELEV_LOUPE_ZOOM = 2.75;
	/** Slope for color + loupe: Δele over this distance (m), not raw point-to-point. */
	var ELEV_GRADE_WINDOW_M = 50;

	function elevAtDist(samples, d) {
		if (!samples || !samples.length) return null;
		if (d <= samples[0].dist) return samples[0].ele;
		for (var i = 1; i < samples.length; i++) {
			if (d <= samples[i].dist) {
				var a = samples[i - 1];
				var b = samples[i];
				var span = b.dist - a.dist;
				var t = span > 0 ? (d - a.dist) / span : 0;
				return a.ele + t * (b.ele - a.ele);
			}
		}
		return samples[samples.length - 1].ele;
	}

	/**
	 * Signed grade (rise/run) averaged over ~windowM meters centered on d.
	 * Near ends, uses a full window ahead or behind when possible.
	 */
	function gradeWindowed(samples, d, windowM) {
		windowM = windowM || ELEV_GRADE_WINDOW_M;
		if (!samples || samples.length < 2 || !(windowM > 0)) return null;
		var d0 = samples[0].dist;
		var d1 = samples[samples.length - 1].dist;
		if (!(d1 > d0)) return null;
		if (d < d0) d = d0;
		if (d > d1) d = d1;

		var half = windowM / 2;
		var a = d - half;
		var b = d + half;
		if (a < d0) {
			a = d0;
			b = Math.min(d1, a + windowM);
		} else if (b > d1) {
			b = d1;
			a = Math.max(d0, b - windowM);
		}
		if (!(b > a)) return null;
		var ea = elevAtDist(samples, a);
		var eb = elevAtDist(samples, b);
		if (ea == null || eb == null || !isFinite(ea) || !isFinite(eb)) return null;
		return (eb - ea) / (b - a);
	}

	/** Slope at distance d for loupe / coloring (50 m window). */
	function gradeAtDist(samples, d) {
		return gradeWindowed(samples, d, ELEV_GRADE_WINDOW_M);
	}

	function formatGradePct(g) {
		if (g == null || !isFinite(g)) return '—';
		var pct = g * 100;
		var abs = Math.abs(pct);
		var body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
		if (pct > 0.05) return '+' + body + '%';
		if (pct < -0.05) return '−' + body + '%';
		return '0%';
	}

	/** Interpolate {lat,lng} along elev samples by distance. */
	function latLngAtDist(samples, d) {
		if (!samples || !samples.length) return null;
		function pt(s) {
			if (!s || !isFinite(s.lat) || !isFinite(s.lng)) return null;
			return { lat: s.lat, lng: s.lng };
		}
		if (d <= samples[0].dist) return pt(samples[0]);
		for (var i = 1; i < samples.length; i++) {
			if (d <= samples[i].dist) {
				var a = samples[i - 1];
				var b = samples[i];
				var pa = pt(a);
				var pb = pt(b);
				if (!pa) return pb;
				if (!pb) return pa;
				var span = b.dist - a.dist;
				var t = span > 0 ? (d - a.dist) / span : 0;
				return {
					lat: a.lat + t * (b.lat - a.lat),
					lng: a.lng + t * (b.lng - a.lng)
				};
			}
		}
		return pt(samples[samples.length - 1]);
	}

	var DEFAULT_PROFILES = [
		{ key: 'mtb', label: 'MTB' },
		{ key: 'trekking', label: 'Trekking' },
		{ key: 'hiking-mountain', label: 'Hiking' }
	];

	var INFO_HTML =
		'<strong>Digitize</strong>' +
		'<ul>' +
		'<li>Klick = Waypoint</li>' +
		'<li>Jedes Segment einzeln: Profil / Stift</li>' +
		'<li>Stift-Zyklus: Route · Gerade inkl. Höhe · Gerade exkl. Höhe</li>' +
		'<li>Profil + Stift = fürs <em>nächste</em> Segment</li>' +
		'<li>Waypoint oder Route ziehen = Segmente anpassen</li>' +
		'<li>GPX-Dialog: Höhenprofil + ↑/↓ · Speichern = Download + Route entfernt</li>' +
		'</ul>';

	function latLngPlain(ll) {
		var o = { lat: ll.lat, lng: ll.lng };
		if (ll.ele != null && isFinite(ll.ele)) o.ele = ll.ele;
		return o;
	}

	function samePoint(a, b) {
		return a && b && a.lat === b.lat && a.lng === b.lng;
	}

	function hasEle(p) {
		return p && p.ele != null && isFinite(p.ele);
	}

	function isStraightMode(mode) {
		return mode === PEN_STRAIGHT_ELEV || mode === PEN_STRAIGHT_SKIP;
	}

	function countsInElevStats(mode) {
		return mode === PEN_ROUTE || mode === PEN_STRAIGHT_ELEV;
	}

	/** Horizontal distance in meters (haversine). */
	function horizDistM(a, b) {
		var R = 6371000;
		var lat1 = a.lat * Math.PI / 180;
		var lat2 = b.lat * Math.PI / 180;
		var dLat = (b.lat - a.lat) * Math.PI / 180;
		var dLng = (b.lng - a.lng) * Math.PI / 180;
		var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
		return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
	}

	/** @param {number} g signed grade (rise/run), e.g. 0.12 = +12% */
	function gradeColor(g) {
		if (!isFinite(g)) return COLOR_FLAT;
		if (g > 0.15) return COLOR_UP_HARD;
		if (g > 0.10) return COLOR_UP_MID;
		if (g > 0.03) return COLOR_UP_SOFT;
		if (g >= -0.03) return COLOR_FLAT;
		if (g >= -0.10) return COLOR_DOWN_SOFT;
		if (g >= -0.15) return COLOR_DOWN_MID;
		return COLOR_DOWN_HARD;
	}

	function clonePt(p) {
		return latLngPlain(p);
	}

	function niceNum(range, round) {
		if (!(range > 0) || !isFinite(range)) return 1;
		var exp = Math.floor(Math.log(range) / Math.LN10);
		var f = range / Math.pow(10, exp);
		var nf;
		if (round) {
			if (f < 1.5) nf = 1;
			else if (f < 3) nf = 2;
			else if (f < 7) nf = 5;
			else nf = 10;
		} else {
			if (f <= 1) nf = 1;
			else if (f <= 2) nf = 2;
			else if (f <= 5) nf = 5;
			else nf = 10;
		}
		return nf * Math.pow(10, exp);
	}

	/** Nice axis ticks covering [min, max]. */
	function niceTicks(min, max, maxTicks) {
		maxTicks = maxTicks || 4;
		if (!(isFinite(min) && isFinite(max))) {
			return { min: 0, max: 1, ticks: [0, 1], step: 1 };
		}
		if (!(max > min)) {
			min -= 1;
			max += 1;
		}
		var range = niceNum(max - min, false);
		var step = niceNum(range / Math.max(1, maxTicks - 1), true);
		var niceMin = Math.floor(min / step) * step;
		var niceMax = Math.ceil(max / step) * step;
		var ticks = [];
		for (var v = niceMin; v <= niceMax + step * 0.5; v += step) {
			ticks.push(Math.round(v * 1e6) / 1e6);
		}
		return { min: niceMin, max: niceMax, ticks: ticks, step: step };
	}

	/** Nice ticks whose step never exceeds maxGap (e.g. X dist ≤ 500 m). */
	function niceTicksMaxGap(min, max, maxGap) {
		if (!(maxGap > 0)) maxGap = 500;
		var span = (isFinite(min) && isFinite(max) && max > min) ? (max - min) : maxGap;
		var count = Math.max(2, Math.ceil(span / maxGap) + 1);
		var t = niceTicks(min, max, count);
		if (t.step <= maxGap) return t;

		var step = niceNum(maxGap, true);
		if (step > maxGap) {
			var cands = [500, 250, 200, 100, 50, 25, 20, 10, 5, 2, 1];
			step = maxGap;
			for (var c = 0; c < cands.length; c++) {
				if (cands[c] <= maxGap) {
					step = cands[c];
					break;
				}
			}
		}
		var niceMin = Math.floor(min / step) * step;
		var niceMax = Math.ceil(max / step) * step;
		var ticks = [];
		for (var v = niceMin; v <= niceMax + step * 0.5; v += step) {
			ticks.push(Math.round(v * 1e6) / 1e6);
		}
		return { min: niceMin, max: niceMax, ticks: ticks, step: step };
	}

	function formatDistLabel(m, useKm) {
		if (useKm) {
			var km = m / 1000;
			return (Math.abs(km) >= 10 ? km.toFixed(0) : km.toFixed(1)) + ' km';
		}
		return Math.round(m) + ' m';
	}

	function formatEleLabel(m) {
		return Math.round(m) + '';
	}

	L.Control.RouteSnap = L.Control.extend({
		options: {
			position: 'topright',
			routeUrl: null,
			routeKey: null,
			routeFn: null,
			profiles: DEFAULT_PROFILES,
			profileKey: 'mtb',
			waypointRadius: 7,
			routeColor: '#00b9fe',
			routeWeight: 4,
			waypointPane: 'digitizePane'
		},

		initialize: function (options) {
			L.setOptions(this, options);
			this._active = false;
			this._penMode = PEN_ROUTE; /* pen for next segment */
			this._waypoints = [];
			this._legMode = []; /* per segment: route|straightElev|straightSkip */
			this._legProfile = []; /* per segment: BRouter profile key */
			this._legLatLngs = []; /* per segment geometry */
			this._waypointMarkers = [];
			this._routeLatLngs = [];
			this._routeLayer = null;
			this._abort = null;
			this._routing = false;
			this._draggingWp = false;
			this._profileKey = this.options.profileKey || 'mtb';
			this._elevProfileOpen = false;
		},

		onAdd: function (map) {
			this._map = map;
			var root = L.DomUtil.create('div', 'leaflet-control leaflet-bar legacy-routesnap');
			this._container = root;

			this._toggleBtn = this._makeBarBtn(root, 'fa-route', 'Digitize', function () {
				if (this._active) {
					if (this._routeLatLngs.length >= 2) this._promptSave();
					else this.deactivate();
				} else {
					this.activate();
				}
			});

			this._infoBox = L.DomUtil.create('div', 'legacy-routesnap-info', root);
			this._infoBox.setAttribute('role', 'tooltip');
			this._infoBox.innerHTML = INFO_HTML;
			this._infoBox.hidden = true;

			L.DomEvent.on(this._toggleBtn, 'mouseenter', this._showInfo, this)
				.on(this._toggleBtn, 'mouseleave', this._hideInfo, this)
				.on(this._toggleBtn, 'focus', this._showInfo, this)
				.on(this._toggleBtn, 'blur', this._hideInfo, this);
			L.DomEvent.on(this._infoBox, 'mouseenter', this._showInfo, this)
				.on(this._infoBox, 'mouseleave', this._hideInfo, this);

			this._panel = L.DomUtil.create('div', 'legacy-routesnap-panel', root);
			this._panel.hidden = true;

			var tools = L.DomUtil.create('div', 'legacy-routesnap-tools', this._panel);
			this._undoBtn = this._makeToolBtn(tools, 'fa-undo', 'Undo', function () {
				this._undo();
			});
			this._penBtn = this._makeToolBtn(tools, 'fa-slash', '', function () {
				this.cyclePenMode();
			});
			this._clearBtn = this._makeToolBtn(tools, 'fa-trash', 'Clear', function () {
				this.clear();
			});
			this._saveBtn = this._makeToolBtn(tools, 'fa-download', 'Save GPX', function () {
				this._promptSave();
			});
			this._elevToggle = L.DomUtil.create('button', 'legacy-routesnap-tool legacy-routesnap-elev-toggle', tools);
			this._elevToggle.type = 'button';
			this._elevToggle.innerHTML = '<span class="legacy-routesnap-elev-toggle-label" aria-hidden="true">&Delta;</span>';
			L.DomEvent.on(this._elevToggle, 'click', L.DomEvent.stop)
				.on(this._elevToggle, 'click', this._toggleElevProfile, this);

			var profileWrap = L.DomUtil.create('label', 'legacy-routesnap-profile', this._panel);
			profileWrap.appendChild(document.createTextNode('Profil'));
			this._profileSelect = L.DomUtil.create('select', '', profileWrap);
			var profiles = this.options.profiles || DEFAULT_PROFILES;
			for (var i = 0; i < profiles.length; i++) {
				var opt = L.DomUtil.create('option', '', this._profileSelect);
				opt.value = profiles[i].key;
				opt.textContent = profiles[i].label;
				if (profiles[i].key === this._profileKey) opt.selected = true;
			}
			L.DomEvent.on(this._profileSelect, 'change', function () {
				this._profileKey = this._profileSelect.value;
				this._setStatus(this._modeHint());
			}, this);

			this._status = L.DomUtil.create('div', 'legacy-routesnap-status', this._panel);
			this._setStatus('Klicke Waypoints auf die Karte');

			var elevBlock = L.DomUtil.create('div', 'legacy-routesnap-elev-block', this._panel);
			this._elevBody = L.DomUtil.create('div', 'legacy-routesnap-elev-body', elevBlock);
			this._elevMeta = L.DomUtil.create('div', 'legacy-routesnap-elev-meta', this._elevBody);
			this._elevChart = L.DomUtil.create('div', 'legacy-routesnap-elev-chart', this._elevBody);
			this._syncElevToggle();
			this._updateElevPanel();

			L.DomEvent.disableClickPropagation(root);
			L.DomEvent.disableScrollPropagation(root);
			this._syncToolState();
			return root;
		},

		onRemove: function () {
			this.deactivate();
			this.clear();
			this._map = null;
		},

		isActive: function () {
			return !!this._active;
		},

		getPenMode: function () {
			return this._penMode;
		},

		setPenMode: function (mode) {
			if (PEN_CYCLE.indexOf(mode) < 0) mode = PEN_ROUTE;
			if (this._penMode === mode) return this;
			this._penMode = mode;
			if (this._map) this._map.fire('routesnap:pen', { mode: mode });
			this._setStatus(this._modeHint());
			this._syncToolState();
			return this;
		},

		cyclePenMode: function () {
			var i = PEN_CYCLE.indexOf(this._penMode);
			if (i < 0) i = 0;
			return this.setPenMode(PEN_CYCLE[(i + 1) % PEN_CYCLE.length]);
		},

		activate: function () {
			if (this._active || !this._map) return this;
			this._active = true;
			L.DomUtil.addClass(this._toggleBtn, 'legacy-ctrl-selected');
			this._panel.hidden = false;
			L.DomUtil.addClass(this._map.getContainer(), 'legacy-routesnap-crosshair');
			this._map.on('click', this._onMapClick, this);
			this._map.fire('routesnap:activate');
			this._setStatus(this._modeHint());
			this._syncToolState();
			return this;
		},

		deactivate: function () {
			if (!this._active) return this;
			this._closeSaveDialog();
			this._active = false;
			L.DomUtil.removeClass(this._toggleBtn, 'legacy-ctrl-selected');
			this._panel.hidden = true;
			this._hideInfo();
			if (this._map) {
				L.DomUtil.removeClass(this._map.getContainer(), 'legacy-routesnap-crosshair');
				this._map.off('click', this._onMapClick, this);
				this._map.fire('routesnap:deactivate');
			}
			this._cancelRoute();
			this._syncToolState();
			return this;
		},

		clear: function () {
			this._cancelRoute();
			this._clearElevFlash();
			this._waypoints = [];
			this._legMode = [];
			this._legProfile = [];
			this._legLatLngs = [];
			this._routeLatLngs = [];
			this._clearWaypointMarkers();
			this._clearRouteLayer();
			this._setStatus(this._active ? this._modeHint() : '');
			this._updateElevPanel();
			this._syncToolState();
			if (this._map) this._map.fire('routesnap:clear');
			return this;
		},

		getWaypoints: function () {
			return this._waypoints.slice();
		},

		getRouteLatLngs: function () {
			return this._routeLatLngs.slice();
		},

		getProfileKey: function () {
			var hasRouted = false;
			var hasStraight = false;
			var routedKeys = {};
			var routedCount = 0;
			for (var i = 0; i < this._legMode.length; i++) {
				if (isStraightMode(this._legMode[i])) {
					hasStraight = true;
					continue;
				}
				hasRouted = true;
				var pk = this._legProfile[i] || this._profileKey;
				if (!routedKeys[pk]) {
					routedKeys[pk] = true;
					routedCount++;
				}
			}
			if (hasRouted && hasStraight) return 'mixed';
			if (hasStraight && !hasRouted) return 'straight';
			if (routedCount > 1) return 'mixed';
			if (routedCount === 1) {
				for (var k in routedKeys) {
					if (Object.prototype.hasOwnProperty.call(routedKeys, k)) return k;
				}
			}
			return this._profileKey;
		},

		_profileLabel: function (key) {
			var profiles = this.options.profiles || DEFAULT_PROFILES;
			for (var i = 0; i < profiles.length; i++) {
				if (profiles[i].key === key) return profiles[i].label;
			}
			return key || 'BRouter';
		},

		_penModeLabel: function (mode) {
			if (mode === PEN_STRAIGHT_ELEV) return 'Gerade inkl. Höhe';
			if (mode === PEN_STRAIGHT_SKIP) return 'Gerade exkl. Höhe';
			return this._profileLabel(this._profileKey);
		},

		_modeHint: function () {
			return 'Stift: ' + this._penModeLabel(this._penMode) + ' · nächstes Segment';
		},

		_chordSummary: function () {
			var se = 0;
			var ss = 0;
			var r = 0;
			var labels = [];
			var seen = {};
			for (var i = 0; i < this._legMode.length; i++) {
				var m = this._legMode[i];
				if (m === PEN_STRAIGHT_ELEV) {
					se++;
					continue;
				}
				if (m === PEN_STRAIGHT_SKIP) {
					ss++;
					continue;
				}
				r++;
				var pk = this._legProfile[i] || this._profileKey;
				if (!seen[pk]) {
					seen[pk] = true;
					labels.push(this._profileLabel(pk));
				}
			}
			var parts = [r + ' geroutet'];
			if (se) parts.push(se + ' Gerade inkl. Höhe');
			if (ss) parts.push(ss + ' Gerade exkl. Höhe');
			var out = parts.join(' / ');
			if (labels.length) out += ' · ' + labels.join('+');
			return out;
		},

		_showInfo: function () {
			if (this._active) return;
			if (this._infoHideTimer) {
				clearTimeout(this._infoHideTimer);
				this._infoHideTimer = null;
			}
			if (this._infoBox) this._infoBox.hidden = false;
		},

		_hideInfo: function () {
			var self = this;
			if (this._infoHideTimer) clearTimeout(this._infoHideTimer);
			this._infoHideTimer = setTimeout(function () {
				self._infoHideTimer = null;
				if (self._infoBox) self._infoBox.hidden = true;
			}, 120);
		},

		_makeBarBtn: function (parent, icon, title, fn) {
			var a = L.DomUtil.create('a', 'legacy-routesnap-toggle', parent);
			a.href = '#';
			a.removeAttribute('title');
			a.setAttribute('role', 'button');
			a.setAttribute('aria-label', title);
			a.innerHTML = '<i class="fas ' + icon + '" aria-hidden="true"></i>';
			L.DomEvent.on(a, 'click', L.DomEvent.stop)
				.on(a, 'click', fn, this);
			return a;
		},

		_makeToolBtn: function (parent, icon, title, fn) {
			var btn = L.DomUtil.create('button', 'legacy-routesnap-tool', parent);
			btn.type = 'button';
			btn.title = title;
			btn.setAttribute('aria-label', title);
			btn.innerHTML = '<i class="fas ' + icon + '" aria-hidden="true"></i>';
			L.DomEvent.on(btn, 'click', L.DomEvent.stop)
				.on(btn, 'click', fn, this);
			return btn;
		},

		_onMapClick: function (e) {
			if (!this._active || this._draggingWp || this._routing) return;
			this._waypoints.push(e.latlng);
			this._renderWaypoints();
			if (this._waypoints.length >= 2) {
				this._legMode.push(this._penMode);
				this._legProfile.push(this._profileKey);
				this._legLatLngs.push(null);
				this._resolveLegs([this._legMode.length - 1]);
			} else {
				this._setStatus('Noch einen Waypoint setzen');
				this._syncToolState();
			}
		},

		_undo: function () {
			if (!this._waypoints.length) return;
			this._waypoints.pop();
			if (this._legMode.length) {
				this._legMode.pop();
				this._legProfile.pop();
				this._legLatLngs.pop();
			}
			this._renderWaypoints();
			if (this._waypoints.length >= 2) {
				this._stitchAndDraw();
				this._setStatus(this._chordSummary());
			} else {
				this._cancelRoute();
				this._routeLatLngs = [];
				this._clearRouteLayer();
				this._setStatus(this._waypoints.length ? 'Noch einen Waypoint setzen' : this._modeHint());
				this._updateElevPanel();
			}
			this._syncToolState();
		},

		_save: function (fileName) {
			if (this._routeLatLngs.length < 2) return false;
			var legs = [];
			for (var i = 0; i < this._legMode.length; i++) {
				legs.push({
					mode: this._legMode[i],
					straight: isStraightMode(this._legMode[i]),
					profileKey: this._legProfile[i] || this._profileKey,
					latLngs: (this._legLatLngs[i] || []).map(clonePt)
				});
			}
			var payload = {
				latLngs: this._routeLatLngs.map(clonePt),
				profileKey: this.getProfileKey(),
				penMode: this._penMode,
				straight: isStraightMode(this._penMode),
				legs: legs,
				waypoints: this._waypoints.map(latLngPlain),
				fileName: fileName || 'legacy_trails_route'
			};
			if (this._map) this._map.fire('routesnap:save', payload);
			return true;
		},

		_sanitizeGpxBaseName: function (raw) {
			var name = String(raw || '').trim();
			if (/\.gpx$/i.test(name)) name = name.slice(0, -4);
			name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '_');
			name = name.replace(/^\.+/, '').replace(/\.+$/, '');
			if (!name) name = 'legacy_trails_route';
			return name;
		},

		/**
		 * Linear-fill ele on consecutive straight runs from flanking BRouter elevs.
		 * Mutates points in _legLatLngs.
		 */
		_fillStraightElev: function () {
			var legs = this._legLatLngs;
			var modes = this._legMode;
			if (!legs || !legs.length) return;

			/* Drop prior interpolated ele on straight legs (keep BRouter ele on route legs). */
			for (var c = 0; c < legs.length; c++) {
				if (!isStraightMode(modes[c]) || !legs[c]) continue;
				for (var ci = 0; ci < legs[c].length; ci++) {
					var cp = legs[c][ci];
					if (cp && Object.prototype.hasOwnProperty.call(cp, 'ele')) delete cp.ele;
				}
			}

			var i = 0;
			while (i < modes.length) {
				if (!isStraightMode(modes[i])) {
					i++;
					continue;
				}
				var runStart = i;
				while (i < modes.length && isStraightMode(modes[i])) i++;
				var runEnd = i - 1; /* inclusive */

				var eA = null;
				var eB = null;
				if (runStart > 0) {
					var prev = legs[runStart - 1];
					if (prev && prev.length) {
						for (var pa = prev.length - 1; pa >= 0; pa--) {
							if (hasEle(prev[pa])) {
								eA = prev[pa].ele;
								break;
							}
						}
					}
				}
				if (runEnd + 1 < legs.length) {
					var next = legs[runEnd + 1];
					if (next && next.length) {
						for (var pb = 0; pb < next.length; pb++) {
							if (hasEle(next[pb])) {
								eB = next[pb].ele;
								break;
							}
						}
					}
				}
				if (eA == null || eB == null || !isFinite(eA) || !isFinite(eB)) continue;

				var runPts = [];
				var aliases = []; /* same-location junction pts that share an index */
				for (var L = runStart; L <= runEnd; L++) {
					var pts = legs[L];
					if (!pts || pts.length < 2) continue;
					for (var j = 0; j < pts.length; j++) {
						if (runPts.length && j === 0 && samePoint(runPts[runPts.length - 1], pts[j])) {
							aliases.push({ index: runPts.length - 1, pt: pts[j] });
							continue;
						}
						runPts.push(pts[j]);
					}
				}
				if (runPts.length < 2) continue;

				var cum = [0];
				var total = 0;
				for (var d = 1; d < runPts.length; d++) {
					total += horizDistM(runPts[d - 1], runPts[d]);
					cum.push(total);
				}
				if (total <= 0) {
					for (var z = 0; z < runPts.length; z++) runPts[z].ele = eA;
				} else {
					for (var t = 0; t < runPts.length; t++) {
						runPts[t].ele = eA + (cum[t] / total) * (eB - eA);
					}
				}
				for (var ax = 0; ax < aliases.length; ax++) {
					aliases[ax].pt.ele = runPts[aliases[ax].index].ele;
				}
			}
		},

		_elevStats: function () {
			var gain = 0;
			var loss = 0;
			var min = Infinity;
			var max = -Infinity;
			var samples = [];
			var dist = 0;
			var prev = null;

			for (var li = 0; li < this._legLatLngs.length; li++) {
				var pts = this._legLatLngs[li];
				var mode = this._legMode[li];
				if (!pts || pts.length < 2) continue;
				for (var j = 0; j < pts.length; j++) {
					var p = pts[j];
					if (prev && j === 0 && samePoint(prev, p)) continue;
					if (prev && hasEle(prev) && hasEle(p)) {
						var hd = horizDistM(prev, p);
						dist += hd;
						var dEle = p.ele - prev.ele;
						if (countsInElevStats(mode)) {
							if (dEle > 0) gain += dEle;
							else if (dEle < 0) loss += -dEle;
							if (prev.ele < min) min = prev.ele;
							if (p.ele < min) min = p.ele;
							if (prev.ele > max) max = prev.ele;
							if (p.ele > max) max = p.ele;
						}
						if (!samples.length) {
							samples.push({
								dist: dist - hd,
								ele: prev.ele,
								lat: prev.lat,
								lng: prev.lng,
								grade: 0
							});
						}
						samples.push({
							dist: dist,
							ele: p.ele,
							lat: p.lat,
							lng: p.lng,
							grade: 0
						});
					} else if (prev) {
						dist += horizDistM(prev, p);
					}
					prev = p;
				}
			}

			if (!isFinite(min)) min = null;
			if (!isFinite(max)) max = null;

			/* Display/color grade: 50 m window (↑/↓ stats stay raw point-to-point) */
			for (var si = 0; si < samples.length; si++) {
				var gw = gradeWindowed(samples, samples[si].dist, ELEV_GRADE_WINDOW_M);
				samples[si].grade = gw != null && isFinite(gw) ? gw : 0;
			}

			return {
				gain: gain,
				loss: loss,
				min: min,
				max: max,
				samples: samples,
				totalDist: dist
			};
		},

		_elevStatsSummary: function (stats) {
			if (!stats || (stats.min == null && !stats.samples.length)) {
				return 'Höhe: — (keine BRouter-Höhe)';
			}
			var g = Math.round(stats.gain);
			var l = Math.round(stats.loss);
			var hi = stats.max != null ? Math.round(stats.max) : '—';
			var lo = stats.min != null ? Math.round(stats.min) : '—';
			return '↑' + g + ' m  ↓' + l + ' m · high ' + hi + ' m / low ' + lo + ' m';
		},

		_toggleElevProfile: function () {
			this._elevProfileOpen = !this._elevProfileOpen;
			this._syncElevToggle();
			if (this._elevProfileOpen) this._updateElevPanel();
		},

		_syncElevToggle: function () {
			var open = !!this._elevProfileOpen;
			if (this._elevBody) this._elevBody.hidden = !open;
			if (!this._elevToggle) return;
			this._elevToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
			this._elevToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
			this._elevToggle.title = open ? 'Höhenprofil ausblenden' : 'Höhenprofil einblenden';
			this._elevToggle.setAttribute('aria-label', this._elevToggle.title);
			if (open) L.DomUtil.addClass(this._elevToggle, 'is-active');
			else L.DomUtil.removeClass(this._elevToggle, 'is-active');
		},

		_updateElevPanel: function () {
			if (!this._elevChart) return;
			if (!this._elevProfileOpen) {
				if (this._elevMeta) this._elevMeta.textContent = '';
				return;
			}
			var hasRoute = this._routeLatLngs && this._routeLatLngs.length >= 2;
			var stats = hasRoute ? this._elevStats() : null;
			if (this._elevMeta) {
				this._elevMeta.textContent = hasRoute
					? this._elevStatsSummary(stats)
					: 'Höhe: —';
			}
			this._elevChart.innerHTML = this._elevProfileSvg(stats, { height: 118 });
			this._bindElevLoupe(this._elevChart);
		},

		/**
		 * Elev profile SVG with X (distance) / Y (height) axes.
		 * X scale fixed: 100 m = 1 cm; host scrolls horizontally when wider than panel.
		 * @param {object|null} stats from _elevStats
		 * @param {{height?:number}} [opts]
		 */
		_elevProfileSvg: function (stats, opts) {
			opts = opts || {};
			this._elevPlotMeta = null;
			var samples = stats && stats.samples;
			if (!samples || samples.length < 2) {
				return '<div class="legacy-routesnap-sparkline legacy-routesnap-sparkline-empty">Kein Höhenprofil</div>';
			}

			var h = opts.height || 118;
			var padL = 34;
			var padR = 20;
			var padT = 10;
			var padB = 24;
			var plotH = h - padT - padB;
			/* Empty strip inside the frame after the last sample so the right border isn’t flush */
			var plotInnerPadR = 18;

			var minE = Infinity;
			var maxE = -Infinity;
			var maxD = samples[samples.length - 1].dist || 1;
			var i;
			for (i = 0; i < samples.length; i++) {
				if (samples[i].ele < minE) minE = samples[i].ele;
				if (samples[i].ele > maxE) maxE = samples[i].ele;
			}
			if (!(maxD > 0)) maxD = 1;

			var plotDataW = maxD * ELEV_X_PX_PER_M;
			var plotW = plotDataW + plotInnerPadR;
			var w = Math.ceil(padL + plotW + padR);

			var yTicks = niceTicks(minE, maxE, 4);
			var xTicks = niceTicksMaxGap(0, maxD, 500);
			var useKm = maxD >= 1000;
			var yMin = yTicks.min;
			var yMax = yTicks.max;
			if (!(yMax > yMin)) {
				yMin -= 1;
				yMax += 1;
			}

			function xAt(d) {
				return padL + d * ELEV_X_PX_PER_M;
			}
			function yAt(ele) {
				return padT + plotH - ((ele - yMin) / (yMax - yMin)) * plotH;
			}

			var paths = [];
			var curColor = null;
			var curPts = [];

			function flush() {
				if (curPts.length < 2 || !curColor) {
					curPts = [];
					return;
				}
				paths.push({ color: curColor, d: 'M' + curPts.join(' L') });
				curPts = [];
			}

			var prevX = xAt(samples[0].dist);
			var prevY = yAt(samples[0].ele);
			for (i = 1; i < samples.length; i++) {
				var s = samples[i];
				var midD = (samples[i - 1].dist + s.dist) / 2;
				var gWin = gradeWindowed(samples, midD, ELEV_GRADE_WINDOW_M);
				var col = gradeColor(gWin != null ? gWin : (s.grade || 0));
				var x = xAt(s.dist);
				var y = yAt(s.ele);
				if (col !== curColor) {
					flush();
					curColor = col;
					curPts.push(prevX.toFixed(1) + ' ' + prevY.toFixed(1));
				}
				curPts.push(x.toFixed(1) + ' ' + y.toFixed(1));
				prevX = x;
				prevY = y;
			}
			flush();

			/* Frame uses same light stroke as grid so the right edge reads clearly */
			var frameStroke = 'rgba(250, 250, 250, 0.85)';
			var gridStroke = 'rgb(250, 250, 250)';
			var labelFill = 'rgba(240,240,240,0.75)';
			var plotFill = 'rgba(255, 255, 255, 0.51)';

			var pathHtml = '';
			for (i = 0; i < paths.length; i++) {
				pathHtml += '<path fill="none" stroke="' + paths[i].color +
					'" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" d="' +
					paths[i].d + '"/>';
			}
			/* Round end caps */
			var endR = 2.4;
			var endCapFill = '#1e1e22';
			var x0 = xAt(samples[0].dist);
			var y0 = yAt(samples[0].ele);
			var x1 = xAt(samples[samples.length - 1].dist);
			var y1 = yAt(samples[samples.length - 1].ele);
			pathHtml += '<circle cx="' + x0.toFixed(1) + '" cy="' + y0.toFixed(1) +
				'" r="' + endR + '" fill="' + endCapFill + '"/>';
			pathHtml += '<circle cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) +
				'" r="' + endR + '" fill="' + endCapFill + '"/>';

			var svg = '<svg class="legacy-routesnap-sparkline-svg" viewBox="0 0 ' + w + ' ' + h +
				'" width="' + w + '" height="' + h + '" aria-hidden="true">';

			/* Inset frame so stroke is fully visible; light stroke matches grid */
			var fx = padL + 0.5;
			var fy = padT + 0.5;
			var fw = Math.max(0, plotW - 1);
			var fh = Math.max(0, plotH - 1);
			svg += '<rect x="' + fx + '" y="' + fy + '" width="' + fw + '" height="' + fh +
				'" fill="' + plotFill + '" stroke="' + frameStroke + '" stroke-width="1"/>';

			for (i = 0; i < yTicks.ticks.length; i++) {
				var ye = yTicks.ticks[i];
				var yy = yAt(ye);
				if (yy < padT - 0.5 || yy > padT + plotH + 0.5) continue;
				svg += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (padL + plotW) +
					'" y2="' + yy.toFixed(1) + '" stroke="' + gridStroke + '" stroke-width="1"/>';
				svg += '<text x="' + (padL - 4) + '" y="' + (yy + 3).toFixed(1) +
					'" text-anchor="end" class="legacy-routesnap-axis-label" fill="' + labelFill +
					'" font-size="9">' + formatEleLabel(ye) + '</text>';
			}

			for (i = 0; i < xTicks.ticks.length; i++) {
				var xd = xTicks.ticks[i];
				if (xd < 0) continue;
				var xx = xAt(xd);
				/* Only draw ticks over the data span (not the empty right strip) */
				if (xx < padL - 0.5 || xx > padL + plotDataW + 0.5) continue;
				svg += '<line x1="' + xx.toFixed(1) + '" y1="' + padT + '" x2="' + xx.toFixed(1) +
					'" y2="' + (padT + plotH) + '" stroke="' + gridStroke + '" stroke-width="1"/>';
				svg += '<text x="' + xx.toFixed(1) + '" y="' + (padT + plotH + 14) +
					'" text-anchor="middle" class="legacy-routesnap-axis-label" fill="' + labelFill +
					'" font-size="9">' + formatDistLabel(xd, useKm) + '</text>';
			}

			svg += '<text x="10" y="' + (padT + 9) +
				'" text-anchor="middle" fill="' + labelFill +
				'" font-size="9">m</text>';

			svg += pathHtml;
			svg += '</svg>';

			/* Loupe: same path coords, zoomed via viewBox under cursor */
			var loupe = '<div class="legacy-routesnap-elev-loupe" hidden>' +
				'<svg class="legacy-routesnap-elev-loupe-svg" width="' + ELEV_LOUPE_PX +
				'" height="' + ELEV_LOUPE_PX + '" viewBox="0 0 1 1" aria-hidden="true">' +
				'<rect x="' + fx + '" y="' + fy + '" width="' + fw + '" height="' + fh +
				'" fill="' + plotFill + '" stroke="' + frameStroke + '" stroke-width="1"/>' +
				pathHtml +
				'<line class="legacy-routesnap-elev-loupe-cross-h" stroke="rgba(30,30,34,0.65)" stroke-width="0.25"/>' +
				'<line class="legacy-routesnap-elev-loupe-cross-v" stroke="rgba(30,30,34,0.65)" stroke-width="0.25"/>' +
				'</svg>' +
				'<div class="legacy-routesnap-elev-loupe-readout"></div>' +
				'</div>';

			this._elevPlotMeta = {
				w: w,
				h: h,
				padL: padL,
				padT: padT,
				plotW: plotW,
				plotH: plotH,
				yMin: yMin,
				yMax: yMax,
				samples: samples,
				useKm: useKm
			};

			return '<div class="legacy-routesnap-sparkline">' + svg + loupe + '</div>';
		},

		_clearElevFlash: function () {
			if (this._elevFlashTimer) {
				clearTimeout(this._elevFlashTimer);
				this._elevFlashTimer = null;
			}
			if (this._elevFlashMarker && this._map) {
				this._map.removeLayer(this._elevFlashMarker);
			}
			this._elevFlashMarker = null;
		},

		_flashElevMapPoint: function (ll) {
			var map = this._map;
			if (!map || !ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
			this._clearElevFlash();
			var z = Math.max(map.getZoom(), 16);
			map.setView([ll.lat, ll.lng], z, { animate: true });
			var icon = L.divIcon({
				className: 'legacy-routesnap-elev-flash',
				html: '<span class="legacy-routesnap-elev-flash-ring"></span>' +
					'<span class="legacy-routesnap-elev-flash-dot"></span>',
				iconSize: [110, 110],
				iconAnchor: [55, 55]
			});
			this._elevFlashMarker = L.marker([ll.lat, ll.lng], {
				icon: icon,
				interactive: false,
				keyboard: false,
				zIndexOffset: 2500
			}).addTo(map);
			var self = this;
			this._elevFlashTimer = setTimeout(function () {
				self._clearElevFlash();
			}, 5000);
		},

		_bindElevLoupe: function (host) {
			var self = this;
			var spark = host && host.querySelector('.legacy-routesnap-sparkline');
			var mainSvg = spark && spark.querySelector('.legacy-routesnap-sparkline-svg');
			var loupe = spark && spark.querySelector('.legacy-routesnap-elev-loupe');
			var loupeSvg = loupe && loupe.querySelector('.legacy-routesnap-elev-loupe-svg');
			var crossH = loupe && loupe.querySelector('.legacy-routesnap-elev-loupe-cross-h');
			var crossV = loupe && loupe.querySelector('.legacy-routesnap-elev-loupe-cross-v');
			var readout = loupe && loupe.querySelector('.legacy-routesnap-elev-loupe-readout');
			var meta = this._elevPlotMeta;
			if (!spark || !mainSvg || !loupe || !loupeSvg || !meta) return;

			function plotCoords(e) {
				var rect = mainSvg.getBoundingClientRect();
				if (!(rect.width > 0) || !(rect.height > 0)) return null;
				var svgX = (e.clientX - rect.left) * (meta.w / rect.width);
				var svgY = (e.clientY - rect.top) * (meta.h / rect.height);
				if (
					svgX < meta.padL || svgX > meta.padL + meta.plotW ||
					svgY < meta.padT || svgY > meta.padT + meta.plotH
				) {
					return null;
				}
				return { svgX: svgX, svgY: svgY };
			}

			function hide() {
				loupe.hidden = true;
			}

			function onMove(e) {
				var c = plotCoords(e);
				if (!c) {
					hide();
					return;
				}
				var svgX = c.svgX;
				var svgY = c.svgY;

				var vw = ELEV_LOUPE_PX / ELEV_LOUPE_ZOOM;
				var vh = ELEV_LOUPE_PX / ELEV_LOUPE_ZOOM;
				loupeSvg.setAttribute(
					'viewBox',
					(svgX - vw / 2) + ' ' + (svgY - vh / 2) + ' ' + vw + ' ' + vh
				);

				if (crossH) {
					crossH.setAttribute('x1', svgX - vw / 2);
					crossH.setAttribute('x2', svgX + vw / 2);
					crossH.setAttribute('y1', svgY);
					crossH.setAttribute('y2', svgY);
				}
				if (crossV) {
					crossV.setAttribute('x1', svgX);
					crossV.setAttribute('x2', svgX);
					crossV.setAttribute('y1', svgY - vh / 2);
					crossV.setAttribute('y2', svgY + vh / 2);
				}

				var sRect = spark.getBoundingClientRect();
				var lx = e.clientX - sRect.left - ELEV_LOUPE_PX / 2;
				var ly = e.clientY - sRect.top - ELEV_LOUPE_PX / 2;
				loupe.style.transform = 'translate(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px)';
				loupe.hidden = false;

				if (readout) {
					var d = (svgX - meta.padL) / ELEV_X_PX_PER_M;
					var ele = elevAtDist(meta.samples, d);
					var grade = gradeAtDist(meta.samples, d);
					var distStr = formatDistLabel(Math.max(0, d), meta.useKm);
					var eleStr = ele != null && isFinite(ele) ? Math.round(ele) + ' m' : '—';
					readout.textContent = distStr + ' · ' + eleStr + ' · ' + formatGradePct(grade);
				}
			}

			function onClick(e) {
				var c = plotCoords(e);
				if (!c) return;
				L.DomEvent.stop(e);
				var d = (c.svgX - meta.padL) / ELEV_X_PX_PER_M;
				var ll = latLngAtDist(meta.samples, Math.max(0, d));
				if (ll) self._flashElevMapPoint(ll);
			}

			L.DomEvent.on(spark, 'pointermove', onMove);
			L.DomEvent.on(spark, 'pointerleave', hide);
			L.DomEvent.on(spark, 'pointerdown', onMove);
			L.DomEvent.on(spark, 'click', onClick);
		},

		_promptSave: function () {
			if (this._routeLatLngs.length < 2) return;
			if (this._saveDialog) this._closeSaveDialog();

			var self = this;
			var stats = this._elevStats();

			var overlay = L.DomUtil.create('div', 'legacy-routesnap-dialog-overlay');
			overlay.setAttribute('role', 'dialog');
			overlay.setAttribute('aria-modal', 'true');
			overlay.setAttribute('aria-labelledby', 'legacy-routesnap-dialog-title');

			var frame = L.DomUtil.create('div', 'legacy-panel-frame legacy-routesnap-dialog-frame', overlay);
			var box = L.DomUtil.create('div', 'legacy-panel-inner legacy-routesnap-dialog-box', frame);

			var title = L.DomUtil.create('h3', 'legacy-routesnap-dialog-title', box);
			title.id = 'legacy-routesnap-dialog-title';
			title.textContent = 'Route speichern?';

			var nameLabel = L.DomUtil.create('label', 'legacy-routesnap-dialog-label', box);
			nameLabel.setAttribute('for', 'legacy-routesnap-gpx-name');
			nameLabel.textContent = 'Dateiname';

			var nameRow = L.DomUtil.create('div', 'legacy-routesnap-dialog-name-row', box);
			var nameInput = L.DomUtil.create('input', 'legacy-routesnap-dialog-name', nameRow);
			nameInput.type = 'text';
			nameInput.id = 'legacy-routesnap-gpx-name';
			nameInput.value = 'legacy_trails_route';
			nameInput.autocomplete = 'off';
			nameInput.spellcheck = false;
			var ext = L.DomUtil.create('span', 'legacy-routesnap-dialog-ext', nameRow);
			ext.textContent = '.gpx';

			var meta = L.DomUtil.create('p', 'legacy-routesnap-dialog-meta', box);
			meta.textContent = this._chordSummary();

			var elevMeta = L.DomUtil.create('p', 'legacy-routesnap-dialog-meta legacy-routesnap-dialog-elev', box);
			elevMeta.textContent = this._elevStatsSummary(stats);

			var sparkHost = L.DomUtil.create('div', 'legacy-routesnap-dialog-spark', box);
			sparkHost.innerHTML = this._elevProfileSvg(stats, { height: 130 });
			this._bindElevLoupe(sparkHost);

			var hint = L.DomUtil.create('p', 'legacy-routesnap-dialog-meta', box);
			hint.textContent = 'Speichern lädt die GPX und entfernt die Route. Abbrechen beendet Router, Route bleibt.';

			var actions = L.DomUtil.create('div', 'legacy-routesnap-dialog-actions', box);

			function finish(doSave) {
				var base = self._sanitizeGpxBaseName(nameInput.value);
				self._closeSaveDialog();
				if (doSave) {
					self._save(base);
					self.clear();
				}
				self.deactivate();
			}

			var cancelBtn = L.DomUtil.create('button', 'legacy-routesnap-dialog-btn legacy-routesnap-dialog-btn-ghost', actions);
			cancelBtn.type = 'button';
			cancelBtn.textContent = 'Abbrechen';
			L.DomEvent.on(cancelBtn, 'click', function () { finish(false); });

			var saveBtn = L.DomUtil.create('button', 'legacy-routesnap-dialog-btn legacy-routesnap-dialog-btn-primary', actions);
			saveBtn.type = 'button';
			saveBtn.textContent = 'Speichern';
			L.DomEvent.on(saveBtn, 'click', function () { finish(true); });

			L.DomEvent.on(nameInput, 'keydown', function (e) {
				if (e.key === 'Enter') {
					L.DomEvent.preventDefault(e);
					finish(true);
				} else if (e.key === 'Escape') {
					L.DomEvent.preventDefault(e);
					finish(false);
				}
			});

			L.DomEvent.on(overlay, 'click', function (e) {
				if (e.target === overlay) finish(false);
			});
			L.DomEvent.disableClickPropagation(frame);
			L.DomEvent.on(frame, 'mousedown', L.DomEvent.stopPropagation);

			var host = (this._map && this._map.getContainer()) || document.body;
			host.appendChild(overlay);
			this._saveDialog = overlay;
			setTimeout(function () {
				nameInput.focus();
				nameInput.select();
			}, 0);
		},

		_closeSaveDialog: function () {
			if (!this._saveDialog) return;
			if (this._saveDialog.parentNode) {
				this._saveDialog.parentNode.removeChild(this._saveDialog);
			}
			this._saveDialog = null;
		},

		_resolveRouteFn: function () {
			if (typeof this.options.routeFn === 'function') return this.options.routeFn;
			var url = this.options.routeUrl;
			if (!url || !global.BRouterClient) {
				return function () {
					return Promise.reject(new Error('no routeFn / routeUrl'));
				};
			}
			var routeKey = this.options.routeKey;
			return function (waypoints, profile, opts) {
				opts = opts || {};
				if (routeKey && opts.routeKey == null) opts.routeKey = routeKey;
				return global.BRouterClient.route(url, waypoints, profile, opts);
			};
		},

		_legEndpoints: function (legIndex) {
			return [
				latLngPlain(this._waypoints[legIndex]),
				latLngPlain(this._waypoints[legIndex + 1])
			];
		},

		_previewAdjacent: function (wpIndex) {
			var idxs = [];
			if (wpIndex > 0) idxs.push(wpIndex - 1);
			if (wpIndex < this._waypoints.length - 1) idxs.push(wpIndex);
			for (var i = 0; i < idxs.length; i++) {
				var li = idxs[i];
				this._legLatLngs[li] = this._legEndpoints(li);
			}
			this._stitchAndDraw();
		},

		_resolveLegs: function (legIndices) {
			var self = this;
			if (!this._waypoints || this._waypoints.length < 2) return;

			var indices = legIndices;
			if (!indices || !indices.length) {
				indices = [];
				for (var a = 0; a < this._legMode.length; a++) indices.push(a);
			}

			this._cancelRoute();
			var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
			this._abort = ac;

			var routeFn = this._resolveRouteFn();
			var jobs = [];
			var needsNet = false;

			for (var i = 0; i < indices.length; i++) {
				(function (legIndex) {
					/* Drag / reroute: adopt current pen (Route profile or Gerade inkl./exkl. Höhe) */
					self._legMode[legIndex] = self._penMode;
					self._legProfile[legIndex] = self._profileKey;
					if (isStraightMode(self._legMode[legIndex])) {
						self._legLatLngs[legIndex] = self._legEndpoints(legIndex);
						jobs.push(Promise.resolve({ legIndex: legIndex, latLngs: self._legLatLngs[legIndex] }));
						return;
					}
					needsNet = true;
					jobs.push(
						Promise.resolve(routeFn(self._legEndpoints(legIndex), self._profileKey, { signal: ac && ac.signal }))
							.then(function (latLngs) {
								return { legIndex: legIndex, latLngs: latLngs };
							})
					);
				})(indices[i]);
			}

			if (needsNet) {
				this._routing = true;
				this._setStatus('Routing…');
				this._syncToolState();
			}

			Promise.all(jobs)
				.then(function (results) {
					if (ac && ac.signal.aborted) return;
					for (var r = 0; r < results.length; r++) {
						var item = results[r];
						if (!item.latLngs || item.latLngs.length < 2) {
							throw new Error('leeres Segment ' + (item.legIndex + 1));
						}
						self._legLatLngs[item.legIndex] = item.latLngs;
					}
					self._routing = false;
					self._abort = null;
					self._stitchAndDraw();
					self._setStatus(self._chordSummary() + ' · ' + self._modeHint());
					self._syncToolState();
				})
				.catch(function (err) {
					if (ac && ac.signal.aborted) return;
					if (err && err.name === 'AbortError') return;
					self._routing = false;
					self._abort = null;
					var msg = 'Router derzeit nicht verfügbar..';
					self._setStatus(msg);
					self._syncToolState();
					if (self._map) self._map.fire('routesnap:error', { error: err, message: msg });
				});
		},

		_stitchAndDraw: function () {
			this._fillStraightElev();
			var stitched = [];
			for (var i = 0; i < this._legLatLngs.length; i++) {
				var pts = this._legLatLngs[i];
				if (!pts || pts.length < 2) continue;
				for (var j = 0; j < pts.length; j++) {
					if (stitched.length && j === 0 && samePoint(stitched[stitched.length - 1], pts[j])) continue;
					stitched.push(pts[j]);
				}
			}
			this._routeLatLngs = stitched;
			this._drawRoute();
			this._updateElevPanel();
		},

		_cancelRoute: function () {
			if (this._abort) {
				try { this._abort.abort(); } catch (e) { /* ignore */ }
				this._abort = null;
			}
			this._routing = false;
		},

		_renderWaypoints: function () {
			this._clearWaypointMarkers();
			if (!this._map) return;
			for (var i = 0; i < this._waypoints.length; i++) {
				this._waypointMarkers.push(this._makeWaypointMarker(i, this._waypoints[i]));
			}
		},

		_makeWaypointMarker: function (index, latlng) {
			var self = this;
			var icon = L.divIcon({
				className: 'legacy-routesnap-wp',
				html: '<span class="legacy-routesnap-wp-num">' + (index + 1) + '</span>',
				iconSize: [18, 18],
				iconAnchor: [9, 9]
			});
			var marker = L.marker(latlng, {
				icon: icon,
				draggable: true,
				autoPan: true,
				keyboard: false,
				pane: this.options.waypointPane || 'markerPane',
				zIndexOffset: 600
			});
			marker._rsIndex = index;
			marker.on('dragstart', function () {
				self._draggingWp = true;
				self._cancelRoute();
			});
			marker.on('drag', function (e) {
				var idx = e.target._rsIndex;
				self._waypoints[idx] = e.target.getLatLng();
				if (self._waypoints.length >= 2) self._previewAdjacent(idx);
			});
			marker.on('dragend', function (e) {
				var idx = e.target._rsIndex;
				self._waypoints[idx] = e.target.getLatLng();
				var legs = [];
				if (idx > 0) legs.push(idx - 1);
				if (idx < self._waypoints.length - 1) legs.push(idx);
				if (legs.length) self._resolveLegs(legs);
				else self._syncToolState();
				setTimeout(function () {
					self._draggingWp = false;
				}, 0);
			});
			marker.addTo(this._map);
			return marker;
		},

		_onLegMouseDown: function (legIndex, e) {
			if (!this._active || this._routing || this._draggingWp) return;
			if (legIndex < 0 || legIndex >= this._legMode.length) return;
			L.DomEvent.stop(e);
			L.DomEvent.preventDefault(e);

			var self = this;
			var map = this._map;
			var mode = this._legMode[legIndex];
			var profile = this._profileKey;
			var insertAt = legIndex + 1;
			var startLl = e.latlng;

			this._draggingWp = true;
			this._cancelRoute();
			if (map.dragging) map.dragging.disable();

			this._waypoints.splice(insertAt, 0, startLl);
			this._legMode.splice(legIndex, 1, mode, mode);
			this._legProfile.splice(legIndex, 1, profile, profile);
			this._legLatLngs.splice(legIndex, 1, this._legEndpoints(legIndex), this._legEndpoints(legIndex + 1));
			this._renderWaypoints();
			this._stitchAndDraw();

			var dragIdx = insertAt;

			function onMove(ev) {
				self._waypoints[dragIdx] = ev.latlng;
				if (self._waypointMarkers[dragIdx]) {
					self._waypointMarkers[dragIdx].setLatLng(ev.latlng);
				}
				self._previewAdjacent(dragIdx);
			}

			function onUp(ev) {
				map.off('mousemove', onMove);
				map.off('mouseup', onUp);
				if (map.dragging) map.dragging.enable();
				if (ev && ev.latlng) self._waypoints[dragIdx] = ev.latlng;
				if (self._waypointMarkers[dragIdx]) {
					self._waypointMarkers[dragIdx].setLatLng(self._waypoints[dragIdx]);
				}
				var legs = [];
				if (dragIdx > 0) legs.push(dragIdx - 1);
				if (dragIdx < self._waypoints.length - 1) legs.push(dragIdx);
				if (legs.length) self._resolveLegs(legs);
				else self._syncToolState();
				setTimeout(function () {
					self._draggingWp = false;
				}, 0);
			}

			map.on('mousemove', onMove);
			map.on('mouseup', onUp);
		},

		_drawRoute: function () {
			this._clearRouteLayer();
			if (!this._map || !this._legLatLngs.length) return;
			var self = this;
			var layers = [];
			for (var i = 0; i < this._legLatLngs.length; i++) {
				var pts = this._legLatLngs[i];
				if (!pts || pts.length < 2) continue;
				var straight = isStraightMode(this._legMode[i]);
				layers.push(L.polyline(pts, {
					color: '#2f2f2f',
					weight: this.options.routeWeight + 3,
					opacity: 0.35,
					lineCap: 'round',
					lineJoin: 'round',
					interactive: false
				}));
				layers.push(L.polyline(pts, {
					color: this.options.routeColor,
					weight: this.options.routeWeight,
					opacity: 0.95,
					lineCap: 'round',
					lineJoin: 'round',
					dashArray: straight ? '7 6' : null,
					interactive: false
				}));
				(function (legIndex) {
					var hit = L.polyline(pts, {
						weight: 16,
						opacity: 0,
						interactive: true,
						className: 'legacy-routesnap-leg-hit',
						bubblingMouseEvents: false
					});
					hit.on('mousedown', function (ev) {
						self._onLegMouseDown(legIndex, ev);
					});
					layers.push(hit);
				})(i);
			}
			if (!layers.length) return;
			this._routeLayer = L.layerGroup(layers).addTo(this._map);
		},

		_clearWaypointMarkers: function () {
			for (var i = 0; i < this._waypointMarkers.length; i++) {
				this._map && this._map.removeLayer(this._waypointMarkers[i]);
			}
			this._waypointMarkers = [];
		},

		_clearRouteLayer: function () {
			if (this._routeLayer && this._map) this._map.removeLayer(this._routeLayer);
			this._routeLayer = null;
		},

		_setStatus: function (text) {
			if (this._status) this._status.textContent = text || '';
		},

		_syncPenBtn: function () {
			if (!this._penBtn) return;
			var mode = this._penMode;
			var title;
			L.DomUtil.removeClass(this._penBtn, 'is-active');
			L.DomUtil.removeClass(this._penBtn, 'is-pen-skip');
			if (mode === PEN_STRAIGHT_ELEV) {
				title = 'Stift: Gerade inkl. Höhe (Klick → Gerade exkl. Höhe)';
				L.DomUtil.addClass(this._penBtn, 'is-active');
			} else if (mode === PEN_STRAIGHT_SKIP) {
				title = 'Stift: Gerade exkl. Höhe (Klick → Route)';
				L.DomUtil.addClass(this._penBtn, 'is-active');
				L.DomUtil.addClass(this._penBtn, 'is-pen-skip');
			} else {
				title = 'Stift: Route (Klick → Gerade inkl. Höhe)';
			}
			this._penBtn.title = title;
			this._penBtn.setAttribute('aria-label', title);
		},

		_syncToolState: function () {
			var hasWp = this._waypoints.length > 0;
			var hasRoute = this._routeLatLngs.length >= 2;
			if (this._undoBtn) this._undoBtn.disabled = !hasWp || this._routing;
			if (this._clearBtn) this._clearBtn.disabled = !hasWp || this._routing;
			if (this._saveBtn) this._saveBtn.disabled = !hasRoute || this._routing;
			if (this._penBtn) {
				this._penBtn.disabled = this._routing;
				this._syncPenBtn();
			}
			if (this._profileSelect) {
				this._profileSelect.disabled = this._routing;
			}
		}
	});

	L.control.routeSnap = function (options) {
		return new L.Control.RouteSnap(options);
	};
})(typeof window !== 'undefined' ? window : this, typeof L !== 'undefined' ? L : null);
