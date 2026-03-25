const firebaseConfig = {
  apiKey: "AIzaSyCRTbTdvK8O7tkLCoRfTaGPV-JZpoay7Zw",
  authDomain: "gpx-blinduro.firebaseapp.com",
  projectId: "gpx-blinduro",
  storageBucket: "gpx-blinduro.firebasestorage.app",
  messagingSenderId: "58925827381",
  appId: "1:58925827381:web:9c54e7dc69aa53df29b87c",
  measurementId: "G-GXWNEBDGG3"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const LEADERBOARD_COLLECTION = 'leaderboard';

function parseGeoJsonSegmentDefinitions(data) {
  const fc = typeof data === 'string' ? JSON.parse(data) : data;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return { segmentsByLevel: {} };
  const segmentLevel = {};
  for (const f of fc.features) {
    const g = f?.geometry;
    const p = f?.properties;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) continue;
    const rawName = (p?.segmentName ?? p?.name ?? '').toString().trim();
    const name = (p?.canonicalName ?? p?.name ?? (rawName ? segmentShortName(rawName) : '')).toString().trim();
    const type = (p?.pointType ?? p?.type ?? '').toString().toLowerCase();
    const level = (p?.level ?? '').toString().trim();
    if (!name || (type !== 'start' && type !== 'end')) continue;
    if (!(name in segmentLevel)) segmentLevel[name] = level || null;
  }
  const segmentsByLevel = {};
  for (const [segName, level] of Object.entries(segmentLevel)) {
    const key = level || '(no level)';
    if (!segmentsByLevel[key]) segmentsByLevel[key] = [];
    segmentsByLevel[key].push(segName);
  }
  for (const arr of Object.values(segmentsByLevel)) arr.sort();
  return { segmentsByLevel };
}

function segmentShortName(segmentName) {
  const s = String(segmentName ?? '').trim();
  const idx = s.indexOf('(');
  return idx >= 0 ? s.slice(0, idx).trim() || s : s;
}

function safeNumber(v) {
  const n = Number(v);
  return (typeof v !== 'number' && isNaN(n)) ? 0 : n;
}

