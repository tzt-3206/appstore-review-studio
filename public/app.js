const $ = (sel) => document.querySelector(sel);

const STAGE_DEFS = [
  { id: 'scope', name: 'Scope Analysis' },
  { id: 'collect', name: 'Review Collection' },
  { id: 'clean', name: 'Cleaning & Dedup' },
  { id: 'semantic', name: 'Semantic Analysis' },
  { id: 'findings', name: 'Findings' },
  { id: 'evidence', name: 'Evidence Validation' },
  { id: 'versions', name: 'Version Planning' },
  { id: 'prd', name: 'PRD Generation' },
  { id: 'tests', name: 'Test Generation' },
  { id: 'trace', name: 'Traceability Validation' },
];

const TABS = [
  ['overview', 'Overview'],
  ['scope', 'Scope'],
  ['raw', 'Raw Reviews'],
  ['cleaning', 'Cleaning'],
  ['topics', 'Topics'],
  ['findings', 'Findings'],
  ['evidence', 'Evidence'],
  ['versions', 'Versions'],
  ['prd', 'PRD'],
  ['tests', 'Tests'],
  ['trace', 'Traceability'],
  ['model', 'Model & Prompts'],
];

const state = {
  source: 'url',
  jobId: null,
  es: null,
  result: null,
  activeTab: 'overview',
  stageMap: {},
  prompts: null,
  config: null,
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function truncate(value, max = 180) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

function stars(rating) {
  const n = Number(rating) || 0;
  return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.min(5, n)));
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function log(level, message, extra = {}) {
  const container = $('#log');
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const time = new Date().toISOString().slice(11, 19);
  line.innerHTML = `<span class="t">${time}</span><span class="lvl">${esc(level)}</span><span class="msg">${esc(message)}</span>`;
  container.appendChild(line);
  while (container.children.length > 300) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

function renderStageList() {
  const container = $('#stages');
  const resultStages = state.result?.stages ?? null;
  const rows = STAGE_DEFS.map((def) => {
    const status = resultStages ? resultStages.find((s) => s.id === def.id) : state.stageMap[def.id] ?? { status: 'pending' };
    const cls = status.status === 'running' ? 'running' : status.status === 'failed' ? 'failed' : status.status === 'warning' ? 'warning' : status.status === 'done' ? 'done' : 'pending';
    const icon =
      cls === 'running'
        ? '<i data-lucide="loader-circle"></i>'
        : cls === 'done'
          ? '<i data-lucide="check"></i>'
          : cls === 'failed'
            ? '<i data-lucide="circle-x"></i>'
            : cls === 'warning'
              ? '<i data-lucide="triangle-alert"></i>'
              : '<i data-lucide="circle-dot"></i>';
    const message = status.message ? `<div class="stage-message">${esc(status.message)}</div>` : '';
    const time = status.ended_at
      ? fmtTime(status.ended_at)
      : status.started_at
        ? fmtTime(status.started_at)
        : '';
    return `<li class="stage ${cls}" data-stage="${def.id}">
      <span class="stage-icon">${icon}</span>
      <div><div class="stage-name">${esc(def.name)}</div>${message}</div>
      <span class="stage-time">${time}</span>
    </li>`;
  });
  container.innerHTML = rows.join('');
  refreshIcons();
}

function setBanner(kind, title, message, actions = []) {
  const banner = $('#banner');
  if (!title) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  banner.className = `banner ${kind}`;
  const icon = kind === 'error' ? '<i data-lucide="circle-alert"></i>' : kind === 'warning' ? '<i data-lucide="triangle-alert"></i>' : '<i data-lucide="circle-check"></i>';
  const actionHtml = actions
    .map((a) => `<button class="btn small" type="button" data-banner-action="${a.action}"><i data-lucide="${a.icon}"></i>${esc(a.label)}</button>`)
    .join('');
  banner.innerHTML = `<div class="banner-body"><h3>${esc(title)}</h3><p>${esc(message)}</p>${actionHtml ? `<div class="actions">${actionHtml}</div>` : ''}</div>`;
  banner.classList.remove('hidden');
  refreshIcons();
}

function setSource(type) {
  state.source = type;
  document.querySelectorAll('.source-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.source === type);
  });
  $('#url-field').classList.toggle('hidden', type !== 'url');
  $('#file-field').classList.toggle('hidden', type !== 'json' && type !== 'csv');
  $('#file-label').textContent = type === 'csv' ? 'CSV file' : type === 'json' ? 'JSON file' : 'Review data file';
  $('#storefront-badge').classList.toggle('hidden', type !== 'url');
}

