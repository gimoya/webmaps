# Trailspotting Maintenance Guide

This guide explains how to add new GPX routes to the Trailspotting web application.

## Adding a New GPX Route

### Step 1: Add GPX File
1. Place your new GPX file in the `tracks/` directory
2. Follow the naming convention: `[RouteLetter]__Trailspotting.gpx`
   - Example: `H__Trailspotting.gpx`

### Step 2: Calculate Statistics
Run the Python script to calculate route statistics:
```bash
python calculate_gpx_stats.py
```
This will update the GPX file with distance, elevation, and estimated duration. The script also:
- Removes unnecessary XML extensions and tags
- Strips namespace prefixes for compatibility
- Keeps only essential GPX elements (trkpt, lat, lon, ele, name, desc, trkseg, trk)

### Step 3: Update Configuration
In `config.js`, make these two updates:

**A) Add route to activeRoutes:**
```javascript
const ROUTE_CONFIG = {
    // Active routes (add new routes here)
    activeRoutes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],  // Add 'H' here
    
    // Route-specific overrides
    routeOverrides: {
        'B': { minZoom: 9 }  // Example: Route B has different minZoom
    }
};
```

**B) Add station names:**
```javascript
const STATION_NAMES = {
    'A': [
        {from: 'Aldrans', to: 'Hall'},
        {from: 'Schwaz', to: 'Terfens/Weer'}
    ],
    'B': [
        {from: 'Igls', to: 'Hall'},
        {from: 'Münster/Wiesin', to: 'Brixlegg'},
        {from: 'Schwaz', to: 'Terfens/Weer'}
    ],
    'C': [
        {from: 'Igls', to: 'Hall'},
        {from: 'Walderbrücke', to: 'Hall'}
    ],
    'D': [
        {from: 'Reith', to: 'Völs'}
    ],
    'E': [
        {from: 'Reith', to: 'Innsbruck'}
    ],
    'F': [
        {from: 'Reith', to: 'Zirl'}
    ],
    'G': [
        {from: 'Mötz', to: 'Telfs'}
    ],
    // Add new route here
    'H': [
        {from: 'StartStation', to: 'EndStation'},
        {from: 'AnotherStart', to: 'AnotherEnd'}
    ]
};
```

### Step 4: Add HTML Map Container
In `index.html`, add the map container manually where you want it:
```html
<div class="floating-box">
    <div class="themap" id="map_H">
        <div id="map-title">H</div>
    </div>
    <div id="cycling-info-H">
        <!-- Cycling segments will be populated by JavaScript -->
    </div>
</div>
```

**That's it!** The application will automatically:
- Load cycling segments for the new route
- Create the map with proper styling
- Add GPX download link to the scrolling list
- Handle all the JavaScript processing

No manual JavaScript calls needed anymore!

## Modifying Existing Routes

### If GPX Content Changed
1. Replace the GPX file in `tracks/` directory
2. Run: `python calculate_gpx_stats.py`
3. No other changes needed

### If Station Names Changed
1. Update the `STATION_NAMES` object in `config.js`
2. No other changes needed

## Configuration File

All configuration is now centralized in `config.js` for easy editing:

### Statistics Configuration
```javascript
const STATS_CONFIG = {
    // Average cycling speed in km/h
    avgSpeed: 20.0,
    
    // Time penalty in minutes per 10m elevation gain
    elevationPenalty: 2.0,
    
    // Pause time in minutes per 60 minutes of riding
    pauseTimePer60min: 10.0
};
```

### Map Configuration
```javascript
const MAP_CONFIG = {
    // Default map settings
    defaultMinZoom: 9,
    defaultMaxZoom: 17,
    defaultBoundsPadding: 0.1,
    
    // Track styling
    trackColors: {
        background: 'orange',
        foreground: 'green',
        backgroundOpacity: 0.8,
        foregroundOpacity: 0.9,
        backgroundWeight: 6.0,
        foregroundWeight: 3.0
    },
    
    // Marker styling
    markerSize: 22
};
```

### Route Configuration
```javascript
const ROUTE_CONFIG = {
    activeRoutes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    
    // Route-specific overrides
    routeOverrides: {
        'B': { minZoom: 9 },  // Route B has different minZoom
        'C': { boundsPadding: 0.15 }  // Route C has more padding
    }
};
```

### Station Names
```javascript
const STATION_NAMES = {
    'A': [
        {from: 'Aldrans', to: 'Hall'},
        {from: 'Schwaz', to: 'Terfens/Weer'}
    ],
    // ... other routes
};
```

## File Structure

```
trailspotting/
├── index.html              # Main HTML file
├── script.js              # JavaScript application logic
├── config.js              # Configuration constants
├── styles.css             # CSS styling
├── calculate_gpx_stats.py # Python script for GPX processing
├── MAINTENANCE.md         # This file
└── tracks/                # GPX files directory
    ├── A__Trailspotting.gpx
    ├── B__Trailspotting.gpx
    ├── C__Trailspotting.gpx
    ├── D__Trailspotting.gpx
    ├── E__Trailspotting.gpx
    ├── F__Trailspotting.gpx
    └── G__Trailspotting.gpx
```

## Current Routes

- **Route A**: Aldrans → Hall, Schwaz → Terfens/Weer
- **Route B**: Igls → Hall, Münster/Wiesin → Brixlegg, Schwaz → Terfens/Weer
- **Route C**: Igls → Hall, Walderbrücke → Hall
- **Route D**: Reith → Völs
- **Route E**: Reith → Innsbruck
- **Route F**: Reith → Zirl
- **Route G**: Mötz → Telfs

## Key Features

- **Dynamic Route Loading**: Routes are loaded automatically based on `activeRoutes` array
- **Automatic GPX Downloads**: Download links are generated automatically
- **Centralized Configuration**: All settings in one place at the top of `script.js`
- **Route-Specific Overrides**: Custom settings for individual routes
- **Statistics Calculation**: Python script processes GPX files and calculates timing
- **Namespace Handling**: Automatically strips GPX namespaces for compatibility
- **Map Styling**: Configurable track colors, marker sizes, and zoom levels