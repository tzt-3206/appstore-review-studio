import fs from 'node:fs';
import path from 'node:path';
import { createLLMEngine } from './llm/index.js';
import { parseAppStoreUrl, lookupAppMetadata, collectAppStoreReviews } from './collectors/appstore.js';
import { cleanReviews } from './data/clean.js';
import { parseImportByType } from './data/importers.js';
import { runScopeAnalysis } from './analysis/scope.js';
import { runTopicDiscovery } from './analysis/topics.js';
import { runClassification } from './analysis/classification.js';
import { runFindingGeneration } from './analysis/findings.js';
import { runEvidenceValidation } from './analysis/evidence.js';
import { runVersionPlanning } from './analysis/versions.js';
import { runPrdGeneration } from './analysis/prd.js';
import { runTestGeneration } from './analysis/tests.js';
import { validateTraceability } from './analysis/traceability.js';

const STAGES = [
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

function modelInfo(llm, config) {
  return {
    provider: llm.provider?.name ?? config.llm.provider,
    model: llm.provider?.model ?? 'unavailable',
    temperature: config.llm.temperature,
    structured_output: '由提示词 Schema 和应用侧校验共同约束的 JSON',
    prompt_files: [
      'prompts/scope_refinement.md',
      'prompts/topic_discovery.md',
      'prompts/classification.md',
      'prompts/finding_generation.md',
      'prompts/evidence_validation.md',
      'prompts/version_planning.md',
      'prompts/prd_generation.md',
      'prompts/test_generation.md',
    ],
    retry_strategy: `${config.llmMaxRetries} 次重试，指数退避（2s、4s、...）`,
    failure_strategy:
      '确定性统计始终保留；语义阶段会回退到明确标注的规则结果，或标记为不可用。',
    hallucination_mitigations: [
      '模型只能引用数据集中真实存在的评论 ID',
      '每条发现 / 需求 / 测试用例引用都会与真实评论 ID 校验',
      'support_count 由确定性代码重新计算',
      '证据不足的发现会被标记为假设',
      '语义上不被支持的发现会被拒绝或修订',
      '模型结论与确定性统计分开存储',
    ],
  };
}

function loadCachedDemo(rootDir) {
  const file = path.join(rootDir, 'data', 'sample', 'cached_result.json');
  if (!fs.existsSync(file)) throw new Error('Cached demo result not found.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export async function runPipeline(input, { config, rootDir, onEvent }) {
  const startedAt = new Date();
  const stages = STAGES.map((stage) => ({ ...stage, status: 'pending' }));
  const artifacts = {};
  const logs = [];
  const warnings = [];
  const errors = [];
  const revisions = [];
  const llm = createLLMEngine(config, rootDir, (event) => {
    onEvent?.({ type: 'llm', ...event });
  });
  const emit = (type, message, extra = {}) => {
    const event = { type, message, time: new Date().toISOString(), ...extra };
    logs.push(event);
    onEvent?.(event);
  };
  const emitArtifact = (key, value) => {
    artifacts[key] = value;
    onEvent?.({ type: 'artifact', key, value, time: new Date().toISOString() });
  };

  if (input.source?.type === 'demo') {
    const cached = loadCachedDemo(rootDir);
    const demoResult = {
      ...cached,
      job_id: input.job_id,
      demo: true,
      cached: true,
      cached_label: 'CACHED SAMPLE',
      input,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
    };
    emit('info', '已加载离线演示结果，未进行实时采集或模型调用。');
    onEvent?.({ type: 'result', result: demoResult });
    return demoResult;
  }

  let activeStageId = null;
  const startStage = (id) => {
    const stage = stages.find((s) => s.id === id);
    activeStageId = id;
    stage.status = 'running';
    stage.started_at = new Date().toISOString();
    onEvent?.({ type: 'stage_start', stage_id: id, name: stage.name, stages: stages.map((s) => ({ id: s.id, name: s.name, status: s.status })) });
  };
  const finishStage = (id, status = 'done', message = '') => {
    const stage = stages.find((s) => s.id === id);
    stage.status = status;
    stage.ended_at = new Date().toISOString();
    stage.duration_ms = new Date(stage.ended_at) - new Date(stage.started_at);
    stage.message = message;
    onEvent?.({ type: 'stage_end', stage_id: id, status, message, stages: stages.map((s) => ({ id: s.id, name: s.name, status: s.status })) });
  };

  const result = {
    job_id: input.job_id,
    cached: false,
    demo: false,
    input,
    model: modelInfo(llm, config),
    started_at: startedAt.toISOString(),
    stages,
    artifacts,
    logs,
    warnings,
    errors,
    revisions,
  };

  let rawReviews = [];
  let metadata = null;
  let urlInfo = null;

  try {
    startStage('scope');
    if (input.source?.type === 'url') {
      urlInfo = parseAppStoreUrl(input.source.url);
      if (!urlInfo.ok) throw new Error(urlInfo.error);
      try {
        metadata = await lookupAppMetadata(urlInfo.appId, 'us');
        emitArtifact('scope_pre', {
          url_info: urlInfo,
          metadata,
          country_note:
            urlInfo.country === 'us'
              ? '已确认美国区页面；评论按题目要求从美国区商店采集。'
              : `页面来自 ${urlInfo.country.toUpperCase()} 区；评论仍从美国区商店采集。`,
        });
        emit('info', `已解析应用“${metadata.name}”（ID ${urlInfo.appId}），将使用美国区评论分析。`);
      } catch (usError) {
        if (urlInfo.country === 'us') throw usError;
        try {
          metadata = await lookupAppMetadata(urlInfo.appId, urlInfo.country);
          warnings.push(`应用在美国区商店不存在（${usError.message}），已使用 ${urlInfo.country.toUpperCase()} 区页面元数据。美国区评论可能为空。`);
          emitArtifact('scope_pre', {
            url_info: urlInfo,
            metadata,
            us_lookup_failed: true,
            country_note: `该应用在美国区商店中不存在，元数据取自 ${urlInfo.country.toUpperCase()} 区页面；评论仍按题目要求尝试从美国区商店采集，若没有美国区评论会明确提示。`,
          });
          emit('info', `应用在美国区商店不存在，已使用 ${urlInfo.country.toUpperCase()} 区元数据；将尝试采集美国区评论。`);
        } catch (fallbackError) {
          throw new Error(`App Store lookup failed in both U.S. and ${urlInfo.country.toUpperCase()} stores.`);
        }
      }
    } else {
      emitArtifact('scope_pre', {
        url_info: null,
        metadata: null,
        country_note: '导入模式不涉及商店区域，评论来自上传的数据集。',
      });
    }
    finishStage('scope');
  } catch (error) {
    errors.push({ stage: 'scope', message: error.message });
    finishStage('scope', 'failed', error.message);
    emit('error', `Scope analysis failed: ${error.message}`);
    return finalize(result);
  }

  try {
    startStage('collect');
    if (input.source?.type === 'url') {
      const collection = await collectAppStoreReviews(urlInfo.appId, {
        maxReviews: input.options?.max_reviews ?? config.maxReviews,
        requestDelayMs: config.requestDelayMs,
        softBlockRetries: config.collectionSoftBlockRetries,
        softBlockDelayMs: config.collectionSoftBlockDelayMs,
        onProgress: (event) => {
          const sortLabel = event.sort === 'mostRecent' ? '最新评论' : '最有帮助';
          const message =
            event.type === 'page'
              ? `已获取 ${sortLabel} 第 ${event.page} 页，共 ${event.count} 条`
              : event.type === 'warning'
                ? `警告：${sortLabel} 第 ${event.page} 页无数据或重复`
                : `${sortLabel} 第 ${event.page} 页重试 ${event.attempt ?? ''} 次`;
          emit('collect', message, { progress: event });
        },
      });
      rawReviews = collection.rawReviews;
      metadata = metadata ?? null;
      emitArtifact('collection', collection);
      emitArtifact('raw_reviews', rawReviews);
      emit('info', `已从美国区 App Store RSS Feed 采集 ${rawReviews.length} 条唯一评论。`);
      if (collection.warnings.length) warnings.push(...collection.warnings.map((w) => `采集：${w}`));
    } else if (input.source?.type === 'json' || input.source?.type === 'csv') {
      rawReviews = parseImportByType(input.source.type, input.source.text ?? '');
      emitArtifact('collection', {
        source: `uploaded ${input.source.type.toUpperCase()}`,
        file_name: input.source.fileName ?? '',
        raw_count: rawReviews.length,
      });
      emitArtifact('raw_reviews', rawReviews);
      emit('info', `已解析上传的 ${input.source.type.toUpperCase()} 文件，共 ${rawReviews.length} 条评论。`);
    } else {
      throw new Error(`Unsupported data source: ${input.source?.type}`);
    }
    finishStage('collect');
  } catch (error) {
    const usUnavailable = artifacts.scope_pre?.us_lookup_failed;
    const noReviews = /returned no reviews/i.test(error.message);
    const friendlyMessage = usUnavailable
      ? '该应用在美国区 App Store 中没有可用评论，无法按题目要求提供美国区评论数据。'
      : noReviews
        ? '美国区评论 Feed 暂时返回空数据（可能是 Apple 临时限流），请等待几分钟后重试，或导入 JSON/CSV、使用离线演示。'
        : error.message;
    errors.push({ stage: 'collect', message: friendlyMessage });
    warnings.push(`采集失败：${friendlyMessage}`);
    finishStage('collect', 'failed', friendlyMessage);
    emit('error', `评论采集失败：${friendlyMessage}`);
    return finalize(result);
  }

  try {
    startStage('clean');
    const cleaning = cleanReviews(rawReviews, { source: input.source?.type === 'url' ? 'itunes_rss_us' : input.source?.type ?? 'import' });
    emitArtifact('cleaning', cleaning);
    emit('info', `清洗完成：原始 ${cleaning.raw_count} 条，有效 ${cleaning.valid_count} 条，去重 ${cleaning.duplicate_count} 条，无效 ${cleaning.invalid_count} 条。`);
    finishStage('clean');
  } catch (error) {
    errors.push({ stage: 'clean', message: error.message });
    finishStage('clean', 'failed', error.message);
    return finalize(result);
  }

  const cleaned = artifacts.cleaning.cleaned;

  try {
    startStage('scope');
    const scopeResult = await runScopeAnalysis({
      url: input.source?.type === 'url' ? input.source.url : null,
      goal: input.goal ?? '',
      constraints: input.constraints ?? {},
      metadata,
      cleaned,
      llm,
      onEvent: (event) => emit('scope', event.message ?? '', event),
    });
    if (!scopeResult.ok) throw new Error(scopeResult.error);
    emitArtifact('scope', scopeResult.scope);
    emitArtifact('scope_analysis', scopeResult);
    emit('info', `范围就绪：${scopeResult.method === 'llm_refined' ? '模型精化' : '确定性规则'}，过滤后剩余 ${scopeResult.scoped.reviews.length} 条评论。`);
    finishStage('scope');
  } catch (error) {
    errors.push({ stage: 'scope', message: error.message });
    warnings.push(`范围精化失败，继续使用未过滤评论：${error.message}`);
    const fallback = applyScopeFilters(cleaned, { min_rating: 1, max_rating: 5, versions: [], languages: [], max_reviews: config.maxReviews });
    emitArtifact('scope', {
      summary: '模型范围精化失败，使用确定性规则兜底。',
      focus_areas: [],
      filters: fallback.filters,
      priority_rationale: '范围精化失败，未生成优先级依据。',
      data_sufficiency_notes: '请查看证据验证结果。',
      source_country: 'us',
      app: metadata,
    });
    emitArtifact('scope_analysis', { ok: true, method: 'fallback', scoped: fallback });
    finishStage('scope', 'done', '已使用确定性范围兜底。');
  }

  const scoped = artifacts.scope_analysis.scoped;
  emitArtifact('scoped_reviews', scoped.reviews);

  try {
    startStage('semantic');
    const topicResult = await runTopicDiscovery({
      scoped,
      llm,
      onEvent: (event) => emit('semantic', event.message ?? '', event),
      modelMaxReviews: config.modelMaxReviews,
    });
    if (topicResult.degraded) {
      warnings.push(`主题发现降级：${topicResult.error ?? '使用兜底主题。'}`);
    }
    const classificationResult = await runClassification({
      scoped,
      topics: topicResult.topics,
      llm,
      onEvent: (event) => emit('semantic', event.message ?? '', event),
      batchSize: config.classifyBatchSize,
    });
    if (classificationResult.degraded) {
      warnings.push(`分类降级：${classificationResult.errors.join('；')}`);
    }
    emitArtifact('topics', { ...topicResult });
    emitArtifact('classification', { ...classificationResult });
    emit('info', `语义分析完成：${topicResult.topics.length} 个主题，${classificationResult.classified.length} 条评论完成分类。`);
    finishStage('semantic');
  } catch (error) {
    errors.push({ stage: 'semantic', message: error.message });
    warnings.push(`语义分析失败：${error.message}`);
    finishStage('semantic', 'failed', error.message);
    return finalize(result);
  }

  try {
    startStage('findings');
    const findingResult = await runFindingGeneration({
      scoped,
      topics: artifacts.topics.topics,
      classification: artifacts.classification,
      llm,
      onEvent: (event) => emit('findings', event.message ?? '', event),
      minSupport: config.minFindingSupport,
    });
    if (findingResult.degraded) warnings.push(`问题发现降级：${findingResult.error ?? '使用兜底发现。'}`);
    emitArtifact('findings', findingResult);
    emit('info', `问题发现生成：${findingResult.findings.length} 条（方式：${findingResult.method}）。`);
    finishStage('findings');
  } catch (error) {
    errors.push({ stage: 'findings', message: error.message });
    finishStage('findings', 'failed', error.message);
    return finalize(result);
  }

  try {
    startStage('evidence');
    const evidenceResult = await runEvidenceValidation({
      findings: artifacts.findings.findings,
      classified: artifacts.classification.classified,
      llm,
      onEvent: (event) => emit('evidence', event.message ?? '', event),
      minSupport: config.minFindingSupport,
    });
    emitArtifact('evidence', evidenceResult);
    revisions.push(...evidenceResult.applied.revisions);
    artifacts.findings.findings = evidenceResult.applied.findings;
    emitArtifact('findings', artifacts.findings);
    const rejectedCount = evidenceResult.applied.revisions.length;
    const assumptionCount = evidenceResult.decisions.filter((d) => d.decision === 'mark_assumption').length;
    emit('info', `证据验证完成：${rejectedCount} 条被拒绝/修订，${assumptionCount} 条标记为假设。`);
    finishStage('evidence');
  } catch (error) {
    errors.push({ stage: 'evidence', message: error.message });
    warnings.push(`证据验证失败：${error.message}`);
    finishStage('evidence', 'failed', error.message);
    return finalize(result);
  }

  const finalFindings = artifacts.findings.findings;
  const supportedFindings = finalFindings.filter((f) => f.evidence_status === 'supported');

  try {
    startStage('versions');
    const versionResult = await runVersionPlanning({
      findings: supportedFindings,
      llm,
      onEvent: (event) => emit('versions', event.message ?? '', event),
      goal: scoped.scope?.summary ?? input.goal ?? '',
    });
    emitArtifact('version_planning', versionResult);
    emit('info', `版本规划完成：${versionResult.version_plan.versions.length} 个版本（方式：${versionResult.method}）。`);
    finishStage('versions');
  } catch (error) {
    errors.push({ stage: 'versions', message: error.message });
    warnings.push(`版本规划失败：${error.message}`);
    emitArtifact('version_planning', { method: 'failed', error: error.message, version_plan: { versions: [] } });
    finishStage('versions', 'failed', error.message);
  }

  const versionPlan = artifacts.version_planning.version_plan ?? { versions: [] };
  emitArtifact('requirements', []);
  emitArtifact('test_cases', []);

  try {
    startStage('prd');
    if (supportedFindings.length === 0 || versionPlan.versions.length === 0) {
      throw new Error('PRD 生成需要证据充分的问题发现和版本规划。');
    }
    const prdResult = await runPrdGeneration({
      findings: supportedFindings,
      versionPlan,
      scoped,
      llm,
      onEvent: (event) => emit('prd', event.message ?? '', event),
    });
    emitArtifact('prd', prdResult);
    emitArtifact('requirements', prdResult.requirements);
    if (prdResult.method === 'failed') throw new Error(prdResult.error);
    emit('info', `PRD 生成：${prdResult.requirements.length} 条需求。`);
    finishStage('prd');
  } catch (error) {
    errors.push({ stage: 'prd', message: error.message });
    warnings.push(`PRD 生成不可用：${error.message}`);
    emitArtifact('prd', { method: 'failed', error: error.message, requirements: [] });
    emitArtifact('requirements', []);
    finishStage('prd', 'failed', error.message);
  }

  try {
    startStage('tests');
    if (artifacts.requirements.length === 0) {
      throw new Error('测试用例生成需要已生成的 PRD 需求。');
    }
    const testResult = await runTestGeneration({
      requirements: artifacts.requirements,
      findings: supportedFindings,
      llm,
      onEvent: (event) => emit('tests', event.message ?? '', event),
    });
    emitArtifact('tests', testResult);
    emitArtifact('test_cases', testResult.test_cases);
    if (testResult.method === 'failed') throw new Error(testResult.error);
    emit('info', `测试用例生成：${testResult.test_cases.length} 条。`);
    finishStage('tests');
  } catch (error) {
    errors.push({ stage: 'tests', message: error.message });
    warnings.push(`测试用例生成不可用：${error.message}`);
    emitArtifact('tests', { method: 'failed', error: error.message, test_cases: [] });
    emitArtifact('test_cases', []);
    finishStage('tests', 'failed', error.message);
  }

  try {
    startStage('trace');
    const trace = validateTraceability({
      reviews: scoped.reviews,
      findings: finalFindings,
      requirements: artifacts.requirements,
      testCases: artifacts.test_cases,
    });
    emitArtifact('traceability', trace);
    for (const issue of trace.issues) {
      errors.push({ stage: 'trace', message: issue.message });
    }
    emit('info', `可追溯性验证：${trace.summary.issues_total} 个问题，${trace.valid ? '所有链接有效' : '发现无效链接'}。`);
    finishStage('trace', trace.valid ? 'done' : 'done', `${trace.summary.issues_total} issues`);
  } catch (error) {
    errors.push({ stage: 'trace', message: error.message });
    finishStage('trace', 'failed', error.message);
  }

  return finalize(result);
}

function finalize(result) {
  result.completed_at = new Date().toISOString();
  result.duration_ms = new Date(result.completed_at) - new Date(result.started_at);
  result.has_fatal_errors = result.stages.some((s) => s.status === 'failed');
  return result;
}
