import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { runPipeline } from '../src/pipeline.js';

function sampleReviews() {
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    out.push({
      review_id: `ext-${i}`,
      rating: i % 3 === 0 ? 1 : i % 2 === 0 ? 2 : 5,
      title: `Review ${i}`,
      content:
        i % 2 === 0
          ? 'Subscription charged twice and paywall blocks the workout'
          : 'Love the workouts, easy to use and very motivating',
      version: `8.${i % 4}.0`,
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      language: 'en',
    });
  }
  return out;
}

test('runs the full pipeline end to end with the mock provider', async () => {
  const cfg = {
    ...config,
    llm: { ...config.llm, provider: 'mock' },
    llmMaxRetries: 1,
    minFindingSupport: 2,
  };
  const input = {
    job_id: 'pipeline-test',
    source: {
      type: 'json',
      text: JSON.stringify(sampleReviews()),
      fileName: 'test.json',
    },
    goal: 'Analyze subscription conversion and workout usability.',
    constraints: {},
    options: { max_reviews: 100 },
  };
  const result = await runPipeline(input, {
    config: cfg,
    rootDir: process.cwd(),
    onEvent: () => {},
  });
  const stages = result.stages.map((s) => `${s.id}:${s.status}`);
  assert.equal(result.stages.every((s) => s.status === 'done'), true, stages.join(' | '));
  assert.ok(result.artifacts.findings.findings.length >= 1);
  assert.ok(result.artifacts.requirements.length >= 1);
  assert.ok(result.artifacts.test_cases.length >= 1);
  assert.equal(result.artifacts.traceability.valid, true);
});

