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

	/** Flag filters (not Trail_Char letters). landschaft: 1 = has 💎 (Holy) */
	var FLAG_FILTER_KEYS = {
		landschaft: true
	};

	var ratingsById = Object.create(null);
	var landschaftById = Object.create(null);
	var indexedCount = 0;

	function featureHasLandschaft(props) {
		var h = props && props.Holy;
		return h === '💎' || h === 1 || h === '1' || h === true;
	}

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
		landschaftById = Object.create(null);
		indexedCount = 0;
		if (!features || !features.length) return ratingsById;
		for (var i = 0; i < features.length; i++) {
			var feature = features[i];
			var props = feature.properties || {};
			var ratings = parseTrailChar(props.Trail_Char);
			var hasLand = featureHasLandschaft(props);
			props._charRatings = ratings;
			props._hasLandschaft = hasLand;
			if (props.ID != null) {
				var id = String(props.ID);
				ratingsById[id] = ratings;
				landschaftById[id] = hasLand;
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
			status: 0,
			landschaft: 0
		};
	}

	function isCharFilterActive(state) {
		if (!state) return false;
		return state.flow > 0 || state.killer > 0 || state.tech > 0 || state.features > 0 || state.exposure > 0 || state.status > 0;
	}

	function isActive(state) {
		if (!state) return false;
		return isCharFilterActive(state) || (state.landschaft > 0);
	}

	function matchesLandschaft(hasLand, state) {
		var want = state && state.landschaft ? state.landschaft : 0;
		if (want <= 0) return true;
		if (want === 1) return !!hasLand;
		if (want === 2) return !hasLand;
		return true;
	}

	function matches(ratings, state) {
		if (!isCharFilterActive(state)) return true;
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
		var props = (feature && feature.properties) || {};
		var hasLand = props._hasLandschaft;
		if (hasLand === undefined) hasLand = featureHasLandschaft(props);
		if (!matchesLandschaft(hasLand, state)) return false;
		return matches(getRatings(feature), state);
	}

	function countMatching(state) {
		var n = 0;
		var ids = Object.keys(ratingsById);
		for (var i = 0; i < ids.length; i++) {
			var id = ids[i];
			if (!matchesLandschaft(!!landschaftById[id], state)) continue;
			if (matches(ratingsById[id], state)) n++;
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
		FLAG_FILTER_KEYS: FLAG_FILTER_KEYS,
		parseTrailChar: parseTrailChar,
		featureHasLandschaft: featureHasLandschaft,
		indexFeatures: indexFeatures,
		getRatings: getRatings,
		createState: createState,
		isActive: isActive,
		matches: matches,
		matchesLandschaft: matchesLandschaft,
		matchesFeature: matchesFeature,
		countMatching: countMatching,
		applyToLayerGroup: applyToLayerGroup,
		getIndexedCount: function () {
			return indexedCount;
		}
	};
})(typeof window !== 'undefined' ? window : this);
