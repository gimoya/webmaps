#!/usr/bin/env python3
"""
Add station metadata to GPX files based on cycling_segments.csv
"""

import xml.etree.ElementTree as ET
import csv
import os
from collections import defaultdict

def parse_csv_segments():
    """Parse cycling_segments.csv and organize by route"""
    segments_by_route = defaultdict(list)
    
    # Try different encodings
    encodings = ['utf-16', 'utf-8', 'utf-8-sig', 'latin1', 'cp1252']
    for encoding in encodings:
        try:
            with open('cycling_segments.csv', 'r', encoding=encoding) as f:
                reader = csv.DictReader(f, delimiter=';')
                for row in reader:
                    route = row['route']
                    segments_by_route[route].append({
                        'segment': int(row['segment']),
                        'from_station': row['from_station'],
                        'to_station': row['to_station'],
                        'elevation_gain': row['elevation_gain'],
                        'distance': row['distance'],
                        'duration': row['duration'],
                        'notes': row['notes']
                    })
            print(f"Successfully read CSV with {encoding} encoding")
            break
        except (UnicodeDecodeError, KeyError) as e:
            print(f"Failed with {encoding}: {e}")
            continue
    else:
        print("Could not read CSV file with any encoding")
        return {}
    
    return segments_by_route

def calculate_elevation_stats(trkseg):
    """Calculate elevation gain and loss from track segment"""
    elevations = []
    for trkpt in trkseg.findall('{http://www.topografix.com/GPX/1/1}trkpt'):
        ele = trkpt.find('{http://www.topografix.com/GPX/1/1}ele')
        if ele is not None and ele.text:
            try:
                elevations.append(float(ele.text))
            except ValueError:
                continue
    
    if len(elevations) < 2:
        return 0, 0
    
    gain = 0
    loss = 0
    
    for i in range(1, len(elevations)):
        diff = elevations[i] - elevations[i-1]
        if diff > 0:
            gain += diff
        else:
            loss += abs(diff)
    
    return round(gain, 1), round(loss, 1)

def add_metadata_to_gpx(gpx_file, route_segments):
    """Add segment-level metadata to GPX file"""
    print(f"Processing {gpx_file}...")
    
    # Parse GPX file
    tree = ET.parse(gpx_file)
    root = tree.getroot()
    
    # Find all track segments (handle namespace)
    trksegs = root.findall('.//{http://www.topografix.com/GPX/1/1}trkseg')
    print(f"  Found {len(trksegs)} track segments")
    
    # Add metadata to each segment
    for i, trkseg in enumerate(trksegs):
        if i < len(route_segments):
            seg_data = route_segments[i]
            
            # Calculate actual elevation stats from GPX data
            elev_gain, elev_loss = calculate_elevation_stats(trkseg)
            
            # Remove existing metadata if present
            name = trkseg.find('{http://www.topografix.com/GPX/1/1}name')
            if name is not None:
                trkseg.remove(name)
            desc = trkseg.find('{http://www.topografix.com/GPX/1/1}desc')
            if desc is not None:
                trkseg.remove(desc)
            
            # Create metadata elements with proper formatting
            name = ET.Element('{http://www.topografix.com/GPX/1/1}name')
            name.text = f"{seg_data['from_station']} -> {seg_data['to_station']}"
            
            desc = ET.Element('{http://www.topografix.com/GPX/1/1}desc')
            desc.text = f"start_location: {seg_data['from_station']}, end_location: {seg_data['to_station']}, elev_gain: {elev_gain}m, elev_loss: {elev_loss}m, distance: {seg_data['distance']}, duration: {seg_data['duration']}"
            
            # Insert at the beginning of trkseg
            trkseg.insert(0, name)
            trkseg.insert(1, desc)
            
            # Add proper indentation and line breaks
            name.tail = '\n      '
            desc.tail = '\n      '
            
            print(f"    Segment {i+1}: {name.text}")
            print(f"      Elevation: +{elev_gain}m / -{elev_loss}m")
    
    # Write back to file
    tree.write(gpx_file, encoding='utf-8', xml_declaration=True)
    print(f"  Updated {len(trksegs)} segments with metadata")

def main():
    """Main function"""
    print("Adding station metadata to GPX files...")
    
    # Parse CSV data
    segments_by_route = parse_csv_segments()
    print(f"Found segments for routes: {list(segments_by_route.keys())}")
    
    # Map GPX files to routes
    gpx_files = {
        'A__Trailspotting.gpx': 'A',
        'B__Trailspotting.gpx': 'B', 
        'C__Trailspotting.gpx': 'C',
        'D__Trailspotting.gpx': 'D/DD',
        'DD__Trailspotting.gpx': 'D/DD'
    }
    
    # Process each GPX file
    for gpx_file, route in gpx_files.items():
        gpx_path = os.path.join('gps', gpx_file)
        if os.path.exists(gpx_path) and route in segments_by_route:
            add_metadata_to_gpx(gpx_path, segments_by_route[route])
        else:
            print(f"  Skipping {gpx_file} - file not found or no segments for route {route}")
    
    print("Done!")

if __name__ == "__main__":
    main()
