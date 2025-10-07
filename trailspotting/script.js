// Trailspotting Map Application JavaScript
// External JavaScript file for GPX loading and cycling segment display

const mapSource = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const mapAttribution = 'Map data &copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

// Store GPX metadata for each route
const gpxMetadata = {};

// Original station names from CSV (for display purposes)
const stationNames = {
	'A': [
		{from: 'Igls', to: 'Hall'},
		{from: 'Schwaz', to: 'Terfens/Wiesing'}
	],
	'B': [
		{from: 'Igls', to: 'Hall'},
		{from: 'Münster/W', to: 'Brixlegg'},
		{from: 'Schwaz', to: 'Terfens/Weer'}
	],
	'C': [
		{from: 'Igls', to: 'Hall'},
		{from: 'Walderbrücke', to: 'Hall'}
	],
	'D': [
		{from: 'Reith', to: 'Völs'}
	]
};

// Function to load cycling segments and return a Promise
function loadCyclingSegments(route, containerId, gpxFile) {
	return new Promise((resolve, reject) => {
		const container = document.getElementById(containerId);
		if (!container) {
			reject(new Error(`Container ${containerId} not found!`));
			return;
		}
		
		// Check if we already have metadata for this route
		if (gpxMetadata[route]) {
			renderCyclingSegments(route, containerId);
			resolve();
			return;
		}
		
		// Fetch GPX file and extract metadata
		fetch(gpxFile)
			.then(response => response.text())
			.then(gpxText => {
				const parser = new DOMParser();
				const gpxDoc = parser.parseFromString(gpxText, 'text/xml');
				const trksegs = gpxDoc.querySelectorAll('trkseg');
				
				const segments = [];
				trksegs.forEach((trkseg, index) => {
					const name = trkseg.querySelector('name');
					const desc = trkseg.querySelector('desc');
					
					if (desc) {
						const descText = desc.textContent;
						const distanceMatch = descText.match(/distance: ([\d.]+)km/);
						const gainMatch = descText.match(/elevation_gain: ([\d.]+)m/);
						const lossMatch = descText.match(/elevation_loss: ([\d.]+)m/);
						const durationMatch = descText.match(/estimated_duration: ([\d:]+)/);
						
						segments.push({
							segment: index + 1,
							distance: distanceMatch ? distanceMatch[1] + 'km' : 'N/A',
							elevation_gain: gainMatch ? gainMatch[1] + 'm' : 'N/A',
							elevation_loss: lossMatch ? lossMatch[1] + 'm' : 'N/A',
							duration: durationMatch ? durationMatch[1] : 'N/A'
						});
					}
				});
				
				// Store metadata for this route
				gpxMetadata[route] = segments;
				
				// Render the segments
				renderCyclingSegments(route, containerId);
				resolve();
			})
			.catch(error => {
				container.innerHTML = `<div class="cycling-info"><div class="segment-title">Route ${route} - Error loading data</div></div>`;
				reject(error);
			});
	});
}

// Function to extract metadata from GPX and display cycling segments
function displayCyclingSegmentsFromGPX(route, containerId, gpxFile) {
	const container = document.getElementById(containerId);
	if (!container) {
		return;
	}
	
	// Check if we already have metadata for this route
	if (gpxMetadata[route]) {
		renderCyclingSegments(route, containerId);
		return;
	}
	
	// Fetch GPX file and extract metadata
	fetch(gpxFile)
		.then(response => response.text())
		.then(gpxText => {
			const parser = new DOMParser();
			const gpxDoc = parser.parseFromString(gpxText, 'text/xml');
			const trksegs = gpxDoc.querySelectorAll('trkseg');
			
			const segments = [];
			trksegs.forEach((trkseg, index) => {
				const name = trkseg.querySelector('name');
				const desc = trkseg.querySelector('desc');
				
				if (desc) {
					const descText = desc.textContent;
					const distanceMatch = descText.match(/distance: ([\d.]+)km/);
					const gainMatch = descText.match(/elevation_gain: ([\d.]+)m/);
					const lossMatch = descText.match(/elevation_loss: ([\d.]+)m/);
					const durationMatch = descText.match(/estimated_duration: ([\d:]+)/);
					
					segments.push({
						segment: index + 1,
						distance: distanceMatch ? distanceMatch[1] + 'km' : 'N/A',
						elevation_gain: gainMatch ? gainMatch[1] + 'm' : 'N/A',
						elevation_loss: lossMatch ? lossMatch[1] + 'm' : 'N/A',
						duration: durationMatch ? durationMatch[1] : 'N/A'
					});
				}
			});
			
			// Store metadata for this route
			gpxMetadata[route] = segments;
			
			// Render the segments
			renderCyclingSegments(route, containerId);
		})
		.catch(error => {
			container.innerHTML = `<div class="cycling-info"><div class="segment-title">Route ${route} - Error loading data</div></div>`;
		});
}

