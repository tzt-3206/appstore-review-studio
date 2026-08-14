import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFindingEvidence, applyEvidenceDecisions } from '../src/analysis/evidence.js';

const findings = [
  {
    finding_id: 'F-01',
    title: 'Timer loss',
    review_ids: ['R-001', 'R-002'],
    support_count: 2,
    conflicting_review_ids: ['R-003'],
  },
  {
    finding_id: 'F-02',
    title: 'Missing review',
    review_ids: ['R-999'],
    support_count: 1,
    conflicting_review_ids: [],
  },
];
const classified = [
  { review_id: 'R-001', rating: 1, title: '', content: 'bad' },
  { review_id: 'R-002', rating: 2, title: '', content: 'bad' },
  { review_id: 'R-003', rating: 5, title: '', content: 'fine' },
];

test('validates review IDs and evidence sufficiency', () => {
  const result = validateFindingEvidence(findings, classified, 3);
  assert.equal(result.checks.length, 2);
  assert.ok(result.checks[0].insufficient_evidence);
  assert.ok(result.checks[1].issues.some((i) => i.includes('Missing review')));
});

test('applies decisions and marks assumptions', () => {
  const decisions = [
    { finding_id: 'F-01', decision: 'mark_assumption', reason: 'only 2 reviews' },
    { finding_id: 'F-02', decision: 'revise_or_reject', reason: 'bad reference' },
  ];
  const applied = applyEvidenceDecisions(findings, decisions);
  assert.equal(applied.findings[0].status, 'assumption');
  assert.equal(applied.revisions.length, 1);
  assert.equal(applied.revisions[0].action, 'rejected');
});

