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

// Function to add directional arrows to GPX tracks using leaflet.textpath (same method as legacy_trails)
// Only shows arrows when zoom level > 15
function addDirectionalArrows(gpxData, map) {
	const ARROW_STYLE = {
		repeat: true,
		offset: 4,
		attributes: {
			fill: MAP_CONFIG.trackColors.foreground,
			'font-weight': 'bold',
			'font-size': '12px',
			'paint-order': 'stroke',
			stroke: MAP_CONFIG.trackColors.background,
			'stroke-width': '3',
			'stroke-linejoin': 'round',
			'letter-spacing': '0px',
			'alignment-baseline': 'middle'
		}
	};
	const ARROW_TEXT = '>>               '; // choose your preferred single arrow look

	function setArrowOnPolyline(polyline, showArrows) {
		if (polyline instanceof L.Polyline && polyline.setText) {
			if (showArrows) {
				polyline.setText(ARROW_TEXT, ARROW_STYLE);
			} else {
				polyline.setText(null);
			}
		}
	}

	function processLayer(layer, showArrows) {
		// Handle nested layers
		if (layer._layers) {
			Object.values(layer._layers).forEach(nestedLayer => {
				setArrowOnPolyline(nestedLayer, showArrows);
			});
		} else {
			// Handle direct polylines
			setArrowOnPolyline(layer, showArrows);
		}
	}

	function updateArrows() {
		const zoom = map.getZoom();
		const showArrows = zoom > 13;
		if (gpxData._layers) {
			Object.values(gpxData._layers).forEach(layer => {
				processLayer(layer, showArrows);
			});
		}
	}

	// Update arrows on initial load
	updateArrows();

	// Update arrows when zoom changes
	map.on('zoomend', updateArrows);
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
	
	// Store bounds on map object for control access
	map._trailBounds = null;
	
	// Add tile layer
	L.tileLayer(MAP_CONFIG.mapSource, {
		tileSize: 512,
		zoomOffset: -1,
		attribution: MAP_CONFIG.mapAttribution,
		minZoom: config.minZoom,
		maxZoom: config.maxZoom,
		maxNativeZoom: config.maxNativeZoom,
		crossOrigin: true
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
	
	// Add fullscreen control
	const FullscreenControl = L.Control.extend({
		onAdd: function(map) {
			const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
			const button = L.DomUtil.create('a', 'leaflet-control-button', container);
			button.innerHTML = '⛶';
			button.href = '#';
			button.title = 'Toggle fullscreen';
			button.style.cssText = 'width: 30px; height: 30px; line-height: 30px; text-align: center; font-size: 18px; display: block;';
			
			let isFullscreen = false;
			let originalStyles = {};
			let cyclingInfoCard = null;
			
			L.DomEvent.disableClickPropagation(button);
			L.DomEvent.on(button, 'click', function(e) {
				L.DomEvent.stopPropagation(e);
				L.DomEvent.preventDefault(e);
				
				const mapContainer = map.getContainer();
				const mapBox = mapContainer.closest('.floating-box');
				const body = document.body;
				const cyclingInfoMain = document.getElementById('cycling-info-main');
				if (!cyclingInfoCard) {
					cyclingInfoCard = cyclingInfoMain ? cyclingInfoMain.querySelector('.cycling-info') : null;
				}
				
				if (!isFullscreen) {
					// Store original styles
					const mapBoxComputed = window.getComputedStyle(mapBox);
					const mapContainerComputed = window.getComputedStyle(mapContainer);
					
					originalStyles.mapBox = {
						position: mapBox.style.position || mapBoxComputed.position,
						top: mapBox.style.top || mapBoxComputed.top,
						left: mapBox.style.left || mapBoxComputed.left,
						width: mapBox.style.width || mapBoxComputed.width,
						height: mapBox.style.height || mapBoxComputed.height,
						zIndex: mapBox.style.zIndex || mapBoxComputed.zIndex,
						border: mapBox.style.border || mapBoxComputed.border,
						borderRadius: mapBox.style.borderRadius || mapBoxComputed.borderRadius,
						margin: mapBox.style.margin || mapBoxComputed.margin,
						padding: mapBox.style.padding || mapBoxComputed.padding
					};
					originalStyles.mapContainer = {
						width: mapContainer.style.width || mapContainerComputed.width,
						height: mapContainer.style.height || mapContainerComputed.height,
						padding: mapContainer.style.padding || mapContainerComputed.padding,
						borderRadius: mapContainer.style.borderRadius || mapContainerComputed.borderRadius
					};
					originalStyles.body = {
						overflow: body.style.overflow,
						position: body.style.position,
						padding: body.style.padding
					};
					
					// Hide all other floating boxes
					const allFloatingBoxes = document.querySelectorAll('.floating-box');
					allFloatingBoxes.forEach(function(box) {
						if (box !== mapBox) {
							box.style.display = 'none';
						}
					});
					
					// Make fullscreen - remove all borders, padding, margins
					body.style.overflow = 'hidden';
					body.style.position = 'fixed';
					body.style.width = '100%';
					body.style.padding = '0';
					mapBox.style.position = 'fixed';
					mapBox.style.top = '0';
					mapBox.style.left = '0';
					mapBox.style.width = '100vw';
					mapBox.style.height = '100vh';
					mapBox.style.zIndex = '10000';
					mapBox.style.border = 'none';
					mapBox.style.borderRadius = '0';
					mapBox.style.margin = '0';
					mapBox.style.padding = '0';
					mapContainer.style.width = '100%';
					mapContainer.style.height = '100%';
					mapContainer.style.padding = '0';
					mapContainer.style.borderRadius = '0';
					
					// Move cycling info card to top of map in fullscreen (below controls)
					if (cyclingInfoCard) {
						const cardComputed = window.getComputedStyle(cyclingInfoCard);
						originalStyles.cyclingInfoCard = {
							position: cyclingInfoCard.style.position || cardComputed.position,
							top: cyclingInfoCard.style.top || cardComputed.top,
							left: cyclingInfoCard.style.left || cardComputed.left,
							zIndex: cyclingInfoCard.style.zIndex || cardComputed.zIndex,
							parent: cyclingInfoCard.parentNode,
							className: cyclingInfoCard.className
						};
						
						cyclingInfoCard.classList.add('fullscreen-overlay');
						document.body.appendChild(cyclingInfoCard);
					}
					
					isFullscreen = true;
					button.innerHTML = '⛶';
					button.title = 'Exit fullscreen';
					
					// Invalidate map size to adjust and refit bounds
					setTimeout(function() {
						map.invalidateSize();
						if (map._trailBounds) {
							map.fitBounds(map._trailBounds, {maxZoom: config.maxZoom});
						}
					}, 100);
				} else {
					// Restore original styles
					body.style.overflow = originalStyles.body.overflow || '';
					body.style.position = originalStyles.body.position || '';
					body.style.width = '';
					body.style.padding = originalStyles.body.padding || '';
					mapBox.style.position = originalStyles.mapBox.position || '';
					mapBox.style.top = originalStyles.mapBox.top || '';
					mapBox.style.left = originalStyles.mapBox.left || '';
					mapBox.style.width = originalStyles.mapBox.width || '';
					mapBox.style.height = originalStyles.mapBox.height || '';
					mapBox.style.zIndex = originalStyles.mapBox.zIndex || '';
					mapBox.style.border = originalStyles.mapBox.border || '';
					mapBox.style.borderRadius = originalStyles.mapBox.borderRadius || '';
					mapBox.style.margin = originalStyles.mapBox.margin || '';
					mapBox.style.padding = originalStyles.mapBox.padding || '';
					mapContainer.style.width = originalStyles.mapContainer.width || '';
					mapContainer.style.height = originalStyles.mapContainer.height || '';
					mapContainer.style.padding = originalStyles.mapContainer.padding || '';
					mapContainer.style.borderRadius = originalStyles.mapContainer.borderRadius || '';
					
					// Show all other floating boxes
					const allFloatingBoxes = document.querySelectorAll('.floating-box');
					allFloatingBoxes.forEach(function(box) {
						if (box !== mapBox) {
							box.style.display = '';
						}
					});
					
					// Restore cycling info card to original position
					if (cyclingInfoCard && originalStyles.cyclingInfoCard) {
						cyclingInfoCard.classList.remove('fullscreen-overlay');
						if (originalStyles.cyclingInfoCard.parent) {
							originalStyles.cyclingInfoCard.parent.appendChild(cyclingInfoCard);
						}
					}
					
					isFullscreen = false;
					button.innerHTML = '⛶';
					button.title = 'Toggle fullscreen';
					
					// Invalidate map size to adjust
					setTimeout(function() {
						map.invalidateSize();
					}, 100);
				}
			});
			
			return container;
		}
	});
	
	new FullscreenControl({ position: 'topleft' }).addTo(map);

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
			const foregroundLayer = new L.GPX(gpxFile, {
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
			}).on('loaded', function(loadedEvent) {
				// Add directional arrows to the track using same method as numbered markers
				const gpxLayer = loadedEvent.target;
				addDirectionalArrows(gpxLayer, map);
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
						map._trailBounds = paddedBounds; // Store for refocus control
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

// Function to populate timetable boxes dynamically from STATIONS_CONFIG
function populateTimetableBoxes() {
	const timetableContainer = document.getElementById('timetable-container');
	if (!timetableContainer) {
		console.warn('Timetable container not found');
		return;
	}
	
	// Clear existing content
	timetableContainer.innerHTML = '';
	
	// Create timetable boxes for each station in STATIONS_CONFIG
	Object.keys(STATIONS_CONFIG).forEach(stationName => {
		const station = STATIONS_CONFIG[stationName];
		const box = document.createElement('div');
		box.className = 'floating-box half-floating-box timetable-box';
		box.dataset.stationName = stationName; // Store station name for matching
		
		// Add tooltip for hover/touch
		const tooltip = document.createElement('div');
		tooltip.className = 'timetable-tooltip';
		tooltip.textContent = 'Falls Fahrplan nicht angezeigt wird, kurz warten bzw. Seite neu laden!';
		box.appendChild(tooltip);
		
		// Check if URL is provided
		if (!station.iframeUrl || station.iframeUrl.trim() === '') {
			// Show config error immediately if URL is missing
			const errorDiv = createConfigError(stationName);
			box.appendChild(errorDiv);
		} else {
			const iframe = document.createElement('iframe');
			iframe.className = 'timetable-iframe';
			iframe.dataset.src = station.iframeUrl;
			box.appendChild(iframe);
		}
		
		// Add touch event handlers for mobile
		let touchTimeout;
		box.addEventListener('touchstart', (e) => {
			clearTimeout(touchTimeout);
			tooltip.classList.add('show');
		});
		box.addEventListener('touchend', (e) => {
			touchTimeout = setTimeout(() => {
				tooltip.classList.remove('show');
			}, 2000); // Hide after 2 seconds
		});
		
		timetableContainer.appendChild(box);
	});
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
	
	// Create inner container
	const innerContainer = document.createElement('div');
	innerContainer.className = 'route-wheel-inner';
	
	// Create route options from active routes (sorted alphabetically)
	const sortedRoutes = [...APP_CONFIG.activeRoutes].sort();
	sortedRoutes.forEach(route => {
		const option = document.createElement('div');
		option.className = 'route-option';
		option.dataset.route = route;
		option.textContent = route;
		
		// Create tooltip with segment information
		const tooltip = document.createElement('div');
		tooltip.className = 'route-tooltip';
		const routeConfig = ROUTE_CONFIG[route];
		if (routeConfig && routeConfig.segments && routeConfig.segments.length > 0) {
			const segmentText = routeConfig.segments.map(seg => `${seg.from} → ${seg.to}`).join(', ');
			tooltip.textContent = segmentText;
		} else {
			tooltip.textContent = 'No segments configured';
		}
		option.appendChild(tooltip);
		
		// Add touch event handlers for mobile
		let touchTimeout;
		option.addEventListener('touchstart', (e) => {
			clearTimeout(touchTimeout);
			tooltip.classList.add('show');
		});
		option.addEventListener('touchend', (e) => {
			touchTimeout = setTimeout(() => {
				tooltip.classList.remove('show');
			}, 2000); // Hide after 2 seconds
		});
		
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
	const allBoxes = document.querySelectorAll('.timetable-box');
	const timetableContainer = document.getElementById('timetable-container');
	
	// Hide all timetable boxes first
	allBoxes.forEach(box => {
		box.style.display = 'none';
	});
	
	// Track which stations from route config were matched
	const matchedStations = [];
	
	// Show only boxes for stations in the current route and lazy load their iframes
	allBoxes.forEach(box => {
		const stationName = box.dataset.stationName;
		if (routeStations.includes(stationName)) {
			matchedStations.push(stationName);
			box.style.display = 'block';
			
			const iframe = box.querySelector('.timetable-iframe');
			if (iframe && !iframe.dataset.loaded) {
				loadTimetableIframe(iframe);
			}
		}
	});
	
	// Check for unmatched stations and create error boxes for them
	if (timetableContainer) {
		routeStations.forEach(stationName => {
			if (!matchedStations.includes(stationName)) {
				// Station not found in STATIONS_CONFIG - create error box
				const box = document.createElement('div');
				box.className = 'floating-box half-floating-box timetable-box';
				box.dataset.stationName = stationName; // Store station name for consistency
				box.style.display = 'block';
				
				// Add tooltip for hover/touch
				const tooltip = document.createElement('div');
				tooltip.className = 'timetable-tooltip';
				tooltip.textContent = 'Falls Fahrplan nicht angezeigt wird, kurz warten bzw. Seite neu laden!';
				box.appendChild(tooltip);
				
				const errorDiv = createConfigError(stationName);
				box.appendChild(errorDiv);
				
				// Add touch event handlers for mobile
				let touchTimeout;
				box.addEventListener('touchstart', (e) => {
					clearTimeout(touchTimeout);
					tooltip.classList.add('show');
				});
				box.addEventListener('touchend', (e) => {
					touchTimeout = setTimeout(() => {
						tooltip.classList.remove('show');
					}, 2000); // Hide after 2 seconds
				});
				
				timetableContainer.appendChild(box);
			}
		});
	}
}

// Helper function to create error message for failed iframe
function createTimetableError(stationName) {
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
			<div><strong>Timetable dzt. nicht verfügbar!</strong></div>
			<div style="font-size: 12px; margin-top: 5px;">${stationName} timetable</div>
		</div>
	`;
	return errorDiv;
}

// Helper function to create config error message
function createConfigError(stationName) {
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
			<div style="font-size: 18px; margin-bottom: 10px;">😬</div>
			<div><strong>Timetable noch nicht konfiguriert!</strong></div>
			<div style="font-size: 12px; margin-top: 5px;">${stationName} timetable</div>
		</div>
	`;
	return errorDiv;
}

// Function to lazy load a timetable iframe
function loadTimetableIframe(iframe) {
	const originalSrc = iframe.dataset.src || iframe.src;
	if (!originalSrc || originalSrc.trim() === '') {
		// Show config error if URL is missing
		const parentBox = iframe.closest('.timetable-box');
		if (parentBox) {
			const stationName = parentBox.dataset.stationName || 'Station';
			const errorDiv = createConfigError(stationName);
			iframe.parentNode.replaceChild(errorDiv, iframe);
		}
		return;
	}
	
	iframe.dataset.loaded = 'loading';
	
	let timeoutId;
	let hasLoaded = false;
	
	iframe.src = originalSrc;
	
	const showError = () => {
		const parentBox = iframe.closest('.timetable-box');
		if (parentBox) {
			const stationName = parentBox.dataset.stationName || 'Station';
			const errorDiv = createTimetableError(stationName);
			iframe.parentNode.replaceChild(errorDiv, iframe);
		}
	};
	
	timeoutId = setTimeout(() => {
		if (!hasLoaded) {
			showError();
		}
	}, 10000);
	
	iframe.onload = () => {
		hasLoaded = true;
		iframe.dataset.loaded = 'loaded';
		clearTimeout(timeoutId);
	};
	
	iframe.onerror = (e) => {
		hasLoaded = true;
		iframe.dataset.loaded = 'error';
		clearTimeout(timeoutId);
		console.error('Iframe failed to load:', e);
		showError();
	};
}

// Function to get URL parameter
function getURLParameter(name) {
	const urlParams = new URLSearchParams(window.location.search);
	return urlParams.get(name);
}

// Function to set URL parameter
function setURLParameter(name, value) {
	const url = new URL(window.location);
	url.searchParams.set(name, value);
	window.history.pushState({}, '', url);
}

// Function to switch between routes
function switchRoute(route) {
	if (route === currentRoute) return;
	
	currentRoute = route;
	
	// Update URL parameter
	setURLParameter('route', route);
	
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
	document.documentElement.style.setProperty('--marker-size', `${MAP_CONFIG.markerSize}px`);
	document.documentElement.style.setProperty('--marker-color-start', MAP_CONFIG.markerColors.start);
	document.documentElement.style.setProperty('--marker-color-end', MAP_CONFIG.markerColors.end);
	
	// Populate timetable boxes dynamically
	populateTimetableBoxes();
	
	// Populate GPX download list dynamically
	populateGPXDownloadList();
	
	// Populate route wheel dynamically
	populateRouteWheel();
	
	// Check for route parameter in URL
	const urlRoute = getURLParameter('route');
	let initialRoute = null;
	
	if (urlRoute && APP_CONFIG.activeRoutes.includes(urlRoute)) {
		// Use route from URL if valid
		initialRoute = urlRoute;
	} else {
		// Otherwise use first route from config
		initialRoute = APP_CONFIG.activeRoutes[0] || 'A';
	}
	
	// Set initial active state
	if (initialRoute) {
		document.querySelector(`[data-route="${initialRoute}"]`).classList.add('active');
		currentRoute = initialRoute;
	}
	
	// Initialize lazy loading for iframes - store src and remove to prevent immediate loading
	const iframes = document.querySelectorAll('.timetable-iframe');
	iframes.forEach((iframe) => {
		// Store the src in data attribute and remove it to prevent immediate loading
		if (iframe.src) {
			iframe.dataset.src = iframe.src;
			iframe.removeAttribute('src');
		}
	});
	
	const filename = `${GPX_CONFIG.tracksDirectory}${initialRoute}${GPX_CONFIG.filePattern}`;
	const routeOptions = APP_CONFIG.routeOverrides[initialRoute] || {};
	
	// Update timetable boxes visibility for initial route (this will trigger lazy loading)
	updateTimetableBoxes(initialRoute);
	
	// Update map title
	document.getElementById('map-title').textContent = initialRoute;
	
	// Update URL parameter if not already set
	if (!urlRoute) {
		setURLParameter('route', initialRoute);
	}
	
	// Load cycling segments for initial route
	loadCyclingSegments(initialRoute, 'cycling-info-main', filename).then(() => {
		// Create initial map
		currentMap = createMapWithGPX('map_main', filename, routeOptions);
	}).catch(error => {
		console.error(`Error loading initial route ${initialRoute}:`, error);
	});
});