function readFileInput(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

async function startAnalysis() {
  const button = $('#start');
  button.disabled = true;
  setBanner(null);
  state.jobId = null;
  state.result = null;
  state.stageMap = {};
  state.prompts = null;
  renderStageList();
  $('#content').innerHTML = '<div class="empty-state"><i data-lucide="loader-circle"></i><p>Pipeline running...</p></div>';
  refreshIcons();
  $('#log').innerHTML = '';

  const goal = $('#goal').value.trim();
  const constraints = {
    min_rating: $('#min-rating').value ? Number($('#min-rating').value) : null,
    max_rating: $('#max-rating').value ? Number($('#max-rating').value) : null,
    versions: $('#versions').value
      ? $('#versions').value.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    max_reviews: $('#max-reviews').value ? Number($('#max-reviews').value) : null,
  };

  let source;
  if (state.source === 'url') {
    const url = $('#url').value.trim();
    if (!url) {
      setBanner('error', 'Missing App Store URL', 'Provide a valid apps.apple.com URL.');
      button.disabled = false;
      return;
    }
    source = { type: 'url', url };
  } else if (state.source === 'demo') {
    source = { type: 'demo' };
  } else {
    const file = $('#file').files[0];
    if (!file) {
      setBanner('error', 'Missing review data file', `Select a ${state.source.toUpperCase()} file before starting.`);
      button.disabled = false;
      return;
    }
    source = { type: state.source, text: await readFileInput(file), fileName: file.name };
  }

  log('info', 'Starting pipeline');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, goal, constraints }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to start analysis.');
    state.jobId = data.job_id;
    log('info', `Job ${data.job_id} created`);
    connectJob(data.job_id);
  } catch (error) {
    setBanner('error', 'Could not start analysis', error.message);
    log('error', error.message);
    button.disabled = false;
  }
}

