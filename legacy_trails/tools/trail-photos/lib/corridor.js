import * as turf from '@turf/turf';
import { BUFFER_KM, TILE_DEG, MAX_TILE_AREA_DEG2 } from './config.js';

export function buildTrailBuffers(trailsGeoJson) {
	return trailsGeoJson.features.map((feature) => {
		const line = turf.lineString(feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]));
		return turf.buffer(line, BUFFER_KM, { units: 'kilometers' });
	});
}

function tilesForPolygon(polygon) {
	const [minLon, minLat, maxLon, maxLat] = turf.bbox(polygon);
	const seen = new Set();
	const tiles = [];

	for (let lon = minLon; lon < maxLon; lon += TILE_DEG) {
		for (let lat = minLat; lat < maxLat; lat += TILE_DEG) {
			const maxLonCell = Math.min(lon + TILE_DEG, maxLon);
			const maxLatCell = Math.min(lat + TILE_DEG, maxLat);
			const width = maxLonCell - lon;
			const height = maxLatCell - lat;
			if (width * height > MAX_TILE_AREA_DEG2) {
				continue;
			}
			const id = `${lon.toFixed(3)}_${lat.toFixed(3)}`;
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			if (turf.booleanIntersects(turf.bboxPolygon([lon, lat, maxLonCell, maxLatCell]), polygon)) {
				tiles.push({
					id,
					bbox: [lon, lat, maxLonCell, maxLatCell],
					bboxStr: [lon, lat, maxLonCell, maxLatCell].join(','),
				});
			}
		}
	}

	return tiles;
}

export function tilesForBuffers(buffers) {
	const byId = new Map();
	for (const buffer of buffers) {
		for (const tile of tilesForPolygon(buffer)) {
			byId.set(tile.id, tile);
		}
	}
	return Array.from(byId.values());
}
