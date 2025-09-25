#!/bin/bash

# =============================================================================
# Reorder and Reproject Script
# =============================================================================
# Converts GPKG file from EPSG:900913 to EPSG:4326 (WGS84)
# =============================================================================

echo "Starting reprojection process..."
echo "Converting my_trails_z_epsg3857.gpkg to my_trails_z.geojson"
echo ""

# Run the reprojection
ogr2ogr my_trails_z.geojson my_trails_z_epsg3857.gpkg -s_srs EPSG:900913 -t_srs EPSG:4326

# Check if successful
if [ $? -eq 0 ]; then
    echo ""
    echo "SUCCESS: Reprojection to WGS84 completed!"
    echo "Output file: my_trails_z.geojson"
else
    echo ""
    echo "ERROR: Reprojection failed!"
    exit 1
fi

echo ""
echo "Process completed."
