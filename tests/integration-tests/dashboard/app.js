/* Dashboard SPA — vanilla JS. Reads catalog.json, renders facet sidebar +
 * filterable table + per-test detail pane.
 *
 * Filter semantics:
 *   - Status filter (passed/failed/timed out/skipped/not run/excluded): OR
 *     within the group. Status is the LATEST run's outcome, bucketed the way
 *     its run summary counts it: a test the run planned but produced no
 *     verdict for is "not run" (its older result, if any, stays visible in the
 *     detail pane) and adds up to the header's "N not run"; a test the run
 *     never planned (Playwright config or command line) is "excluded", outside
 *     the total.
 *   - Each facet (persona/area/layer/kind/ccrs/health): OR within the group.
 *   - Across groups: AND.
 *   - Search box: substring match on title or file path.
 *
 * Run window: catalog.json keeps results for the newest 30 runs, the newest
 * RUN_LIMIT of which still have their report folder (run.hasReport). The run
 * chips, the per-test dots and the detail pane's run list show five runs at a
 * time (run-window.js), paged with Newer/Older. Any window but the newest is
 * kept in the URL as `?runs=<id of its newest run>`, so a refresh or a shared
 * link shows the same runs even after newer runs arrive; without the param the
 * newest runs are shown. The headline and the status filter always describe
 * the LATEST run; the detail pane's "last N runs" line summarises every run
 * the catalog keeps.
 */
'use strict';

const FACET_LABELS = {
  persona: 'Persona',
  area:    'Area',
  layer:   'Layer',
  kind:    'Kind',
  ccrs:    'CCRS issue',
  pr:      'PR',
  health:  'Health',
};
const FACET_ORDER = ['persona', 'area', 'layer', 'kind', 'ccrs', 'pr', 'health'];

const STATUS_OPTIONS = [
  { value: 'passed',   label: 'Passed'  },
  { value: 'failed',   label: 'Failed'  },
  { value: 'timedOut', label: 'Timed out' },
  { value: 'skipped',  label: 'Skipped' },
  { value: 'notrun',   label: 'Not run (latest)' },
  { value: 'excluded', label: 'Excluded' },
];
const STATUS_TEXT = { notrun: 'not run', excluded: 'excluded' };
const EXCLUDED_WHY = 'the Playwright config or command line leaves it out on this deployment, so it is outside the run total.';
const EXCLUDED_TEXT = `Not planned by the latest run: ${EXCLUDED_WHY}`;

const state = {
  catalog: null,
  filters: {
    status: new Set(),
    facets: {},   // { persona: Set, area: Set, ... }
    search: '',
  },
  selectedId: null,
  runStart: 0,  // position in catalog.runs of the window's newest run (0 = newest); see run-window.js
};
const RW = window.RunWindow;

/**
 * Did this test produce a verdict in the latest run? catalog.json carries the
 * flag; older catalogs lack it, so fall back to "its newest history entry is
 * the latest run" (history only gains an entry when the test ran — older
 * builders also wrote one for an interrupted test, which reached no verdict).
 */
function ranInLatest(t) {
  if (typeof t.ranInLatestRun === 'boolean') return t.ranInLatestRun;
  const h0 = t.history && t.history[0];
  return !!(h0 && h0.runId === state.catalog.lastRunId && h0.status !== 'interrupted');
}

/** A run summary written before not-run tracking: its counts may include carried-over results. */
function isLegacyCount(r) { return RW.isLegacyCount(r); }
/** Its cutShort is null too, but that means unknown there, not "ran to the end". */
const LEGACY_TEXT = 'legacy count: recorded before not-run tracking, may include results carried over from older runs; whether it was cut short is unknown';

/**
 * Left out of the latest run's total? The builder records its decision per
 * test; older catalogs lack it, so fall back to the rule they were counted by
 * (an @local-only test with no verdict).
 */
function isExcluded(t) {
  if (typeof t.excluded === 'boolean') return t.excluded;
  return !ranInLatest(t) && (t.tags || []).includes('@local-only');
}

