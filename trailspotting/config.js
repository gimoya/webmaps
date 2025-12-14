/*
 * Trailspotting Configuration File
 * Edit these values to customize the application
 */

/*
 * ==================
 * ROUTE START/END CONFIGURATION
 * ==================
 */
/*
 * ==================
 * ROUTE CONFIGURATION
 * ==================
 */

const APP_CONFIG = {
	/*
	 * Active routes (add new routes here)
	 */
	activeRoutes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
	
	/*
	 * Route-specific overrides
	 */
	routeOverrides: {
		'B': { minZoom: 9 }  /* Example: Route B has different minZoom */
	}
};

const ROUTE_CONFIG = {
	'A': {
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Schwaz', to: 'Terfens/Weer'}
		],
		stations: [
			'Innsbruck Sillpark',
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
			'Innsbruck Sillpark',
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
			'Innsbruck Sillpark',
			'Hall'
		]
	},
	'D': {
		segments: [
			{from: 'Reith', to: 'Völs'}
		],
		stations: [
			'Innsbruck BHF',
			'Völs'
		]
	},
	'E': {
		segments: [
			{from: 'Reith', to: 'Innsbruck'}
		],
		stations: [
			'Innsbruck BHF'
		]
	},
	'F': {
		segments: [
			{from: 'Reith', to: 'Zirl'}
		],
		stations: [
			'Innsbruck BHF',
			'Zirl'
		]
	},
	'G': {
		segments: [
			{from: 'Mötz', to: 'Telfs'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs'
		]
	},
	'H': {
		segments: [
			{from: 'Ötztal Bhf.', to: 'Ötztal Bhf.'}
		],
		stations: [
			'Innsbruck BHF',
			'Ötztal BHF'
		]
	},
	'I': {
		segments: [
			{from: 'Aldrans/Fagslung', to: 'Hall'},
			{from: 'Gnadenwald', to: 'Fritzens/Wattens'}
		],
		stations: [
			'Innsbruck Sillpark',
			'Hall',
			'Fritzens/Wattens'
		]
	},
	'J': {
		segments: [
			{from: 'Hungerburg', to: 'Neu-Rum'}
		],
		stations: [
			'Innsbruck Marktplatz',
			'Neu-Rum'
		]
	},
	'K': {
		segments: [
			{from: 'Aldrans', to: 'Innsbruck-DEZ'},
			{from: 'Sistrans', to: 'Innsbruck-Mitte'}
		],
		stations: [
			'Innsbruck Sillpark',
			'Innsbruck SOS-Kinderorf'
		]
	},
	'L': {
		segments: [
			{from: 'Mötz', to: 'Telfs'},
			{from: 'Buchener Höhe', to: 'Telfs BHF'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs Sagl M-Preis',
			'Telfs BHF'
		]
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
	markerSize: 20,
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
	pauseTimePer60min: 10.0
};