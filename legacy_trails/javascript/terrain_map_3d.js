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
	var CLICK_TIP = 'Für interaktive Trail Infos in die 2D-Ansicht wechseln.';

	function TerrainMap3D(containerId) {
		this.containerId = containerId;
		this.map = null;
		this.ready = false;
		this.visible = false;
		this._initPromise = null;
		this._trailsPromise = null;
		this._trailsData = null;
		this._flashTimer = null;
		this._popup = null;
		this.heightScale = 1.5;
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
				self._trailsData = trailData;
				return trailData;
			})
			.catch(function (err) {
				console.error(err);
				self._trailsData = EMPTY_FC;
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
					center: [11.45393, 47.24358],
					zoom: 11,
					pitch: self.pitch,
					bearing: self.bearing,
					antialias: true,
					attributionControl: true
				});

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

					self._bindTrailClicks();
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

	TerrainMap3D.prototype.syncBounds = function (leafletMap) {
		if (!this.ready || !this.map || !leafletMap) return;
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

	TerrainMap3D.prototype.hide = function () {
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
	};

	global.LegacyTerrain3D = new TerrainMap3D('map-3d');
})(window);
