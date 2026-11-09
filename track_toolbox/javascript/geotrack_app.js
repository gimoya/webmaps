/* track_toolbox — Leaflet 2D + Mapbox 3D */
(function () {
	'use strict';

	var GEOTRACK_VERSION = '1.0.0';
	var DEFAULT_CENTER = [47.2692, 11.4041];
	var DEFAULT_ZOOM = 11;
	var MAX_FILE_BYTES = 25 * 1024 * 1024;
	/** Chord longer than this → dotted vanish style (same idea as chaser). */
	var GAP_DOT_M = 500;
	var GAP_FADE_END = 0.3;
	var GAP_FADE_STEPS = 10;
	var TRACE_BACKDROP_STYLE = {
		color: '#e0e0e0',
		weight: 1.9,
		opacity: 0.4,
		lineCap: 'round',
		lineJoin: 'round',
		interactive: false
	};

	var tracks = [];
	/** Multi-select: click adds, click again removes. */
	var selectedIds = [];
	var _idSeq = 1;
	var tracksLayer = null;
	var _suppressFieldSync = false;

	/* —— Edit session —— */
	var editMode = false;
	var editTool = 'node';
	var editTargetId = null;
	var editWorking = null;
	var editTracksSnapshot = null;
	var editSessionIds = [];
	var editUndoStack = [];
	var editRedoStack = [];
	var EDIT_UNDO_MAX = 50;
	var editHandlesLayer = null;
	var editHitLayer = null;
	var _editConfirmCb = null;
	var EDIT_HIT_WEIGHT = 20;
	var EDIT_MIN_CUT_M = 1;
	/** Screen-px radius around an existing vertex — click inside = no insert. */
	var EDIT_NODE_PAD_PX = 12;
	/** Along-track step (m) for one-time edit-session chord simplify. */
	var EDIT_NODE_STEP_M = 20;
	/** Fat invisible hit target for map selection / contextmenu. */
	var SELECT_HIT_WEIGHT = 28;
	var SELECT_POINT_HIT_R = 16;
	var SELECT_COLOR = '#ff5f1f';
	var EDIT_COLOR = '#ffe600';
	var GEOTRACK_BROUTER_URL = (function () {
		try {
			var q = new URLSearchParams(window.location.search).get('brouter');
			if (q) return q;
		} catch (e) { /* ignore */ }
		return 'https://route.tiroltrailhead.com/brouter';
	})();
	var GEOTRACK_BROUTER_KEY = '02abf8f41a8f1ca689eb64b2221657cc475e2e45de57c11c';
	var routeSnapControl = null;
	var digitizePickBlocked = false;
	var pointDrawActive = false;
	var pointDrawBtn = null;

	var map = L.map('map', {
		zoom: DEFAULT_ZOOM,
		zoomControl: false,
		attributionControl: false
	});
	map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

	/* Tracks under edit hit under edit nodes. */
	map.createPane('geotrackTrackPane');
	map.getPane('geotrackTrackPane').style.zIndex = 400;
	map.createPane('geotrackEditHitPane');
	map.getPane('geotrackEditHitPane').style.zIndex = 450;
	map.createPane('geotrackEditNodePane');
	map.getPane('geotrackEditNodePane').style.zIndex = 650;
	/* Route under stations so leg-hit SVG cannot steal waypoint drag. */
	map.createPane('digitizeRoutePane');
	map.getPane('digitizeRoutePane').style.zIndex = 655;
	map.createPane('digitizePane');
	map.getPane('digitizePane').style.zIndex = 670;

	var TILE_OPTS = {
		updateWhenIdle: true,
		updateWhenZooming: false,
		keepBuffer: 2,
		crossOrigin: true
	};

	var satelliteLayer = L.tileLayer(
		'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
		Object.assign({}, TILE_OPTS, {
			attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
			maxZoom: 18,
			subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
		})
	);

	var topoLayer = L.tileLayer(
		'https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key={apiKey}',
		Object.assign({}, TILE_OPTS, {
			minZoom: 1,
			maxZoom: 19,
			apiKey: '3e42a34cc017771733149a4097431ecd',
			attribution:
				'&copy; <a href="https://www.tracestrack.com/">Tracestrack</a>, ' +
				'&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
		})
	);
	topoLayer.addTo(map);

	var attribution = L.control.attribution({ position: 'bottomright', prefix: false });
	attribution.addTo(map);
	map.attributionControl = attribution;
	attribution.addAttribution(
		'<a href="https://tiroltrailhead.com">Tirol Trailhead</a>' +
			' · <span class="legacy-attribution-version">v' + GEOTRACK_VERSION + '</span>'
	);

	new L.Control.Zoom({
		position: 'topright',
		zoomInTitle: 'Zoom in',
		zoomOutTitle: 'Zoom out'
	}).addTo(map);

	var centerView = L.easyButton({
		position: 'topright',
		states: [{
			stateName: 'centerView',
			icon: '<i class="fas fa-compress"></i>',
			title: 'Fit all tracks',
			onClick: function () {
				if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) {
					if (tracks.length) fitMapToTracks();
					else window.LegacyTerrain3D.flyToOverview();
					return;
				}
				if (tracks.length) fitMapToTracks();
				else map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
			}
		}]
	});
	centerView.addTo(map);
	if (centerView.getContainer) centerView.getContainer().classList.add('legacy-center-view');

	L.easyButton({
		position: 'topright',
		states: [{
			stateName: 'basemap-topo',
			icon: '<span class="custom-control">S</span>',
			title: 'Satellite basemap',
			onClick: function (control) {
				map.removeLayer(topoLayer);
				map.addLayer(satelliteLayer);
				control.state('basemap-satellite');
			}
		}, {
			stateName: 'basemap-satellite',
			icon: '<span class="custom-control">T</span>',
			title: 'Topo basemap',
			onClick: function (control) {
				map.removeLayer(satelliteLayer);
				map.addLayer(topoLayer);
				control.state('basemap-topo');
			}
		}]
	}).addTo(map);

	L.control.locate({
		strings: { title: 'Show GPS location' },
		position: 'topright',
		locateOptions: {
			watch: true,
			setView: false,
			enableHighAccuracy: true,
			maximumAge: 2000,
			timeout: 20000
		}
	}).addTo(map);

	var terrain3dToggle = L.easyButton({
		position: 'topright',
		states: [{
			stateName: 'terrain-3d-off',
			icon: '<i class="fas fa-cube"></i>',
			title: '3D terrain',
			onClick: function (btn) {
				if (!window.LegacyTerrain3D) return;
				syncTracksTo3D();
				if (terrain3dToggle.button) {
					terrain3dToggle.button.classList.add('legacy-ctrl-selected');
				}
				window.LegacyTerrain3D.show(map, selectedTrackName()).then(function () {
					btn.state('terrain-3d-on');
				}).catch(function (err) {
					console.error(err);
					if (terrain3dToggle.button) {
						terrain3dToggle.button.classList.remove('legacy-ctrl-selected');
					}
					showToast('3D view unavailable');
				});
			}
		}, {
			stateName: 'terrain-3d-on',
			icon: '<i class="fas fa-map"></i>',
			title: '2D map',
			onClick: function (btn) {
				exitTerrain3D();
				btn.state('terrain-3d-off');
			}
		}]
	});
	terrain3dToggle.addTo(map);
	if (terrain3dToggle.getContainer) {
		terrain3dToggle.getContainer().classList.add('legacy-3d-toggle');
	}

	function exitTerrain3D() {
		if (window.LegacyTerrain3D) window.LegacyTerrain3D.hide(map);
		if (terrain3dToggle) {
			terrain3dToggle.state('terrain-3d-off');
			if (terrain3dToggle.button) {
				terrain3dToggle.button.classList.remove('legacy-ctrl-selected');
			}
		}
	}
	window.geotrackExitTerrain3D = exitTerrain3D;

	tracksLayer = L.layerGroup([], { pane: 'geotrackTrackPane' }).addTo(map);

	/* ---------- UI refs ---------- */
	var fileInput = document.getElementById('geotrack-file-input');
	var uploadBtn = document.getElementById('geotrack-upload-btn');
	var trackListEl = document.getElementById('geotrack-track-list');
	var nameInput = document.getElementById('geotrack-name');
	var descInput = document.getElementById('geotrack-desc');
	var selCountEl = document.getElementById('geotrack-sel-count');
	var dlGpxBtn = document.getElementById('geotrack-dl-gpx');
	var dlKmlBtn = document.getElementById('geotrack-dl-kml');
	var removeBtn = document.getElementById('geotrack-remove');
	var clearBtn = document.getElementById('geotrack-clear');
	var searchInput = document.getElementById('geotrack-search');
	var searchResultsEl = document.getElementById('geotrack-search-results');

	uploadBtn.addEventListener('click', function () { fileInput.click(); });
	fileInput.addEventListener('change', function () {
		var files = Array.prototype.slice.call(fileInput.files || []);
		fileInput.value = '';
		if (files.length) handleFiles(files);
	});

	/* ---------- Search: fuzzy tracks[] (priority) + OSM Nominatim ---------- */
	var SEARCH_NOMINATIM_MIN = 2;
	var SEARCH_NOMINATIM_LIMIT = 6;
	var SEARCH_TRACK_LIMIT = 12;
	var _searchTimer = null;
	var _searchAbort = null;
	var _searchItems = [];
	var _searchActiveIdx = -1;
	var _searchQuery = '';

	function foldSearch(s) {
		return String(s || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	/** Higher = better match; -1 = no match. */
	function fuzzyScore(query, haystack) {
		var q = foldSearch(query);
		var h = foldSearch(haystack);
		if (!q || !h) return -1;
		if (h === q) return 1000;
		var idx = h.indexOf(q);
		if (idx === 0) return 900 - Math.min(h.length - q.length, 80);
		if (idx > 0) return 800 - Math.min(idx, 80);
		var tokens = q.split(' ').filter(Boolean);
		if (tokens.length > 1) {
			var score = 700;
			for (var t = 0; t < tokens.length; t++) {
				var ti = h.indexOf(tokens[t]);
				if (ti < 0) {
					score = -1;
					break;
				}
				score -= Math.min(ti, 40);
			}
			if (score >= 0) return score;
		}
		var qi = 0;
		var gaps = 0;
		var last = -1;
		for (var hi = 0; hi < h.length && qi < q.length; hi++) {
			if (h.charAt(hi) === q.charAt(qi)) {
				if (last >= 0) gaps += hi - last - 1;
				last = hi;
				qi++;
			}
		}
		if (qi < q.length) return -1;
		return Math.max(1, 400 - gaps * 2 - Math.min(h.length - q.length, 120));
	}

	function trackSearchHaystack(t) {
		return [t.name, t.description, t.sourceFile].filter(Boolean).join(' ');
	}

	function searchTracksLocal(query) {
		var out = [];
		for (var i = 0; i < tracks.length; i++) {
			var t = tracks[i];
			var score = fuzzyScore(query, trackSearchHaystack(t));
			if (score < 0) continue;
			out.push({
				kind: 'track',
				score: score,
				id: t.id,
				label: t.name || '(unnamed)',
				sub: t.geometry && t.geometry.type === 'Point' ? 'Point' : 'LineString'
			});
		}
		out.sort(function (a, b) {
			if (b.score !== a.score) return b.score - a.score;
			return String(a.label).localeCompare(String(b.label));
		});
		if (out.length > SEARCH_TRACK_LIMIT) out.length = SEARCH_TRACK_LIMIT;
		return out;
	}

	function hideSearchResults() {
		_searchItems = [];
		_searchActiveIdx = -1;
		if (searchResultsEl) {
			searchResultsEl.innerHTML = '';
			searchResultsEl.hidden = true;
		}
	}

	function renderSearchResults(trackItems, placeItems, statusText) {
		if (!searchResultsEl) return;
		_searchItems = trackItems.concat(placeItems || []);
		_searchActiveIdx = _searchItems.length ? 0 : -1;
		searchResultsEl.innerHTML = '';
		if (!_searchItems.length && !statusText) {
			searchResultsEl.hidden = true;
			return;
		}
		searchResultsEl.hidden = false;
		if (!_searchItems.length) {
			var p = document.createElement('p');
			p.className = 'geotrack-search-status';
			p.textContent = statusText || 'No matches';
			searchResultsEl.appendChild(p);
			return;
		}
		for (var i = 0; i < _searchItems.length; i++) {
			var item = _searchItems[i];
			var li = document.createElement('li');
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'geotrack-search-item' + (i === _searchActiveIdx ? ' is-active' : '');
			btn.setAttribute('role', 'option');
			btn.dataset.idx = String(i);
			var kind = document.createElement('span');
			kind.className = 'geotrack-search-item-kind ' + (item.kind === 'track' ? 'is-track' : 'is-place');
			kind.textContent = item.kind === 'track' ? 'Track' : 'Place';
			var label = document.createElement('span');
			label.className = 'geotrack-search-item-label';
			label.textContent = item.label;
			btn.appendChild(kind);
			btn.appendChild(label);
			if (item.sub) {
				var sub = document.createElement('span');
				sub.className = 'geotrack-search-item-sub';
				sub.textContent = item.sub;
				btn.appendChild(sub);
			}
			btn.addEventListener('mousedown', function (ev) {
				ev.preventDefault();
			});
			btn.addEventListener('click', function (ev) {
				var idx = Number(ev.currentTarget.dataset.idx);
				chooseSearchItem(idx);
			});
			li.appendChild(btn);
			searchResultsEl.appendChild(li);
		}
		if (statusText) {
			var st = document.createElement('p');
			st.className = 'geotrack-search-status';
			st.textContent = statusText;
			searchResultsEl.appendChild(st);
		}
	}

	function setSearchActiveIdx(idx) {
		if (!_searchItems.length) {
			_searchActiveIdx = -1;
			return;
		}
		if (idx < 0) idx = _searchItems.length - 1;
		if (idx >= _searchItems.length) idx = 0;
		_searchActiveIdx = idx;
		var nodes = searchResultsEl.querySelectorAll('.geotrack-search-item');
		for (var i = 0; i < nodes.length; i++) {
			nodes[i].classList.toggle('is-active', i === _searchActiveIdx);
		}
		if (nodes[_searchActiveIdx] && nodes[_searchActiveIdx].scrollIntoView) {
			nodes[_searchActiveIdx].scrollIntoView({ block: 'nearest' });
		}
	}

	function chooseSearchItem(idx) {
		var item = _searchItems[idx];
		if (!item) return;
		if (item.kind === 'track') {
			var tr = findTrack(item.id);
			if (!tr) return;
			selectedIds = [tr.id];
			syncSelectionUi();
			fitToGeometry(tr.geometry);
			hideSearchResults();
			if (searchInput) searchInput.blur();
			return;
		}
		if (item.kind === 'place') {
			if (item.bounds && item.bounds.isValid && item.bounds.isValid()) {
				map.fitBounds(item.bounds, { padding: [48, 48], maxZoom: 16 });
			} else if (item.latlng) {
				map.setView(item.latlng, 14);
			}
			hideSearchResults();
			if (searchInput) searchInput.blur();
		}
	}

	function nominatimSearch(query) {
		if (_searchAbort) {
			try { _searchAbort.abort(); } catch (e) { /* ignore */ }
			_searchAbort = null;
		}
		var q = foldSearch(query);
		if (q.length < SEARCH_NOMINATIM_MIN) {
			return Promise.resolve([]);
		}
		var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
		_searchAbort = ac;
		var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' +
			SEARCH_NOMINATIM_LIMIT +
			'&addressdetails=0&q=' + encodeURIComponent(query);
		var b = map.getBounds();
		if (b && b.isValid()) {
			url += '&viewbox=' +
				[b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].join(',') +
				'&bounded=0';
		}
		return fetch(url, {
			signal: ac ? ac.signal : undefined,
			headers: { Accept: 'application/json' }
		}).then(function (res) {
			if (!res.ok) throw new Error('nominatim-' + res.status);
			return res.json();
		}).then(function (rows) {
			if (!Array.isArray(rows)) return [];
			var places = [];
			for (var i = 0; i < rows.length; i++) {
				var r = rows[i];
				var lat = Number(r.lat);
				var lon = Number(r.lon);
				if (!isFinite(lat) || !isFinite(lon)) continue;
				var bounds = null;
				if (r.boundingbox && r.boundingbox.length === 4) {
					var south = Number(r.boundingbox[0]);
					var north = Number(r.boundingbox[1]);
					var west = Number(r.boundingbox[2]);
					var east = Number(r.boundingbox[3]);
					if (isFinite(south) && isFinite(north) && isFinite(west) && isFinite(east)) {
						bounds = L.latLngBounds([south, west], [north, east]);
					}
				}
				places.push({
					kind: 'place',
					score: 0,
					label: r.display_name || (lat.toFixed(5) + ', ' + lon.toFixed(5)),
					sub: r.type ? String(r.type) : 'OSM',
					latlng: L.latLng(lat, lon),
					bounds: bounds
				});
			}
			return places;
		});
	}

	function runSearch(query) {
		_searchQuery = query;
		var q = foldSearch(query);
		if (!q) {
			hideSearchResults();
			return;
		}
		var trackItems = searchTracksLocal(query);
		renderSearchResults(
			trackItems,
			[],
			q.length >= SEARCH_NOMINATIM_MIN ? 'Searching places…' : null
		);
		if (q.length < SEARCH_NOMINATIM_MIN) return;
		nominatimSearch(query).then(function (places) {
			if (foldSearch(searchInput && searchInput.value) !== q) return;
			renderSearchResults(
				trackItems,
				places,
				!trackItems.length && !places.length ? 'No matches' : null
			);
		}).catch(function (err) {
			if (err && err.name === 'AbortError') return;
			if (foldSearch(searchInput && searchInput.value) !== q) return;
			renderSearchResults(
				trackItems,
				[],
				trackItems.length ? 'Places unavailable' : 'No matches · places unavailable'
			);
		});
	}

	function scheduleSearch() {
		if (_searchTimer) clearTimeout(_searchTimer);
		var raw = searchInput ? searchInput.value : '';
		var q = foldSearch(raw);
		if (!q) {
			hideSearchResults();
			return;
		}
		/* Tracks update immediately; Nominatim debounced via runSearch timer. */
		var trackItems = searchTracksLocal(raw);
		renderSearchResults(
			trackItems,
			[],
			q.length >= SEARCH_NOMINATIM_MIN ? 'Searching places…' : null
		);
		_searchTimer = setTimeout(function () {
			_searchTimer = null;
			runSearch(raw);
		}, 420);
	}

	if (searchInput) {
		searchInput.addEventListener('input', scheduleSearch);
		searchInput.addEventListener('focus', function () {
			if (foldSearch(searchInput.value)) scheduleSearch();
		});
		searchInput.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') {
				e.preventDefault();
				hideSearchResults();
				searchInput.blur();
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSearchActiveIdx(_searchActiveIdx + 1);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSearchActiveIdx(_searchActiveIdx - 1);
				return;
			}
			if (e.key === 'Enter') {
				if (_searchActiveIdx >= 0 && _searchItems[_searchActiveIdx]) {
					e.preventDefault();
					chooseSearchItem(_searchActiveIdx);
				}
			}
		});
	}

	/** Most recently added to selection (end of selectedIds). */
	function lastSelectedTrack() {
		if (!selectedIds.length) return null;
		return findTrack(selectedIds[selectedIds.length - 1]);
	}

	nameInput.addEventListener('input', function () {
		if (_suppressFieldSync) return;
		var t = lastSelectedTrack();
		if (!t) return;
		t.name = nameInput.value;
		refreshTrackList();
		redrawMapLayers();
		syncTracksTo3D();
	});
	descInput.addEventListener('input', function () {
		if (_suppressFieldSync) return;
		var t = lastSelectedTrack();
		if (!t) return;
		t.description = descInput.value;
	});

	dlGpxBtn.addEventListener('click', function () { downloadSelected('gpx'); });
	dlKmlBtn.addEventListener('click', function () { downloadSelected('kml'); });
	removeBtn.addEventListener('click', removeSelected);
	clearBtn.addEventListener('click', clearAll);

	/* ---------- helpers ---------- */

	var busyEl = document.getElementById('geotrack-busy');
	var _busyDepth = 0;

	function setBusy(on) {
		if (on) _busyDepth++;
		else _busyDepth = Math.max(0, _busyDepth - 1);
		var active = _busyDepth > 0;
		document.documentElement.classList.toggle('geotrack-busy', active);
		if (!busyEl) return;
		busyEl.hidden = !active;
		busyEl.classList.toggle('is-hidden', !active);
		busyEl.setAttribute('aria-busy', active ? 'true' : 'false');
	}

	function runBusy(work) {
		setBusy(true);
		return Promise.resolve()
			.then(function () {
				return new Promise(function (resolve) {
					requestAnimationFrame(function () {
						resolve(work());
					});
				});
			})
			.finally(function () {
				setBusy(false);
			});
	}

	var welcomeOverlay = document.getElementById('geotrack-welcome-overlay');
	var welcomeCloseBtn = document.getElementById('geotrack-welcome-close');
	var kofiOverlay = document.getElementById('geotrack-kofi-overlay');
	var kofiCloseBtn = document.getElementById('geotrack-kofi-close');

	function showWelcomePanel() {
		if (!welcomeOverlay) return;
		welcomeOverlay.hidden = false;
		welcomeOverlay.setAttribute('aria-hidden', 'false');
		welcomeOverlay.classList.remove('is-hidden');
		document.documentElement.classList.add('legacy-welcome-open');
	}

	function dismissWelcomePanel() {
		if (!welcomeOverlay) return;
		welcomeOverlay.hidden = true;
		welcomeOverlay.setAttribute('aria-hidden', 'true');
		welcomeOverlay.classList.add('is-hidden');
		document.documentElement.classList.remove('legacy-welcome-open');
	}

	function showKofiDownloadReminder() {
		if (!kofiOverlay) return;
		dismissWelcomePanel();
		kofiOverlay.hidden = false;
		kofiOverlay.setAttribute('aria-hidden', 'false');
		kofiOverlay.classList.remove('is-hidden');
	}

	function dismissKofiDownloadReminder() {
		if (!kofiOverlay) return;
		kofiOverlay.hidden = true;
		kofiOverlay.setAttribute('aria-hidden', 'true');
		kofiOverlay.classList.add('is-hidden');
	}

	if (welcomeCloseBtn) {
		welcomeCloseBtn.addEventListener('click', function (e) {
			e.preventDefault();
			dismissWelcomePanel();
		});
	}
	if (welcomeOverlay) {
		welcomeOverlay.addEventListener('click', function (e) {
			if (e.target === welcomeOverlay) dismissWelcomePanel();
		});
	}
	if (kofiCloseBtn) {
		kofiCloseBtn.addEventListener('click', function (e) {
			e.preventDefault();
			dismissKofiDownloadReminder();
		});
	}
	if (kofiOverlay) {
		kofiOverlay.addEventListener('click', function (e) {
			if (e.target === kofiOverlay) dismissKofiDownloadReminder();
		});
	}

	function showToast(text) {
		var mapEl = document.getElementById('map');
		if (!mapEl) return;
		var el = document.getElementById('legacy-map-toast');
		if (!el) {
			el = document.createElement('div');
			el.id = 'legacy-map-toast';
			el.className = 'legacy-map-toast';
			el.setAttribute('role', 'status');
			mapEl.appendChild(el);
		}
		el.textContent = text;
		el.classList.add('is-visible');
		clearTimeout(el._hideTimer);
		el._hideTimer = setTimeout(function () {
			el.classList.remove('is-visible');
		}, 2800);
	}

	function findTrack(id) {
		for (var i = 0; i < tracks.length; i++) {
			if (tracks[i].id === id) return tracks[i];
		}
		return null;
	}

	function isSelected(id) {
		return selectedIds.indexOf(id) !== -1;
	}

	function selectedTracks() {
		var out = [];
		for (var i = 0; i < selectedIds.length; i++) {
			var t = findTrack(selectedIds[i]);
			if (t) out.push(t);
		}
		return out;
	}

	function selectedTrackName() {
		var list = selectedTracks();
		return list.length === 1 ? list[0].name : null;
	}

	function pruneSelection() {
		selectedIds = selectedIds.filter(function (id) {
			return !!findTrack(id);
		});
	}

	function sanitizeFileBase(raw) {
		var name = String(raw || 'track').trim() || 'track';
		name = name.replace(/\.(gpx|kml)$/i, '');
		name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '_');
		return name || 'track';
	}

	function localName(node) {
		return node && node.localName ? node.localName : '';
	}

	function childText(parent, name) {
		if (!parent || !parent.children) return '';
		for (var i = 0; i < parent.children.length; i++) {
			if (localName(parent.children[i]) === name) {
				return (parent.children[i].textContent || '').trim();
			}
		}
		return '';
	}

	function pointsFromParent(parent, ptName) {
		var coords = [];
		if (!parent || !parent.children) return coords;
		for (var i = 0; i < parent.children.length; i++) {
			var el = parent.children[i];
			if (localName(el) !== ptName) continue;
			var lat = parseFloat(el.getAttribute('lat'));
			var lon = parseFloat(el.getAttribute('lon'));
			if (!isFinite(lat) || !isFinite(lon)) continue;
			var eleStr = childText(el, 'ele');
			var ele = eleStr ? parseFloat(eleStr) : NaN;
			if (isFinite(ele)) coords.push([lon, lat, ele]);
			else coords.push([lon, lat]);
		}
		return coords;
	}

	function parseGpxText(xmlText, sourceFile) {
		var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
		if (!doc || !doc.documentElement || doc.querySelector('parsererror')) {
			throw new Error('invalid-gpx');
		}
		var out = [];
		var nodes = doc.getElementsByTagName('*');
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			var ln = localName(n);
			if (ln === 'trk') {
				var trackName = childText(n, 'name') || sourceFile || 'GPX Track';
				var trackDesc = childText(n, 'desc');
				for (var j = 0; j < n.children.length; j++) {
					var seg = n.children[j];
					if (localName(seg) !== 'trkseg') continue;
					var coords = pointsFromParent(seg, 'trkpt');
					if (coords.length < 2) continue;
					out.push(makeTrack(trackName, trackDesc, {
						type: 'LineString',
						coordinates: coords
					}, sourceFile));
				}
			} else if (ln === 'rte') {
				var routeName = childText(n, 'name') || sourceFile || 'GPX Route';
				var routeDesc = childText(n, 'desc');
				var rcoords = pointsFromParent(n, 'rtept');
				if (rcoords.length < 2) continue;
				out.push(makeTrack(routeName, routeDesc, {
					type: 'LineString',
					coordinates: rcoords
				}, sourceFile));
			} else if (ln === 'wpt') {
				var lat = parseFloat(n.getAttribute('lat'));
				var lon = parseFloat(n.getAttribute('lon'));
				if (!isFinite(lat) || !isFinite(lon)) continue;
				var wptName = childText(n, 'name') || sourceFile || 'Waypoint';
				var wptDesc = childText(n, 'desc');
				var eleStr = childText(n, 'ele');
				var ele = eleStr ? parseFloat(eleStr) : NaN;
				var wptCoord = isFinite(ele) ? [lon, lat, ele] : [lon, lat];
				out.push(makeTrack(wptName, wptDesc, {
					type: 'Point',
					coordinates: wptCoord
				}, sourceFile));
			}
		}
		return out;
	}

	function lineCoordsFromGeom(geom) {
		if (!geom) return [];
		if (geom.type === 'LineString') return [geom.coordinates];
		if (geom.type === 'MultiLineString') return geom.coordinates || [];
		return [];
	}

	function parseKmlText(xmlText, sourceFile) {
		if (typeof toGeoJSON === 'undefined' || !toGeoJSON.kml) {
			throw new Error('togeojson-missing');
		}
		var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
		if (!doc || !doc.documentElement || doc.querySelector('parsererror')) {
			throw new Error('invalid-kml');
		}
		var fc = toGeoJSON.kml(doc);
		var out = [];
		var features = (fc && fc.features) || [];
		for (var i = 0; i < features.length; i++) {
			var f = features[i];
			if (!f || !f.geometry) continue;
			var props = f.properties || {};
			var name = props.name || sourceFile || 'KML Feature';
			var desc = props.description || props.desc || '';
			if (typeof desc !== 'string') desc = String(desc || '');
			var g = f.geometry;
			if (g.type === 'Point') {
				var pc = g.coordinates;
				if (!pc || pc.length < 2) continue;
				out.push(makeTrack(name, desc, {
					type: 'Point',
					coordinates: pc.slice()
				}, sourceFile));
				continue;
			}
			if (g.type === 'MultiPoint') {
				var mpts = g.coordinates || [];
				for (var p = 0; p < mpts.length; p++) {
					var mpc = mpts[p];
					if (!mpc || mpc.length < 2) continue;
					out.push(makeTrack(name, desc, {
						type: 'Point',
						coordinates: mpc.slice()
					}, sourceFile));
				}
				continue;
			}
			var lines = lineCoordsFromGeom(g);
			for (var L = 0; L < lines.length; L++) {
				var coords = lines[L];
				if (!coords || coords.length < 2) continue;
				out.push(makeTrack(name, desc, {
					type: 'LineString',
					coordinates: coords
				}, sourceFile));
			}
		}
		return out;
	}

	function makeTrack(name, description, geometry, sourceFile) {
		return {
			id: 't' + (_idSeq++),
			name: String(name || 'Track'),
			description: String(description || ''),
			geometry: geometry,
			sourceFile: sourceFile || ''
		};
	}

	function trackToFeature(t) {
		return {
			type: 'Feature',
			properties: {
				name: t.name,
				description: t.description,
				desc: t.description
			},
			geometry: t.geometry
		};
	}

	function tracksToFeatureCollection() {
		return {
			type: 'FeatureCollection',
			features: tracks.map(trackToFeature)
		};
	}

	function readFileAsText(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { resolve(String(reader.result || '')); };
			reader.onerror = function () { reject(new Error('read-failed')); };
			reader.readAsText(file);
		});
	}

	function readFileAsArrayBuffer(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { resolve(reader.result); };
			reader.onerror = function () { reject(new Error('read-failed')); };
			reader.readAsArrayBuffer(file);
		});
	}

	function extOf(name) {
		var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
		return m ? m[1] : '';
	}

	function parseXmlTracks(text, fileName) {
		var ext = extOf(fileName);
		if (ext === 'gpx') return parseGpxText(text, fileName);
		if (ext === 'kml') return parseKmlText(text, fileName);
		var trimmed = text.trim();
		if (/<gpx[\s>]/i.test(trimmed)) return parseGpxText(text, fileName);
		if (/<kml[\s>]/i.test(trimmed)) return parseKmlText(text, fileName);
		throw new Error('unknown-format');
	}

	async function parseZipBuffer(buf, zipName) {
		if (typeof JSZip === 'undefined') throw new Error('jszip-missing');
		var zip = await JSZip.loadAsync(buf);
		var collected = [];
		var names = Object.keys(zip.files);
		for (var i = 0; i < names.length; i++) {
			var entry = zip.files[names[i]];
			if (!entry || entry.dir) continue;
			var base = names[i].split('/').pop();
			if (base.indexOf('.') === 0) continue;
			var ext = extOf(base);
			if (ext !== 'gpx' && ext !== 'kml') continue;
			var text = await entry.async('string');
			var parsed = parseXmlTracks(text, base);
			for (var j = 0; j < parsed.length; j++) {
				parsed[j].sourceFile = zipName + '/' + names[i];
				collected.push(parsed[j]);
			}
		}
		return collected;
	}

	async function handleFiles(files) {
		setBusy(true);
		try {
			if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) {
				exitTerrain3D();
			}
			var added = 0;
			var failed = 0;
			var tooLarge = [];
			var maxMb = Math.round(MAX_FILE_BYTES / (1024 * 1024));
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				if (file.size > MAX_FILE_BYTES) {
					tooLarge.push(file.name || 'file');
					continue;
				}
				var ext = extOf(file.name);
				try {
					var parsed;
					if (ext === 'zip' || ext === 'kmz') {
						var buf = await readFileAsArrayBuffer(file);
						parsed = await parseZipBuffer(buf, file.name);
					} else {
						var text = await readFileAsText(file);
						parsed = parseXmlTracks(text, file.name);
					}
					if (!parsed.length) {
						failed++;
						continue;
					}
					for (var j = 0; j < parsed.length; j++) {
						tracks.push(parsed[j]);
						added++;
					}
				} catch (err) {
					console.error(err);
					failed++;
				}
			}
			if (added) {
				pruneSelection();
				syncSelectionUi();
				fitMapToTracks();
			}
			if (tooLarge.length) {
				var sizeMsg = tooLarge.length === 1
					? 'File too large (max ' + maxMb + ' MB): ' + tooLarge[0]
					: tooLarge.length + ' files too large (max ' + maxMb + ' MB each)';
				if (added) sizeMsg = added + ' loaded · ' + sizeMsg;
				showToast(sizeMsg);
				return;
			}
			if (added && !failed) showToast(added + ' track' + (added === 1 ? '' : 's') + ' loaded');
			else if (added && failed) showToast(added + ' loaded, ' + failed + ' failed');
			else showToast('No tracks or points found');
		} finally {
			setBusy(false);
		}
	}

	/** Toggle: add if not selected, remove if already selected. */
	function toggleTrack(id) {
		if (editMode || digitizePickBlocked) return;
		if (!id || !findTrack(id)) return;
		var idx = selectedIds.indexOf(id);
		if (idx >= 0) selectedIds.splice(idx, 1);
		else selectedIds.push(id);
		syncSelectionUi();
	}

	function syncSelectionUi() {
		pruneSelection();
		_suppressFieldSync = true;
		var n = selectedIds.length;
		if (selCountEl) {
			selCountEl.textContent = n === 1 ? '1 selected' : n + ' selected';
		}
		var t = lastSelectedTrack();
		if (t) {
			nameInput.disabled = false;
			descInput.disabled = false;
			nameInput.value = t.name || '';
			descInput.value = t.description || '';
		} else {
			nameInput.disabled = true;
			descInput.disabled = true;
			nameInput.value = '';
			descInput.value = '';
		}
		_suppressFieldSync = false;
		refreshTrackList();
		redrawMapLayers();
		updateButtons();
	}

	function refreshTrackList() {
		trackListEl.innerHTML = '';
		for (var i = 0; i < tracks.length; i++) {
			var t = tracks[i];
			var li = document.createElement('li');
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'geotrack-track-item' + (isSelected(t.id) ? ' is-selected' : '');
			var isPoint = t.geometry && t.geometry.type === 'Point';
			var label = t.name || '(unnamed)';
			btn.textContent = (isPoint ? '• ' : '') + label;
			btn.title = (isSelected(t.id) ? 'Deselect: ' : 'Add to selection: ') + label;
			btn.dataset.id = t.id;
			btn.addEventListener('click', function (ev) {
				var id = ev.currentTarget.dataset.id;
				toggleTrack(id);
				var tr = findTrack(id);
				if (tr && isSelected(id)) fitToGeometry(tr.geometry);
			});
			li.appendChild(btn);
			trackListEl.appendChild(li);
		}
	}

	function updateButtons() {
		var hasSel = selectedTracks().length > 0;
		var hasAny = tracks.length > 0;
		dlGpxBtn.disabled = !hasSel;
		dlKmlBtn.disabled = !hasSel;
		removeBtn.disabled = !hasSel;
		clearBtn.disabled = !hasAny;
	}

	function lineStyle(selected, editing) {
		if (editing) {
			return {
				color: EDIT_COLOR,
				weight: 4.5,
				opacity: 0.98,
				lineCap: 'round',
				lineJoin: 'round'
			};
		}
		return {
			color: selected ? SELECT_COLOR : '#00b9fe',
			weight: selected ? 3.75 : 2.25,
			opacity: 0.95,
			lineCap: 'round',
			lineJoin: 'round'
		};
	}

	function pointMarkerStyle(selected, editing) {
		if (editing) {
			return {
				radius: 9,
				color: '#1a1a1a',
				weight: 3,
				fillColor: EDIT_COLOR,
				fillOpacity: 0.98
			};
		}
		return {
			radius: selected ? 8 : 6,
			color: selected ? '#1a1a1a' : '#2f2f2f',
			weight: 2,
			fillColor: selected ? SELECT_COLOR : '#00b9fe',
			fillOpacity: 0.95
		};
	}

	function haversineMeters(a, b) {
		var earth = 6371000;
		var toRad = Math.PI / 180;
		var dLat = (b[0] - a[0]) * toRad;
		var dLon = (b[1] - a[1]) * toRad;
		var lat1 = a[0] * toRad;
		var lat2 = b[0] * toRad;
		var h =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
	}

	function courseDistance(latLngs) {
		var walked = 0;
		for (var i = 1; i < latLngs.length; i++) {
			walked += haversineMeters(latLngs[i - 1], latLngs[i]);
		}
		return walked;
	}

	function pointAtDistance(latLngs, targetMeters) {
		var walked = 0;
		for (var i = 1; i < latLngs.length; i++) {
			var step = haversineMeters(latLngs[i - 1], latLngs[i]);
			if (walked + step >= targetMeters) {
				var t = step === 0 ? 0 : (targetMeters - walked) / step;
				return [
					latLngs[i - 1][0] + (latLngs[i][0] - latLngs[i - 1][0]) * t,
					latLngs[i - 1][1] + (latLngs[i][1] - latLngs[i - 1][1]) * t
				];
			}
			walked += step;
		}
		return latLngs[latLngs.length - 1];
	}

	function geoCoordsToLatLngs(coords) {
		var out = [];
		if (!coords) return out;
		for (var i = 0; i < coords.length; i++) {
			var c = coords[i];
			if (!c || c.length < 2) continue;
			out.push([c[1], c[0]]);
		}
		return out;
	}

	function pointToLatLng(coordinates) {
		if (!coordinates || coordinates.length < 2) return null;
		return [coordinates[1], coordinates[0]];
	}

	function isGapSegment(prev, curr) {
		return haversineMeters(prev, curr) > GAP_DOT_M;
	}

	function traceRuns(latLngs) {
		if (!latLngs || latLngs.length < 2) return [];
		if (latLngs.length === 1) {
			return [{ dotted: false, latLngs: [latLngs[0]] }];
		}
		var runs = [];
		for (var i = 1; i < latLngs.length; i++) {
			var dotted = isGapSegment(latLngs[i - 1], latLngs[i]);
			var end = latLngs[i];
			var last = runs[runs.length - 1];
			if (last && last.dotted === dotted) {
				last.latLngs.push(end);
			} else {
				runs.push({
					dotted: dotted,
					latLngs: [latLngs[i - 1], end]
				});
			}
		}
		return runs;
	}

	function dottedFadeChunks(latLngs) {
		if (!latLngs || latLngs.length < 2) return [];
		var total = courseDistance(latLngs);
		if (!(total > 0)) return [];
		var chunks = [];
		function pushSlice(t0, t1, opacity) {
			if (opacity < 0.05) return;
			var a = pointAtDistance(latLngs, t0 * total);
			var b = pointAtDistance(latLngs, t1 * total);
			if (!a || !b) return;
			if (a[0] === b[0] && a[1] === b[1]) return;
			chunks.push({ latLngs: [a, b], opacity: opacity });
		}
		var i;
		for (i = 0; i < GAP_FADE_STEPS; i++) {
			var t0a = (GAP_FADE_END * i) / GAP_FADE_STEPS;
			var t1a = (GAP_FADE_END * (i + 1)) / GAP_FADE_STEPS;
			var midA = (t0a + t1a) / 2;
			pushSlice(t0a, t1a, 1 - midA / GAP_FADE_END);
		}
		for (i = 0; i < GAP_FADE_STEPS; i++) {
			var t0b = 1 - GAP_FADE_END + (GAP_FADE_END * i) / GAP_FADE_STEPS;
			var t1b = 1 - GAP_FADE_END + (GAP_FADE_END * (i + 1)) / GAP_FADE_STEPS;
			var midB = (t0b + t1b) / 2;
			pushSlice(t0b, t1b, (midB - (1 - GAP_FADE_END)) / GAP_FADE_END);
		}
		return chunks;
	}

	function appendTraceRun(layerGroup, run, style, onClick, dirColor) {
		if (!run || !run.latLngs || run.latLngs.length < 2) return;
		function addLine(latLngs, opts, withArrows) {
			var pl = L.polyline(latLngs, Object.assign({ pane: 'geotrackTrackPane' }, opts));
			if (onClick && opts.interactive !== false) pl.on('click', onClick);
			layerGroup.addLayer(pl);
			if (withArrows && dirColor) applyLegacyDirArrows(pl, dirColor);
		}
		if (!run.dotted) {
			addLine(run.latLngs, style, true);
			return;
		}
		var baseOpacity = style.opacity != null ? style.opacity : 1;
		var chunks = dottedFadeChunks(run.latLngs);
		for (var i = 0; i < chunks.length; i++) {
			addLine(chunks[i].latLngs, Object.assign({}, style, {
				dashArray: '1 6',
				opacity: baseOpacity * chunks[i].opacity
			}), false);
		}
	}

	function appendTraceRunsWithBackdrop(layerGroup, latLngs, style, onClick, dirColor) {
		var runs = traceRuns(latLngs);
		var i;
		for (i = 0; i < runs.length; i++) {
			appendTraceRun(layerGroup, runs[i], TRACE_BACKDROP_STYLE, null, null);
		}
		for (i = 0; i < runs.length; i++) {
			appendTraceRun(layerGroup, runs[i], style, onClick, dirColor || null);
		}
	}

	/** legacy_trails direction: repeating dashed arrow text along the path. */
	function applyLegacyDirArrows(polyline, color) {
		if (!polyline || typeof polyline.setText !== 'function') return;
		polyline.setText('- - - ►             ', {
			repeat: true,
			offset: 11,
			attributes: {
				fill: color,
				'font-weight': 'bold',
				'font-size': '12'
			}
		});
	}

	function displayTrackForId(id) {
		if (editMode && editWorking && editWorking.id === id) return editWorking;
		return findTrack(id);
	}

	function redrawMapLayers() {
		tracksLayer.clearLayers();
		for (var i = 0; i < tracks.length; i++) {
			var base = tracks[i];
			var t = displayTrackForId(base.id) || base;
			var selected = isSelected(t.id) || (editMode && editSessionIds.indexOf(t.id) !== -1);
			var editing = editMode && t.id === editTargetId;
			var group = L.layerGroup();
			group._geotrackTrackId = t.id;
			var onClick = (function (id) {
				return function (ev) {
					if (digitizePickBlocked) {
						L.DomEvent.stopPropagation(ev);
						return;
					}
					if (editMode) {
						L.DomEvent.stopPropagation(ev);
						onEditFeatureClick(id, ev);
						return;
					}
					toggleTrack(id);
				};
			})(t.id);
			var onCtx = (function (id) {
				return function (ev) {
					if (digitizePickBlocked) {
						L.DomEvent.preventDefault(ev);
						L.DomEvent.stopPropagation(ev);
						return;
					}
					L.DomEvent.preventDefault(ev);
					L.DomEvent.stopPropagation(ev);
					requestEnterEdit(id);
				};
			})(t.id);
			var geom = t.geometry;
			if (geom && geom.type === 'Point') {
				var ll = pointToLatLng(geom.coordinates);
				if (ll) {
					var hitPt = L.circleMarker(ll, {
						pane: 'geotrackTrackPane',
						radius: SELECT_POINT_HIT_R,
						weight: 0,
						opacity: 0,
						fillOpacity: 0,
						interactive: !digitizePickBlocked
					});
					if (!digitizePickBlocked) {
						hitPt.on('click', onClick);
						hitPt.on('contextmenu', onCtx);
					}
					group.addLayer(hitPt);
					var style = pointMarkerStyle(selected, editing);
					style.interactive = false;
					var marker = L.circleMarker(ll, Object.assign({ pane: 'geotrackTrackPane' }, style));
					group.addLayer(marker);
				}
			} else {
				var latLngs = geoCoordsToLatLngs(geom && geom.coordinates);
				var ls = lineStyle(selected, editing);
				ls.interactive = false;
				appendTraceRunsWithBackdrop(
					group,
					latLngs,
					ls,
					null,
					(selected || editing) ? ls.color : null
				);
				if (latLngs.length >= 2) {
					var hitLine = L.polyline(latLngs, {
						pane: 'geotrackTrackPane',
						weight: SELECT_HIT_WEIGHT,
						opacity: 0,
						interactive: !digitizePickBlocked,
						lineCap: 'round',
						lineJoin: 'round',
						className: 'geotrack-select-hit'
					});
					if (!digitizePickBlocked) {
						hitLine.on('click', onClick);
						hitLine.on('contextmenu', onCtx);
					}
					group.addLayer(hitLine);
				}
			}
			tracksLayer.addLayer(group);
		}
	}

	function fitToGeometry(geometry) {
		if (!geometry || !geometry.coordinates) return;
		var layer = L.geoJSON({ type: 'Feature', geometry: geometry, properties: {} });
		var b = layer.getBounds();
		if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
	}

	function fitMapToTracks() {
		if (!tracks.length) return;
		var fc = tracksToFeatureCollection();
		var layer = L.geoJSON(fc);
		var b = layer.getBounds();
		if (b.isValid()) map.fitBounds(b, { padding: [48, 48], maxZoom: 15 });
	}

	function syncTracksTo3D() {
		if (window.LegacyTerrain3D && typeof window.LegacyTerrain3D.setTracks === 'function') {
			window.LegacyTerrain3D.setTracks(tracksToFeatureCollection());
		}
	}

	function featureXml(t, format) {
		var feature = trackToFeature(t);
		if (format === 'gpx') {
			return togpx(feature, {
				creator: 'track toolbox',
				featureTitle: function (props) {
					return (props && props.name) || 'Track';
				},
				featureDescription: function (props) {
					if (!props) return '';
					return props.description || props.desc || '';
				}
			});
		}
		return tokml(feature, {
			name: 'name',
			description: 'description',
			documentName: t.name,
			documentDescription: t.description
		});
	}

	function triggerDownload(blob, fileName) {
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
	}

	function zipTracks(list, format, zipName) {
		if (typeof JSZip === 'undefined') {
			showToast('JSZip missing');
			return Promise.resolve();
		}
		setBusy(true);
		var zip = new JSZip();
		var used = Object.create(null);
		for (var i = 0; i < list.length; i++) {
			var t = list[i];
			var base = sanitizeFileBase(t.name);
			var n = 1;
			var fileName = base + '.' + format;
			while (used[fileName]) {
				n++;
				fileName = base + '_' + n + '.' + format;
			}
			used[fileName] = true;
			zip.file(fileName, featureXml(t, format));
		}
		return zip.generateAsync({ type: 'blob' }).then(function (blob) {
			triggerDownload(blob, zipName);
			showToast('ZIP downloaded');
			showKofiDownloadReminder();
		}).finally(function () {
			setBusy(false);
		});
	}

	function downloadSelected(format) {
		var list = selectedTracks();
		if (!list.length) return;
		if (list.length === 1) {
			var t = list[0];
			var xml = featureXml(t, format);
			var mime = format === 'gpx' ? 'application/gpx+xml' : 'application/vnd.google-earth.kml+xml';
			triggerDownload(new Blob([xml], { type: mime }), sanitizeFileBase(t.name) + '.' + format);
			showToast(format.toUpperCase() + ' downloaded');
			showKofiDownloadReminder();
			return;
		}
		zipTracks(list, format, 'selected_' + format + '.zip');
	}

	function removeSelected() {
		var list = selectedTracks();
		if (!list.length) return;
		var removeSet = Object.create(null);
		for (var i = 0; i < list.length; i++) removeSet[list[i].id] = true;
		var n = list.length;
		tracks = tracks.filter(function (t) { return !removeSet[t.id]; });
		selectedIds = [];
		syncSelectionUi();
		syncTracksTo3D();
		if (tracks.length) fitMapToTracks();
		showToast(n === 1 ? 'Feature removed..' : n + ' features removed..');
	}

	function clearAll() {
		if (editMode) exitEditMode(true);
		tracks = [];
		selectedIds = [];
		syncSelectionUi();
		syncTracksTo3D();
		showToast('Cleared');
	}

	/* ========== Geometry edit session ========== */

	function deepClone(obj) {
		return JSON.parse(JSON.stringify(obj));
	}

	function isTypingTarget(el) {
		if (!el) return false;
		var tag = (el.tagName || '').toLowerCase();
		return tag === 'input' || tag === 'textarea' || el.isContentEditable;
	}

	var editToolboxEl = document.getElementById('geotrack-edit-toolbox');
	var editCloseBtn = document.getElementById('geotrack-edit-close');
	var confirmEl = document.getElementById('geotrack-confirm');
	var confirmMsg = document.getElementById('geotrack-confirm-msg');
	var confirmYes = document.getElementById('geotrack-confirm-yes');
	var confirmNo = document.getElementById('geotrack-confirm-no');

	editHitLayer = L.layerGroup([], { pane: 'geotrackEditHitPane' }).addTo(map);
	editHandlesLayer = L.layerGroup([], { pane: 'geotrackEditNodePane' }).addTo(map);

	map.on('contextmenu', function (e) {
		L.DomEvent.preventDefault(e.originalEvent || e);
	});

	if (editCloseBtn) {
		editCloseBtn.addEventListener('click', function () {
			askDiscardAndExit();
		});
	}

	document.querySelectorAll('.geotrack-edit-tool').forEach(function (btn) {
		btn.addEventListener('click', function () {
			if (!editMode || btn.disabled || btn.hidden) return;
			setEditTool(btn.getAttribute('data-tool'));
		});
	});

	confirmYes.addEventListener('click', function () {
		var cb = _editConfirmCb;
		hideConfirm();
		if (cb) cb(true);
	});
	confirmNo.addEventListener('click', function () {
		var cb = _editConfirmCb;
		hideConfirm();
		if (cb) cb(false);
	});

	function showConfirm(message, cb) {
		_editConfirmCb = cb;
		confirmMsg.textContent = message;
		confirmEl.hidden = false;
		confirmEl.classList.remove('is-hidden');
	}

	function hideConfirm() {
		_editConfirmCb = null;
		confirmEl.hidden = true;
		confirmEl.classList.add('is-hidden');
	}

	function isEditingPoint() {
		return !!(editWorking && editWorking.geometry && editWorking.geometry.type === 'Point');
	}

	function isPointAllowedTool(tool) {
		return tool === 'node' || tool === 'delete' || tool === 'deleteFeature';
	}

	/** Points: n / d / df. LineStrings: all tools. */
	function syncEditToolboxForGeometry() {
		var pointOnly = isEditingPoint();
		document.querySelectorAll('.geotrack-edit-tool').forEach(function (btn) {
			var tool = btn.getAttribute('data-tool');
			var allow = !pointOnly || isPointAllowedTool(tool);
			btn.hidden = !allow;
			btn.classList.toggle('is-hidden', !allow);
			btn.disabled = !allow;
		});
	}

	function setEditTool(tool) {
		if (isEditingPoint() && !isPointAllowedTool(tool)) tool = 'node';
		editTool = tool || 'node';
		syncEditToolboxForGeometry();
		document.querySelectorAll('.geotrack-edit-tool').forEach(function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-tool') === editTool);
		});
		rebuildEditChrome();
	}

	function showEditToolbox(on) {
		if (!editToolboxEl) return;
		if (on) {
			editToolboxEl.hidden = false;
			editToolboxEl.classList.remove('is-hidden');
		} else {
			editToolboxEl.hidden = true;
			editToolboxEl.classList.add('is-hidden');
		}
	}

	function pushUndo() {
		editUndoStack.push({
			tracks: deepClone(tracks),
			working: editWorking ? deepClone(editWorking) : null,
			sessionIds: editSessionIds.slice(),
			targetId: editTargetId
		});
		if (editUndoStack.length > EDIT_UNDO_MAX) editUndoStack.shift();
		editRedoStack = [];
	}

	function restoreEditState(state) {
		tracks = deepClone(state.tracks);
		editWorking = state.working ? deepClone(state.working) : null;
		editSessionIds = state.sessionIds.slice();
		editTargetId = state.targetId;
		if (editWorking) {
			var idx = tracks.findIndex(function (t) { return t.id === editWorking.id; });
			if (idx >= 0) tracks[idx] = editWorking;
		}
		selectedIds = editTargetId ? [editTargetId] : [];
		if (isEditingPoint()) editTool = 'node';
		syncSelectionUi();
		syncTracksTo3D();
		setEditTool(editTool);
	}

	function editUndo() {
		if (!editMode || !editUndoStack.length) return;
		editRedoStack.push({
			tracks: deepClone(tracks),
			working: editWorking ? deepClone(editWorking) : null,
			sessionIds: editSessionIds.slice(),
			targetId: editTargetId
		});
		restoreEditState(editUndoStack.pop());
	}

	function editRedo() {
		if (!editMode || !editRedoStack.length) return;
		editUndoStack.push({
			tracks: deepClone(tracks),
			working: editWorking ? deepClone(editWorking) : null,
			sessionIds: editSessionIds.slice(),
			targetId: editTargetId
		});
		restoreEditState(editRedoStack.pop());
	}

	function deactivateRouteSnap() {
		if (routeSnapControl && typeof routeSnapControl.deactivate === 'function') {
			routeSnapControl.deactivate();
		}
	}

	function nextPointName() {
		var n = 0;
		for (var i = 0; i < tracks.length; i++) {
			if (tracks[i].geometry && tracks[i].geometry.type === 'Point') n++;
		}
		return 'Point ' + (n + 1);
	}

	function syncPickBlocked() {
		var routeOn = !!(routeSnapControl && typeof routeSnapControl.isActive === 'function' && routeSnapControl.isActive());
		digitizePickBlocked = pointDrawActive || routeOn;
		redrawMapLayers();
	}

	function onPointDrawClick(e) {
		if (!pointDrawActive || !e || !e.latlng) return;
		L.DomEvent.stopPropagation(e);
		var t = makeTrack(nextPointName(), '', {
			type: 'Point',
			coordinates: [e.latlng.lng, e.latlng.lat]
		}, 'point');
		tracks.push(t);
		selectedIds = [t.id];
		syncSelectionUi();
		syncTracksTo3D();
		showToast('Point added');
	}

	function deactivatePointDraw() {
		if (!pointDrawActive) return;
		pointDrawActive = false;
		map.off('click', onPointDrawClick);
		L.DomUtil.removeClass(map.getContainer(), 'geotrack-point-crosshair');
		if (pointDrawBtn && pointDrawBtn.button) {
			pointDrawBtn.button.classList.remove('legacy-ctrl-selected');
		}
		if (pointDrawBtn) pointDrawBtn.state('point-draw-off');
		syncPickBlocked();
	}

	function activatePointDraw() {
		if (editMode) {
			showToast('Finish edit before adding points');
			return;
		}
		deactivateRouteSnap();
		if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) {
			exitTerrain3D();
			showToast('Point tool is 2D only');
		}
		pointDrawActive = true;
		L.DomUtil.addClass(map.getContainer(), 'geotrack-point-crosshair');
		map.on('click', onPointDrawClick);
		if (pointDrawBtn && pointDrawBtn.button) {
			pointDrawBtn.button.classList.add('legacy-ctrl-selected');
		}
		syncPickBlocked();
		showToast('Click map to add Point · Esc to exit');
	}

	function requestEnterEdit(id) {
		if (digitizePickBlocked) return;
		if (editMode && editTargetId === id) return;
		if (editMode && editSessionIds.indexOf(id) !== -1) {
			commitWorkingIntoTracksArray();
			editTargetId = id;
			editWorking = deepClone(findTrack(id));
			selectedIds = [id];
			setEditTool(isEditingPoint() ? 'node' : editTool);
			syncSelectionUi();
			return;
		}
		if (editMode && editTargetId !== id) {
			showConfirm('Discard current edits and edit another feature?', function (yes) {
				if (!yes) return;
				exitEditMode(true);
				enterEditMode(id);
			});
			return;
		}
		enterEditMode(id);
	}

	/**
	 * Keep start/end; keep a vertex when along-track distance from last kept >= stepM.
	 * Spans between kept verts become single chords. Elev preserved on kept points.
	 */
	function simplifyLineToChords(coords, stepM) {
		if (!coords || coords.length < 3) return coords;
		stepM = stepM != null ? stepM : EDIT_NODE_STEP_M;
		var total = 0;
		var i;
		for (i = 1; i < coords.length; i++) {
			total += haversineMeters(
				[coords[i - 1][1], coords[i - 1][0]],
				[coords[i][1], coords[i][0]]
			);
		}
		if (!(total >= stepM)) return coords;

		var out = [coords[0].slice()];
		var sinceKept = 0;
		for (i = 1; i < coords.length - 1; i++) {
			sinceKept += haversineMeters(
				[coords[i - 1][1], coords[i - 1][0]],
				[coords[i][1], coords[i][0]]
			);
			if (sinceKept >= stepM) {
				out.push(coords[i].slice());
				sinceKept = 0;
			}
		}
		out.push(coords[coords.length - 1].slice());
		return out.length >= 2 ? out : coords;
	}

	function applyEditSessionChordSimplify() {
		if (!editWorking || !editWorking.geometry) return;
		if (editWorking.geometry.type !== 'LineString') return;
		var coords = editWorking.geometry.coordinates;
		var next = simplifyLineToChords(coords, EDIT_NODE_STEP_M);
		if (next === coords) return;
		if (next.length === coords.length) {
			var same = true;
			for (var i = 0; i < coords.length; i++) {
				if (next[i][0] !== coords[i][0] || next[i][1] !== coords[i][1]) {
					same = false;
					break;
				}
			}
			if (same) return;
		}
		editWorking.geometry = { type: 'LineString', coordinates: next };
		commitWorkingIntoTracksArray();
	}

	function enterEditMode(id) {
		var t = findTrack(id);
		if (!t) return;
		deactivatePointDraw();
		deactivateRouteSnap();
		runBusy(function () {
			if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) exitTerrain3D();
			editMode = true;
			editTargetId = id;
			editWorking = deepClone(t);
			/* Snapshot before chord simplify so Esc restores dense original. */
			editTracksSnapshot = deepClone(tracks);
			applyEditSessionChordSimplify();
			editSessionIds = [id];
			editUndoStack = [];
			editRedoStack = [];
			editTool = 'node';
			selectedIds = [id];
			showEditToolbox(true);
			setEditTool('node');
			syncSelectionUi();
			syncTracksTo3D();
			showToast('Edit mode');
		});
	}

	function exitEditMode(silent) {
		editMode = false;
		editTargetId = null;
		editWorking = null;
		editTracksSnapshot = null;
		editSessionIds = [];
		editUndoStack = [];
		editRedoStack = [];
		clearEditPreviewLine();
		editHandlesLayer.clearLayers();
		editHitLayer.clearLayers();
		showEditToolbox(false);
		hideConfirm();
		if (!silent) {
			syncSelectionUi();
			syncTracksTo3D();
		} else {
			redrawMapLayers();
			updateButtons();
		}
	}

	function commitWorkingToTracks() {
		if (!editWorking) return;
		var idx = tracks.findIndex(function (t) { return t.id === editWorking.id; });
		if (idx >= 0) tracks[idx] = deepClone(editWorking);
	}

	function askSaveAndExit() {
		if (!editMode) return;
		commitWorkingToTracks();
		showConfirm('Save changes to this feature?', function (yes) {
			if (!yes) return;
			commitWorkingToTracks();
			exitEditMode(false);
			showToast('Saved');
		});
	}

	function askDiscardAndExit() {
		if (!editMode) return;
		showConfirm('Discard all edits and exit?', function (yes) {
			if (!yes) return;
			runBusy(function () {
				if (editTracksSnapshot) tracks = deepClone(editTracksSnapshot);
				selectedIds = [];
				exitEditMode(false);
				syncTracksTo3D();
				showToast('Discarded');
			});
		});
	}

	function latLngToCoord(ll, ele) {
		var c = [ll.lng, ll.lat];
		if (ele != null && isFinite(ele)) c.push(ele);
		return c;
	}

	function lerpEle(a, b, t) {
		if (a.length < 3 || b.length < 3) return null;
		if (!isFinite(a[2]) || !isFinite(b[2])) return null;
		return a[2] + (b[2] - a[2]) * t;
	}

	function projectClickOntoLine(coords, latlng) {
		if (!coords || coords.length < 2) return null;
		var best = null;
		for (var i = 1; i < coords.length; i++) {
			var a = coords[i - 1];
			var b = coords[i];
			var aLL = L.latLng(a[1], a[0]);
			var bLL = L.latLng(b[1], b[0]);
			var abx = bLL.lng - aLL.lng;
			var aby = bLL.lat - aLL.lat;
			var len2 = abx * abx + aby * aby;
			var t = len2 === 0 ? 0 : ((latlng.lng - aLL.lng) * abx + (latlng.lat - aLL.lat) * aby) / len2;
			t = Math.max(0, Math.min(1, t));
			var pLL = L.latLng(aLL.lat + aby * t, aLL.lng + abx * t);
			var d = latlng.distanceTo(pLL);
			if (!best || d < best.distM) {
				var ele = lerpEle(a, b, t);
				best = {
					index: i - 1,
					t: t,
					distM: d,
					cutCoord: ele != null ? [pLL.lng, pLL.lat, ele] : [pLL.lng, pLL.lat],
					cutLL: pLL
				};
			}
		}
		return best;
	}

	function applyWorkingGeometry(coords) {
		if (!editWorking) return;
		editWorking.geometry = {
			type: 'LineString',
			coordinates: coords
		};
		var idx = tracks.findIndex(function (t) { return t.id === editWorking.id; });
		if (idx >= 0) tracks[idx] = editWorking;
	}

	function editToolLetter(tool) {
		if (tool === 'scissor') return 's';
		if (tool === 'trimBefore') return '_t';
		if (tool === 'trimAfter') return 't_';
		if (tool === 'delete') return 'd';
		if (tool === 'deleteFeature') return 'df';
		return 'n';
	}

	function makeEditNodeIcon(letter, role) {
		var wide = letter.length > 1;
		var cls = 'geotrack-edit-node geotrack-edit-node--' + role +
			(wide ? ' geotrack-edit-node--wide' : '');
		var w = wide ? 18 : 14;
		var h = 12;
		return L.divIcon({
			className: 'geotrack-edit-node-wrap',
			html: '<span class="' + cls + '">' + letter + '</span>',
			iconSize: [w, h],
			iconAnchor: [w / 2, h / 2]
		});
	}

	function bindNodeDrag(marker, index, isPoint) {
		if (editTool !== 'node') return;
		marker.on('dragstart', function () {
			pushUndo();
			if (!isPoint) {
				ensureEditPreviewLine(editWorking.geometry.coordinates);
			}
		});
		marker.on('drag', function (e) {
			var p = e.target.getLatLng();
			if (isPoint) {
				var ele = editWorking.geometry.coordinates.length > 2
					? editWorking.geometry.coordinates[2] : null;
				editWorking.geometry.coordinates = latLngToCoord(p, ele);
				commitWorkingIntoTracksArray();
				return;
			}
			var coords = editWorking.geometry.coordinates;
			var ele2 = coords[index].length > 2 ? coords[index][2] : null;
			coords[index] = latLngToCoord(p, ele2);
			editWorking.geometry.coordinates = coords;
			commitWorkingIntoTracksArray();
			updateEditPreviewLine(coords);
		});
		marker.on('dragend', function () {
			clearEditPreviewLine();
			syncTracksTo3D();
			redrawMapLayers();
			rebuildEditChrome();
		});
	}

	function addEditNodeMarker(ll, role, index, isPoint) {
		var letter = editToolLetter(editTool);
		var marker = L.marker(ll, {
			icon: makeEditNodeIcon(letter, role),
			pane: 'geotrackEditNodePane',
			interactive: true,
			keyboard: false,
			draggable: editTool === 'node'
		});
		marker.on('mousedown', function (e) {
			L.DomEvent.stopPropagation(e);
		});
		marker.on('click', function (e) {
			L.DomEvent.stopPropagation(e);
			if (editTool === 'deleteFeature') {
				doDeleteSessionFeature(editWorking.id);
				return;
			}
			if (editTool === 'delete') {
				if (isPoint) doDeleteSessionFeature(editWorking.id);
				else doDeleteVertex(index);
				return;
			}
			if (isPoint) return;
			if (editTool === 'scissor') doScissorAtVertex(index);
		});
		editHandlesLayer.addLayer(marker);
		bindNodeDrag(marker, index, isPoint);
	}

	function addEditHitPolyline(coords, onClick) {
		var hit = L.polyline(geoCoordsToLatLngs(coords), {
			pane: 'geotrackEditHitPane',
			weight: EDIT_HIT_WEIGHT,
			opacity: 0,
			interactive: true,
			className: 'geotrack-edit-hit'
		});
		hit.on('click', function (e) {
			L.DomEvent.stopPropagation(e);
			onClick(e.latlng);
		});
		editHitLayer.addLayer(hit);
	}

	function rebuildEditChrome() {
		editHandlesLayer.clearLayers();
		editHitLayer.clearLayers();
		clearEditPreviewLine();
		if (!editMode || !editWorking) return;
		var geom = editWorking.geometry;
		if (!geom) return;

		if (geom.type === 'Point') {
			var pll = pointToLatLng(geom.coordinates);
			if (pll) addEditNodeMarker(pll, 'mid', 0, true);
			return;
		}

		if (geom.type !== 'LineString') return;
		var coords = geom.coordinates || [];
		if (coords.length < 1) return;

		if (editTool === 'node') {
			addEditHitPolyline(coords, insertNodeAtClick);
		} else if (editTool === 'scissor' || editTool === 'trimBefore' || editTool === 'trimAfter') {
			addEditHitPolyline(coords, onLineToolClick);
		}

		for (var i = 0; i < coords.length; i++) {
			var role = 'mid';
			if (i === 0) role = 'start';
			else if (i === coords.length - 1) role = 'end';
			addEditNodeMarker(L.latLng(coords[i][1], coords[i][0]), role, i, false);
		}
	}

	var _editPreviewLine = null;

	function commitWorkingIntoTracksArray() {
		if (!editWorking) return;
		var ix = -1;
		for (var i = 0; i < tracks.length; i++) {
			if (tracks[i].id === editWorking.id) { ix = i; break; }
		}
		if (ix >= 0) tracks[ix] = editWorking;
	}

	function ensureEditPreviewLine(coords) {
		clearEditPreviewLine();
		_editPreviewLine = L.polyline(geoCoordsToLatLngs(coords), {
			pane: 'geotrackEditHitPane',
			color: EDIT_COLOR,
			weight: 3.75,
			opacity: 0.9,
			interactive: false
		}).addTo(map);
	}

	function updateEditPreviewLine(coords) {
		if (!_editPreviewLine) ensureEditPreviewLine(coords);
		else _editPreviewLine.setLatLngs(geoCoordsToLatLngs(coords));
	}

	function clearEditPreviewLine() {
		if (_editPreviewLine) {
			map.removeLayer(_editPreviewLine);
			_editPreviewLine = null;
		}
	}

	function enableCircleDrag(marker, onMove, onStart, onEnd) {
		marker.on('mousedown', function (e) {
			L.DomEvent.stopPropagation(e);
			L.DomEvent.preventDefault(e);
			map.dragging.disable();
			if (onStart) onStart();
			function onMapMove(ev) {
				marker.setLatLng(ev.latlng);
				if (onMove) onMove(ev.latlng);
			}
			function onMapUp() {
				map.dragging.enable();
				map.off('mousemove', onMapMove);
				map.off('mouseup', onMapUp);
				if (onEnd) onEnd();
			}
			map.on('mousemove', onMapMove);
			map.on('mouseup', onMapUp);
		});
	}

	function nearestVertexPx(coords, latlng) {
		var p = map.latLngToLayerPoint(latlng);
		var best = null;
		for (var i = 0; i < coords.length; i++) {
			var c = coords[i];
			var q = map.latLngToLayerPoint(L.latLng(c[1], c[0]));
			var d = p.distanceTo(q);
			if (!best || d < best.distPx) best = { index: i, distPx: d };
		}
		return best;
	}

	function insertNodeAtClick(latlng) {
		if (!editWorking || editWorking.geometry.type !== 'LineString') return;
		var coords = editWorking.geometry.coordinates;
		var near = nearestVertexPx(coords, latlng);
		if (near && near.distPx <= EDIT_NODE_PAD_PX) return;
		var hit = projectClickOntoLine(coords, latlng);
		if (!hit) return;
		var cutNear = nearestVertexPx(coords, hit.cutLL);
		if (cutNear && cutNear.distPx <= EDIT_NODE_PAD_PX) return;
		pushUndo();
		var next = coords.slice();
		next.splice(hit.index + 1, 0, hit.cutCoord.slice());
		applyWorkingGeometry(next);
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
	}

	function onLineToolClick(latlng) {
		if (!editWorking || editWorking.geometry.type !== 'LineString') {
			showToast('Works on lines only');
			return;
		}
		var coords = editWorking.geometry.coordinates;
		var hit = projectClickOntoLine(coords, latlng);
		if (!hit) return;
		if (editTool === 'scissor') doScissor(hit);
		else if (editTool === 'trimBefore') doTrimBefore(hit);
		else if (editTool === 'trimAfter') doTrimAfter(hit);
	}

	function applyScissorSplit(aCoords, bCoords) {
		if (aCoords.length < 2 || bCoords.length < 2) {
			showToast('Cut too short');
			return;
		}
		pushUndo();
		var oldId = editWorking.id;
		var baseName = editWorking.name || 'Track';
		var desc = editWorking.description;
		var src = editWorking.sourceFile;
		var featA = makeTrack(baseName + '_1', desc, { type: 'LineString', coordinates: aCoords }, src);
		var featB = makeTrack(baseName + '_2', desc, { type: 'LineString', coordinates: bCoords }, src);
		var idx = -1;
		for (var i = 0; i < tracks.length; i++) {
			if (tracks[i].id === oldId) { idx = i; break; }
		}
		if (idx < 0) return;
		tracks.splice(idx, 1, featA, featB);
		editSessionIds = editSessionIds.filter(function (id) { return id !== oldId; });
		editSessionIds.push(featA.id, featB.id);
		editWorking = featB;
		editTargetId = featB.id;
		selectedIds = [featB.id];
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
		showToast('Split');
	}

	function doScissorAtVertex(vertexIndex) {
		if (!editWorking || editWorking.geometry.type !== 'LineString') return;
		var coords = editWorking.geometry.coordinates;
		if (vertexIndex <= 0 || vertexIndex >= coords.length - 1) {
			showToast('Cannot cut at an end');
			return;
		}
		var aCoords = coords.slice(0, vertexIndex + 1);
		var bCoords = coords.slice(vertexIndex);
		applyScissorSplit(aCoords, bCoords);
	}

	function doScissor(hit) {
		var coords = editWorking.geometry.coordinates;
		var nearVert = nearestVertexPx(coords, hit.cutLL);
		if (nearVert && nearVert.distPx <= EDIT_NODE_PAD_PX) {
			doScissorAtVertex(nearVert.index);
			return;
		}
		var i = hit.index;
		var cut = hit.cutCoord;
		var nearStart = haversineMeters([cut[1], cut[0]], [coords[0][1], coords[0][0]]) < EDIT_MIN_CUT_M;
		var nearEnd = haversineMeters(
			[cut[1], cut[0]],
			[coords[coords.length - 1][1], coords[coords.length - 1][0]]
		) < EDIT_MIN_CUT_M;
		if (nearStart || nearEnd) {
			showToast('Cut too close to an end');
			return;
		}
		var aCoords = coords.slice(0, i + 1).concat([cut.slice()]);
		var bCoords = [cut.slice()].concat(coords.slice(i + 1));
		applyScissorSplit(aCoords, bCoords);
	}

	function doTrimBefore(hit) {
		var coords = editWorking.geometry.coordinates;
		var newCoords = [hit.cutCoord.slice()].concat(coords.slice(hit.index + 1));
		if (newCoords.length < 2) {
			showToast('Nothing left after trim');
			return;
		}
		pushUndo();
		applyWorkingGeometry(newCoords);
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
		showToast('Trimmed before');
	}

	function doTrimAfter(hit) {
		var coords = editWorking.geometry.coordinates;
		var newCoords = coords.slice(0, hit.index + 1).concat([hit.cutCoord.slice()]);
		if (newCoords.length < 2) {
			showToast('Nothing left after trim');
			return;
		}
		pushUndo();
		applyWorkingGeometry(newCoords);
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
		showToast('Trimmed after');
	}

	function onEditFeatureClick(id, ev) {
		if (editTool === 'deleteFeature') {
			doDeleteSessionFeature(id);
			return;
		}
		if (editTool === 'delete' || editTool === 'node') return;
		/* line tools use hit layer */
	}

	function doDeleteVertex(index) {
		if (!editWorking || editWorking.geometry.type !== 'LineString') return;
		var coords = editWorking.geometry.coordinates;
		if (coords.length <= 2) {
			showToast('Need at least two vertices');
			return;
		}
		if (index < 0 || index >= coords.length) return;
		pushUndo();
		var next = coords.slice();
		next.splice(index, 1);
		applyWorkingGeometry(next);
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
		showToast('Node deleted');
	}

	function doDeleteSessionFeature(id) {
		if (editSessionIds.indexOf(id) === -1) {
			showToast('Only session features can be deleted');
			return;
		}
		pushUndo();
		tracks = tracks.filter(function (t) { return t.id !== id; });
		editSessionIds = editSessionIds.filter(function (x) { return x !== id; });
		if (editTargetId === id || (editWorking && editWorking.id === id)) {
			if (editSessionIds.length) {
				editTargetId = editSessionIds[0];
				editWorking = deepClone(findTrack(editTargetId));
				selectedIds = [editTargetId];
			} else {
				exitEditMode(false);
				syncTracksTo3D();
				showToast('Feature deleted — session closed');
				return;
			}
		}
		syncSelectionUi();
		syncTracksTo3D();
		rebuildEditChrome();
		showToast('Feature deleted');
	}

	document.addEventListener('keydown', function (e) {
		if (isTypingTarget(document.activeElement)) return;
		if (
			e.key === 'Escape' &&
			routeSnapControl &&
			typeof routeSnapControl.isRouting === 'function' &&
			routeSnapControl.isRouting()
		) {
			e.preventDefault();
			routeSnapControl.cancelRouting();
			return;
		}
		if (e.key === 'Escape' && pointDrawActive) {
			e.preventDefault();
			deactivatePointDraw();
			showToast('Point tool off');
			return;
		}
		if (
			routeSnapControl &&
			typeof routeSnapControl.isActive === 'function' &&
			routeSnapControl.isActive() &&
			(e.ctrlKey || e.metaKey)
		) {
			var rk = e.key;
			if ((rk === 'z' || rk === 'Z') && !e.shiftKey) {
				e.preventDefault();
				routeSnapControl.undoStation();
				return;
			}
			if (rk === 'y' || rk === 'Y' || ((rk === 'z' || rk === 'Z') && e.shiftKey)) {
				e.preventDefault();
				routeSnapControl.redoStation();
				return;
			}
		}
		if (!editMode) return;
		if (e.ctrlKey || e.metaKey || e.altKey) {
			if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
				e.preventDefault();
				editUndo();
			} else if (
				(e.ctrlKey || e.metaKey) &&
				(e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))
			) {
				e.preventDefault();
				editRedo();
			}
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			askSaveAndExit();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			askDiscardAndExit();
			return;
		}
		var k = e.key.toLowerCase();
		if (k === 'n') {
			e.preventDefault();
			setEditTool('node');
		} else if (k === 'd') {
			e.preventDefault();
			setEditTool('delete');
		} else if (k === 'f') {
			e.preventDefault();
			setEditTool('deleteFeature');
		} else if (k === 's' || k === 't') {
			if (isEditingPoint()) return;
			e.preventDefault();
			if (k === 's') setEditTool('scissor');
			else if (editTool === 'trimAfter') setEditTool('trimBefore');
			else setEditTool('trimAfter');
		}
	});

	function addRoutedTrackFromLatLngs(latLngs, profileKey, fileName) {
		var base = String(fileName || 'Route').trim() || 'Route';
		if (/\.gpx$/i.test(base)) base = base.slice(0, -4);
		base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '_');
		if (!base) base = 'Route';
		var coords = [];
		for (var i = 0; i < latLngs.length; i++) {
			var p = latLngs[i];
			if (p.ele != null && isFinite(p.ele)) coords.push([p.lng, p.lat, p.ele]);
			else coords.push([p.lng, p.lat]);
		}
		if (coords.length < 2) {
			showToast('Route too short');
			return;
		}
		var desc = profileKey ? ('BRouter · ' + profileKey) : '';
		var t = makeTrack(base, desc, { type: 'LineString', coordinates: coords }, 'digitize');
		tracks.push(t);
		selectedIds = [t.id];
		syncSelectionUi();
		syncTracksTo3D();
		fitToGeometry(t.geometry);
		showToast('Route added to tracks');
	}

	var POINT_DRAW_ICON =
		'<span class="geotrack-point-tool-icon" aria-hidden="true">' +
		'<span class="geotrack-point-tool-cross"></span>' +
		'<span class="geotrack-point-tool-dot"></span>' +
		'</span>';
	pointDrawBtn = L.easyButton({
		position: 'topright',
		states: [{
			stateName: 'point-draw-off',
			icon: POINT_DRAW_ICON,
			title: 'Add Point',
			onClick: function (btn) {
				activatePointDraw();
				btn.state('point-draw-on');
			}
		}, {
			stateName: 'point-draw-on',
			icon: POINT_DRAW_ICON,
			title: 'Exit Point tool',
			onClick: function (btn) {
				deactivatePointDraw();
				btn.state('point-draw-off');
			}
		}]
	});
	pointDrawBtn.addTo(map);

	if (typeof L.control.routeSnap === 'function') {
		routeSnapControl = L.control.routeSnap({
			position: 'topright',
			routeUrl: GEOTRACK_BROUTER_URL,
			routeKey: GEOTRACK_BROUTER_KEY,
			profileKey: 'mtb',
			waypointPane: 'digitizePane',
			routePane: 'digitizeRoutePane'
		}).addTo(map);

		map.on('routesnap:save', function (e) {
			addRoutedTrackFromLatLngs(e.latLngs, e.profileKey, e.fileName);
		});
		map.on('routesnap:error', function () {
			showToast('Router unavailable');
		});
		map.on('routesnap:activate', function () {
			if (editMode) {
				deactivateRouteSnap();
				showToast('Finish edit before digitize');
				return;
			}
			deactivatePointDraw();
			digitizePickBlocked = true;
			redrawMapLayers();
			if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) {
				exitTerrain3D();
				showToast('Digitize is 2D only');
			}
		});
		map.on('routesnap:deactivate', function () {
			syncPickBlocked();
		});
	}

	updateButtons();
	showWelcomePanel();
})();