/**
 * Latest-run status, bucketed as the run summary counts it: 'excluded' (not in
 * its total), lastStatus when it reached a verdict, else 'notrun' — whether or
 * not an earlier run reached it — so the 'notrun' count equals run.notRun.
 */
function displayStatus(t) {
  if (isExcluded(t)) return 'excluded';
  if (ranInLatest(t) && t.lastStatus) return t.lastStatus;
  return 'notrun';
}

/**
 * The newest result that reached a verdict, as { status, runId }, or null.
 * Catalogs from older builders can hold an interrupted lastStatus or history
 * entry, which reached none, so both are skipped.
 */
function lastKnown(t) {
  const h = (t.history || []).find(x => x.status !== 'interrupted');
  if (t.lastStatus && t.lastStatus !== 'interrupted') {
    return { status: t.lastStatus, runId: (t.latestRun && t.latestRun.runId) || (h && h.runId) || null };
  }
  return h ? { status: h.status, runId: h.runId } : null;
}

/** "passed in 2026-10-01_1544_71d4743d" — where a carried-over lastStatus came from. */
function lastKnownText(t) {
  const k = lastKnown(t);
  if (!k) return '';
  return k.runId ? `${k.status} in ${k.runId}` : k.status;
}

async function init() {
  try {
    const resp = await fetch('catalog.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.catalog = await resp.json();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<p style="color:var(--fail)">Failed to load catalog.json: ${escapeHtml(e.message)}</p>`;
    return;
  }
  for (const facet of FACET_ORDER) state.filters.facets[facet] = new Set();
  // ?runs=<run id>, an old ?runs=<page>, or a run that has since aged out:
  // resolve it, then name the window by its run id from here on.
  state.runStart = RW.startFromSearch(location.search, state.catalog.runs);
  syncRunsParam();
  renderRunSummary();
  renderStatusFilter();
  renderFacetFilters();
  renderTable();
  hookSearch();
  hookClear();
  hookHash();
}

function renderRunSummary() {
  const r = (state.catalog.runs || [])[0];
  const el = document.getElementById('run-summary');
  if (!r) { el.textContent = 'no runs yet'; return; }
  const ago = relTime(r.startedAt);
  el.innerHTML = [
    `<strong>${escapeHtml(r.id)}</strong>`,
    `<span class="pill pass">${r.passed} passed</span>`,
    `<span class="pill fail">${r.failed} failed</span>`,
    `<span class="pill skip">${r.skipped} skipped</span>`,
    r.notRun ? `<span class="pill notrun" title="Planned by this run but produced no result in it">${r.notRun} not run</span>` : '',
    r.cutShort ? `<span class="pill cut" title="${escapeAttr(r.cutShort)}">⚠ run cut short</span>` : '',
    isLegacyCount(r) ? `<span class="muted" title="${escapeAttr(LEGACY_TEXT)}">legacy count · cut short: unknown</span>` : '',
    r.excluded ? `<span class="muted" title="On disk but not planned by this run (Playwright config or command line); outside the total">${r.excluded} excluded</span>` : '',
    `<span class="muted">${r.total} total · ${formatDuration(r.durationMs)} · ${escapeHtml(r.branch)}@${escapeHtml(r.sha || '?')} · ${ago}</span>`,
    `<span class="muted">vs ${escapeHtml(r.baseUrl)}</span>`,
  ].filter(Boolean).join(' ');
  renderRunSwitcher();
}

/** The five runs of the current window of catalog.runs, plus the pager state. */
function runWindow() {
  return RW.windowAt(state.catalog.runs || [], state.runStart);
}

/** Point `?runs=` at the current window (dropped for the newest), keeping other params and the hash. */
function syncRunsParam() {
  const search = RW.searchForStart(location.search, state.catalog.runs, state.runStart);
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
}

/** Move the run window (0 = newest); keeps `?runs=` in the URL and redraws what follows it. */
function setRunStart(start) {
  const next = RW.clampStart(start, (state.catalog.runs || []).length);
  if (next === state.runStart) return;
  state.runStart = next;
  syncRunsParam();
  renderRunSwitcher();
  renderTable();
  if (state.selectedId) renderDetail(state.selectedId);
}

/**
 * The run chips for the current window (newest first) with the Newer/Older
 * pager. A chip links to that run's standalone Playwright HTML report at
 * /tests/runs/<id>/playwright-report/ while the run still has one; older runs
 * keep their counts but lose the folder, so their chip is plain text marked
 * "report pruned". The latest run is marked with a star.
 */
function renderRunSwitcher() {
  const el = document.getElementById('run-switcher');
  const all = state.catalog.runs || [];
  if (all.length === 0) { el.innerHTML = ''; return; }
  const win = runWindow();
  const kept = RW.reportsKept(all);
  const latestId = state.catalog.lastRunId;
  const chips = win.runs.map(r => {
    const chip = RW.runChip(r, latestId); // link or not: decided (and unit-tested) in run-window.js
    const tooltip = `${r.id} · ${relTime(r.startedAt)} · ${r.passed}p ${r.failed}f ${r.skipped}s` +
      (r.notRun ? ` ${r.notRun} not run` : '') + (r.cutShort ? ` · cut short: ${r.cutShort}` : '') +
      (chip.legacy ? ` · ${LEGACY_TEXT}` : '') +
      (chip.pruned ? ` · report pruned: only the newest ${kept} runs keep their report, video and traces` : '');
    const body = `${escapeHtml(chip.label)}
       <span class="run-chip-stats">${escapeHtml(chip.stats)}</span>`;
    return chip.href
      ? `<a class="${chip.cls}" target="_blank" rel="noopener"
       href="${escapeAttr(chip.href)}"
       title="${escapeAttr(tooltip)}">${body}</a>`
      : `<span class="${chip.cls}" title="${escapeAttr(tooltip)}">${body}</span>`;
  }).join('');
  el.innerHTML = `<span class="run-switcher-label">Runs:</span>
    <button type="button" class="run-pager" id="runs-newer" ${win.hasNewer ? '' : 'disabled'} title="Show the five newer runs">‹ Newer</button>
    ${chips}
    <button type="button" class="run-pager" id="runs-older" ${win.hasOlder ? '' : 'disabled'} title="Show the five older runs">Older ›</button>
    <span class="run-window-label" id="run-window-label">${escapeHtml(win.label)}</span>`;
  document.getElementById('runs-newer').addEventListener('click', () => setRunStart(Math.max(0, state.runStart - RW.PAGE_SIZE)));
  document.getElementById('runs-older').addEventListener('click', () => setRunStart(state.runStart + RW.PAGE_SIZE));
}

function renderStatusFilter() {
  const counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, notrun: 0, excluded: 0 };
  for (const t of state.catalog.tests) {
    const s = displayStatus(t);
    counts[s] = (counts[s] || 0) + 1;
  }
  const wrap = document.getElementById('filter-status');
  wrap.innerHTML = STATUS_OPTIONS.map(opt => {
    const c = counts[opt.value] || 0;
    return `<label><input type="checkbox" data-status="${opt.value}"> ${opt.label} <span class="count">${c}</span></label>`;
  }).join('');
  wrap.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      const v = cb.dataset.status;
      if (cb.checked) state.filters.status.add(v);
      else state.filters.status.delete(v);
      renderTable();
    });
  });
}

