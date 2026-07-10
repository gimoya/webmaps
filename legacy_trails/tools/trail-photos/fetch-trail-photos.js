import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assignPhotoToTrail, buildTrailIndex } from './lib/assign.js';
import { GRID_CELL_M, TRAIL_BBOX_PAD_M, RATE_MS } from './lib/config.js';
import { buildTrailBuffers, tilesForBuffers } from './lib/corridor.js';
import { fetchMapillaryTile, mapillaryToPhotoFeatures } from './lib/mapillary-client.js';
import { fetchPanoramaxTile, panoramaxToPhotoFeatures } from './lib/panoramax-client.js';
import { PhotoSlotStore } from './lib/photo-slots.js';
import { createTileCache } from './lib/tile-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const dry = process.argv.includes('--dry');
const skipCacheRead = process.argv.includes('--no-cache');
const resume = process.argv.includes('--resume');
const inputPath =
	process.argv.find((a, i) => process.argv[i - 1] === '--input') ||
	join(__dirname, '../../data/my_trails_z.geojson');
const outputPath =
	process.argv.find((a, i) => process.argv[i - 1] === '--output') ||
	join(__dirname, '../../data/trail_photos.geojson');
const workDir = join(__dirname, 'work');
const cacheDir = join(workDir, 'tile-cache');
const checkpointPath = join(workDir, 'build-checkpoint.json');
mkdirSync(workDir, { recursive: true });

const CHECKPOINT_EVERY = 50;
const FETCH_RETRIES = 3;
const CONFIG_KEY = `g${GRID_CELL_M}_b${TRAIL_BBOX_PAD_M}_panos_dual`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function loadTrails() {
	const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
	raw.features = raw.features.filter((f) => f.properties.HIDE !== 1);
	return raw;
}

function writeOutput(features, meta) {
	writeFileSync(
		outputPath,
		JSON.stringify({ type: 'FeatureCollection', name: 'trail_photos', meta, features }),
	);
}

function loadCheckpoint() {
	if (!existsSync(checkpointPath)) {
		return null;
	}
	try {
		const cp = JSON.parse(readFileSync(checkpointPath, 'utf8'));
		if (cp.configKey !== CONFIG_KEY) {
			console.warn('Checkpoint config mismatch — ignoring', checkpointPath);
			return null;
		}
		return cp;
	} catch (err) {
		console.warn('Invalid checkpoint:', err.message);
		return null;
	}
}

function saveCheckpoint(state) {
	writeFileSync(checkpointPath, JSON.stringify(state));
}

function clearCheckpoint() {
	if (existsSync(checkpointPath)) {
		unlinkSync(checkpointPath);
	}
}

function cacheTileId(source, tileId) {
	return `${tileId}.${source}`;
}

async function fetchWithRetry(label, fetchFn) {
	let lastErr;
	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
		try {
			return await fetchFn();
		} catch (err) {
			lastErr = err;
			if (attempt < FETCH_RETRIES) {
				await delay(RATE_MS * attempt * 2);
			}
		}
	}
	throw new Error(`${label}: ${lastErr.message}`);
}

const trails = loadTrails();
const trailIndex = buildTrailIndex(trails);
const tiles = tilesForBuffers(buildTrailBuffers(trails));
const tileCache = createTileCache(cacheDir);

let slots = new PhotoSlotStore();
let startIndex = 0;
let apiCalls = 0;
let cacheHits = 0;
let mapillaryRaw = 0;
let panoramaxRaw = 0;
let errors = 0;
let startedAt = Date.now();

const checkpoint = resume ? loadCheckpoint() : null;
if (checkpoint) {
	slots = PhotoSlotStore.fromCheckpoint(checkpoint.slots);
	startIndex = checkpoint.tilesDone;
	apiCalls = checkpoint.apiCalls || 0;
	cacheHits = checkpoint.cacheHits || 0;
	mapillaryRaw = checkpoint.mapillaryRaw || 0;
	panoramaxRaw = checkpoint.panoramaxRaw || 0;
	errors = checkpoint.errors || 0;
	startedAt = Date.now() - (checkpoint.elapsedSec || 0) * 1000;
	console.log(`Resuming from tile ${startIndex}/${tiles.length} (${slots.size} slots)`);
}

const mapillaryToken = process.env.MAPILLARY_ACCESS_TOKEN || '';
const useMapillary = Boolean(mapillaryToken);

