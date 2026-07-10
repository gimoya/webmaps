/** Local metric grid for Tirol (~47°N). Stable 100m cells in x/y. */
const REF_LAT = 47.3;

export function localMeters(lon, lat, refLat = REF_LAT) {
	const cos = Math.cos((refLat * Math.PI) / 180);
	return {
		x: lon * 111320 * cos,
		y: lat * 110540,
	};
}

export function gridCellForPoint(lon, lat, cellM, refLat = REF_LAT) {
	const { x, y } = localMeters(lon, lat, refLat);
	const gx = Math.floor(x / cellM);
	const gy = Math.floor(y / cellM);
	const cx = (gx + 0.5) * cellM;
	const cy = (gy + 0.5) * cellM;
	return {
		gx,
		gy,
		distFromCellCenter: Math.hypot(x - cx, y - cy),
	};
}

/** Expand [minLon, minLat, maxLon, maxLat] by padM on each side. */
export function padBboxMeters(bbox, padM, refLat = REF_LAT) {
	const [minLon, minLat, maxLon, maxLat] = bbox;
	const midLat = (minLat + maxLat) / 2;
	const cos = Math.cos((midLat * Math.PI) / 180);
	const padLon = padM / (111320 * cos);
	const padLat = padM / 110540;
	return [
		minLon - padLon,
		minLat - padLat,
		maxLon + padLon,
		maxLat + padLat,
	];
}
