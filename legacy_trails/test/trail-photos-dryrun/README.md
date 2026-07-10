# Trail Photos — Trockenlauf

Isolierter Test für Buffer-Union + Bbox-Tiling + optionale API-Probe.
Berührt `trail_map.js` nicht.

## Setup

```bash
cd test/trail-photos-dryrun
npm install
```

## 1. Dry Run (ohne API)

```bash
npm run dry-run
```

Erzeugt in `output/`:

- `search-corridor.geojson` — 50-m-Puffer, vereinigt
- `tiles.json` — Bbox-Kacheln (< 0.01 deg²)
- `report.json` — Statistik

## 2. Live-Probe (erste Kachel nur)

```bash
cp .env.example .env
# MAPILLARY_ACCESS_TOKEN eintragen
npm run dry-run:live
```

Zusätzlich: `trail_photos.geojson` mit Fotos, die im Korridor liegen und ≤ 50 m zum Trail sind.

## Fixtures

`fixtures/sample-trails.geojson` — 2 Trails (kurz + ~1 km) aus `data/my_trails_z.geojson`.
