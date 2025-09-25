echo -e "\n---\n  ..reproject Legacy Trails? Hit y/n + [Enter]:"
read yesno
if [ "$yesno" = "y" ] 
then
	cd ~
	cd C:/GitHub/legacy_trails
	ogr2ogr my_trails_z.geojson my_trails_z_epsg3857.gpkg -s_srs EPSG:900913 -t_srs EPSG:4326
	echo -e "\\n  ..reprojection to WGS84 done\\n---\\n"
else 
	echo -e "\\n  You typed "$yesno" ..part skipped..\\n---\\n"
fi

echo -e "\\n---\\n"
read -p "Hit [Enter] to exit..."

