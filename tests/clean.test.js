import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReviews } from '../src/data/clean.js';

test('cleans, deduplicates and counts reviews', () => {
  const raw = [
    { review_id: 'a', rating: 1, title: 'Bad', content: 'Subscription issue', version: '1.0', date: '2026-08-01', language: 'en' },
    { review_id: 'b', rating: 2, title: 'Bad', content: 'Subscription issue', version: '1.0', date: '2026-08-01', language: 'en' },
    { review_id: 'a', rating: 1, title: 'Bad', content: 'Subscription issue', version: '1.0', date: '2026-08-01', language: 'en' },
    { review_id: 'c', rating: 9, title: 'Invalid', content: 'bad rating' },
    { review_id: 'd', rating: 5, title: '', content: '' },
  ];
  const result = cleanReviews(raw, { source: 'test' });
  assert.equal(result.raw_count, 5);
  assert.equal(result.valid_count, 2);
  assert.equal(result.duplicate_count, 1);
  assert.equal(result.invalid_count, 2);
  assert.equal(result.cleaned.length, 2);
});

test('keeps distinct fingerprint reviews', () => {
  const raw = [
    { review_id: 'a', rating: 5, title: 'Good', content: 'Works', version: '1.0', date: '2026-08-01' },
    { review_id: 'b', rating: 5, title: 'Good', content: 'Works now', version: '1.0', date: '2026-08-01' },
  ];
  const result = cleanReviews(raw, { source: 'test' });
  assert.equal(result.valid_count, 2);
});
