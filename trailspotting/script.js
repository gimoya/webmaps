// Trailspotting Map Application JavaScript
// External JavaScript file for GPX loading and cycling segment display

// ============================================================================
// APPLICATION DATA
// ============================================================================

// Store GPX metadata for each route
const gpxMetadata = {};

// Configuration constants are loaded from config.js

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
		const stationInfo = ROUTE_CONFIG[route] && ROUTE_CONFIG[route].segments[seg.segment - 1];
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
	// Default options from configuration
	const defaults = {
		minZoom: MAP_CONFIG.defaultMinZoom,
		maxZoom: MAP_CONFIG.defaultMaxZoom,
		maxNativeZoom: MAP_CONFIG.defaultMaxNativeZoom,
		lineColor: MAP_CONFIG.trackColors.foreground,
		lineOpacity: MAP_CONFIG.trackColors.foregroundOpacity,
		lineWeight: MAP_CONFIG.trackColors.foregroundWeight,
		lineCap: 'round',
		boundsPadding: MAP_CONFIG.defaultBoundsPadding
	};
	
	// Merge user options with defaults
	const config = { ...defaults, ...options };
	
	// Create the map
	const map = L.map(mapId);
	
	// Add tile layer
	L.tileLayer(MAP_CONFIG.mapSource, {
		attribution: MAP_CONFIG.mapAttribution,
		minZoom: config.minZoom,
		maxZoom: config.maxZoom,
		maxNativeZoom: config.maxNativeZoom
	}).addTo(map);
	
	// Add locate control
	L.control.locate({
		position: 'bottomleft',
		drawCircle: true,
		follow: true,
		setView: true,
		keepCurrentZoomLevel: true,
		markerStyle: {
			weight: 2,
			opacity: 0.8,
			fillOpacity: 0.3
		},
		circleStyle: {
			weight: 2,
			opacity: 0.8,
			fillOpacity: 0.3
		}
	}).addTo(map);

	// Ensure gpxFiles is an array
	const files = Array.isArray(gpxFiles) ? gpxFiles : [gpxFiles];
	
	// Track loaded GPX files to fit bounds after all are loaded
	let loadedCount = 0;
	const totalFiles = files.length;
	let allBounds = [];

	// Add each GPX file
	files.forEach(gpxFile => {
		
		// Add thicker background line underneath
		new L.GPX(gpxFile, {
			async: true,
			polyline_options: {
				color: MAP_CONFIG.trackColors.background,
				opacity: MAP_CONFIG.trackColors.backgroundOpacity,
				weight: MAP_CONFIG.trackColors.backgroundWeight,
				lineCap: 'round'
			},
			marker_options: {
				startIconUrl: null,
				endIconUrl: null,
				shadowUrl: null
			}
		}).on('error', function(e) {
			console.error(`GPX loading error for ${gpxFile}:`, e);
		}).on('loaded', function(e) {
			// Add thinner foreground line on top
			new L.GPX(gpxFile, {
				async: true,
				polyline_options: {
					color: MAP_CONFIG.trackColors.foreground,
					opacity: MAP_CONFIG.trackColors.foregroundOpacity,
					weight: MAP_CONFIG.trackColors.foregroundWeight,
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
				
				// Iterate through all layers
				Object.values(gpxData._layers).forEach((layer, layerIndex) => {
					
					// Check if this layer has nested _layers (LayerGroup)
					if (layer._layers) {
						
						// Iterate through nested layers
						Object.values(layer._layers).forEach((nestedLayer, nestedIndex) => {
							
							// Try to get latlngs from nested layer
							if (nestedLayer._latlngs) {
								const latlngs = nestedLayer._latlngs;
								
								// Check if it's a flat array of points (single segment)
								if (Array.isArray(latlngs) && latlngs.length > 0 && latlngs[0].lat !== undefined) {
									// Single segment with many points
									totalSegments++;
									totalStartPoints++;
									totalEndPoints++;
									totalPoints += latlngs.length;
									
									// Add numbered markers for start and end points
									const startPoint = latlngs[0];
									const endPoint = latlngs[latlngs.length - 1];
									
									
									// Add start point marker
									L.marker([startPoint.lat, startPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker start',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [MAP_CONFIG.markerSize, MAP_CONFIG.markerSize],
											iconAnchor: [MAP_CONFIG.markerSize/2, MAP_CONFIG.markerSize/2]
										})
									}).addTo(map);
									pointCounter++;
									
									// Add end point marker
									L.marker([endPoint.lat, endPoint.lng], {
										icon: L.divIcon({
											className: 'numbered-marker end',
											html: `<div class="marker-number">${pointCounter}</div>`,
											iconSize: [MAP_CONFIG.markerSize, MAP_CONFIG.markerSize],
											iconAnchor: [MAP_CONFIG.markerSize/2, MAP_CONFIG.markerSize/2]
										})
									}).addTo(map);
									pointCounter++;
								}
								// Check if it's an array of segments
								else if (Array.isArray(latlngs)) {
									latlngs.forEach((segment, segmentIndex) => {
										if (Array.isArray(segment) && segment.length > 0) {
											totalSegments++;
											totalStartPoints++;
											totalEndPoints++;
											totalPoints += segment.length;
											
											// Add numbered markers for start and end points
											const startPoint = segment[0];
											const endPoint = segment[segment.length - 1];
											
											
											// Add start point marker
											L.marker([startPoint.lat, startPoint.lng], {
												icon: L.divIcon({
													className: 'numbered-marker start',
													html: `<div class="marker-number">${pointCounter}</div>`,
													iconSize: [MAP_CONFIG.markerSize, MAP_CONFIG.markerSize],
													iconAnchor: [MAP_CONFIG.markerSize/2, MAP_CONFIG.markerSize/2]
												})
											}).addTo(map);
											pointCounter++;
											
											// Add end point marker
											L.marker([endPoint.lat, endPoint.lng], {
												icon: L.divIcon({
													className: 'numbered-marker end',
													html: `<div class="marker-number">${pointCounter}</div>`,
													iconSize: [MAP_CONFIG.markerSize, MAP_CONFIG.markerSize],
													iconAnchor: [MAP_CONFIG.markerSize/2, MAP_CONFIG.markerSize/2]
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
						const latlngs = layer._latlngs;
						
						// Check if it's a flat array of points (single segment)
						if (Array.isArray(latlngs) && latlngs.length > 0 && latlngs[0].lat !== undefined) {
							// Single segment with many points
							totalSegments++;
							totalStartPoints++;
							totalEndPoints++;
							totalPoints += latlngs.length;
							
							// Add numbered markers for start and end points
							const startPoint = latlngs[0];
							const endPoint = latlngs[latlngs.length - 1];
							
							
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
							latlngs.forEach((segment, segmentIndex) => {
								if (Array.isArray(segment) && segment.length > 0) {
									totalSegments++;
									totalStartPoints++;
									totalEndPoints++;
									totalPoints += segment.length;
									
									// Add numbered markers for start and end points
									const startPoint = segment[0];
									const endPoint = segment[segment.length - 1];
									
									
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
			
			
			// When all files are loaded, fit bounds
			if (loadedCount === totalFiles) {
				// Ensure map is properly sized before setting bounds
				setTimeout(() => {
					map.invalidateSize();
					
					if (allBounds.length > 0) {
						const combinedBounds = allBounds.reduce((acc, bounds) => {
							return acc.extend(bounds);
						}, allBounds[0]);
						
						const paddedBounds = combinedBounds.pad(config.boundsPadding);
						map.fitBounds(paddedBounds);
						map.setMaxBounds(paddedBounds);
					} else {
						console.warn(`No bounds available for map ${mapId}`);
					}
				}, 200);
			}
		}).addTo(map);
	});
	
	return map;
}

// Function to populate GPX download list dynamically
function populateGPXDownloadList() {
	const downloadList = document.getElementById('gpx-download-list');
	if (!downloadList) {
		console.warn('GPX download list container not found');
		return;
	}
	
	// Clear existing content
	downloadList.innerHTML = '';
	
	// Add download links for all active routes
	APP_CONFIG.activeRoutes.forEach(route => {
		const filename = `${route}${GPX_CONFIG.filePattern}`;
		const filepath = `${GPX_CONFIG.tracksDirectory}${filename}`;
		
		const link = document.createElement('a');
		link.href = filepath;
		link.textContent = filename;
		downloadList.appendChild(link);
	});
	
}

// Global variables for single map system
let currentMap = null;
let currentRoute = 'A';

// Function to populate route wheel dynamically
function populateRouteWheel() {
	const routeWheel = document.getElementById('route-wheel');
	if (!routeWheel) return;
	
	// Create inner container for scrolling animation
	const innerContainer = document.createElement('div');
	innerContainer.className = 'route-wheel-inner';
	
	// Create route options from active routes
	APP_CONFIG.activeRoutes.forEach(route => {
		const option = document.createElement('div');
		option.className = 'route-option';
		option.dataset.route = route;
		option.textContent = route;
		option.addEventListener('click', () => {
			switchRoute(route);
		});
		innerContainer.appendChild(option);
	});
	
	// Clear existing content and add new inner container
	routeWheel.innerHTML = '';
	routeWheel.appendChild(innerContainer);
	
}

// Function to show/hide timetable boxes based on route
function updateTimetableBoxes(route) {
	const routeStations = ROUTE_CONFIG[route] ? ROUTE_CONFIG[route].stations : [];
	
	// Hide all timetable boxes first
	document.querySelectorAll('.timetable-box').forEach(box => {
		box.style.display = 'none';
	});
	
	// Show only boxes for stations in the current route
	routeStations.forEach(stationName => {
		// Find timetable boxes by checking if the title contains the station name
		document.querySelectorAll('.timetable-box .timetable-title').forEach(title => {
			if (title.textContent.includes(stationName)) {
				title.closest('.timetable-box').style.display = 'block';
			}
		});
	});
}

// Function to switch between routes
function switchRoute(route) {
	if (route === currentRoute) return;
	
	currentRoute = route;
	
	// Update route selector UI
	document.querySelectorAll('.route-option').forEach(option => {
		option.classList.remove('active');
		if (option.dataset.route === route) {
			option.classList.add('active');
		}
	});
	
	// Update timetable boxes visibility
	updateTimetableBoxes(route);
	
	// Update map title
	document.getElementById('map-title').textContent = route;
	
	// Load new route data
	const filename = `${GPX_CONFIG.tracksDirectory}${route}${GPX_CONFIG.filePattern}`;
	const routeOptions = APP_CONFIG.routeOverrides[route] || {};
	
	// Load cycling segments for new route
	loadCyclingSegments(route, 'cycling-info-main', filename).then(() => {
		// Create new map
		if (currentMap) {
			currentMap.remove();
		}
		currentMap = createMapWithGPX('map_main', filename, routeOptions);
	}).catch(error => {
		console.error(`Error loading route ${route}:`, error);
	});
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
	// Set CSS custom properties from configuration
	document.documentElement.style.setProperty('--scroll-duration', `${GPX_CONFIG.scrollDuration}s`);
	
	// Populate GPX download list dynamically
	populateGPXDownloadList();
	
	// Populate route wheel dynamically
	populateRouteWheel();
	
	// Set initial active state for first route
	const firstRoute = APP_CONFIG.activeRoutes[0];
	if (firstRoute) {
		document.querySelector(`[data-route="${firstRoute}"]`).classList.add('active');
		currentRoute = firstRoute;
	}
	
	// Initialize with first route from config
	const initialRoute = APP_CONFIG.activeRoutes[0] || 'A';
	const filename = `${GPX_CONFIG.tracksDirectory}${initialRoute}${GPX_CONFIG.filePattern}`;
	const routeOptions = APP_CONFIG.routeOverrides[initialRoute] || {};
	
	// Update timetable boxes visibility for initial route
	updateTimetableBoxes(initialRoute);
	
	// Update map title
	document.getElementById('map-title').textContent = initialRoute;
	
	// Load cycling segments for initial route
	loadCyclingSegments(initialRoute, 'cycling-info-main', filename).then(() => {
		// Create initial map
		currentMap = createMapWithGPX('map_main', filename, routeOptions);
	}).catch(error => {
		console.error(`Error loading initial route ${initialRoute}:`, error);
	});
	
	// Handle iframe loading with timeout
	const iframes = document.querySelectorAll('.timetable-iframe');
	iframes.forEach((iframe, index) => {
		let timeoutId;
		let hasLoaded = false;
		
		// Set timeout for 10 seconds
		timeoutId = setTimeout(() => {
			if (!hasLoaded) {
				// Replace iframe with error message
				const parentBox = iframe.closest('.timetable-box');
				if (parentBox) {
					const title = parentBox.querySelector('.timetable-title');
					const stationName = title ? title.textContent.replace(' 🕐', '') : 'Station';
					
					// Create error message div
					const errorDiv = document.createElement('div');
					errorDiv.className = 'timetable-error';
					errorDiv.style.cssText = `
						display: flex;
						align-items: center;
						justify-content: center;
						height: 200px;
						background-color: #f5f5f5;
						border: 1px solid #ddd;
						border-radius: 5px;
						color: #666;
						font-size: 14px;
						text-align: center;
						padding: 20px;
						box-sizing: border-box;
					`;
					errorDiv.innerHTML = `
						<div>
							<div style="font-size: 18px; margin-bottom: 10px;">🚫</div>
							<div><strong>Service not avail. at the moment</strong></div>
							<div style="font-size: 12px; margin-top: 5px;">${stationName} timetable</div>
						</div>
					`;
					
					// Replace iframe with error message
					iframe.parentNode.replaceChild(errorDiv, iframe);
				}
			}
		}, 10000); // 10 seconds
		
		// Clear timeout when iframe loads successfully
		iframe.onload = () => {
			hasLoaded = true;
			clearTimeout(timeoutId);
		};
		
		// Handle iframe errors
		iframe.onerror = (e) => {
			hasLoaded = true; // Prevent timeout from firing
			clearTimeout(timeoutId);
			console.error(`Iframe ${index + 1} failed to load:`, e);
			
			// Replace iframe with error message
			const parentBox = iframe.closest('.timetable-box');
			if (parentBox) {
				const title = parentBox.querySelector('.timetable-title');
				const stationName = title ? title.textContent.replace(' 🕐', '') : 'Station';
				
				// Create error message div
				const errorDiv = document.createElement('div');
				errorDiv.className = 'timetable-error';
				errorDiv.style.cssText = `
					display: flex;
					align-items: center;
					justify-content: center;
					height: 200px;
					background-color: #f5f5f5;
					border: 1px solid #ddd;
					border-radius: 5px;
					color: #666;
					font-size: 14px;
					text-align: center;
					padding: 20px;
					box-sizing: border-box;
				`;
				errorDiv.innerHTML = `
					<div>
						<div style="font-size: 18px; margin-bottom: 10px;">🚫</div>
						<div><strong>Service not avail. at the moment</strong></div>
						<div style="font-size: 12px; margin-top: 5px;">${stationName} timetable</div>
					</div>
				`;
				
				// Replace iframe with error message
				iframe.parentNode.replaceChild(errorDiv, iframe);
			}
		};
	});
});
