# Trail Photos Build (Mapillary + Panoramax)

## Sources

| Source | Auth | Notes |
|--------|------|-------|
| **Mapillary** | `MAPILLARY_ACCESS_TOKEN` in `.env` | Road + trail imagery, 360° panos |
| **Panoramax** | none | OSM community outdoor photos (CC-BY-SA) |

Per trail grid cell (**100m × 100m**): up to **one photo per source** (max 2 markers per cell).

Without `MAPILLARY_ACCESS_TOKEN` the build runs **Panoramax only**.

## Cost strategy

| Lever | Why |
|-------|-----|
| **Bbox tiles** (~1.7k calls × 2 sources) | Fewer calls than radius-per-point |
| **`limit=100`** | Small JSON per tile |
| **Slot ingest** | 1 photo / 100m grid / source |
| **Tile disk cache** | Rebuilds skip API (`work/tile-cache/`) |
| **Trail assign** | Photo in trail bbox (+100m pad) |

Tune in `lib/config.js`: `GRID_CELL_M`, `PANORAMAX_INSTANCES`.

## Setup

```bash
cd tools/trail-photos
npm install
cp .env.example .env
# MAPILLARY_ACCESS_TOKEN=...  (optional but recommended)
```

## Commands

```bash
npm run build:dry      # tile count only
npm run build          # fetch + cache read/write + slots
npm run build:resume   # continue from work/build-checkpoint.json
npm run build:fresh    # ignore tile cache reads (still writes cache)
```

Dry-run test: `test/trail-photos-dryrun/`
