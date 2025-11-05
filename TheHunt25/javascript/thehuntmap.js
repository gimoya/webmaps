// Add this at the start of the file, after the map initialization
// Set release date globally
/********************************************************* */
const releaseDate = new Date('2025-04-13T13:00:00');
/********************************************************* */

// Global emoji marker
let emojiMarker = null;

// Initialize the map
const map = L.map('map', {
    zoomControl: false  // Disable default zoom control
})

// Add banners to the page
const banner = document.createElement('div');
banner.className = 'release-banner';
const countdownSpan = document.createElement('span');
countdownSpan.className = 'countdown';
banner.appendChild(countdownSpan);
document.body.appendChild(banner);

const postReleaseBanner = document.createElement('div');
postReleaseBanner.className = 'post-release-banner';
postReleaseBanner.textContent = "IT'S ON!";
document.body.appendChild(postReleaseBanner);

// Add click event to post-release banner
const gpsPopup = document.createElement('div');
gpsPopup.className = 'gps-instructions-popup';
gpsPopup.innerHTML = `
    <p>Schalte das GPS auf deinem Handy ein und drücke den Location-Button (evtl. musst du der Webseite erlauben, deine Position abzurufen!)</p>
    <button>Verstanden</button>
`;
document.body.appendChild(gpsPopup);

postReleaseBanner.addEventListener('click', function() {
    gpsPopup.classList.add('active');
});

gpsPopup.querySelector('button').addEventListener('click', function() {
    gpsPopup.classList.remove('active');
});

// Function to update countdown
function updateCountdown() {
    const currentDate = new Date();
    const timeLeft = releaseDate - currentDate;
    
    if (timeLeft <= 0) {
        countdownSpan.textContent = '';
        return;
    }
    
    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
    
    countdownSpan.textContent = `Start: ${days} Tag(e), ${hours} Stunde(n), ${minutes} Minute(n), ${seconds} Sekunde(n)`;
}

// Function to check release date
function checkReleaseDate() {
    const currentDate = new Date();
    
    console.log('Current date:', currentDate);
    console.log('Release date:', releaseDate);
    console.log('Is current date >= release date?', currentDate >= releaseDate);
    
    if (currentDate >= releaseDate) {
        banner.style.display = 'none';
        postReleaseBanner.style.display = 'block';
        console.log('Release date reached - reloading GPX file for correct positions');
        
        // Remove only GPX-related layers (markers and polylines)
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                map.removeLayer(layer);
            }
        });
        
        // Reload GPX file to get correct positions
        loadGPXFile('The_Hunt_25_Route.gpx');
        console.log('Release Banner should be hidden now..');
        
        // Clear the interval since we've reached the release date
        clearInterval(releaseCheckInterval);
        return;
    } else {
        banner.style.display = 'block';
        postReleaseBanner.style.display = 'none';
        console.log('Banner should be shown');
    }
    
    updateCountdown(); // Always update countdown
}

// Start checking release date
let releaseCheckInterval = setInterval(checkReleaseDate, 1000);
checkReleaseDate();

// Function to set map bounds based on screen size
function setMapBounds() {
    const width = window.innerWidth;
    let zoomLevel = 12; // Default zoom level
    
    if (width < 768) { // Mobile
        zoomLevel = 12; // More zoomed out for small screens
    } else if (width < 1024) { // Tablet
        zoomLevel = 13; // Medium zoom
    } else { // Desktop
        zoomLevel = 14; // More zoomed in for large screens
    }
    
    map.setView([47.276, 11.41], zoomLevel);
}

// Set initial bounds
setMapBounds();

// Update bounds on window resize
window.addEventListener('resize', setMapBounds);

// Add map layers
const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© CartoDB, OpenStreetMap contributors'
});

const mapboxSatellite = L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token={accessToken}', {
    maxZoom: 18,
    tileSize: 512,
    zoomOffset: -1,
    attribution: '© Mapbox',
    accessToken: 'pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ' // You'll need to replace this with your token
});

// Set default layer
cartoLight.addTo(map);