function connectJob(jobId) {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/jobs/${jobId}/events`);
  state.es = es;

  es.addEventListener('snapshot', (event) => {
    const snapshot = JSON.parse(event.data);
    if (snapshot.result) {
      state.result = snapshot.result;
      state.stageMap = {};
      renderStageList();
      renderTabs();
      renderContent();
    }
  });

  es.addEventListener('stage_start', (event) => {
    const data = JSON.parse(event.data);
    state.stageMap[data.stage_id] = { status: 'running', started_at: data.time };
    renderStageList();
  });

  es.addEventListener('stage_end', (event) => {
    const data = JSON.parse(event.data);
    state.stageMap[data.stage_id] = {
      status: data.status,
      message: data.message,
      started_at: state.stageMap[data.stage_id]?.started_at,
      ended_at: new Date().toISOString(),
    };
    renderStageList();
  });

  es.addEventListener('info', (event) => {
    const data = JSON.parse(event.data);
    log('info', data.message || '');
  });

  es.addEventListener('warning', (event) => {
    const data = JSON.parse(event.data);
    log('warning', data.message || '');
  });

  es.addEventListener('error', (event) => {
    const data = JSON.parse(event.data);
    log('error', data.message || data.error || 'Pipeline error');
  });

  es.addEventListener('llm', (event) => {
    const data = JSON.parse(event.data);
    const text =
      data.type === 'model_call'
        ? `Model call ${data.task} (attempt ${data.attempt}/${data.attempt ?? '?'})`
        : data.type === 'model_retry'
          ? `Model retry ${data.task}: ${data.error}`
          : data.type === 'model_success'
            ? `Model success ${data.task}`
            : `${data.type} ${data.task ?? ''}`;
    log('info', text);
  });

  es.addEventListener('result', (event) => {
    const data = JSON.parse(event.data);
    state.result = data.result;
    state.stageMap = {};
    renderStageList();
    renderTabs();
    renderContent();
  });

  es.addEventListener('done', async (event) => {
    const data = JSON.parse(event.data);
    if (data.result) {
      state.result = data.result;
    } else {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        const snapshot = await response.json();
        state.result = snapshot.result;
      } catch {
        state.result = null;
      }
    }
    es.close();
    state.es = null;
    renderStageList();
    renderTabs();
    renderContent();
    $('#start').disabled = false;
    const errors = state.result?.errors ?? [];
    const warnings = state.result?.warnings ?? [];
    if (errors.length) {
      setBanner('error', 'Pipeline completed with errors', `${errors.length} errors; ${warnings.length} warnings. See evidence and traceability tabs.`);
    } else if (warnings.length) {
      setBanner('warning', 'Pipeline completed with warnings', `${warnings.length} warnings were recorded.`);
    } else {
      setBanner('success', 'Pipeline completed', 'All stages finished and traceability validated.');
    }
  });

  es.onerror = () => {
    // EventSource reconnects automatically; the done event closes the stream.
  };
}

function renderTabs() {
  const hasResult = Boolean(state.result);
  const counts = {
    findings: state.result?.artifacts?.findings?.findings?.length,
    prd: state.result?.artifacts?.requirements?.length,
    tests: state.result?.artifacts?.test_cases?.length,
  };
  const tabs = TABS.map(([id, label]) => {
    const count = counts[id];
    return `<button class="tab ${state.activeTab === id ? 'active' : ''}" data-tab="${id}" type="button">${esc(label)}${count !== undefined && hasResult ? `<span class="count">${count}</span>` : ''}</button>`;
  }).join('');
  $('#tabs').innerHTML = tabs;
  $('#tabs').querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
      renderContent();
    });
  });
}

function renderContent() {
  const result = state.result;
  const tab = state.activeTab;
  const container = $('#content');
  const renderers = {
    overview: () => renderOverview(result),
    scope: () => renderScope(result),
    raw: () => renderRawReviews(result),
    cleaning: () => renderCleaning(result),
    topics: () => renderTopics(result),
    findings: () => renderFindings(result),
    evidence: () => renderEvidence(result),
    versions: () => renderVersions(result),
    prd: () => renderPrd(result),
    tests: () => renderTests(result),
    trace: () => renderTrace(result),
    model: () => renderModel(result),
  };
  container.innerHTML = renderers[tab]?.() ?? '<div class="empty-state"><p>Nothing to show.</p></div>';
  refreshIcons();
  updateExports();
}

function statGrid(items) {
  return `<div class="stat-grid">${items
    .map(([label, value]) => `<div class="stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div>`)
    .join('')}</div>`;
}

function renderOverview(result) {
  if (!result) return '<div class="empty-state"><p>No result yet.</p></div>';
  const a = result.artifacts ?? {};
  const cleaning = a.cleaning ?? {};
  const scope = a.scope ?? {};
  const trace = a.traceability?.summary ?? {};
  const cached = result.cached
    ? `<div class="summary-box warn"><p><strong>${esc(result.cached_label || 'CACHED SAMPLE')}</strong> - this result was generated earlier from the U.S. App Store feed and is shown for offline review.</p></div>`
    : '';
  const app = scope.app;
  const appBlock = app
    ? statGrid([
        ['App', app.name],
        ['Seller', app.seller],
        ['Current version', app.version],
        ['User rating count', app.user_rating_count ?? '—'],
        ['Average rating', app.average_user_rating ?? '—'],
        ['Genres', (app.genres ?? []).slice(0, 3).join(', ')],
      ])
    : '';
  const stats = statGrid([
    ['Raw reviews', cleaning.raw_count ?? a.raw_reviews?.length ?? 0],
    ['Valid reviews', cleaning.valid_count ?? 0],
    ['Duplicates removed', cleaning.duplicate_count ?? 0],
    ['Invalid rows', cleaning.invalid_count ?? 0],
    ['Average rating', cleaning.stats?.average_rating ?? '—'],
    ['Topics', a.topics?.topics?.length ?? 0],
    ['Findings', a.findings?.findings?.length ?? 0],
    ['Requirements', a.requirements?.length ?? 0],
    ['Test cases', a.test_cases?.length ?? 0],
    ['Trace issues', trace.issues_total ?? '—'],
  ]);
  return `${cached}
    ${appBlock}
    ${stats}
    <div class="summary-box"><p><strong>Scope:</strong> ${esc(scope.summary || 'No scope summary.')}</p></div>
    ${result.goal ? `<div class="section-title">Analysis goal</div><div class="desc">${esc(result.goal)}</div>` : ''}
    ${trace.reviews_total ? `<div class="section-title">Traceability</div><div class="desc">${trace.reviews_covered_by_findings}/${trace.reviews_total} reviews covered by findings; ${trace.findings_with_requirements}/${trace.findings_total} findings with requirements; ${trace.requirements_with_tests}/${trace.requirements_total} requirements with tests.</div>` : ''}
    `;
}

function renderScope(result) {
  const a = result?.artifacts ?? {};
  const scope = a.scope ?? {};
  const analysis = a.scope_analysis ?? {};
  const filters = scope.filters ?? {};
  const pre = a.scope_pre;
  const methodPill = analysis.method === 'llm_refined' ? '<span class="pill accent">model-refined</span>' : '<span class="pill low">deterministic</span>';
  const filterRows = [
    ['min_rating', filters.min_rating],
    ['max_rating', filters.max_rating],
    ['versions', (filters.versions ?? []).join(', ') || 'all'],
    ['languages', (filters.languages ?? []).join(', ') || 'all'],
    ['max_reviews', filters.max_reviews ?? 'all'],
  ];
  const focus = (scope.focus_areas ?? []).map((f) => `<span class="pill accent">${esc(f)}</span>`).join(' ');
  return `<div class="section-title">Scope ${methodPill}</div>
    <div class="summary-box"><p>${esc(scope.summary || 'No scope summary.')}</p></div>
    <div class="section-title">Focus areas</div><div class="meta">${focus || '<span class="pill low">none parsed</span>'}</div>
    <div class="section-title">Applied filters</div>
    <div class="table-wrap"><table><tbody>${filterRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    ${pre?.country_note ? `<div class="section-title">Storefront note</div><div class="desc">${esc(pre.country_note)}</div>` : ''}
    <div class="section-title">Priority rationale</div><div class="desc">${esc(scope.priority_rationale || '—')}</div>
    <div class="section-title">Data sufficiency</div><div class="desc">${esc(scope.data_sufficiency_notes || '—')}</div>
    <div class="section-title">Deterministic goal parsing</div>
    <div class="block-list"><li>${esc(analysis.deterministic?.note || 'Goal parsing applied.')}</li><li>Applied: ${esc((analysis.deterministic?.applied ?? []).join(', ') || 'none')}</li></div>`;
}

function reviewsTable(reviews, limit = 100) {
  const rows = (reviews ?? []).slice(0, limit).map(
    (r) => `<tr>
      <td class="mono">${esc(r.review_id ?? r.external_id ?? '')}</td>
      <td>${esc(r.author ?? '')}</td>
      <td><span class="stars">${stars(r.rating)}</span></td>
      <td class="mono">${esc(r.version ?? '')}</td>
      <td>${esc(fmtDate(r.date))}</td>
      <td>${esc(truncate(r.title || r.content || '', 90))}</td>
      <td class="mono">${esc(r.language ?? '')}</td>
    </tr>`,
  );
  return `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Author</th><th>Rating</th><th>Version</th><th>Date</th><th>Content</th><th>Lang</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="7">No reviews.</td></tr>'}</tbody></table></div>`;
}

function renderRawReviews(result) {
  const reviews = result?.artifacts?.raw_reviews ?? [];
  if (!reviews.length) return '<div class="empty-state"><p>No raw reviews.</p></div>';
  return `${statGrid([['Raw reviews', reviews.length]])}${reviewsTable(reviews, 200)}`;
}

function renderCleaning(result) {
  const cleaning = result?.artifacts?.cleaning;
  if (!cleaning) return '<div class="empty-state"><p>No cleaning result.</p></div>';
  const stats = cleaning.stats ?? {};
  const ratingBars = Object.entries(stats.rating_distribution ?? {})
    .map(([rating, count]) => `<li>${stars(Number(rating))} <strong>${count}</strong></li>`)
    .join('');
  return `${statGrid([
    ['Raw reviews', cleaning.raw_count],
    ['Valid reviews', cleaning.valid_count],
    ['Duplicates removed', cleaning.duplicate_count],
    ['Invalid rows', cleaning.invalid_count],
    ['Average rating', stats.average_rating ?? '—'],
    ['Languages', Object.keys(stats.languages ?? {}).length],
  ])}
  <div class="section-title">Rating distribution</div>
  <ul class="block-list">${ratingBars || '<li>No data.</li>'}</ul>
  ${cleaning.duplicates?.length ? `<div class="section-title">Duplicates removed (${cleaning.duplicates.length})</div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Reason</th></tr></thead><tbody>${cleaning.duplicates.slice(0, 30).map((d) => `<tr><td class="mono">${esc(d.external_id)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${cleaning.invalid?.length ? `<div class="section-title">Invalid rows (${cleaning.invalid.length})</div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Reason</th></tr></thead><tbody>${cleaning.invalid.slice(0, 30).map((d) => `<tr><td class="mono">${esc(d.external_id)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  `;
}

function renderTopics(result) {
  const a = result?.artifacts ?? {};
  const topics = a.topics?.topics ?? [];
  const classification = a.classification ?? {};
  const topicCards = topics
    .map((topic) => {
      const stat = (classification.topic_stats ?? []).find((s) => s.topic_id === topic.id);
      return `<div class="item-card"><h4>${esc(topic.id)} · ${esc(topic.name)}</h4>
        <div class="meta"><span class="pill ${topic.rating_bias === 'negative' ? 'high' : topic.rating_bias === 'positive' ? 'ok' : 'low'}">${esc(topic.rating_bias ?? 'mixed')}</span><span class="pill accent">${stat?.member_count ?? 0} reviews</span></div>
        <p class="desc">${esc(topic.description || '')}</p>
        <div class="section-title">Example reviews</div><ul class="block-list">${(topic.example_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('') || '<li>none</li>'}</ul>
      </div>`;
    })
    .join('');
  const method = a.topics?.degraded ? '<span class="pill warn">rule-based fallback</span>' : '<span class="pill accent">model-driven</span>';
  const tableRows = (classification.classified ?? []).slice(0, 80).map(
    (r) => `<tr><td class="mono">${esc(r.review_id)}</td><td><span class="stars">${stars(r.rating)}</span></td><td>${esc((r.topics ?? []).map((t) => t).join(', ') || '—')}</td><td><span class="pill ${r.sentiment === 'negative' ? 'high' : r.sentiment === 'positive' ? 'ok' : 'low'}">${esc(r.sentiment)}</span></td><td>${esc(truncate(r.title || r.content, 100))}</td></tr>`,
  ).join('');
  return `<div class="section-title">Dynamic topics ${method}</div>
    <div class="grid-cards">${topicCards || '<div class="item-card"><p class="desc">No topics discovered.</p></div>'}</div>
    <div class="section-title">Classification sample</div>
    <div class="table-wrap"><table><thead><tr><th>Review ID</th><th>Rating</th><th>Topics</th><th>Sentiment</th><th>Content</th></tr></thead><tbody>${tableRows || '<tr><td colspan="5">No classifications.</td></tr>'}</tbody></table></div>
    ${a.topics?.error ? `<div class="summary-box warn"><p>Model note: ${esc(a.topics.error)}</p></div>` : ''}`;
}

function findingCard(finding) {
  const det = finding.deterministic_evidence ?? {};
  const statusPill = finding.evidence_status === 'supported' ? '<span class="pill ok">supported</span>' : '<span class="pill warn">assumption</span>';
  const rejected = finding.status === 'rejected' ? '<span class="pill high">rejected</span>' : '';
  const conflict = (finding.conflicting_review_ids ?? []).length
    ? `<div class="section-title">Conflicting evidence</div><ul class="block-list">${finding.conflicting_review_ids.map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>`
    : '<p class="desc">No conflicting reviews identified.</p>';
  return `<div class="item-card">
    <h4>${esc(finding.finding_id)} · ${esc(finding.title)}</h4>
    <div class="meta">${statusPill}${rejected}<span class="pill ${finding.confidence === 'high' ? 'high' : finding.confidence === 'medium' ? 'medium' : 'low'}">confidence ${esc(finding.confidence)}</span><span class="pill accent">${det.support_count ?? finding.support_count} supporting</span>${finding.topic_id ? `<span class="pill low">${esc(finding.topic_id)}</span>` : ''}</div>
    <p class="desc">${esc(finding.summary || '')}</p>
    ${finding.excerpts?.length ? `<div class="section-title">Source excerpts</div><ul class="block-list">${finding.excerpts.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <div class="section-title">Review IDs</div><ul class="block-list">${(finding.review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
    ${conflict}
    ${det.support_count !== undefined ? `<div class="section-title">Deterministic evidence</div><ul class="block-list"><li>avg rating ${det.average_rating}, negative share ${det.negative_share}, conflict share ${det.conflict_share}, evidence score ${det.evidence_score}</li></ul>` : ''}
    ${finding.assumptions?.length ? `<div class="section-title">Assumptions / limitations</div><ul class="block-list">${finding.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderFindings(result) {
  const findings = result?.artifacts?.findings?.findings ?? [];
  if (!findings.length) return '<div class="empty-state"><p>No findings generated.</p></div>';
  return `<div class="section-title">Evidence-grounded findings (${findings.length})</div><div class="grid-cards">${findings.map(findingCard).join('')}</div>`;
}

function renderEvidence(result) {
  const evidence = result?.artifacts?.evidence;
  if (!evidence) return '<div class="empty-state"><p>No evidence validation result.</p></div>';
  const decisions = (evidence.decisions ?? [])
    .map(
      (d) => `<div class="validation-row"><span class="mono">${esc(d.finding_id)}</span><span class="${d.decision === 'keep' ? 'ok' : 'bad'}">${esc(d.decision)}</span><span>${esc(d.reason || '')}</span><span></span></div>`,
    )
    .join('');
  const checks = (evidence.deterministic?.checks ?? [])
    .map(
      (c) => `<div class="validation-row"><span class="mono">${esc(c.finding_id)}</span><span class="${c.review_ids_exist ? 'ok' : 'bad'}">${c.review_ids_exist ? 'valid' : 'invalid'}</span><span>${esc(c.issues.join('; ') || 'ok')}</span><span class="mono">${c.support_count}/${c.min_support}</span></div>`,
    )
    .join('');
  const revisions = (result.revisions ?? []).map(
    (r) => `<div class="validation-row"><span class="mono">${esc(r.finding_id ?? '')}</span><span class="bad">${esc(r.action ?? '')}</span><span>${esc(r.reason ?? '')}</span><span></span></div>`,
  ).join('');
  return `${statGrid([
    ['Findings checked', (evidence.decisions ?? []).length],
    ['Kept', (evidence.decisions ?? []).filter((d) => d.decision === 'keep').length],
    ['Assumptions', (evidence.decisions ?? []).filter((d) => d.decision === 'mark_assumption').length],
    ['Rejected/revised', (evidence.decisions ?? []).filter((d) => d.decision === 'revise_or_reject').length],
  ])}
  <div class="section-title">Evidence decisions</div>${decisions || '<p class="desc">No decisions.</p>'}
  <div class="section-title">Deterministic checks</div>${checks || '<p class="desc">No checks.</p>'}
  ${revisions ? `<div class="section-title">Applied revisions</div>${revisions}` : ''}
  ${evidence.semantic_error ? `<div class="summary-box warn"><p>Semantic validation model note: ${esc(evidence.semantic_error)}</p></div>` : ''}`;
}

function renderVersions(result) {
  const plan = result?.artifacts?.version_planning?.version_plan;
  const scoring = result?.artifacts?.version_planning?.scoring ?? [];
  if (!plan) return '<div class="empty-state"><p>No version plan.</p></div>';
  const cards = (plan.versions ?? []).map(
    (v) => `<div class="item-card"><h4>${esc(v.id)} · ${esc(v.name)}</h4><p class="desc">${esc(v.rationale || '')}</p><div class="section-title">Findings</div><ul class="block-list">${(v.finding_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('') || '<li>none</li>'}</ul></div>`,
  ).join('');
  const scores = scoring.map((s) => `<div class="validation-row"><span class="mono">${esc(s.finding_id)}</span><span class="mono">${s.score}</span></div>`).join('');
  return `<div class="section-title">Version plan</div><div class="grid-cards">${cards}</div>
    ${scores ? `<div class="section-title">Evidence scores</div>${scores}` : ''}
    ${plan.scoring_notes ? `<div class="section-title">Scoring notes</div><div class="desc">${esc(JSON.stringify(plan.scoring_notes))}</div>` : ''}`;
}

function requirementCard(req) {
  return `<div class="item-card">
    <h4>${esc(req.requirement_id)} · ${esc(req.title)}</h4>
    <div class="meta"><span class="pill ${req.priority === 'P0' ? 'high' : req.priority === 'P1' ? 'medium' : 'low'}">${esc(req.priority)}</span><span class="pill accent">${esc(req.target_version_id ?? '')}</span><span class="pill low">${esc(req.finding_id)}</span><span class="pill low">${esc(req.evidence_strength ?? '')} evidence</span></div>
    <p class="desc"><strong>Problem:</strong> ${esc(req.problem || '')}</p>
    <p class="desc"><strong>User need:</strong> ${esc(req.user_need || '')}</p>
    <div class="section-title">Description</div><div class="desc">${esc(req.description || '')}</div>
    <div class="section-title">Acceptance criteria</div><ul class="block-list">${(req.acceptance_criteria ?? []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li>none</li>'}</ul>
    <div class="section-title">Source reviews</div><ul class="block-list">${(req.source_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
    ${req.assumptions?.length ? `<div class="section-title">Assumptions</div><ul class="block-list">${req.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderPrd(result) {
  const requirements = result?.artifacts?.requirements ?? [];
  if (!requirements.length) return '<div class="empty-state"><p>No PRD requirements generated.</p></div>';
  return `<div class="section-title">PRD requirements (${requirements.length})</div><div class="grid-cards">${requirements.map(requirementCard).join('')}</div>`;
}

function testCard(test) {
  return `<div class="item-card">
    <h4>${esc(test.test_case_id)} · ${esc(test.title)}</h4>
    <div class="meta"><span class="pill ${test.priority === 'P0' ? 'high' : test.priority === 'P1' ? 'medium' : 'low'}">${esc(test.priority)}</span><span class="pill low">${esc(test.requirement_id)}</span><span class="pill low">${esc(test.finding_id)}</span></div>
    <div class="section-title">Preconditions</div><ul class="block-list">${(test.preconditions ?? []).map((p) => `<li>${esc(p)}</li>`).join('') || '<li>none</li>'}</ul>
    <div class="section-title">Steps</div><ol class="block-list">${(test.steps ?? []).map((s, i) => `<li>${i + 1}. ${esc(s)}</li>`).join('') || '<li>none</li>'}</ol>
    <div class="section-title">Expected results</div><ul class="block-list">${(test.expected_results ?? []).map((e) => `<li>${esc(e)}</li>`).join('') || '<li>none</li>'}</ul>
    <div class="section-title">Source reviews</div><ul class="block-list">${(test.source_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
  </div>`;
}

function renderTests(result) {
  const tests = result?.artifacts?.test_cases ?? [];
  if (!tests.length) return '<div class="empty-state"><p>No test cases generated.</p></div>';
  return `<div class="section-title">Test cases (${tests.length})</div><div class="grid-cards">${tests.map(testCard).join('')}</div>`;
}

function renderTrace(result) {
  const trace = result?.artifacts?.traceability;
  if (!trace) return '<div class="empty-state"><p>No traceability result.</p></div>';
  const s = trace.summary ?? {};
  const nodes = [
    ['Reviews', s.reviews_total],
    ['Findings', s.findings_total],
    ['Requirements', s.requirements_total],
    ['Test cases', s.tests_total],
  ]
    .map(([label, value]) => `<div class="trace-node"><strong>${value ?? 0}</strong><span>${label}</span></div>`)
    .join('');
  const issues = (trace.issues ?? [])
    .map((i) => `<div class="validation-row"><span class="mono">${esc(i.id)}</span><span class="bad">broken</span><span>${esc(i.message)}</span><span></span></div>`)
    .join('');
  const validations = (trace.validations ?? [])
    .map(
      (v) => `<div class="validation-row"><span>${esc(v.from)}</span><span class="mono">${esc(v.id)}</span><span>${esc(v.detail)}</span><span class="${v.valid ? 'ok' : 'bad'}">${v.valid ? 'valid' : 'invalid'}</span></div>`,
    )
    .join('');
  return `${statGrid([
    ['Reviews covered by findings', s.reviews_covered_by_findings],
    ['Findings with requirements', s.findings_with_requirements],
    ['Requirements with tests', s.requirements_with_tests],
    ['Issues', s.issues_total],
  ])}
  <div class="section-title">Chain</div><div class="trace-graph">${nodes}</div>
  <div class="section-title">Issues</div>${issues || '<p class="desc">No issues.</p>'}
  <div class="section-title">Validated links</div>${validations || '<p class="desc">No links.</p>'}`;
}

function renderModel(result) {
  const model = result?.model ?? state.config ?? {};
  const rows = [
    ['Provider', model.provider ?? state.config?.llmProvider ?? '—'],
    ['Model', model.model ?? state.config?.ollamaModel ?? '—'],
    ['Temperature', model.temperature ?? '—'],
    ['Structured output', model.structured_output ?? 'JSON'],
    ['Retry strategy', model.retry_strategy ?? '—'],
    ['Failure strategy', model.failure_strategy ?? '—'],
  ];
  const info = `<div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
  const mitigations = (model.hallucination_mitigations ?? []).map((m) => `<li>${esc(m)}</li>`).join('');
  const html = `${info}
    ${mitigations ? `<div class="section-title">Hallucination mitigations</div><ul class="block-list">${mitigations}</ul>` : ''}
    <div class="section-title">Prompt definitions</div><div id="prompt-list"><p class="desc">Loading prompts...</p></div>`;
  setTimeout(loadPrompts, 0);
  return html;
}

async function loadPrompts() {
  const container = $('#prompt-list');
  if (!container) return;
  if (!state.prompts) {
    try {
      const response = await fetch('/api/prompts');
      state.prompts = await response.json();
    } catch {
      state.prompts = [];
    }
  }
  container.innerHTML =
    (state.prompts ?? [])
      .map(
        (p) => `<details class="prompt-block"><summary>${esc(p.name)}</summary><pre>${esc(p.content)}</pre></details>`,
      )
      .join('') || '<p class="desc">Prompts unavailable.</p>';
  refreshIcons();
}

function updateExports() {
  const hasResult = Boolean(state.result);
  $('#export-json').disabled = !hasResult;
  $('#export-csv').disabled = !hasResult;
  $('#export-md').disabled = !hasResult;
}

function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download('review-studio-result.json', JSON.stringify(state.result, null, 2));
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const a = state.result?.artifacts ?? {};
  const rows = [['artifact', 'id', 'rating', 'title', 'content', 'version', 'date', 'language', 'finding_id', 'requirement_id', 'priority', 'evidence_status', 'sentiment', 'detail']];
  for (const r of a.raw_reviews ?? []) {
    rows.push(['review', r.review_id ?? '', r.rating ?? '', r.title ?? '', r.content ?? '', r.version ?? '', r.date ?? '', r.language ?? '', '', '', '', '', '', '']);
  }
  for (const f of a.findings?.findings ?? []) {
    rows.push(['finding', f.finding_id, '', f.title, f.summary, '', '', '', '', '', '', f.evidence_status, '', f.review_ids?.join(' ') ?? '']);
  }
  for (const r of a.requirements ?? []) {
    rows.push(['requirement', r.requirement_id, '', r.title, r.description, '', '', '', r.finding_id, '', r.priority, r.evidence_strength, '', r.source_review_ids?.join(' ') ?? '']);
  }
  for (const t of a.test_cases ?? []) {
    rows.push(['test_case', t.test_case_id, '', t.title, t.steps?.join(' | ') ?? '', '', '', '', t.finding_id, t.requirement_id, t.priority, '', '', t.source_review_ids?.join(' ') ?? '']);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  download('review-studio-deliverables.csv', csv, 'text/csv');
}

function exportMarkdown() {
  const result = state.result;
  const a = result?.artifacts ?? {};
  const lines = [];
  lines.push('# Review Studio Report', '', `- Goal: ${result.goal ?? ''}`, `- Cached: ${result.cached ? result.cached_label : 'No'}`, `- Model: ${result.model?.provider} / ${result.model?.model}`, '');
  lines.push('## Scope', '', `- ${a.scope?.summary ?? ''}`, `- Focus: ${(a.scope?.focus_areas ?? []).join(', ')}`, '');
  lines.push('## Cleaning', '', `- Raw: ${a.cleaning?.raw_count ?? 0}`, `- Valid: ${a.cleaning?.valid_count ?? 0}`, `- Duplicates removed: ${a.cleaning?.duplicate_count ?? 0}`, '');
  lines.push('## Findings');
  for (const f of a.findings?.findings ?? []) {
    lines.push('', `### ${f.finding_id} ${f.title}`, '', `- Confidence: ${f.confidence}`, `- Supporting: ${f.review_ids?.length ?? 0}`, `- Evidence status: ${f.evidence_status}`, `- Source IDs: ${(f.review_ids ?? []).join(', ')}`, '', `> ${f.summary ?? ''}`, '');
  }
  lines.push('## Version Plan');
  for (const v of a.version_planning?.version_plan?.versions ?? []) {
    lines.push('', `### ${v.id} ${v.name}`, `- Findings: ${(v.finding_ids ?? []).join(', ')}`, `- ${v.rationale ?? ''}`, '');
  }
  lines.push('## Requirements');
  for (const r of a.requirements ?? []) {
    lines.push('', `### ${r.requirement_id} ${r.title}`, '', `- Priority: ${r.priority}`, `- Version: ${r.target_version_id}`, `- Finding: ${r.finding_id}`, `- Source reviews: ${(r.source_review_ids ?? []).join(', ')}`, '', `> ${r.description ?? ''}`, '');
  }
  lines.push('## Test Cases');
  for (const t of a.test_cases ?? []) {
    lines.push('', `### ${t.test_case_id} ${t.title}`, '', `- Requirement: ${t.requirement_id}`, `- Finding: ${t.finding_id}`, `- Source reviews: ${(t.source_review_ids ?? []).join(', ')}`, `- Preconditions: ${(t.preconditions ?? []).join('; ')}`, `- Steps: ${(t.steps ?? []).join('; ')}`, `- Expected: ${(t.expected_results ?? []).join('; ')}`, '');
  }
  lines.push('## Traceability', '', `- Reviews covered: ${a.traceability?.summary?.reviews_covered_by_findings ?? 0}/${a.traceability?.summary?.reviews_total ?? 0}`, `- Issues: ${a.traceability?.summary?.issues_total ?? 0}`, '');
  download('review-studio-report.md', lines.join('\n'), 'text/markdown');
}

async function init() {
  $('#start').addEventListener('click', startAnalysis);
  $('#clear-log').addEventListener('click', () => {
    $('#log').innerHTML = '';
  });
  $('#clear-goal').addEventListener('click', () => {
    $('#goal').value = '';
  });
  document.querySelectorAll('.source-tab').forEach((tab) => {
    tab.addEventListener('click', () => setSource(tab.dataset.source));
  });
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('#goal').value = chip.textContent.trim();
    });
  });
  $('#export-json').addEventListener('click', exportJson);
  $('#export-csv').addEventListener('click', exportCsv);
  $('#export-md').addEventListener('click', exportMarkdown);
  $('#banner').addEventListener('click', (event) => {
    const button = event.target.closest('[data-banner-action]');
    if (!button) return;
    const action = button.dataset.bannerAction;
    if (action === 'retry') {
      startAnalysis();
    } else if (action === 'demo') {
      setSource('demo');
      startAnalysis();
    }
  });

  try {
    const response = await fetch('/api/config');
    state.config = await response.json();
    const cfg = state.config;
    $('#model-status').innerHTML = '<i data-lucide="cpu"></i><span>' + esc(`${cfg.llmProvider} · ${cfg.ollamaModel}`) + '</span>';
    $('#model-detail').innerHTML = `
      <div><dt>Provider</dt><dd>${esc(cfg.llmProvider)}</dd></div>
      <div><dt>Model</dt><dd>${esc(cfg.ollamaModel)}</dd></div>
      <div><dt>Structured output</dt><dd>JSON</dd></div>
      <div><dt>Max reviews</dt><dd>${esc(cfg.maxReviews)}</dd></div>
      <div><dt>Min finding support</dt><dd>${esc(cfg.minFindingSupport)}</dd></div>`;
    $('#model-status').classList.add('ok');
  } catch {
    $('#model-status').innerHTML = '<i data-lucide="circle-alert"></i><span>Config unavailable</span>';
  }
  renderStageList();
  renderTabs();
  refreshIcons();
  setSource('url');
}

init();
