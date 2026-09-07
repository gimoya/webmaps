/* PW protection 
function trim(str) {
	return str.replace(/^\s+|\s+$/g, '');  
}

var pw_prompt = prompt('Passwort eingeben um auf die Seite **Legacy Trails Tirol** zu gelangen..',' ');
var pw = 'coffee';
// if prompt is cancelled the pw_prompt var will be null!
if (pw_prompt == null) {
	alert('Kein Passwort wurde angegeben! Die Seite wird nicht geladen...');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();s
	}
	window.location='tilt.html';
}
if (trim(pw_prompt) == pw ) {
	alert('Passwort ok!');
} else {
	alert('Falsches Passwort! Die Seite wird nicht geladen..');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();
	}
	window.location='tilt.html';
}
*/


/** Strip trailing "(123)" IDs from trail names for all UI display. */
function legacyCleanTrailName(name) {
	if (typeof name !== 'string') return name;
	return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

function legacyCleanTrailFeatureNames(features) {
	for (var i = 0; i < features.length; i++) {
		var p = features[i].properties;
		if (p && typeof p.name === 'string') {
			p.name = legacyCleanTrailName(p.name);
		}
	}
}

/*** Set Up Map ***/
var map = L.map('map', {
  zoom: 15,
  zoomControl: false,
  attributionControl: false
});

/*** URL query: ?z= or ?zoom=, ?lat=, ?lng= or ?lon= — shareable view; synced on pan/zoom ***/
var _legacyUrlSyncTimer = null;
var _legacyUrlSyncSuppressed = false;
/** Default zoom when URL has no lat/lng/z; center comes from trails bounds. */
var LEGACY_DEFAULT_START_ZOOM = 11;
var LEGACY_TRAILS_VERSION = '2.1.0';

function legacyDefaultStartViewFromTrails() {
	if (!trails_json) return null;
	var c = trails_json.getBounds().getCenter();
	return { lat: c.lat, lng: c.lng, zoom: LEGACY_DEFAULT_START_ZOOM };
}

function legacyParseUrlMapView() {
	var params = new URLSearchParams(window.location.search);
	var zRaw = params.get('z');
	if (zRaw == null || zRaw === '') zRaw = params.get('zoom');
	var lat = parseFloat(params.get('lat'));
	var lng = parseFloat(params.get('lng'));
	if (lng !== lng) lng = parseFloat(params.get('lon'));
	if (zRaw == null || zRaw === '' || lat !== lat || lng !== lng) return null;
	var z = parseInt(zRaw, 10);
	if (z !== z) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return { lat: lat, lng: lng, zoom: z };
}

function legacyClampZoom(z) {
	var minZ = map.getMinZoom();
	var maxZ = map.getMaxZoom();
	if (!isFinite(minZ)) minZ = 1;
	if (!isFinite(maxZ)) maxZ = 18;
	return Math.max(minZ, Math.min(maxZ, z));
}

function legacyWriteUrlFromMap() {
	if (_legacyUrlSyncSuppressed) return;
	try {
		var c = map.getCenter();
		var z = map.getZoom();
		var u = new URL(window.location.href);
		u.searchParams.set('lat', c.lat.toFixed(5));
		u.searchParams.set('lng', c.lng.toFixed(5));
		u.searchParams.set('z', String(z));
		history.replaceState(null, '', u.pathname + u.search + u.hash);
	} catch (e) { /* opaque URL or no history */ }
}

function legacyScheduleUrlSync() {
	if (_legacyUrlSyncSuppressed) return;
	if (_legacyUrlSyncTimer) clearTimeout(_legacyUrlSyncTimer);
	_legacyUrlSyncTimer = setTimeout(function () {
		_legacyUrlSyncTimer = null;
		legacyWriteUrlFromMap();
	}, 300);
}

function legacyApplyParsedView(view, options) {
	options = options || {};
	if (!view) return false;
	var z = legacyClampZoom(view.zoom);
	_legacyUrlSyncSuppressed = true;
	map.setView([view.lat, view.lng], z, { animate: options.animate !== false });
	setTimeout(function () {
		_legacyUrlSyncSuppressed = false;
		if (!options.skipUrl) legacyWriteUrlFromMap();
	}, 50);
	return true;
}

window.legacyTrailsMapHooks = {
	parseViewFromUrl: legacyParseUrlMapView,
	applyView: function (lat, lng, zoom, opts) {
		return legacyApplyParsedView({ lat: lat, lng: lng, zoom: zoom }, opts || {});
	},
	refreshUrlFromMap: function () {
		legacyWriteUrlFromMap();
	},
	getMap: function () {
		return map;
	},
	defaultStartView: legacyDefaultStartViewFromTrails,
	defaultStartZoom: LEGACY_DEFAULT_START_ZOOM
};

/*** Set Up Base Map Layers ***/

var LEGACY_TILE_OPTS = {
	updateWhenIdle: true,
	updateWhenZooming: false,
	keepBuffer: 2,
	crossOrigin: true,
};

var map_satelliteUrl = 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';

var map_topoUrl = 'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png';

var map_satelliteLayer = L.tileLayer(map_satelliteUrl, Object.assign({}, LEGACY_TILE_OPTS, {
	attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
	maxZoom: 18,
	subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
}));

var map_topoLayer = L.tileLayer(map_topoUrl, Object.assign({}, LEGACY_TILE_OPTS, {
	minZoom: 1,
	maxZoom: 17,
	attribution:
		'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · '
		+ '<a href="https://wiki.openstreetmap.org/wiki/Hiking/openhikingmap">OpenHiking</a>',
}));

/*** Setting Default Base Map ***/
map_satelliteLayer.addTo(map);	

/*** Map Selection and Zoom Controls ***/

/* Source Map Attribution — Tirol Trailhead once, layer credits swap on basemap toggle */
var attribution = L.control.attribution({ position: 'bottomright', prefix: false });
attribution.addTo(map);
map.attributionControl = attribution;
attribution.addAttribution(
	'<a href="https://tiroltrailhead.com/guiding">Tirol Trailhead</a>'
	+ ' · <span class="legacy-attribution-version">v' + LEGACY_TRAILS_VERSION + '</span>'
);

/* Zoom */
new L.Control.Zoom({ position: 'topright' }).addTo(map);

/*** Add Center View Control ***/

var centerView = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'centerView',
	icon: '<i class="fas fa-compress"></i>',
	title: 'Center View',		
	onClick: function(control) {
		if (window.LegacyTerrain3D && window.LegacyTerrain3D.visible) {
			window.LegacyTerrain3D.flyToOverview();
			legacyShowWelcomeAndHeader();
			return;
		}
		legacyShowWelcomeAndHeader();
		var startView = legacyDefaultStartViewFromTrails();
		if (!startView) return;
		map.setView([startView.lat, startView.lng], startView.zoom);
	}
  }]
});	

