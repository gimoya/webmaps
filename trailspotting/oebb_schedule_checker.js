/**
 * ÖBB Schedule Checker Script
 * Automatically fetches train/bus schedules from ÖBB API and compares with local data
 */

// Your current schedule data from the HTML file
const localSchedules = {
    routeA: {
        connections: [
            { from: "Hall", to: "Schwaz", time: "09:29-09:40", duration: "11min", type: "REX" },
            { from: "Terfens/W", to: "Innsbruck", time: "12:08-11:25", duration: "17min", type: "S4-Telfs/Pf" },
            { from: "Terfens/W", to: "Innsbruck", time: "12:38-12:55", duration: "17min", type: "S5-Ötztal" }
        ]
    },
    routeB: {
        connections: [
            { from: "Hall", to: "Münster/W", time: "09:45-10:12", duration: "27min", type: "S4-Kufstein" },
            { from: "Brixlegg", to: "Schwaz", time: "11:42-11:58", duration: "16min", type: "S4-Telfs/Pf" },
            { from: "Brixlegg", to: "Schwaz", time: "12:06-12:19", duration: "13min", type: "REX-Land" },
            { from: "Terfens/W", to: "Innsbruck", time: "14:38-14:55", duration: "17min", type: "S4-Telfs/Pf" },
            { from: "Terfens/W", to: "Innsbruck", time: "15:08-15:25", duration: "17min", type: "S5-Ötztal" }
        ]
    },
    routeC: {
        connections: [
            { from: "Hall", to: "Walderbrücke", time: "10:20-10:35", duration: "15min", type: "Bus 3,6,7" },
            { from: "Hall", to: "Innsbruck", time: "12:04-12:13", duration: "9min", type: "S5-Steinach" },
            { from: "Hall", to: "Innsbruck", time: "12:15-12:25", duration: "10min", type: "S4-Telfs/Pf" }
        ]
    },
    routeD: {
        connections: [
            { from: "Innsbruck", to: "Stams", time: "10:52-11:17", duration: "25min", type: "REX" },
            { from: "Telfs", to: "Innsbruck", time: "every 15min", duration: "varies", type: "REX/S4/S5" }
        ]
    },
    routeDD: {
        connections: [
            { from: "Innsbruck", to: "Reith", time: "11:08-11:39", duration: "31min", type: "S6" },
            { from: "Völs", to: "Innsbruck", time: "13:53-14:01", duration: "8min", type: "S5" }
        ]
    }
};

/**
 * Fetch all departures between 9 AM and 5 PM for a route
 * @param {string} from - Origin station
 * @param {string} to - Destination station  
 * @param {string} date - Date in YYYY-MM-DD format
 */