function renderFacetFilters() {
  const counts = {};   // counts[facet][value]
  for (const t of state.catalog.tests) {
    for (const tag of t.tags) {
      const m = tag.match(/^@([a-z]+):(.+)$/i);
      if (!m) continue;
      const [_, facet, value] = m;
      (counts[facet] ||= {})[value] = (counts[facet]?.[value] || 0) + 1;
    }
  }
  const root = document.getElementById('facet-filters');
  root.innerHTML = '';
  for (const facet of FACET_ORDER) {
    const values = (state.catalog.tagFacets || {})[facet] || [];
    if (!values.length) continue;
    const sec = document.createElement('section');
    sec.className = 'filter-group';
    sec.innerHTML = `<h3>${escapeHtml(FACET_LABELS[facet] || facet)}</h3>` +
      `<div class="filter-options">` +
      values.map(v => {
        const c = (counts[facet] || {})[v] || 0;
        return `<label><input type="checkbox" data-facet="${escapeHtml(facet)}" data-value="${escapeHtml(v)}"> ${escapeHtml(v)} <span class="count">${c}</span></label>`;
      }).join('') +
      `</div>`;
    root.appendChild(sec);
  }
  root.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const facet = cb.dataset.facet;
      const value = cb.dataset.value;
      const set = state.filters.facets[facet] ||= new Set();
      if (cb.checked) set.add(value); else set.delete(value);
      renderTable();
    });
  });
}