console.log('=== Trail Photos (Mapillary + Panoramax) ===');
console.log(`Trails: ${trails.features.length} | Tiles: ${tiles.length}`);
console.log(
	`Output: trail bbox | 1 photo / ${GRID_CELL_M}m grid / source | incl. 360° | cache ${skipCacheRead ? 'write-only' : 'read+write'}`,
);
console.log(`Sources: ${useMapillary ? 'Mapillary + Panoramax' : 'Panoramax only (no MAPILLARY_ACCESS_TOKEN)'}`);

if (dry) {
	writeOutput([], {
		builtAt: new Date().toISOString(),
		mode: 'dry',
		sources: useMapillary ? ['mapillary', 'panoramax'] : ['panoramax'],
		tileCount: tiles.length,
		photoCount: 0,
	});
	process.exit(0);
}

function ingestFeatures(features) {
	for (const feature of features) {
		const assignment = assignPhotoToTrail(feature, trailIndex);
		if (assignment) {
			slots.tryIngest(feature, assignment);
		}
	}
}

function checkpointState(tilesDone) {
	return {
		configKey: CONFIG_KEY,
		tilesDone,
		tileCount: tiles.length,
		apiCalls,
		cacheHits,
		mapillaryRaw,
		panoramaxRaw,
		errors,
		elapsedSec: Math.round((Date.now() - startedAt) / 1000),
		slots: slots.toCheckpointEntries(),
	};
}

async function loadSourceTile(source, tile, fetchFn) {
	const cacheId = cacheTileId(source, tile.id);
	let images;

	if (!skipCacheRead) {
		images = tileCache.get(cacheId);
		if (images) {
			cacheHits++;
			return images;
		}
	}

	images = await fetchWithRetry(source, () => fetchFn(tile.bboxStr));
	apiCalls++;
	tileCache.set(cacheId, images);
	await delay(RATE_MS);
	return images;
}

for (let i = startIndex; i < tiles.length; i++) {
	const tile = tiles[i];

	try {
		if (useMapillary) {
			const mapillaryImages = await loadSourceTile('mapillary', tile, (bboxStr) =>
				fetchMapillaryTile(bboxStr, mapillaryToken, 90000),
			);
			mapillaryRaw += mapillaryImages.length;
			ingestFeatures(mapillaryToPhotoFeatures(mapillaryImages));
		}

		const panoramaxImages = await loadSourceTile('panoramax', tile, (bboxStr) =>
			fetchPanoramaxTile(bboxStr, 90000),
		);
		panoramaxRaw += panoramaxImages.length;
		ingestFeatures(panoramaxToPhotoFeatures(panoramaxImages));
	} catch (err) {
		errors++;
		console.error(`ERR ${tile.id}:`, err.message);
		saveCheckpoint(checkpointState(i));
		continue;
	}

	const tilesDone = i + 1;
	if (tilesDone % CHECKPOINT_EVERY === 0 || i === startIndex || tilesDone === tiles.length) {
		saveCheckpoint(checkpointState(tilesDone));
		const s = ((Date.now() - startedAt) / 1000).toFixed(0);
		console.log(
			`[${tilesDone}/${tiles.length}] slots=${slots.size} api=${apiCalls} cache=${cacheHits} m=${mapillaryRaw} p=${panoramaxRaw} (${s}s)`,
		);
	}
}

const features = slots.getFeatures();
const bySource = features.reduce((acc, feature) => {
	const source = feature.properties.source || 'unknown';
	acc[source] = (acc[source] || 0) + 1;
	return acc;
}, {});

const meta = {
	builtAt: new Date().toISOString(),
	mode: 'live',
	sources: useMapillary ? ['mapillary', 'panoramax'] : ['panoramax'],
	gridCellM: GRID_CELL_M,
	bboxPadM: TRAIL_BBOX_PAD_M,
	assignMode: 'trail-bbox',
	excludePanos: false,
	trailCount: trails.features.length,
	tileCount: tiles.length,
	apiCalls,
	cacheHits,
	mapillaryRaw,
	panoramaxRaw,
	photoCount: features.length,
	photoCountBySource: bySource,
	errors,
	elapsedSec: Math.round((Date.now() - startedAt) / 1000),
};

writeOutput(features, meta);
writeFileSync(join(workDir, 'build-report.json'), JSON.stringify(meta, null, 2));
clearCheckpoint();
console.log(`\nDone: ${features.length} photos | API calls: ${apiCalls} | cache hits: ${cacheHits}`);
console.log(`By source: ${JSON.stringify(bySource)}`);
console.log(`Written: ${outputPath}`);
