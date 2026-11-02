/* GPX ↔ KML converter — Leaflet 2D + Mapbox 3D */
(function () {
	'use strict';

	var CONVERTER_VERSION = '1.0.0';
	var DEFAULT_CENTER = [47.2692, 11.4041];
	var DEFAULT_ZOOM = 11;
	var MAX_FILE_BYTES = 25 * 1024 * 1024;
	/** Chord longer than this → dotted vanish style (same idea as chaser). */
	var GAP_DOT_M = 500;
	var GAP_FADE_END = 0.3;
	var GAP_FADE_STEPS = 10;
	var TRACE_BACKDROP_STYLE = {
		color: '#e0e0e0',
		weight: 2.5,
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

	var map = L.map('map', {
		zoom: DEFAULT_ZOOM,
		zoomControl: false,
		attributionControl: false
	});
	map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

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
			' · <span class="legacy-attribution-version">v' + CONVERTER_VERSION + '</span>'
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
	window.converterExitTerrain3D = exitTerrain3D;

	tracksLayer = L.layerGroup().addTo(map);

	/* ---------- UI refs ---------- */
	var fileInput = document.getElementById('converter-file-input');
	var uploadBtn = document.getElementById('converter-upload-btn');
	var trackListEl = document.getElementById('converter-track-list');
	var nameInput = document.getElementById('converter-name');
	var descInput = document.getElementById('converter-desc');
	var dlGpxBtn = document.getElementById('converter-dl-gpx');
	var dlKmlBtn = document.getElementById('converter-dl-kml');
	var dlZipGpxBtn = document.getElementById('converter-dl-zip-gpx');
	var dlZipKmlBtn = document.getElementById('converter-dl-zip-kml');
	var removeBtn = document.getElementById('converter-remove');
	var clearBtn = document.getElementById('converter-clear');

	uploadBtn.addEventListener('click', function () { fileInput.click(); });
	fileInput.addEventListener('change', function () {
		var files = Array.prototype.slice.call(fileInput.files || []);
		fileInput.value = '';
		if (files.length) handleFiles(files);
	});

	nameInput.addEventListener('input', function () {
		if (_suppressFieldSync || selectedIds.length !== 1) return;
		var t = findTrack(selectedIds[0]);
		if (!t) return;
		t.name = nameInput.value;
		refreshTrackList();
		redrawMapLayers();
		syncTracksTo3D();
	});
	descInput.addEventListener('input', function () {
		if (_suppressFieldSync || selectedIds.length !== 1) return;
		var t = findTrack(selectedIds[0]);
		if (!t) return;
		t.description = descInput.value;
	});

	dlGpxBtn.addEventListener('click', function () { downloadSelected('gpx'); });
	dlKmlBtn.addEventListener('click', function () { downloadSelected('kml'); });
	dlZipGpxBtn.addEventListener('click', function () { downloadAllZip('gpx'); });
	dlZipKmlBtn.addEventListener('click', function () { downloadAllZip('kml'); });
	removeBtn.addEventListener('click', removeSelected);
	clearBtn.addEventListener('click', clearAll);

	/* ---------- helpers ---------- */

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
			var name = props.name || sourceFile || 'KML Track';
			var desc = props.description || props.desc || '';
			if (typeof desc !== 'string') desc = String(desc || '');
			var lines = lineCoordsFromGeom(f.geometry);
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
			if (!selectedIds.length) {
				selectedIds = [tracks[tracks.length - 1].id];
			}
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
		else showToast('No tracks found');
	}

	/** Toggle: add if not selected, remove if already selected. */
	function toggleTrack(id) {
		if (!id || !findTrack(id)) return;
		var idx = selectedIds.indexOf(id);
		if (idx >= 0) selectedIds.splice(idx, 1);
		else selectedIds.push(id);
		syncSelectionUi();
	}

	function syncSelectionUi() {
		pruneSelection();
		_suppressFieldSync = true;
		if (selectedIds.length === 1) {
			var t = findTrack(selectedIds[0]);
			nameInput.disabled = false;
			descInput.disabled = false;
			nameInput.value = t ? t.name : '';
			descInput.value = t ? t.description : '';
		} else {
			nameInput.disabled = true;
			descInput.disabled = true;
			nameInput.value = selectedIds.length ? '(' + selectedIds.length + ' selected)' : '';
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
			btn.className = 'converter-track-item' + (isSelected(t.id) ? ' is-selected' : '');
			btn.textContent = t.name || '(unnamed)';
			btn.title = (isSelected(t.id) ? 'Deselect: ' : 'Add to selection: ') + (t.name || '(unnamed)');
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
		dlZipGpxBtn.disabled = tracks.length < 1;
		dlZipKmlBtn.disabled = tracks.length < 1;
		removeBtn.disabled = !hasSel;
		clearBtn.disabled = !hasAny;
	}

	function lineStyle(selected) {
		return {
			color: selected ? '#ff5f1f' : '#00b9fe',
			weight: selected ? 5 : 3,
			opacity: 0.95,
			lineCap: 'round',
			lineJoin: 'round'
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

	function appendTraceRun(layerGroup, run, style, onClick) {
		if (!run || !run.latLngs || run.latLngs.length < 2) return;
		function addLine(latLngs, opts) {
			var pl = L.polyline(latLngs, opts);
			if (onClick && opts.interactive !== false) pl.on('click', onClick);
			layerGroup.addLayer(pl);
		}
		if (!run.dotted) {
			addLine(run.latLngs, style);
			return;
		}
		var baseOpacity = style.opacity != null ? style.opacity : 1;
		var chunks = dottedFadeChunks(run.latLngs);
		for (var i = 0; i < chunks.length; i++) {
			addLine(chunks[i].latLngs, Object.assign({}, style, {
				dashArray: '1 6',
				opacity: baseOpacity * chunks[i].opacity
			}));
		}
	}

	function appendTraceRunsWithBackdrop(layerGroup, latLngs, style, onClick) {
		var runs = traceRuns(latLngs);
		var i;
		for (i = 0; i < runs.length; i++) {
			appendTraceRun(layerGroup, runs[i], TRACE_BACKDROP_STYLE, null);
		}
		for (i = 0; i < runs.length; i++) {
			appendTraceRun(layerGroup, runs[i], style, onClick);
		}
	}

	function redrawMapLayers() {
		tracksLayer.clearLayers();
		for (var i = 0; i < tracks.length; i++) {
			var t = tracks[i];
			var selected = isSelected(t.id);
			var group = L.layerGroup();
			group._converterTrackId = t.id;
			var latLngs = geoCoordsToLatLngs(t.geometry && t.geometry.coordinates);
			var onClick = (function (id) {
				return function () { toggleTrack(id); };
			})(t.id);
			appendTraceRunsWithBackdrop(group, latLngs, lineStyle(selected), onClick);
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
				creator: 'tiroltrailhead-gpx-kml-converter',
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
			return;
		}
		zipTracks(list, format, 'selected_' + format + '.zip');
	}

	function downloadAllZip(format) {
		if (!tracks.length) return;
		zipTracks(tracks, format, 'tracks_' + format + '.zip');
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
		showToast(n === 1 ? 'Track removed' : n + ' tracks removed');
	}

	function clearAll() {
		tracks = [];
		selectedIds = [];
		syncSelectionUi();
		syncTracksTo3D();
		showToast('Cleared');
	}

	updateButtons();
})();