function applyFilters(tests) {
  const f = state.filters;
  return tests.filter(t => {
    if (f.status.size) {
      if (!f.status.has(displayStatus(t))) return false;
    }
    for (const facet of FACET_ORDER) {
      const want = f.facets[facet];
      if (!want || !want.size) continue;
      const have = new Set();
      for (const tag of t.tags) {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        if (m && m[1] === facet) have.add(m[2]);
      }
      let any = false;
      for (const v of want) if (have.has(v)) { any = true; break; }
      if (!any) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q)
          && !t.file.toLowerCase().includes(q)
          && !t.describe.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderTable() {
  const win = runWindow();
  const head = document.getElementById('runs-col');
  head.textContent = win.total ? `Runs ${win.first}–${win.last}` : 'Runs';
  head.title = `One dot per run, newest first: ${win.label}. Page with Newer/Older at the top.`;
  const filtered = applyFilters(state.catalog.tests);
  document.getElementById('result-meta').textContent =
    `${filtered.length} of ${state.catalog.tests.length} tests shown`;
  const tbody = document.querySelector('#test-table tbody');
  tbody.innerHTML = filtered.map(t => rowHtml(t)).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => selectTest(tr.dataset.id));
  });
  if (state.selectedId) {
    const sel = tbody.querySelector(`tr[data-id="${cssEscape(state.selectedId)}"]`);
    if (sel) sel.classList.add('selected');
  }
}

function rowHtml(t) {
  const dots = renderDots(t);
  const tags = t.tags.map(tagChipHtml).join('');
  const status = displayStatus(t);
  const statusTitle = status === 'notrun'
    ? `Not run in the latest run · ${lastKnownText(t) ? `last: ${lastKnownText(t)}` : 'no earlier result in the window'}`
    : status === 'excluded' ? EXCLUDED_TEXT : '';
  const dur = ranInLatest(t) && t.lastDurationMs != null ? formatDuration(t.lastDurationMs) : '—';
  return `<tr data-id="${escapeAttr(t.id)}">
    <td class="title-cell">${escapeHtml(t.title)}<div class="describe">${escapeHtml(t.describe)}</div></td>
    <td class="file-cell" title="${escapeAttr(t.file)}:${t.line}">${escapeHtml(t.file)}:${t.line}</td>
    <td class="tag-cell">${tags}</td>
    <td class="numeric"><div class="dot-row">${dots}</div></td>
    <td class="numeric">${dur}</td>
    <td><span class="status-badge ${escapeHtml(status === 'excluded' ? 'unknown' : status)}"${statusTitle ? ` title="${escapeAttr(statusTitle)}"` : ''}>${escapeHtml(STATUS_TEXT[status] || status)}</span></td>
  </tr>`;
}

/**
 * One dot per run in the current window (newest first), so a dot always means
 * the same run for every test. A run the test produced no result in renders as
 * a hollow "not run" dot instead of the test's older results sliding left into
 * that slot; a short last page pads with dashed empty dots.
 */
function renderDots(t) {
  const slots = RW.slotsFor(t, runWindow().runs);
  const out = [];
  for (let i = 0; i < RW.PAGE_SIZE; i++) {
    const h = slots[i];
    if (!h) { out.push('<span class="dot empty"></span>'); continue; }
    // 'interrupted' (older catalogs) reached no verdict either — same ring as the badge's "not run".
    if (h.notRun) { out.push(`<span class="dot notrun" title="${escapeAttr(h.runId)} · not run"></span>`); continue; }
    out.push(`<span class="dot ${escapeHtml(h.status)}" title="${escapeHtml(h.runId)} · ${escapeHtml(h.status)} · ${formatDuration(h.durationMs)}"></span>`);
  }
  return out.join('');
}

