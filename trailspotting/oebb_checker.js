/**
 * ÖBB Schedule Checker - Node.js Version
 * Run with: node oebb_checker.js
 */

const https = require('https');
const http = require('http');

// Your current schedule data
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
 * Make HTTP request to ÖBB API
 */
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        }, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    reject(new Error(`JSON parse error: ${error.message}`));
                }
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(15000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Fetch all departures between 9 AM and 5 PM for a route
 */
async function fetchAllDepartures(from, to, date) {
    const baseUrl = 'https://v6.oebb.transport.rest';
    
    try {
        console.log(`  🔍 Searching for stations: ${from}, ${to}`);
        
        // Search for stations
        const fromStationUrl = `${baseUrl}/locations?query=${encodeURIComponent(from)}&poi=false&addresses=false`;
        const toStationUrl = `${baseUrl}/locations?query=${encodeURIComponent(to)}&poi=false&addresses=false`;
        
        const [fromData, toData] = await Promise.all([
            makeRequest(fromStationUrl),
            makeRequest(toStationUrl)
        ]);
        
        console.log(`  📍 Found stations: ${fromData.length} for ${from}, ${toData.length} for ${to}`);
        
        if (!fromData.length || !toData.length) {
            console.log(`  ❌ Station not found: ${from} or ${to}`);
            return null;
        }
        
        const fromStationInfo = fromData[0];
        const toStationInfo = toData[0];
        
        console.log(`  📍 Found stations: ${fromStationInfo.name} → ${toStationInfo.name}`);
        
        // Get departures for the entire day (9 AM to 5 PM)
        const departuresUrl = `${baseUrl}/departures?station=${fromStationInfo.id}&when=${date}T09:00:00&duration=480&direction=${toStationInfo.id}`;
        
        console.log(`  🚂 Fetching departures: ${fromStationInfo.name} → ${toStationInfo.name}`);
        
        const departuresData = await makeRequest(departuresUrl);
        
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
 * Compare local schedule with ÖBB API data
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
 * Main function to check all schedules
 */
async function checkAllSchedules() {
    const today = new Date().toISOString().split('T')[0];
    const results = {};
    
    console.log('🚂 Checking ÖBB schedules...\n');
    
    for (const [routeName, routeData] of Object.entries(localSchedules)) {
        console.log(`📍 Checking ${routeName.toUpperCase()}:`);
        results[routeName] = [];
        
        for (const connection of routeData.connections) {
            if (connection.time.includes('every')) {
                console.log(`  ⏰ ${connection.from} → ${connection.to}: ${connection.type} (${connection.time})`);
                results[routeName].push({
                    connection,
                    status: 'frequent_service',
                    message: 'Frequent service - manual verification needed'
                });
                continue;
            }
            
            // Extract departure time from local data
            const departureTime = connection.time.split('-')[0];
            
            console.log(`  🔍 Checking ${connection.from} → ${connection.to} at ${departureTime}...`);
            
            const apiData = await fetchOebbSchedule(connection.from, connection.to, today, departureTime);
            const comparison = compareSchedules(connection, apiData);
            
            results[routeName].push(comparison);
            
            if (comparison.status === 'compared') {
                const status = comparison.match ? '✅' : '⚠️';
                console.log(`    ${status} Local: ${connection.time} (${connection.duration}) | API: ${comparison.api.departure}-${comparison.api.arrival} (${comparison.api.duration})`);
            } else {
                console.log(`    ❌ ${comparison.message}`);
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log('');
    }
    
    return results;
}

/**
 * Generate summary report
 */
function generateSummary(results) {
    console.log('\n📊 SUMMARY REPORT');
    console.log('==================');
    
    let totalChecks = 0;
    let matches = 0;
    let mismatches = 0;
    let noData = 0;
    
    for (const [routeName, routeResults] of Object.entries(results)) {
        console.log(`\n${routeName.toUpperCase()}:`);
        
        for (const result of routeResults) {
            totalChecks++;
            
            if (result.status === 'compared') {
                if (result.match) {
                    matches++;
                    console.log(`  ✅ ${result.local.from} → ${result.local.to}: MATCH`);
                } else {
                    mismatches++;
                    console.log(`  ⚠️  ${result.local.from} → ${result.local.to}: MISMATCH`);
                    console.log(`     Local: ${result.local.time} (${result.local.duration})`);
                    console.log(`     API:   ${result.api.departure}-${result.api.arrival} (${result.api.duration})`);
                }
            } else if (result.status === 'no_data') {
                noData++;
                console.log(`  ❌ ${result.local.from} → ${result.local.to}: NO DATA`);
            } else {
                console.log(`  ⏰ ${result.connection.from} → ${result.connection.to}: FREQUENT SERVICE`);
            }
        }
    }
    
    console.log('\n📈 STATISTICS:');
    console.log(`Total checks: ${totalChecks}`);
    console.log(`Matches: ${matches} (${Math.round(matches/totalChecks*100)}%)`);
    console.log(`Mismatches: ${mismatches} (${Math.round(mismatches/totalChecks*100)}%)`);
    console.log(`No data: ${noData} (${Math.round(noData/totalChecks*100)}%)`);
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
function calculateArrivalAndDuration(departure, from, to) {
    const departureTime = new Date(departure.when);
    const durationMinutes = getDurationForRoute(from, to);
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
function getDurationForRoute(from, to) {
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
            const routeData = await fetchAllDepartures(route.from, route.to, today);
            
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
            results[`${route.from}-${route.to}`] = {
                fromStation: route.from,
                toStation: route.to,
                departures: [],
                error: error.message
            };
        }
        
        console.log('');
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
}

// Run the checker
if (require.main === module) {
    checkAllDepartures()
        .then(results => {
            console.log('\n📊 SUMMARY REPORT');
            console.log('==================');
            
            let totalRoutes = Object.keys(results).length;
            let successfulRoutes = 0;
            let totalDepartures = 0;
            
            for (const [routeKey, routeData] of Object.entries(results)) {
                console.log(`\n${routeKey}:`);
                
                if (routeData.error) {
                    console.log(`  ❌ Error: ${routeData.error}`);
                } else if (routeData.departures.length === 0) {
                    console.log(`  ⚠️  No departures found`);
                } else {
                    successfulRoutes++;
                    console.log(`  ✅ Found ${routeData.departures.length} departures`);
                    totalDepartures += routeData.departures.length;
                }
            }
            
            console.log('\n📈 STATISTICS:');
            console.log(`Total routes checked: ${totalRoutes}`);
            console.log(`Successful routes: ${successfulRoutes}`);
            console.log(`Total departures found: ${totalDepartures}`);
        })
        .catch(error => {
            console.error('❌ Fatal error:', error.message);
            process.exit(1);
        });
}

module.exports = { checkAllDepartures };
