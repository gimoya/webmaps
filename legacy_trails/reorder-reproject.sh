#!/bin/bash

# =============================================================================
# Reorder and Reproject Script
# =============================================================================
# Converts GPKG file from EPSG:900913 to EPSG:4326 (WGS84)
# =============================================================================

echo "Starting reprojection process..."
echo "Converting my_trails_z_epsg3857.gpkg to data/my_trails_z.geojson"
echo ""

mkdir -p data

# GPKG: 3D lines in Web Mercator (EPSG:3857) -> WGS84 GeoJSON with elevation (3rd coordinate).
# GDAL 3.x may warn that GeoJSON "does not support" Z; ogrinfo on the output still reports 3D.
ogr2ogr -f GeoJSON -dim 3 \
    -s_srs EPSG:3857 -t_srs EPSG:4326 \
    data/my_trails_z.geojson work/my_trails_z_epsg3857.gpkg
ogr_status=$?

if [ $ogr_status -ne 0 ]; then
    echo ""
    echo "ERROR: Reprojection failed!"
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
