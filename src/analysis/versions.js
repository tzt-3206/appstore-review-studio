function scoreFinding(finding) {
  const evidence = finding.deterministic_evidence ?? {};
  const confidenceWeight = { high: 1, medium: 0.6, low: 0.3 }[finding.confidence] ?? 0.3;
  const severityWeight = { P0: 1, P1: 0.75, P2: 0.5, P3: 0.25 }[finding.severity] ?? 0.5;
  const support = Math.min(evidence.support_count ?? 0, 50) / 50;
  const conflictPenalty = 1 - (evidence.conflict_share ?? 0);
  return Number(((confidenceWeight * 0.35 + severityWeight * 0.25 + support * 0.25 + conflictPenalty * 0.15) * 100).toFixed(1));
}

export function validateVersionPlan(plan, findingIds) {
  const issues = [];
  const used = new Set();
  const versions = [];
  for (const version of plan?.versions ?? []) {
    if (!version.id) {
      issues.push('Version missing id.');
      continue;
    }
    const findingIdsInVersion = (version.finding_ids ?? []).filter((id) => {
      if (!findingIds.has(id)) {
        issues.push(`${version.id} references unknown finding ${id}.`);
        return false;
      }
      if (used.has(id)) {
        issues.push(`${id} appears in multiple versions.`);
        return false;
      }
      used.add(id);
      return true;
    });
    versions.push({ ...version, finding_ids: findingIdsInVersion });
  }
  return { versions, issues };
}

function fallbackVersionPlan(findings) {
  const ranked = [...findings].sort((a, b) => scoreFinding(b) - scoreFinding(a));
  const groupCount = Math.min(3, Math.max(1, Math.ceil(ranked.length / 3)));
  const versions = [];
  for (let i = 0; i < groupCount; i += 1) {
    const slice = ranked.slice(i * groupCount, (i + 1) * groupCount);
    if (slice.length === 0) continue;
    versions.push({
      id: i === 0 ? 'v1.1' : i === 1 ? 'v1.2' : 'v2.0',
      name: i === 0 ? '1.1 Top user-impact fixes' : i === 1 ? '1.2 UX and quality improvements' : '2.0 Longer-term product evolution',
      rationale: 'Rule-based fallback version plan sorted by evidence score.',
      finding_ids: slice.map((f) => f.finding_id),
      fallback: true,
    });
  }
  return { versions };
}

export async function runVersionPlanning({ findings, llm, onEvent }) {
  const findingIds = new Set(findings.map((f) => f.finding_id));
  let versionPlan = null;
  let method = 'model';
  let error = null;
  let validationIssues = [];

  if (llm && llm.available() && findings.length > 0) {
    try {
      const result = await llm.completeJSON('version_planning', {
        findings: findings.map((f) => ({
          finding_id: f.finding_id,
          title: f.title,
          summary: f.summary,
          confidence: f.confidence,
          severity: f.severity,
          support_count: f.deterministic_evidence?.support_count,
          conflict_share: f.deterministic_evidence?.conflict_share,
          evidence_status: f.evidence_status,
        })),
      }, 'version_plan');
      const validated = validateVersionPlan(result, findingIds);
      validationIssues = validated.issues;
      versionPlan = { versions: validated.versions, model: true };
      if (versionPlan.versions.length === 0) throw new Error('Version plan empty after validation.');
    } catch (err) {
      method = 'fallback';
      error = err.message;
      onEvent?.({ type: 'version_planning_failed', error: err.message });
    }
  } else {
    method = 'fallback';
    error = 'LLM provider unavailable or no findings.';
  }

  if (!versionPlan) {
    versionPlan = fallbackVersionPlan(findings);
    method = 'fallback';
  }

  return {
    version_plan: versionPlan,
    method,
    degraded: method === 'fallback',
    error,
    validation_issues: validationIssues,
    scoring: findings.map((f) => ({ finding_id: f.finding_id, score: scoreFinding(f) })),
  };
}
