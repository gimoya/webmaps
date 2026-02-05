#!/usr/bin/env python3
"""
GPX File Cleaner and Statistics Calculator
Cleans GPX files by removing unnecessary tags and extensions, then calculates
distance, elevation gain/loss, and estimated duration for GPX files.
Updates the metadata in each GPX file with calculated statistics and file information.
"""

import xml.etree.ElementTree as ET
import os
import math
import re
from typing import Tuple, List, Dict

def load_config_from_js() -> Dict[str, float]:
    """
    Load configuration values from config.js file.
    Returns a dictionary with configuration values.
    """
    config_file = 'config.js'
    config = {
        'avgSpeed': 20.0,
        'elevationPenalty': 1.0,
        'pauseTimePer60min': 5.0
    }
    
    if not os.path.exists(config_file):
        print(f"Warning: {config_file} not found, using default values")
        return config
    
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract avgSpeed
        avg_speed_match = re.search(r'avgSpeed:\s*([\d.]+)', content)
        if avg_speed_match:
            config['avgSpeed'] = float(avg_speed_match.group(1))
        
        # Extract elevationPenalty
        elevation_penalty_match = re.search(r'elevationPenalty:\s*([\d.]+)', content)
        if elevation_penalty_match:
            config['elevationPenalty'] = float(elevation_penalty_match.group(1))
        
        # Extract pauseTimePer60min
        pause_time_match = re.search(r'pauseTimePer60min:\s*([\d.]+)', content)
        if pause_time_match:
            config['pauseTimePer60min'] = float(pause_time_match.group(1))
        
        print(f"Loaded config from {config_file}:")
        print(f"  Speed: {config['avgSpeed']} km/h")
        print(f"  Elevation penalty: {config['elevationPenalty']} min/10m")
        print(f"  Pause time: {config['pauseTimePer60min']} min/60min")
        
    except Exception as e:
        print(f"Error reading {config_file}: {e}")
        print("Using default values")
    
    return config

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

