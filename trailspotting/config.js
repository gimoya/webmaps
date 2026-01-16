/*
 * Trailspotting Configuration File
 * Edit these values to customize the application
 */

/*
 * ==================
 * ROUTE SELECTION CONFIGURATION
 * ==================
 */

/*
 * Active routes - controls which routes are displayed in the application
 * Remove routes from this array to hide them, or add new ones to show them
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

/*
 * ==================
 * ROUTE CONFIGURATION
 * ==================
 * Defines segments and stations for each route
 * Keyed by route letters (A-Z), with filename included in each route config
 */
const ROUTE_CONFIG = {
	'A': {
		filename: 'Hu_NR__Trailspotting.gpx',
		segments: [
			{from: 'Hungerburg', to: 'Neu-Rum'}
		],
		stations: [
			'Innsbruck Marktplatz',
			'Rum BHF'
		]
	}
	,
	'B': {
		filename: 'Al_Id_Si_Im__Trailspotting.gpx',
		segments: [
			{from: 'Aldrans', to: 'Innsbruck-DEZ'},
			{from: 'Sistrans', to: 'Innsbruck-Mitte'}
		],
		stations: [
			'Innsbruck Tivoli',
			'Innsbruck SOS-Kinderorf'
		]
	}
	,
	'C': {
		filename: 'Al_Ha_Wa_Ha__Trailspotting.gpx',
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Walderbrücke', to: 'Hall'}
		],
		stations: [
			'Innsbruck Tivoli',
			'Hall BHF'
		]
	}
	,
	'D': {
		filename: 'Al_Ha_Wa_Fr__Trailspotting.gpx',
		segments: [
			{from: 'Aldrans/Fagslung', to: 'Hall'},
			{from: 'Walderbrücke', to: 'Fritzens'}
		],
		stations: [
			'Innsbruck Tivoli',
			'Hall BHF',
			'Volders-Baumkirchen'
		]
	}
	,
	'E': {
		filename: 'Re_Voe__Trailspotting.gpx',
		segments: [
			{from: 'Reith', to: 'Völs'}
		],
		stations: [
			'Innsbruck BHF',
			'Völs BHF'
		]
	}
	,
	'F': {
		filename: 'Re_In__Trailspotting.gpx',
		segments: [
			{from: 'Reith', to: 'Innsbruck'}
		],
		stations: [
			'Innsbruck BHF'
		]
	}
	,
	'G': {
		filename: 'Re_Ob_Kr_Voe__Trailspotting.gpx',
		segments: [
			{from: 'Reith', to: 'Unterperfuss'},
			{from: 'Oberperfuss', to: 'Völs'}
		],
		stations: [
			'Innsbruck BHF',
			'Unterperfuss Mühlbrückl'
		]
	}
	,
	'H': {
		filename: 'Moe_Te__Trailspotting.gpx',
		segments: [
			{from: 'Mötz', to: 'Telfs BHF'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs BHF'
		]
	}
	,
	'I': {
		filename: 'Moe_Te_BH_Te__Trailspotting.gpx',
		segments: [
			{from: 'Mötz', to: 'Telfs Sagl/M-Preis'},
			{from: 'Buchener Höhe', to: 'Telfs BHF'}
		],
		stations: [
			'Innsbruck BHF',
			'Telfs Sagl/M-Preis',
			'Telfs BHF'
		]
	}
	,
	'J': {
		filename: 'Oe_Oe__Trailspotting.gpx',
		segments: [
			{from: 'Ötztal Bhf.', to: 'Ötztal Bhf.'}
		],
		stations: [
			'Innsbruck BHF',
			'Ötztal BHF'
		]
	}
	,
	'K': {
		filename: 'Al_Ha_Sc_Te__Trailspotting.gpx',
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Schwaz', to: 'Terfens/Weer'}
		],
		stations: [
			'Innsbruck Tivoli',
			'Hall BHF',
			'Terfens/Weer BHF'
		]
	}
	,
	'L': {
		filename: 'Sc_Je_Ma_Je__Trailspotting.gpx',
		segments: [
			{from: 'Schwaz', to: 'Jenbach'},
			{from: 'Maurach', to: 'Jenbach'}
		],
		stations: [
			'Innsbruck BHF',
			'Jenbach Schalserstraße',
			'Jenbach BHF'
		]
	}
	,
	'M': {
		filename: 'Al_Ha_Mue_Br_Sc_Te__Trailspotting.gpx',
		segments: [
			{from: 'Aldrans', to: 'Hall'},
			{from: 'Münster/Wiesing', to: 'Brixlegg'},
			{from: 'Schwaz', to: 'Terfens/Weer'}
		],
		stations: [
			'Innsbruck Tivoli',
			'Hall BHF',
			'Brixlegg BHF',
			'Terfens/Weer BHF'
		]
	}
};