centerView.addTo(map);
if (centerView.getContainer) {
	centerView.getContainer().classList.add('legacy-center-view');
}

/* Base Map Toggle — starts on satellite (Luftbild) */
var toggle = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'basemap-satellite',
	icon: '<span class="custom-control">T</span>',
	title: 'Hintergrundkarte Topo',
	onClick: function(control) {
	  map.removeLayer(map_satelliteLayer);
	  map.addLayer(map_topoLayer);
	  control.state('basemap-topo');
	}
  }, {
	stateName: 'basemap-topo',
	icon: '<span class="custom-control">S</span>',
	title: 'Hintergrundkarte Luftbild',
	onClick: function(control) {
	  map.removeLayer(map_topoLayer);
	  map.addLayer(map_satelliteLayer);
	  control.state('basemap-satellite');
	}
  }]
});

toggle.addTo(map);


/*** Add Location Control ***/

L.control.locate({
    strings: {
        title: "Zeige GPS-Standort"
    },
	position: 'topright'
}).addTo(map);

/*** Load / display local GPX (temporary 2D overlay) ***/

var LEGACY_GPX_MAX_BYTES = 10 * 1024 * 1024;
var LEGACY_GPX_MIN_SPACING_M = 10; /* max 10 vertices per 100 m */
var _legacyGpxOverlay = null;
var _legacyGpxData = null;
var _legacyGpxFileInput = null;
var gpxLoadBtn = null;

