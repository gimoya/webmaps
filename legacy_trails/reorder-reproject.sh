ogr2ogr my_trails_z.geojson my_trails_z_epsg3857.gpkg -s_srs EPSG:900913 -t_srs EPSG:4326
echo -e "\\n  ..reprojection to WGS84 done\\n---\\n"
