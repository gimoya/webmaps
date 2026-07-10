import { GRID_CELL_M } from './config.js';
import { gridCellForPoint } from './grid.js';

/**
 * Per-trail 100m × 100m grid — max 1 photo per cell (closest to cell center wins).
 */
export class PhotoSlotStore {
	constructor(cellM = GRID_CELL_M) {
		this.cellM = cellM;
		this.slots = new Map();
	}

	tryIngest(feature, assignment) {
		const [lon, lat] = feature.geometry.coordinates;
		const cell = gridCellForPoint(lon, lat, this.cellM);
		const slotKey = `${assignment.trailId}:${cell.gx}:${cell.gy}:${feature.properties.source}`;

		const occupant = this.slots.get(slotKey);
		if (occupant && cell.distFromCellCenter >= occupant.properties.distFromCellCenter) {
			return false;
		}

		this.slots.set(slotKey, {
			...feature,
			properties: {
				...feature.properties,
				...assignment,
				gridX: cell.gx,
				gridY: cell.gy,
				distFromCellCenter: Number(cell.distFromCellCenter.toFixed(1)),
			},
		});
		return true;
	}

	getFeatures() {
		return Array.from(this.slots.values());
	}

	get size() {
		return this.slots.size;
	}

	toCheckpointEntries() {
		return Array.from(this.slots.entries()).map(([key, feature]) => ({ key, feature }));
	}

	static fromCheckpoint(entries, cellM = GRID_CELL_M) {
		const store = new PhotoSlotStore(cellM);
		for (const entry of entries) {
			store.slots.set(entry.key, entry.feature);
		}
		return store;
	}
}
