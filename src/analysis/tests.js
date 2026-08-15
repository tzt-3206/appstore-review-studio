export function validateTestCases(testCases, { requirementMap, findingMap, reviewIds }) {
  const issues = [];
  const ids = new Set();
  const valid = [];
  for (const test of testCases ?? []) {
    if (!test.test_case_id || ids.has(test.test_case_id)) {
      issues.push(`Invalid or duplicate test case id: ${test.test_case_id}`);
      continue;
    }
    ids.add(test.test_case_id);
    const requirement = requirementMap.get(test.requirement_id);
    const finding = findingMap.get(test.finding_id);
    if (!requirement) {
      issues.push(`${test.test_case_id} references missing requirement ${test.requirement_id}; dropped.`);
      continue;
    }
    if (!finding) {
      issues.push(`${test.test_case_id} references missing finding ${test.finding_id}; dropped.`);
      continue;
    }
    if (requirement.finding_id !== finding.finding_id) {
      issues.push(`${test.test_case_id} finding does not match requirement finding; dropped.`);
      continue;
    }
    const allowed = new Set(finding.review_ids);
    const sourceReviews = [...new Set((test.source_review_ids ?? []).filter((id) => reviewIds.has(id) && allowed.has(id)))];
    if (sourceReviews.length === 0) {
      issues.push(`${test.test_case_id} has no valid source reviews; dropped.`);
      continue;
    }
    if (!Array.isArray(test.steps) || test.steps.length === 0) {
      issues.push(`${test.test_case_id} has no steps; dropped.`);
      continue;
    }
    test.source_review_ids = sourceReviews;
    valid.push(test);
  }
  return { test_cases: valid, issues };
}

export async function runTestGeneration({ requirements, findings, llm, onEvent }) {
  const requirementMap = new Map(requirements.map((r) => [r.requirement_id, r]));
  const findingMap = new Map(findings.map((f) => [f.finding_id, f]));
  const reviewIds = new Set(findings.flatMap((f) => f.review_ids));
  let testCases = [];
  let method = 'model';
  let error = null;
  const validationIssues = [];

  if (llm && llm.available() && requirements.length > 0) {
    try {
      const result = await llm.completeJSON('test_generation', {
        requirements: requirements.map((r) => ({
          requirement_id: r.requirement_id,
          title: r.title,
          description: r.description,
          finding_id: r.finding_id,
          source_review_ids: r.source_review_ids,
          acceptance_criteria: r.acceptance_criteria,
          priority: r.priority,
        })),
        findings: findings.map((f) => ({
          finding_id: f.finding_id,
          title: f.title,
          review_ids: f.review_ids,
          excerpts: f.excerpts ?? [],
        })),
      }, 'tests');
      const validated = validateTestCases(result.test_cases, {
        requirementMap,
        findingMap,
        reviewIds,
      });
      validationIssues.push(...validated.issues);
      testCases = validated.test_cases;
    } catch (err) {
      method = 'failed';
      error = err.message;
      onEvent?.({ type: 'test_generation_failed', error: err.message });
    }
  } else {
    method = 'failed';
    error = 'Test generation requires a model and at least one requirement.';
  }
  return { test_cases: testCases, method, error, validation_issues: validationIssues };
}
