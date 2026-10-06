/**
 * Digitize: waypoints + per-segment straight|BRouter legs.
 * Straight + profile pens apply only to the next segment (not the last drawn).
 * Drag waypoints or route → re-resolve adjacent segments. Digitize again → GPX.
 */
(function (global, L) {
	'use strict';

	if (!L || !L.Control) return;

	var DEFAULT_PROFILES = [
		{ key: 'mtb', label: 'MTB' },
		{ key: 'trekking', label: 'Trekking' },
		{ key: 'hiking-mountain', label: 'Hiking' }
	];

	var INFO_HTML =
		'<strong>Digitize</strong>' +
		'<ul>' +
		'<li>Klick = Waypoint</li>' +
		'<li>Jedes Segment einzeln: Profil / Gerade</li>' +
		'<li>Profil + Gerade-Button = Stift fürs <em>nächste</em> Segment</li>' +
		'<li>Waypoint oder Route ziehen = Segmente anpassen</li>' +
		'<li>GPX-Dialog: Speichern = Download + Route weg; Abbrechen = Digitize aus, Route bleibt</li>' +
		'</ul>';

	function latLngPlain(ll) {
		return { lat: ll.lat, lng: ll.lng };
	}

	function samePoint(a, b) {
		return a && b && a.lat === b.lat && a.lng === b.lng;
	}

	L.Control.RouteSnap = L.Control.extend({
		options: {
			position: 'topright',
			routeUrl: null,
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
			this._straight = false; /* pen for next segment */
			this._waypoints = [];
			this._legStraight = []; /* per segment: true = straight */
			this._legProfile = []; /* per segment: BRouter profile key */
			this._legLatLngs = []; /* per segment geometry */
			this._waypointMarkers = [];
			this._routeLatLngs = [];
			this._routeLayer = null;
			this._abort = null;
			this._routing = false;
			this._draggingWp = false;
			this._profileKey = this.options.profileKey || 'mtb';
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
			this._straightBtn = this._makeToolBtn(tools, 'fa-slash', 'Gerade-Stift für nächstes Segment', function () {
				this.setStraight(!this._straight);
			});
			this._clearBtn = this._makeToolBtn(tools, 'fa-trash', 'Clear', function () {
				this.clear();
			});
			this._saveBtn = this._makeToolBtn(tools, 'fa-download', 'Save GPX', function () {
				this._promptSave();
			});

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

		isStraight: function () {
			return !!this._straight;
		},

		setStraight: function (on) {
			on = !!on;
			if (this._straight === on) return this;
			this._straight = on;
			if (this._straightBtn) {
				if (on) L.DomUtil.addClass(this._straightBtn, 'is-active');
				else L.DomUtil.removeClass(this._straightBtn, 'is-active');
			}
			if (this._map) this._map.fire('routesnap:straight', { straight: on });
			this._setStatus(this._modeHint());
			this._syncToolState();
			return this;
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
			this._waypoints = [];
			this._legStraight = [];
			this._legProfile = [];
			this._legLatLngs = [];
			this._routeLatLngs = [];
			this._clearWaypointMarkers();
			this._clearRouteLayer();
			this._setStatus(this._active ? this._modeHint() : '');
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
			for (var i = 0; i < this._legStraight.length; i++) {
				if (this._legStraight[i]) {
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

		_modeHint: function () {
			return this._straight
				? 'Stift: Gerade · nächstes Segment'
				: 'Stift: ' + this._profileLabel(this._profileKey) + ' · nächstes Segment';
		},

		_chordSummary: function () {
			var s = 0;
			var r = 0;
			var labels = [];
			var seen = {};
			for (var i = 0; i < this._legStraight.length; i++) {
				if (this._legStraight[i]) {
					s++;
					continue;
				}
				r++;
				var pk = this._legProfile[i] || this._profileKey;
				if (!seen[pk]) {
					seen[pk] = true;
					labels.push(this._profileLabel(pk));
				}
			}
			var out = r + ' geroutet / ' + s + ' gerade';
			if (labels.length) out += ' · ' + labels.join('+');
			return out;
		},

		_routedLegIndices: function () {
			var out = [];
			for (var i = 0; i < this._legStraight.length; i++) {
				if (!this._legStraight[i]) out.push(i);
			}
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
				this._legStraight.push(!!this._straight);
				this._legProfile.push(this._profileKey);
				this._legLatLngs.push(null);
				this._resolveLegs([this._legStraight.length - 1]);
			} else {
				this._setStatus('Noch einen Waypoint setzen');
				this._syncToolState();
			}
		},

		_undo: function () {
			if (!this._waypoints.length) return;
			this._waypoints.pop();
			if (this._legStraight.length) {
				this._legStraight.pop();
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
			}
			this._syncToolState();
		},

		_save: function (fileName) {
			if (this._routeLatLngs.length < 2) return false;
			var legs = [];
			for (var i = 0; i < this._legStraight.length; i++) {
				legs.push({
					straight: !!this._legStraight[i],
					profileKey: this._legProfile[i] || this._profileKey,
					latLngs: (this._legLatLngs[i] || []).slice()
				});
			}
			var payload = {
				latLngs: this._routeLatLngs.slice(),
				profileKey: this.getProfileKey(),
				straight: this._straight,
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

		_promptSave: function () {
			if (this._routeLatLngs.length < 2) return;
			if (this._saveDialog) this._closeSaveDialog();

			var self = this;
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

			var hint = L.DomUtil.create('p', 'legacy-routesnap-dialog-meta', box);
			hint.textContent = 'Speichern lädt die GPX und entfernt die Route. Abbrechen beendet Digitize, Route bleibt.';

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
			return function (waypoints, profile, opts) {
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
				for (var a = 0; a < this._legStraight.length; a++) indices.push(a);
			}

			this._cancelRoute();
			var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
			this._abort = ac;

			var routeFn = this._resolveRouteFn();
			var jobs = [];
			var needsNet = false;

			for (var i = 0; i < indices.length; i++) {
				(function (legIndex) {
					if (self._legStraight[legIndex]) {
						self._legLatLngs[legIndex] = self._legEndpoints(legIndex);
						jobs.push(Promise.resolve({ legIndex: legIndex, latLngs: self._legLatLngs[legIndex] }));
						return;
					}
					/* Drag / reroute: adopt the profile pen currently selected */
					self._legProfile[legIndex] = self._profileKey;
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
					var msg = (err && err.message) ? err.message : 'Routing fehlgeschlagen';
					self._setStatus(msg);
					self._syncToolState();
					if (self._map) self._map.fire('routesnap:error', { error: err, message: msg });
				});
		},

		_stitchAndDraw: function () {
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
			if (legIndex < 0 || legIndex >= this._legStraight.length) return;
			L.DomEvent.stop(e);
			L.DomEvent.preventDefault(e);

			var self = this;
			var map = this._map;
			var mode = !!this._legStraight[legIndex];
			var profile = this._profileKey;
			var insertAt = legIndex + 1;
			var startLl = e.latlng;

			this._draggingWp = true;
			this._cancelRoute();
			if (map.dragging) map.dragging.disable();

			this._waypoints.splice(insertAt, 0, startLl);
			this._legStraight.splice(legIndex, 1, mode, mode);
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
				var straight = !!this._legStraight[i];
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

		_syncToolState: function () {
			var hasWp = this._waypoints.length > 0;
			var hasRoute = this._routeLatLngs.length >= 2;
			if (this._undoBtn) this._undoBtn.disabled = !hasWp || this._routing;
			if (this._clearBtn) this._clearBtn.disabled = !hasWp || this._routing;
			if (this._saveBtn) this._saveBtn.disabled = !hasRoute || this._routing;
			if (this._straightBtn) {
				this._straightBtn.disabled = this._routing;
				if (this._straight) L.DomUtil.addClass(this._straightBtn, 'is-active');
				else L.DomUtil.removeClass(this._straightBtn, 'is-active');
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
