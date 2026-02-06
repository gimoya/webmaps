/**
 * GPX Blinduro – Checkpoint segment times (client-side)
 * Port of TRAILISM GPX Checkpoint Times logic.
 */

const GPX_NS_11 = 'http://www.topografix.com/GPX/1/1';
const GPX_NS_10 = 'http://www.topografix.com/GPX/1/0';
const GPX_NAMESPACES = [GPX_NS_11, GPX_NS_10];

const DEFAULT_MAX_DIST_M = 20;

// Line colors and widths (easy to adjust)
const ANCHOR_COLOR = '#fff';
const ANCHOR_WEIGHT = 1;

const CIRCLE_END_COLOR = '#991b1b';
const CIRCLE_START_COLOR = '#166534';
const CIRCLE_WEIGHT = 1;

const GPX_LOADED_COLOR = 'orange'; 
const GPX_LOADED_WEIGHT = 2;

const PRELOAD_TRACKS_COLOR = '#960018'; // carmin red
const PRELOAD_TRACKS_WEIGHT = 2.5;
const PRELOAD_TRACKS_DASHED_STYLE = {
  color: PRELOAD_TRACKS_COLOR,
  weight: PRELOAD_TRACKS_WEIGHT,
  dashArray: '4, 4'
};
const PRELOAD_TRACKS_GLOW_STYLE = {
  color: '#fff',
  weight: PRELOAD_TRACKS_WEIGHT * 3,
  opacity: 0.35,
  fillOpacity: 0
};
const SEGMENT_MATCH_COLOR = 'green';
const SEGMENT_MATCH_WEIGHT = 10;
const SEGMENT_MATCH_OPACITY = 0.5;

const ZOOM_FLAGS_SMALL = 12;
const ZOOM_LABELS_HIDE = 13;

const FIT_BOUNDS_OPTS = { padding: [40, 40], maxZoom: 16 };
const MAP_TILE_URL = 'https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}.png?key=luZxg9l38dVBSQGjrelS';
const TRACK_TOOLTIP_OPTS = { permanent: true, direction: 'top', offset: [0, -12], className: 'blinduro-segment-label blinduro-track-label' };
const TRACK_BOUNDS_STYLE = {
  color: '#4a4a52',
  weight: 1.5,
  opacity: 0.8,
  fillOpacity: 0,
  dashArray: '6,6',
  lineCap: 'round',
  lineJoin: 'round',
  interactive: false
};
const MARKER_TOOLTIP_OPTS = { permanent: true, direction: 'top', offset: [0, -48], className: 'blinduro-segment-label blinduro-marker-label' };

function isAdminMode() {
  return window.location.hash === '#admin';
}

function initPanelResizeCheck() {
  if (!isAdminMode()) return;
  if (panelResizeObserver) {
    panelResizeObserver.disconnect();
    panelResizeObserver = null;
  }
  const panel = document.getElementById('unified-panel');
  const header = panel?.querySelector('.panel-header');
  if (!panel || !header) return;
  let banner = document.getElementById('panel-resize-warning');
  const showBanner = (show) => {
    if (show && !banner) {
      banner = document.createElement('div');
      banner.id = 'panel-resize-warning';
      banner.className = 'panel-resize-warning';
      banner.textContent = 'Panel resize issue detected: fit-content may not work in this browser.';
      document.body.appendChild(banner);
    }
    if (banner) banner.hidden = !show;
  };
  const check = () => {
    if (document.body.classList.contains('panel-hidden')) return;
    const ph = panel.getBoundingClientRect().height;
    const hh = header.getBoundingClientRect().height;
    showBanner(ph < hh + 20);
  };
  panelResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(check);
  });
  panelResizeObserver.observe(panel);
  setTimeout(check, 150);
}

function disconnectPanelResizeCheck() {
  if (panelResizeObserver) {
    panelResizeObserver.disconnect();
    panelResizeObserver = null;
  }
}

function getMaxDistM() {
  return isAdminMode()
    ? (parseFloat(document.getElementById('max-dist')?.value) || DEFAULT_MAX_DIST_M)
    : DEFAULT_MAX_DIST_M;
}

const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;

function safeNumber(val) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  return (typeof n === 'number' && !isNaN(n)) ? Math.round(n) : 0;
}

function safeStr(val, fallback = '—') {
  const s = (val ?? '').toString().trim();
  if (s === '' || s.toLowerCase() === 'nan' || s === 'undefined' || s === 'null') return fallback;
  return s;
}

function formatRecordDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  const year = d.getFullYear();
  return `${day}. ${month} ${year}`;
}

function formatSubmissionDateTime(ts) {
  if (!ts) return { date: '—', time: '—' };
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
  if (isNaN(d.getTime())) return { date: '—', time: '—' };
  const day = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  const year = d.getFullYear();
  const h = d.getHours();
  const m = d.getMinutes();
  return { date: `${day}. ${month} ${year}`, time: `${h}:${String(m).padStart(2, '0')}` };
}

const GPX_MAX_BYTES = 1048486; // Firestore string field max (UTF-8 bytes)

