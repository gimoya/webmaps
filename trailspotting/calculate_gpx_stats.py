#!/usr/bin/env python3
"""
GPX Statistics Calculator
Calculates distance, elevation gain/loss, and estimated duration for GPX files.
Updates the metadata in each GPX file with calculated statistics.
"""

import xml.etree.ElementTree as ET
import os
import math
from typing import Tuple, List, Dict

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth (in meters).
    Uses the Haversine formula.
    """
    # Convert latitude and longitude from degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    
    # Haversine formula
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    # Radius of earth in meters
    r = 6371000
    return c * r

def calculate_segment_stats(trkseg) -> Dict[str, float]:
    """
    Calculate statistics for a single track segment.
    Returns: distance (km), elevation_gain (m), elevation_loss (m), duration (minutes)
    """
    trkpts = trkseg.findall('trkpt')
    
    if len(trkpts) < 2:
        return {'distance': 0, 'elevation_gain': 0, 'elevation_loss': 0, 'duration': 0}
    
    total_distance = 0
    elevations = []
    
    # Extract elevations
    for trkpt in trkpts:
        ele = trkpt.find('ele')
        if ele is not None and ele.text:
            try:
                elevations.append(float(ele.text))
            except ValueError:
                continue
    
    # Calculate distance between consecutive points
    for i in range(len(trkpts) - 1):
        lat1 = float(trkpts[i].get('lat'))
        lon1 = float(trkpts[i].get('lon'))
        lat2 = float(trkpts[i + 1].get('lat'))
        lon2 = float(trkpts[i + 1].get('lon'))
        
        distance = haversine_distance(lat1, lon1, lat2, lon2)
        total_distance += distance
    
    # Calculate elevation gain and loss
    elevation_gain = 0
    elevation_loss = 0
    
    for i in range(1, len(elevations)):
        diff = elevations[i] - elevations[i-1]
        if diff > 0:
            elevation_gain += diff
        else:
            elevation_loss += abs(diff)
    
    # Calculate duration based on 10 km/h average speed
    # Add time penalty for elevation gain (1 minute per 10m gain)
    distance_km = total_distance / 1000
    base_duration = (distance_km / 10) * 60  # minutes
    elevation_penalty = (elevation_gain / 10) * 1  # 1 minute per 10m gain
    total_duration = base_duration + elevation_penalty
    
    # Format duration as HH:MM
    hours = int(total_duration // 60)
    minutes = int(total_duration % 60)
    duration_str = f"{hours:02d}:{minutes:02d}"
    
    return {
        'distance': round(distance_km, 0),
        'elevation_gain': round(elevation_gain, 0),
        'elevation_loss': round(elevation_loss, 0),
        'duration': duration_str
    }

def update_gpx_metadata(gpx_file: str) -> None:
    """
    Update GPX file with calculated statistics in segment metadata.
    """
    print(f"Processing {gpx_file}...")
    
    # Parse GPX file
    tree = ET.parse(gpx_file)
    root = tree.getroot()
    
    # Find all track segments
    trksegs = root.findall('.//trkseg')
    print(f"  Found {len(trksegs)} track segments")
    
    # Update each segment
    for i, trkseg in enumerate(trksegs):
        # Calculate statistics
        stats = calculate_segment_stats(trkseg)
        
        # Remove existing metadata if present
        name = trkseg.find('name')
        if name is not None:
            trkseg.remove(name)
        desc = trkseg.find('desc')
        if desc is not None:
            trkseg.remove(desc)
        
        # Create new metadata elements
        name = ET.Element('name')
        name.text = f"Segment {i+1}"
        
        desc = ET.Element('desc')
        desc.text = (f"distance: {stats['distance']}km, "
                    f"elevation_gain: {stats['elevation_gain']}m, "
                    f"elevation_loss: {stats['elevation_loss']}m, "
                    f"estimated_duration: {stats['duration']}")
        
        # Insert at the beginning of trkseg
        trkseg.insert(0, name)
        trkseg.insert(1, desc)
        
        # Add proper formatting
        name.tail = '\n      '
        desc.tail = '\n      '
        
        print(f"    Segment {i+1}: {stats['distance']}km, +{stats['elevation_gain']}m/-{stats['elevation_loss']}m, ~{stats['duration']}")
    
    # Write back to file
    tree.write(gpx_file, encoding='utf-8', xml_declaration=True)
    print(f"  Updated {len(trksegs)} segments with calculated statistics")

def main():
    """
    Main function to process all GPX files in the current directory.
    """
    print("GPX Statistics Calculator")
    print("=" * 50)
    
    # Find all GPX files in gps directory
    gps_dir = 'gps'
    if not os.path.exists(gps_dir):
        print(f"Error: {gps_dir} directory not found!")
        return
    
    gpx_files = [f for f in os.listdir(gps_dir) if f.endswith('.gpx')]
    
    if not gpx_files:
        print(f"No GPX files found in {gps_dir} directory!")
        return
    
    print(f"Found {len(gpx_files)} GPX files:")
    for gpx_file in gpx_files:
        print(f"  - {gpx_file}")
    
    print("\nProcessing files...")
    print("-" * 30)
    
    # Process each GPX file
    for gpx_file in sorted(gpx_files):
        filepath = os.path.join(gps_dir, gpx_file)
        try:
            update_gpx_metadata(filepath)
        except Exception as e:
            print(f"  Error processing {gpx_file}: {e}")
        print()
    
    print("Done! All GPX files updated with calculated statistics.")
    print("\nStatistics calculated:")
    print("- Distance: Total track distance in kilometers")
    print("- Elevation gain/loss: Total elevation change in meters")
    print("- Duration: Estimated time based on 10 km/h + elevation penalty (HH:MM format)")
    print("  (1 minute penalty per 10m elevation gain)")

if __name__ == "__main__":
    main()
