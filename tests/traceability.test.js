import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTraceability } from '../src/analysis/traceability.js';

test('validates a complete trace chain', () => {
  const reviews = [{ review_id: 'R-001', rating: 1, title: 'x', content: 'bad' }];
  const findings = [{ finding_id: 'F-01', review_ids: ['R-001'], evidence_status: 'supported' }];
  const requirements = [{ requirement_id: 'REQ-001', finding_id: 'F-01', source_review_ids: ['R-001'] }];
  const testCases = [
    { test_case_id: 'TC-001', requirement_id: 'REQ-001', finding_id: 'F-01', source_review_ids: ['R-001'], steps: ['do it'] },
  ];
  const result = validateTraceability({ reviews, findings, requirements, testCases });
  assert.equal(result.valid, true);
  assert.equal(result.summary.reviews_covered_by_findings, 1);
  assert.equal(result.summary.requirements_with_tests, 1);
});

test('detects broken links', () => {
  const reviews = [{ review_id: 'R-001', rating: 1, title: 'x', content: 'bad' }];
  const findings = [{ finding_id: 'F-01', review_ids: ['R-999'], evidence_status: 'supported' }];
  const requirements = [{ requirement_id: 'REQ-001', finding_id: 'F-02', source_review_ids: ['R-001'] }];
  const testCases = [];
  const result = validateTraceability({ reviews, findings, requirements, testCases });
  assert.equal(result.valid, false);
  assert.ok(result.issues.length >= 2);
});