function legacyHaversineM(lon1, lat1, lon2, lat2) {
	var R = 6371000;
	var toRad = Math.PI / 180;
	var dLat = (lat2 - lat1) * toRad;
	var dLon = (lon2 - lon1) * toRad;
	var a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
		Math.sin(dLon / 2) * Math.sin(dLon / 2);
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function legacyThinLineCoords(coords) {
	if (!coords || coords.length <= 2) return coords ? coords.slice() : [];
	var out = [coords[0]];
	var last = coords[0];
	for (var i = 1; i < coords.length - 1; i++) {
		var c = coords[i];
		if (legacyHaversineM(last[0], last[1], c[0], c[1]) >= LEGACY_GPX_MIN_SPACING_M) {
			out.push(c);
			last = c;
		}
	}
	var end = coords[coords.length - 1];
	var prev = out[out.length - 1];
	if (prev[0] !== end[0] || prev[1] !== end[1]) out.push(end);
	return out;
}

function legacyGpxLocalName(node) {
	return node && node.localName ? node.localName : '';
}

function legacyGpxChildText(parent, name) {
	if (!parent || !parent.children) return '';
	for (var i = 0; i < parent.children.length; i++) {
		if (legacyGpxLocalName(parent.children[i]) === name) {
			return (parent.children[i].textContent || '').trim();
		}
	}
	return '';
}

function legacyGpxPointsFromParent(parent, ptName) {
	var coords = [];
	if (!parent || !parent.children) return coords;
	for (var i = 0; i < parent.children.length; i++) {
		var el = parent.children[i];
		if (legacyGpxLocalName(el) !== ptName) continue;
		var lat = parseFloat(el.getAttribute('lat'));
		var lon = parseFloat(el.getAttribute('lon'));
		if (!isFinite(lat) || !isFinite(lon)) continue;
		var eleStr = legacyGpxChildText(el, 'ele');
		var ele = eleStr ? parseFloat(eleStr) : NaN;
		if (isFinite(ele)) coords.push([lon, lat, ele]);
		else coords.push([lon, lat]);
	}
	return coords;
}

function legacyParseGpxToGeoJSON(xmlText) {
	var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
	if (!doc || !doc.documentElement || doc.querySelector('parsererror')) {
		throw new Error('invalid-gpx');
	}
	var features = [];
	var nodes = doc.getElementsByTagName('*');
	for (var i = 0; i < nodes.length; i++) {
		var n = nodes[i];
		var ln = legacyGpxLocalName(n);
		if (ln === 'trk') {
			var trackName = legacyGpxChildText(n, 'name') || 'GPX Track';
			for (var j = 0; j < n.children.length; j++) {
				var seg = n.children[j];
				if (legacyGpxLocalName(seg) !== 'trkseg') continue;
				var coords = legacyThinLineCoords(legacyGpxPointsFromParent(seg, 'trkpt'));
				if (coords.length < 2) continue;
				features.push({
					type: 'Feature',
					properties: { name: trackName },
					geometry: { type: 'LineString', coordinates: coords }
				});
			}
		} else if (ln === 'rte') {
			var routeName = legacyGpxChildText(n, 'name') || 'GPX Route';
			var rcoords = legacyThinLineCoords(legacyGpxPointsFromParent(n, 'rtept'));
			if (rcoords.length < 2) continue;
			features.push({
				type: 'Feature',
				properties: { name: routeName },
				geometry: { type: 'LineString', coordinates: rcoords }
			});
		}
	}
	return { type: 'FeatureCollection', features: features };
}

function legacyClearGpxOverlay() {
	if (_legacyGpxOverlay) {
		map.removeLayer(_legacyGpxOverlay);
		_legacyGpxOverlay = null;
	}
	_legacyGpxData = null;
	if (window.LegacyTerrain3D) window.LegacyTerrain3D.clearUserGpx();
	if (gpxLoadBtn) {
		gpxLoadBtn.state('gpx-load');
		if (gpxLoadBtn.button) gpxLoadBtn.button.classList.remove('legacy-ctrl-selected');
	}
}

function legacyShowGpxOverlay(fc) {
	legacyClearGpxOverlay();
	_legacyGpxData = fc;
	var casing = L.geoJSON(fc, {
		style: {
			color: '#2f2f2f',
			weight: 6,
			opacity: 0.35,
			lineCap: 'round',
			lineJoin: 'round'
		},
		interactive: false
	});
	var line = L.geoJSON(fc, {
		style: {
			color: '#00b9fe',
			weight: 3,
			opacity: 0.9,
			lineCap: 'butt',
			lineJoin: 'round',
			dashArray: '8 7'
		},
		interactive: false
	});
	_legacyGpxOverlay = L.layerGroup([casing, line]).addTo(map);
	var b = casing.getBounds();
	if (b && b.isValid()) {
		map.fitBounds(b, { padding: [40, 40] });
	}
	if (window.LegacyTerrain3D) window.LegacyTerrain3D.setUserGpx(fc);
	if (gpxLoadBtn) {
		gpxLoadBtn.state('gpx-clear');
		if (gpxLoadBtn.button) gpxLoadBtn.button.classList.add('legacy-ctrl-selected');
	}
}

function legacyEnsureGpxFileInput() {
	if (_legacyGpxFileInput) return _legacyGpxFileInput;
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = '.gpx,application/gpx+xml,application/xml,text/xml';
	input.setAttribute('aria-hidden', 'true');
	input.style.display = 'none';
	input.addEventListener('change', function () {
		var file = input.files && input.files[0];
		input.value = '';
		if (!file) return;
		if (file.size > LEGACY_GPX_MAX_BYTES) {
			legacyShowMapToast('GPX zu groß (max. 10 MB)');
			return;
		}
		var reader = new FileReader();
		reader.onload = function () {
			try {
				var fc = legacyParseGpxToGeoJSON(String(reader.result || ''));
				if (!fc.features.length) {
					legacyShowMapToast('Keine Track-/Routenpunkte in der GPX');
					return;
				}
				legacyShowGpxOverlay(fc);
			} catch (err) {
				legacyShowMapToast('GPX ungültig');
			}
		};
		reader.onerror = function () {
			legacyShowMapToast('GPX konnte nicht gelesen werden');
		};
		reader.readAsText(file);
	});
	document.body.appendChild(input);
	_legacyGpxFileInput = input;
	return input;
}

gpxLoadBtn = L.easyButton({
	position: 'topright',
	states: [{
		stateName: 'gpx-load',
		icon: '<i class="fas fa-file-upload"></i>',
		title: 'GPX laden',
		onClick: function () {
			legacyDismissChromeOnUserAction();
			legacyEnsureGpxFileInput().click();
		}
	}, {
		stateName: 'gpx-clear',
		icon: '<i class="fas fa-trash"></i>',
		title: 'GPX entfernen',
		onClick: function () {
			legacyClearGpxOverlay();
		}
	}]
});
gpxLoadBtn.addTo(map);
if (gpxLoadBtn.getContainer) {
	gpxLoadBtn.getContainer().classList.add('legacy-gpx-load');
}

/*** 3D terrain overlay toggle ***/

function legacySyncTerrain3DTrail() {
	if (!window.LegacyTerrain3D || !window.LegacyTerrain3D.visible) return;
	var name = selected && selected.feature && selected.feature.properties
		? selected.feature.properties.name
		: null;
	if (name) window.LegacyTerrain3D.flashHighlight(name);
}

function legacySelectedTrailName() {
	return selected && selected.feature && selected.feature.properties
		? selected.feature.properties.name
		: null;
}

function legacySyncTerrain3DBounds() {
	if (!window.LegacyTerrain3D || !window.LegacyTerrain3D.visible) return;
	window.LegacyTerrain3D.syncBounds(map);
}

var terrain3dToggle = L.easyButton({
	position: 'topright',
	states: [{
		stateName: 'terrain-3d-off',
		icon: '<i class="fas fa-cube"></i>',
		title: '3D Ansicht',
		onClick: function (btn) {
			legacyDismissChromeOnUserAction();
			if (!window.LegacyTerrain3D) return;
			window.LegacyTerrain3D.show(map, legacySelectedTrailName()).then(function () {
				btn.state('terrain-3d-on');
				if (btn.button) btn.button.classList.add('legacy-ctrl-selected');
			}).catch(function (err) {
				console.error(err);
			});
		}
	}, {
		stateName: 'terrain-3d-on',
		icon: '<i class="fas fa-map"></i>',
		title: '2D Ansicht',
		onClick: function (btn) {
			if (window.LegacyTerrain3D) window.LegacyTerrain3D.hide(map);
			btn.state('terrain-3d-off');
			if (btn.button) btn.button.classList.remove('legacy-ctrl-selected');
		}
	}]
});

terrain3dToggle.addTo(map);
if (terrain3dToggle.getContainer) {
	terrain3dToggle.getContainer().classList.add('legacy-3d-toggle');
}

window.legacyExitTerrain3D = function () {
	if (window.LegacyTerrain3D) window.LegacyTerrain3D.hide(map);
	if (terrain3dToggle) {
		terrain3dToggle.state('terrain-3d-off');
		if (terrain3dToggle.button) {
			terrain3dToggle.button.classList.remove('legacy-ctrl-selected');
		}
	}
};

function legacyShowMapToast(text) {
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

/** Filters only apply in 2D — leave 3D and tell the user. */
function legacyExit3DForFilterIfNeeded() {
	if (!window.LegacyTerrain3D || !window.LegacyTerrain3D.visible) return;
	window.legacyExitTerrain3D();
	legacyShowMapToast('Wechsle in 2D Ansicht für Filter');
}

/*** Set Up Elevation Control ***/

var el = L.control.elevation({
			position: "bottomright",
			theme: "lime-theme", //default: lime-theme
			width: 320,	
			height: 160,
			margins: {
				top: 20,
				right: 36,
				bottom: 30,
				left: 60
			},
			useHeightIndicator: true, //if false a marker is drawn at map position
			interpolation: "linear", //see https://github.com/mbostock/d3/wiki/SVG-Shapes#wiki-area_interpolate
			hoverNumber: {
				decimalsX: 2, //decimals on distance (always in km)
				decimalsY: 0, //decimals on height (always in m)
				formatter: undefined //custom formatter function may be injected
			},
			xTicks: undefined, //number of ticks in x axis, calculated by default according to width
			yTicks: undefined, //number of ticks on y axis, calculated by default according to height
			collapsed: false,  //collapsed mode, show chart on click or mouseover
			imperial: false    //display imperial units instead of metric
	});



// Legend button removed - now using the legend label as trigger

// Legend label now uses onclick attribute - no additional JS needed

// Add function to update trails in view
var legacyTrailFilterState = (window.LegacyTrailFilters && LegacyTrailFilters.createState)
	? LegacyTrailFilters.createState()
	: { flow: 0, killer: 0, tech: 0, features: 0, exposure: 0, status: 0 };
var trails_click_layer = null;
var _legacyFilterRadioLast = Object.create(null);

function legacyReadFilterStateFromLegend() {
	var state = LegacyTrailFilters.createState();
	var keys = Object.keys(LegacyTrailFilters.FILTER_KEYS);
	for (var i = 0; i < keys.length; i++) {
		var key = keys[i];
		var checked = document.querySelector('input[type="radio"][data-filter-key="' + key + '"]:checked');
		state[key] = checked ? (parseInt(checked.getAttribute('data-filter-level'), 10) || 0) : 0;
	}
	return state;
}

function legacyUpdateFilterCount(inViewMatched, inViewTotal) {
	var el = document.getElementById('legacy-filter-count');
	if (!el || !window.LegacyTrailFilters) return;
	if (!LegacyTrailFilters.isActive(legacyTrailFilterState)) {
		el.hidden = true;
		el.textContent = '';
		return;
	}
	var filteredTotal = LegacyTrailFilters.countMatching(legacyTrailFilterState);
	el.hidden = false;
	el.textContent = inViewMatched + ' im Ausschnitt · ' + filteredTotal + ' gefiltert';
}

function legacyApplyTrailFilters() {
	if (!window.LegacyTrailFilters || !trails_json) return;
	legacyTrailFilterState = legacyReadFilterStateFromLegend();
	LegacyTrailFilters.applyToLayerGroup(trails_json, legacyTrailFilterState, {
		visibleStyle: styleLines,
		hiddenStyle: { opacity: 0, fillOpacity: 0 }
	});
	if (trails_click_layer) {
		LegacyTrailFilters.applyToLayerGroup(trails_click_layer, legacyTrailFilterState, {
			visibleStyle: styleClickLayer,
			hiddenStyle: { opacity: 0, fillOpacity: 0 }
		});
	}
	trails_json.eachLayer(function (layer) {
		legacySetEndpointMarkersVisible(layer, layer._legacyFilterVisible !== false);
	});
	if (selected && selected._legacyFilterVisible === false) {
		selected.setText(null);
		selected = null;
		map.closePopup();
		if (typeof el !== 'undefined') {
			el.clear();
			map.removeControl(el);
		}
		legacySyncTerrain3DTrail();
	}
	updateTrailsInView();
}

function legacySetEndpointMarkersVisible(trailLayer, visible) {
	var markers = [trailLayer._startMarker, trailLayer._endMarker];
	for (var i = 0; i < markers.length; i++) {
		var marker = markers[i];
		if (!marker) continue;
		marker._legacyFilterVisible = visible;
		if (visible) {
			marker.setStyle({
				opacity: 1,
				fillOpacity: 1
			});
			if (marker._path) {
				marker._path.style.pointerEvents = '';
			}
		} else {
			marker.setStyle({
				opacity: 0,
				fillOpacity: 0
			});
			if (marker._path) {
				marker._path.style.pointerEvents = 'none';
			}
			if (marker.closeTooltip) {
				marker.closeTooltip();
			}
		}
	}
}

function legacyBindLegendFilters() {
	if (document._legacyLegendFiltersBound || !window.LegacyTrailFilters) return;
	document._legacyLegendFiltersBound = true;
	var legend = document.querySelector('.legend-content');
	if (!legend) return;

	legend.addEventListener('mousedown', function (e) {
		var input = e.target.closest && e.target.closest('input[type="radio"][data-filter-key]');
		if (!input) return;
		input._legacyWasChecked = input.checked;
	});

	legend.addEventListener('click', function (e) {
		var input = e.target.closest && e.target.closest('input[type="radio"][data-filter-key]');
		if (!input) return;
		legacyExit3DForFilterIfNeeded();
		if (input._legacyWasChecked) {
			input.checked = false;
			_legacyFilterRadioLast[input.name] = null;
			legacyApplyTrailFilters();
			return;
		}
		_legacyFilterRadioLast[input.name] = input.value;
		legacyApplyTrailFilters();
	});

	var resetBtn = document.getElementById('legacy-filter-reset');
	if (resetBtn) {
		resetBtn.addEventListener('click', function () {
			legacyExit3DForFilterIfNeeded();
			var radios = legend.querySelectorAll('input[type="radio"][data-filter-key]');
			for (var i = 0; i < radios.length; i++) {
				radios[i].checked = false;
			}
			_legacyFilterRadioLast = Object.create(null);
			legacyApplyTrailFilters();
		});
	}
}

function updateTrailsInView() {
    if (!trails_json || !map || !map._loaded) return;
    
    var bounds = map.getBounds();
    var trailsInView = [];
    var inViewTotal = 0;
    var content = '';
    
    trails_json.eachLayer(function(layer) {
        if (!bounds.intersects(layer.getBounds())) return;
        inViewTotal++;
        if (layer._legacyFilterVisible === false) return;
        if (window.LegacyTrailFilters && !LegacyTrailFilters.matchesFeature(layer.feature, legacyTrailFilterState)) return;
        trailsInView.push({
            feature: layer.feature,
            layer: layer
        });
    });
    
    if (trailsInView.length === 0) {
        content += '<div class="trail-item no-trails">' +
			(inViewTotal === 0
				? '..keine Trails in diesem Kartenauschnitt!'
				: '..keine Trails passen zum Filter in diesem Ausschnitt!') +
			'</div>';
    } else {
        trailsInView.forEach(function(trail) {
            content += `
                <div class="trail-item" data-trail-name="${trail.feature.properties.name}">
                    <h3>${trail.feature.properties.name}</h3>
                    <p>${trail.feature.properties.Trail_Text}</p>
                </div>
            `;
        });
    }
    
    // Remove existing trail items but keep the h2
    $('.trails-list .trail-item').remove();
    // Append new content after the h2
    $('.trails-list h2').after(content);
    
    // Add click handlers to trail items
    $('.trail-item').on('click', function() {
        var trailName = $(this).data('trail-name');
        if (trailName) {
            legacyFocusTrailByName(trailName);
        }
    });

	legacyUpdateFilterCount(trailsInView.length, inViewTotal);
}


// Add event listeners for map movement (moveend covers pan + zoom)
map.on('moveend', function () {
	updateTrailsInView();
	legacyScheduleUrlSync();
});

map.on('popupopen', function (e) {
	legacyMountPopupCloseInFrame(e.popup);
	legacyEnsureGpxDownloadUrl(e.popup);
	legacyBindGpxKofiReminder(e.popup);
});
map.on('popupclose', function (e) {
	legacyRevokeGpxDownloadUrl(e.popup);
});

legacyBindHeaderHideOnMapUse();
legacyBindPanelClickIsolation();
legacyBindLegendFilters();

// Initial update
updateTrailsInView();

/*** Trail Style-Helper Functions ***/

function findMatchingLayer(clickLayer, trailsLayer) {
    var matchingLayer = null;
    trailsLayer.eachLayer(function(layer) {
        if (layer.feature.properties.name === clickLayer.feature.properties.name) {
            matchingLayer = layer;
        }
    });
    return matchingLayer;
}

function highlight (layer) {	// will be used on hover
    var mainLayer = findMatchingLayer(layer, trails_json);
    if (mainLayer && mainLayer._legacyFilterVisible !== false) {
        mainLayer.setStyle({
            weight: 4,       // wider line
            dashArray: '',
            opacity: 0.95      // slightly more opaque
        });
        if (!L.Browser.ie && !L.Browser.opera) {
            mainLayer.bringToFront();
        }
    }
}

function styleLines(feature) {	// deafult style used for constructor of json
    return {
		color: '#FF5F1F',
		weight: 3,
		opacity: 0.8,
		lineJoin: 'round',  //miter | round | bevel 
    };
}

function styleClickLayer(feature) {	// style for click layer
    return {
		color: '#000000',
		weight: 8,  // double the width
		opacity: 0.4, // semi-transparent
		lineJoin: 'round',
    };
}

/*** Map and Json Layer Event Listeners and Helper Functions ***/
			
var lyr;
var ftr;
var trails_json;

var selected = null;

function dehighlight (layer) { 	// will be used inside select function
    if (selected === null || (selected && selected.feature.properties.name !== layer.feature.properties.name)) {
        var mainLayer = findMatchingLayer(layer, trails_json);
        if (mainLayer) {
            if (mainLayer._legacyFilterVisible === false) {
                mainLayer.setStyle({ opacity: 0, fillOpacity: 0 });
                if (mainLayer._path) mainLayer._path.style.pointerEvents = 'none';
            } else {
                trails_json.resetStyle(mainLayer);
            }
            mainLayer.setText(null);
        }
    }
}

function select (layer) {  // ..use inside onClick Function doClickStuff() to select and style clicked feature 
    if (selected !== null) {
        var previous = selected;
    }
    var mainLayer = findMatchingLayer(layer, trails_json);
    if (mainLayer) {
        map.fitBounds(mainLayer.getBounds());
        selected = mainLayer;
        if (previous) {
            dehighlight(previous);
        }
        legacySyncTerrain3DTrail();
        // do not syncBounds here — avoids yanking the 3D camera while exploring
    }
}

function legacyLinkTrailLayers(clickLayer, trailsLayer) {
	var clickByName = {};
	clickLayer.eachLayer(function (layer) {
		clickByName[layer.feature.properties.name] = layer;
	});
	trailsLayer.eachLayer(function (layer) {
		var clickLyr = clickByName[layer.feature.properties.name];
		if (clickLyr) {
			layer._clickLayer = clickLyr;
		}
	});
}

function legacyFocusTrailByName(trailName) {
	if (!trails_json || !trailName) return;
	trails_json.eachLayer(function (layer) {
		if (layer.feature.properties.name !== trailName) return;
		map.fitBounds(layer.getBounds());
		var clickLayer = layer._clickLayer;
		if (clickLayer) {
			var center = layer.getBounds().getCenter();
			clickLayer.fire('click', {
				latlng: center,
				layer: clickLayer,
				target: clickLayer
			});
		}
	});
}

function doClickStuff(e) {
    lyr = e.target;
    ftr = e.target.feature;

    legacyDismissChromeOnUserAction();
    
    var mainLayer = findMatchingLayer(lyr, trails_json);
    if (mainLayer) {
        select(lyr);
        mainLayer.setText('- - - ►             ', { repeat: true, offset: 11, attributes: {fill:  '#FF5F1F', 'font-weight': 'bold', 'font-size': '12'} });
        
        /*** Elevation Control ***/
        if (typeof el !== 'undefined') {
            el.clear();
            map.removeControl(el);
        };	
        
        L.DomEvent.stopPropagation(e);
        el.addData(ftr, mainLayer);
        map.addControl(el);
        legacyMountElevationFrame(el);
        
        /*** make all non-selected trails opaque, after resetting styles (ftr selected before)***/ 
        trails_json.eachLayer(function(layer){ 
            if (layer._legacyFilterVisible === false) {
                layer.setStyle({ opacity: 0, fillOpacity: 0 });
                if (layer._path) layer._path.style.pointerEvents = 'none';
                return;
            }
            if(selected && selected.feature.properties.name !== layer.feature.properties.name) {
                dehighlight(layer);
                layer.setStyle({opacity: 0.4})
            }
        });

        // Open popup at click location
        var popup = mainLayer.getPopup();
        if (popup) {
            popup.setLatLng(e.latlng);
            popup.openOn(map);
        }
    }
}

/* Start/End pts in different pane ontop of trails */ 

map.createPane('ptsPane');
map.getPane('ptsPane').style.zIndex = 600;


/*** Session welcome overlay ***/
// Dismiss hides panel until next full page load (F5 / reopen URL). Old builds used sessionStorage key legacy_trails_welcome_dismissed.

var LEGACY_WELCOME_DISMISS_MODE = 'per_load';
var _legacyWelcomeDismissed = false;

function legacyWhenDomReady(callback) {
	if (document.documentElement.classList.contains('dom-ready')) {
		callback();
		return;
	}
	var observer = new MutationObserver(function () {
		if (document.documentElement.classList.contains('dom-ready')) {
			observer.disconnect();
			callback();
		}
	});
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function legacySetKofiFloatingVisible(visible) {
	document.documentElement.classList.toggle('legacy-welcome-open', !visible);
}

function legacySetHeaderVisible(visible) {
	document.documentElement.classList.toggle('legacy-header-visible', visible);
}

function legacyMountElevationFrame(elevationControl) {
	var container = elevationControl && elevationControl.getContainer && elevationControl.getContainer();
	if (!container || container._legacyElevationFrameBound) {
		return;
	}
	container._legacyElevationFrameBound = true;
	container.classList.add('legacy-panel-frame', 'legacy-elevation-frame');

	var svg = container.querySelector('svg.background');
	if (!svg) {
		return;
	}
	if (svg.parentElement && svg.parentElement.classList.contains('legacy-elevation-inner')) {
		return;
	}

	var wrap = document.createElement('div');
	wrap.className = 'legacy-panel-inner legacy-elevation-inner';
	svg.parentNode.insertBefore(wrap, svg);
	wrap.appendChild(svg);
}

function legacyStopClickPropagation(el) {
	if (!el || el._legacyClickStopBound) {
		return;
	}
	el._legacyClickStopBound = true;
	L.DomEvent.on(el, 'click dblclick mousedown touchstart', L.DomEvent.stopPropagation);
}

function legacyBindPanelClickIsolation() {
	legacyStopClickPropagation(document.getElementById('trails-welcome-overlay'));
	legacyStopClickPropagation(document.querySelector('.info-wrapper'));
	legacyStopClickPropagation(document.querySelector('header'));
}

function legacyCloseAllPanelsAndShowHeader() {
	legacySetHeaderVisible(true);
	map.closePopup();
	var infoToggle = document.getElementById('info-toggle');
	if (infoToggle) {
		infoToggle.checked = false;
	}
	var welcomeOverlay = document.getElementById('trails-welcome-overlay');
	if (welcomeOverlay && !welcomeOverlay.classList.contains('is-hidden')) {
		legacyDismissWelcomePanel(welcomeOverlay);
	}
	if (typeof el !== 'undefined') {
		el.clear();
		map.removeControl(el);
	}
	map.invalidateSize();
}

function legacyShowWelcomePanel() {
	var overlay = document.getElementById('trails-welcome-overlay');
	if (!overlay) return;
	_legacyWelcomeDismissed = false;
	overlay.removeAttribute('hidden');
	overlay.setAttribute('aria-hidden', 'false');
	overlay.classList.remove('is-hidden');
	legacySetKofiFloatingVisible(false);
	legacySetHeaderVisible(true);
}

function legacyShowWelcomeAndHeader() {
	map.closePopup();
	var infoToggle = document.getElementById('info-toggle');
	if (infoToggle) {
		infoToggle.checked = false;
	}
	if (typeof el !== 'undefined') {
		el.clear();
		map.removeControl(el);
	}
	if (window.LegacyTerrain3D) {
		if (window.LegacyTerrain3D._popup) {
			window.LegacyTerrain3D._popup.remove();
			window.LegacyTerrain3D._popup = null;
		}
		window.LegacyTerrain3D._clearFlash && window.LegacyTerrain3D._clearFlash();
	}
	legacyShowWelcomePanel();
}

function legacyDismissChromeOnUserAction() {
	legacySetHeaderVisible(false);
	var welcomeOverlay = document.getElementById('trails-welcome-overlay');
	if (welcomeOverlay && !welcomeOverlay.classList.contains('is-hidden')) {
		legacyDismissWelcomePanel(welcomeOverlay);
	}
}

function legacyBindHeaderHideOnMapUse() {
	if (map._legacyHeaderHideBound) {
		return;
	}
	map._legacyHeaderHideBound = true;
	map.on('dragstart', legacyDismissChromeOnUserAction);
	map.on('zoomstart', function (e) {
		if (e.originalEvent) {
			legacyDismissChromeOnUserAction();
		}
	});
	map.on('click', legacyDismissChromeOnUserAction);

	var infoToggle = document.getElementById('info-toggle');
	if (infoToggle && !infoToggle._legacyDismissChromeBound) {
		infoToggle._legacyDismissChromeBound = true;
		infoToggle.addEventListener('change', legacyDismissChromeOnUserAction);
	}
}

function legacyMountPopupCloseInFrame(popup) {
	var el = popup && popup.getElement();
	if (!el || !el.classList.contains('trailPopupClass')) {
		return;
	}
	legacyStopClickPropagation(el);
	var wrapper = el.querySelector('.leaflet-popup-content-wrapper');
	var closeBtn = el.querySelector('.leaflet-popup-close-button');
	if (!wrapper || !closeBtn) {
		return;
	}
	closeBtn.classList.add('legacy-panel-close');
	if (!closeBtn.querySelector('span')) {
		var mark = document.createElement('span');
		mark.textContent = (closeBtn.textContent || '').trim() || '\u00d7';
		closeBtn.textContent = '';
		closeBtn.appendChild(mark);
	}
	if (closeBtn.parentElement !== wrapper) {
		wrapper.insertBefore(closeBtn, wrapper.firstChild);
	}
}

function legacyEnsureGpxDownloadUrl(popup) {
	var el = popup && popup.getElement();
	if (!el || !el.classList.contains('trailPopupClass')) {
		return;
	}
	var gpxLink = el.querySelector('.gpx-download-link');
	var feature = popup._source && popup._source.feature;
	if (!gpxLink || !feature) {
		return;
	}
	if (gpxLink._legacyGpxObjectUrl) {
		URL.revokeObjectURL(gpxLink._legacyGpxObjectUrl);
	}
	var bb = new Blob([togpx(feature)], { type: 'application/gpx+xml' });
	gpxLink._legacyGpxObjectUrl = URL.createObjectURL(bb);
	gpxLink.href = gpxLink._legacyGpxObjectUrl;
}

function legacyRevokeGpxDownloadUrl(popup) {
	var el = popup && popup.getElement();
	if (!el) {
		return;
	}
	var gpxLink = el.querySelector('.gpx-download-link');
	if (!gpxLink || !gpxLink._legacyGpxObjectUrl) {
		return;
	}
	URL.revokeObjectURL(gpxLink._legacyGpxObjectUrl);
	gpxLink._legacyGpxObjectUrl = null;
	gpxLink.removeAttribute('href');
}

function legacyBindGpxKofiReminder(popup) {
	var el = popup && popup.getElement();
	if (!el || !el.classList.contains('trailPopupClass')) {
		return;
	}
	var gpxLink = el.querySelector('.gpx-download-link');
	var kofiReminder = el.querySelector('.kofi_reminder');
	if (!gpxLink || !kofiReminder || gpxLink._legacyKofiReminderBound) {
		return;
	}
	gpxLink._legacyKofiReminderBound = true;
	gpxLink.addEventListener('click', function () {
		kofiReminder.style.visibility = 'visible';
		kofiReminder.style.opacity = '1';
	});
}

function legacyDismissWelcomePanel(overlay) {
	if (!overlay) return;
	_legacyWelcomeDismissed = true;
	overlay.classList.add('is-hidden');
	overlay.setAttribute('aria-hidden', 'true');
	overlay.setAttribute('hidden', '');
	legacySetKofiFloatingVisible(true);
}

function legacyInitWelcomePanel(visibleFeatures) {
	if (_legacyWelcomeDismissed) return;

	var overlay = document.getElementById('trails-welcome-overlay');
	if (!overlay) return;

	var countEl = overlay.querySelector('.trails-welcome-count');
	var listEl = overlay.querySelector('.trails-welcome-list');
	if (!countEl || !listEl) return;

	var count = visibleFeatures.length;
	countEl.textContent = '..mit ' + count + (count === 1 ? ' Trail in der Karte!' : ' Trails in der Karte!');

	var newest = visibleFeatures.slice().sort(function (a, b) {
		return (b.properties.ID || 0) - (a.properties.ID || 0);
	}).slice(0, 3);

	listEl.textContent = '';
	newest.forEach(function (feature) {
		var props = feature.properties || {};
		var trailName = props.name || ('Trail ' + props.ID);
		var li = document.createElement('li');
		li.className = 'trails-welcome-item';
		li.setAttribute('data-trail-name', trailName);
		li.setAttribute('role', 'button');
		li.tabIndex = 0;
		var tapSpan = document.createElement('span');
		tapSpan.className = 'trails-welcome-tap';
		tapSpan.setAttribute('aria-hidden', 'true');
		tapSpan.textContent = '👉';
		var nameSpan = document.createElement('span');
		nameSpan.className = 'trails-welcome-name';
		nameSpan.textContent = trailName;
		li.appendChild(tapSpan);
		li.appendChild(nameSpan);
		li.addEventListener('click', function () {
			legacyFocusTrailByName(trailName);
			legacyDismissWelcomePanel(overlay);
		});
		li.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				legacyFocusTrailByName(trailName);
				legacyDismissWelcomePanel(overlay);
			}
		});
		listEl.appendChild(li);
	});

	var closeBtn = overlay.querySelector('.legacy-panel-close');
	if (closeBtn && !closeBtn._legacyWelcomeBound) {
		closeBtn._legacyWelcomeBound = true;
		closeBtn.addEventListener('click', function () {
			legacyDismissWelcomePanel(overlay);
		});
	}

	legacyWhenDomReady(function () {
		overlay.removeAttribute('hidden');
		overlay.setAttribute('aria-hidden', 'false');
		overlay.classList.remove('is-hidden');
		legacySetKofiFloatingVisible(false);
		legacySetHeaderVisible(true);
	});
}

