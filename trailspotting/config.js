/*
 * Trailspotting Configuration File
 * Edit these values to customize the application
 */

/*
 * ==================
 * ROUTE START/END CONFIGURATION
 * ==================
 */

const ROUTE_CONFIG = {
	'A': {
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Schwaz', to: 'Terfens/Weer'}
		],
		stations: [
			'Innsbruck',
			'Hall',
			'Terfens/Weer'
		]
	},
	'B': {
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Münster/Wiesing', to: 'Brixlegg'},
			{from: 'Schwaz', to: 'Terfens/Weer'}
		],
		stations: [
			'Innsbruck',
			'Hall',
			'Brixlegg',
			'Terfens/Weer'
		]
	},
	'C': {
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Walderbrücke', to: 'Hall'}
		],
		stations: [
			'Hall'
		]
	},
	'D': {
		segments: [
			{from: 'Reith', to: 'Völs'}
		],
		stations: [
			'Innsbruck',
			'Völs'
		]
	},
	'E': {
		segments: [
			{from: 'Reith', to: 'Innsbruck'}
		],
		stations: [
			'Innsbruck'
		]
	},
	'F': {
		segments: [
			{from: 'Reith', to: 'Zirl'}
		],
		stations: [
			'Innsbruck',
			'Zirl'
		]
	},
	'G': {
		segments: [
			{from: 'Mötz', to: 'Telfs'}
		],
		stations: [
			'Innsbruck',
			'Telfs'
		]
	}
};

/*
 * ==================
 * ROUTE CONFIGURATION
 * ==================
 */

const APP_CONFIG = {
	/*
	 * Active routes (add new routes here)
	 */
	activeRoutes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
	
	/*
	 * Route-specific overrides
	 */
	routeOverrides: {
		'B': { minZoom: 9 }  /* Example: Route B has different minZoom */
	}
};

/*
 * ==================
 * MAP CONFIGURATION
 * ==================
 */

const MAP_CONFIG = {
	/*
	 * Tile source and attribution
	 */
	mapSource: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
	mapAttribution: 'Map data &copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
	
	/*
	 * Default map settings
	 */
	defaultMinZoom: 9,
	defaultMaxZoom: 17,
	defaultMaxNativeZoom: 17,
	defaultBoundsPadding: 0.1,
	
	/*
	 * Track styling
	 */
	trackColors: {
		background: 'orange',
		foreground: 'green',
		backgroundOpacity: 0.8,
		foregroundOpacity: 0.9,
		backgroundWeight: 6.0,
		foregroundWeight: 3.0
	},
	
	/*
	 * Marker styling
	 */
	markerSize: 22,
	markerColors: {
		start: 'green',
		end: 'red'
	}
};

/*
 * ==================
 * GPX CONFIGURATION
 * ==================
 */

const GPX_CONFIG = {
	/*
	 * Animation settings
	 */
	scrollDuration: 8,  /* seconds per cycle */
	containerHeight: 100, /* pixels */
	
	/*
	 * File naming pattern
	 */
	filePattern: '__Trailspotting.gpx',
	tracksDirectory: 'tracks/'
};

/*
 * ==================
 * STATISTICS CONFIGURATION
 * ==================
 */

const STATS_CONFIG = {
	/*
	 * Average cycling speed in km/h
	 */
	avgSpeed: 22.0,
	
	/*
	 * Time penalty in minutes per 10m elevation gain
	 */
	elevationPenalty: 1.1,
	
	/*
	 * Pause time in minutes per 60 minutes of riding
	 */
	pauseTimePer60min: 5.0
};