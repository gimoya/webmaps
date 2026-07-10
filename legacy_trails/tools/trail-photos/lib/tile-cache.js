import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function createTileCache(cacheDir) {
	mkdirSync(cacheDir, { recursive: true });

	return {
		get(tileId) {
			const path = join(cacheDir, `${tileId}.json`);
			if (!existsSync(path)) {
				return null;
			}
			try {
				return JSON.parse(readFileSync(path, 'utf8'));
			} catch (err) {
				console.error(`CORRUPT cache ${tileId}: ${err.message} — removing`);
				unlinkSync(path);
				return null;
			}
		},
		set(tileId, images) {
			writeFileSync(join(cacheDir, `${tileId}.json`), JSON.stringify(images));
		},
		has(tileId) {
			return existsSync(join(cacheDir, `${tileId}.json`));
		},
	};
}
