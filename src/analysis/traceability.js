export function validateTraceability({ reviews, findings, requirements, testCases }) {
  const reviewIds = new Set(reviews.map((r) => r.review_id));
  const findingMap = new Map(findings.map((f) => [f.finding_id, f]));
  const requirementMap = new Map(requirements.map((r) => [r.requirement_id, r]));
  const issues = [];
  const validations = [];

  for (const finding of findings) {
    const missing = finding.review_ids.filter((id) => !reviewIds.has(id));
    const item = {
      from: 'Finding',
      id: finding.finding_id,
      to: 'Reviews',
      valid: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : `${finding.review_ids.length} valid reviews`,
    };
    validations.push(item);
    if (!item.valid) issues.push({ type: 'finding_review', id: finding.finding_id, message: item.detail });
  }

  for (const requirement of requirements) {
    const finding = findingMap.get(requirement.finding_id);
    const item = {
      from: 'Requirement',
      id: requirement.requirement_id,
      to: 'Finding',
      valid: Boolean(finding),
      detail: finding ? requirement.finding_id : `missing finding ${requirement.finding_id}`,
    };
    validations.push(item);
    if (!item.valid) issues.push({ type: 'requirement_finding', id: requirement.requirement_id, message: item.detail });
    if (finding) {
      const invalidSources = requirement.source_review_ids.filter((id) => !finding.review_ids.includes(id));
      if (invalidSources.length) {
        issues.push({
          type: 'requirement_review_scope',
          id: requirement.requirement_id,
          message: `source reviews outside finding: ${invalidSources.join(', ')}`,
        });
      }
    }
  }

  for (const test of testCases) {
    const requirement = requirementMap.get(test.requirement_id);
    const finding = findingMap.get(test.finding_id);
    const item = {
      from: 'Test Case',
      id: test.test_case_id,
      to: 'Requirement',
      valid: Boolean(requirement && finding && requirement.finding_id === finding.finding_id),
      detail: requirement && finding ? `${test.requirement_id} -> ${test.finding_id}` : 'broken link',
    };
    validations.push(item);
    if (!item.valid) issues.push({ type: 'test_link', id: test.test_case_id, message: item.detail });
  }

  const coveredReviews = new Set();
  for (const finding of findings) for (const id of finding.review_ids) coveredReviews.add(id);
  const coveredFindings = new Set(requirements.map((r) => r.finding_id));
  const coveredRequirements = new Set(testCases.map((t) => t.requirement_id));

  const summary = {
    reviews_total: reviews.length,
    reviews_covered_by_findings: coveredReviews.size,
    review_coverage: reviews.length ? Number((coveredReviews.size / reviews.length).toFixed(3)) : 0,
    findings_total: findings.length,
    findings_with_requirements: coveredFindings.size,
    findings_covered_share: findings.length ? Number((coveredFindings.size / findings.length).toFixed(3)) : 0,
    requirements_total: requirements.length,
    requirements_with_tests: coveredRequirements.size,
    requirements_covered_share: requirements.length ? Number((coveredRequirements.size / requirements.length).toFixed(3)) : 0,
    tests_total: testCases.length,
    issues_total: issues.length,
  };

  return {
    valid: issues.length === 0,
    issues,
    validations,
    summary,
  };
}

