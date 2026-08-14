const $ = (sel) => document.querySelector(sel);

const STAGE_DEFS = [
  { id: 'scope', name: '范围分析' },
  { id: 'collect', name: '评论采集' },
  { id: 'clean', name: '清洗与去重' },
  { id: 'semantic', name: '语义分析' },
  { id: 'findings', name: '问题发现' },
  { id: 'evidence', name: '证据验证' },
  { id: 'versions', name: '版本规划' },
  { id: 'prd', name: 'PRD 生成' },
  { id: 'tests', name: '测试用例生成' },
  { id: 'trace', name: '可追溯性验证' },
];

const TABS = [
  ['overview', '总览'],
  ['scope', '分析范围'],
  ['raw', '原始评论'],
  ['cleaning', '数据清洗'],
  ['topics', '主题分类'],
  ['findings', '问题发现'],
  ['evidence', '证据验证'],
  ['versions', '版本规划'],
  ['prd', 'PRD'],
  ['tests', '测试用例'],
  ['trace', '可追溯性'],
  ['model', '模型与提示词'],
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
  const levelLabel = { info: '信息', warning: '警告', error: '错误' }[level] ?? level;
  line.innerHTML = `<span class="t">${time}</span><span class="lvl">${esc(levelLabel)}</span><span class="msg">${esc(message)}</span>`;
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
  $('#file-label').textContent = type === 'csv' ? 'CSV 文件' : type === 'json' ? 'JSON 文件' : '评论数据文件';
  $('#storefront-badge').classList.toggle('hidden', type !== 'url');
}

function readFileInput(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取文件。'));
    reader.readAsText(file);
  });
}

