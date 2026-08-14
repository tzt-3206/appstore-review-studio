import { computeReviewStats } from '../data/stats.js';

function buildStratifiedSample(reviews, limit) {
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const review of reviews) buckets[review.rating]?.push(review);
  const out = [];
  let perBucket = Math.max(1, Math.floor(limit / 5));
  for (const rating of [1, 2, 3, 4, 5]) {
    const slice = buckets[rating].slice(0, perBucket);
    out.push(...slice);
  }
  if (out.length < limit && reviews.length > out.length) {
    const used = new Set(out.map((r) => r.review_id));
    for (const review of reviews) {
      if (out.length >= limit) break;
      if (!used.has(review.review_id)) out.push(review);
    }
  }
  return out;
}

export function validateTopics(topics, reviewIds) {
  if (!Array.isArray(topics) || topics.length === 0) return { ok: false, issues: ['No topics returned.'] };
  const issues = [];
  const ids = new Set();
  for (const topic of topics) {
    if (!topic.id || ids.has(topic.id)) issues.push(`Invalid or duplicate topic id: ${topic.id}`);
    ids.add(topic.id);
    if (!Array.isArray(topic.example_review_ids) || topic.example_review_ids.length === 0) {
      issues.push(`${topic.id} has no example reviews.`);
    } else {
      for (const id of topic.example_review_ids) {
        if (!reviewIds.has(id)) issues.push(`${topic.id} references missing review ${id}.`);
      }
    }
    if (!['negative', 'neutral', 'positive'].includes(topic.rating_bias)) {
      issues.push(`${topic.id} has invalid rating_bias.`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function fallbackTopics(reviews) {
  const stats = computeReviewStats(reviews);
  const topics = [];
  if (stats.negative_count > 0) {
    topics.push({
      id: 'T-01',
      name: 'Low-rated feedback',
      description: 'Reviews rated 1-2 stars; rule-based fallback topic.',
      example_review_ids: reviews.filter((r) => r.rating <= 2).slice(0, 5).map((r) => r.review_id),
      rating_bias: 'negative',
      fallback: true,
    });
  }
  if (stats.positive_count > 0) {
    topics.push({
      id: 'T-02',
      name: 'High-rated feedback',
      description: 'Reviews rated 4-5 stars; rule-based fallback topic.',
      example_review_ids: reviews.filter((r) => r.rating >= 4).slice(0, 5).map((r) => r.review_id),
      rating_bias: 'positive',
      fallback: true,
    });
  }
  if (stats.neutral_count > 0) {
    topics.push({
      id: 'T-03',
      name: 'Neutral feedback',
      description: 'Reviews rated 3 stars; rule-based fallback topic.',
      example_review_ids: reviews.filter((r) => r.rating === 3).slice(0, 5).map((r) => r.review_id),
      rating_bias: 'neutral',
      fallback: true,
    });
  }
  return topics;
}

export async function runTopicDiscovery({ scoped, llm, onEvent, modelMaxReviews }) {
  const sample = buildStratifiedSample(scoped.reviews, modelMaxReviews);
  const reviewIds = new Set(scoped.reviews.map((r) => r.review_id));

  let topics = null;
  let method = 'model';
  let error = null;
  if (llm && llm.available()) {
    try {
      const result = await llm.completeJSON('topic_discovery', {
        goal: scoped.scope?.summary ?? '',
        focus_areas: scoped.scope?.focus_areas ?? [],
        app: scoped.scope?.app ?? null,
        dataset_stats: scoped.stats,
        reviews: sample.map((r) => ({
          review_id: r.review_id,
          rating: r.rating,
          version: r.version,
          language: r.language,
          title: r.title,
          content: r.content.slice(0, 240),
          votes: r.vote_count,
        })),
      }, 'topics');
      const validation = validateTopics(result.topics, reviewIds);
      if (validation.ok) {
        topics = result.topics;
      } else {
        error = `Model topics failed validation: ${validation.issues.join('; ')}`;
        onEvent?.({ type: 'topic_validation_failed', message: error });
      }
    } catch (err) {
      error = err.message;
      onEvent?.({ type: 'topic_discovery_failed', error: err.message });
    }
  } else {
    error = 'LLM provider unavailable.';
  }

  if (!topics) {
    topics = fallbackTopics(scoped.reviews);
    method = 'fallback';
  }

  return {
    topics,
    method,
    degraded: method === 'fallback',
    error,
    sample_size: sample.length,
    topic_stats: computeTopicStats(topics, scoped.reviews),
  };
}

export function computeTopicStats(topics, reviews) {
  return topics.map((topic) => {
    const members = reviews.filter((r) => topic.example_review_ids.includes(r.review_id));
    const stats = computeReviewStats(members);
    return {
      topic_id: topic.id,
      name: topic.name,
      member_count: members.length,
      stats,
    };
  });
}