async function fetchAllDepartures(from, to, date) {
    const baseUrl = 'https://v6.oebb.transport.rest';
    const corsProxy = 'https://cors-anywhere.herokuapp.com/';
    
    try {
        console.log(`  🔍 Searching for stations: ${from}, ${to}`);
        
        // Search for stations first
        const fromStationUrl = `${corsProxy}${baseUrl}/locations?query=${encodeURIComponent(from)}&poi=false&addresses=false`;
        const toStationUrl = `${corsProxy}${baseUrl}/locations?query=${encodeURIComponent(to)}&poi=false&addresses=false`;
        
        const fromStation = await fetch(fromStationUrl, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const toStation = await fetch(toStationUrl, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!fromStation.ok || !toStation.ok) {
            console.log(`  ❌ HTTP error: ${fromStation.status} or ${toStation.status}`);
            console.log(`  📝 Error details: ${fromStation.status === 403 ? 'CORS blocked' : 'API error'}`);
            return null;
        }
        
        const fromData = await fromStation.json();
        const toData = await toStation.json();
        
        if (!fromData.length || !toData.length) {
            console.log(`  ❌ Station not found: ${from} or ${to}`);
            return null;
        }
        
        const fromStationInfo = fromData[0];
        const toStationInfo = toData[0];
        
        console.log(`  📍 Found stations: ${fromStationInfo.name} → ${toStationInfo.name}`);
        
        // Get departures for the entire day (9 AM to 5 PM)
        const departuresUrl = `${corsProxy}${baseUrl}/departures?station=${fromStationInfo.id}&when=${date}T09:00:00&duration=480&direction=${toStationInfo.id}`;
        
        const departuresResponse = await fetch(departuresUrl, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!departuresResponse.ok) {
            console.log(`  ❌ Departures fetch error: ${departuresResponse.status}`);
            console.log(`  📝 Error details: ${departuresResponse.status === 403 ? 'CORS blocked' : 'API error'}`);
            return null;
        }
        
        const departuresData = await departuresResponse.json();
        
        // Filter departures going to the destination and within time range
        const relevantDepartures = departuresData.departures.filter(departure => {
            const departureTime = new Date(departure.when);
            const hour = departureTime.getHours();
            
            // Check if it's between 9 AM and 5 PM
            if (hour < 9 || hour >= 17) return false;
            
            // Check if it goes to our destination
            return departure.direction && departure.direction.includes(toStationInfo.name);
        });
        
        console.log(`  ✅ Found ${relevantDepartures.length} departures between 9 AM and 5 PM`);
        
        return {
            fromStation: fromStationInfo,
            toStation: toStationInfo,
            departures: relevantDepartures
        };
        
    } catch (error) {
        console.error(`  ❌ Error fetching departures for ${from} to ${to}:`, error.message);
        return null;
    }
}

/**
 * Simulate departures data (fallback when API fails)
 */
async function fetchAllDeparturesSimulated(from, to, date) {
    // Known station mappings
    const stationMappings = {
        'Hall': { name: 'Hall in Tirol', id: 'hall-tirol' },
        'Schwaz': { name: 'Schwaz', id: 'schwaz' },
        'Innsbruck': { name: 'Innsbruck Hbf', id: 'innsbruck-hbf' },
        'Münster/W': { name: 'Münster-Westendorf', id: 'muenster-westendorf' },
        'Brixlegg': { name: 'Brixlegg', id: 'brixlegg' },
        'Terfens/W': { name: 'Terfens-Weer', id: 'terfens-weer' },
        'Walderbrücke': { name: 'Walderbrücke', id: 'walderbruecke' },
        'Stams': { name: 'Stams', id: 'stams' },
        'Telfs': { name: 'Telfs-Pfaffenhofen', id: 'telfs-pfaffenhofen' },
        'Reith': { name: 'Reith bei Seefeld', id: 'reith-seefeld' },
        'Völs': { name: 'Völs', id: 'voels' }
    };
    
    // Generate realistic departures for each route
    const routeDepartures = {
        'Hall-Schwaz': {
            fromStation: stationMappings['Hall'],
            toStation: stationMappings['Schwaz'],
            departures: [
                { when: `${date}T09:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T10:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T11:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T12:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T13:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T14:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T15:29:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T16:29:00`, line: { name: 'REX' }, direction: 'Schwaz' }
            ]
        },
        'Terfens/W-Innsbruck': {
            fromStation: stationMappings['Terfens/W'],
            toStation: stationMappings['Innsbruck'],
            departures: [
                { when: `${date}T09:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T09:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T10:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T10:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T11:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T11:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T12:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T12:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T13:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T13:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T14:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T14:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T15:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T15:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T16:08:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T16:38:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' }
            ]
        },
        'Hall-Münster/W': {
            fromStation: stationMappings['Hall'],
            toStation: stationMappings['Münster/W'],
            departures: [
                { when: `${date}T09:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T10:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T11:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T12:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T13:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T14:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T15:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' },
                { when: `${date}T16:45:00`, line: { name: 'S4' }, direction: 'Münster-Westendorf' }
            ]
        },
        'Brixlegg-Schwaz': {
            fromStation: stationMappings['Brixlegg'],
            toStation: stationMappings['Schwaz'],
            departures: [
                { when: `${date}T09:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T10:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T10:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T11:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T11:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T12:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T12:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T13:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T13:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T14:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T14:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T15:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T15:42:00`, line: { name: 'S4' }, direction: 'Schwaz' },
                { when: `${date}T16:06:00`, line: { name: 'REX' }, direction: 'Schwaz' },
                { when: `${date}T16:42:00`, line: { name: 'S4' }, direction: 'Schwaz' }
            ]
        },
        'Hall-Walderbrücke': {
            fromStation: stationMappings['Hall'],
            toStation: stationMappings['Walderbrücke'],
            departures: [
                { when: `${date}T09:20:00`, line: { name: 'Bus 3' }, direction: 'Walderbrücke' },
                { when: `${date}T10:20:00`, line: { name: 'Bus 6' }, direction: 'Walderbrücke' },
                { when: `${date}T11:20:00`, line: { name: 'Bus 7' }, direction: 'Walderbrücke' },
                { when: `${date}T12:20:00`, line: { name: 'Bus 3' }, direction: 'Walderbrücke' },
                { when: `${date}T13:20:00`, line: { name: 'Bus 6' }, direction: 'Walderbrücke' },
                { when: `${date}T14:20:00`, line: { name: 'Bus 7' }, direction: 'Walderbrücke' },
                { when: `${date}T15:20:00`, line: { name: 'Bus 3' }, direction: 'Walderbrücke' },
                { when: `${date}T16:20:00`, line: { name: 'Bus 6' }, direction: 'Walderbrücke' }
            ]
        },
        'Hall-Innsbruck': {
            fromStation: stationMappings['Hall'],
            toStation: stationMappings['Innsbruck'],
            departures: [
                { when: `${date}T09:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T09:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T10:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T10:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T11:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T11:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T12:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T12:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T13:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T13:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T14:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T14:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T15:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T15:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T16:04:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T16:15:00`, line: { name: 'S4' }, direction: 'Innsbruck Hbf' }
            ]
        },
        'Innsbruck-Stams': {
            fromStation: stationMappings['Innsbruck'],
            toStation: stationMappings['Stams'],
            departures: [
                { when: `${date}T09:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T10:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T11:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T12:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T13:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T14:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T15:52:00`, line: { name: 'REX' }, direction: 'Stams' },
                { when: `${date}T16:52:00`, line: { name: 'REX' }, direction: 'Stams' }
            ]
        },
        'Innsbruck-Reith': {
            fromStation: stationMappings['Innsbruck'],
            toStation: stationMappings['Reith'],
            departures: [
                { when: `${date}T09:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T10:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T11:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T12:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T13:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T14:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T15:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' },
                { when: `${date}T16:08:00`, line: { name: 'S6' }, direction: 'Reith bei Seefeld' }
            ]
        },
        'Völs-Innsbruck': {
            fromStation: stationMappings['Völs'],
            toStation: stationMappings['Innsbruck'],
            departures: [
                { when: `${date}T09:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T10:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T11:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T12:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T13:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T14:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T15:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' },
                { when: `${date}T16:53:00`, line: { name: 'S5' }, direction: 'Innsbruck Hbf' }
            ]
        }
    };
    
    try {
        console.log(`  🔍 Checking route: ${from} → ${to}`);
        
        const routeKey = `${from}-${to}`;
        const mockData = routeDepartures[routeKey];
        
        if (mockData) {
            console.log(`  ✅ Found ${mockData.departures.length} simulated departures for ${routeKey}`);
            return mockData;
        } else {
            console.log(`  ⚠️  No mock data available for ${routeKey}`);
            return null;
        }
    } catch (error) {
        console.error(`  ❌ Error checking route ${from} to ${to}:`, error.message);
        return null;
    }
}

/**
 * Compare local schedule with ÖBB API data
 * @param {Object} localConnection - Local schedule data
 * @param {Object} apiData - Data from ÖBB API
 */
function compareSchedules(localConnection, apiData) {
    if (!apiData || !apiData.journeys || !apiData.journeys.length) {
        return {
            status: 'no_data',
            message: `No API data available for ${localConnection.from} to ${localConnection.to}`
        };
    }
    
    const journey = apiData.journeys[0];
    const departure = new Date(journey.departure);
    const arrival = new Date(journey.arrival);
    const duration = Math.round((arrival - departure) / 60000); // minutes
    
    return {
        status: 'compared',
        local: localConnection,
        api: {
            departure: departure.toTimeString().substr(0, 5),
            arrival: arrival.toTimeString().substr(0, 5),
            duration: `${duration}min`,
            line: journey.legs[0]?.line?.name || 'Unknown'
        },
        match: duration === parseInt(localConnection.duration)
    };
}

/**
 * Extract all unique routes from local schedules
 */
function extractUniqueRoutes() {
    const routes = new Set();
    
    for (const [routeName, routeData] of Object.entries(localSchedules)) {
        for (const connection of routeData.connections) {
            if (!connection.time.includes('every')) {
                const routeKey = `${connection.from}-${connection.to}`;
                routes.add(routeKey);
            }
        }
    }
    
    return Array.from(routes).map(route => {
        const [from, to] = route.split('-');
        return { from, to };
    });
}

/**
 * Calculate arrival time and duration for a departure
 */
function calculateArrivalAndDuration(departure, routeType) {
    const departureTime = new Date(departure.when);
    const durationMinutes = getDurationForRoute(departure.from, departure.to, routeType);
    const arrivalTime = new Date(departureTime.getTime() + durationMinutes * 60000);
    
    return {
        departure: departureTime.toTimeString().substr(0, 5),
        arrival: arrivalTime.toTimeString().substr(0, 5),
        duration: `${durationMinutes}min`,
        line: departure.line.name
    };
}

/**
 * Get duration for specific routes (based on your local data)
 */
function getDurationForRoute(from, to, routeType) {
    const durations = {
        'Hall-Schwaz': 11,
        'Terfens/W-Innsbruck': 17,
        'Hall-Münster/W': 27,
        'Brixlegg-Schwaz': 16, // S4, REX is 13
        'Hall-Walderbrücke': 15,
        'Hall-Innsbruck': 9, // S5, S4 is 10
        'Innsbruck-Stams': 25,
        'Innsbruck-Reith': 31,
        'Völs-Innsbruck': 8
    };
    
    const routeKey = `${from}-${to}`;
    return durations[routeKey] || 15; // Default 15 minutes
}

/**
 * Main function to check all departures between 9 AM and 5 PM
 */
async function checkAllDepartures() {
    const today = new Date().toISOString().split('T')[0];
    const results = {};
    
    console.log('🚂 Checking all departures between 9 AM and 5 PM...\n');
    
    // Extract all unique routes
    const uniqueRoutes = extractUniqueRoutes();
    console.log(`📍 Found ${uniqueRoutes.length} unique routes to check:\n`);
    
    for (const route of uniqueRoutes) {
        console.log(`🔍 Checking route: ${route.from} → ${route.to}`);
        
        try {
            // Try real API only - no simulation
            let routeData = await fetchAllDepartures(route.from, route.to, today);
            
            if (!routeData) {
                console.log(`  ❌ API failed - no data available`);
                results[`${route.from}-${route.to}`] = {
                    fromStation: route.from,
                    toStation: route.to,
                    departures: [],
                    error: 'API request failed - likely CORS blocked (403 error) or station not found'
                };
                continue;
            }
            
            if (routeData && routeData.departures.length > 0) {
                results[`${route.from}-${route.to}`] = {
                    fromStation: routeData.fromStation.name,
                    toStation: routeData.toStation.name,
                    departures: routeData.departures.map(departure => {
                        const timing = calculateArrivalAndDuration(departure, route.from, route.to);
                        return {
                            departure: timing.departure,
                            arrival: timing.arrival,
                            duration: timing.duration,
                            line: timing.line,
                            direction: departure.direction
                        };
                    })
                };
                
                console.log(`  ✅ Found ${routeData.departures.length} departures:`);
                routeData.departures.forEach((departure, index) => {
                    const timing = calculateArrivalAndDuration(departure, route.from, route.to);
                    console.log(`    ${index + 1}. ${timing.departure} → ${timing.arrival} (${timing.duration}) ${timing.line}`);
                });
            } else {
                console.log(`  ❌ No departures found for ${route.from} → ${route.to}`);
                results[`${route.from}-${route.to}`] = {
                    fromStation: route.from,
                    toStation: route.to,
                    departures: [],
                    error: 'No departures found'
                };
            }
            
        } catch (error) {
            console.error(`  ❌ Error checking ${route.from} → ${route.to}:`, error.message);
            console.error(`  📝 Error type: ${error.name}`);
            results[`${route.from}-${route.to}`] = {
                fromStation: route.from,
                toStation: route.to,
                departures: [],
                error: `${error.name}: ${error.message}`
            };
        }
        
        console.log('');
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
}

/**
 * Generate HTML report
 */
function generateReport(results) {
    let html = '<h2>ÖBB Schedule Verification Report</h2>';
    html += `<p>Generated: ${new Date().toLocaleString()}</p>`;
    
    for (const [routeName, routeResults] of Object.entries(results)) {
        html += `<h3>Route ${routeName.toUpperCase()}</h3><ul>`;
        
        for (const result of routeResults) {
            if (result.status === 'compared') {
                const status = result.match ? '✅ Match' : '⚠️ Mismatch';
                html += `<li>${status}: ${result.local.from} → ${result.local.to}</li>`;
                html += `<ul><li>Local: ${result.local.time} (${result.local.duration})</li>`;
                html += `<li>API: ${result.api.departure}-${result.api.arrival} (${result.api.duration})</li></ul>`;
            } else {
                html += `<li>❌ ${result.message}</li>`;
            }
        }
        html += '</ul>';
    }
    
    return html;
}

// Export functions for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkAllDepartures, generateReport };
} else {
    // Browser environment
    window.OebbScheduleChecker = { checkAllDepartures, generateReport };
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
    console.log('ÖBB Departure Checker loaded. Run checkAllDepartures() to start verification.');
}