/** "Last 30 runs: 24 passed · 3 failed · 3 not run" — across every run the catalog keeps. */
function recentSummaryHtml(t) {
  const runs = state.catalog.runs || [];
  if (!runs.length) return '';
  const s = RW.recentSummary(t, runs);
  const parts = [`${s.passed} passed`, `${s.failed} failed`];
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  if (s.notRun) parts.push(`${s.notRun} not run`);
  return `<div class="recent-summary" title="Across all ${s.runs} runs the dashboard keeps, not only the five shown">Last ${s.runs} runs: ${parts.join(' · ')}</div>`;
}

function tagChipHtml(tag) {
  const m = tag.match(/^@([a-z]+):(.+)$/i);
  const facet = m ? m[1] : 'other';
  const value = m ? m[2] : tag;
  return `<span class="tag-chip" data-facet="${escapeAttr(facet)}" data-value="${escapeAttr(value)}" data-tag="${escapeAttr(tag)}">${escapeHtml(value)}</span>`;
}

function selectTest(id) {
  state.selectedId = id;
  location.hash = `#test/${encodeURIComponent(id)}`;
  document.querySelectorAll('#test-table tbody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === id);
  });
  renderDetail(id);
}

function renderDetail(id) {
  const t = state.catalog.tests.find(x => x.id === id);
  const detail = document.getElementById('detail');
  document.getElementById('layout').classList.add('with-detail');
  if (!t) {
    detail.hidden = false;
    detail.innerHTML = `<p>Test not found: ${escapeHtml(id)}</p>`;
    return;
  }
  detail.hidden = false;
  const lr = t.latestRun;
  const tagChips = t.tags.map(tagChipHtml).join(' ');
  const dots = renderDots(t);
  const win = runWindow();
  // The carried-over latestRun (and its media) is only kept while that run
  // still has its report; once that is pruned only the history is left to cite.
  const known = lastKnown(t);
  const knownRun = known && (state.catalog.runs || []).find(r => r.id === known.runId);
  const staleNote = isExcluded(t)
    ? `<p class="stale-note">Excluded from the latest run (${escapeHtml(state.catalog.lastRunId)}): ${escapeHtml(EXCLUDED_WHY)}` +
      (known ? ` Its last result was ${escapeHtml(lastKnownText(t))}.` : '') + `</p>`
    : (!ranInLatest(t) && known)
    ? `<p class="stale-note">Not run in the latest run (${escapeHtml(state.catalog.lastRunId)}). ` +
      (lr && lr.runId === known.runId
        ? `The result, video and error below are from the last run that reached it: ${escapeHtml(lastKnownText(t))}.`
        : `Its last result was ${escapeHtml(lastKnownText(t))}; ` +
          (knownRun && !RW.hasReport(knownRun)
            ? `that run's report has been pruned (only the newest ${RW.reportsKept(state.catalog.runs)} runs keep one), so no video or error is kept for it.`
            : 'no video or error is kept for that run.') +
          (lr ? ` The media below is from ${escapeHtml(lr.runId)}, where it was stopped before a verdict.` : '')) +
      `</p>`
    : !ranInLatest(t)
    ? `<p class="stale-note">Not run in the latest run (${escapeHtml(state.catalog.lastRunId)}), and no earlier run in the window reached it.</p>`
    : '';
  const error = (lr && (lr.errorMessage || lr.errorStack))
    ? `<div class="section"><h4>Error</h4><pre class="error">${escapeHtml((lr.errorMessage || '') + '\n\n' + (lr.errorStack || ''))}</pre></div>`
    : '';
  const screenshots = (lr && lr.screenshotUrls && lr.screenshotUrls.length)
    ? `<div class="section"><h4>Screenshots</h4><div class="screenshot-thumbs">${lr.screenshotUrls.map(u => `<a href="${escapeAttr(u)}" target="_blank"><img src="${escapeAttr(u)}" loading="lazy"></a>`).join('')}</div></div>`
    : '';
  const video = (lr && lr.videoUrl)
    ? `<div class="section"><h4>Video</h4><video src="${escapeAttr(lr.videoUrl)}" controls preload="metadata"></video></div>`
    : `<div class="section"><h4>Video</h4><p class="muted">No video for the latest run (test did not run, or media capture disabled).</p></div>`;
  const trace = (lr && lr.traceUrl)
    ? `<a href="${escapeAttr(lr.traceUrl)}" target="_blank">Open trace.zip</a>`
    : '';
  const reportHref = RW.latestRunReportPath(lr, state.catalog.runs);
  const reportLink = reportHref
    ? `<a href="${escapeAttr(reportHref)}" target="_blank">Open Playwright report</a>`
    : '';
  const description = t.description
    ? `<div class="section"><h4>Description</h4><div class="description-body">${descriptionToHtml(t.description)}</div></div>`
    : `<div class="section"><h4>Description</h4><p class="muted">No description yet — add one to the test as <code>annotation: { type: 'description', description: '…' }</code>.</p></div>`;

  detail.innerHTML = `
    <button class="close-btn" id="close-detail" aria-label="Close">×</button>
    <h2>${escapeHtml(t.title)}</h2>
    <div class="describe">${escapeHtml(t.describe)} · ${escapeHtml(t.file)}:${t.line}</div>
    ${staleNote}
    ${description}
    <div class="section"><h4>Tags</h4>${tagChips}</div>
    <div class="section"><h4 title="Newest first; page with Newer/Older at the top">${win.total ? `Runs ${win.first}–${win.last} of ${win.total}` : 'Runs'}</h4><div class="dot-row">${dots}</div><div class="history-row">${historyHtml(t, win.runs)}</div>${recentSummaryHtml(t)}</div>
    ${video}
    ${screenshots}
    <div class="section"><h4>Actions</h4><div class="actions">${trace} ${reportLink} <button id="copy-claude-prompt">Copy as Claude prompt</button></div></div>
    ${error}
    <div class="section"><h4>Source</h4><pre class="source">${escapeHtml(t.source)}</pre></div>
  `;
  document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('layout').classList.remove('with-detail');
    detail.hidden = true;
    state.selectedId = null;
    if (location.hash.startsWith('#test/')) history.replaceState(null, '', location.pathname + location.search);
  });
  const copyBtn = document.getElementById('copy-claude-prompt');
  copyBtn.addEventListener('click', () => {
    const prompt = buildClaudePrompt(t);
    navigator.clipboard.writeText(prompt).then(() => {
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyBtn.textContent = 'Copy as Claude prompt'), 1400);
    }, () => {
      copyBtn.textContent = 'Copy failed';
    });
  });
  detail.querySelectorAll('.tag-chip, a.ref-link').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const facet = el.dataset.facet;
      const value = el.dataset.value;
      if (!facet || !value) return;
      const set = state.filters.facets[facet] ||= new Set();
      set.add(value);
      const cb = document.querySelector(`#facet-filters input[data-facet="${cssEscape(facet)}"][data-value="${cssEscape(value)}"]`);
      if (cb) cb.checked = true;
      renderTable();
    });
  });
}

