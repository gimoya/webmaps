/* PW protection 
function trim(str) {
	return str.replace(/^\s+|\s+$/g, '');  
}

var pw_prompt = prompt('Passwort eingeben um auf die Seite **Legacy Trails Tirol** zu gelangen..',' ');
var pw = 'coffee';
// if prompt is cancelled the pw_prompt var will be null!
if (pw_prompt == null) {
	alert('Kein Passwort wurde angegeben! Die Seite wird nicht geladen...');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();s
	}
	window.location='tilt.html';
}
if (trim(pw_prompt) == pw ) {
	alert('Passwort ok!');
} else {
	alert('Falsches Passwort! Die Seite wird nicht geladen..');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();
	}
	window.location='tilt.html';
}
*/


/*** Set Up Map ***/
var map = L.map('map', {
  zoom: 12,
  maxZoom: 18,
  minZoom: 11,
  zoomControl: false,
  attributionControl: false
});

/*** Set Up Base Map Layers ***/

var mapbox_Attr = 'Tiles &copy; <a href="google.com">Google Maps</a>, <a href="openstreetmap.org">OSM</a> | Design &copy; <a href="http://www.tiroltrailhead.com/guiding">Tirol Trailhead</a>';  
var mapbox_satelliteUrl = '//mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
var mapy_topoUrl = '//tile.opentopomap.org/{z}/{x}/{y}.png';

var mapbox_satelliteLayer = L.tileLayer(mapbox_satelliteUrl, {
  attribution: mapbox_Attr 
});

var mapy_topoLayer = L.tileLayer(mapy_topoUrl, {
  attribution: mapbox_Attr,
  maxZoom: 20,
  maxNativeZoom: 17  
});

/*** Setting Default Base Map ***/
mapbox_satelliteLayer.addTo(map);	

/*** Strava TMS not working 
var strava_proxyUrl = 'https://proxy.nakarte.me/https/heatmap-external-a.strava.com/tiles-auth/ride/hot/{z}/{x}/{y}.png';
var strava_Layer = L.tileLayer(strava_proxyUrl, {
    tms: true
}).addTo(map);
***/



/*** Map Selection and Zoom Controls ***/

/* Source Map Attribution */
new L.control.attribution({position: 'bottomright'}).addTo(map);

/* Zoom */
new L.Control.Zoom({ position: 'topright' }).addTo(map);

/*** Add Center View Control ***/

var centerView = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'centerView',
	icon: '<i class="fas fa-compress"></i>',
	title: 'Center View',		
	onClick: function(control) {
	map.fitBounds(trails_json.getBounds(), {maxZoom: 16});
	}
  }]
});	

centerView.addTo(map);

/* Base Map Toggle */
var toggle = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'basemap-satellite',
	icon: '<span class="custom-control">S</span>',
	title: 'Hintergrundkarte Luftbild/Topo',
	onClick: function(control) {
	  map.removeLayer(mapbox_satelliteLayer);
	  map.addLayer(mapy_topoLayer);
	  control.state('basemap-outdoor');
	}
  }, {
	stateName: 'basemap-outdoor',
	icon: '<span class="custom-control">T</span>',
	title: 'Hintergrundkarte Topo/Luftbild',		
	onClick: function(control) {
	  map.removeLayer(mapy_topoLayer);
	  map.addLayer(mapbox_satelliteLayer);
	  control.state('basemap-satellite');
	}
  }]
});

toggle.addTo(map);

/*** Add Location Control ***/

L.control.locate({
    strings: {
        title: "Zeige GPS-Standort"
    },
	position: 'topright'
}).addTo(map);	

/*** Set Up Elevation Control ***/

var el = L.control.elevation({
			position: "bottomright",
			theme: "lime-theme", //default: lime-theme
			width: 320,	
			height: 160,
			margins: {
				top: 20,
				right: 20,
				bottom: 30,
				left: 60
			},
			useHeightIndicator: true, //if false a marker is drawn at map position
			interpolation: "linear", //see https://github.com/mbostock/d3/wiki/SVG-Shapes#wiki-area_interpolate
			hoverNumber: {
				decimalsX: 2, //decimals on distance (always in km)
				decimalsY: 0, //deciamls on hehttps://www.npmjs.com/package/leaflet.coordinatesight (always in m)
				formatter: undefined //custom formatter function may be injected
			},
			xTicks: undefined, //number of ticks in x axis, calculated by default according to width
			yTicks: undefined, //number of ticks on y axis, calculated by default according to height
			collapsed: false,  //collapsed mode, show chart on click or mouseover
			imperial: false    //display imperial units instead of metric
	});



