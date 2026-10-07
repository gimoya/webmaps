// Minimum spacing between kept vertices, in meters.
// The first and last point always stay. A later point is kept only when it is
// at least this far from the previous kept point.
const MIN_SPACING_M = 10;

// xml: GPX 1.1 text.
// Returns { error } or { name, points } with points already spaced.
// points: [{ lat, lon, z? }, ...] with optional z in meters from <ele>.
(function (root) {
  const GPX_NS = "http://www.topografix.com/GPX/1/1";

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

  function childText(parent, name) {
    const child = parent.getElementsByTagNameNS(GPX_NS, name)[0];
    return child ? child.textContent.trim() : "";
  }

  function thinTrackPoints(points) {
    if (points.length < 2) return points.slice();
    const kept = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index];
      if (haversineMeters(kept[kept.length - 1], point) >= MIN_SPACING_M) kept.push(point);
    }
    const end = points[points.length - 1];
    const prev = kept[kept.length - 1];
    if (prev.lat !== end.lat || prev.lon !== end.lon) kept.push(end);
    return kept;
  }

  function parseGpx(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (!doc.documentElement || doc.querySelector("parsererror")) {
      return { error: "GPX is corrupt or malformed." };
    }
    const track = doc.getElementsByTagNameNS(GPX_NS, "trk")[0];
    if (!track) return { error: "GPX is corrupt or malformed." };
    const name = childText(track, "name");
    const trackPoints = [...track.getElementsByTagNameNS(GPX_NS, "trkpt")];
    if (trackPoints.length < 2) return { error: "GPX is corrupt or malformed." };

    const points = [];
    for (const point of trackPoints) {
      const lat = Number(point.getAttribute("lat"));
      const lon = Number(point.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { error: "GPX is corrupt or malformed." };
      }
      const elevation = childText(point, "ele");
      const parsedZ = elevation ? Number(elevation) : NaN;
      const row = { lat, lon };
      if (Number.isFinite(parsedZ)) row.z = parsedZ;
      points.push(row);
    }

    const spaced = thinTrackPoints(points);
    if (spaced.length < 2) return { error: "GPX is corrupt or malformed." };
    return { name, points: spaced };
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function gpxDocument(course) {
    const points = course.points.map((point) => {
      const ele = Number.isFinite(point.z)
        ? `<ele>${point.z}</ele>`
        : "";
      return `      <trkpt lat="${point.lat}" lon="${point.lon}">${ele}</trkpt>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="${GPX_NS}" version="1.1" creator="Chaser">
  <trk>
    <name>${escapeXml(course.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
  }

  root.GPX_MIN_SPACING_M = MIN_SPACING_M;
  root.GPX_NS = GPX_NS;
  root.parseGpx = parseGpx;
  root.gpxDocument = gpxDocument;
  root.thinTrackPoints = thinTrackPoints;
})(window);