/**
 * Render the multi-paragraph annotation.description into HTML.
 * Format expected from build-catalog (mirrors what authors write):
 *   <opening paragraph>
 *
 *   Steps:
 *   1. …
 *   2. …
 *
 *   <closing paragraph>
 *
 * We split on blank lines, then for each block look for "Steps:" followed by
 * numbered lines and turn that into an <ol>. Other blocks render as <p>.
 */
function descriptionToHtml(text) {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks.map(block => {
    if (/^Steps:\s*$/m.test(block.split('\n')[0])) {
      const lines = block.split('\n').slice(1);
      const items = lines
        .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
        .filter(Boolean);
      return `<p class="steps-heading">Steps:</p><ol class="steps-list">${items.map(s => `<li>${linkifyAndEscape(s)}</li>`).join('')}</ol>`;
    }
    return `<p>${linkifyAndEscape(block)}</p>`;
  }).join('');
}

/**
 * HTML-escape and turn CCRS#NNN / PR#NN references into clickable filter chips.
 * The dashboard already filters by ccrs/pr facets; clicking a reference adds
 * it to the active filter so you can see all related tests.
 */
function linkifyAndEscape(s) {
  let out = escapeHtml(s);
  // CCRS#NNN -> filter chip
  out = out.replace(/\bCCRS#(\d+)\b/g, (_m, num) =>
    `<a class="ref-link" href="#ccrs/${num}" data-facet="ccrs" data-value="${num}">CCRS#${num}</a>`);
  // PR #NN or PR#NN
  out = out.replace(/\bPR\s*#(\d+)\b/g, (_m, num) =>
    `<a class="ref-link" href="#pr/${num}" data-facet="pr" data-value="${num}">PR#${num}</a>`);
  return out;
}

