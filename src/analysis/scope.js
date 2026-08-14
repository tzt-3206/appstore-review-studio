import { parseAppStoreUrl } from '../collectors/appstore.js';
import { computeReviewStats } from '../data/stats.js';

const LANGUAGE_ALIASES = {
  english: 'en',
  chinese: 'zh',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  russian: 'ru',
  italian: 'it',
  portuguese: 'pt',
  arabic: 'ar',
  indonesian: 'id',
  dutch: 'nl',
  polish: 'pl',
  thai: 'th',
};

const FOCUS_WORDS = [
  'subscription',
  'conversion',
  'pricing',
  'paywall',
  'trial',
  'onboarding',
  'workout',
  'timer',
  'navigation',
  'usability',
  'crash',
  'ads',
  'sync',
  'bug',
  'performance',
  'design',
  'feature',
  'content',
  'personalization',
  'account',
  'notification',
  'offline',
];

function matches(text, regex) {
  const m = text.match(regex);
  return m ? m[1] ?? null : null;
}

export function parseGoalFilters(goalText = '', constraints = {}) {
  const text = `${goalText} ${constraints.goal_hint ?? ''}`.toLowerCase();
  const filters = {
    min_rating: Number.isInteger(constraints.min_rating) ? constraints.min_rating : 1,
    max_rating: Number.isInteger(constraints.max_rating) ? constraints.max_rating : 5,
    versions: Array.isArray(constraints.versions) && constraints.versions.length ? constraints.versions.map(String) : [],
    languages: Array.isArray(constraints.languages) && constraints.languages.length ? constraints.languages.map(String) : [],
    max_reviews: Number.isInteger(constraints.max_reviews) && constraints.max_reviews > 0 ? constraints.max_reviews : null,
  };
  const applied = [];

  const star = text.match(/(\d)\s*[- ]?star/i);
  if (star) {
    const value = Number(star[1]);
    filters.min_rating = value;
    filters.max_rating = value;
    applied.push(`rating=${value} stars`);
  } else if (/low[- ]?rated|worst|negative|1[- ]to[- ]2[- ]star/i.test(text)) {
    filters.max_rating = Math.min(filters.max_rating, 2);
    applied.push('low-rated focus (rating <= 2)');
  }

  const min = matches(text, /rating\s*(?:>=|gte|at least|above|higher than|more than)\s*(\d)/i);
  if (min) {
    filters.min_rating = Math.max(filters.min_rating, Number(min));
    applied.push(`min_rating=${min}`);
  }
  const max = matches(text, /rating\s*(?:<=|lte|below|under|less than|lower than)\s*(\d)/i);
  if (max) {
    filters.max_rating = Math.min(filters.max_rating, Number(max));
    applied.push(`max_rating=${max}`);
  }
  const between = text.match(/between\s*(\d)\s*(?:and|to)\s*(\d)/i);
  if (between) {
    filters.min_rating = Math.max(filters.min_rating, Number(between[1]));
    filters.max_rating = Math.min(filters.max_rating, Number(between[2]));
    applied.push(`rating ${between[1]}-${between[2]}`);
  }

  const versionMatches = text.match(/(?:version|v)\s*(\d+(?:\.\d+){0,3})/g) || [];
  const versions = versionMatches.map((v) => v.replace(/version\s*/i, 'v').trim());
  if (versions.length) {
    filters.versions = [...new Set([...filters.versions, ...versions])];
    applied.push(`versions=${versions.join(',')}`);
  }

  for (const [name, code] of Object.entries(LANGUAGE_ALIASES)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) {
      filters.languages.push(code);
      applied.push(`language=${code}`);
    }
  }

  const count = text.match(/(\d+)\s*reviews?/i);
  if (count) {
    filters.max_reviews = Number(count[1]);
    applied.push(`max_reviews=${count[1]}`);
  }

  const focus = FOCUS_WORDS.filter((word) => new RegExp(`\\b${word}`, 'i').test(text));
  filters.focus_hints = [...new Set(focus)];
  return { filters, applied, focus_hints: filters.focus_hints };
}

