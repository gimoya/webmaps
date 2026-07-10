import * as turf from '@turf/turf';

const MAX_DIST_M = 50;

export function buildTrailIndex(trailsGeoJson) {
	return trailsGeoJson.features.map((feature) => {
		const coords = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]);
		return {
			id: feature.properties.ID,
			name: feature.properties.name,
			line: turf.lineString(coords),
		};
	});
}

export function assignPhotoToTrail(photoPoint, trailIndex) {
	let best = null;

	for (const trail of trailIndex) {
		const distM = turf.pointToLineDistance(photoPoint, trail.line, { units: 'meters' });
		if (distM > MAX_DIST_M) {
			continue;
		}
		if (!best || distM < best.distToTrailM) {
			const snapped = turf.nearestPointOnLine(trail.line, photoPoint);
			const slice = turf.lineSlice(turf.point(trail.line.geometry.coordinates[0]), snapped, trail.line);
			best = {
				trailId: trail.id,
				trailName: trail.name,
				distToTrailM: Number(distM.toFixed(1)),
				distanceAlongM: Math.round(turf.length(slice, { units: 'meters' })),
			};
		}
	}

	return best;
}
