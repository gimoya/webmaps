var LegacyTrailPhotos = (function () {
	'use strict';

	var _map = null;
	var _photoPane = null;
	var _layer = null;
	var _photosByTrailId = null;
	var _activeTrailId = null;
	var _photoAttributionAdded = false;

	var PANO_ZOOM = 1.5;
	var PANO_V_CROP = 0.15;
	var PANO_DRAG_THRESHOLD = 5;

	var photoIcon = L.divIcon({
		className: 'legacy-trail-photos-marker',
		html: '<span aria-hidden="true">📷</span>',
		iconSize: [22, 22],
		iconAnchor: [11, 11],
		popupAnchor: [0, -12],
	});

	function measurePanoLayout(img, crop) {
		var cw = crop.clientWidth;
		var ch = crop.clientHeight;
		var iw = img.naturalWidth;
		var ih = img.naturalHeight;
		if (!cw || !ch || !iw || !ih) {
			return null;
		}
		var visibleVFraction = 1 - 2 * PANO_V_CROP;
		var displayHeight = ch / visibleVFraction;
		var displayWidth = displayHeight * (iw / ih) * PANO_ZOOM;
		var overflow = Math.max(0, displayWidth - cw);
		return {
			cw: cw,
			ch: ch,
			displayWidth: displayWidth,
			displayHeight: displayHeight,
			offsetTop: -PANO_V_CROP * displayHeight,
			overflow: overflow,
		};
	}

	function applyPanoLayout(img, crop, layout) {
		img.style.width = layout.displayWidth.toFixed(2) + 'px';
		img.style.height = layout.displayHeight.toFixed(2) + 'px';
		img.style.top = layout.offsetTop.toFixed(2) + 'px';
		crop._panoLayout = layout;
	}

	function parseTranslateX(img) {
		var match = (img.style.transform || '').match(/translateX\(([-\d.]+)px\)/);
		return match ? parseFloat(match[1]) : 0;
	}

	function clampTranslateX(x, layout) {
		if (!layout || layout.overflow <= 0) {
			return layout ? (layout.cw - layout.displayWidth) / 2 : 0;
		}
		return Math.min(0, Math.max(-layout.overflow, x));
	}

	function compassToTranslateX(layout, compassAngle) {
		if (!layout) {
			return 0;
		}
		if (layout.overflow <= 0) {
			return (layout.cw - layout.displayWidth) / 2;
		}
		var angle = Number(compassAngle);
		if (isNaN(angle)) {
			return -layout.overflow / 2;
		}
		angle = ((angle % 360) + 360) % 360;
		var centerX = (angle / 360) * layout.displayWidth;
		var left = centerX - layout.cw / 2;
		left = Math.max(0, Math.min(layout.overflow, left));
		return -left;
	}

	function setPanoTranslateX(img, crop, x) {
		var layout = crop._panoLayout;
		if (!layout) {
			return;
		}
		img.style.transform = 'translateX(' + clampTranslateX(x, layout).toFixed(2) + 'px)';
	}

	function applyInitialPanoView(img, crop) {
		if (!crop.clientWidth || !img.naturalWidth) {
			requestAnimationFrame(function () {
				applyInitialPanoView(img, crop);
			});
			return;
		}
		var layout = measurePanoLayout(img, crop);
		if (!layout) {
			return;
		}
		applyPanoLayout(img, crop, layout);
		setPanoTranslateX(img, crop, compassToTranslateX(layout, img.getAttribute('data-compass-angle')));
	}

	function stopMapPropagation(el) {
		if (!el || el._legacyPhotoClickStopBound) {
			return;
		}
		el._legacyPhotoClickStopBound = true;
		L.DomEvent.on(el, 'click dblclick mousedown touchstart', function (e) {
			if (e.target && e.target.closest && e.target.closest('.legacy-trail-photos-crop--pano')) {
				L.DomEvent.stopPropagation(e);
				return;
			}
			if (e.target && e.target.closest && e.target.closest('.legacy-trail-photos-media')) {
				return;
			}
			L.DomEvent.stopPropagation(e);
		});
	}

	function formatCapturedDate(capturedAt) {
		if (capturedAt == null || capturedAt === '') {
			return '';
		}
		var ms = Number(capturedAt);
		var d = !isNaN(ms) ? new Date(ms < 1e12 ? ms * 1000 : ms) : new Date(capturedAt);
		if (isNaN(d.getTime())) {
			return '';
		}
		return d.toLocaleDateString('de-AT', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		});
	}

	function openPhotoPage(media) {
		var url = media.getAttribute('data-page-url');
		if (url) {
			window.open(url, '_blank', 'noopener,noreferrer');
		}
	}

	function escapeAttr(value) {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;');
	}
	function buildPopupHtml(props) {
		if (!props.thumbUrl) {
			return '';
		}
		var pageUrl = props.pageUrl || '';
		var sourceLabel = props.source === 'panoramax' ? 'Panoramax' : 'Mapillary';
		var isPano = Boolean(props.isPano);
		var date = formatCapturedDate(props.capturedAt);
		var metaHtml = '';
		if (isPano || date) {
			var metaText = isPano ? '360°' : '';
			if (date) {
				metaText = metaText ? metaText + ' · ' + date : date;
			}
			metaHtml = '<span class="legacy-trail-photos-date">' + metaText + '</span>';
		}
		var imgClass = 'legacy-trail-photos-img' + (isPano ? ' legacy-trail-photos-img--pano' : '');
		var imgHtml = '<img class="' + imgClass + '" src="' + props.thumbUrl + '" alt="" loading="lazy" draggable="false"' +
			(isPano ? ' data-compass-angle="' + (props.compassAngle != null ? props.compassAngle : '') + '"' : '') + '>';
		var mediaInner = isPano
			? '<span class="legacy-trail-photos-crop legacy-trail-photos-crop--pano" aria-label="Pan left/right" title="Pan left/right">' + imgHtml + '</span>'
			: imgHtml;
		if (isPano) {
			return (
				'<div class="legacy-trail-photos-media legacy-trail-photos-media--pano" data-page-url="' + escapeAttr(pageUrl) + '" title="Auf ' + sourceLabel + ' öffnen">' +
				mediaInner +
				metaHtml +
				'</div>'
			);
		}
		return (
			'<a class="legacy-trail-photos-media" href="' + pageUrl + '" target="_blank" rel="noopener noreferrer" title="Auf ' + sourceLabel + ' öffnen">' +
			mediaInner +
			metaHtml +
			'</a>'
		);
	}

	function mountPanoPan(popup) {
		var el = popup && popup.getElement();
		if (!el) {
			return;
		}
		var panos = el.querySelectorAll('.legacy-trail-photos-media--pano');
		panos.forEach(function (media) {
			var crop = media.querySelector('.legacy-trail-photos-crop--pano');
			var img = crop && crop.querySelector('.legacy-trail-photos-img--pano');
			if (!crop || !img || crop._legacyPanoPanBound) {
				return;
			}
			crop._legacyPanoPanBound = true;

			img.addEventListener('load', function () {
				applyInitialPanoView(img, crop);
			});
			applyInitialPanoView(img, crop);

			var panning = false;
			var dragged = false;
			var startClientX = 0;
			var startTranslateX = 0;
			var activePointerId = null;

			function onPointerMove(e) {
				if (!panning || e.pointerId !== activePointerId) {
					return;
				}
				var layout = crop._panoLayout;
				if (!layout || layout.overflow <= 0) {
					return;
				}
				var dx = e.clientX - startClientX;
				if (!dragged && Math.abs(dx) > PANO_DRAG_THRESHOLD) {
					dragged = true;
				}
				if (!dragged) {
					return;
				}
				e.preventDefault();
				L.DomEvent.stopPropagation(e);
				setPanoTranslateX(img, crop, startTranslateX + dx);
			}

			function endPan(e) {
				if (!panning || (e.pointerId != null && e.pointerId !== activePointerId)) {
					return;
				}
				panning = false;
				activePointerId = null;
				crop.classList.remove('legacy-trail-photos-crop--panning');
				document.removeEventListener('pointermove', onPointerMove);
				document.removeEventListener('pointerup', endPan);
				document.removeEventListener('pointercancel', endPan);
				if (dragged) {
					e.preventDefault();
					L.DomEvent.stopPropagation(e);
				}
			}

			function onPointerDown(e) {
				if (e.button !== undefined && e.button !== 0) {
					return;
				}
				e.preventDefault();
				panning = true;
				dragged = false;
				activePointerId = e.pointerId;
				startClientX = e.clientX;
				startTranslateX = parseTranslateX(img);
				crop.classList.add('legacy-trail-photos-crop--panning');
				L.DomEvent.stopPropagation(e);
				if (crop.setPointerCapture) {
					crop.setPointerCapture(e.pointerId);
				}
				document.addEventListener('pointermove', onPointerMove, { passive: false });
				document.addEventListener('pointerup', endPan);
				document.addEventListener('pointercancel', endPan);
			}

			L.DomEvent.on(crop, 'pointerdown', onPointerDown);
			L.DomEvent.disableClickPropagation(crop);
			media.addEventListener('click', function (e) {
				if (dragged) {
					dragged = false;
					return;
				}
				openPhotoPage(media);
			});
		});
	}

	function mountPopupClose(popup) {
		var el = popup && popup.getElement();
		if (!el) {
			return;
		}
		stopMapPropagation(el);
		mountPanoPan(popup);
		var wrapper = el.querySelector('.leaflet-popup-content-wrapper');
		var closeBtn = el.querySelector('.leaflet-popup-close-button');
		if (!wrapper || !closeBtn) {
			return;
		}
		closeBtn.classList.add('legacy-panel-close');
		if (closeBtn.parentElement !== wrapper) {
			wrapper.insertBefore(closeBtn, wrapper.firstChild);
		}
	}

	function photoTooltipLabel(props) {
		var source = props && props.source === 'panoramax' ? 'Panoramax' : 'Mapillary';
		return '📷' + source;
	}

	function bindPhotoMarker(feature) {
		var latlng = L.latLng(
			feature.geometry.coordinates[1],
			feature.geometry.coordinates[0],
		);
		var marker = L.marker(latlng, { icon: photoIcon, riseOnHover: true, pane: 'legacyTrailPhotosPane' });
		marker.bindTooltip(photoTooltipLabel(feature.properties), {
			direction: 'top',
			offset: [0, -12],
			className: 'legacy-trail-photos-tooltip',
		});
		marker.bindPopup(buildPopupHtml(feature.properties), {
			className: 'legacy-trail-photos-popup-wrap',
			maxWidth: 300,
			closeButton: true,
		});
		marker.on('popupopen', function () {
			mountPopupClose(marker.getPopup());
		});
		return marker;
	}

	function indexPhotos(geojson) {
		var byTrail = new Map();
		geojson.features.forEach(function (feature) {
			var trailId = feature.properties && feature.properties.trailId;
			if (trailId == null) {
				return;
			}
			var key = String(trailId);
			if (!byTrail.has(key)) {
				byTrail.set(key, []);
			}
			byTrail.get(key).push(feature);
		});
		return byTrail;
	}

	function clearTrailPhotos() {
		_activeTrailId = null;
		if (_layer) {
			_layer.clearLayers();
		}
	}

	function featureInBounds(feature, bounds) {
		if (!bounds || !feature.geometry || !feature.geometry.coordinates) {
			return true;
		}
		var lon = feature.geometry.coordinates[0];
		var lat = feature.geometry.coordinates[1];
		return bounds.contains([lat, lon]);
	}

	function showTrailPhotos(trailId, bounds) {
		if (!_layer || !_photosByTrailId) {
			return;
		}
		var key = String(trailId);
		_activeTrailId = key;
		_layer.clearLayers();

		var features = _photosByTrailId.get(key);
		if (!features || features.length === 0) {
			return;
		}

		features.forEach(function (feature) {
			if (!featureInBounds(feature, bounds)) {
				return;
			}
			_layer.addLayer(bindPhotoMarker(feature));
		});
	}

	function onTrailClick(e) {
		var detail = e.detail || {};
		if (detail.trailId == null) {
			return;
		}
		showTrailPhotos(detail.trailId, detail.bounds);
	}

	function loadPhotoIndex(dataUrl) {
		$.getJSON(dataUrl, function (geojson) {
			if (!geojson.features || geojson.features.length === 0) {
				console.warn('LegacyTrailPhotos: no photo features in', dataUrl);
				return;
			}
			_photosByTrailId = indexPhotos(geojson);
		}).fail(function () {
			console.warn('LegacyTrailPhotos: could not load', dataUrl);
		});
	}

	function init(options) {
		if (_layer) {
			return;
		}
		_map = options.map;
		if (!_map) {
			return;
		}

		_photoPane = _map.createPane('legacyTrailPhotosPane');
		_photoPane.style.zIndex = 610;

		_layer = L.layerGroup([], { pane: 'legacyTrailPhotosPane' }).addTo(_map);

		if (!_photoAttributionAdded && _map.attributionControl) {
			_map.attributionControl.addAttribution(
				'<a href="https://mapillary.com">Mapillary</a> · <a href="https://panoramax.fr">Panoramax</a>',
			);
			_photoAttributionAdded = true;
		}

		loadPhotoIndex(options.dataUrl || 'data/trail_photos.geojson');

		window.addEventListener('legacytrails:trailclick', onTrailClick);
		_map.on('click', clearTrailPhotos);
	}

	function destroy() {
		window.removeEventListener('legacytrails:trailclick', onTrailClick);
		if (_map) {
			_map.off('click', clearTrailPhotos);
		}
		if (_layer) {
			_map.removeLayer(_layer);
			_layer = null;
		}
		_photosByTrailId = null;
		_activeTrailId = null;
	}

	return { init: init, destroy: destroy };
})();

window.addEventListener('legacytrails:mapready', function () {
	if (typeof map === 'undefined') {
		return;
	}
	LegacyTrailPhotos.init({ map: map });
});
