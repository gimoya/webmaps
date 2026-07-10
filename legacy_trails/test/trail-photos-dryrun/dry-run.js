import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assignPhotoToTrail, buildTrailIndex } from './lib/assign.js';
import { buildTrailCorridor, pointInCorridor, tilesForCorridor } from './lib/corridor.js';
import { fetchMapillaryTile, mapillaryToPhotoFeatures } from './lib/mapillary-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const live = process.argv.includes('--live');
const inputPath = join(__dirname, 'fixtures', 'sample-trails.geojson');
const outputDir = join(__dirname, 'output');

mkdirSync(outputDir, { recursive: true });

const trails = JSON.parse(readFileSync(inputPath, 'utf8'));
const trailIndex = buildTrailIndex(trails);
const corridor = buildTrailCorridor(trails);
const tiles = tilesForCorridor(corridor);

writeFileSync(join(outputDir, 'search-corridor.geojson'), JSON.stringify(corridor));
writeFileSync(join(outputDir, 'tiles.json'), JSON.stringify(tiles, null, 2));

const report = {
	mode: live ? 'live' : 'dry',
	source: 'mapillary',
	trails: trails.features.map((f) => ({ id: f.properties.ID, name: f.properties.name })),
	corridorType: corridor.geometry.type,
	tileCount: tiles.length,
	tiles,
	apiCallsIfLive: tiles.length,
	env: {
		mapillary: Boolean(process.env.MAPILLARY_ACCESS_TOKEN),
	},
};

console.log('=== Trail Photos Dry Run (Mapillary) ===');
console.log(`Trails: ${trails.features.length}`);
console.log(`Corridor: ${corridor.geometry.type}`);
console.log(`Tiles: ${tiles.length} (max area ${Math.max(...tiles.map((t) => t.areaDeg2)).toFixed(6)} deg²)`);
console.log(`API calls if live: ${tiles.length}`);

if (!live) {
	console.log('\nDry mode only — geometry + tiling written to output/');
	console.log('Run: npm run dry-run:live  (needs .env with MAPILLARY_ACCESS_TOKEN, first tile only)');
	report.note = 'No API calls in dry mode';
	writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
	process.exit(0);
}

const mapillaryToken = process.env.MAPILLARY_ACCESS_TOKEN;
if (!mapillaryToken) {
	console.error('\n--live requires MAPILLARY_ACCESS_TOKEN in .env');
	process.exit(1);
}

const tile = tiles[0];
if (!tile) {
	console.error('No tiles intersect corridor');
	process.exit(1);
}

console.log(`\nLive probe: first tile ${tile.id} bbox=${tile.bboxStr}`);

const seen = new Set();
const outFeatures = [];

function ingest(features) {
	for (const feature of features) {
		const key = `mapillary:${feature.properties.photoId}`;
		if (seen.has(key)) {
			continue;
		}
		if (!pointInCorridor(feature, corridor)) {
			continue;
		}
		const assignment = assignPhotoToTrail(feature, trailIndex);
		if (!assignment) {
			continue;
		}
		seen.add(key);
		outFeatures.push({
			...feature,
			properties: { ...feature.properties, ...assignment },
		});
	}
}

try {
	const images = await fetchMapillaryTile(tile.bboxStr, mapillaryToken);
	console.log(`Mapillary raw: ${images.length} images in tile`);
	ingest(mapillaryToPhotoFeatures(images));
} catch (err) {
	console.error('Mapillary error:', err.message);
	report.mapillaryError = err.message;
}

const outGeoJson = { type: 'FeatureCollection', features: outFeatures };
writeFileSync(join(outputDir, 'trail_photos.geojson'), JSON.stringify(outGeoJson, null, 2));

report.probedTile = tile;
report.matchedPhotos = outFeatures.length;
report.photos = outFeatures.map((f) => f.properties);

console.log(`\nMatched photos (in corridor, ≤50m to trail): ${outFeatures.length}`);
writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log('Written: output/report.json, output/trail_photos.geojson');
