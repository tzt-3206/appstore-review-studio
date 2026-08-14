import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppStoreUrl } from '../src/collectors/appstore.js';
import { parseGoalFilters, applyScopeFilters } from '../src/analysis/scope.js';

test('parses U.S. and CN App Store URLs', () => {
  const us = parseAppStoreUrl('https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684');
  assert.equal(us.ok, true);
  assert.equal(us.country, 'us');
  assert.equal(us.appId, '839285684');
  const cn = parseAppStoreUrl('https://apps.apple.com/cn/app/workout-for-women-home-gym/id839285684');
  assert.equal(cn.country, 'cn');
  assert.equal(parseAppStoreUrl('https://example.com').ok, false);
});

test('extracts goal filters deterministically', () => {
  const goal = 'Focus on low-rated reviews and version 8.2 regression; max 100 reviews';
  const { filters, applied } = parseGoalFilters(goal, {});
  assert.equal(filters.max_rating, 2);
  assert.ok(filters.versions.includes('v8.2'));
  assert.equal(filters.max_reviews, 100);
  assert.ok(applied.length >= 2);
});

test('applies scope filters to reviews', () => {
  const reviews = [
    { review_id: 'a', rating: 1, version: '8.2.0', language: 'en' },
    { review_id: 'b', rating: 5, version: '8.4.0', language: 'en' },
    { review_id: 'c', rating: 2, version: '8.3.0', language: 'zh' },
  ];
  const result = applyScopeFilters(reviews, { min_rating: 1, max_rating: 2, versions: ['8.2'], languages: [], max_reviews: 50 });
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].review_id, 'a');
});