function formatRecordDate(val) {
  if (!val) return '—';
  const d = val.toDate ? val.toDate() : new Date(val);
  if (isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const month = d.toLocaleString('en', { month: 'short' });
  const year = d.getFullYear();
  return `${day}. ${month} ${year}`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function normalizeKey(s) {
  if (s == null || typeof s !== 'string') return '';
  let t = s.toLowerCase().trim();
  t = t.replace(/\u00df/g, 'ss').replace(/&/g, '').replace(/\s+/g, '');
  t = t.replace(/(.)\1+/g, '$1');
  t = t.replace(/[^a-z\u00e4\u00f6\u00fc0-9]/g, '');
  return t;
}

function dedupeBestPerRider(docs) {
  const tsMs = (d) => {
    const t = d.data.timestamp;
    if (!t) return 0;
    return t.toMillis ? t.toMillis() : (t.seconds || 0) * 1000;
  };
  const byKey = new Map();
  for (const d of docs) {
    const key = normalizeKey(d.data.name);
    const cur = byKey.get(key);
    const sec = d.data.durationSeconds ?? 999999;
    const dist = safeNumber(d.data.distance);
    if (!cur) {
      byKey.set(key, d);
      continue;
    }
    const curSec = cur.data.durationSeconds ?? 999999;
    const curDist = safeNumber(cur.data.distance);
    if (sec < curSec || (sec === curSec && dist > curDist) || (sec === curSec && dist === curDist && tsMs(d) > tsMs(cur))) {
      byKey.set(key, d);
    }
  }
  const out = Array.from(byKey.values());
  out.sort((a, b) => {
    const aSec = a.data.durationSeconds ?? 999999;
    const bSec = b.data.durationSeconds ?? 999999;
    if (aSec !== bSec) return aSec - bSec;
    const aDist = safeNumber(a.data.distance);
    const bDist = safeNumber(b.data.distance);
    if (aDist !== bDist) return bDist - aDist;
    return tsMs(b) - tsMs(a);
  });
  return out;
}

async function fetchSegmentLeaderboard(segmentName) {
  const snapshot = await db.collection(LEADERBOARD_COLLECTION).where('segmentName', '==', segmentName).get();
  const docs = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
  const countByRider = {};
  for (const d of docs) {
    const key = normalizeKey(d.data.name);
    countByRider[key] = (countByRider[key] || 0) + 1;
  }
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
  const deduped = dedupeBestPerRider(docs);
  return { docs: deduped, countByRider };
}

function renderTable(segmentName, docs, countByRider = {}) {
  let prevRank = 0, prevSec = null, prevDist = null;
  const rows = docs.map((doc, index) => {
    const e = doc.data;
    const sec = e.durationSeconds ?? 999999;
    const dist = safeNumber(e.distance);
    const isTie = prevSec !== null && prevSec === sec && prevDist === dist;
    const rank = isTie ? prevRank : index + 1;
    prevRank = rank;
    prevSec = sec;
    prevDist = dist;
    const rankDisplay = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const riderKey = normalizeKey(e.name);
    const N = countByRider[riderKey] ?? 1;
    const nameDisplay = N > 1 ? escapeHtml(String(e.name ?? '')) + ' <span class="rider-doc-count">(' + N + ')</span>' : escapeHtml(String(e.name ?? ''));
    const name = nameDisplay;
    const duration = escapeHtml(String(e.duration ?? '—'));
    const distance = dist > 0 ? (dist / 1000).toFixed(2) + ' km' : '—';
    const speed = sec > 0 && dist > 0 ? ((dist / 1000) / (sec / 3600)).toFixed(1) + ' km/h' : '—';
    const date = formatRecordDate(e.startTime);
    return `<tr><td>${rankDisplay}</td><td>${name}</td><td>${duration}</td><td>${distance}</td><td>${speed}</td><td>${date}</td></tr>`;
  }).join('');
  const thead = '<thead><tr><th>#</th><th>Name</th><th>Duration</th><th>Distance</th><th>Speed</th><th>Date</th></tr></thead>';
  const tbody = '<tbody>' + (rows || '') + '</tbody>';
  return '<table>' + thead + tbody + '</table>';
}

function rankDocsWithTies(docs) {
  const ranked = [];
  let prevRank = 0, prevSec = null, prevDist = null;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const sec = d.data.durationSeconds ?? 999999;
    const dist = safeNumber(d.data.distance);
    const isTie = prevSec !== null && prevSec === sec && prevDist === dist;
    const rank = isTie ? prevRank : i + 1;
    prevRank = rank;
    prevSec = sec;
    prevDist = dist;
    ranked.push({ doc: d, rank });
  }
  return ranked;
}

function segmentPoints(rank, N) {
  if (rank != null) {
    if (rank === 1) return -3;
    if (rank === 2) return -2;
    if (rank === 3) return -1;
    if (rank >= 4) return rank;
  }
  if (N === 0) return 0;
  return N + 2;
}

function renderOverallLeaderboard(segmentData, allSegments) {
  const riderDisplayName = {};
  const pointsByRider = {};
  const segmentN = {};
  for (const segmentName of allSegments) {
    const seg = segmentData[segmentName];
    const docs = seg && seg.docs ? seg.docs : (Array.isArray(seg) ? seg : []);
    const N = docs.length;
    segmentN[segmentName] = N;
    const ranked = rankDocsWithTies(docs);
    for (const { doc, rank } of ranked) {
      const key = normalizeKey(doc.data.name);
      if (!pointsByRider[key]) pointsByRider[key] = {};
      pointsByRider[key][segmentName] = rank;
      if (!riderDisplayName[key]) riderDisplayName[key] = String(doc.data.name ?? '').trim() || '—';
    }
  }
  const riderKeys = Object.keys(pointsByRider);
  const total = (key) => {
    let sum = 0;
    for (const seg of allSegments) {
      const n = segmentN[seg];
      const pts = pointsByRider[key][seg];
      sum += segmentPoints(pts, n);
    }
    return sum;
  };
  riderKeys.sort((a, b) => total(a) - total(b));

  const dnsCell = (n) => n === 0 ? '' : (n + 1) + '+1';

  const theadCells = ['Segment'].concat(riderKeys.map(key => escapeHtml(riderDisplayName[key])));
  const thead = '<thead><tr><th>' + theadCells.join('</th><th>') + '</th></tr></thead>';
  const tbodyRows = allSegments.map(seg => {
    const n = segmentN[seg];
    const cells = [escapeHtml(segmentShortName(seg))];
    for (const key of riderKeys) {
      const rank = pointsByRider[key][seg];
      if (rank != null) {
        const score = segmentPoints(rank, n);
        let display = String(rank);
        if (score !== rank) {
          const scoreStr = score > 0 ? '+' + score : String(score);
          display += ' (' + scoreStr + ')';
        }
        cells.push(display);
      } else {
        let label = 'DNS';
        if (n > 0) {
          label += ' (' + (n + 1) + '+1)';
        }
        cells.push('<span class="cell-dns">' + escapeHtml(label) + '</span>');
      }
    }
    return '<tr><td>' + cells.join('</td><td>') + '</td></tr>';
  });
  const totalRowCells = ['Total'].concat(riderKeys.map(key => String(total(key))));
  tbodyRows.push('<tr class="total-row"><td>' + totalRowCells.join('</td><td>') + '</td></tr>');
  const tbody = '<tbody>' + tbodyRows.join('') + '</tbody>';
  return '<div class="overall-leaderboard"><h2 class="level-header">OVERALL ➡  lowest sum wins 🏆</h2><div class="overall-table-wrap"><table class="overall-matrix">' + thead + tbody + '</table></div></div>';
}

function runPixelDissolveReveal(targetEls, { gridSize = 42, durationMs = 1200 } = {}) {
  if (!Array.isArray(targetEls) || targetEls.length === 0) return;

  const rects = targetEls
    .map(el => (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null)
    .filter(r => r && r.width > 1 && r.height > 1);

  if (!rects.length) return;

  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  const width = Math.ceil(right - left);
  const height = Math.ceil(bottom - top);

  const overlay = document.createElement('div');
  overlay.className = 'pixel-reveal-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;

  const pixels = [];
  const pixelWrap = document.createElement('div');
  pixelWrap.style.position = 'absolute';
  pixelWrap.style.inset = '0';
  overlay.appendChild(pixelWrap);

  // Keep tiles 1:1 (square). `gridSize` is the target tile count on the smaller side.
  // Also cap tile count to avoid scheduling thousands of timeouts (performance).
  let tileSize = Math.max(2, Math.min(width, height) / gridSize);
  let gridCols = Math.ceil(width / tileSize);
  let gridRows = Math.ceil(height / tileSize);
  const maxTiles = 2500;
  let totalTiles = gridCols * gridRows;
  if (totalTiles > maxTiles) {
    const scale = Math.sqrt(totalTiles / maxTiles);
    tileSize = Math.max(2, tileSize * scale);
    gridCols = Math.ceil(width / tileSize);
    gridRows = Math.ceil(height / tileSize);
    totalTiles = gridCols * gridRows;
  }

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const px = document.createElement('div');
      px.className = 'pixel';
      px.style.width = `${tileSize}px`;
      px.style.height = `${tileSize}px`;
      px.style.left = `${col * tileSize}px`;
      px.style.top = `${row * tileSize}px`;
      pixelWrap.appendChild(px);
      pixels.push(px);
    }
  }
  document.body.appendChild(overlay);

  // Hide targets instantly while the colored pixels dissolve.
  // (No fade; keeps the effect simple + fast.)
  const prevTargetStyles = new Map();
  for (const el of targetEls) {
    prevTargetStyles.set(el, { opacity: el.style.opacity, transition: el.style.transition });
    el.style.opacity = '0';
    el.style.transition = 'none';
  }

  // Finer-grained reveal: hide pixels in a random order (dither-style dissolve).
  const total = pixels.length;
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  const palette = ['	rgb(255, 0, 0)', 'rgb(255, 156, 0)', 'rgb(0, 255, 255)'];
  const pickColor = () => palette[Math.floor(Math.random() * palette.length)];

  // Give each tile a starting color.
  for (let i = 0; i < pixels.length; i++) {
    pixels[i].style.backgroundColor = pickColor();
    pixels[i].style.transition = 'none';
  }

  let revealed = 0;
  const startTs = performance.now();
  const dissolveTick = () => {
    const elapsed = performance.now() - startTs;
    const targetCount = Math.min(total, Math.floor((elapsed / durationMs) * total));
    while (revealed < targetCount) {
      pixels[order[revealed]].classList.add('is-gone');
      revealed++;
    }
    if (elapsed < durationMs) {
      requestAnimationFrame(dissolveTick);
      return;
    }

    // End: remove overlay and restore target visibility.
    overlay.remove();
    for (const el of targetEls) {
      const prev = prevTargetStyles.get(el);
      el.style.opacity = (prev && prev.opacity != null) ? prev.opacity : '';
      el.style.transition = (prev && prev.transition != null) ? prev.transition : '';
    }
  };
  requestAnimationFrame(dissolveTick);
}