/*** Add Trails ***/

$.getJSON('data/my_trails_z.geojson', function(json) {
	// Filter out trails where HIDE = 1
	json.features = json.features.filter(feature => feature.properties.HIDE !== 1);
	legacyCleanTrailFeatureNames(json.features);

	if (window.LegacyTrailFilters) {
		LegacyTrailFilters.indexFeatures(json.features);
	}
	
	// Create click layer first (will be underneath)
	trails_click_layer = L.geoJson(json, {
		style: styleClickLayer,
		interactive: true,
	}).addTo(map);
	
	// Create main layer on top
	trails_json = L.geoJson(json, {
		style: styleLines,
		interactive: false, // disable interaction on main layer
	}).addTo(map);
	
	// Add event handlers to click layer
	trails_click_layer.eachLayer(function(layer) {
		layer.on({
			'mouseover': function (e) {
				if (e.target._legacyFilterVisible === false) return;
				if (selected === null || (selected && selected.feature.properties.name !== e.target.feature.properties.name)) {
					highlight(e.target);
				}
			},
			'mouseout': function (e) {
				if (e.target._legacyFilterVisible === false) return;
				if (selected === null || (selected && selected.feature.properties.name !== e.target.feature.properties.name)) {
					dehighlight(e.target);
				}
			},
			'click': function (e) {
				if (e.target._legacyFilterVisible === false) return;
				doClickStuff(e);
			}
		});
	});

	legacyLinkTrailLayers(trails_click_layer, trails_json);
	
	// Add start/end markers and popups to main layer
	trails_json.eachLayer(function(layer) {
		var feature = layer.feature;
		
		if(feature.geometry.coordinates.length > 0) {
			var stPt = [feature.geometry.coordinates[0][1], 
						feature.geometry.coordinates[0][0]]; 
			var endPt = [feature.geometry.coordinates[feature.geometry.coordinates.length - 1][1],
						feature.geometry.coordinates[feature.geometry.coordinates.length - 1][0]];
			
			// Add Start and End Markers
			layer._startMarker = new L.circleMarker(stPt, {
				color: 'darkslategrey',
				fillColor: 'lightgreen',	
				fillOpacity: 1,				
				radius: 3.5,
				weight:1.5,
				pane: 'ptsPane'
			})
			.bindTooltip('<div class="legacy-panel-inner"><strong>Start:</strong> ' + feature.properties.name + '<br><strong>Seehöhe:</strong> ' + Math.round(feature.geometry.coordinates[0][2]) + ' m</div>', {
				permanent: false, 
				direction: 'right',
				className: "pt_labels"
			})
			.addTo(map);
			
			layer._endMarker = new L.circleMarker(endPt, {
				color: 'darkslategrey',
				fillColor: 'pink',
				fillOpacity: 1,
				radius: 3.5,
				weight:1.5,	
				pane: 'ptsPane'
			})	
			.bindTooltip('<div class="legacy-panel-inner"><strong>Ende:</strong> ' + feature.properties.name + '<br><strong>Seehöhe:</strong> ' + Math.round(feature.geometry.coordinates[feature.geometry.coordinates.length - 1][2]) + ' m</div>', {
				permanent: false, 
				direction: 'right',
				className: "pt_labels"
			})
			.addTo(map);
		}
		
		// GPX blob URL is created lazily on popupopen (see legacyEnsureGpxDownloadUrl)
		var gpxLink = document.createElement("a");
		gpxLink.className = "legacy-action-btn gpx-download-link";
		gpxLink.download = feature.properties.name + ".gpx";
		gpxLink.textContent = "GPX-Download";
		
		var popupContent = 
			'<p><div class="pop_cont_name">' + feature.properties.name + '</div></p>' +
			'<div class="pop_cont_text">' + feature.properties.Trail_Text + '</div>' +
			gpxLink.outerHTML +
			'<div class="kofi_reminder">' +
				'<p>👾 Dein GPX-Track wird heruntergeladen..</p>' +
				'<div class="legacy-panel-rule" aria-hidden="true"></div>' +
				'<a class="legacy-action-btn" href="https://ko-fi.com/C1C74GQ0I" target="_blank" rel="noopener noreferrer">💓 SUPPORT 👋</a>' +
				'<div class="legacy-panel-rule" aria-hidden="true"></div>' +
				'<p>🤝 Auch Mit einem kleinen Beitrag hilfst Du 💓 das Projekt am Leben zu halten!..</p>' +
			'</div>';
		layer.bindPopup(popupContent, { closeOnClick: true, className: 'trailPopupClass', maxWidth: 232 });
	});

	legacyInitWelcomePanel(json.features);
	
	var urlView = legacyParseUrlMapView();
	/* Valid ?lat=&lng=&z= (or zoom/lon) wins; else trails bounds center @ LEGACY_DEFAULT_START_ZOOM */
	var startView = urlView || legacyDefaultStartViewFromTrails();
	if (startView) {
		legacyApplyParsedView(startView, { animate: false });
	}	updateTrailsInView();
	if (urlView) {
		window.dispatchEvent(new CustomEvent('legacytrails:urlview', { detail: urlView }));
	}
	window.dispatchEvent(new Event('legacytrails:mapready'));

	if (window.LegacyTerrain3D) {
		window.LegacyTerrain3D.prefetchTrails();
		var warm3d = function () {
			window.LegacyTerrain3D.preload();
		};
		if (window.requestIdleCallback) {
			requestIdleCallback(warm3d, { timeout: 2500 });
		} else {
			setTimeout(warm3d, 1200);
		}
	}
}).fail(function () {
	window.dispatchEvent(new Event('legacytrails:mapready'));
});


