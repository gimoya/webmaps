/**
 * BRouter HTTP client — lonlats GET → [{lat,lng,ele?}].
 * Endpoint shape: GET {base}?lonlats=lon,lat|…&profile=mtb&format=geojson
 */
(function (global) {
	'use strict';

	function latOf(wp) {
		if (wp == null) return NaN;
		if (typeof wp.lat === 'number') return wp.lat;
		if (Array.isArray(wp)) return Number(wp[0]);
		return Number(wp.lat);
	}

	function lngOf(wp) {
		if (wp == null) return NaN;
		if (typeof wp.lng === 'number') return wp.lng;
		if (typeof wp.lon === 'number') return wp.lon;
		if (Array.isArray(wp)) return Number(wp[1]);
		return Number(wp.lng != null ? wp.lng : wp.lon);
	}

	function buildLonLats(waypoints) {
		var parts = [];
		for (var i = 0; i < waypoints.length; i++) {
			var lat = latOf(waypoints[i]);
			var lng = lngOf(waypoints[i]);
			if (!isFinite(lat) || !isFinite(lng)) {
				throw new Error('invalid waypoint');
			}
			parts.push(lng.toFixed(6) + ',' + lat.toFixed(6));
		}
		return parts.join('|');
	}

	function lineCoordsFromGeometry(geom) {
		if (!geom) return [];
		if (geom.type === 'LineString') return geom.coordinates || [];
		if (geom.type === 'MultiLineString') {
			var all = [];
			var lines = geom.coordinates || [];
			for (var i = 0; i < lines.length; i++) {
				for (var j = 0; j < lines[i].length; j++) all.push(lines[i][j]);
			}
			return all;
		}
		return [];
	}

	function coordsFromGeoJson(gj) {
		if (!gj) return [];
		if (gj.type === 'FeatureCollection') {
			var out = [];
			var feats = gj.features || [];
			for (var i = 0; i < feats.length; i++) {
				out = out.concat(lineCoordsFromGeometry(feats[i] && feats[i].geometry));
			}
			return out;
		}
		if (gj.type === 'Feature') return lineCoordsFromGeometry(gj.geometry);
		return lineCoordsFromGeometry(gj);
	}

	function parseGeoJsonToLatLngs(gj) {
		var coords = coordsFromGeoJson(gj);
		var latLngs = [];
		for (var i = 0; i < coords.length; i++) {
			var c = coords[i];
			if (!c || c.length < 2) continue;
			var pt = { lat: c[1], lng: c[0] };
			if (c.length > 2 && isFinite(c[2])) pt.ele = c[2];
			latLngs.push(pt);
		}
		return latLngs;
	}

	function buildRequestUrl(routeUrl, waypoints, profile) {
		var url = new URL(routeUrl, global.location && global.location.href);
		url.searchParams.set('lonlats', buildLonLats(waypoints));
		url.searchParams.set('profile', profile || 'mtb');
		url.searchParams.set('alternativeidx', '0');
		url.searchParams.set('format', 'geojson');
		return url.toString();
	}

	/**
	 * @param {string} routeUrl BRouter base URL (…/brouter)
	 * @param {Array} waypoints [{lat,lng}|L.LatLng,…]
	 * @param {string} [profile]
	 * @param {{signal?: AbortSignal}} [opts]
	 * @returns {Promise<Array<{lat:number,lng:number,ele?:number}>>}
	 */
	function route(routeUrl, waypoints, profile, opts) {
		opts = opts || {};
		if (!routeUrl) return Promise.reject(new Error('missing routeUrl'));
		if (!waypoints || waypoints.length < 2) {
			return Promise.reject(new Error('need ≥2 waypoints'));
		}

		var reqUrl = buildRequestUrl(routeUrl, waypoints, profile);
		return fetch(reqUrl, { signal: opts.signal, credentials: 'omit' }).then(function (res) {
			return res.text().then(function (text) {
				if (!res.ok) {
					throw new Error(text || ('BRouter HTTP ' + res.status));
				}
				var trimmed = (text || '').trim();
				if (!trimmed || trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') {
					throw new Error(trimmed || 'BRouter empty response');
				}
				var gj;
				try {
					gj = JSON.parse(trimmed);
				} catch (err) {
					throw new Error(trimmed.slice(0, 200) || 'BRouter invalid JSON');
				}
				var latLngs = parseGeoJsonToLatLngs(gj);
				if (latLngs.length < 2) throw new Error('BRouter returned no geometry');
				return latLngs;
			});
		});
	}

	global.BRouterClient = {
		route: route,
		buildLonLats: buildLonLats,
		buildRequestUrl: buildRequestUrl,
		parseGeoJsonToLatLngs: parseGeoJsonToLatLngs
	};
})(typeof window !== 'undefined' ? window : this);