function buildClaudePrompt(t) {
  const lr = t.latestRun;
  const status = isExcluded(t)
    ? `excluded from the latest run (${state.catalog.lastRunId}) by the Playwright config; last known: ${lastKnownText(t) || 'never ran'}`
    : ranInLatest(t)
    ? (t.lastStatus || 'never ran')
    : `not run in the latest run (${state.catalog.lastRunId}); last known: ${lastKnownText(t) || 'never ran'}`;
  const errorBlock = lr && (lr.errorMessage || lr.errorStack)
    ? `\n\nError:\n${lr.errorMessage || ''}\n${lr.errorStack || ''}`
    : '';
  const videoLine = lr && lr.videoUrl
    ? `Latest video: ${absoluteUrl(lr.videoUrl)}`
    : 'No video for the latest run.';
  const intentBlock = t.description
    ? `\nWhat this test is meant to verify (author's description):\n${t.description}\n`
    : '';
  return [
    `This Playwright test is at ${t.file}:${t.line}:`,
    '',
    t.source,
    intentBlock,
    `Last run status: ${status}.`,
    videoLine,
    errorBlock,
  ].filter(Boolean).join('\n');
}

/** The test's result in each run of the current window, newest first. */
function historyHtml(t, windowRuns) {
  if (!windowRuns.length) return '<span class="muted">no runs yet</span>';
  return RW.slotsFor(t, windowRuns)
    .map(h => h.notRun
      ? `${escapeHtml(h.runId)}: not run`
      : `${escapeHtml(h.runId)}: ${escapeHtml(h.status)} (${formatDuration(h.durationMs)})`)
    .join(' · ');
}

function hookSearch() {
  const input = document.getElementById('search');
  input.addEventListener('input', () => {
    state.filters.search = input.value.trim();
    renderTable();
  });
}

function hookClear() {
  document.getElementById('clear-filters').addEventListener('click', () => {
    state.filters.status.clear();
    for (const facet of FACET_ORDER) state.filters.facets[facet]?.clear();
    state.filters.search = '';
    document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => (cb.checked = false));
    document.getElementById('search').value = '';
    renderTable();
  });
}

function hookHash() {
  function handleHash() {
    const m = location.hash.match(/^#test\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      state.selectedId = id;
      const tr = document.querySelector(`#test-table tbody tr[data-id="${cssEscape(id)}"]`);
      if (tr) tr.classList.add('selected');
      renderDetail(id);
    }
  }
  window.addEventListener('hashchange', handleHash);
  handleHash();
}

// helpers --------------------------------------------------------------------

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function cssEscape(s) { return CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`); }
function absoluteUrl(rel) {
  try { return new URL(rel, location.href).href; } catch { return rel; }
}
function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
}
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const dt = (Date.now() - t) / 1000;
  if (dt < 60) return `${Math.round(dt)}s ago`;
  if (dt < 3600) return `${Math.round(dt/60)}m ago`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ago`;
  return `${Math.round(dt/86400)}d ago`;
}

init();
