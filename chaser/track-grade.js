// Portion length in meters. Grade is classed once per step of this distance.
const RESOLUTION_M = 100;

// Rise/run above this is uphill. 0.02 is a 2% grade. The rest is flat or downhill.
const UPHILL_SLOPE = 0.02;

// points: [{ lat, lon, z? }, ...] with optional z in meters (missing → 0 for grade).
// Returns [{ kind: "uphill" | "flat", latLngs: [[lat, lon], ...], distance }, ...].
(function (root) {
  function haversineMeters(a, b) {
    const earth = 6371000;
    const toRad = (degrees) => degrees * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * earth * Math.asin(Math.sqrt(h));
  }

  function sampleAt(points, cumulative, meters) {
    if (meters <= 0) return points[0];
    const last = points.length - 1;
    if (meters >= cumulative[last]) return points[last];
    for (let index = 1; index < points.length; index += 1) {
      if (cumulative[index] < meters) continue;
      const span = cumulative[index] - cumulative[index - 1];
      const t = span === 0 ? 0 : (meters - cumulative[index - 1]) / span;
      const from = points[index - 1];
      const to = points[index];
      const fromZ = Number.isFinite(from.z) ? from.z : 0;
      const toZ = Number.isFinite(to.z) ? to.z : 0;
      return {
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
        z: fromZ + (toZ - fromZ) * t
      };
    }
    return points[last];
  }

  function splitTrackByGrade(points) {
    const cumulative = [0];
    for (let index = 1; index < points.length; index += 1) {
      cumulative.push(cumulative[index - 1] + haversineMeters(points[index - 1], points[index]));
    }
    const total = cumulative[cumulative.length - 1];
    const portions = [];
    for (let startM = 0; startM < total; startM += RESOLUTION_M) {
      const endM = Math.min(total, startM + RESOLUTION_M);
      const start = sampleAt(points, cumulative, startM);
      const end = sampleAt(points, cumulative, endM);
      const latLngs = [[start.lat, start.lon]];
      for (let index = 1; index < points.length; index += 1) {
        if (cumulative[index] > startM && cumulative[index] < endM) {
          latLngs.push([points[index].lat, points[index].lon]);
        }
      }
      latLngs.push([end.lat, end.lon]);
      const distance = endM - startM;
      portions.push({
        kind: ((Number.isFinite(end.z) ? end.z : 0) - (Number.isFinite(start.z) ? start.z : 0)) / distance > UPHILL_SLOPE ? "uphill" : "flat",
        distance,
        latLngs
      });
    }
    return portions;
  }

  root.TRACK_GRADE_RESOLUTION_M = RESOLUTION_M;
  root.TRACK_GRADE_UPHILL_SLOPE = UPHILL_SLOPE;
  root.splitTrackByGrade = splitTrackByGrade;
})(window);