async function submitLeaderboardEntry(seg, gpxText) {
  if (!db) {
    alert('Firebase not configured. Add your config to index.html.');
    return;
  }
  const nameEl = document.getElementById('submitter-name');
  const name = nameEl ? nameEl.value?.trim() : '';
  if (!name) {
    setStatus('Enter your name above, then click Submit on a segment.', true);
    nameEl?.focus();
    return;
  }
  const duration = seg.duration || 'no timestamps';
  const durationSeconds = parseDurationToSeconds(duration);
  const distance = safeNumber(seg.segment_dist);
  const segmentName = (seg.segmentName ?? '').toString().trim();
  if (!segmentName) {
    alert('Segment has no name. Cannot submit.');
    return;
  }
  const startTime = seg.start_time || null;
  const endTime = seg.end_time || null;
  if (!startTime || !endTime) {
    setStatus('Segment has no timestamps – cannot submit.', true);
    return;
  }
  const doc = {
    name: name.trim(),
    segmentName,
    duration,
    distance,
    startTime,
    endTime,
    segmentInfo: {
      matchInfo: seg.match_info || '',
      sourceFile: seg.source_file || ''
    },
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (durationSeconds != null) doc.durationSeconds = durationSeconds;
  let gpxStatus = 'no GPX';
  if (gpxText && typeof gpxText === 'string') {
    const bytes = new TextEncoder().encode(gpxText).length;
    if (bytes <= GPX_MAX_BYTES) {
      doc.gpx = gpxText;
      gpxStatus = 'with GPX';
    } else {
      gpxStatus = 'GPX skipped (file too large)';
    }
  }
  setStatus(`Submitting ${segmentName} to leaderboard…`);
  try {
    const segSnap = await db.collection('leaderboard')
      .where('segmentName', '==', segmentName)
      .get();
    const isDup = !isAdminMode() && segSnap.docs.some(d => {
      const e = d.data();
      return e.startTime === startTime && e.endTime === endTime;
    });
    if (isDup) {
      setStatus('Duplicate entry – same run (first/last track timestamps) already exists.', true);
      return;
    }
    await db.collection('leaderboard').add(doc);
    setStatus(`Submitted ${segmentName} (${gpxStatus}).`);
    const highlightEntry = { startTime: doc.startTime, endTime: doc.endTime };
    focusLeaderboardAfterSubmit(segmentName, null);
    await new Promise(r => setTimeout(r, 400));
    const highlightRank = await refreshAllLeaderboards(segmentName, highlightEntry, doc);
    focusLeaderboardAfterSubmit(segmentName, highlightRank);
  } catch (err) {
    console.error('Firestore error:', err);
    alert('Error submitting. Check console and Firebase config.');
  }
}

async function fetchLeaderboard(segmentName, listEl, highlightEntry, newlySubmittedDoc) {
  if (!listEl) return null;
  if (!db) {
    listEl.innerHTML = '<li class="empty">Firebase not configured.</li>';
    const m = listEl.closest('.leaderboard-segment-collapse')?.querySelector('.leaderboard-segment-meta');
    if (m) m.textContent = '';
    return null;
  }
  listEl.innerHTML = '<li class="loading">Loading...</li>';
  try {
    let q = db.collection('leaderboard').where('segmentName', '==', segmentName);
    let snapshot;
    try {
      snapshot = await q.orderBy('durationSeconds', 'asc').limit(100).get();
    } catch (_) {
      snapshot = await q.orderBy('duration').limit(100).get();
    }
    listEl.innerHTML = '';
    const details = listEl.closest('.leaderboard-segment-collapse');
    const metaSpan = details?.querySelector('.leaderboard-segment-meta');
    if (snapshot.empty) {
      listEl.innerHTML = '<li class="empty">No entries yet.</li>';
      if (metaSpan) metaSpan.textContent = '';
      return null;
    }
    let totalCount = snapshot.size;
    try {
      const countSnap = await db.collection('leaderboard').where('segmentName', '==', segmentName).count().get();
      totalCount = countSnap.data().count;
    } catch (_) {}
    const docs = snapshot.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    const tsMs = (d) => {
      const t = d.data.timestamp;
      if (!t) return 0;
      return t.toMillis ? t.toMillis() : (t.seconds || 0) * 1000;
    };
    docs.sort((a, b) => {
      const aSec = a.data.durationSeconds ?? 999999;
      const bSec = b.data.durationSeconds ?? 999999;
      if (aSec !== bSec) return aSec - bSec;
      const aDist = safeNumber(a.data.distance);
      const bDist = safeNumber(b.data.distance);
      if (aDist !== bDist) return bDist - aDist;
      return tsMs(b) - tsMs(a);
    });
    const top10 = docs.slice(0, 10);
    const firstPlace = safeStr(top10[0].data.name);
    if (metaSpan) metaSpan.textContent = `${totalCount} Ride(s) · 🥇 1st: ${firstPlace}`;
    let highlightRank = null;
    let prevRank = 0;
    let prevSec = null;
    let prevDist = null;
    top10.forEach(({ data: entry }, index) => {
      const useEntry = (newlySubmittedDoc && String(entry.startTime ?? '') === String(highlightEntry?.startTime ?? '') && String(entry.endTime ?? '') === String(highlightEntry?.endTime ?? ''))
        ? { ...entry, gpx: newlySubmittedDoc.gpx }
        : entry;
      const dist = safeNumber(useEntry.distance);
      const nm = safeStr(useEntry.name);
      const dur = safeStr(useEntry.duration);
      const sec = useEntry.durationSeconds ?? 999999;
      const isTie = prevSec !== null && prevSec === sec && prevDist === dist;
      const rank = isTie ? prevRank : index + 1;
      prevRank = rank;
      prevSec = sec;
      prevDist = dist;
      const isHighlight = highlightEntry && rank >= 1 && rank <= 10
        && String(useEntry.startTime ?? '') === String(highlightEntry.startTime ?? '')
        && String(useEntry.endTime ?? '') === String(highlightEntry.endTime ?? '');
      const recDate = formatRecordDate(useEntry.startTime);
      const { date: subDate, time: subTime } = formatSubmissionDateTime(useEntry.timestamp);
      const metaParts = [];
      if (recDate !== '—') metaParts.push(`Record: ${escapeHtml(recDate)}`);
      metaParts.push(`Submitted: ${escapeHtml(subDate)}, ${escapeHtml(subTime)}`);
      const listItem = document.createElement('li');
      const topRank = isHighlight && rank <= 10;
      listItem.className = 'leaderboard-entry' + (isHighlight ? ' leaderboard-entry-new' : '') + (topRank ? ' leaderboard-entry-top' : '');
      if (isHighlight) {
        listItem.dataset.rank = rank;
        highlightRank = rank;
      }
      const gpxBtnHtml = (rank <= 10 && useEntry.gpx)
        ? `<button type="button" class="leaderboard-entry-gpx-dl" title="Download GPX">GPX</button>`
        : '';
      listItem.innerHTML = `
        <div class="leaderboard-entry-row">
          <span class="leaderboard-entry-main">${rank}. ${rank <= 3 ? ['🥇','🥈','🥉'][rank - 1] + ' ' : ''}${escapeHtml(nm)} - ${escapeHtml(dur)} - ${dist}m</span>
          ${gpxBtnHtml}
        </div>
        <span class="leaderboard-entry-meta">${metaParts.join(' | ')}</span>
      `;
      if (useEntry.gpx) {
        const btn = listItem.querySelector('.leaderboard-entry-gpx-dl');
        if (btn) btn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGpx(useEntry.gpx, nm, segmentName);
        });
      }
      listEl.appendChild(listItem);
    });
    if (newlySubmittedDoc && highlightEntry && highlightRank == null) {
      const entry = newlySubmittedDoc;
      const nm = safeStr(entry.name);
      const dur = safeStr(entry.duration);
      const dist = safeNumber(entry.distance);
      const recDate = formatRecordDate(entry.startTime);
      const ts = entry.timestamp?.toDate ? entry.timestamp : (entry.timestamp?.seconds ? { toDate: () => new Date(entry.timestamp.seconds * 1000) } : null);
      const { date: subDate, time: subTime } = formatSubmissionDateTime(ts || new Date());
      const metaParts = [];
      if (recDate !== '—') metaParts.push(`Record: ${escapeHtml(recDate)}`);
      metaParts.push(`Submitted: ${escapeHtml(subDate)}, ${escapeHtml(subTime)}`);
      const listItem = document.createElement('li');
      listItem.className = 'leaderboard-entry leaderboard-entry-new';
      const gpxBtnHtml = entry.gpx ? `<button type="button" class="leaderboard-entry-gpx-dl" title="Download GPX">GPX</button>` : '';
      listItem.innerHTML = `
        <div class="leaderboard-entry-row">
          <span class="leaderboard-entry-main">• ${escapeHtml(nm)} - ${escapeHtml(dur)} - ${dist}m (new)</span>
          ${gpxBtnHtml}
        </div>
        <span class="leaderboard-entry-meta">${metaParts.join(' | ')}</span>
      `;
      if (entry.gpx) {
        const btn = listItem.querySelector('.leaderboard-entry-gpx-dl');
        if (btn) btn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadGpx(entry.gpx, nm, segmentName);
        });
      }
      listEl.appendChild(listItem);
    }
    return highlightRank;
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    listEl.innerHTML = '<li class="empty">Error loading.</li>';
    const details = listEl.closest('.leaderboard-segment-collapse');
    const metaSpan = details?.querySelector('.leaderboard-segment-meta');
    if (metaSpan) metaSpan.textContent = '';
    return null;
  }
}

