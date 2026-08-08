/**
 * Trail_Char rating index + filter helpers for Legacy Trails.
 * Classic script: window.LegacyTrailFilters
 */
(function (global) {
	'use strict';

	var FILTER_KEYS = {
		flow: 'F',
		killer: 'K',
		tech: 'T',
		features: 'G',
		exposure: 'R',
		status: 'X'
	};

	var ratingsById = Object.create(null);
	var indexedCount = 0;

	function parseTrailChar(trailChar) {
		var s = String(trailChar == null ? '' : trailChar).trim();
		if (!s || s === '?') return null;
		var out = {};
		var i = 0;
		while (i < s.length) {
			var ch = s.charAt(i);
			if (!/[A-Za-z]/.test(ch)) {
				i++;
				continue;
			}
			var up = ch.toUpperCase();
			var j = i + 1;
			while (j < s.length && s.charAt(j).toUpperCase() === up) {
				j++;
			}
			out[up] = Math.max(out[up] || 0, Math.min(3, j - i));
			i = j;
		}
		return out;
	}

	function indexFeatures(features) {
		ratingsById = Object.create(null);
		indexedCount = 0;
		if (!features || !features.length) return ratingsById;
		for (var i = 0; i < features.length; i++) {
			var feature = features[i];
			var props = feature.properties || {};
			var ratings = parseTrailChar(props.Trail_Char);
			props._charRatings = ratings;
			if (props.ID != null) {
				ratingsById[String(props.ID)] = ratings;
			}
			indexedCount++;
		}
		return ratingsById;
	}

	function getRatings(featureOrId) {
		if (featureOrId == null) return null;
		if (typeof featureOrId === 'object') {
			var props = featureOrId.properties || featureOrId;
			if (props._charRatings !== undefined) return props._charRatings;
			if (props.ID != null && Object.prototype.hasOwnProperty.call(ratingsById, String(props.ID))) {
				return ratingsById[String(props.ID)];
			}
			return parseTrailChar(props.Trail_Char);
		}
		return Object.prototype.hasOwnProperty.call(ratingsById, String(featureOrId))
			? ratingsById[String(featureOrId)]
			: null;
	}

	function createState() {
		return {
			flow: 0,
			killer: 0,
			tech: 0,
			features: 0,
			exposure: 0,
			status: 0
		};
	}

	function isActive(state) {
		if (!state) return false;
		return state.flow > 0 || state.killer > 0 || state.tech > 0 || state.features > 0 || state.exposure > 0 || state.status > 0;
	}

	function matches(ratings, state) {
		if (!isActive(state)) return true;
		if (ratings == null) return false;
		for (var key in FILTER_KEYS) {
			if (!Object.prototype.hasOwnProperty.call(FILTER_KEYS, key)) continue;
			var want = state[key] || 0;
			if (want <= 0) continue;
			var level = ratings[FILTER_KEYS[key]] || 0;
			if (level !== want) return false;
		}
		return true;
	}

	function matchesFeature(feature, state) {
		return matches(getRatings(feature), state);
	}

	function countMatching(state) {
		var n = 0;
		var ids = Object.keys(ratingsById);
		for (var i = 0; i < ids.length; i++) {
			if (matches(ratingsById[ids[i]], state)) n++;
		}
		return n;
	}

	function applyToLayerGroup(layerGroup, state, options) {
		if (!layerGroup) return 0;
		options = options || {};
		var visibleStyle = options.visibleStyle;
		var hiddenStyle = options.hiddenStyle || { opacity: 0, fillOpacity: 0 };
		var shown = 0;
		layerGroup.eachLayer(function (layer) {
			var feature = layer.feature;
			var ok = !feature || matchesFeature(feature, state);
			layer._legacyFilterVisible = ok;
			if (ok) {
				shown++;
				if (typeof visibleStyle === 'function') {
					layer.setStyle(visibleStyle(feature));
				} else if (visibleStyle) {
					layer.setStyle(visibleStyle);
				}
				if (layer._path) {
					layer._path.style.pointerEvents = '';
				}
			} else {
				layer.setStyle(hiddenStyle);
				if (layer._path) {
					layer._path.style.pointerEvents = 'none';
				}
			}
		});
		return shown;
	}

	global.LegacyTrailFilters = {
		FILTER_KEYS: FILTER_KEYS,
		parseTrailChar: parseTrailChar,
		indexFeatures: indexFeatures,
		getRatings: getRatings,
		createState: createState,
		isActive: isActive,
		matches: matches,
		matchesFeature: matchesFeature,
		countMatching: countMatching,
		applyToLayerGroup: applyToLayerGroup,
		getIndexedCount: function () {
			return indexedCount;
		}
	};
})(typeof window !== 'undefined' ? window : this);
