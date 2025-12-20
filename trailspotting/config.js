/*
 * Trailspotting Configuration File
 * Edit these values to customize the application
 */

/*
 * ==================
 * STATIONS CONFIGURATION
 * ==================
 */
const STATIONS_CONFIG = {
	'Innsbruck Sillpark': {
		iframeUrl: 'https://timeview.vvt.at/#4F9D9CE5-A2E0-4ED2-BC40A88C63075217'
	},
	'Innsbruck BHF': {
		iframeUrl: 'https://timeview.vvt.at/#FD637831-93EA-4DD7-BB75DD34A82DF0D2'
	},
	'Innsbruck Marktplatz': {
		iframeUrl: 'https://timeview.vvt.at/#AEA613A7-DCEC-495E-8A06E4762239436C'
	},
	'Innsbruck SOS-Kinderorf': {
		iframeUrl: 'https://timeview.vvt.at/#9E7E563D-5BB9-49EE-A9D52C5A747B1EF7'
	},
	'Hall BHF': {
		iframeUrl: 'https://timeview.vvt.at/#F81F57B8-E49E-4A37-86037AE366123492'
	},
	'Schwaz BHF': {
		iframeUrl: 'https://timeview.vvt.at/#75AB8984-F0F6-469B-9C619AF32864216B'
	},
	'Schwaz Terminal': {
		iframeUrl: 'https://timeview.vvt.at/#542EDD76-647C-432D-AEAEF44D2900B096'
	},
	'Brixlegg BHF': {
		iframeUrl: 'https://timeview.vvt.at/#0CDB1A43-FAD5-422D-94F7184A3B32DBE7'
	},
	'Terfens/Weer BHF': {
		iframeUrl: 'https://timeview.vvt.at/#FAEA6F93-159F-4D19-9D1ECBB979509660'
	},
	'Völs BHF': {
		iframeUrl: 'https://timeview.vvt.at/#87531436-9B3A-4C1F-8B792A7848D01826'
	},
	'Zirl BHF': {
		iframeUrl: 'https://timeview.vvt.at/#D8AF7C04-B80D-4F7F-AA90817FDE9C192D'
	},
	'Telfs BHF': {
		iframeUrl: 'https://timeview.vvt.at/#F1E103A3-7259-4721-B36726EF8523F024'
	},
	'Mötz BHF': {
		iframeUrl: 'https://timeview.vvt.at/#411012F1-BBBF-437D-A4A0484EBB6BFD82'
	},
	'Ötztal BHF': {
		iframeUrl: 'https://timeview.vvt.at/#9E7E563D-5BB9-49EE-A9D52C5A747B1EF7'
	},
	'Haiming BHF': {
		iframeUrl: 'https://timeview.vvt.at/#FDD5C5EC-A1A4-42D7-8F2F0A43C169D4FD'
	},
	'Fritzens/Wattens': {
		iframeUrl: 'https://timeview.vvt.at/#6ECB3026-EB71-4CF7-A9A7E75347C30C40'
	},
	'Rum BHF': {
		iframeUrl: 'https://timeview.vvt.at/#1DB9D318-6C51-4337-83043F57DD976718'
	},
	'Jenbach BHF': {
		iframeUrl: 'https://timeview.vvt.at/#B396AD85-AE18-4CE7-8657CAF7FFB7B8C7'
	},
	'Jenbach Schalserstraße/M-Preis': {
		iframeUrl: ''
	},
	'Kematen BHF': {
		iframeUrl: 'https://timeview.vvt.at/#2B49C93A-AACD-4F27-9A5181FA8C8115827'
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
	activeRoutes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
	
	/*
	 * Route-specific overrides
	 */
	routeOverrides: {
		'B': { minZoom: 9 } /* Example: Route B has different minZoom */
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
			'Hall BHF',
			'Terfens/Weer BHF'
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
			'Hall BHF',
			'Brixlegg BHF',
			'Terfens/Weer BHF'
		]
	},
	'C': {
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Walderbrücke', to: 'Hall'}
		],
		stations: [
			'Innsbruck Sillpark',
			'Hall BHF'
		]
	},
	'D': {
		segments: [
			{from: 'Reith', to: 'Völs'}
		],
		stations: [
			'Innsbruck BHF',
			'Völs BHF'
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
			'Zirl BHF'
		]
	},
	'G': {
		segments: [
			{from: 'Mötz', to: 'Telfs BHF'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs BHF'
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
			'Hall BHF',
			'Fritzens/Wattens'
		]
	},
	'J': {
		segments: [
			{from: 'Hungerburg', to: 'Neu-Rum'}
		],
		stations: [
			'Innsbruck Marktplatz',
			'Rum BHF'
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
			{from: 'Mötz', to: 'Telfs BHF'},
			{from: 'Buchener Höhe', to: 'Telfs BHF'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs BHF'
		]
	},
	'M': {
		segments: [
			{from: 'Schwaz', to: 'Jenbach'},
			{from: 'Maurach', to: 'Jenbach'}
		],
		stations: [
			'Innsbruck BHF',
			'Jenbach Schalserstraße/M-Preis',
			'Jenbach BHF'
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
	maptilerKey: 'luZxg9l38dVBSQGjrelS',
	mapSource: `https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=luZxg9l38dVBSQGjrelS`,
	mapAttribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
	
	/*
	 * Default map settings
	 */
	defaultMinZoom: 9,
	defaultMaxZoom: 17,
	defaultMaxNativeZoom: 17,
	defaultBoundsPadding: 0.3,
	
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