var legend = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'legende',
	icon: '<i class="fas fa-info-circle fa-lg"></i>',
	title: 'Legende anzeigen',		
	onClick: function(){
		$( document ).ready(function() {
			info_div = $('#info-div');
			legend_content = $('#info-div .legend-content');
			
			if (info_div.is(':visible')) {
				// If info div is visible, slide it to the left
				info_div.addClass('hidden');
				setTimeout(function() {
					info_div.hide();
					info_div.removeClass('hidden');
					map.invalidateSize();
				}, 300);
			} else {
				// If info div is hidden, show it and scroll to legend
				info_div.show().addClass('hidden');
				setTimeout(function() {
					info_div.removeClass('hidden');
					info_div.animate({
						scrollTop: legend_content.offset().top - info_div.offset().top
					}, 500);
					map.invalidateSize();
				}, 10);
			}
		});
	}	
  }]
});	

legend.addTo(map);

// Add close button handler
$( document ).ready(function() {
    $('.close-info').on('click', function() {
        $('#info-div').slideUp(200, function() {
            map.invalidateSize();
        });
    });
});

// Add function to update trails in view
function updateTrailsInView() {
    if (!trails_json) return;
    
    var bounds = map.getBounds();
    var trailsInView = [];
    var content = '';
    
    trails_json.eachLayer(function(layer) {
        if (bounds.intersects(layer.getBounds())) {
            trailsInView.push({
                feature: layer.feature,
                layer: layer
            });
        }
    });
    
    if (trailsInView.length === 0) {
        content += '<div class="trail-item no-trails">..keine Trails in diesem Kartenauschnitt!</div>';
    } else {
        trailsInView.forEach(function(trail) {
            content += `
                <div class="trail-item" data-trail-name="${trail.feature.properties.name}">
                    <h3>${trail.feature.properties.name}</h3>
                    <p>${trail.feature.properties.Trail_Text}</p>
                </div>
            `;
        });
    }
    
    // Remove existing trail items but keep the h2
    $('.trails-list .trail-item').remove();
    // Append new content after the h2
    $('.trails-list h2').after(content);
    
    // Add click handlers to trail items
    $('.trail-item').on('click', function() {
        var trailName = $(this).data('trail-name');
        if (trailName) {  // Only process clicks on actual trails, not the "no trails" message
            trails_json.eachLayer(function(layer) {
                if (layer.feature.properties.name === trailName) {
                    map.fitBounds(layer.getBounds());
                    // Trigger click on the trail to select it
                    if (layer._clickLayer) {
                        layer._clickLayer.fire('click');
                    }
                }
            });
        }
    });
}

// Add scroll to trails functionality
$( document ).ready(function() {
    $('.scroll-to-trails').on('click', function() {
        var trailsList = $('.trails-list');
        if (trailsList.length) {
            $('#info-div').animate({
                scrollTop: trailsList.offset().top - $('#info-div').offset().top - 25
            }, 500);
        }
    });
});

// Add event listeners for map movement
map.on('moveend', updateTrailsInView);
map.on('zoomend', updateTrailsInView);

// Initial update
updateTrailsInView();

/*** Trail Style-Helper Functions ***/

function findMatchingLayer(clickLayer, trailsLayer) {
    var matchingLayer = null;
    trailsLayer.eachLayer(function(layer) {
        if (layer.feature.properties.name === clickLayer.feature.properties.name) {
            matchingLayer = layer;
        }
    });
    return matchingLayer;
}

function highlight (layer) {	// will be used on hover
    var mainLayer = findMatchingLayer(layer, trails_json);
    if (mainLayer) {
        mainLayer.setStyle({
            weight: 4,       // wider line
            dashArray: '',
            opacity: 0.95      // slightly more opaque
        });
        if (!L.Browser.ie && !L.Browser.opera) {
            mainLayer.bringToFront();
        }
    }
}

function styleLines(feature) {	// deafult style used for constructor of json
    return {
		color: '#FF5F1F',
		weight: 3,
		opacity: 0.8,
		lineJoin: 'round',  //miter | round | bevel 
    };
}