export function applyScopeFilters(reviews, filters) {
  const minRating = filters.min_rating ?? 1;
  const maxRating = filters.max_rating ?? 5;
  const versions = filters.versions ?? [];
  const languages = filters.languages ?? [];
  const maxReviews = filters.max_reviews ?? null;

  const filtered = reviews.filter((review) => {
    if (review.rating < minRating || review.rating > maxRating) return false;
    if (versions.length && !versions.some((v) => review.version && review.version.startsWith(v.replace(/^v/i, '')))) return false;
    if (languages.length && !languages.includes(review.language)) return false;
    return true;
  });

  const limited = maxReviews ? filtered.slice(0, maxReviews) : filtered;
  return {
    reviews: limited,
    stats: computeReviewStats(limited),
    filters,
    removed: reviews.length - limited.length,
  };
}

export function buildScopeSample(reviews, limit = 40) {
  return reviews.slice(0, limit).map((r) => ({
    review_id: r.review_id,
    rating: r.rating,
    version: r.version,
    language: r.language,
    title: r.title,
    content: r.content.slice(0, 240),
  }));
}

export async function runScopeAnalysis({ url, goal, constraints, metadata, cleaned, llm, onEvent }) {
  const urlInfo = url ? parseAppStoreUrl(url) : { ok: true, country: null, appId: null, slug: '', normalizedUrl: null };
  if (!urlInfo.ok) {
    return { ok: false, error: urlInfo.error };
  }

  const { filters, applied, focus_hints } = parseGoalFilters(goal, constraints);
  const deterministic = {
    method: 'rules',
    filters,
    applied,
    focus_hints,
    note: 'Explicit rating, version, language, and count constraints parsed deterministically.',
  };

  let llmRefinement = null;
  let method = 'rules';
  if (llm && llm.available()) {
    try {
      const payload = {
        goal,
        explicit_constraints: filters,
        app: metadata,
        dataset_stats: computeReviewStats(cleaned.slice(0, 300)),
        review_sample: buildScopeSample(cleaned, 40),
      };
      llmRefinement = await llm.completeJSON('scope_refinement', payload, 'scope');
      method = 'llm_refined';
      onEvent?.({
        type: 'scope_llm',
        message: 'Scope refined by model.',
        focus_areas: llmRefinement.focus_areas,
      });
    } catch (error) {
      onEvent?.({
        type: 'scope_llm_failed',
        error: error.message,
        message: 'Model scope refinement failed; using deterministic constraints.',
      });
    }
  }

  const mergedFilters = {
    ...filters,
    ...(llmRefinement?.filters ?? {}),
    min_rating: Math.max(filters.min_rating, llmRefinement?.filters?.min_rating ?? 1),
    max_rating: Math.min(filters.max_rating, llmRefinement?.filters?.max_rating ?? 5),
    max_reviews: filters.max_reviews ?? llmRefinement?.filters?.max_reviews ?? cleaned.length,
  };
  mergedFilters.versions = [...new Set([...(filters.versions ?? []), ...(llmRefinement?.filters?.versions ?? [])])];
  mergedFilters.languages = [...new Set([...(filters.languages ?? []), ...(llmRefinement?.filters?.languages ?? [])])];

  const scoped = applyScopeFilters(cleaned, mergedFilters);
  return {
    ok: true,
    urlInfo,
    deterministic,
    llm_refinement: llmRefinement,
    method,
    scope: {
      summary: llmRefinement?.scope_summary ?? 'Review scope defined by user goal and explicit constraints.',
      focus_areas: llmRefinement?.focus_areas ?? focus_hints,
      filters: mergedFilters,
      priority_rationale: llmRefinement?.priority_rationale ?? 'Deterministic priority: user goal plus evidence availability.',
      data_sufficiency_notes: llmRefinement?.data_sufficiency_notes ?? 'Evidence sufficiency is validated in later pipeline stages.',
      source_country: 'us',
      page_country: urlInfo.country,
      app: metadata,
    },
    scoped,
    errors: [],
  };
}

