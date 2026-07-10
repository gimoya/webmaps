import * as turf from '@turf/turf';
import { TRAIL_BBOX_PAD_M } from './config.js';
import { padBboxMeters } from './grid.js';

export function buildTrailIndex(trailsGeoJson) {
	return trailsGeoJson.features.map((feature) => {
		const coords = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]);
		const line = turf.lineString(coords);
		const bbox = padBboxMeters(turf.bbox(line), TRAIL_BBOX_PAD_M);
		return {
			id: feature.properties.ID,
			name: feature.properties.name,
			line,
			bbox,
		};
	});
}

function pointInTrailBbox(photoPoint, trail) {
	const [lon, lat] = photoPoint.geometry.coordinates;
	const [minLon, minLat, maxLon, maxLat] = trail.bbox;
	return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/** Assign to nearest trail whose bbox contains the photo (no line-distance cutoff). */
export function assignPhotoToTrail(photoPoint, trailIndex) {
	let best = null;

	for (const trail of trailIndex) {
		if (!pointInTrailBbox(photoPoint, trail)) {
			continue;
		}
		const distM = turf.pointToLineDistance(photoPoint, trail.line, { units: 'meters' });
		if (!best || distM < best.distToTrailM) {
			best = {
				trailId: trail.id,
				trailName: trail.name,
				distToTrailM: Number(distM.toFixed(1)),
			};
		}
	}

	return best;
}
