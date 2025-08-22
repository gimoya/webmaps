/* PW protection */
function trim(str) {
	return str.replace(/^\s+|\s+$/g, '');  
}

var pw_prompt = prompt('Bitte Passwort eingeben (Anfrage per E-Mail an: kay@tiroltrailhead.com), um auf die **ELBA TRAIL MAP** zu gelangen..',' ');
var pw = 'gimmegimme';
// if prompt is cancelled the pw_prompt var will be null!
if (pw_prompt == null) {
	alert('Kein Passwort wurde angegeben, **ELBA TRAIL MAP** wird nicht geladen...');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();
	}
	window.location='http://tiroltrailhead.com/guiding';
}
if (trim(pw_prompt) == pw ) {
	alert('Passwort richtig!');
} else {
	alert('Falsches Passwort, **ELBA TRAIL MAP** wird nicht geladen..');
	if (bowser.msie) {
		document.execCommand('Stop');
	} else {
		window.stop();
	}
	window.location='http://tiroltrailhead.com/guiding';
}


/*** Add base maps with controls ***/
var map = L.map('map', {
  center: [42.808660, 10.375],
  zoom: 12,
  maxZoom: 18,
  minZoom: 11,
  zoomControl: false,
  attributionControl: false
});

new L.control.attribution({position: 'bottomright'}).addTo(map);
new L.Control.Zoom({ position: 'topright' }).addTo(map);

var toggle = L.easyButton({
  position: 'topright',
  states: [{
	stateName: 'basemap-outdoor',
	icon: '<span class="custom-control">T</span>',
	title: 'change basemap back to satellite',		
	onClick: function(control) {
	  map.removeLayer(mapbox_outdoorLayer);
	  map.addLayer(mapbox_satelliteLayer);
	  control.state('basemap-satellite');
	}
  }, {
	stateName: 'basemap-satellite',
	icon: '<span class="custom-control">S</span>',
	title: 'change basemap to outdoor/terrain',
	onClick: function(control) {
	  map.removeLayer(mapbox_satelliteLayer);
	  map.addLayer(mapbox_outdoorLayer);
	  control.state('basemap-outdoor');
	},
  }]
});	

toggle.addTo(map);

var mapbox_Attr = 'Tiles &copy; <a href="https://www.mapbox.com">mapbox</a> | Design &copy; <a href="http://www.tiroltrailhead.com/guiding">Tirol Trailhead</a>';  
var mapbox_satelliteUrl = 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v10/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ';
var mapbox_outdoorUrl = 'https://api.mapbox.com/styles/v1/mapbox/outdoors-v10/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ';

var mapbox_satelliteLayer = L.tileLayer(mapbox_satelliteUrl, {
  attribution: mapbox_Attr 
});

var mapbox_outdoorLayer = L.tileLayer(mapbox_outdoorUrl, {
  attribution: mapbox_Attr 
});		

mapbox_outdoorLayer.addTo(map);	


/*** Set up Elevation Control ***/

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
	
	
// add location control

L.control.locate({
    strings: {
        title: "Show me my location!"
    },
	position: 'topright'
}).addTo(map);	
		
/*** Trail Style-Helper Functions ***/

function highlight (layer) {	// will be used on hover
	layer.setStyle({
		weight: 4,
		dashArray: '',
		opacity: 0.95
	});
	if (!L.Browser.ie && !L.Browser.opera) {
		layer.bringToFront();
	}	
}

function getColor(description) { // ..used inside styleLines function. will color trails according to description details..
	var color;
	color = description.indexOf('K!') > -1 ? "#E53E38" : "#1F5AAA";
	// trails with ? classification (unknown, planned but not yet been there) should be pink
	if (description.indexOf('?') > -1) {color = "#FF69B4"}
	// trails with X! classification (been there, and it was shit) should be grey
	if (description.indexOf('X!') > -1) {color = "#BCBCBC"}	
	return color
}

function styleLines(feature) {	// deafult style used for constructor of json
    return {
		color: getColor(feature.properties.description),
		weight: 3,
		opacity: 0.8,
		lineJoin: 'round',  //miter | round | bevel 
    };
}


/*** Map and Json Layer Event Listeners and Helper Functions ***/
			
var lyr;
var ftr;
var trails_json;

var selected = null;

