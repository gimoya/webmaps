/** Build-time constants — single place to tune cost vs coverage */
export const GRID_CELL_M = 100;
export const TRAIL_BBOX_PAD_M = 100;
export const BUFFER_KM = 0.1;
export const TILE_DEG = 0.0095;
export const MAX_TILE_AREA_DEG2 = 0.01;
export const MAPILLARY_LIMIT = 100;
export const MAPILLARY_FIELDS = 'id,geometry,thumb_256_url,thumb_1024_url,captured_at,is_pano,compass_angle,computed_compass_angle';
export const PANORAMAX_LIMIT = 100;
export const PANORAMAX_INSTANCES = [
	{
		apiBase: 'https://panoramax.openstreetmap.fr',
		webBase: 'https://panoramax.openstreetmap.fr',
	},
];
export const RATE_MS = 200;
