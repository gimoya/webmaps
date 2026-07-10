import { MAPILLARY_FIELDS, MAPILLARY_LIMIT } from './config.js';

export async function fetchMapillaryTile(bboxStr, accessToken, timeoutMs = 90000) {
	const url = new URL('https://graph.mapillary.com/images');
	url.searchParams.set('access_token', accessToken);
	url.searchParams.set('bbox', bboxStr);
	url.searchParams.set('fields', MAPILLARY_FIELDS);
	url.searchParams.set('limit', String(MAPILLARY_LIMIT));

	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Mapillary ${res.status}: ${body.slice(0, 200)}`);
	}

	const json = await res.json();
	return json.data || [];
}

export function mapillaryToPhotoFeatures(images) {
	return images
		.filter((img) => img.geometry && img.geometry.coordinates)
		.map((img) => ({
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: img.geometry.coordinates,
			},
			properties: {
				source: 'mapillary',
				photoId: String(img.id),
				thumbUrl: img.thumb_1024_url || img.thumb_256_url || '',
				pageUrl: `https://www.mapillary.com/app/?pKey=${img.id}`,
				capturedAt: img.captured_at || null,
				isPano: Boolean(img.is_pano),
				compassAngle:
					img.computed_compass_angle != null
						? img.computed_compass_angle
						: img.compass_angle != null
							? img.compass_angle
							: null,
				attribution: 'Mapillary',
			},
		}));
}