// Create custom layer toggle control
const LayerToggle = L.Control.extend({
    options: {
        position: 'topright'
    },

    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const button = L.DomUtil.create('a', 'leaflet-control-layers-toggle', container);
        button.href = '#';
        button.title = 'Toggle Map Style';

        L.DomEvent
            .on(button, 'click', L.DomEvent.stopPropagation)
            .on(button, 'click', L.DomEvent.preventDefault)
            .on(button, 'click', () => {
                if (map.hasLayer(cartoLight)) {
                    map.removeLayer(cartoLight);
                    map.addLayer(mapboxSatellite);
                } else {
                    map.removeLayer(mapboxSatellite);
                    map.addLayer(cartoLight);
                }
            });

        return container;
    }
});

// Add zoom control to top right -> positioned in column 1.  
L.control.zoom({
    position: 'topright',
    maxZoom: 18,
    zoomDelta: 0.5  // Makes zoom steps smaller (default is 1)
}).addTo(map);

L.control.locate({
    position: 'topright',
    strings: {
        title: "Show my location"
    },
    locateOptions: {
        maxZoom: 16
    }
}).addTo(map);

// Add the basemap control to the map -> positioned in column 2.
new LayerToggle().addTo(map);


/* Add download button to bottom left -> positioned in column 3.
L.Control.downloadButton = L.Control.extend({
    options: {
        position: 'topright'
    },
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const button = L.DomUtil.create('a', 'download-button', container);
        button.innerHTML = '<i class="fas fa-download fa-lg"></i>';
        button.title = 'Download GPX';
        button.href = 'The_Hunt_25_Route.gpx';
        button.download = 'The_Hunt_25_Route.gpx';
        return container;
    }
});*/

new L.Control.downloadButton().addTo(map);

// Function to check if current date is before April 13, 2025 14:00 CET
function getPopupContent(name, desc, lat, lon) {
    // Set release date to April 13, 2025 14:00 CET
    const currentDate = new Date();
    
    if (currentDate < releaseDate) {
        // Check if this is a start or end marker
        const isStartOrEnd = name.toLowerCase().includes('start') || name.toLowerCase().includes('end');
        
        return {
            popup: `
                <div class="trailPopupClass">
                    <div class="pop_cont_name">${name}</div>
                    <div class="pop_gpx_text">
                        <pre>🤐 Coming soon! 🚧 
Das Schnitzel inkl. genauer 
Position findet ihr hier 
am 13. April 2025, 
ab 14:00 Uhr</pre>
                    </div>
                </div>
            `,
            // Keep original position for start/end markers, use default latitude for others
            position: isStartOrEnd ? [lat, lon] : [47.29, lon]
        };
    }
    
    return {
        popup: `
            <div class="trailPopupClass">
                <div class="pop_cont_name">${name}</div>
                ${desc ? `<div class="pop_gpx_text"><pre>${desc}</pre></div>` : ''}
            </div>
        `,
        position: [lat, lon] // Original position
    };
}

