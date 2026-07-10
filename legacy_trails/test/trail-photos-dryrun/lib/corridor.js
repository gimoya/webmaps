import * as turf from '@turf/turf';

const BUFFER_KM = 0.05;
const TILE_DEG = 0.008;
const MAX_TILE_AREA_DEG2 = 0.01;

export function buildTrailCorridor(trailsGeoJson) {
	const buffers = trailsGeoJson.features.map((feature) => {
		const line = turf.lineString(feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]));
		return turf.buffer(line, BUFFER_KM, { units: 'kilometers' });
	});

	let corridor = buffers[0];
	for (let i = 1; i < buffers.length; i++) {
		corridor = turf.union(turf.featureCollection([corridor, buffers[i]]));
	}

	return turf.truncate(corridor, { precision: 6 });
}

export function tilesForCorridor(corridor) {
	const [minLon, minLat, maxLon, maxLat] = turf.bbox(corridor);
	const tiles = [];

	for (let lon = minLon; lon < maxLon; lon += TILE_DEG) {
		for (let lat = minLat; lat < maxLat; lat += TILE_DEG) {
			const cell = turf.bboxPolygon([
				lon,
				lat,
				Math.min(lon + TILE_DEG, maxLon),
				Math.min(lat + TILE_DEG, maxLat),
			]);
			const width = cell.bbox[2] - cell.bbox[0];
			const height = cell.bbox[3] - cell.bbox[1];
			if (width * height > MAX_TILE_AREA_DEG2) {
				continue;
			}
			if (turf.booleanIntersects(cell, corridor)) {
				tiles.push({
					id: `${lon.toFixed(3)}_${lat.toFixed(3)}`,
					bbox: cell.bbox,
					bboxStr: cell.bbox.join(','),
					areaDeg2: Number((width * height).toFixed(6)),
				});
			}
		}
	}

	return tiles;
}

export function pointInCorridor(point, corridor) {
	return turf.booleanPointInPolygon(point, corridor);
}
