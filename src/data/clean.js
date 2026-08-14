import { normalizeRawReview, toInternalReview } from './normalize.js';
import { stableSortReviews } from '../util/ids.js';
import { computeReviewStats } from './stats.js';

export function cleanReviews(rawReviews, { source = 'import' } = {}) {
  const normalized = rawReviews.map((raw, index) => normalizeRawReview(raw, index, source));
  const invalid = [];
  const duplicateExternal = [];
  const validByExternal = new Map();

  for (const item of normalized) {
    const ratingOk = Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5;
    const contentOk = Boolean(item.title || item.content);
    if (!ratingOk || !contentOk) {
      invalid.push({ ...item, reason: ratingOk ? 'missing content' : 'invalid rating' });
      continue;
    }
    const key = item.external_id || `slot-${validByExternal.size}`;
    if (validByExternal.has(key)) {
      duplicateExternal.push({ ...item, reason: 'duplicate external id', original_id: validByExternal.get(key).external_id });
    } else {
      validByExternal.set(key, item);
    }
  }

  const uniqueByFingerprint = new Map();
  const duplicateFingerprints = [];
  for (const item of validByExternal.values()) {
    const fp = fingerprintReview(item);
    if (uniqueByFingerprint.has(fp)) {
      duplicateFingerprints.push({ ...item, reason: 'duplicate fingerprint', original_id: uniqueByFingerprint.get(fp).external_id });
    } else {
      uniqueByFingerprint.set(fp, item);
    }
  }

  const cleaned = stableSortReviews([...uniqueByFingerprint.values()]).map((item, index) =>
    toInternalReview(item, index + 1),
  );

  const stats = computeReviewStats(cleaned);
  return {
    cleaned,
    raw_count: rawReviews.length,
    valid_count: cleaned.length,
    invalid_count: invalid.length,
    duplicate_count: duplicateExternal.length + duplicateFingerprints.length,
    invalid,
    duplicates: [...duplicateExternal, ...duplicateFingerprints],
    stats,
    source,
  };
}

function fingerprintReview(review) {
  return `${review.rating}|${review.version}|${review.date}|${review.title}|${review.content}`;
}