// Function to load and display GPX file
function loadGPXFile(url) {
    const markers = [];
    fetch(url)
        .then(response => response.text())
        .then(gpxData => {
            // Create a temporary div to parse the GPX
            const parser = new DOMParser();
            const gpxDoc = parser.parseFromString(gpxData, 'text/xml');
            
            // Parse tracks
            const tracks = gpxDoc.getElementsByTagName('trk');
            for (let track of tracks) {
                const trackName = track.getElementsByTagName('name')[0]?.textContent || 'Unnamed Track';
                const trackSegments = track.getElementsByTagName('trkseg');
                
                for (let segment of trackSegments) {
                    const points = segment.getElementsByTagName('trkpt');
                    const latlngs = [];
                    
                    for (let point of points) {
                        const lat = parseFloat(point.getAttribute('lat'));
                        const lon = parseFloat(point.getAttribute('lon'));
                        latlngs.push([lat, lon]);
                    }
                    
                    // Create polyline for the track
                    const polyline = L.polyline(latlngs, {
                        color: '#0cc0df',
                        weight: 4,
                        opacity: 0.9,
                        className: 'animated-track' // Remove or keep dash animation as preferred
                    }).addTo(map);

                    // Add directional text symbols using PolylineDecorator
                    L.polylineDecorator(polyline, {
                        patterns: [
                            {
                                offset: 25,     // Start first arrow 25px from the beginning
                                repeat: 100,    // Repeat every 100px
                                symbol: L.Symbol.arrowHead({
                                    pixelSize: 11,
                                    polygon: false,
                                    pathOptions: { 
                                        stroke: true,
                                        weight: 2.2,
                                        color: '#0cc0df' // Match polyline color
                                    } 
                                })
                            }
                        ]
                    }).addTo(map);

                    // Remove emoji marker if it exists
                    if (emojiMarker) {
                        map.removeLayer(emojiMarker);
                    }
                    
                    // Add new moving emoji
                    emojiMarker = L.marker(latlngs[0], {
                        icon: L.divIcon({
                            className: 'moving-emoji',
                            html: '🦊',
                            iconSize: [40, 40],
                            iconAnchor: [15, 15]
                        })
                    }).addTo(map);

                    // Set faster animation speed if after release date
                    const currentDate = new Date();
                    const animationDelay = currentDate >= releaseDate ? 30 : 120;
                    console.log('Setting animation delay to:', animationDelay);

                    // Animate emoji along the track
                    let currentIndex = 0;
                    const animateEmoji = () => {
                        if (currentIndex < latlngs.length) {
                            const currentLatLng = L.latLng(latlngs[currentIndex]);
                            if (emojiMarker) {
                                emojiMarker.setLatLng(currentLatLng);
                            }
                            
                            // Check distance to all markers and trigger rotation if close
                            markers.forEach(marker => {
                                const markerLatLng = marker.getLatLng();
                                const distance = currentLatLng.distanceTo(markerLatLng);
                                if (distance < 20) { // 20 meters threshold
                                    const icon = marker.getElement().querySelector('i');
                                    if (icon) {
                                        icon.classList.add('rotate', 'gold');
                                        setTimeout(() => {
                                            icon.classList.remove('rotate', 'gold');
                                        }, 1000);
                                    }
                                }
                            });
                            
                            currentIndex++;
                            setTimeout(animateEmoji, animationDelay); // Use dynamic delay
                        } else {
                            currentIndex = 0;
                            animateEmoji();
                        }
                    };
                    animateEmoji();
                    
                    // Add popup to the track
                    polyline.bindPopup(`<div class="trailPopupClass"><div class="pop_cont_name">${trackName}</div></div>`);
                }
            }
            
            // Parse waypoints
            const waypoints = gpxDoc.getElementsByTagName('wpt');
            for (let waypoint of waypoints) {
                const lat = parseFloat(waypoint.getAttribute('lat'));
                const lon = parseFloat(waypoint.getAttribute('lon'));
                const name = waypoint.getElementsByTagName('name')[0]?.textContent || 'Unnamed Waypoint';
                const desc = waypoint.getElementsByTagName('desc')[0]?.textContent || '';
                
                // Get popup content and position based on date
                const content = getPopupContent(name, desc, lat, lon);
                
                // Create marker based on name
                let marker;
                if (name.toLowerCase().includes('start')) {
                    marker = L.marker(content.position, {
                        icon: L.divIcon({
                            className: 'custom-div-icon',
                            html: "<i class='fas fa-flag start-flag'></i>",
                            iconSize: [30, 42],
                            iconAnchor: [15, 35]
                        })
                    }).addTo(map);

                } else if (name.toLowerCase().includes('end')) {
                    marker = L.marker(content.position, {
                        icon: L.divIcon({
                            className: 'custom-div-icon',
                            html: "<i class='fas fa-flag end-flag'></i>",
                            iconSize: [30, 42],
                            iconAnchor: [15, 35]
                        })
                    }).addTo(map);

                } else {
                    marker = L.marker(content.position, {
                        icon: L.divIcon({
                            className: 'custom-div-icon',
                            html: "<i class='fas fa-hashtag'></i>",
                            iconSize: [30, 42],
                            iconAnchor: [15, 35]
                        })
                    }).addTo(map);
                }
                
                // Add marker to our array
                markers.push(marker);
                
                // Add popup to the waypoint using the date check function
                marker.bindPopup(content.popup, {
                    offset: [0, -30], // Adjust this to move popup up/down relative to marker
                    className: 'custom-popup',
                    closeButton: true
                });
            }            
        })
        .catch(error => {
            console.error('Error loading GPX file:', error);
            document.getElementById('errorMsg').textContent = 'Error loading GPX file. Please check the console for details.';
        });
}

// Load the GPX file
loadGPXFile('The_Hunt_25_Route.gpx'); 