function slugify(s) {
  return String(s).replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
}

function buildLevelsList() {
  const container = document.getElementById('levels-list');
  if (!container) return;
  container.innerHTML = '';
  if (!standardTracks?.length) return;
  const gpxBase = DATA_BASE + 'data/';
  for (const track of standardTracks) {
    const details = document.createElement('details');
    details.className = 'leaderboard-segment-collapse';
    details.dataset.trackName = track.name;
    const len = track.length != null ? track.length.toFixed(2) + ' km' : '—';
    const gain = track['elevation gain'] != null ? Math.round(track['elevation gain']) + ' m' : '—';
    const loss = track['elevaiton loss'] != null ? Math.round(track['elevaiton loss']) + ' m' : '—';
    const stats = `length ${len} · elevation gain ${gain} · elevaiton loss ${loss}`;
    const gpxUrl = gpxBase + encodeURIComponent(track.name + '.gpx');
    details.innerHTML = `
      <summary class="leaderboard-segment-title">
        <span class="leaderboard-segment-name">Level - ${escapeHtml(track.name)}</span>
        <span class="leaderboard-segment-meta"></span>
      </summary>
      <ul>
        <li class="leaderboard-entry">
          <div class="leaderboard-entry-row">
            <span class="leaderboard-entry-main">${escapeHtml(stats)}</span>
            <a href="${escapeHtml(gpxUrl)}" class="leaderboard-entry-gpx-dl" target="_blank" rel="noopener">GPX</a>
          </div>
        </li>
      </ul>
    `;
    const summary = details.querySelector('.leaderboard-segment-title');
    if (summary) {
      summary.addEventListener('click', () => {
        const idx = standardTracks.findIndex(t => t.name === track.name);
        if (idx >= 0) {
          trackNavIndex = idx;
          fitMapToTrack(idx);
          updateTrackNavButtons();
        }
      });
    }
    container.appendChild(details);
  }
}

