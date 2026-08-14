function findingExcerpts(finding, classified) {
  const map = new Map(classified.map((r) => [r.review_id, r]));
  return finding.review_ids.slice(0, 8).map((id) => {
    const review = map.get(id);
    return `${id}: ${(review?.content || review?.title || '').slice(0, 160)}`;
  });
}

export function validateFindingEvidence(findings, classified, minSupport) {
  const reviewMap = new Map(classified.map((r) => [r.review_id, r]));
  const checks = [];
  const issues = [];
  for (const finding of findings) {
    const missing = finding.review_ids.filter((id) => !reviewMap.has(id));
    const supportCount = finding.review_ids.length;
    const conflictIds = (finding.conflicting_review_ids ?? []).filter((id) => reviewMap.has(id));
    const hasConflict = conflictIds.length > 0;
    const insufficient = supportCount < minSupport;
    const check = {
      finding_id: finding.finding_id,
      review_ids_exist: missing.length === 0,
      support_count_matches: supportCount === finding.support_count,
      support_count: supportCount,
      min_support: minSupport,
      insufficient_evidence: insufficient,
      conflict_count: conflictIds.length,
      has_conflicting_evidence: hasConflict,
      issues: [],
    };
    if (missing.length) {
      check.issues.push(`Missing review IDs: ${missing.join(', ')}`);
      issues.push(`${finding.finding_id} references missing reviews.`);
    }
    if (supportCount !== finding.support_count) {
      check.issues.push('support_count does not match review_ids.');
      issues.push(`${finding.finding_id} has mismatched support_count.`);
    }
    if (insufficient) {
      check.issues.push(`Only ${supportCount} supporting reviews; below min ${minSupport}.`);
      issues.push(`${finding.finding_id} has insufficient evidence.`);
    }
    checks.push(check);
  }
  return { checks, issues };
}

export async function runEvidenceValidation({ findings, classified, llm, onEvent, minSupport }) {
  const deterministic = validateFindingEvidence(findings, classified, minSupport);
  let semanticChecks = [];
  let semanticError = null;
  if (llm && llm.available() && findings.length > 0) {
    try {
      const result = await llm.completeJSON('evidence_validation', {
        findings: findings.map((f) => ({
          finding_id: f.finding_id,
          title: f.title,
          summary: f.summary,
          excerpts: findingExcerpts(f, classified),
          conflicting_review_ids: f.conflicting_review_ids ?? [],
        })),
      }, 'evidence');
      semanticChecks = result.checks ?? [];
    } catch (error) {
      semanticError = error.message;
      onEvent?.({ type: 'evidence_validation_failed', error: error.message });
    }
  }
  const semanticByFinding = new Map(semanticChecks.map((c) => [c.finding_id, c]));

  const decisions = findings.map((finding) => {
    const semantic = semanticByFinding.get(finding.finding_id);
    const det = deterministic.checks.find((c) => c.finding_id === finding.finding_id);
    let decision = 'keep';
    let reason = '';
    if (semantic && semantic.semantically_supported === false) {
      decision = 'revise_or_reject';
      reason = semantic.reasons?.join('; ') || 'Model found excerpts inconsistent with finding.';
    } else if (det?.insufficient_evidence) {
      decision = 'mark_assumption';
      reason = `Only ${det.support_count} supporting reviews; below min ${det.min_support}.`;
    }
    return {
      finding_id: finding.finding_id,
      decision,
      reason,
      deterministic_check: det,
      semantic_check: semantic,
    };
  });

  return {
    deterministic,
    semantic_checks: semanticChecks,
    semantic_error: semanticError,
    decisions,
    applied: applyEvidenceDecisions(findings, decisions),
  };
}

export function applyEvidenceDecisions(findings, decisions) {
  const decisionMap = new Map(decisions.map((d) => [d.finding_id, d]));
  const kept = [];
  const revisions = [];
  for (const finding of findings) {
    const decision = decisionMap.get(finding.finding_id) ?? { decision: 'keep' };
    if (decision.decision === 'keep') {
      finding.evidence_decision = 'supported';
      kept.push(finding);
    } else if (decision.decision === 'mark_assumption') {
      finding.evidence_decision = 'assumption';
      finding.status = 'assumption';
      finding.assumptions = [...(finding.assumptions ?? []), `Insufficient evidence: ${decision.reason}`];
      kept.push(finding);
    } else {
      finding.evidence_decision = 'revise_or_reject';
      finding.status = 'rejected';
      finding.revision_reason = decision.reason;
      revisions.push({
        finding_id: finding.finding_id,
        action: 'rejected',
        reason: decision.reason,
      });
    }
  }
  return { findings: kept, revisions };
}