function ensureResultShell() {
  if (!state.result) state.result = { artifacts: {} };
  if (!state.result.artifacts) state.result.artifacts = {};
  return state.result;
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
  $('#content').innerHTML = '<div class="empty-state"><i data-lucide="loader-circle"></i><p>流水线运行中...</p></div>';
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
      setBanner('error', '缺少 App Store 链接', '请输入有效的 apps.apple.com 链接。');
      button.disabled = false;
      return;
    }
    source = { type: 'url', url };
  } else if (state.source === 'demo') {
    source = { type: 'demo' };
  } else {
    const file = $('#file').files[0];
    if (!file) {
      setBanner('error', '缺少评论数据文件', `请先选择 ${state.source.toUpperCase()} 文件。`);
      button.disabled = false;
      return;
    }
    source = { type: state.source, text: await readFileInput(file), fileName: file.name };
  }

  log('info', '开始分析');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, goal, constraints }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法启动分析。');
    state.jobId = data.job_id;
    log('info', `任务 ${data.job_id} 已创建`);
    connectJob(data.job_id);
  } catch (error) {
    setBanner('error', '无法启动分析', error.message);
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

  es.addEventListener('artifact', (event) => {
    const data = JSON.parse(event.data);
    const result = ensureResultShell();
    result.artifacts[data.key] = data.value;
    renderTabs();
    renderContent();
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
    log('error', data.message || data.error || '流水线错误');
  });

  es.addEventListener('llm', (event) => {
    const data = JSON.parse(event.data);
    const text =
      data.type === 'model_call'
        ? `模型调用 ${data.task}（第 ${data.attempt ?? '?'} 次）`
        : data.type === 'model_retry'
          ? `模型重试 ${data.task}：${data.error}`
          : data.type === 'model_success'
            ? `模型调用成功 ${data.task}`
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
    const failedStage = state.result?.stages?.find((s) => s.status === 'failed');
    if (failedStage?.id === 'collect') {
      setBanner('error', '评论采集失败', `${errors[0]?.message ?? 'App Store Feed 没有返回可用评论。'}`, [
        { action: 'retry', label: '重试', icon: 'rotate-cw' },
        { action: 'import_json', label: '导入 JSON', icon: 'file-json-2' },
        { action: 'import_csv', label: '导入 CSV', icon: 'file-spreadsheet' },
        { action: 'demo', label: '使用离线演示', icon: 'database' },
      ]);
    } else if (failedStage?.id === 'semantic' || failedStage?.id === 'prd' || failedStage?.id === 'tests') {
      setBanner('error', '语义分析不可用', `${errors[0]?.message ?? '模型调用重试后仍失败。'}`, [
        { action: 'retry', label: '重试', icon: 'rotate-cw' },
        { action: 'demo', label: '使用离线演示', icon: 'database' },
      ]);
    } else if (errors.length) {
      setBanner('error', '流水线完成但存在错误', `${errors.length} 个错误，${warnings.length} 个警告，请查看证据与可追溯性页面。`);
    } else if (warnings.length) {
      setBanner('warning', '流水线完成但有警告', `共记录 ${warnings.length} 个警告。`);
    } else {
      setBanner('success', '流水线完成', '所有阶段均已完成，可追溯性校验通过。');
    }
  });

  es.onerror = () => {
    // EventSource 会自动重连；done 事件会关闭连接。
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
  container.innerHTML = renderers[tab]?.() ?? '<div class="empty-state"><p>暂无内容。</p></div>';
  refreshIcons();
  updateExports();
}

function statGrid(items) {
  return `<div class="stat-grid">${items
    .map(([label, value]) => `<div class="stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div>`)
    .join('')}</div>`;
}

function ratingBars(stats) {
  const dist = stats?.rating_distribution ?? {};
  const values = [1, 2, 3, 4, 5].map((rating) => [rating, dist[rating] ?? 0]);
  const max = Math.max(1, ...values.map(([, count]) => count));
  const colorClass = {
    1: 'bar-red',
    2: 'bar-orange',
    3: 'bar-amber',
    4: 'bar-teal',
    5: 'bar-green',
  };
  return `<div class="bars">${values
    .map(
      ([rating, count]) => `<div class="bar-row">
        <span class="bar-label">${rating} 星</span>
        <div class="bar-track"><div class="bar-fill ${colorClass[rating]}" style="width:${Math.round((count / max) * 100)}%"></div></div>
        <span class="bar-value">${count}</span>
      </div>`,
    )
    .join('')}</div>`;
}

function renderOverview(result) {
  if (!result) return '<div class="empty-state"><p>暂无结果。</p></div>';
  const a = result.artifacts ?? {};
  const cleaning = a.cleaning ?? {};
  const scope = a.scope ?? {};
  const trace = a.traceability?.summary ?? {};
  const collection = a.collection ?? {};
  const cached = result.cached
    ? `<div class="summary-box warn"><p><strong>${esc(result.cached_label || 'CACHED SAMPLE')}</strong> - 该结果来自预先生成的离线数据，用于无网络 / 无模型环境演示。</p></div>`
    : '';
  const app = scope.app;
  const appBlock = app
    ? statGrid([
        ['应用', app.name],
        ['开发商', app.seller],
        ['当前版本', app.version],
        ['总评分人数', app.user_rating_count ?? '—'],
        ['平均评分', app.average_user_rating ?? '—'],
        ['分类', (app.genres ?? []).slice(0, 3).join(', ')],
      ])
    : '';
  const stats = statGrid([
    ['原始评论', cleaning.raw_count ?? a.raw_reviews?.length ?? 0],
    ['有效评论', cleaning.valid_count ?? 0],
    ['去重数量', cleaning.duplicate_count ?? 0],
    ['无效行', cleaning.invalid_count ?? 0],
    ['平均评分', cleaning.stats?.average_rating ?? '—'],
    ['动态主题', a.topics?.topics?.length ?? 0],
    ['问题发现', a.findings?.findings?.length ?? 0],
    ['产品需求', a.requirements?.length ?? 0],
    ['测试用例', a.test_cases?.length ?? 0],
    ['追溯问题', trace.issues_total ?? '—'],
  ]);
  const limitations = [];
  if (collection.source) limitations.push(`数据来源：${collection.source}`);
  if (collection.storefront) limitations.push(`商店区域：${collection.storefront.toUpperCase()}`);
  if (collection.fetched_at) limitations.push(`抓取时间：${collection.fetched_at}`);
  if (collection.warnings?.length) limitations.push(`采集警告：${collection.warnings.join('；')}`);
  if (cleaning.raw_count) limitations.push(`样本规模：Apple Feed 只暴露最近一小部分评论，本次共 ${cleaning.raw_count} 条。`);
  const limitationHtml = limitations.length
    ? `<div class="section-title">数据来源与局限</div><div class="summary-box warn"><ul class="block-list">${limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`
    : '';
  return `${cached}
    ${appBlock}
    ${stats}
    <div class="summary-box"><p><strong>分析范围：</strong>${esc(scope.summary || '暂无范围摘要。')}</p></div>
    ${limitationHtml}
    ${cleaning.stats ? `<div class="section-title">评分分布</div>${ratingBars(cleaning.stats)}` : ''}
    ${result.goal ? `<div class="section-title">分析目标</div><div class="desc">${esc(result.goal)}</div>` : ''}
    ${trace.reviews_total ? `<div class="section-title">可追溯性</div><div class="desc">${trace.reviews_covered_by_findings}/${trace.reviews_total} 条评论被问题发现覆盖；${trace.findings_with_requirements}/${trace.findings_total} 个发现生成了需求；${trace.requirements_with_tests}/${trace.requirements_total} 条需求有测试用例。</div>` : ''}`;
}

function renderScope(result) {
  const a = result?.artifacts ?? {};
  const scope = a.scope ?? {};
  const analysis = a.scope_analysis ?? {};
  const filters = scope.filters ?? {};
  const pre = a.scope_pre;
  const methodPill = analysis.method === 'llm_refined' ? '<span class="pill accent">模型精化</span>' : '<span class="pill low">确定性规则</span>';
  const filterRows = [
    ['最低评分', filters.min_rating],
    ['最高评分', filters.max_rating],
    ['版本', (filters.versions ?? []).join(', ') || '全部'],
    ['语言', (filters.languages ?? []).join(', ') || '全部'],
    ['最大评论数', filters.max_reviews ?? '全部'],
  ];
  const focus = (scope.focus_areas ?? []).map((f) => `<span class="pill accent">${esc(f)}</span>`).join(' ');
  return `<div class="section-title">分析范围 ${methodPill}</div>
    <div class="summary-box"><p>${esc(scope.summary || '暂无范围摘要。')}</p></div>
    <div class="section-title">重点领域</div><div class="meta">${focus || '<span class="pill low">未解析</span>'}</div>
    <div class="section-title">生效过滤器</div>
    <div class="table-wrap"><table><tbody>${filterRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    ${pre?.country_note ? `<div class="section-title">商店区域说明</div><div class="desc">${esc(pre.country_note)}</div>` : ''}
    <div class="section-title">优先级依据</div><div class="desc">${esc(scope.priority_rationale || '—')}</div>
    <div class="section-title">数据充分性</div><div class="desc">${esc(scope.data_sufficiency_notes || '—')}</div>
    <div class="section-title">确定性目标解析</div>
    <div class="block-list"><li>${esc(analysis.deterministic?.note || '已应用目标解析。')}</li><li>已生效规则：${esc((analysis.deterministic?.applied ?? []).join(', ') || '无')}</li></div>`;
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
  return `<div class="table-wrap"><table><thead><tr><th>评论 ID</th><th>作者</th><th>评分</th><th>版本</th><th>日期</th><th>内容</th><th>语言</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="7">暂无评论。</td></tr>'}</tbody></table></div>`;
}

function renderRawReviews(result) {
  const reviews = result?.artifacts?.raw_reviews ?? [];
  if (!reviews.length) return '<div class="empty-state"><p>暂无原始评论。</p></div>';
  return `${statGrid([['原始评论', reviews.length]])}${reviewsTable(reviews, 200)}`;
}

function renderCleaning(result) {
  const cleaning = result?.artifacts?.cleaning;
  if (!cleaning) return '<div class="empty-state"><p>暂无清洗结果。</p></div>';
  const stats = cleaning.stats ?? {};
  return `${statGrid([
    ['原始评论', cleaning.raw_count],
    ['有效评论', cleaning.valid_count],
    ['去重数量', cleaning.duplicate_count],
    ['无效行', cleaning.invalid_count],
    ['平均评分', stats.average_rating ?? '—'],
    ['语言种类', Object.keys(stats.languages ?? {}).length],
  ])}
  <div class="section-title">评分分布</div>${ratingBars(stats)}
  <div class="section-title">语言分布</div>
  <div class="bars">${Object.entries(stats.languages ?? {}).slice(0, 8).map(([lang, count]) => `<div class="bar-row"><span class="bar-label mono">${esc(lang)}</span><div class="bar-track"><div class="bar-fill bar-teal" style="width:${Math.round((count / Math.max(1, stats.total)) * 100)}%"></div></div><span class="bar-value">${count}</span></div>`).join('') || '<p class="desc">暂无数据。</p>'}</div>
  ${cleaning.duplicates?.length ? `<div class="section-title">已去重评论（${cleaning.duplicates.length}）</div><div class="table-wrap"><table><thead><tr><th>评论 ID</th><th>原因</th></tr></thead><tbody>${cleaning.duplicates.slice(0, 30).map((d) => `<tr><td class="mono">${esc(d.external_id)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${cleaning.invalid?.length ? `<div class="section-title">无效行（${cleaning.invalid.length}）</div><div class="table-wrap"><table><thead><tr><th>评论 ID</th><th>原因</th></tr></thead><tbody>${cleaning.invalid.slice(0, 30).map((d) => `<tr><td class="mono">${esc(d.external_id)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function renderTopics(result) {
  const a = result?.artifacts ?? {};
  const topics = a.topics?.topics ?? [];
  const classification = a.classification ?? {};
  const topicCards = topics
    .map((topic) => {
      const stat = (classification.topic_stats ?? []).find((s) => s.topic_id === topic.id);
      const biasLabel = { negative: '负面', neutral: '中性', positive: '正面' }[topic.rating_bias] ?? '混合';
      const biasClass = topic.rating_bias === 'negative' ? 'high' : topic.rating_bias === 'positive' ? 'ok' : 'low';
      return `<div class="item-card"><h4>${esc(topic.id)} · ${esc(topic.name)}</h4>
        <div class="meta"><span class="pill ${biasClass}">${esc(biasLabel)}</span><span class="pill accent">${stat?.member_count ?? 0} 条评论</span></div>
        <p class="desc">${esc(topic.description || '')}</p>
        ${stat?.average_rating !== undefined ? `<div class="bars"><div class="bar-row"><span class="bar-label">平均评分</span><div class="bar-track"><div class="bar-fill bar-amber" style="width:${Math.round((stat.average_rating / 5) * 100)}%"></div></div><span class="bar-value">${stat.average_rating}</span></div></div>` : ''}
        <div class="section-title">示例评论</div><ul class="block-list">${(topic.example_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('') || '<li>无</li>'}</ul>
      </div>`;
    })
    .join('');
  const method = a.topics?.degraded ? '<span class="pill warn">规则降级</span>' : '<span class="pill accent">模型驱动</span>';
  const tableRows = (classification.classified ?? []).slice(0, 80).map(
    (r) => `<tr><td class="mono">${esc(r.review_id)}</td><td><span class="stars">${stars(r.rating)}</span></td><td>${esc((r.topics ?? []).join(', ') || '—')}</td><td><span class="pill ${r.sentiment === 'negative' ? 'high' : r.sentiment === 'positive' ? 'ok' : 'low'}">${esc({ negative: '负面', neutral: '中性', positive: '正面' }[r.sentiment] ?? r.sentiment)}</span></td><td>${esc(truncate(r.title || r.content, 100))}</td></tr>`,
  ).join('');
  return `<div class="section-title">动态主题 ${method}</div>
    <div class="grid-cards">${topicCards || '<div class="item-card"><p class="desc">未发现主题。</p></div>'}</div>
    <div class="section-title">分类结果样本</div>
    <div class="table-wrap"><table><thead><tr><th>评论 ID</th><th>评分</th><th>主题</th><th>情感</th><th>内容</th></tr></thead><tbody>${tableRows || '<tr><td colspan="5">暂无分类结果。</td></tr>'}</tbody></table></div>
    ${a.topics?.error ? `<div class="summary-box warn"><p>模型说明：${esc(a.topics.error)}</p></div>` : ''}`;
}

function findingCard(finding) {
  const det = finding.deterministic_evidence ?? {};
  const statusPill = finding.evidence_status === 'supported' ? '<span class="pill ok">证据充分</span>' : '<span class="pill warn">假设</span>';
  const rejected = finding.status === 'rejected' ? '<span class="pill high">已拒绝</span>' : '';
  const confidenceLabel = { high: '高', medium: '中', low: '低' }[finding.confidence] ?? finding.confidence;
  const conflict = (finding.conflicting_review_ids ?? []).length
    ? `<div class="section-title">冲突证据</div><ul class="block-list">${finding.conflicting_review_ids.map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>`
    : '<p class="desc">未识别到冲突评论。</p>';
  return `<div class="item-card">
    <h4>${esc(finding.finding_id)} · ${esc(finding.title)}</h4>
    <div class="meta">${statusPill}${rejected}<span class="pill ${finding.severity === 'P0' ? 'high' : finding.severity === 'P1' ? 'medium' : 'low'}">严重度 ${esc(finding.severity ?? '—')}</span><span class="pill ${finding.confidence === 'high' ? 'high' : finding.confidence === 'medium' ? 'medium' : 'low'}">置信度 ${esc(confidenceLabel)}</span><span class="pill accent">${det.support_count ?? finding.support_count} 条支持</span>${finding.topic_id ? `<span class="pill low">${esc(finding.topic_id)}</span>` : ''}</div>
    <p class="desc">${esc(finding.summary || '')}</p>
    ${finding.excerpts?.length ? `<div class="section-title">来源摘录</div><ul class="block-list">${finding.excerpts.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <div class="section-title">来源评论 ID</div><ul class="block-list">${(finding.review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
    ${conflict}
    ${det.support_count !== undefined ? `<div class="section-title">确定性统计（代码计算）</div><ul class="block-list"><li>平均评分 ${det.average_rating}，负面占比 ${det.negative_share}，冲突占比 ${det.conflict_share}，证据得分 ${det.evidence_score}</li></ul>` : ''}
    ${finding.model_conclusion !== undefined ? `<div class="section-title">结论类型</div><div class="desc">${finding.model_conclusion ? '模型语义结论：是' : '模型语义结论：否（规则/假设）'}</div>` : ''}
    ${finding.assumptions?.length ? `<div class="section-title">假设 / 局限</div><ul class="block-list">${finding.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderFindings(result) {
  const findings = result?.artifacts?.findings?.findings ?? [];
  if (!findings.length) return '<div class="empty-state"><p>未生成问题发现。</p></div>';
  return `<div class="section-title">证据型问题发现（${findings.length}）</div><div class="grid-cards">${findings.map(findingCard).join('')}</div>`;
}

function renderEvidence(result) {
  const evidence = result?.artifacts?.evidence;
  if (!evidence) return '<div class="empty-state"><p>暂无证据验证结果。</p></div>';
  const decisionLabel = { keep: '保留', mark_assumption: '标记为假设', revise_or_reject: '修订/拒绝' };
  const decisions = (evidence.decisions ?? [])
    .map(
      (d) => `<div class="validation-row"><span class="mono">${esc(d.finding_id)}</span><span class="${d.decision === 'keep' ? 'ok' : 'bad'}">${esc(decisionLabel[d.decision] ?? d.decision)}</span><span>${esc(d.reason || '')}</span><span></span></div>`,
    )
    .join('');
  const checks = (evidence.deterministic?.checks ?? [])
    .map(
      (c) => `<div class="validation-row"><span class="mono">${esc(c.finding_id)}</span><span class="${c.review_ids_exist ? 'ok' : 'bad'}">${c.review_ids_exist ? '有效' : '无效'}</span><span>${esc(c.issues.join('；') || '正常')}</span><span class="mono">${c.support_count}/${c.min_support}</span></div>`,
    )
    .join('');
  const revisions = (result.revisions ?? []).map(
    (r) => `<div class="validation-row"><span class="mono">${esc(r.finding_id ?? '')}</span><span class="bad">${esc({ rejected: '已拒绝', revised: '已修订', assumption: '假设' }[r.action] ?? r.action)}</span><span>${esc(r.reason ?? '')}</span><span></span></div>`,
  ).join('');
  return `${statGrid([
    ['检查发现数', (evidence.decisions ?? []).length],
    ['保留', (evidence.decisions ?? []).filter((d) => d.decision === 'keep').length],
    ['标记为假设', (evidence.decisions ?? []).filter((d) => d.decision === 'mark_assumption').length],
    ['修订/拒绝', (evidence.decisions ?? []).filter((d) => d.decision === 'revise_or_reject').length],
  ])}
  <div class="section-title">证据决策</div>${decisions || '<p class="desc">暂无决策。</p>'}
  <div class="section-title">确定性校验</div>${checks || '<p class="desc">暂无校验。</p>'}
  ${revisions ? `<div class="section-title">已应用的修订</div>${revisions}` : ''}
  ${evidence.semantic_error ? `<div class="summary-box warn"><p>语义校验模型说明：${esc(evidence.semantic_error)}</p></div>` : ''}`;
}

function renderVersions(result) {
  const plan = result?.artifacts?.version_planning?.version_plan;
  const scoring = result?.artifacts?.version_planning?.scoring ?? [];
  if (!plan) return '<div class="empty-state"><p>暂无版本规划。</p></div>';
  const cards = (plan.versions ?? []).map(
    (v) => `<div class="item-card"><h4>${esc(v.id)} · ${esc(v.name)}</h4><p class="desc">${esc(v.rationale || '')}</p><div class="section-title">关联发现</div><ul class="block-list">${(v.finding_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('') || '<li>无</li>'}</ul></div>`,
  ).join('');
  const scores = scoring.map((s) => `<div class="validation-row"><span class="mono">${esc(s.finding_id)}</span><span class="mono">${s.score}</span></div>`).join('');
  return `<div class="section-title">版本规划</div><div class="grid-cards">${cards}</div>
    ${scores ? `<div class="section-title">证据得分</div>${scores}` : ''}
    ${plan.scoring_notes ? `<div class="section-title">评分规则</div><div class="desc">${esc(JSON.stringify(plan.scoring_notes))}</div>` : ''}`;
}

function requirementCard(req) {
  return `<div class="item-card">
    <h4>${esc(req.requirement_id)} · ${esc(req.title)}</h4>
    <div class="meta"><span class="pill ${req.priority === 'P0' ? 'high' : req.priority === 'P1' ? 'medium' : 'low'}">${esc(req.priority)}</span><span class="pill accent">${esc(req.target_version_id ?? '')}</span><span class="pill low">${esc(req.finding_id)}</span><span class="pill low">证据 ${esc(req.evidence_strength ?? '')}</span></div>
    <p class="desc"><strong>问题：</strong>${esc(req.problem || '')}</p>
    <p class="desc"><strong>用户需求：</strong>${esc(req.user_need || '')}</p>
    <div class="section-title">需求描述</div><div class="desc">${esc(req.description || '')}</div>
    <div class="section-title">验收标准</div><ul class="block-list">${(req.acceptance_criteria ?? []).map((c) => `<li>${esc(c)}</li>`).join('') || '<li>无</li>'}</ul>
    <div class="section-title">来源评论</div><ul class="block-list">${(req.source_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
    ${req.assumptions?.length ? `<div class="section-title">假设</div><ul class="block-list">${req.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderPrd(result) {
  const requirements = result?.artifacts?.requirements ?? [];
  if (!requirements.length) return '<div class="empty-state"><p>未生成 PRD 需求。</p></div>';
  return `<div class="section-title">PRD 需求（${requirements.length}）</div><div class="grid-cards">${requirements.map(requirementCard).join('')}</div>`;
}

function testCard(test) {
  return `<div class="item-card">
    <h4>${esc(test.test_case_id)} · ${esc(test.title)}</h4>
    <div class="meta"><span class="pill ${test.priority === 'P0' ? 'high' : test.priority === 'P1' ? 'medium' : 'low'}">${esc(test.priority)}</span><span class="pill low">${esc(test.requirement_id)}</span><span class="pill low">${esc(test.finding_id)}</span></div>
    <div class="section-title">前置条件</div><ul class="block-list">${(test.preconditions ?? []).map((p) => `<li>${esc(p)}</li>`).join('') || '<li>无</li>'}</ul>
    <div class="section-title">操作步骤</div><ol class="block-list">${(test.steps ?? []).map((s, i) => `<li>${i + 1}. ${esc(s)}</li>`).join('') || '<li>无</li>'}</ol>
    <div class="section-title">预期结果</div><ul class="block-list">${(test.expected_results ?? []).map((e) => `<li>${esc(e)}</li>`).join('') || '<li>无</li>'}</ul>
    <div class="section-title">来源评论</div><ul class="block-list">${(test.source_review_ids ?? []).map((id) => `<li class="mono">${esc(id)}</li>`).join('')}</ul>
  </div>`;
}

function renderTests(result) {
  const tests = result?.artifacts?.test_cases ?? [];
  if (!tests.length) return '<div class="empty-state"><p>未生成测试用例。</p></div>';
  return `<div class="section-title">测试用例（${tests.length}）</div><div class="grid-cards">${tests.map(testCard).join('')}</div>`;
}

function renderTrace(result) {
  const trace = result?.artifacts?.traceability;
  if (!trace) return '<div class="empty-state"><p>暂无可追溯性结果。</p></div>';
  const s = trace.summary ?? {};
  const nodes = [
    ['评论', s.reviews_total],
    ['发现', s.findings_total],
    ['需求', s.requirements_total],
    ['测试用例', s.tests_total],
  ]
    .map(([label, value]) => `<div class="trace-node"><strong>${value ?? 0}</strong><span>${label}</span></div>`)
    .join('');
  const coverageRows = [
    ['评论被发现覆盖', s.reviews_covered_by_findings, s.reviews_total],
    ['发现生成需求', s.findings_with_requirements, s.findings_total],
    ['需求生成测试', s.requirements_with_tests, s.requirements_total],
  ].map(
    ([label, value, total]) => `<div class="bar-row"><span class="bar-label">${esc(label)}</span><div class="bar-track"><div class="bar-fill bar-teal" style="width:${Math.round(((value ?? 0) / Math.max(1, total ?? 1)) * 100)}%"></div></div><span class="bar-value">${value ?? 0}/${total ?? 0}</span></div>`,
  ).join('');
  const issues = (trace.issues ?? [])
    .map((i) => `<div class="validation-row"><span class="mono">${esc(i.id)}</span><span class="bad">断裂</span><span>${esc(i.message)}</span><span></span></div>`)
    .join('');
  const validations = (trace.validations ?? [])
    .map(
      (v) => `<div class="validation-row"><span>${esc(v.from)}</span><span class="mono">${esc(v.id)}</span><span>${esc(v.detail)}</span><span class="${v.valid ? 'ok' : 'bad'}">${v.valid ? '有效' : '无效'}</span></div>`,
    )
    .join('');
  return `${statGrid([
    ['评论被发现覆盖', s.reviews_covered_by_findings],
    ['发现生成需求', s.findings_with_requirements],
    ['需求生成测试', s.requirements_with_tests],
    ['问题数', s.issues_total],
  ])}
  <div class="section-title">追溯链</div><div class="trace-graph">${nodes}</div>
  <div class="section-title">覆盖情况</div><div class="bars">${coverageRows || '<p class="desc">暂无数据。</p>'}</div>
  <div class="section-title">问题</div>${issues || '<p class="desc">无问题。</p>'}
  <div class="section-title">校验明细</div>${validations || '<p class="desc">无校验记录。</p>'}`;
}

function renderModel(result) {
  const model = result?.model ?? state.config ?? {};
  const rows = [
    ['服务商', model.provider ?? state.config?.llmProvider ?? '—'],
    ['模型', model.model ?? (state.config?.llmProvider === 'openai' ? state.config?.openaiModel : state.config?.ollamaModel) ?? '—'],
    ['温度', model.temperature ?? '—'],
    ['结构化输出', model.structured_output ?? 'JSON'],
    ['重试策略', model.retry_strategy ?? '—'],
    ['失败策略', model.failure_strategy ?? '—'],
  ];
  const info = `<div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
  const mitigations = (model.hallucination_mitigations ?? []).map((m) => `<li>${esc(m)}</li>`).join('');
  const html = `${info}
    ${mitigations ? `<div class="section-title">幻觉防护措施</div><ul class="block-list">${mitigations}</ul>` : ''}
    <div class="section-title">提示词定义</div><div id="prompt-list"><p class="desc">加载中...</p></div>`;
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
      .join('') || '<p class="desc">提示词不可用。</p>';
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
  lines.push('# 评论分析报告', '', `- 分析目标：${result.goal ?? ''}`, `- 缓存：${result.cached ? result.cached_label : '否'}`, `- 模型：${result.model?.provider} / ${result.model?.model}`, '');
  lines.push('## 分析范围', '', `- ${a.scope?.summary ?? ''}`, `- 重点领域：${(a.scope?.focus_areas ?? []).join(', ')}`, '');
  lines.push('## 数据清洗', '', `- 原始：${a.cleaning?.raw_count ?? 0}`, `- 有效：${a.cleaning?.valid_count ?? 0}`, `- 去重：${a.cleaning?.duplicate_count ?? 0}`, '');
  lines.push('## 问题发现');
  for (const f of a.findings?.findings ?? []) {
    lines.push('', `### ${f.finding_id} ${f.title}`, '', `- 置信度：${f.confidence}`, `- 支持评论：${f.review_ids?.length ?? 0}`, `- 证据状态：${f.evidence_status}`, `- 来源 ID：${(f.review_ids ?? []).join(', ')}`, '', `> ${f.summary ?? ''}`, '');
  }
  lines.push('## 版本规划');
  for (const v of a.version_planning?.version_plan?.versions ?? []) {
    lines.push('', `### ${v.id} ${v.name}`, `- 发现：${(v.finding_ids ?? []).join(', ')}`, `- ${v.rationale ?? ''}`, '');
  }
  lines.push('## 产品需求');
  for (const r of a.requirements ?? []) {
    lines.push('', `### ${r.requirement_id} ${r.title}`, '', `- 优先级：${r.priority}`, `- 目标版本：${r.target_version_id}`, `- 发现：${r.finding_id}`, `- 来源评论：${(r.source_review_ids ?? []).join(', ')}`, '', `> ${r.description ?? ''}`, '');
  }
  lines.push('## 测试用例');
  for (const t of a.test_cases ?? []) {
    lines.push('', `### ${t.test_case_id} ${t.title}`, '', `- 需求：${t.requirement_id}`, `- 发现：${t.finding_id}`, `- 来源评论：${(t.source_review_ids ?? []).join(', ')}`, `- 前置条件：${(t.preconditions ?? []).join('；')}`, `- 步骤：${(t.steps ?? []).join('；')}`, `- 预期：${(t.expected_results ?? []).join('；')}`, '');
  }
  lines.push('## 可追溯性', '', `- 评论覆盖：${a.traceability?.summary?.reviews_covered_by_findings ?? 0}/${a.traceability?.summary?.reviews_total ?? 0}`, `- 问题数：${a.traceability?.summary?.issues_total ?? 0}`, '');
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
    } else if (action === 'import_json') {
      setSource('json');
    } else if (action === 'import_csv') {
      setSource('csv');
    }
  });

  try {
    const response = await fetch('/api/config');
    state.config = await response.json();
    const cfg = state.config;
    const modelName = cfg.llmProvider === 'openai' ? cfg.openaiModel : cfg.ollamaModel;
    $('#model-status').innerHTML = '<i data-lucide="cpu"></i><span>' + esc(`${cfg.llmProvider} · ${modelName}`) + '</span>';
    $('#model-detail').innerHTML = `
      <div><dt>服务商</dt><dd>${esc(cfg.llmProvider)}</dd></div>
      <div><dt>模型</dt><dd>${esc(modelName)}</dd></div>
      <div><dt>结构化输出</dt><dd>JSON</dd></div>
      <div><dt>最大评论数</dt><dd>${esc(cfg.maxReviews)}</dd></div>
      <div><dt>最小证据数</dt><dd>${esc(cfg.minFindingSupport)}</dd></div>`;
    $('#model-status').classList.add('ok');
  } catch {
    $('#model-status').innerHTML = '<i data-lucide="circle-alert"></i><span>配置不可用</span>';
  }
  renderStageList();
  renderTabs();
  refreshIcons();
  setSource('url');
}

init();
