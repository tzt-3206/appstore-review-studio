const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export function validateRequirements(requirements, { findingMap, versionIds }) {
  const issues = [];
  const ids = new Set();
  const valid = [];
  for (const req of requirements ?? []) {
    if (!req.requirement_id || ids.has(req.requirement_id)) {
      issues.push(`Invalid or duplicate requirement id: ${req.requirement_id}`);
      continue;
    }
    ids.add(req.requirement_id);
    const finding = findingMap.get(req.finding_id);
    if (!finding) {
      issues.push(`${req.requirement_id} references missing finding ${req.finding_id}; dropped.`);
      continue;
    }
    const allowedReviews = new Set(finding.review_ids);
    const sourceReviews = [...new Set((req.source_review_ids ?? []).filter((id) => allowedReviews.has(id)))];
    if (sourceReviews.length === 0) {
      issues.push(`${req.requirement_id} has no valid source reviews; dropped.`);
      continue;
    }
    if (!versionIds.has(req.target_version_id)) {
      issues.push(`${req.requirement_id} references unknown version ${req.target_version_id}; dropped.`);
      continue;
    }
    if (!PRIORITIES.has(req.priority)) {
      issues.push(`${req.requirement_id} has invalid priority ${req.priority}; set to P2.`);
      req.priority = 'P2';
    }
    if (!Array.isArray(req.acceptance_criteria) || req.acceptance_criteria.length === 0) {
      issues.push(`${req.requirement_id} has no acceptance criteria; set to assumption.`);
      req.acceptance_criteria = ['TBD: acceptance criteria must be defined.'];
      req.assumptions = [...(req.assumptions ?? []), 'Acceptance criteria were missing and marked as TBD.'];
    }
    req.source_review_ids = sourceReviews;
    valid.push(req);
  }
  return { requirements: valid, issues };
}

export async function runPrdGeneration({ findings, versionPlan, scoped, llm, onEvent }) {
  const findingMap = new Map(findings.map((f) => [f.finding_id, f]));
  const versionIds = new Set((versionPlan.versions ?? []).map((v) => v.id));
  let requirements = [];
  let method = 'model';
  let error = null;
  const validationIssues = [];

  if (llm && llm.available() && findings.length > 0) {
    try {
      const result = await llm.completeJSON('prd_generation', {
        goal: scoped.scope?.summary ?? '',
        app: scoped.scope?.app ?? null,
        findings: findings.map((f) => ({
          finding_id: f.finding_id,
          title: f.title,
          summary: f.summary,
          support_count: f.deterministic_evidence?.support_count,
          confidence: f.confidence,
          evidence_status: f.evidence_status,
          review_ids: f.review_ids,
        })),
        version_plan: versionPlan,
      }, 'prd');
      const validated = validateRequirements(result.requirements, { findingMap, versionIds });
      validationIssues.push(...validated.issues);
      requirements = validated.requirements;
    } catch (err) {
      method = 'failed';
      error = err.message;
      onEvent?.({ type: 'prd_generation_failed', error: err.message });
    }
  } else {
    method = 'failed';
    error = 'PRD generation requires a model and at least one supported finding.';
  }
  return { requirements, method, error, validation_issues: validationIssues };
}