function dehighlight (layer) { 	// will be used inside select function
  if (selected === null || selected._leaflet_id !== layer._leaflet_id) {
	  trails_json.resetStyle(layer);
	  layer.setText(null);
  }
}

function select (layer) {  // ..use inside onClick Function doClickStuff() to select and style clicked feature 
  if (selected !== null) {
	var previous = selected;
  }
	map.fitBounds(layer.getBounds());
	selected = layer;
	if (previous) {
	  dehighlight(previous);
	}
}

function doClickStuff(e) {
	
	lyr = e.target;
	ftr = e.target.feature;
	
	select(lyr);
	lyr.setText('- - - ►             ', { repeat: true, offset: 11, attributes: {fill:  getColor(ftr.properties.description), 'font-weight': 'bold', 'font-size': '12'} });
	
	/*** Elevation Control ***/
		
	if (typeof el !== 'undefined') {
		// the variable is defined
		el.clear();
		map.removeControl(el);
	};	
	
	L.DomEvent.stopPropagation(e);
    el.addData(ftr, lyr);
    map.addControl(el);	
	
	/*** make all non-selected trails opaque, after resetting styles (ftr selected before)***/ 
	
	trails_json.eachLayer(function(layer){ if(selected._leaflet_id !== layer._leaflet_id) {
		dehighlight(layer);
		layer.setStyle({opacity: 0.4})
		}
	});
	
}

/*** Add Trails ***/

/* Start/End pts in different pane ontop pf trails */ 
map.createPane('ptsPane');
map.getPane('ptsPane').style.zIndex = 600;

$.getJSON('z_trails_elba.geojson', function(json) {
	
	trails_json = L.geoJson(json, {
		
		style: 	styleLines,
		
		onEachFeature: function(feature, layer) {
			
			var stPt = [ feature.geometry.coordinates[0][1], feature.geometry.coordinates[0][0],  ]; // need to flip xy-coords!
			var endPt = [ feature.geometry.coordinates[feature.geometry.coordinates.length - 1][1], feature.geometry.coordinates[feature.geometry.coordinates.length - 1][0] ];
			
			// Add Start and End Markers to each Feature 
			new L.circleMarker(stPt, {
					color: 'darkslategrey',
					fillColor: 'lightgreen',	
					fillOpacity: 1,				
					radius: 5,
					pane: 'ptsPane'
				})
				.bindTooltip(feature.properties.name + ' - Start (' + feature.geometry.coordinates[0][2] + ' m)', {
					permanent: false, 
					direction: 'right'
				})
				.addTo(map);
			
			new L.circleMarker(endPt, {
					color: 'darkslategrey',
					fillColor: 'pink',
					fillOpacity: 1,
					radius: 5,
					pane: 'ptsPane'
				})	
				.bindTooltip(feature.properties.name + ' - End (' + feature.geometry.coordinates[feature.geometry.coordinates.length - 1][2] + ' m)', {
					permanent: false, 
					direction: 'right'
				})
				.addTo(map)	
			
			// on events
			layer.on({		
				'mouseover': function (e) {
					highlight(e.target);
				},
				'mouseout': function (e) {
					dehighlight(e.target);
				},
				'click': doClickStuff
			});			
	
			/*** add a popup to each feature and.. ***/ 	
			/*** ..set GPX link ***/
			var bb = new Blob([togpx(feature)], {type: 'text/plain'});
			var gpxLink = document.createElement("a");
			gpxLink.href = window.URL.createObjectURL(bb);		
			gpxLink.download = feature.properties.name + ".gpx";
			gpxLink.innerHTML = "GPX";			
			var popupContent = '<h2 class="map-popup">' + feature.properties.name + '</h2>' + '<div>' + feature.properties.description + '</div>' + gpxLink.outerHTML;
			layer.bindPopup(popupContent, {closeOnClick: true, className: 'trailPopupClass'});
		}
	}).addTo(map);
	map.fitBounds(trails_json.getBounds(), {maxZoom: 14});
});

/*
Points of interest
*/