function styleClickLayer(feature) {	// style for click layer
    return {
		color: '#000000',
		weight: 8,  // double the width
		opacity: 0.4, // semi-transparent
		lineJoin: 'round',
    };
}

/*** Map and Json Layer Event Listeners and Helper Functions ***/
			
var lyr;
var ftr;
var trails_json;

var selected = null;

function dehighlight (layer) { 	// will be used inside select function
    if (selected === null || (selected && selected.feature.properties.name !== layer.feature.properties.name)) {
        var mainLayer = findMatchingLayer(layer, trails_json);
        if (mainLayer) {
            trails_json.resetStyle(mainLayer);
            mainLayer.setText(null);
        }
    }
}

function select (layer) {  // ..use inside onClick Function doClickStuff() to select and style clicked feature 
    if (selected !== null) {
        var previous = selected;
    }
    var mainLayer = findMatchingLayer(layer, trails_json);
    if (mainLayer) {
        map.fitBounds(mainLayer.getBounds());
        selected = mainLayer;
        if (previous) {
            dehighlight(previous);
        }
    }
}

function doClickStuff(e) {
    lyr = e.target;
    ftr = e.target.feature;
    
    var mainLayer = findMatchingLayer(lyr, trails_json);
    if (mainLayer) {
        select(lyr);
        mainLayer.setText('- - - ►             ', { repeat: true, offset: 11, attributes: {fill:  '#FF5F1F', 'font-weight': 'bold', 'font-size': '12'} });
        
        /*** Elevation Control ***/
        if (typeof el !== 'undefined') {
            el.clear();
            map.removeControl(el);
        };	
        
        L.DomEvent.stopPropagation(e);
        el.addData(ftr, mainLayer);
        map.addControl(el);	
        
        /*** make all non-selected trails opaque, after resetting styles (ftr selected before)***/ 
        trails_json.eachLayer(function(layer){ 
            if(selected && selected.feature.properties.name !== layer.feature.properties.name) {
                dehighlight(layer);
                layer.setStyle({opacity: 0.4})
            }
        });

        // Open popup at click location
        var popup = mainLayer.getPopup();
        if (popup) {
            popup.setLatLng(e.latlng);
            popup.openOn(map);
        }
    }
}

/* Start/End pts in different pane ontop of trails */ 

map.createPane('ptsPane');
map.getPane('ptsPane').style.zIndex = 600;


/*** Add Trails ***/