/*
 * ==================
 * STATIONS CONFIGURATION
 * ==================
 */
const STATIONS_CONFIG = {
	'Innsbruck Tivoli': {
		iframeUrl: 'https://timeview.vvt.at/#6B0A24A2-795B-4424-A18132119E04ABE7'
	},
	'Innsbruck BHF': {
		iframeUrl: 'https://timeview.vvt.at/#FD637831-93EA-4DD7-BB75DD34A82DF0D2'
	},
	'Innsbruck Marktplatz': {
		iframeUrl: 'https://timeview.vvt.at/#32A3FD1B-6456-41E5-950874B80FBC59EE'
	},
	'Innsbruck SOS-Kinderorf': {
		iframeUrl: 'https://timeview.vvt.at/#C4F5763C-8BE2-41F6-AC350DDED00520CD'
	},
	'Hall BHF': {
		iframeUrl: 'https://timeview.vvt.at/#F81F57B8-E49E-4A37-86037AE366123492'
	},
	'Volders-Baumkirchen': {
		iframeUrl: 'https://timeview.vvt.at/#CE6D5151-F745-428F-A8EB978E41688989'
	},
	'Schwaz BHF': {
		iframeUrl: 'https://timeview.vvt.at/#75AB8984-F0F6-469B-9C619AF32864216B'
	},
	'Schwaz Terminal': {
		iframeUrl: 'https://timeview.vvt.at/#32F32425-BB82-4D90-A6029A11C5AEA1F1'
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
		iframeUrl: 'https://timeview.vvt.at/#2A43DEAC-CD7A-47AF-80FC5D20AA370F2D'
	},
	'Telfs Sagl/M-Preis': {
		iframeUrl: 'https://timeview.vvt.at/#CB03384A-4008-4E10-BD2C8E123280EB3F'
	},
	'Telfs BHF': {
		iframeUrl: 'https://timeview.vvt.at/#088DF7AE-2E94-4A92-8C2A87FE1CB0B606'
	},
	'Mötz BHF': {
		iframeUrl: 'https://timeview.vvt.at/#411012F1-BBBF-437D-A4A0484EBB6BFD82'
	},
	'Ötztal BHF': {
		iframeUrl: 'https://timeview.vvt.at/#FBD2EDA0-8232-4C8D-8F7038E55EA1C5C5'
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
		iframeUrl: 'https://timeview.vvt.at/#54346321-DF15-4DDF-B4B9F5A6DED9EF33'
	},
	'Jenbach Schalserstraße': {
		iframeUrl: 'https://timeview.vvt.at/#591B7C3F-9327-482D-A7D2E97D14C67FE4'
	},
	'Kematen BHF': {
		iframeUrl: 'https://timeview.vvt.at/#2B49C93A-AACD-4F27-9A5181FA8C8115827'
	},
	'Unterperfuss Mühlbrückl': {
		iframeUrl: 'https://timeview.vvt.at/#0A78D0FC-01B6-4E31-8115E176C6AA812F'
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
	 * File naming pattern (legacy - kept for backward compatibility)
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
	avgSpeed: 17,
	
	/*
	 * Time penalty in minutes per 10m elevation gain
	 */
	elevationPenalty: 0.85,
	
	/*
	 * Pause time in minutes per 60 minutes of riding
	 */
	pauseTimePer60min: 10
};