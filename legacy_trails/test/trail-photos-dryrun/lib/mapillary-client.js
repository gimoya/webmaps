const FIELDS = 'id,geometry,thumb_256_url,captured_at,compass_angle';

export async function fetchMapillaryTile(bboxStr, accessToken) {
	const url = new URL('https://graph.mapillary.com/images');
	url.searchParams.set('access_token', accessToken);
	url.searchParams.set('bbox', bboxStr);
	url.searchParams.set('fields', FIELDS);
	url.searchParams.set('limit', '2000');

	const res = await fetch(url);
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
				thumbUrl: img.thumb_256_url || '',
				pageUrl: `https://www.mapillary.com/app/?pKey=${img.id}`,
				capturedAt: img.captured_at || null,
			},
		}));
}
