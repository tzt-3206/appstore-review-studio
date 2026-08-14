import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRawReview, toInternalReview, fingerprintReview } from '../src/data/normalize.js';

test('normalizes raw review fields', () => {
  const raw = {
    review_id: 'abc',
    author: '  Ada   ',
    rating: '4',
    version: ' 8.2.0 ',
    title: ' Great   app ',
    content: '   Works    well.  ',
    date: '2026-08-01T00:00:00Z',
  };
  const normalized = normalizeRawReview(raw, 0, 'test');
  assert.equal(normalized.rating, 4);
  assert.equal(normalized.version, '8.2.0');
  assert.equal(normalized.title, 'Great app');
  assert.equal(normalized.content, 'Works well.');
  assert.equal(normalized.date, '2026-08-01T00:00:00.000Z');
  assert.equal(normalized.language, 'en');
  const internal = toInternalReview(normalized, 1);
  assert.equal(internal.review_id, 'R-0001');
  assert.ok(fingerprintReview(normalized).length === 64);
});

test('keeps null rating when missing', () => {
  const normalized = normalizeRawReview({ review_id: 'x', title: 'No rating', content: 'text' }, 0, 'test');
  assert.equal(normalized.rating, null);
});

