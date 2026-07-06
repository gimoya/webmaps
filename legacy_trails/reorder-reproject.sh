#!/bin/bash

# =============================================================================
# Reorder and Reproject Script
# =============================================================================
# Converts GPKG file from EPSG:3857 to EPSG:4326 (WGS84) GeoJSON.
# Coordinates: 6 decimal places (~0.1 m); elevation: whole metres.
# =============================================================================

COORD_DECIMALS=6
ALT_DECIMALS=0

echo "Starting reprojection process..."
echo "Converting my_trails_z_epsg3857.gpkg to data/my_trails_z.geojson"
echo "Coordinate precision: ${COORD_DECIMALS} dp lat/lon, ${ALT_DECIMALS} dp elevation"
echo ""

mkdir -p data

# GPKG: 3D lines in Web Mercator (EPSG:3857) -> WGS84 GeoJSON with elevation (3rd coordinate).
# GDAL 3.x may warn that GeoJSON "does not support" Z; ogrinfo on the output still reports 3D.
ogr2ogr -f GeoJSON -dim 3 \
    -s_srs EPSG:3857 -t_srs EPSG:4326 \
    -lco COORDINATE_PRECISION=${COORD_DECIMALS} \
    data/my_trails_z.geojson work/my_trails_z_epsg3857.gpkg
ogr_status=$?

if [ $ogr_status -ne 0 ]; then
    echo ""
    echo "ERROR: Reprojection failed!"
    exit 1
fi

echo "Rounding coordinates..."
python - "${COORD_DECIMALS}" "${ALT_DECIMALS}" <<'PY'
import json
import sys

path = "data/my_trails_z.geojson"
lon_lat_dp = int(sys.argv[1])
alt_dp = int(sys.argv[2])

with open(path, encoding="utf-8") as f:
    data = json.load(f)

def round_position(pos):
    if len(pos) < 2:
        return pos
    out = [round(pos[0], lon_lat_dp), round(pos[1], lon_lat_dp)]
    if len(pos) > 2:
        z = round(pos[2], alt_dp)
        out.append(int(z) if alt_dp == 0 else z)
    return out

def round_ring(ring):
    return [round_position(p) for p in ring]

def round_coords(coords, geom_type):
    if geom_type == "Point":
        return round_position(coords)
    if geom_type in ("MultiPoint", "LineString"):
        return round_ring(coords)
    if geom_type in ("Polygon", "MultiLineString"):
        return [round_ring(ring) for ring in coords]
    if geom_type == "MultiPolygon":
        return [[round_ring(ring) for ring in polygon] for polygon in coords]
    return coords

for feature in data.get("features", []):
    geometry = feature.get("geometry")
    if not geometry:
        continue
    geom_type = geometry.get("type")
    if geom_type and "coordinates" in geometry:
        geometry["coordinates"] = round_coords(geometry["coordinates"], geom_type)

with open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write("\n")
PY

if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: Coordinate rounding failed!"
    exit 1
fi

geom_type=$(ogrinfo -al -so data/my_trails_z.geojson 2>/dev/null | grep "^Geometry:" | head -1)
if ! echo "$geom_type" | grep -q "3D"; then
    echo ""
    echo "ERROR: Output GeoJSON has no Z dimension ($geom_type)"
    exit 1
fi

echo ""
echo "SUCCESS: Reprojection to WGS84 completed! ($geom_type)"
echo "Output file: data/my_trails_z.geojson"

echo ""
echo "Process completed."