var POIs = {
"type": "FeatureCollection",
"name": "POIs",
"crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
"features": [
		{ "type": "Feature", "properties": { "name": "Calendozio Minen", "description": "Mini Rampage! <a href=\"https://google.com\/maps\/search\/Calendozio Minen\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.433195000778694, 42.846563435712767 ] } },
		{ "type": "Feature", "properties": { "name": "Bar & Crepes 'I Sassirossi' - Cavo", "description": "Super Crepes;).. <a href=\"https://google.com\/maps\/search\/Bar & Crepes 'I Sassirossi' - Cavo\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.421687105111864, 42.859251223462977 ] } },
		{ "type": "Feature", "properties": { "name": "Bar & Ristorante 'La Piazza' - Rio Nell'Elba", "description": "Feines Essen und nette Leute, auch zu mittag.. <a href=\"https://google.com\/maps\/search\/Bar & Ristorante 'La Piazza' - Rio Nell'Elba\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.401553011790016, 42.813766757348091 ] } },
		{ "type": "Feature", "properties": { "name": "Aloe B & B Ranch Elba", "description": "Coole Unterkunft.. <a href=\"https://google.com\/maps\/search\/Aloe B & B Ranch Elba\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.408682377036765, 42.811250255377345 ] } },
		{ "type": "Feature", "properties": { "name": "PP 'Le Panche'", "description": "Shuttle-Parkplatz.. <a href=\"https://google.com\/maps\/search\/PP 'Le Panche'\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.393229679804257, 42.808642183011926 ] } },
		{ "type": "Feature", "properties": { "name": "Ristorante Mare - Magazzini", "description": "Nette Einkehr mit Aperol nach Buca del Bandito.. <a href=\"https://google.com\/maps\/search\/Ristorante Mare - Magazzini\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.358303702245937, 42.799840744001706 ] } },
		{ "type": "Feature", "properties": { "name": "Bar Ristorante Le Palme - Bagnaia", "description": "Nette Einkehr mit Aperol nach Scalette.. <a href=\"https://google.com\/maps\/search\/Bar Ristorante Le Palme - Bagnaia\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.36372817884163, 42.810643588703883 ] } },
		{ "type": "Feature", "properties": { "name": "Bar & Stabilimento Mandel", "description": "Feinste Strandbar und super nette Leute, immer wieder mal abends eine Fete!.. <a href=\"https://google.com\/maps\/search\/Bar & Stabilimento Mandel\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.372453924676392, 42.732403377493846 ] } },
		{ "type": "Feature", "properties": { "name": "Minimarkt - Lacona", "description": "Snack und Getränke Stop.. <a href=\"https://google.com\/maps\/search\/Minimarkt & Bankomat - Lacona\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.313554269928702, 42.765188059048825 ] } },
		{ "type": "Feature", "properties": { "name": "Tratoria 'Orti di Mare' - Lacona", "description": "Super nette Laube und feinste Sachen zu essen und zu trinken aus der eigenen Agrikultur.. <a href=\"https://google.com\/maps\/search\/Tratoria 'Orti di Mare' - Lacona\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.309327836357474, 42.764830547047488 ] } },
		{ "type": "Feature", "properties": { "name": "Ristorante Cacio & Vino - San Piero", "description": "Beste Essen weit und breit - Reservierung am abend meistens notwedig!.. <a href=\"https://google.com\/maps\/search\/Ristorante Cacio & Vino - San Piero\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.211601766564495, 42.751601080030852 ] } },
		{ "type": "Feature", "properties": { "name": "Bar Spiaggia Cavoli", "description": "Feiner Aperol Stop nach Bolle Caldaie Trail!.. <a href=\"https://google.com\/maps\/search\/Bar Spiaggia Cavoli\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.186399316735942, 42.73738496151384 ] } },
		{ "type": "Feature", "properties": { "name": "Minimarkt - Seccheto", "description": "Snacks und Getränke Stop!.. <a href=\"https://google.com\/maps\/search\/Minimarkt - Seccheto\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.176845708130028, 42.73769072758364 ] } },
		{ "type": "Feature", "properties": { "name": "Panificio - Seccheto", "description": "Super toskanische Backwaren.. <a href=\"https://google.com\/maps\/search\/Panificio - Seccheto\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.177415675024058, 42.737597700262853 ] } },
		{ "type": "Feature", "properties": { "name": "Baba Pizza - Pomonte", "description": "Nette Einkehr!.. <a href=\"https://google.com\/maps\/search\/Baba Pizza - Pomonte\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.1208601, 42.7486187 ] } },
		{ "type": "Feature", "properties": { "name": "Mini Market - Pomonte", "description": "Snack und Getränke Stop.. <a href=\"https://google.com\/maps\/search\/Mini Market - Pomonte\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.121819933812914, 42.748386473414676 ] } },
		{ "type": "Feature", "properties": { "name": "Hotel & Bar 'Il Perseo' - Chiessi", "description": "Snack und Getränke Stop nach Semaforo - Chiessi Trail.. <a href=\"https://google.com\/maps\/search\/Hotel & Bar 'Il Perseo' - Chiessi\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.113424194143604, 42.759005039240684 ] } },
		{ "type": "Feature", "properties": { "name": "Hotel & Bar Bel Mare Patresi", "description": "Bike-Hotel, super nette Leute!! Bike Guide Matteo Anselmi.. <a href=\"https://google.com\/maps\/search\/Hotel & Bar Bel Mare Patresi\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.117820207820397, 42.791279815618402 ] } },
		{ "type": "Feature", "properties": { "name": "Osteria Del Noce - Marcianna", "description": "SUPER Essen!.. <a href=\"https://google.com\/maps\/search\/Osteria Del Noce - Marcianna\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.167205994929112, 42.790316468951815 ] } },
		{ "type": "Feature", "properties": { "name": "Pizzeria & Bar 'Bagni Paola' - Procchio", "description": "Total nette Einkehrmöglichkeit in Procchio nach Gardiola Trail!.. <a href=\"https://google.com\/maps\/search\/Pizzeria & Bar 'Bagni Paola' - Procchio\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.247504370542897, 42.789433590132184 ] } },
		{ "type": "Feature", "properties": { "name": "Osteria Locanda Cecconi - Porto Azzurro", "description": "Gutes Restaurant in Porto Azzurro - ganzjährig offen!.. <a href=\"https://google.com\/maps\/search\/Osteria Locanda Cecconi - Porto Azzurro\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.398243648910684, 42.765950601670468 ] } },
		{ "type": "Feature", "properties": { "name": "Pizzeria Da Giuseppe - Porto Azzurro", "description": "Gutes, einfaches Restaurant in Porto Azzurro - ganzjährig offen!.. <a href=\"https://google.com\/maps\/search\/Pizzeria Da Giuseppe - Porto Azzurro\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.395422349335403, 42.765225325040845 ] } },
		{ "type": "Feature", "properties": { "name": "Bar Alta Luna - Porto Azzurro", "description": "Sehr coole Bar in Porto Azzurro.. Ganzjährig offen!.. <a href=\"https://google.com\/maps\/search\/Bar Alta Luna - Porto Azzurro\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.398409293393327, 42.765735721919597 ] } },
		{ "type": "Feature", "properties": { "name": "Il Veliero Bar - Marina di Campo", "description": "Feine Bar im Hafen von Marina di Campo.. <a href=\"https://google.com\/maps\/search\/Il Veliero Bar - Marina di Campo\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.236144660833816, 42.742844995518332 ] } },
		{ "type": "Feature", "properties": { "name": "Padulella Beach - Portoferraio", "description": "Mega Strand!! Im Herbst nur früh am vormittag mit Sonne.. '<a href=\"https://google.com\/maps\/search\/padulella\" target=\"_blank\">Google Maps Suche<\/a>" }, "geometry": { "type": "Point", "coordinates": [ 10.316145899983903, 42.819899612773597 ] } },
		{ "type": "Feature", "properties": { "name": "Finca Terra e Cuore", "description": "Nette Einkehr, Finca mit sehr einfachem Essen und Trinken, aber super netter Platz.." }, "geometry": { "type": "Point", "coordinates": [ 10.376890230902958, 42.779867267697703 ] } }
	]
}


var POIs_Icon = L.icon({
	iconUrl: 'https://gimoya.github.io/elba_trails/images/marker.svg',
	iconSize: [16, 28], // size of the icon
	});

for (i = 0; i < POIs.features.length; i++) { 
	new L.marker(L.GeoJSON.coordsToLatLng(POIs.features[i].geometry.coordinates), {
				icon: POIs_Icon,
				zIndexOffset: 10000,
				riseOnHover: true,
				pane: 'ptsPane'})
			.bindPopup('<h2>'+POIs.features[i].properties.name+'</h2>'+POIs.features[i].properties.description, 
				{
					closeButton: true,
					autoClose: false,
					direction: 'right'
				}
			)
			.addTo(map);
	}

/*** Map Event Listeners ***/

map.on("click", function(e){
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
	
});