const overallContainer = document.getElementById('overall-leaderboard-container');
const container = document.getElementById('leaderboard-container');
const loadingOverlay = document.getElementById('loading-overlay');
(async function () {
  let loadingOverlayRemoved = false;
  try {
    const segRes = await fetch('data/segments.geojson');
    if (!segRes.ok) throw new Error('Could not load segments.');
    const segText = await segRes.text();
    const { segmentsByLevel } = parseGeoJsonSegmentDefinitions(segText);
    const levelNames = Object.keys(segmentsByLevel).filter(k => k !== '(no level)').sort();
    if (segmentsByLevel['(no level)']) levelNames.push('(no level)');
    const allSegments = levelNames.flatMap(ln => segmentsByLevel[ln] || []);
    if (!levelNames.length) {
      container.innerHTML = '<p class="empty">No segments defined.</p>';
    } else {
      const segmentData = {};
      for (const segmentName of allSegments) {
        try {
          segmentData[segmentName] = await fetchSegmentLeaderboard(segmentName);
        } catch (_) {
          segmentData[segmentName] = [];
        }
      }
      if (allSegments.length > 0) {
        overallContainer.innerHTML = renderOverallLeaderboard(segmentData, allSegments);
      } else {
        overallContainer.innerHTML = '';
      }
      container.innerHTML = '';
      for (const levelName of levelNames) {
        const segmentNames = segmentsByLevel[levelName] || [];
        const levelSection = document.createElement('div');
        levelSection.className = 'level-group';
        levelSection.innerHTML = '<h2 class="level-header">' + escapeHtml(levelName) + '</h2>';
        container.appendChild(levelSection);
        for (const segmentName of segmentNames) {
          const block = document.createElement('div');
          block.className = 'segment-block';
          block.innerHTML = '<h3 class="segment-title">' + escapeHtml(segmentName) + '</h3>';
          levelSection.appendChild(block);
          const seg = segmentData[segmentName];
          const docs = seg && seg.docs ? seg.docs : (Array.isArray(seg) ? seg : []);
          const countByRider = (seg && seg.countByRider) ? seg.countByRider : {};
          if (docs.length === 0) {
            block.innerHTML += '<p class="empty">No entries yet... ⚡ Go RIDE!!</p>';
          } else {
            block.innerHTML += renderTable(segmentName, docs, countByRider);
          }
        }
      }

      // Fade + pixel dissolve reveal over the newly rendered leaderboard.
      const revealTargets = [];
      if (overallContainer && overallContainer.innerHTML && overallContainer.innerHTML.trim()) {
        revealTargets.push(overallContainer);
      }
      if (container && container.innerHTML && container.innerHTML.trim()) {
        revealTargets.push(container);
      }
      if (revealTargets.length) {
        loadingOverlay?.remove();
        loadingOverlayRemoved = true;
        runPixelDissolveReveal(revealTargets, { gridSize: 42, durationMs: 240 });
      }
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="error">Could not load leaderboard.</p>';
    loadingOverlay?.remove();
    loadingOverlayRemoved = true;
  } finally {
    if (!loadingOverlayRemoved) loadingOverlay?.remove();
  }
})();

function enableMouseDragScroll(containerEl) {
  if (!containerEl) return;

  let isDown = false;
  let startY = 0;
  let startScrollTop = 0;
  let rafId = 0;
  let lastY = 0;

  const shouldStartDrag = (target) => {
    if (!target) return false;
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest('a, button, input, textarea, select, summary')) return false;
    return true;
  };

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    if (!shouldStartDrag(e.target)) return;

    isDown = true;
    lastY = e.clientY;
    startY = e.clientY;
    startScrollTop = containerEl.scrollTop;
    containerEl.classList.add('is-drag-scrolling');

    containerEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!isDown) return;
    lastY = e.clientY;

    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const dy = lastY - startY;
      containerEl.scrollTop = startScrollTop - dy;
    });
  };

  const stopDrag = () => {
    isDown = false;
    containerEl.classList.remove('is-drag-scrolling');
  };

  containerEl.addEventListener('pointerdown', onPointerDown);
  containerEl.addEventListener('pointermove', onPointerMove);
  containerEl.addEventListener('pointerup', stopDrag);
  containerEl.addEventListener('pointercancel', stopDrag);
  containerEl.addEventListener('pointerleave', stopDrag);
}

if (document.body?.classList?.contains('leaderboard-page')) {
  const scrollEl = document.getElementById('leaderboard-scroll');
  enableMouseDragScroll(scrollEl || document.body);
}

const infoOverlay = document.getElementById('leaderboard-info');
const infoCloseBtn = infoOverlay?.querySelector('.leaderboard-info-close');
const infoLink = document.querySelector('.info-link');

if (infoOverlay && infoLink) {
  infoLink.addEventListener('click', (e) => {
    e.preventDefault();
    infoOverlay.classList.toggle('is-open');
  });
}

if (infoOverlay && infoCloseBtn) {
  infoCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    infoOverlay.classList.remove('is-open');
  });
}
