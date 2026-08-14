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
    structured_output: 'JSON enforced by prompt schema and application-side validation',
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
    retry_strategy: `${config.llmMaxRetries} attempts with exponential backoff (2s, 4s, ...)`,
    failure_strategy:
      'Deterministic statistics remain available; semantic stages fall back to clearly labeled rule-based outputs or are marked unavailable.',
    hallucination_mitigations: [
      'LLM is only allowed to reference review IDs present in the dataset',
      'Every finding/requirement/test-case reference is validated against real review IDs',
      'support_count is recomputed deterministically',
      'Findings with insufficient evidence are marked as assumptions',
      'Semantically unsupported findings are rejected or revised',
      'Model conclusions and deterministic statistics are stored separately',
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
    emit('info', 'Loaded cached demo result; no live collection or model calls were made.');
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
      metadata = await lookupAppMetadata(urlInfo.appId);
      artifacts.scope_pre = {
        url_info: urlInfo,
        metadata,
        country_note:
          urlInfo.country === 'us'
            ? 'U.S. storefront page confirmed; reviews will be collected from the U.S. storefront.'
            : `Page is from ${urlInfo.country.toUpperCase()}; reviews will still be collected from the U.S. storefront as required.`,
      };
      emit('info', `Resolved app "${metadata.name}" (id ${urlInfo.appId}) for U.S. storefront analysis.`);
    } else {
      artifacts.scope_pre = {
        url_info: null,
        metadata: null,
        country_note: 'Import mode: no storefront is involved; review data comes from the uploaded dataset.',
      };
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
        onProgress: (event) => emit('collect', event.message ?? `${event.sort} page ${event.page}`, { progress: event }),
      });
      rawReviews = collection.rawReviews;
      metadata = metadata ?? null;
      artifacts.collection = collection;
      artifacts.raw_reviews = rawReviews;
      emit('info', `Collected ${rawReviews.length} unique reviews from U.S. App Store RSS feed.`);
      if (collection.warnings.length) warnings.push(...collection.warnings.map((w) => `Collection: ${w}`));
    } else if (input.source?.type === 'json' || input.source?.type === 'csv') {
      rawReviews = parseImportByType(input.source.type, input.source.text ?? '');
      artifacts.collection = {
        source: `uploaded ${input.source.type.toUpperCase()}`,
        file_name: input.source.fileName ?? '',
        raw_count: rawReviews.length,
      };
      artifacts.raw_reviews = rawReviews;
      emit('info', `Parsed ${rawReviews.length} reviews from uploaded ${input.source.type.toUpperCase()}.`);
    } else {
      throw new Error(`Unsupported data source: ${input.source?.type}`);
    }
    finishStage('collect');
  } catch (error) {
    errors.push({ stage: 'collect', message: error.message });
    warnings.push(`Collection failed: ${error.message}`);
    finishStage('collect', 'failed', error.message);
    emit('error', `Review collection failed: ${error.message}`);
    return finalize(result);
  }

  try {
    startStage('clean');
    const cleaning = cleanReviews(rawReviews, { source: input.source?.type === 'url' ? 'itunes_rss_us' : input.source?.type ?? 'import' });
    artifacts.cleaning = cleaning;
    emit('info', `Cleaning complete: ${cleaning.raw_count} raw, ${cleaning.valid_count} valid, ${cleaning.duplicate_count} duplicates removed, ${cleaning.invalid_count} invalid.`);
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
    artifacts.scope = scopeResult.scope;
    artifacts.scope_analysis = scopeResult;
    emit('info', `Scope ready: ${scopeResult.method === 'llm_refined' ? 'model-refined' : 'deterministic'} with ${scopeResult.scoped.reviews.length} reviews after filters.`);
    finishStage('scope');
  } catch (error) {
    errors.push({ stage: 'scope', message: error.message });
    warnings.push(`Scope refinement failed; continuing with unfiltered reviews: ${error.message}`);
    const fallback = applyScopeFilters(cleaned, { min_rating: 1, max_rating: 5, versions: [], languages: [], max_reviews: config.maxReviews });
    artifacts.scope = {
      summary: 'Deterministic scope fallback after model refinement failure.',
      focus_areas: [],
      filters: fallback.filters,
      priority_rationale: 'Scope refinement failed; no priority rationale generated.',
      data_sufficiency_notes: 'See evidence validation.',
      source_country: 'us',
      app: metadata,
    };
    artifacts.scope_analysis = { ok: true, method: 'fallback', scoped: fallback };
    finishStage('scope', 'done', 'Used deterministic scope fallback.');
  }

  const scoped = artifacts.scope_analysis.scoped;
  artifacts.scoped_reviews = scoped.reviews;

  try {
    startStage('semantic');
    const topicResult = await runTopicDiscovery({
      scoped,
      llm,
      onEvent: (event) => emit('semantic', event.message ?? '', event),
      modelMaxReviews: config.modelMaxReviews,
    });
    if (topicResult.degraded) {
      warnings.push(`Topic discovery degraded: ${topicResult.error ?? 'fallback topics used.'}`);
    }
    const classificationResult = await runClassification({
      scoped,
      topics: topicResult.topics,
      llm,
      onEvent: (event) => emit('semantic', event.message ?? '', event),
      batchSize: config.classifyBatchSize,
    });
    if (classificationResult.degraded) {
      warnings.push(`Classification degraded: ${classificationResult.errors.join('; ')}`);
    }
    artifacts.topics = { ...topicResult };
    artifacts.classification = { ...classificationResult };
    emit('info', `Semantic analysis complete: ${topicResult.topics.length} topics, ${classificationResult.classified.length} reviews classified.`);
    finishStage('semantic');
  } catch (error) {
    errors.push({ stage: 'semantic', message: error.message });
    warnings.push(`Semantic analysis failed: ${error.message}`);
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
    if (findingResult.degraded) warnings.push(`Finding generation degraded: ${findingResult.error ?? 'fallback findings used.'}`);
    artifacts.findings = findingResult;
    emit('info', `Findings generated: ${findingResult.findings.length} findings (${findingResult.method}).`);
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
    artifacts.evidence = evidenceResult;
    revisions.push(...evidenceResult.applied.revisions);
    artifacts.findings.findings = evidenceResult.applied.findings;
    const rejectedCount = evidenceResult.applied.revisions.length;
    const assumptionCount = evidenceResult.decisions.filter((d) => d.decision === 'mark_assumption').length;
    emit('info', `Evidence validation complete: ${rejectedCount} rejected/revised, ${assumptionCount} marked as assumptions.`);
    finishStage('evidence');
  } catch (error) {
    errors.push({ stage: 'evidence', message: error.message });
    warnings.push(`Evidence validation failed: ${error.message}`);
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
    });
    artifacts.version_planning = versionResult;
    emit('info', `Version planning complete: ${versionResult.version_plan.versions.length} versions (${versionResult.method}).`);
    finishStage('versions');
  } catch (error) {
    errors.push({ stage: 'versions', message: error.message });
    warnings.push(`Version planning failed: ${error.message}`);
    artifacts.version_planning = { method: 'failed', error: error.message, version_plan: { versions: [] } };
    finishStage('versions', 'failed', error.message);
  }

  const versionPlan = artifacts.version_planning.version_plan ?? { versions: [] };
  artifacts.requirements = [];
  artifacts.test_cases = [];

  try {
    startStage('prd');
    if (supportedFindings.length === 0 || versionPlan.versions.length === 0) {
      throw new Error('PRD generation requires supported findings and a version plan.');
    }
    const prdResult = await runPrdGeneration({
      findings: supportedFindings,
      versionPlan,
      scoped,
      llm,
      onEvent: (event) => emit('prd', event.message ?? '', event),
    });
    artifacts.prd = prdResult;
    artifacts.requirements = prdResult.requirements;
    if (prdResult.method === 'failed') throw new Error(prdResult.error);
    emit('info', `PRD generated: ${prdResult.requirements.length} requirements.`);
    finishStage('prd');
  } catch (error) {
    errors.push({ stage: 'prd', message: error.message });
    warnings.push(`PRD generation unavailable: ${error.message}`);
    artifacts.prd = { method: 'failed', error: error.message, requirements: [] };
    finishStage('prd', 'failed', error.message);
  }

  try {
    startStage('tests');
    if (artifacts.requirements.length === 0) {
      throw new Error('Test generation requires generated requirements.');
    }
    const testResult = await runTestGeneration({
      requirements: artifacts.requirements,
      findings: supportedFindings,
      llm,
      onEvent: (event) => emit('tests', event.message ?? '', event),
    });
    artifacts.tests = testResult;
    artifacts.test_cases = testResult.test_cases;
    if (testResult.method === 'failed') throw new Error(testResult.error);
    emit('info', `Test cases generated: ${testResult.test_cases.length}.`);
    finishStage('tests');
  } catch (error) {
    errors.push({ stage: 'tests', message: error.message });
    warnings.push(`Test generation unavailable: ${error.message}`);
    artifacts.tests = { method: 'failed', error: error.message, test_cases: [] };
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
    artifacts.traceability = trace;
    for (const issue of trace.issues) {
      errors.push({ stage: 'trace', message: issue.message });
    }
    emit('info', `Traceability validated: ${trace.summary.issues_total} issues, ${trace.valid ? 'all links valid' : 'invalid links found'}.`);
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
