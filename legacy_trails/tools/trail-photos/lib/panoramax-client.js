import { PANORAMAX_INSTANCES, PANORAMAX_LIMIT } from './config.js';

export async function fetchPanoramaxTile(bboxStr, timeoutMs = 90000) {
	const allItems = [];

	for (const instance of PANORAMAX_INSTANCES) {
		const items = await fetchPanoramaxInstanceTile(instance.apiBase, bboxStr, timeoutMs);
		allItems.push(...items);
	}

	return allItems;
}

async function fetchPanoramaxInstanceTile(apiBase, bboxStr, timeoutMs) {
	const items = [];
	let url = new URL(`${apiBase}/api/search`);
	url.searchParams.set('bbox', bboxStr);
	url.searchParams.set('limit', String(PANORAMAX_LIMIT));

	while (url) {
		const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Panoramax ${res.status}: ${body.slice(0, 200)}`);
		}

		const json = await res.json();
		items.push(...(json.features || []));

		const next = (json.links || []).find((link) => link.rel === 'next');
		url = next?.href ? new URL(next.href) : null;
	}

	return items;
}

function instanceForItem(item) {
	const selfLink = (item.links || []).find((link) => link.rel === 'self')?.href || '';
	for (const instance of PANORAMAX_INSTANCES) {
		if (selfLink.startsWith(instance.apiBase)) {
			return instance;
		}
	}
	return PANORAMAX_INSTANCES[0];
}

export function panoramaxToPhotoFeatures(items) {
	return items
		.filter((item) => item.geometry && item.geometry.coordinates)
		.map((item) => {
			const props = item.properties || {};
			const instance = instanceForItem(item);
			const thumbUrl =
				item.assets?.thumb?.href || props['geovisio:thumbnail'] || '';
			const isPano = Boolean(item.assets?.tiles);

			return {
				type: 'Feature',
				geometry: {
					type: 'Point',
					coordinates: item.geometry.coordinates,
				},
				properties: {
					source: 'panoramax',
					photoId: String(item.id),
					thumbUrl,
					pageUrl: `${instance.webBase}/#focus=pic&pic=${item.id}`,
					capturedAt: props.datetime || null,
					isPano,
					compassAngle:
						props['view:azimuth'] != null
							? props['view:azimuth']
							: props.relative_heading != null
								? props.relative_heading
								: null,
					attribution: 'Panoramax (CC-BY-SA)',
				},
			};
		})
		.filter((feature) => feature.properties.thumbUrl);
}
