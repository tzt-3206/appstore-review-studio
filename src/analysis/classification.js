import { computeReviewStats } from '../data/stats.js';

function fallbackAssignments(reviews, topics) {
  const byBias = {
    negative: topics.find((t) => t.rating_bias === 'negative'),
    neutral: topics.find((t) => t.rating_bias === 'neutral'),
    positive: topics.find((t) => t.rating_bias === 'positive'),
  };
  return reviews.map((review) => {
    const bucket = review.rating <= 2 ? 'negative' : review.rating >= 4 ? 'positive' : 'neutral';
    const topic = byBias[bucket];
    return {
      review_id: review.review_id,
      topics: topic ? [topic.id] : [],
      sentiment: bucket,
      explanation: 'Rule-based fallback assignment by rating.',
      fallback: true,
    };
  });
}

export async function runClassification({ scoped, topics, llm, onEvent, batchSize }) {
  const reviews = scoped.reviews;
  const topicIds = new Set(topics.map((t) => t.id));
  const assignments = [];
  const errors = [];
  let degraded = false;

  if (llm && llm.available()) {
    for (let start = 0; start < reviews.length; start += batchSize) {
      const batch = reviews.slice(start, start + batchSize);
      try {
        const result = await llm.completeJSON('classification', {
          goal: scoped.scope?.summary ?? '',
          topics,
          reviews: batch.map((r) => ({
            review_id: r.review_id,
            rating: r.rating,
            version: r.version,
            language: r.language,
            title: r.title,
            content: r.content.slice(0, 160),
            votes: r.vote_count,
          })),
        }, 'classify');
        const batchIds = new Set(batch.map((r) => r.review_id));
        const seen = new Set();
        const valid = [];
        for (const item of result.assignments ?? []) {
          if (!batchIds.has(item.review_id)) {
            errors.push(`Model referenced review outside batch: ${item.review_id}`);
            continue;
          }
          if (seen.has(item.review_id)) {
            errors.push(`Duplicate assignment for ${item.review_id}`);
            continue;
          }
          seen.add(item.review_id);
          item.topics = (item.topics ?? []).filter((id) => topicIds.has(id));
          valid.push(item);
        }
        const missing = [...batchIds].filter((id) => !seen.has(id) && !(result.unclassified_review_ids ?? []).includes(id));
        if (missing.length) errors.push(`Unassigned reviews in batch: ${missing.join(',')}`);
        assignments.push(...valid);
        onEvent?.({
          type: 'classification_batch',
          start,
          count: valid.length,
          errors: missing.length,
        });
      } catch (error) {
        degraded = true;
        errors.push(`Batch ${start}-${start + batch.length} failed: ${error.message}`);
        onEvent?.({ type: 'classification_batch_failed', error: error.message });
      }
    }
  } else {
    degraded = true;
    errors.push('LLM provider unavailable; using rule-based fallback assignment.');
  }

  if (degraded || assignments.length < reviews.length) {
    const assignedIds = new Set(assignments.map((a) => a.review_id));
    const fallback = fallbackAssignments(reviews.filter((r) => !assignedIds.has(r.review_id)), topics);
    assignments.push(...fallback);
    degraded = true;
  }

  const byReview = new Map(assignments.map((a) => [a.review_id, a]));
  const classified = reviews.map((review) => {
    const assignment = byReview.get(review.review_id);
    return {
      ...review,
      topics: assignment?.topics ?? [],
      sentiment: assignment?.sentiment ?? (review.rating <= 2 ? 'negative' : review.rating >= 4 ? 'positive' : 'neutral'),
      classification_explanation: assignment?.explanation ?? '',
    };
  });

  return {
    classified,
    assignments,
    degraded,
    errors,
    topic_stats: topics.map((topic) => {
      const members = classified.filter((r) => r.topics.includes(topic.id));
      return {
        topic_id: topic.id,
        name: topic.name,
        member_count: members.length,
        average_rating: members.length ? Number((members.reduce((s, r) => s + r.rating, 0) / members.length).toFixed(2)) : 0,
        stats: computeReviewStats(members),
        example_review_ids: members.slice(0, 5).map((r) => r.review_id),
      };
    }),
  };
}