def calculate_segment_stats(trkseg, avg_km_per_hour: float = 10.0, time_penalty_per_10m_elev: float = 1.0, pause_time_per_60min: float = 5.0) -> Dict[str, float]:
    """
    Calculate statistics for a single track segment.
    
    Args:
        trkseg: GPX track segment element
        avg_km_per_hour: Average speed in km/h for duration calculation (default: 10.0)
        time_penalty_per_10m_elev: Time penalty in minutes per 10m elevation gain (default: 1.0)
    
    Returns: distance (km), elevation_gain (m), elevation_loss (m), duration (minutes)
    """
    # Get track points
    trkpts = trkseg.findall('trkpt')
    
    if len(trkpts) < 2:
        return {'distance': 0, 'elevation_gain': 0, 'elevation_loss': 0, 'est_duration_moving': '00:00', 'est_duration_incl_pauses': '00:00', 'avg_km_per_hour': 0, 'avg_km_hr_moving': 0}
    
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
    
    # Calculate duration based on average speed, elevation penalty, and pause time
    distance_km = total_distance / 1000
    base_duration = (distance_km / avg_km_per_hour) * 60  # minutes
    elevation_penalty = (elevation_gain / 10) * time_penalty_per_10m_elev  # penalty per 10m gain
    
    # Moving duration (without pause time)
    moving_duration = base_duration + elevation_penalty
    
    # Pause time is calculated based on moving duration (not just base duration)
    pause_time = (moving_duration / 60) * pause_time_per_60min  # pause time per 60min of moving time
    
    # Total duration (including pause time)
    total_duration = moving_duration + pause_time
    
    # Format moving duration as HH:MM
    moving_hours = int(moving_duration // 60)
    moving_minutes = int(moving_duration % 60)
    duration_moving_str = f"{moving_hours:02d}:{moving_minutes:02d}"
    
    # Format total duration as HH:MM
    total_hours = int(total_duration // 60)
    total_minutes = int(total_duration % 60)
    duration_incl_pauses_str = f"{total_hours:02d}:{total_minutes:02d}"
    
    # Calculate average km/h based on estimated duration (includes pause time)
    # avg_km_per_hour = distance / time_in_hours
    if total_duration > 0:
        avg_km_per_hour_calculated = distance_km / (total_duration / 60)
    else:
        avg_km_per_hour_calculated = 0
    
    # Calculate moving average km/h (excluding pause time)
    # Only uses base_duration + elevation_penalty
    if moving_duration > 0:
        avg_km_hr_moving = distance_km / (moving_duration / 60)
    else:
        avg_km_hr_moving = 0
    
    return {
        'distance': round(distance_km, 1),
        'elevation_gain': round(elevation_gain, 0),  # Round to 0 decimals (keeps as float for precision)
        'elevation_loss': round(elevation_loss, 0),   # Round to 0 decimals (keeps as float for precision)
        'est_duration_moving': duration_moving_str,
        'est_duration_incl_pauses': duration_incl_pauses_str,
        'avg_km_per_hour': round(avg_km_per_hour_calculated, 1),
        'avg_km_hr_moving': round(avg_km_hr_moving, 1)
    }

def clean_gpx_element(element):
    """
    Recursively clean GPX element by removing unnecessary tags and extensions.
    Keeps only essential GPX elements: trkpt, lat, lon, ele, name, desc, trkseg, trk.
    """
    # Elements to keep (essential GPX elements)
    keep_elements = {'trkpt', 'lat', 'lon', 'ele', 'name', 'desc', 'trkseg', 'trk', 'gpx', 'metadata', 'author', 'link'}
    
    # Remove extensions and unnecessary elements
    elements_to_remove = []
    for child in element:
        tag_name = child.tag.split('}')[-1] if '}' in child.tag else child.tag  # Remove namespace prefix
        
        if tag_name not in keep_elements:
            elements_to_remove.append(child)
        else:
            # Recursively clean child elements
            clean_gpx_element(child)
    
    # Remove unwanted elements
    for elem in elements_to_remove:
        element.remove(elem)
    
    # Remove extension attributes
    if hasattr(element, 'attrib'):
        attrs_to_remove = []
        for attr_name in element.attrib:
            if 'extension' in attr_name.lower() or 'xmlns' in attr_name.lower():
                attrs_to_remove.append(attr_name)
        for attr in attrs_to_remove:
            del element.attrib[attr]

# GPX 1.1 namespace for writing valid GPX that parsers (e.g. TRAILISM GPX Checkpoint Times) can use
GPX_NS = 'http://www.topografix.com/GPX/1/1'
XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance'


def remove_namespaces(element):
    """
    Recursively remove namespace prefixes from element tags and attributes.
    """
    # Remove namespace prefix from tag name
    if '}' in element.tag:
        element.tag = element.tag.split('}')[-1]
    
    # Remove namespace prefixes from attributes
    if hasattr(element, 'attrib'):
        attrs_to_remove = []
        new_attrs = {}
        for attr_name, attr_value in element.attrib.items():
            if '}' in attr_name:
                # Remove namespace prefix from attribute name
                new_name = attr_name.split('}')[-1]
                new_attrs[new_name] = attr_value
                attrs_to_remove.append(attr_name)
        
        # Remove old namespaced attributes and add new ones
        for attr in attrs_to_remove:
            del element.attrib[attr]
        element.attrib.update(new_attrs)
    
    # Recursively process children
    for child in element:
        remove_namespaces(child)


def apply_gpx11_namespaces_for_write(root):
    """
    Apply GPX 1.1 default namespace to root and all descendants so that
    tree.write() produces valid GPX 1.1 with xmlns="http://www.topografix.com/GPX/1/1".
    Call this right before tree.write(); does not change findall() behavior before that.
    """
    def local_name(tag):
        return tag.split('}', 1)[1] if tag.startswith('{') else tag

    def set_ns(element):
        if not element.tag.startswith('{'):
            element.tag = f'{{{GPX_NS}}}{element.tag}'
        for child in element:
            set_ns(child)

    set_ns(root)
    # xsi:schemaLocation so validators and parsers recognize GPX 1.1
    root.set(f'{{{XSI_NS}}}schemaLocation',
             'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd')
    # Remove unqualified schemaLocation if present
    for key in list(root.attrib):
        if key == 'schemaLocation' or (not key.startswith('{') and 'schemaLocation' in key.lower()):
            del root.attrib[key]
    # So write() emits xmlns="..." and xmlns:xsi="..."
    ET.register_namespace('', GPX_NS)
    ET.register_namespace('xsi', XSI_NS)

def update_gpx_metadata(gpx_file: str, avg_km_per_hour: float = 10.0, time_penalty_per_10m_elev: float = 1.0, pause_time_per_60min: float = 5.0) -> None:
    """
    Update GPX file with calculated statistics in segment metadata.
    Also cleans the GPX file by removing unnecessary tags and extensions.
    
    Args:
        gpx_file: Path to GPX file
        avg_km_per_hour: Average speed in km/h for duration calculation (default: 10.0)
        time_penalty_per_10m_elev: Time penalty in minutes per 10m elevation gain (default: 1.0)
    """
    print(f"Processing {gpx_file}...")
    
    # Replace gpx.studio with tiroltrailhead.com in file content
    with open(gpx_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'gpx.studio' in content:
        content = content.replace('gpx.studio', 'tiroltrailhead.com')
        with open(gpx_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print("  Replaced gpx.studio with tiroltrailhead.com")
    
    # Parse GPX file
    tree = ET.parse(gpx_file)
    root = tree.getroot()
    
    # Clean the GPX file by removing unnecessary elements
    print("  Cleaning GPX file (removing extensions and unnecessary tags)...")
    clean_gpx_element(root)
    
    # Remove namespaces from all elements
    print("  Removing namespaces from GPX elements...")
    remove_namespaces(root)
    
    # Standardize root element attributes (xmlns and xsi:schemaLocation applied later before write)
    print("  Standardizing GPX root attributes...")
    root.set('version', '1.1')
    root.set('creator', 'https://tiroltrailhead.com')
    for attr_name in list(root.attrib.keys()):
        if 'schemaLocation' in attr_name.lower():
            del root.attrib[attr_name]
    
    # Update metadata: inject filename and description
    print("  Updating GPX metadata...")
    metadata = root.find('metadata')
    if metadata is None:
        # Create metadata element if it doesn't exist
        metadata = ET.Element('metadata')
        root.insert(0, metadata)
        metadata.tail = '\n  '
    
    # Get filename without path and extension
    filename = os.path.basename(gpx_file)
    filename_without_ext = os.path.splitext(filename)[0]
    
    # Update or create name element in metadata
    name_elem = metadata.find('name')
    if name_elem is not None:
        name_elem.text = filename_without_ext
    else:
        name_elem = ET.Element('name')
        name_elem.text = filename_without_ext
        metadata.insert(0, name_elem)
        name_elem.tail = '\n    '
    
    # Add or update description in metadata
    desc_elem = metadata.find('desc')
    desc_text = ("This file contains a Trailspotting-Route with bike ride segments. "
                 "For the transfers between bike ride segments, public transport is available "
                 "(train or local bus services). See this site for details: https://tiroltrailhead.com/webmaps/trailspotting\n\n"
                 "If your application is having issues with opening this gpx file (some apps might have issues with opening files that " 
                 "contain more than one track) - use one of the following apps instead:\n"
                 "Apple: https://apps.apple.com/de/app/gaia-gps-wander-app/id1201979492\n"
                 "Android: https://play.google.com/store/apps/details?id=menion.android.locus.pro\n"
                 "Web: https://gpx.studio/de/app#0/0/0")
    
    if desc_elem is not None:
        desc_elem.text = desc_text
    else:
        desc_elem = ET.Element('desc')
        desc_elem.text = desc_text
        # Insert after name, before author if exists
        author_elem = metadata.find('author')
        if author_elem is not None:
            # Find index of author
            author_idx = list(metadata).index(author_elem)
            metadata.insert(author_idx, desc_elem)
        else:
            metadata.append(desc_elem)
        desc_elem.tail = '\n    '
    
    print(f"    Metadata updated: name='{filename_without_ext}'")
    
    # Find all tracks
    tracks = root.findall('.//trk')
    print(f"  Found {len(tracks)} tracks")
    
    # Update each track and its segments
    for track_idx, track in enumerate(tracks):
        segment_name = f"Segment {track_idx + 1}"
        
        # Set track name
        # Remove existing track name if present
        track_name = track.find('name')
        if track_name is not None:
            track.remove(track_name)
        
        # Create new track name
        track_name = ET.Element('name')
        track_name.text = segment_name
        track.insert(0, track_name)
        track_name.tail = '\n    '
        
        # Find all track segments within this track
        trksegs = track.findall('trkseg')
        print(f"    Track {track_idx + 1} has {len(trksegs)} segment(s)")
        
        # Update each segment within the track
        for trkseg in trksegs:
            # Calculate statistics
            stats = calculate_segment_stats(trkseg, avg_km_per_hour, time_penalty_per_10m_elev, pause_time_per_60min)
            
            # Remove existing metadata if present (remove all occurrences)
            for name in trkseg.findall('name'):
                trkseg.remove(name)
            for desc in trkseg.findall('desc'):
                trkseg.remove(desc)
            
            # Create new metadata elements with same name as track
            name = ET.Element('name')
            name.text = segment_name
            
            desc = ET.Element('desc')
            desc.text = (f"distance: {stats['distance']:.1f}km, "
                        f"elevation_gain: {int(stats['elevation_gain'])}m, "
                        f"elevation_loss: {int(stats['elevation_loss'])}m, "
                        f"est_duration_moving: {stats['est_duration_moving']}, "
                        f"est_duration_incl_pauses: {stats['est_duration_incl_pauses']}, "
                        f"avg_km_per_hour: {stats['avg_km_per_hour']:.1f}, "
                        f"avg_km_hr_moving: {stats['avg_km_hr_moving']:.1f}")
            
            # Insert at the beginning of trkseg
            trkseg.insert(0, name)
            trkseg.insert(1, desc)
            
            # Add proper formatting
            name.tail = '\n      '
            desc.tail = '\n      '
            
            print(f"      {segment_name}: {stats['distance']}km, +{stats['elevation_gain']}m/-{stats['elevation_loss']}m, ~{stats['est_duration_moving']} (moving) / ~{stats['est_duration_incl_pauses']} (total)")
    
    # Apply GPX 1.1 default namespace so output is valid GPX 1.1 (xmlns="...") for parsers
    print("  Applying GPX 1.1 namespaces for output...")
    apply_gpx11_namespaces_for_write(root)
    
    # Write back to file
    tree.write(gpx_file, encoding='utf-8', xml_declaration=True)
    print(f"  Updated {len(tracks)} tracks with calculated statistics")

def main(avg_km_per_hour: float = 15.0, time_penalty_per_10m_elev: float = 1.0, pause_time_per_60min: float = 5.0):
    """
    Main function to process all GPX files in the current directory.
    
    Args:
        avg_km_per_hour: Average speed in km/h for duration calculation (default: 15.0)
        time_penalty_per_10m_elev: Time penalty in minutes per 10m elevation gain (default: 1.0)
        pause_time_per_60min: Pause time in minutes per 60 minutes of riding (default: 5.0)
    """
    print("GPX Statistics Calculator")
    print("=" * 50)
    
    # Load configuration from config.js
    config = load_config_from_js()
    avg_km_per_hour = config['avgSpeed']
    time_penalty_per_10m_elev = config['elevationPenalty']
    pause_time_per_60min = config['pauseTimePer60min']
    
    # Find all GPX files in tracks directory
    gps_dir = 'tracks'
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
            update_gpx_metadata(filepath, avg_km_per_hour, time_penalty_per_10m_elev, pause_time_per_60min)
        except Exception as e:
            print(f"  Error processing {gpx_file}: {e}")
        print()
    
    print("Done! All GPX files updated with calculated statistics and cleaned.")
    print("\nStatistics calculated:")
    print("- Distance: Total track distance in kilometers")
    print("- Elevation gain/loss: Total elevation change in meters")
    print(f"- Duration: Estimated time based on {avg_km_per_hour} km/h + elevation penalty + pause time (HH:MM format)")
    print(f"  ({time_penalty_per_10m_elev} minute penalty per 10m elevation gain)")
    print(f"  ({pause_time_per_60min} minute pause time per 60 minutes of riding)")
    print("\nGPX files cleaned:")
    print("- Removed extensions and unnecessary XML tags")
    print("- Kept only essential GPX elements (trkpt, lat, lon, ele, name, desc, trkseg, trk)")
    print("- Removed namespace attributes and extension attributes")

if __name__ == "__main__":
    main()
