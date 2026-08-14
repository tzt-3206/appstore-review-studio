function payloadFrom(messages) {
  const user = [...messages].reverse().find((m) => m.role === 'user');
  if (!user) return {};
  try {
    return typeof user.content === 'string' ? JSON.parse(user.content) : user.content;
  } catch {
    return {};
  }
}

function systemHint(messages) {
  const system = messages.find((m) => m.role === 'system');
  return system ? system.content : '';
}

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'mock-deterministic',
    async complete(messages) {
      const hint = systemHint(messages);
      const payload = payloadFrom(messages);
      if (hint.includes('MOCK_SCOPE')) {
        return {
          scope_summary: 'Mock scope focused on user-stated goal.',
          focus_areas: (payload.goal || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
          filters: { min_rating: 1, max_rating: 5, versions: [], languages: [], max_reviews: 100 },
          priority_rationale: 'Mock provider for tests.',
          data_sufficiency_notes: 'Mock.',
        };
      }
      if (hint.includes('MOCK_TOPICS')) {
        const reviews = payload.reviews || [];
        const topics = [
          { id: 'T-01', name: 'Negative experience', description: 'Low-rated feedback', rating_bias: 'negative', example_review_ids: reviews.filter((r) => r.rating <= 2).slice(0, 5).map((r) => r.review_id) },
          { id: 'T-02', name: 'Positive experience', description: 'High-rated feedback', rating_bias: 'positive', example_review_ids: reviews.filter((r) => r.rating >= 4).slice(0, 5).map((r) => r.review_id) },
        ].filter((t) => t.example_review_ids.length > 0);
        return { topics, rationale: 'Mock topic discovery for tests.' };
      }
      if (hint.includes('MOCK_CLASSIFY')) {
        const topics = payload.topics || [];
        const reviews = payload.reviews || [];
        const assignments = reviews.map((r) => {
          const topic = r.rating <= 2 ? topics[0] : topics[1] || topics[0];
          return {
            review_id: r.review_id,
            topics: topic ? [topic.id] : [],
            sentiment: r.rating <= 2 ? 'negative' : r.rating >= 4 ? 'positive' : 'neutral',
            explanation: 'Mock classification for tests.',
          };
        });
        return { assignments, unclassified_review_ids: [] };
      }
      if (hint.includes('MOCK_FINDINGS')) {
        const grouped = (payload.classified || []).reduce((acc, item) => {
          for (const topicId of item.topics) {
            acc[topicId] = acc[topicId] || [];
            acc[topicId].push(item);
          }
          return acc;
        }, {});
        const findings = Object.entries(grouped).map(([topicId, items], index) => ({
          finding_id: `F-${String(index + 1).padStart(2, '0')}`,
          title: `Mock finding for ${topicId}`,
          summary: 'Mock finding generated for tests.',
          topic_id: topicId,
          review_ids: items.map((i) => i.review_id),
          excerpts: items.slice(0, 3).map((i) => `${i.review_id}: ${(i.content || i.title || '').slice(0, 120)}`),
          support_count: items.length,
          confidence: items.length >= 3 ? 'high' : 'low',
          conflicting_review_ids: [],
          statistical_basis: { average_rating: null },
          model_conclusion: true,
          assumptions: [],
        }));
        return { findings, rationale: 'Mock findings for tests.' };
      }
      if (hint.includes('MOCK_VERSION')) {
        const findingIds = (payload.findings || []).map((f) => f.finding_id);
        return {
          versions: [{ id: 'v1.1', name: '1.1 Mock priority fixes', rationale: 'Mock version plan.', finding_ids: findingIds }],
          scoring_notes: { rule: 'mock' },
        };
      }
      if (hint.includes('MOCK_PRD')) {
        const findings = payload.findings || [];
        return {
          requirements: findings.map((f, index) => ({
            requirement_id: `REQ-${String(index + 1).padStart(3, '0')}`,
            title: `Mock requirement for ${f.finding_id}`,
            problem: f.summary,
            finding_id: f.finding_id,
            source_review_ids: f.review_ids.slice(0, 5),
            user_need: 'Mock user need.',
            description: 'Mock requirement.',
            acceptance_criteria: ['Mock criterion.'],
            priority: 'P1',
            target_version_id: 'v1.1',
            evidence_strength: f.confidence,
            assumptions: [],
          })),
        };
      }
      if (hint.includes('MOCK_TESTS')) {
        const requirements = payload.requirements || [];
        const tests = [];
        for (const req of requirements) {
          for (const idx of [1, 2]) {
            tests.push({
              test_case_id: `TC-${String(tests.length + 1).padStart(3, '0')}`,
              requirement_id: req.requirement_id,
              finding_id: req.finding_id,
              source_review_ids: req.source_review_ids,
              title: `Mock test ${idx} for ${req.requirement_id}`,
              preconditions: ['Mock precondition.'],
              steps: ['Mock step.'],
              expected_results: ['Mock expected result.'],
              priority: req.priority,
            });
          }
        }
        return { test_cases: tests };
      }
      if (hint.includes('MOCK_EVIDENCE')) {
        return {
          checks: (payload.findings || []).map((f) => ({
            finding_id: f.finding_id,
            semantically_supported: true,
            reasons: ['Mock evidence check for tests.'],
            suggested_revisions: [],
          })),
        };
      }
      return { ok: true };
    },
  };
}