$.getJSON('my_trails_z.geojson', function(json) {
	// Filter out trails where HIDE = 1
	json.features = json.features.filter(feature => feature.properties.HIDE !== 1);
	
	// Create click layer first (will be underneath)
	var click_layer = L.geoJson(json, {
		style: styleClickLayer,
		interactive: true,
	}).addTo(map);
	
	// Create main layer on top
	trails_json = L.geoJson(json, {
		style: styleLines,
		interactive: false, // disable interaction on main layer
	}).addTo(map);
	
	// Add event handlers to click layer
	click_layer.eachLayer(function(layer) {
		layer.on({
			'mouseover': function (e) {
				if (selected === null || (selected && selected.feature.properties.name !== e.target.feature.properties.name)) {
					highlight(e.target);
				}
			},
			'mouseout': function (e) {
				if (selected === null || (selected && selected.feature.properties.name !== e.target.feature.properties.name)) {
					dehighlight(e.target);
				}
			},
			'click': doClickStuff
		});
	});
	
	// Add start/end markers and popups to main layer
	trails_json.eachLayer(function(layer) {
		var feature = layer.feature;
		
		if(feature.geometry.coordinates.length > 0) {
			var stPt = [feature.geometry.coordinates[0][1], 
						feature.geometry.coordinates[0][0]]; 
			var endPt = [feature.geometry.coordinates[feature.geometry.coordinates.length - 1][1],
						feature.geometry.coordinates[feature.geometry.coordinates.length - 1][0]];
			
			// Add Start and End Markers
			new L.circleMarker(stPt, {
				color: 'darkslategrey',
				fillColor: 'lightgreen',	
				fillOpacity: 1,				
				radius: 3.5,
				weight:1.5,
				pane: 'ptsPane'
			})
			.bindTooltip('<div id="pop_cont_name"><strong>Start:</strong> ' + feature.properties.name + '</br><strong>Seehöhe:</strong> ' + Math.round(feature.geometry.coordinates[0][2]) + ' m</div>', {
				permanent: false, 
				direction: 'right',
				className: "pt_labels"
			})
			.addTo(map);
			
			new L.circleMarker(endPt, {
				color: 'darkslategrey',
				fillColor: 'pink',
				fillOpacity: 1,
				radius: 3.5,
				weight:1.5,	
				pane: 'ptsPane'
			})	
			.bindTooltip('<div id="pop_cont_name"><strong>Ende:</strong> ' + feature.properties.name + '</br><strong>Seehöhe:</strong> ' + Math.round(feature.geometry.coordinates[feature.geometry.coordinates.length - 1][2]) + ' m</div>', {
				permanent: false, 
				direction: 'right',
				className: "pt_labels"
			})
			.addTo(map);
		}
		
		// Add popup to main layer
		var bb = new Blob([togpx(feature)], {type: 'application/gpx+xml'});	
		var gpxLink = document.createElement("a");
		gpxLink.download = feature.properties.name + ".gpx";
		gpxLink.innerHTML = "GPX-Download";	
		gpxLink.id = "gpxLink_ID";
		gpxLink.href = window.URL.createObjectURL(bb);
		
		var popupContent = 
		'<p><div class="pop_cont_name">' + feature.properties.name + '</div></p>'
		+ '<div class="pop_cont_text">' + feature.properties.Trail_Text + '</div>' 
		+ '<div class="pop_gpx_text">🤝 ' +  gpxLink.outerHTML + ' 🚩'+ '</div>'
		+ '<div class="kofi_reminder">'
		+ '<p>🚴 Dein GPX-Track wird heruntergeladen..</p>'
		+ '<p>💲 Die Downloads auf dieser Seite sind gratis, aber der Betrieb dieser <strong>Webseite kostet Geld!</strong></p>'
		+ '<p>🤝 Mit einem kleinen Beitrag für den GPX-Download kannst Du helfen!</p>'
		+ '<p>💓 Bitte haltet das Projekt am Leben!</p>'
		+ '<div class="kofi_button"><a href="https://ko-fi.com/C1C74GQ0I" target="_blank">'
		+ 	'<img id="kofi_img_div" class="kofi_img" src="https://tiroltrailhead.com/legacy_trails/images/kofi_s_logo_nolabel.png">'
		+	'<button type="button">Support!👋</button></a>'
		+ '</div>'
		+ '</div>'
		+ '</div>';
		
		layer.bindPopup(popupContent, {closeOnClick: true, className: 'trailPopupClass'});
	});
	
	map.fitBounds(trails_json.getBounds(), {maxZoom: 15});
});

/*** Add event listener for click events on document ***/

document.addEventListener('click', function(event) {
  if (event.target === document.getElementById('gpxLink_ID')) {
    var kofiReminder = document.querySelector('.kofi_reminder');
    if (kofiReminder) {
      kofiReminder.style.visibility = 'visible';
	  kofiReminder.style.opacity = 1;
    }
  }
});

/*
Points of interest


jQuery.get('POIs.geojson', function(data) {

var POIs = data;

var POIs_Icon = L.icon({
	iconUrl: 'images/pin.png',
	iconSize: [22,22], // size of the icon
    iconAnchor: [11,22],
	popupAnchor: [0,-24]
	});

for (i = 0; i < POIs.features.length; i++) { 
	new L.marker(L.GeoJSON.coordsToLatLng(POIs.features[i].geometry.coordinates), {
				icon: POIs_Icon,
				zIndexOffset: 10000,
				riseOnHover: true,
				pane: 'ptsPane'})
			.bindPopup('<div id="pop_cont_name">' + POIs.features[i].properties.name + '</div><div id="pop_cont_descr">' + POIs.features[i].properties.description + '</div>', 
				{
					closeButton: true,
					autoClose: false,
					direction: 'right'
				}
			)
			.addTo(map);
	}
});

*/

/*** Map Event Listeners ***/

map.on("click", function(e){
	/*** Remove Elevation Profile when map is clicked ***/
	if (typeof el !== 'undefined') {
		// the variable is defined
		el.clear();
		map.removeControl(el);
	};	
	/*** reset opaque trails, reset direction arrows ***/
	trails_json.eachLayer(function(layer) {
		layer.setStyle({opacity: 0.75})
	});
	if (selected!== null) selected.setText(null);
	/*** make info panel disappear ***/
	$("#info-div").slideUp(200, function() {
		map.invalidateSize();
	});
});