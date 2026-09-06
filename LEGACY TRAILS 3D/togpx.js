// togpx - Convert GeoJSON to GPX
(function(window) {
    function togpx(geojson, options) {
        options = options || {};

        function addPoints(points, gpx, options) {
            points.forEach(function(p) {
                var wpt = createNode('wpt', {
                    lat: p.coordinates[1],
                    lon: p.coordinates[0]
                });
                if (options.featureTitle(p.properties)) {
                    wpt.appendChild(createNode('name', {}, options.featureTitle(p.properties)));
                }
                if (options.featureDescription(p.properties)) {
                    wpt.appendChild(createNode('desc', {}, options.featureDescription(p.properties)));
                }
                if (p.properties.time) {
                    wpt.appendChild(createNode('time', {}, p.properties.time));
                }
                if (p.properties.keywords) {
                    wpt.appendChild(createNode('keywords', {}, p.properties.keywords));
                }
                gpx.appendChild(wpt);
            });
        }

        function addLines(lines, gpx, options) {
            lines.forEach(function(l) {
                var trk = createNode('trk');
                if (options.featureTitle(l.properties)) {
                    trk.appendChild(createNode('name', {}, options.featureTitle(l.properties)));
                }
                if (options.featureDescription(l.properties)) {
                    trk.appendChild(createNode('desc', {}, options.featureDescription(l.properties)));
                }
                if (l.properties.time) {
                    trk.appendChild(createNode('time', {}, l.properties.time));
                }
                if (l.properties.keywords) {
                    trk.appendChild(createNode('keywords', {}, l.properties.keywords));
                }
                var trkseg = createNode('trkseg');
                l.coordinates.forEach(function(c) {
                    var trkpt = createNode('trkpt', {
                        lat: c[1],
                        lon: c[0]
                    });
                    if (c[2]) {
                        trkpt.appendChild(createNode('ele', {}, c[2]));
                    }
                    trkseg.appendChild(trkpt);
                });
                trk.appendChild(trkseg);
                gpx.appendChild(trk);
            });
        }

        function createNode(name, attrs, content) {
            var node = document.createElement(name);
            for (var key in attrs) {
                if (attrs.hasOwnProperty(key)) {
                    node.setAttribute(key, attrs[key]);
                }
            }
            if (content) {
                node.textContent = content;
            }
            return node;
        }

        var gpx = createNode('gpx', {
            version: '1.1',
            creator: options.creator || 'togpx',
            xmlns: 'http://www.topografix.com/GPX/1/1'
        });

        var points = [], lines = [];
        var features;

        if (geojson.type === 'FeatureCollection') {
            features = geojson.features;
        } else if (geojson.type === 'Feature') {
            features = [geojson];
        } else {
            features = [{
                type: 'Feature',
                properties: {},
                geometry: geojson
            }];
        }

        features.forEach(function(f) {
            if (f.geometry === null) return;
            
            var coords = f.geometry.coordinates,
                props = f.properties;

            switch (f.geometry.type) {
                case 'Point':
                    points.push({
                        coordinates: coords,
                        properties: props
                    });
                    break;
                case 'MultiPoint':
                    coords.forEach(function(c) {
                        points.push({
                            coordinates: c,
                            properties: props
                        });
                    });
                    break;
                case 'LineString':
                    lines.push({
                        coordinates: coords,
                        properties: props
                    });
                    break;
                case 'MultiLineString':
                    coords.forEach(function(c) {
                        lines.push({
                            coordinates: c,
                            properties: props
                        });
                    });
                    break;
                case 'Polygon':
                    lines.push({
                        coordinates: coords[0],
                        properties: props
                    });
                    break;
                case 'MultiPolygon':
                    coords.forEach(function(c) {
                        lines.push({
                            coordinates: c[0],
                            properties: props
                        });
                    });
                    break;
                default:
                    console.warn('Unsupported GeoJSON type: ' + f.geometry.type);
            }
        });

        var options = {
            featureTitle: options.featureTitle || function(properties) {
                return properties.title || properties.name || '';
            },
            featureDescription: options.featureDescription || function(properties) {
                return properties.description || '';
            }
        };

        if (points.length) addPoints(points, gpx, options);
        if (lines.length) addLines(lines, gpx, options);

        var serializer = new XMLSerializer();
        return serializer.serializeToString(gpx);
    }

    // Expose the togpx function globally
    window.togpx = togpx;
})(window); 