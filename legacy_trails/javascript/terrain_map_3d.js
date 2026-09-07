/**
 * Mapbox 3D terrain overlay for Legacy Trails.
 * Shows all trails; click tip points users back to 2D for interaction.
 * Prefetches GeoJSON + preloads Mapbox off-screen; reveals only when camera is set.
 */
(function (global) {
	'use strict';

	var EMPTY_FC = { type: 'FeatureCollection', features: [] };
	var TRAILS_URL = 'data/my_trails_z.geojson';
	var MAPBOX_TOKEN = 'pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ';
	var CLICK_TIP = 'Für Trail-Infos in die 2D-Ansicht wechseln.';
	/** Inn valley bird's-eye (gpx.studio #zoom/lat/lon/bearing/pitch). */
	var OVERVIEW_CAMERA = {
		center: [11.4098, 47.2168],
		zoom: 11,
		bearing: 9,
		pitch: 76
	};

	/** Strip trailing "(123)" IDs from trail names for all UI display. */
	function cleanTrailName(name) {
		if (typeof name !== 'string') return name;
		return name.replace(/\s*\(\d+\)\s*$/, '').trim();
	}

	function cleanTrailFeatureNames(features) {
		for (var i = 0; i < features.length; i++) {
			var p = features[i].properties;
			if (p && typeof p.name === 'string') {
				p.name = cleanTrailName(p.name);
			}
		}
	}

	function segmentLen2d(a, b) {
		var dx = a[0] - b[0];
		var dy = a[1] - b[1];
		return Math.sqrt(dx * dx + dy * dy);
	}

	/** Existing vertex nearest to halfway along 2D trail length. */
	function midpointLengthVertex(coords) {
		if (!coords || !coords.length) return null;
		if (coords.length === 1) return coords[0];
		var seglen = [];
		var total = 0;
		for (var i = 1; i < coords.length; i++) {
			var d = segmentLen2d(coords[i - 1], coords[i]);
			seglen.push(d);
			total += d;
		}
		if (total === 0) return coords[Math.floor(coords.length / 2)];
		var half = total / 2;
		var acc = 0;
		for (var j = 0; j < seglen.length; j++) {
			if (acc + seglen[j] >= half) {
				return half - acc < seglen[j] / 2 ? coords[j] : coords[j + 1];
			}
			acc += seglen[j];
		}
		return coords[coords.length - 1];
	}

	function buildTrailLabelPoints(features) {
		var out = [];
		var boundsByName = Object.create(null);
		for (var i = 0; i < features.length; i++) {
			var f = features[i];
			if (!f || !f.geometry || f.geometry.type !== 'LineString') continue;
			var name = f.properties && f.properties.name;
			if (!name) continue;
			var coords = f.geometry.coordinates;
			var pt = midpointLengthVertex(coords);
			if (!pt) continue;
			out.push({
				type: 'Feature',
				properties: { name: name },
				geometry: {
					type: 'Point',
					coordinates: [pt[0], pt[1], pt[2] != null ? pt[2] : 0]
				}
			});
			var w = Infinity;
			var s = Infinity;
			var e = -Infinity;
			var n = -Infinity;
			for (var j = 0; j < coords.length; j++) {
				var c = coords[j];
				if (c[0] < w) w = c[0];
				if (c[0] > e) e = c[0];
				if (c[1] < s) s = c[1];
				if (c[1] > n) n = c[1];
			}
			if (isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)) {
				boundsByName[name] = [[w, s], [e, n]];
			}
		}
		return {
			labels: { type: 'FeatureCollection', features: out },
			boundsByName: boundsByName
		};
	}

	function TerrainMap3D(containerId) {
		this.containerId = containerId;
		this.map = null;
		this.ready = false;
		this.visible = false;
		this._initPromise = null;
		this._trailsPromise = null;
		this._trailsData = null;
		this._labelData = null;
		this._labelMarkers = null;
		this._trailBoundsByName = null;
		this._userGpxData = EMPTY_FC;
		this._flashTimer = null;
		this._popup = null;
		this._viewportResizeBound = false;
		this._onViewportResize = null;
		this._resizeTimer = null;
		this.heightScale = 1.25;
		this.pitch = 60;
		this.bearing = 30;
	}

	TerrainMap3D.prototype._container = function () {
		return document.getElementById(this.containerId);
	};

	TerrainMap3D.prototype._setPreloading = function (on) {
		var el = this._container();
		if (!el) return;
		if (on) el.classList.add('is-preloading');
		else el.classList.remove('is-preloading');
	};

	TerrainMap3D.prototype._clearFlash = function () {
		if (this._flashTimer) {
			clearInterval(this._flashTimer);
			this._flashTimer = null;
		}
		if (!this.map || !this.ready) return;
		if (this.map.getLayer('trails-flash')) {
			this.map.setLayoutProperty('trails-flash', 'visibility', 'none');
			this.map.setPaintProperty('trails-flash', 'line-opacity', 0.85);
		}
		if (this.map.getLayer('trails-flash-casing')) {
			this.map.setLayoutProperty('trails-flash-casing', 'visibility', 'none');
		}
	};

	TerrainMap3D.prototype._clearLabelMarkers = function () {
		var markers = this._labelMarkers || [];
		for (var i = 0; i < markers.length; i++) {
			markers[i].remove();
		}
		this._labelMarkers = [];
	};

	TerrainMap3D.prototype._syncLabelMarkerZoom = function () {
		if (!this.map) return;
		var show = this.map.getZoom() >= 13;
		var markers = this._labelMarkers || [];
		for (var i = 0; i < markers.length; i++) {
			markers[i].getElement().style.display = show ? '' : 'none';
		}
	};

	TerrainMap3D.prototype.flyToTrailByName = function (trailName, options) {
		if (!trailName || !this.map || !this.ready) return;
		var bounds = this._trailBoundsByName && this._trailBoundsByName[trailName];
		if (!bounds) return;
		options = options || {};
		var pad = options.padding != null ? options.padding : 2;
		this.map.fitBounds(bounds, {
			padding: pad,
			duration: options.duration != null ? options.duration : 1100,
			pitch: this.map.getPitch(),
			bearing: this.map.getBearing()
		});
	};

	TerrainMap3D.prototype._buildLabelMarkers = function () {
		var self = this;
		this._clearLabelMarkers();
		if (!this.map) return;

		var features = (this._labelData && this._labelData.features) || [];
		for (var i = 0; i < features.length; i++) {
			var f = features[i];
			var name = f.properties && f.properties.name;
			if (!name) continue;

			var el = document.createElement('div');
			el.className = 'legacy-3d-trail-label';
			el.setAttribute('role', 'button');
			el.setAttribute('tabindex', '0');
			el.setAttribute('title', name);
			el.innerHTML =
				'<div class="legacy-3d-trail-label-box">' +
					'<div class="legacy-3d-trail-label-inner"></div>' +
				'</div>' +
				'<span class="legacy-3d-trail-label-pin" aria-hidden="true"></span>';
			el.querySelector('.legacy-3d-trail-label-inner').textContent = name;

			(function (trailName) {
				el.addEventListener('click', function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					self.flyToTrailByName(trailName);
					self.flashHighlight(trailName);
				});
				el.addEventListener('keydown', function (ev) {
					if (ev.key !== 'Enter' && ev.key !== ' ') return;
					ev.preventDefault();
					ev.stopPropagation();
					self.flyToTrailByName(trailName);
					self.flashHighlight(trailName);
				});
			})(name);

			var marker = new mapboxgl.Marker({
				element: el,
				anchor: 'bottom',
				offset: [0, 0],
				pitchAlignment: 'viewport',
				rotationAlignment: 'viewport'
			})
				.setLngLat(f.geometry.coordinates)
				.addTo(this.map);

			this._labelMarkers.push(marker);
		}

		this._syncLabelMarkerZoom();
		if (!this._labelZoomBound) {
			this._labelZoomBound = true;
			this.map.on('zoom', function () {
				self._syncLabelMarkerZoom();
			});
		}
	};

	TerrainMap3D.prototype._bindTrailClicks = function () {
		var self = this;
		var hitId = 'trails-hit';

		this.map.on('click', hitId, function (e) {
			if (!e.features || !e.features.length) return;
			if (self._popup) self._popup.remove();

			var tipHtml =
				'<div class="legacy-3d-trail-tip-body">' +
					'<p class="legacy-3d-trail-tip-text">' + CLICK_TIP + '</p>' +
					'<button type="button" class="legacy-3d-tip-2d-btn" aria-label="Zur 2D-Ansicht">' +
						'<i class="fas fa-map" aria-hidden="true"></i>' +
						'<span>2D Ansicht</span>' +
					'</button>' +
				'</div>';

			self._popup = new mapboxgl.Popup({
				closeButton: true,
				closeOnClick: true,
				className: 'legacy-3d-trail-tip',
				maxWidth: '300px',
				offset: 12
			})
				.setLngLat(e.lngLat)
				.setHTML(tipHtml)
				.addTo(self.map);

			var btn = self._popup.getElement().querySelector('.legacy-3d-tip-2d-btn');
			if (btn) {
				btn.addEventListener('click', function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					if (typeof window.legacyExitTerrain3D === 'function') {
						window.legacyExitTerrain3D();
					} else {
						self.hide();
					}
				});
			}
		});

		this.map.on('mouseenter', hitId, function () {
			self.map.getCanvas().style.cursor = 'pointer';
		});
		this.map.on('mouseleave', hitId, function () {
			self.map.getCanvas().style.cursor = '';
		});
	};

	TerrainMap3D.prototype._waitSettled = function () {
		var self = this;
		return new Promise(function (resolve) {
			var settled = false;
			function done() {
				if (settled) return;
				settled = true;
				self.map.off('idle', onIdle);
				resolve();
			}
			function onIdle() {
				done();
			}
			self.map.once('idle', onIdle);
			setTimeout(done, 900);
		});
	};

	TerrainMap3D.prototype.prefetchTrails = function () {
		var self = this;
		if (this._trailsPromise) return this._trailsPromise;

		this._trailsPromise = fetch(TRAILS_URL)
			.then(function (r) {
				if (!r.ok) throw new Error('Failed to load ' + TRAILS_URL);
				return r.json();
			})
			.then(function (trailData) {
				trailData.features = (trailData.features || []).filter(function (f) {
					return f.properties && f.properties.HIDE !== 1;
				});
				cleanTrailFeatureNames(trailData.features);
				self._trailsData = trailData;
				var labelPack = buildTrailLabelPoints(trailData.features);
				self._labelData = labelPack.labels;
				self._trailBoundsByName = labelPack.boundsByName;
				return trailData;
			})
			.catch(function (err) {
				console.error(err);
				self._trailsData = EMPTY_FC;
				self._labelData = EMPTY_FC;
				self._trailBoundsByName = Object.create(null);
				return EMPTY_FC;
			});

		return this._trailsPromise;
	};

	TerrainMap3D.prototype.ensureInit = function () {
		var self = this;
		if (this._initPromise) return this._initPromise;
		if (typeof mapboxgl === 'undefined') {
			return Promise.reject(new Error('mapboxgl not loaded'));
		}

		this._initPromise = this.prefetchTrails().then(function () {
			return new Promise(function (resolve, reject) {
				var el = self._container();
				if (!el) {
					reject(new Error('#' + self.containerId + ' missing'));
					return;
				}

				// Need real layout size while hidden
				self._setPreloading(true);

				mapboxgl.accessToken = MAPBOX_TOKEN;

				self.map = new mapboxgl.Map({
					container: el,
					style: 'mapbox://styles/mapbox/satellite-streets-v12',
					center: OVERVIEW_CAMERA.center,
					zoom: OVERVIEW_CAMERA.zoom,
					pitch: OVERVIEW_CAMERA.pitch,
					bearing: OVERVIEW_CAMERA.bearing,
					antialias: true,
					attributionControl: false
				});

				self.map.addControl(new mapboxgl.AttributionControl({
					compact: false
				}), 'bottom-right');

				self.map.addControl(new mapboxgl.NavigationControl({
					showCompass: true,
					showZoom: true,
					visualizePitch: true
				}), 'bottom-right');

				self.map.on('load', function () {
					self.map.resize();

					self.map.addSource('mapbox-dem', {
						type: 'raster-dem',
						url: 'mapbox://mapbox.terrain-rgb',
						tileSize: 256,
						maxzoom: 15
					});
					self.map.setTerrain({
						source: 'mapbox-dem',
						exaggeration: self.heightScale
					});
					self.map.addLayer({
						id: 'sky',
						type: 'sky',
						paint: {
							'sky-type': 'atmosphere',
							'sky-atmosphere-sun': [0.0, 90.0],
							'sky-atmosphere-sun-intensity': 15
						}
					});

					self.map.addSource('trails', {
						type: 'geojson',
						data: self._trailsData || EMPTY_FC
					});

					self.map.addLayer({
						id: 'trails-casing',
						type: 'line',
						source: 'trails',
						layout: { 'line-join': 'round', 'line-cap': 'round' },
						paint: {
							'line-color': '#2f2f2f',
							'line-width': 13,
							'line-opacity': 0.35
						}
					});
					self.map.addLayer({
						id: 'trails-line',
						type: 'line',
						source: 'trails',
						layout: { 'line-join': 'round', 'line-cap': 'round' },
						paint: {
							'line-color': '#FF5F1F',
							'line-width': 7.2,
							'line-opacity': 0.4
						}
					});
					self.map.addLayer({
						id: 'trails-flash-casing',
						type: 'line',
						source: 'trails',
						layout: {
							'line-join': 'round',
							'line-cap': 'round',
							visibility: 'none'
						},
						paint: {
							'line-color': '#111111',
							'line-width': 16,
							'line-opacity': 0.7
						},
						filter: ['==', ['get', 'name'], '']
					});
					self.map.addLayer({
						id: 'trails-flash',
						type: 'line',
						source: 'trails',
						layout: {
							'line-join': 'round',
							'line-cap': 'round',
							visibility: 'none'
						},
						paint: {
							'line-color': '#FF5F1F',
							'line-width': 10,
							'line-opacity': 0.85
						},
						filter: ['==', ['get', 'name'], '']
					});
					self.map.addLayer({
						id: 'trails-hit',
						type: 'line',
						source: 'trails',
						layout: { 'line-join': 'round', 'line-cap': 'round' },
						paint: {
							'line-color': '#000000',
							'line-width': 18,
							'line-opacity': 0
						}
					});

					self.map.addSource('user-gpx', {
						type: 'geojson',
						data: self._userGpxData || EMPTY_FC
					});
					self.map.addLayer({
						id: 'user-gpx-casing',
						type: 'line',
						source: 'user-gpx',
						layout: {
							'line-join': 'round',
							'line-cap': 'round'
						},
						paint: {
							'line-color': '#2f2f2f',
							'line-width': 6,
							'line-opacity': 0.35
						}
					});
					self.map.addLayer({
						id: 'user-gpx-line',
						type: 'line',
						source: 'user-gpx',
						layout: {
							'line-join': 'round',
							'line-cap': 'butt'
						},
						paint: {
							'line-color': '#00b9fe',
							'line-width': 3,
							'line-opacity': 0.9,
							'line-dasharray': [1.2, 1.1]
						}
					});

					self._buildLabelMarkers();
					self._bindTrailClicks();
					self._bindViewportResize();
					self.ready = true;
					resolve(self);
				});

				self.map.on('error', function (e) {
					console.error('Mapbox 3D error', e && e.error);
				});
			});
		});

		return this._initPromise;
	};

	/** Background warm-up: GeoJSON + Mapbox GL (hidden). */
	TerrainMap3D.prototype.preload = function () {
		return this.ensureInit().catch(function (err) {
			console.error('3D preload failed', err);
		});
	};

	/** Temporary user GPX overlay (thinned GeoJSON FeatureCollection). */
	TerrainMap3D.prototype.setUserGpx = function (fc) {
		this._userGpxData = fc && fc.type === 'FeatureCollection' ? fc : EMPTY_FC;
		if (!this.map || !this.map.getSource('user-gpx')) return;
		this.map.getSource('user-gpx').setData(this._userGpxData);
	};

	TerrainMap3D.prototype.clearUserGpx = function () {
		this.setUserGpx(EMPTY_FC);
	};

	TerrainMap3D.prototype.flashHighlight = function (trailName) {
		var self = this;
		if (!trailName || !this.ready || !this.map) return;

		this._clearFlash();

		var nameFilter = ['==', ['get', 'name'], trailName];
		this.map.setFilter('trails-flash-casing', nameFilter);
		this.map.setFilter('trails-flash', nameFilter);
		this.map.setLayoutProperty('trails-flash-casing', 'visibility', 'visible');
		this.map.setLayoutProperty('trails-flash', 'visibility', 'visible');

		var steps = 0;
		this._flashTimer = setInterval(function () {
			steps++;
			var on = steps % 2 === 1;
			self.map.setPaintProperty('trails-flash', 'line-opacity', on ? 0.95 : 0.15);
			self.map.setPaintProperty('trails-flash-casing', 'line-opacity', on ? 0.75 : 0.1);
			if (steps >= 8) {
				self._clearFlash();
			}
		}, 220);
	};

	TerrainMap3D.prototype._bindViewportResize = function () {
		var self = this;
		if (this._viewportResizeBound) return;
		this._viewportResizeBound = true;

		this._onViewportResize = function () {
			if (!self.map || !self.ready) return;
			if (self._resizeTimer) clearTimeout(self._resizeTimer);
			self._resizeTimer = setTimeout(function () {
				self._resizeTimer = null;
				if (self.map) self.map.resize();
			}, 100);
		};

		window.addEventListener('resize', this._onViewportResize);
		window.addEventListener('orientationchange', this._onViewportResize);
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', this._onViewportResize);
			window.visualViewport.addEventListener('scroll', this._onViewportResize);
		}
	};

	/** Push current Mapbox center + zoom onto the Leaflet 2D map. */
	TerrainMap3D.prototype.syncToLeaflet = function (leafletMap) {
		if (!this.ready || !this.map || !leafletMap) return;
		// Mobile URL-bar / dvh changes leave Mapbox matrix stale until resize.
		this.map.resize();
		if (typeof leafletMap.invalidateSize === 'function') {
			leafletMap.invalidateSize({ animate: false, pan: false });
		}
		var c = this.map.getCenter();
		leafletMap.setView([c.lat, c.lng], this.map.getZoom(), { animate: false });
	};

	TerrainMap3D.prototype.syncBounds = function (leafletMap) {
		if (!this.ready || !this.map || !leafletMap) return;
		this.map.resize();
		var b = leafletMap.getBounds();
		this.map.fitBounds(
			[
				[b.getWest(), b.getSouth()],
				[b.getEast(), b.getNorth()]
			],
			{
				padding: 0,
				duration: 0,
				pitch: this.pitch,
				bearing: this.bearing
			}
		);
	};

	/** Overview: Inn valley bird's-eye from south (same as 3D center-view). */
	TerrainMap3D.prototype.flyToOverview = function (options) {
		if (!this.ready || !this.map) return;
		options = options || {};
		this.map.easeTo({
			center: OVERVIEW_CAMERA.center,
			zoom: OVERVIEW_CAMERA.zoom,
			bearing: OVERVIEW_CAMERA.bearing,
			pitch: OVERVIEW_CAMERA.pitch,
			duration: options.duration != null ? options.duration : 1200
		});
	};

	TerrainMap3D.prototype.show = function (leafletMap, selectedTrailName) {
		var self = this;
		var el = this._container();
		if (!el) return Promise.reject(new Error('#' + this.containerId + ' missing'));

		document.documentElement.classList.add('legacy-3d-loading');
		el.classList.add('is-pending');

		return this.ensureInit()
			.then(function () {
				self._setPreloading(true);
				el.classList.remove('is-active');
				self.map.resize();
				if (leafletMap) self.syncBounds(leafletMap);
				return self._waitSettled();
			})
			.then(function () {
				self.map.resize();
				if (leafletMap) self.syncBounds(leafletMap);
				self._setPreloading(false);
				el.classList.remove('is-pending');
				el.classList.add('is-active');
				el.setAttribute('aria-hidden', 'false');
				self.visible = true;
				document.documentElement.classList.remove('legacy-3d-loading');
				document.documentElement.classList.add('legacy-3d-active');
				if (selectedTrailName) self.flashHighlight(selectedTrailName);
			})
			.catch(function (err) {
				el.classList.remove('is-pending');
				document.documentElement.classList.remove('legacy-3d-loading');
				throw err;
			});
	};

	TerrainMap3D.prototype.hide = function (leafletMap) {
		if (this.visible && this.ready && leafletMap) {
			this.syncToLeaflet(leafletMap);
		}
		this._clearFlash();
		if (this._popup) {
			this._popup.remove();
			this._popup = null;
		}
		var el = this._container();
		if (el) {
			el.classList.remove('is-active', 'is-pending');
			el.setAttribute('aria-hidden', 'true');
			// keep is-preloading so warm instance stays sized for next open
			if (this.ready) el.classList.add('is-preloading');
		}
		this.visible = false;
		document.documentElement.classList.remove('legacy-3d-active', 'legacy-3d-loading');
		// Leaflet size after overlay teardown (mobile dvh may have changed).
		if (leafletMap && typeof leafletMap.invalidateSize === 'function') {
			leafletMap.invalidateSize({ animate: false, pan: false });
		}
	};

	global.LegacyTerrain3D = new TerrainMap3D('map-3d');
})(window);