function buildLeaderboardPanel() {
  const container = document.getElementById('leaderboards-container');
  if (!container) return;
  container.innerHTML = '';
  for (const segName of checkpoints.segmentNames || []) {
    const id = slugify(segName) || 'seg-' + Math.random().toString(36).slice(2);
    const details = document.createElement('details');
    details.className = 'leaderboard-segment-collapse';
    details.dataset.segmentName = segName;
    details.innerHTML = `<summary class="leaderboard-segment-title"><span class="leaderboard-segment-name">${escapeHtml(segName)}</span><span class="leaderboard-segment-meta"></span></summary><ul id="leaderboard-${id}"></ul>`;
    const summary = details.querySelector('.leaderboard-segment-title');
    if (summary) summary.addEventListener('click', () => panToSegmentBounds(segName));
    container.appendChild(details);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function downloadGpx(gpxText, name, segmentName) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'track';
  const filename = `${safe(segmentName)}_${safe(name)}.gpx`;
  const blob = new Blob([gpxText], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function refreshAllLeaderboards(highlightSegmentName, highlightEntry, newlySubmittedDoc) {
  if (!checkpoints.segmentNames?.length) return null;
  let highlightRank = null;
  for (const segName of checkpoints.segmentNames) {
    const id = slugify(segName);
    const listEl = document.getElementById(id ? `leaderboard-${id}` : null);
    if (listEl) {
      const entry = (segName === highlightSegmentName && highlightEntry) ? highlightEntry : null;
      const doc = (segName === highlightSegmentName && newlySubmittedDoc) ? newlySubmittedDoc : null;
      const rank = await fetchLeaderboard(segName, listEl, entry, doc);
      if (segName === highlightSegmentName && rank != null) highlightRank = rank;
    }
  }
  return highlightRank;
}

async function resetLeaderboard() {
  if (!db) {
    alert('Firebase not configured.');
    return;
  }
  if (!confirm('Delete all leaderboard entries? This cannot be undone.')) return;
  setStatus('Resetting leaderboard…');
  try {
    const snapshot = await db.collection('leaderboard').get();
    const BATCH_SIZE = 500;
    for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      snapshot.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    setStatus(`Deleted ${snapshot.size} leaderboard entries.`);
    refreshAllLeaderboards();
  } catch (err) {
    console.error('Reset error:', err);
    setStatus('Error resetting leaderboard.', true);
  }
}

const DATA_BASE = (() => {
  const s = document.currentScript;
  if (s?.src) return new URL('.', s.src).href;
  return '';
})();

let checkpoints = { segments: {}, segmentNames: [] };
let standardTracks = [];
let trackNavIndex = 0;
let uploadedTracks = [];
let lastMatchedSegments = [];
let lastGpxText = '';
let map = null;
let mapLayers = { tracks: [], trackBounds: [], startMarkers: [], endMarkers: [], uploaded: [], matchedSegments: [], lookCircles: [], anchors: [], trackLabel: null };
let trackLabelFadeTimeout = null;
let panelResizeObserver = null;

// --- Math ---

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- Time parsing (ISO 8601 + common fallbacks) ---

function parseTime(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();
  if (!s) return null;
  const norm = s.replace(/Z$/i, '+00:00').replace(/\+0000$/, '+00:00').replace(/-0000$/, '-00:00');
  let d = new Date(norm);
  if (!isNaN(d.getTime())) return d;
  d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function durationHhmmss(startDt, endDt) {
  if (!startDt || !endDt) return null;
  const sec = Math.floor((endDt - startDt) / 1000);
  if (sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const r = sec % 3600;
  const m = Math.floor(r / 60);
  const s = r % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseDurationToSeconds(s) {
  if (!s || typeof s !== 'string' || s === 'no timestamps') return null;
  const m = s.match(/^(\d+):(\d+):(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

function formatTimeHhmmss(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatSegmentDetails(seg) {
  const dist = safeNumber(seg.segment_dist);
  const timeS = seg.time_seconds ?? (seg.duration ? parseDurationToSeconds(seg.duration) : 0) ?? 0;
  const speedKmh = timeS > 0 ? (dist / 1000) / (timeS / 3600) : 0;
  const startHms = formatTimeHhmmss(seg.start_time);
  const endHms = formatTimeHhmmss(seg.end_time);
  const sIdx = seg.start_idx ?? '?';
  const eIdx = seg.end_idx ?? '?';
  return `OK! ..Track point ${sIdx} to track point ${eIdx} got matched. Your start time was ${startHms} and your end time was ${endHms}. The segement's distance was ${Math.round(dist)} m and the average speed was ${speedKmh.toFixed(1)} km/h`;
}

// --- GeoJSON parsing (segments.geojson, tracks.geojson) ---

function parseGeoJsonSegmentDefinitions(data) {
  const fc = typeof data === 'string' ? JSON.parse(data) : data;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return { segments: {}, segmentNames: [] };
  const segments = {};
  const seen = new Set();
  for (const f of fc.features) {
    const g = f?.geometry;
    const p = f?.properties;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) continue;
    const pt = [g.coordinates[1], g.coordinates[0]];
    const name = (p?.segmentName ?? p?.name ?? '').toString().trim();
    const type = (p?.pointType ?? p?.type ?? '').toString().toLowerCase();
    if (!name || (type !== 'start' && type !== 'end')) continue;
    if (!segments[name]) segments[name] = { start: [], end: [] };
    if (type === 'start') segments[name].start.push(pt);
    else segments[name].end.push(pt);
    seen.add(name);
  }
  const segmentNames = [...seen].sort();
  return { segments, segmentNames };
}

function trackNameNoExt(f, index) {
  const raw = (f?.properties?.name ?? f?.properties?.Name ?? f?.id ?? `Track ${index + 1}`).toString();
  return raw.replace(/\.[^/.]+$/, '');
}

function parseGeoJsonTrackProps(p) {
  return {
    length: p?.length != null ? Number(p.length) : null,
    'elevation gain': p?.['elevation gain'] != null ? Number(p['elevation gain']) : null,
    'elevaiton loss': p?.['elevaiton loss'] != null ? Number(p['elevaiton loss']) : null
  };
}

function parseGeoJsonTracks(data) {
  const fc = typeof data === 'string' ? JSON.parse(data) : data;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return [];
  const tracks = [];
  let trackIndex = 0;
  for (const f of fc.features) {
    const g = f?.geometry;
    const props = parseGeoJsonTrackProps(f?.properties);
    if (!g || !Array.isArray(g.coordinates)) continue;
    if (g.type === 'LineString' && g.coordinates.length >= 2) {
      const raw = g.coordinates;
      tracks.push({
        coords: raw.map(c => [c[1], c[0]]),
        name: trackNameNoExt(f, trackIndex++),
        ...props
      });
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates) {
        if (Array.isArray(line) && line.length >= 2) {
          const raw = line;
          tracks.push({
            coords: raw.map(c => [c[1], c[0]]),
            name: trackNameNoExt(f, trackIndex++),
            ...props
          });
        }
      }
    }
  }
  return tracks;
}

// --- GPX parsing (uploaded file only) ---

function getTimeText(el, ns) {
  const timeEl = el.getElementsByTagNameNS(ns, 'time')[0] || el.querySelector('time');
  if (timeEl && timeEl.textContent) return timeEl.textContent.trim();
  for (const child of el.children) {
    const local = child.localName || child.nodeName.split(':').pop();
    if (local === 'time' && child.textContent) return child.textContent.trim();
  }
  return '';
}

function collectPoint(el, ns) {
  const lat = el.getAttribute('lat');
  const lon = el.getAttribute('lon');
  if (lat == null || lon == null) return null;
  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);
  if (isNaN(latF) || isNaN(lonF)) return null;
  const timeStr = getTimeText(el, ns);
  const timeDt = parseTime(timeStr);
  return [latF, lonF, timeDt];
}

function parseGpxTracks(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const root = doc.documentElement;
  if (!root || (root.localName || root.nodeName).toLowerCase() !== 'gpx') {
    throw new Error('Invalid GPX: root element is not <gpx>');
  }
  const rootNs = root.namespaceURI;
  if (!rootNs) {
    throw new Error('GPX root has no XML namespace (xmlns). GPX 1.0/1.1 must declare xmlns on the root <gpx> element.');
  }
  const nsCandidates = [rootNs, ...GPX_NAMESPACES.filter(u => u !== rootNs)];
  const tracks = [];
  for (const ns of nsCandidates) {
    const trks = doc.getElementsByTagNameNS(ns, 'trk');
    for (const trk of trks) {
      const pts = [];
      const segs = trk.getElementsByTagNameNS(ns, 'trkseg');
      for (const seg of segs) {
        const trkpts = seg.getElementsByTagNameNS(ns, 'trkpt');
        for (const pt of trkpts) {
          const p = collectPoint(pt, ns);
          if (p) pts.push(p);
        }
      }
      if (pts.length > 0) tracks.push(pts);
    }
    const rtes = doc.getElementsByTagNameNS(ns, 'rte');
    for (const rte of rtes) {
      const pts = [];
      const rtepts = rte.getElementsByTagNameNS(ns, 'rtept');
      for (const pt of rtepts) {
        const p = collectPoint(pt, ns);
        if (p) pts.push(p);
      }
      if (pts.length > 0) tracks.push(pts);
    }
    if (tracks.length > 0) break;
  }
  return tracks;
}

// --- Segment logic (port from Python) ---

function buildEdges(trackPts) {
  const edges = [];
  for (let i = 0; i < trackPts.length - 1; i++) {
    const [lat0, lon0, t0] = trackPts[i];
    const [lat1, lon1, t1] = trackPts[i + 1];
    const dist = haversineM(lat0, lon0, lat1, lon1);
    const timeS = (t0 && t1) ? (t1 - t0) / 1000 : 0;
    edges.push([[lat0, lon0], [lat1, lon1], dist, timeS]);
  }
  return edges;
}

function findAllSnaps(trackPts, refPts, maxDistM) {
  if (!trackPts.length || !refPts.length) return [];
  const result = [];
  const used = new Set();
  for (const [refLat, refLon] of refPts) {
    let bestIdx = null;
    let bestDist = Infinity;
    for (let i = 0; i < trackPts.length; i++) {
      if (used.has(i)) continue;
      const [lat, lon] = trackPts[i];
      const d = haversineM(lat, lon, refLat, refLon);
      if (d <= maxDistM && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx != null) {
      used.add(bestIdx);
      const [lat, lon, t] = trackPts[bestIdx];
      result.push([bestIdx, lat, lon, t]);
    }
  }
  return result.sort((a, b) => a[0] - b[0]);
}

function findSnapAfter(trackPts, refPt, maxDistM, afterIdx) {
  const [refLat, refLon] = refPt;
  let bestIdx = null;
  let bestDist = Infinity;
  for (let i = afterIdx + 1; i < trackPts.length; i++) {
    const [lat, lon] = trackPts[i];
    const d = haversineM(lat, lon, refLat, refLon);
    if (d <= maxDistM && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx == null) return null;
  const [lat, lon, t] = trackPts[bestIdx];
  return [bestIdx, lat, lon, t];
}

function getNearestDistances(trackPts, refPts) {
  const out = [];
  for (const [refLat, refLon] of refPts) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < trackPts.length; i++) {
      const [lat, lon] = trackPts[i];
      const d = haversineM(lat, lon, refLat, refLon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    out.push({ dist: bestDist, idx: bestIdx });
  }
  return out;
}

function pairSegments(trackPts, startSnaps, endRefs, maxDistM) {
  const pairs = [];
  const usedEndIdxs = new Set();
  for (let i = 0; i < startSnaps.length && i < endRefs.length; i++) {
    const sIdx = startSnaps[i][0];
    const endSnap = findSnapAfter(trackPts, endRefs[i], maxDistM, sIdx);
    if (endSnap && !usedEndIdxs.has(endSnap[0])) {
      const eIdx = endSnap[0];
      pairs.push([sIdx, eIdx]);
      usedEndIdxs.add(eIdx);
    }
  }
  const nStartOrphan = startSnaps.length - pairs.length;
  const nEndOrphan = endRefs.length - pairs.length;
  const nInvalid = 0;
  return { pairs, nStartOrphan, nEndOrphan, nInvalid };
}

function segmentFromEdges(edges, sIdx, eIdx) {
  let dist = 0;
  let timeS = 0;
  const pts = [edges[sIdx][0]];
  for (let i = sIdx; i < eIdx; i++) {
    dist += edges[i][2];
    timeS += edges[i][3];
    pts.push(edges[i][1]);
  }
  return { dist, timeS, pts };
}

// --- Main processing ---

function processGpx(xmlText, filename, maxDistM) {
  const tracks = parseGpxTracks(xmlText);
  const segments = [];
  const trackSummaries = [];
  const failures = [];
  const { segments: segDefs, segmentNames } = checkpoints;
  if (!segmentNames.length) {
    return { segments: [], trackSummaries: [], failures: ['No checkpoints. Add data/segments.geojson'] };
  }
  for (const trackPts of tracks) {
    if (trackPts.length < 2) continue;
    const edges = buildEdges(trackPts);
    let totalOk = 0;
    const parts = [];
    for (const segName of segmentNames) {
      const seg = segDefs[segName];
      if (!seg || !seg.start?.length || !seg.end?.length) continue;
      const startSnaps = findAllSnaps(trackPts, seg.start, maxDistM);
      const { pairs, nStartOrphan, nEndOrphan, nInvalid } = pairSegments(trackPts, startSnaps, seg.end, maxDistM);
      if (pairs.length > 0) {
        totalOk += pairs.length;
        parts.push(`✅ ${segName} got matched within look around distance ${maxDistM}`);
      }
      for (const [sIdx, eIdx] of pairs) {
        const { dist, timeS, pts } = segmentFromEdges(edges, sIdx, eIdx);
        const startTime = trackPts[sIdx][2];
        const endTime = trackPts[eIdx][2];
        const durationStr = durationHhmmss(startTime, endTime);
        segments.push({
          segmentName: segName,
          source_file: filename,
          start_idx: sIdx,
          end_idx: eIdx,
          match_info: `OK ${sIdx}→${eIdx} (${Math.round(dist)}m ${Math.round(timeS)}s)`,
          segment_dist: dist,
          time_seconds: timeS,
          pts,
          start_wkt: `POINT (${pts[0][1]} ${pts[0][0]})`,
          end_wkt: `POINT (${pts[pts.length - 1][1]} ${pts[pts.length - 1][0]})`,
          start_time: startTime ? startTime.toISOString() : null,
          end_time: endTime ? endTime.toISOString() : null,
          duration: durationStr
        });
      }
    }
    const trackMatch = parts.length ? parts.join('; ') : 'No matches';
    trackSummaries.push({ filename, trackMatch });
  }
  return { segments, trackSummaries, failures };
}

// --- UI ---

let statusFadeTimeout = null;
function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  if (statusFadeTimeout) {
    clearTimeout(statusFadeTimeout);
    statusFadeTimeout = null;
  }
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  el.style.opacity = '1';
  el.classList.remove('status-fade-out');
  statusFadeTimeout = setTimeout(() => {
    statusFadeTimeout = null;
    el.style.removeProperty('opacity');
    el.classList.add('status-fade-out');
  }, 5000);
}

function applyMapOffsetForPanel() {
  if (!map) return;
  const panel = document.getElementById('unified-panel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  if (isPortrait) {
    map.panBy([0, rect.height / 2]);
  } else {
    map.panBy([rect.width / 2, 0]);
  }
}

function fitBoundsWithOffset(bounds, opts) {
  if (!map) return;
  map.once('moveend', applyMapOffsetForPanel);
  map.fitBounds(bounds, opts || FIT_BOUNDS_OPTS);
}

function panToSegmentBounds(segmentName) {
  if (!map) return;
  const seg = checkpoints.segments?.[segmentName];
  if (!seg?.start?.length && !seg?.end?.length) return;
  const pts = [...(seg.start || []), ...(seg.end || [])];
  if (pts.length < 1) return;
  const bounds = L.latLngBounds(pts.map(p => [p[0], p[1]]));
  fitBoundsWithOffset(bounds, { padding: [40, 40], maxZoom: 16 });
}

function showSection(sectionId, hasContent, openByDefault = true) {
  const el = document.getElementById(`collapse-${sectionId}`);
  if (!el) return;
  el.hidden = !hasContent;
  if (hasContent && openByDefault) el.open = true;
}

function focusLeaderboardAfterSubmit(segmentName, rank) {
  const leaderboardsCollapse = document.getElementById('collapse-leaderboards');
  if (!leaderboardsCollapse) return;
  leaderboardsCollapse.open = true;
  const segmentDetails = document.querySelector(`.leaderboard-segment-collapse[data-segment-name="${segmentName}"]`);
  if (segmentDetails) {
    segmentDetails.open = true;
    const newEntry = segmentDetails.querySelector('.leaderboard-entry-new');
    if (rank >= 1 && rank <= 10) showSubmissionPopup(rank);
    if (newEntry) {
      newEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      segmentDetails.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    leaderboardsCollapse.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function showSubmissionPopup(rank) {
  const existing = document.getElementById('submission-popup');
  if (existing) existing.remove();
  const popup = document.createElement('div');
  popup.id = 'submission-popup';
  popup.className = 'submission-popup';
  popup.innerHTML = `
    <div class="submission-popup-inner">
      <img src="images/pacman-namco.gif" alt="" class="submission-popup-gif">
      <div class="submission-popup-text">You are #${rank}!</div>
    </div>
  `;
  document.body.appendChild(popup);
  requestAnimationFrame(() => popup.classList.add('submission-popup-visible'));
  setTimeout(() => {
    popup.classList.remove('submission-popup-visible');
    setTimeout(() => popup.remove(), 400);
  }, 9000);
}

function showResults(result) {
  const errorEl = document.getElementById('error');
  const segmentsList = document.getElementById('segments-list');
  const tracksSummary = document.getElementById('tracks-summary');
  errorEl.hidden = true;
  if (result.failures && result.failures.length) {
    errorEl.textContent = result.failures.join('; ');
    errorEl.hidden = false;
  }
  const hasSegments = result.segments && result.segments.length > 0;
  const hasTracks = result.trackSummaries && result.trackSummaries.length > 0;
  showSection('segments', hasSegments);
  showSection('tracks', hasTracks);
  if (result.segments && result.segments.length) {
    segmentsList.innerHTML = result.segments.map((s, i) => `
      <div class="segment">
        <a class="segment-link" href="#" data-segment-index="${i}" role="button">
          <div class="segment-name">${escapeHtml(s.segmentName || '')}</div>
          <div class="segment-time">${s.duration || 'no timestamps'}</div>
          <div class="segment-details">${escapeHtml(formatSegmentDetails(s))}</div>
        </a>
        <button type="button" class="segment-submit" title="Submit to leaderboard">Submit</button>
      </div>
    `).join('');
    segmentsList.querySelectorAll('.segment-link').forEach((el, i) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const seg = result.segments[i];
        if (seg?.segmentName) panToSegmentBounds(seg.segmentName);
      });
    });
    segmentsList.querySelectorAll('.segment-submit').forEach((btn, i) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        submitLeaderboardEntry(result.segments[i], lastGpxText);
      });
    });
  } else {
    segmentsList.innerHTML = '<p class="empty">No segments matched.</p>';
  }
  if (result.trackSummaries && result.trackSummaries.length) {
    tracksSummary.innerHTML = result.trackSummaries.map(t => `
      <div class="track-summary"><strong>${t.filename}</strong>: ${t.trackMatch}</div>
    `).join('');
  } else {
    tracksSummary.innerHTML = '<p class="empty">No tracks in file.</p>';
  }
}

async function loadCheckpoints() {
  try {
    const q = '?t=' + Date.now();
    const r = await fetch(DATA_BASE + 'data/segments.geojson' + q);
    if (r.ok) {
      const parsed = parseGeoJsonSegmentDefinitions(await r.text());
      checkpoints.segments = parsed.segments;
      checkpoints.segmentNames = parsed.segmentNames;
    }
  } catch (e) {
    console.warn('Could not load checkpoints:', e);
  }
}

async function loadTracks() {
  try {
    const r = await fetch(DATA_BASE + 'data/tracks.geojson?t=' + Date.now());
    if (r.ok) standardTracks = parseGeoJsonTracks(await r.text());
  } catch (e) {
    console.warn('Could not load tracks:', e);
  }
}

function clearTrackLabel() {
  if (trackLabelFadeTimeout) {
    clearTimeout(trackLabelFadeTimeout);
    trackLabelFadeTimeout = null;
  }
  if (mapLayers.trackLabel) {
    map.removeLayer(mapLayers.trackLabel);
    mapLayers.trackLabel = null;
  }
}

function showTrackLabel(name, latlng) {
  clearTrackLabel();
  const content = `<div class="track-label-content track-label-fade-in">
    <img src="images/pacman-namco.gif" alt="" class="track-label-gif">
    <span class="track-label-text">Level<br><span class="track-label-name">"${escapeHtml(name)}"</span></span>
  </div>`;
  const tooltip = L.tooltip(TRACK_TOOLTIP_OPTS).setContent(content).setLatLng(latlng).addTo(map);
  mapLayers.trackLabel = tooltip;
  const contentEl = tooltip._container?.querySelector('.track-label-content');
  trackLabelFadeTimeout = setTimeout(() => {
    trackLabelFadeTimeout = null;
    if (contentEl) {
      contentEl.classList.remove('track-label-fade-in');
      contentEl.classList.add('track-label-fade-out');
      contentEl.addEventListener('animationend', () => {
        if (mapLayers.trackLabel === tooltip) clearTrackLabel();
      }, { once: true });
    } else {
      clearTrackLabel();
    }
  }, 8000);
}

function clearMapLayers() {
  ['tracks', 'trackBounds', 'startMarkers', 'endMarkers', 'uploaded', 'matchedSegments', 'lookCircles', 'anchors'].forEach(k => {
    mapLayers[k].forEach(l => map.removeLayer(l));
    mapLayers[k] = [];
  });
  clearTrackLabel();
}

function getAllStartEndPoints() {
  const starts = [];
  const ends = [];
  for (const [segName, seg] of Object.entries(checkpoints.segments || {})) {
    if (seg.start) for (const pt of seg.start) starts.push({ pt, segmentName: segName });
    if (seg.end) for (const pt of seg.end) ends.push({ pt, segmentName: segName });
  }
  return { starts, ends };
}

function bufferBounds(bounds, bufferM) {
  const center = bounds.getCenter();
  const latDeg = bufferM / 111320;
  const lonDeg = bufferM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return L.latLngBounds(
    [sw.lat - latDeg, sw.lng - lonDeg],
    [ne.lat + latDeg, ne.lng + lonDeg]
  );
}

function renderMap() {
  if (!map) return;
  clearMapLayers();
  const allLatLngs = [];
  const maxDistM = getMaxDistM();
  const { starts, ends } = getAllStartEndPoints();
  for (const { pt: [lat, lon] } of starts) {
    const circle = L.circle([lat, lon], {
      radius: maxDistM,
      color: CIRCLE_START_COLOR,
      weight: CIRCLE_WEIGHT,
      fillColor: '#22c55e',
      fillOpacity: 0.12,
      dashArray: '4,4'
    }).bindTooltip(`Start (${maxDistM} m)`, { permanent: false });
    circle.addTo(map);
    mapLayers.lookCircles.push(circle);
  }
  for (const { pt: [lat, lon] } of ends) {
    const circle = L.circle([lat, lon], {
      radius: maxDistM,
      color: CIRCLE_END_COLOR,
      weight: CIRCLE_WEIGHT,
      fillColor: '#ef4444',
      fillOpacity: 0.12,
      dashArray: '4,4'
    }).bindTooltip(`End (${maxDistM} m)`, { permanent: false });
    circle.addTo(map);
    mapLayers.lookCircles.push(circle);
  }
  const bufferedPolygons = [];
  for (const track of standardTracks) {
    const coords = track.coords ?? track;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const latlngs = coords.map(p => {
      const ll = Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng];
      allLatLngs.push(ll);
      return ll;
    });
    const name = track.name ?? 'Track';
    const glowLine = L.polyline(latlngs, PRELOAD_TRACKS_GLOW_STYLE);
    const showTrackTooltip = (e, bounds) => {
      fitBoundsWithOffset(bounds);
      showTrackLabel(name, e.latlng);
    };
    glowLine.on('click', (e) => showTrackTooltip(e, glowLine.getBounds()));
    glowLine.addTo(map);
    mapLayers.tracks.push(glowLine);
    const polyline = L.polyline(latlngs, { ...PRELOAD_TRACKS_DASHED_STYLE, opacity: 0.9, interactive: false });
    polyline.addTo(map);
    mapLayers.tracks.push(polyline);
    const trackBounds = L.latLngBounds(latlngs);
    const buffered = bufferBounds(trackBounds, 200);
    const sw = buffered.getSouthWest();
    const ne = buffered.getNorthEast();
    const bbox = [sw.lng, sw.lat, ne.lng, ne.lat];
    bufferedPolygons.push(turf.bboxPolygon(bbox));
  }
  if (bufferedPolygons.length > 0 && typeof turf !== 'undefined') {
    const merged = bufferedPolygons.reduce((acc, p) => turf.union(acc, p));
    const mergedLayer = L.geoJSON(merged, { style: TRACK_BOUNDS_STYLE });
    mergedLayer.eachLayer((layer) => layer.setStyle(TRACK_BOUNDS_STYLE));
    mergedLayer.addTo(map);
    mapLayers.trackBounds.push(mergedLayer);
  }
  const startIcon = L.divIcon({
    className: 'blinduro-marker blinduro-emoji blinduro-start',
    html: '<span aria-hidden="true">\u{1F6A9}</span>',
    iconSize: [28, 28],
    iconAnchor: [7, 36]
  });
  const endIcon = L.divIcon({
    className: 'blinduro-marker blinduro-emoji blinduro-end',
    html: '<span aria-hidden="true">\u{1F3C1}</span>',
    iconSize: [28, 28],
    iconAnchor: [7, 36]
  });
  for (const { pt: [lat, lon], segmentName } of starts) {
    const m = L.marker([lat, lon], { icon: startIcon })
      .bindTooltip(segmentName, MARKER_TOOLTIP_OPTS);
    m.addTo(map);
    mapLayers.startMarkers.push(m);
    const anchor = L.circleMarker([lat, lon], {
      radius: 3,
      fillColor: CIRCLE_START_COLOR,
      color: ANCHOR_COLOR,
      weight: ANCHOR_WEIGHT,
      fillOpacity: 1
    });
    anchor.addTo(map);
    mapLayers.anchors.push(anchor);
    allLatLngs.push([lat, lon]);
  }
  for (const { pt: [lat, lon] } of ends) {
    const m = L.marker([lat, lon], { icon: endIcon })
      .bindTooltip('End', MARKER_TOOLTIP_OPTS);
    m.addTo(map);
    mapLayers.endMarkers.push(m);
    const anchor = L.circleMarker([lat, lon], {
      radius: 3,
      fillColor: CIRCLE_END_COLOR,
      color: ANCHOR_COLOR,
      weight: ANCHOR_WEIGHT,
      fillOpacity: 1
    });
    anchor.addTo(map);
    mapLayers.anchors.push(anchor);
    allLatLngs.push([lat, lon]);
  }
  for (const track of uploadedTracks) {
    if (!Array.isArray(track) || track.length < 2) continue;
    const latlngs = track.map(p => {
      const ll = Array.isArray(p) ? [p[0], p[1]] : [p.lat ?? p[0], p.lng ?? p[1]];
      allLatLngs.push(ll);
      return ll;
    });
    const polyline = L.polyline(latlngs, { color: GPX_LOADED_COLOR, weight: GPX_LOADED_WEIGHT, opacity: 0.9 });
    polyline.addTo(map);
    mapLayers.uploaded.push(polyline);
  }
  for (const seg of lastMatchedSegments) {
    if (!seg.pts || seg.pts.length < 2) continue;
    const latlngs = seg.pts.map(p => [p[0], p[1]]);
    const tooltip = seg.duration || (seg.segment_dist != null ? `${Math.round(seg.segment_dist)} m` : 'matched');
    const polyline = L.polyline(latlngs, { color: SEGMENT_MATCH_COLOR, weight: SEGMENT_MATCH_WEIGHT, opacity: SEGMENT_MATCH_OPACITY })
      .bindTooltip(tooltip, { permanent: false });
    polyline.addTo(map);
    mapLayers.matchedSegments.push(polyline);
    allLatLngs.push(...latlngs);
  }
  if (uploadedTracks.length > 0 || lastMatchedSegments.length > 0) {
    const gpxLatLngs = [];
    for (const track of uploadedTracks) {
      if (Array.isArray(track) && track.length >= 2) {
        for (const p of track) {
          const ll = Array.isArray(p) ? [p[0], p[1]] : [p.lat ?? p[0], p.lng ?? p[1]];
          gpxLatLngs.push(ll);
        }
      }
    }
    for (const seg of lastMatchedSegments) {
      if (seg.pts && seg.pts.length >= 2) gpxLatLngs.push(...seg.pts.map(p => [p[0], p[1]]));
    }
    if (gpxLatLngs.length) fitBoundsWithOffset(L.latLngBounds(gpxLatLngs));
  } else if (allLatLngs.length) {
    fitBoundsWithOffset(L.latLngBounds(allLatLngs));
  }
}

function initMap() {
  const { starts, ends } = getAllStartEndPoints();
  const firstTrack = standardTracks?.[0];
  const firstTrackCoords = firstTrack?.coords ?? firstTrack;
  const center = starts[0]?.pt ?? ends[0]?.pt ?? firstTrackCoords?.[0] ?? [0, 0];
  map = L.map('map').setView(center, 14);
  L.tileLayer(MAP_TILE_URL, {
    tileSize: 512,
    zoomOffset: -1,
    attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  L.control.locate({
    position: 'topleft',
    drawCircle: true,
    follow: true,
    setView: 'untilPanOrZoom',
    keepCurrentZoomLevel: false,
    locateOptions: { maxZoom: 14 },
    markerStyle: { weight: 2, opacity: 0.8, fillOpacity: 0.3 },
    circleStyle: { weight: 2, opacity: 0.8, fillOpacity: 0.3 }
  }).addTo(map);
  const scheduleOffset = () => map.once('moveend', applyMapOffsetForPanel);
  map.on('locateactivate', scheduleOffset);
  map.on('locatelocationfound', scheduleOffset);
  const setPanelHidden = (hidden) => {
    if (hidden) document.body.classList.add('panel-hidden');
    else document.body.classList.remove('panel-hidden');
  };
  const isPanelHidden = () => document.body.classList.contains('panel-hidden');
  const togglePanel = () => setPanelHidden(!isPanelHidden());

  const PANEL_FADE_MS = 1000;
  const requestFs = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
  const exitFs = document.exitFullscreen ?? document.webkitExitFullscreen;
  const hasFullscreen = !!(requestFs && exitFs);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  const PanelToggleControl = L.Control.extend({
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const button = L.DomUtil.create('a', 'leaflet-control-button', container);
      button.href = '#';
      button.style.cssText = 'width: 30px; height: 30px; line-height: 30px; text-align: center; font-size: 18px; display: block;';
      L.DomEvent.disableClickPropagation(button);

      const updateButton = () => {
        if (hasFullscreen && isFullscreen()) {
          button.title = 'Exit fullscreen';
          button.innerHTML = '⟲';
          setPanelHidden(true);
        } else if (hasFullscreen) {
          button.title = 'Fullscreen';
          button.innerHTML = '⛶';
          setPanelHidden(false);
        } else {
          const hidden = isPanelHidden();
          button.title = hidden ? 'Show panel' : 'Hide panel';
          button.innerHTML = hidden ? '⟲' : '⛶';
        }
      };

      if (hasFullscreen) {
        document.addEventListener('fullscreenchange', updateButton);
        document.addEventListener('webkitfullscreenchange', updateButton);
      }

      updateButton();

      L.DomEvent.on(button, 'click', async (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        if (hasFullscreen) {
          if (isFullscreen()) {
            await exitFs.call(document);
          } else {
            setPanelHidden(true);
            await new Promise((r) => setTimeout(r, PANEL_FADE_MS));
            await requestFs.call(document.documentElement);
          }
        } else {
          togglePanel();
          updateButton();
        }
        setTimeout(() => map?.invalidateSize(), 50);
      });
      return container;
    }
  });
  new PanelToggleControl({ position: 'topleft' }).addTo(map);
  renderMap();
  const updateZoomLabels = () => {
    if (!map) return;
    const z = map.getZoom();
    document.body.classList.toggle('map-zoom-low', z <= ZOOM_LABELS_HIDE);
    document.body.classList.toggle('map-zoom-very-low', z <= ZOOM_FLAGS_SMALL);
  };
  map.on('zoomend', updateZoomLabels);
  updateZoomLabels();
  setTimeout(() => map?.invalidateSize(), 0);
  window.addEventListener('resize', () => map?.invalidateSize());
  wireTrackNav();
}

function fitMapToTrack(index) {
  if (!map || !standardTracks?.length || index < 0 || index >= standardTracks.length) return;
  const track = standardTracks[index];
  const coords = track?.coords ?? track;
  if (!Array.isArray(coords) || coords.length < 2) return;
  const bounds = L.latLngBounds(coords.map(c => [c[0], c[1]]));
  fitBoundsWithOffset(bounds);
  trackNavIndex = index;
  updateTrackNavButtons();
  const name = track.name ?? 'Track';
  const center = bounds.getCenter();
  showTrackLabel(name, center);
}

function updateTrackNavButtons() {
  const nav = document.querySelector('.track-nav');
  const prev = document.querySelector('.track-nav-prev');
  const next = document.querySelector('.track-nav-next');
  const n = standardTracks?.length ?? 0;
  if (nav) nav.style.visibility = n > 1 ? 'visible' : 'hidden';
  if (prev) prev.disabled = n <= 1 || trackNavIndex <= 0;
  if (next) next.disabled = n <= 1 || trackNavIndex >= n - 1;
}

function wireTrackNav() {
  const prev = document.querySelector('.track-nav-prev');
  const next = document.querySelector('.track-nav-next');
  if (!prev || !next) return;
  prev.addEventListener('click', () => {
    if (trackNavIndex > 0) fitMapToTrack(trackNavIndex - 1);
  });
  next.addEventListener('click', () => {
    if (trackNavIndex < (standardTracks?.length ?? 0) - 1) fitMapToTrack(trackNavIndex + 1);
  });
  updateTrackNavButtons();
}

function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus('Processing…');
  const maxDist = getMaxDistM();
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const xmlText = ev.target.result;
      lastGpxText = xmlText;
      const result = processGpx(xmlText, file.name, maxDist);
      const tracks = parseGpxTracks(xmlText);
      uploadedTracks = tracks.map(pts => pts.map(([lat, lon]) => [lat, lon]));
      lastMatchedSegments = result.segments || [];
      setStatus(`Done. ${result.segments.length} segment(s) matched.`);
      showResults(result);
      renderMap();
    } catch (err) {
      setStatus(err.message, true);
      document.getElementById('error').textContent = err.message;
      document.getElementById('error').hidden = false;
      showSection('segments', false);
      showSection('tracks', false);
      uploadedTracks = [];
      lastMatchedSegments = [];
      lastGpxText = '';
      renderMap();
    }
  };
  reader.onerror = () => setStatus('Failed to read file', true);
  reader.readAsText(file, 'UTF-8');
}

document.addEventListener('DOMContentLoaded', async () => {
  showSection('segments', false);
  showSection('tracks', false);
  await loadCheckpoints();
  await loadTracks();
  buildLevelsList();
  buildLeaderboardPanel();
  initMap();
  document.getElementById('gpx-file').addEventListener('change', handleFile);
  document.getElementById('submission-form')?.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('max-dist')?.addEventListener('input', () => renderMap());
  const toggleAdminUI = () => {
    const admin = isAdminMode();
    const maxDistRow = document.getElementById('max-dist-row');
    if (maxDistRow) maxDistRow.style.display = admin ? '' : 'none';
    const resetBtn = document.getElementById('reset-leaderboard');
    if (resetBtn) resetBtn.style.display = admin ? 'block' : 'none';
    const banner = document.getElementById('panel-resize-warning');
    if (banner && !admin) banner.hidden = true;
    if (admin) initPanelResizeCheck();
    else disconnectPanelResizeCheck();
  };

  toggleAdminUI();
  window.addEventListener('hashchange', toggleAdminUI);
  const hasLevels = standardTracks?.length > 0;
  showSection('levels', hasLevels, false);
  const leaderboardsCollapse = document.getElementById('collapse-leaderboards');
  const hasLeaderboards = checkpoints.segmentNames?.length > 0;
  showSection('leaderboards', hasLeaderboards, false);
  if (leaderboardsCollapse && hasLeaderboards) {
    leaderboardsCollapse.addEventListener('toggle', () => {
      if (leaderboardsCollapse.open) {
        const segmentsCollapse = document.getElementById('collapse-segments');
        if (segmentsCollapse && !segmentsCollapse.hidden) segmentsCollapse.open = true;
        refreshAllLeaderboards();
      }
    });
    if (leaderboardsCollapse.open) refreshAllLeaderboards();
  }
  const resetBtn = document.getElementById('reset-leaderboard');
  if (resetBtn) resetBtn.addEventListener('click', resetLeaderboard);
});