/*
Points of interest


jQuery.get('POIs.geojson', function(data) {

var POIs = data;

var POIs_Icon = L.icon({
	iconUrl: 'images/pin.png',
	iconSize: [22,22], // size of the icon
    iconAnchor: [11,22],
	popupAnchor: [0,-24]
	});

for (i = 0; i < POIs.features.length; i++) { 
	new L.marker(L.GeoJSON.coordsToLatLng(POIs.features[i].geometry.coordinates), {
				icon: POIs_Icon,
				zIndexOffset: 10000,
				riseOnHover: true,
				pane: 'ptsPane'})
			.bindPopup('<div id="pop_cont_name">' + POIs.features[i].properties.name + '</div><div id="pop_cont_descr">' + POIs.features[i].properties.description + '</div>', 
				{
					closeButton: true,
					autoClose: false,
					direction: 'right'
				}
			)
			.addTo(map);
	}
});

*/

/*** Map Event Listeners ***/

map.on("click", function(e){
	/*** Remove Elevation Profile when map is clicked ***/
	if (typeof el !== 'undefined') {
		el.clear();
		map.removeControl(el);
	}
	if (!trails_json) return;
	/*** reset selection + restore filter-aware trail styles ***/
	if (selected !== null) {
		selected.setText(null);
		selected = null;
	}
	legacySyncTerrain3DTrail();
	legacyApplyTrailFilters();
	/*** make info panel disappear ***/
	document.getElementById('info-toggle').checked = false;
	map.invalidateSize();
});