// Function to render cycling segments from stored metadata
function renderCyclingSegments(route, containerId) {
	const segments = gpxMetadata[route];
	const container = document.getElementById(containerId);
	
	if (!container) {
		return;
	}
	
	if (!segments || segments.length === 0) {
		container.innerHTML = `<div class="cycling-info"><div class="segment-title">Route ${route} - No segments found</div></div>`;
		return;
	}
	
	let html = `<div class="cycling-info">`;
	html += `<div class="segment-title">Route ${route} - Cycling Segments</div>`;
	
	segments.forEach(seg => {
		const stationInfo = stationNames[route] && stationNames[route][seg.segment - 1];
		const stationText = stationInfo ? `: ${stationInfo.from} → ${stationInfo.to}` : '';
		
		html += `<div class="segment-details">`;
		html += `<strong>Segment ${seg.segment}${stationText}</strong><br>`;
		html += `📈 +${seg.elevation_gain} / -${seg.elevation_loss} | 📏 ${seg.distance} | ⏱️ ${seg.duration}`;
		html += `</div>`;
	});
	
	html += `</div>`;
	container.innerHTML = html;
}

// Reusable function to create a map with GPX files
function createMapWithGPX(mapId, gpxFiles, options = {}) {
	// Default options
	const defaults = {
		minZoom: 10,
		maxZoom: 17,
		maxNativeZoom: 17,
		lineColor: 'green',
		lineOpacity: 0.9,
		lineWeight: 4.5,
		lineCap: 'round',
		boundsPadding: 10
	};
	
	// Merge user options with defaults
	const config = { ...defaults, ...options };
	
	// Create the map
	const map = L.map(mapId);
	
	
	// Add tile layer
	L.tileLayer(mapSource, {
		attribution: mapAttribution,
		minZoom: config.minZoom,
		maxZoom: config.maxZoom,
		maxNativeZoom: config.maxNativeZoom
	}).addTo(map);

	// Ensure gpxFiles is an array
	const files = Array.isArray(gpxFiles) ? gpxFiles : [gpxFiles];
	
	// Track loaded GPX files to fit bounds after all are loaded
	let loadedCount = 0;
	const totalFiles = files.length;
	let allBounds = [];

	// Add each GPX file
	files.forEach(gpxFile => {
		// Add thicker orange line underneath
		new L.GPX(gpxFile, {
			async: true,
			polyline_options: {
				color: 'orange',
				opacity: 0.8,
				weight: 6.0,
				lineCap: 'round'
			},
			marker_options: {
				startIconUrl: null,
				endIconUrl: null,
				shadowUrl: null
			}
		}).on('loaded', function(e) {
			// Add thinner green line on top
			new L.GPX(gpxFile, {
				async: true,
				polyline_options: {
					color: 'green',
					opacity: 0.9,
					weight: 3.0,
					lineCap: 'round'
				},
				marker_options: {
					startIconUrl: null,
					endIconUrl: null,
					shadowUrl: null
				}
			}).addTo(map);
		}).addTo(map);
		
		// Add original GPX for marker functionality (transparent line)
		new L.GPX(gpxFile, {
			async: true,
			polyline_options: {
				color: 'transparent',
				opacity: 0,
				weight: 0,
				lineCap: 'round'
			},
			marker_options: {
				startIconUrl: null,
				endIconUrl: null,
				shadowUrl: null
			}
		}).on('loaded', function(e) {
			loadedCount++;
			allBounds.push(e.target.getBounds());
			
			// Count segments and their start/end points
			const gpxData = e.target;
			
			// Get the raw GPX data to analyze segments
			let totalStartPoints = 0;
			let totalEndPoints = 0;
			let totalPoints = 0;
			let totalSegments = 0;
			let pointCounter = 1;
			
			// Access the GPX data through _layers
			if (gpxData._layers) {
				console.log('GPX layers found:', Object.keys(gpxData._layers));
				
				// Iterate through all layers
				Object.values(gpxData._layers).forEach((layer, layerIndex) => {
					console.log(`Layer ${layerIndex}:`, layer);
					
					// Check if this layer has nested _layers (LayerGroup)
					if (layer._layers) {
						console.log(`Layer ${layerIndex} has nested layers:`, Object.keys(layer._layers));
						
						// Iterate through nested layers
						Object.values(layer._layers).forEach((nestedLayer, nestedIndex) => {
							console.log(`Nested layer ${nestedIndex}:`, nestedLayer);
							
							// Try to get latlngs from nested layer
							if (nestedLayer._latlngs) {
								const latlngs = nestedLayer._latlngs;
								console.log(`Nested layer ${nestedIndex} latlngs:`, latlngs.length, 'points');
								
								// Check if it's a flat array of points (single segment)
								if (Array.isArray(latlngs) && latlngs.length > 0 && latlngs[0].lat !== undefined) {
									console.log('Single segment detected with', latlngs.length, 'points');
									// Single segment with many points
									totalSegments++;
									totalStartPoints++;
									totalEndPoints++;
									totalPoints += latlngs.length;
									
									// Add numbered markers for start and end points
									const startPoint = latlngs[0];
									const endPoint = latlngs[latlngs.length - 1];
									
									console.log('Adding markers for single segment:', startPoint, endPoint);
									
									// Add start point marker
									L.marker([startPoint.lat, startPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker start',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [22, 22],
											iconAnchor: [11, 11]
										})
									}).addTo(map);
									pointCounter++;
									
									// Add end point marker
									L.marker([endPoint.lat, endPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker end',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [22, 22],
											iconAnchor: [11, 11]
										})
									}).addTo(map);
									pointCounter++;
								}
								// Check if it's an array of segments
								else if (Array.isArray(latlngs)) {
									console.log('Multiple segments detected:', latlngs.length, 'segments');
									latlngs.forEach((segment, segmentIndex) => {
										if (Array.isArray(segment) && segment.length > 0) {
											console.log(`Segment ${segmentIndex}:`, segment.length, 'points');
											totalSegments++;
											totalStartPoints++;
											totalEndPoints++;
											totalPoints += segment.length;
											
											// Add numbered markers for start and end points
											const startPoint = segment[0];
											const endPoint = segment[segment.length - 1];
											
											console.log(`Adding markers for segment ${segmentIndex}:`, startPoint, endPoint);
											
											// Add start point marker
											L.marker([startPoint.lat, startPoint.lng], {
												icon: L.divIcon({
													className: 'numbered-marker start',
													html: `<div class="marker-number">${pointCounter}</div>`,
													iconSize: [22, 22],
													iconAnchor: [11, 11]
												})
											}).addTo(map);
											pointCounter++;
											
											// Add end point marker
											L.marker([endPoint.lat, endPoint.lng], {
												icon: L.divIcon({
													className: 'numbered-marker end',
													html: `<div class="marker-number">${pointCounter}</div>`,
													iconSize: [22, 22],
													iconAnchor: [11, 11]
												})
											}).addTo(map);
											pointCounter++;
										}
									});
								}
							}
						});
					}
					// Handle direct layer structure (no nested layers)
					else if (layer._latlngs) {
						console.log(`Direct layer ${layerIndex} latlngs:`, layer._latlngs.length, 'points');
						const latlngs = layer._latlngs;
						
						// Check if it's a flat array of points (single segment)
						if (Array.isArray(latlngs) && latlngs.length > 0 && latlngs[0].lat !== undefined) {
							console.log('Direct single segment detected with', latlngs.length, 'points');
							// Single segment with many points
							totalSegments++;
							totalStartPoints++;
							totalEndPoints++;
							totalPoints += latlngs.length;
							
							// Add numbered markers for start and end points
							const startPoint = latlngs[0];
							const endPoint = latlngs[latlngs.length - 1];
							
							console.log('Adding markers for direct single segment:', startPoint, endPoint);
							
							// Add start point marker
							L.marker([startPoint.lat, startPoint.lng], {
								icon: L.divIcon({
									className: 'numbered-marker start',
									html: `<div class="marker-number">${pointCounter}</div>`,
									iconSize: [22, 22],
									iconAnchor: [11, 11]
								})
							}).addTo(map);
							pointCounter++;
							
							// Add end point marker
							L.marker([endPoint.lat, endPoint.lng], {
								icon: L.divIcon({
									className: 'numbered-marker end',
									html: `<div class="marker-number">${pointCounter}</div>`,
									iconSize: [22, 22],
									iconAnchor: [11, 11]
								})
							}).addTo(map);
							pointCounter++;
						}
						// Check if it's an array of segments
						else if (Array.isArray(latlngs)) {
							console.log('Direct multiple segments detected:', latlngs.length, 'segments');
							latlngs.forEach((segment, segmentIndex) => {
								if (Array.isArray(segment) && segment.length > 0) {
									console.log(`Direct segment ${segmentIndex}:`, segment.length, 'points');
									totalSegments++;
									totalStartPoints++;
									totalEndPoints++;
									totalPoints += segment.length;
									
									// Add numbered markers for start and end points
									const startPoint = segment[0];
									const endPoint = segment[segment.length - 1];
									
									console.log(`Adding markers for direct segment ${segmentIndex}:`, startPoint, endPoint);
									
									// Add start point marker
									L.marker([startPoint.lat, startPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker start',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [22, 22],
											iconAnchor: [11, 11]
										})
									}).addTo(map);
									pointCounter++;
									
									// Add end point marker
									L.marker([endPoint.lat, endPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker end',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [22, 22],
											iconAnchor: [11, 11]
										})
									}).addTo(map);
									pointCounter++;
								}
							});
						}
					}
				});
			}
			
			console.log(`Map ${mapId} summary: ${totalSegments} segments, ${totalStartPoints} start points, ${totalEndPoints} end points, ${totalPoints} total points, ${pointCounter-1} markers added`);
			
			// When all files are loaded, fit bounds
			if (loadedCount === totalFiles) {
				// Ensure map is properly sized before setting bounds
				setTimeout(() => {
					map.invalidateSize();
					
					const combinedBounds = allBounds.reduce((acc, bounds) => {
						return acc.extend(bounds);
					}, allBounds[0]);
					
					const paddedBounds = combinedBounds.pad(config.boundsPadding);
					map.fitBounds(paddedBounds);
					map.setMaxBounds(paddedBounds);
				}, 200);
			}
		}).addTo(map);
	});
	
	return map;
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
	// Load all cycling segments first, then create maps
	const cyclingPromises = [
		loadCyclingSegments('A', 'cycling-info-A', 'gps/A__Trailspotting.gpx'),
		loadCyclingSegments('B', 'cycling-info-B', 'gps/B__Trailspotting.gpx'),
		loadCyclingSegments('C', 'cycling-info-C', 'gps/C__Trailspotting.gpx'),
		loadCyclingSegments('D', 'cycling-info-D', 'gps/D__Trailspotting.gpx')
	];
	
	// Wait for all cycling segments to load, then create maps
	Promise.all(cyclingPromises).then(() => {
		// All cycling info is now loaded, create maps
		createMapWithGPX('map_A', ['gps/A__Trailspotting.gpx']);
		createMapWithGPX('map_B', 'gps/B__Trailspotting.gpx');
		createMapWithGPX('map_C', 'gps/C__Trailspotting.gpx');
		createMapWithGPX('map_D', 'gps/D__Trailspotting.gpx');
		createMapWithGPX('map_DD', 'gps/DD__Trailspotting.gpx');
	});
	
	// Debug iframe loading
	const iframes = document.querySelectorAll('.timetable-iframe');
	iframes.forEach((iframe, index) => {
		iframe.onload = () => console.log(`Iframe ${index + 1} loaded successfully`);
		iframe.onerror = (e) => console.error(`Iframe ${index + 1} failed to load:`, e);
	});
});
